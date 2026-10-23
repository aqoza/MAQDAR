"""Live rate, authority and concurrency checks across independent database sessions."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft as base_draft, session
from test_redistribution_db import redistribution  # noqa: F401
from test_network_allocation_db import network as base_network, PREVIEW as ALLOCATION_PREVIEW, SAVE as ALLOCATION_SAVE
from test_network_dates_db import dates, PREVIEW as DATE_PREVIEW, SAVE as DATE_SAVE  # noqa: F401
from test_network_freight_db import freight, SAVE, PREVIEW  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SUBMIT = 'select public.network_transfer_submit(%s,%s,%s,%s)'
DECIDE = 'select public.network_transfer_decide(%s,%s,%s,%s,%s)'


@pytest.fixture
def draft(base_draft):
    # Set the policy horizon before the real quantity/date/freight pipeline runs.
    with psycopg.connect(base_draft[0]) as db:
        db.execute("update public.inventory_policies set evidence=jsonb_set(evidence,'{options,lead_time}','10') where organization_id=%s", (base_draft[1],))
    return base_draft


@pytest.fixture
def network(base_network, request):
    if getattr(request, 'param', None) != 'zero':
        return base_network
    source, inputs, report = base_network
    first = report['lines'][0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.stock_snapshots set quantity=100 where organization_id=%s and location_id=%s",
                   (source[1], first['location_id']))
    with session(source) as db:
        policy = first['evidence']['destination']['policy']['policy_id']
        gap = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (source[1], policy)).fetchone()[0]
        zero = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",
                          (source[1], policy, uuid4(), gap['fingerprint'])).fetchone()[0]
        drafts = [zero if str(x) == first['draft_id'] else x for x in inputs[1]]
        updated_inputs = (inputs[0], drafts, inputs[2])
        allocation = db.execute(ALLOCATION_PREVIEW, updated_inputs).fetchone()[0]
    return source, updated_inputs, allocation


@pytest.fixture
def transfer(freight):
    source, inputs, report = freight
    assert all(line['receipts'][p]['timing_review_required'] is False
               for line in report['source']['lines'] if Decimal(line['quantity']) > 0 for p in ['p50','p90'])
    with session(source) as db:
        estimate = db.execute(SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
        alternate = db.execute(SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    users = [uuid4(), uuid4()]
    with psycopg.connect(source[0]) as db:
        for user in users:
            db.execute('insert into auth.users(id,email) values(%s,%s)', (user, f'network-review-{user}@test.local'))
            db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')", (source[1],user))
    yield source, estimate, alternate, users
    with psycopg.connect(source[0]) as db:
        db.execute('delete from auth.users where id=any(%s)', (users,))


def reviewer(transfer, index=0):
    source = transfer[0]
    return session((source[0], source[1], transfer[3][index], source[3]))


def propose(transfer):
    with session(transfer[0]) as db:
        return db.execute(SUBMIT,(transfer[0][1],transfer[1],uuid4(),'Transfer reason')).fetchone()[0]


@pytest.mark.parametrize('replay', [False, True])
def test_pending_across_estimates_and_submission_replay(transfer, replay):
    source, estimate, alternate, _ = transfer
    first_args = (source[1],estimate,uuid4(),'Transfer reason')
    second_args = first_args if replay else (source[1],alternate,uuid4(),'Alternative estimate')
    with session(source) as first, session(source) as second:
        assert _race(first,second,SUBMIT,first_args,second_args).sqlstate == (None if replay else 'MQ409')
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.network_transfer_proposals where organization_id=%s',(source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='network_transfer_proposals'",(source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('replay', [False, True])
def test_competing_decisions_and_replay(transfer, replay):
    proposal=propose(transfer)
    args=(transfer[0][1],proposal,uuid4(),'approved','Independent review')
    with reviewer(transfer) as first, reviewer(transfer,0 if replay else 1) as second:
        result=_race(first,second,DECIDE,args,args if replay else (transfer[0][1],proposal,uuid4(),'rejected','Alternative'))
        assert result.sqlstate == (None if replay else 'MQ409')
    with psycopg.connect(transfer[0][0]) as db:
        assert db.execute('select status,decided_by from public.network_transfer_proposals where id=%s',(proposal,)).fetchone() == ('approved',transfer[3][0])
        assert db.execute('select count(*) from public.audit_log where record_id=%s',(proposal,)).fetchone()[0] == 2


@pytest.mark.parametrize('operation', ['submit','approve'])
@pytest.mark.parametrize('change,expected', [('rate','MQ409'),('lane','MQ409'),('location','MQ409'),('role','MQ403'),('membership','MQ403')])
def test_rechecks_after_lock_wait(transfer, operation, change, expected):
    source=transfer[0]
    if operation=='approve':
        proposal=propose(transfer)
        sql,args,waiting,user=DECIDE,(source[1],proposal,uuid4(),'approved','Reviewed'),reviewer(transfer),transfer[3][0]
    else:
        sql,args,waiting,user=SUBMIT,(source[1],transfer[1],uuid4(),'Transfer reason'),session(source),source[2]
    with psycopg.connect(source[0]) as admin, waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.network-review:'||%s,0))",(str(source[1]),))
        call=_Call(waiting,sql,args)
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change=='rate':
            admin.execute('update public.network_links set freight_cost=2 where organization_id=%s',(source[1],))
        elif change=='lane':
            admin.execute('update public.network_links set is_active=false where organization_id=%s',(source[1],))
        elif change=='location':
            admin.execute('update public.locations set is_active=false where organization_id=%s',(source[1],))
        elif change=='role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],user))
        else:
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s',(source[1],user))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate==expected
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.network_transfer_proposals where organization_id=%s and status='approved'",(source[1],)).fetchone()[0]==0


def test_terminal_retries_ignore_later_rate_changes_but_check_live_authority(transfer):
    source=transfer[0]
    args=(source[1],transfer[1],uuid4(),'Transfer reason')
    with session(source) as db:
        proposal=db.execute(SUBMIT,args).fetchone()[0]
    decision=(source[1],proposal,uuid4(),'approved','Independent review')
    with reviewer(transfer) as db:
        db.execute(DECIDE,decision)
    with psycopg.connect(source[0]) as db:
        db.execute('update public.network_links set freight_cost=2 where organization_id=%s',(source[1],))
    with session(source) as db:
        assert db.execute(SUBMIT,args).fetchone()[0]==proposal
    with reviewer(transfer) as db:
        assert db.execute(DECIDE,decision).fetchone()[0]==proposal
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],transfer[3][0]))
    with reviewer(transfer) as db, pytest.raises(psycopg.Error) as error:
        db.execute(DECIDE,decision)
    assert error.value.sqlstate=='MQ403'


def test_waiting_withdrawal_rechecks_both_endpoint_access(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (source[1], source[2]))
        db.execute('insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s', (source[2], source[1]))
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.network-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Author withdrawal'))
        call.start()
        time.sleep(0.3)
        assert not call.finished
        admin.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=(select source_location_id from public.network_transfer_proposals where id=%s)", (source[1], source[2], proposal))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ404'
    with psycopg.connect(source[0]) as db:
        assert db.execute('select status from public.network_transfer_proposals where id=%s', (proposal,)).fetchone()[0] == 'pending'


def test_independent_roles_and_author_withdrawal_after_role_change(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    for decision in ['approved', 'rejected']:
        with session(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(DECIDE, (source[1], proposal, uuid4(), decision, 'Self review'))
        assert error.value.sqlstate == 'MQ403'
    with reviewer(transfer) as db, pytest.raises(psycopg.Error) as error:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Not the author'))
    assert error.value.sqlstate == 'MQ403'
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
    with session(source) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Author remains a member'))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SUBMIT, (source[1], transfer[1], uuid4(), 'Viewer cannot submit'))
    assert error.value.sqlstate == 'MQ403'


def test_selection_revisions_leave_earlier_approval_until_another_approval(transfer):
    source = transfer[0]
    first = propose(transfer)
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], first, uuid4(), 'approved', 'First selection'))
    for status in ['withdrawn', 'rejected', 'approved']:
        proposal = propose(transfer)
        with session(source) as db:
            assert db.execute("select id from public.network_review_list where selected").fetchall() == [(first,)]
        with (session(source) if status == 'withdrawn' else reviewer(transfer)) as db:
            db.execute(DECIDE, (source[1], proposal, uuid4(), status, 'Later decision'))
    with session(source) as db:
        assert db.execute("select id from public.network_review_list where selected").fetchall() == [(proposal,)]
        assert db.execute("select revision,status from public.network_transfer_proposals order by revision").fetchall() == [
            (1, 'approved'), (2, 'withdrawn'), (3, 'rejected'), (4, 'approved')]
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.transfer_proposals where organization_id=%s", (source[1],)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (source[1],)).fetchone()[0] == 0


@pytest.mark.parametrize('path,value', [
    ('{source,lines,0,receipts,p50,timing_review_required}', 'true'),
    ('{source,lines,1,receipts,p90,timing_review_required}', 'null'),
    ('{source,lines,1,receipts,p50}', '{}'),
    ('{source,lines,1,receipts,p90,search,date}', 'null'),
])
def test_any_positive_branch_with_missing_or_flagged_timing_blocks_whole_approval(transfer, path, value):
    source = transfer[0]
    proposal = propose(transfer)
    with psycopg.connect(source[0]) as db:
        # Privileged fixture corruption tests fail-closed handling of incomplete legacy evidence.
        db.execute("update public.network_freight_estimates set report=jsonb_set(report,%s,%s::jsonb) where id=%s",
                   (path, value, transfer[1]))
    with reviewer(transfer) as db, pytest.raises(psycopg.Error) as error:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'approved', 'Timing must be clear'))
    assert error.value.sqlstate == 'MQ422'
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'rejected', 'Incomplete timing'))


def test_changed_lane_still_allows_rejection(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with psycopg.connect(source[0]) as db:
        db.execute("update public.network_links set is_active=false where organization_id=%s", (source[1],))
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'rejected', 'Lane no longer applies'))


@pytest.mark.parametrize('operation', ['submit', 'approve', 'withdraw'])
@pytest.mark.parametrize('change', ['role', 'membership'])
def test_row_wait_rechecks_live_authority(transfer, operation, change):
    source = transfer[0]
    proposal = propose(transfer) if operation != 'submit' else None
    user = transfer[3][0] if operation == 'approve' else source[2]
    sql = SUBMIT if operation == 'submit' else DECIDE
    args = (source[1], transfer[1], uuid4(), 'Reason') if operation == 'submit' else (
        source[1], proposal, uuid4(), 'approved' if operation == 'approve' else 'withdrawn', 'Reason')
    connection = reviewer(transfer) if operation == 'approve' else session(source)
    with psycopg.connect(source[0]) as admin, connection as waiting:
        if operation == 'submit':
            admin.execute("select id from public.network_freight_estimates where id=%s for update", (transfer[1],))
        else:
            admin.execute("select id from public.network_transfer_proposals where id=%s for update", (proposal,))
        call = _Call(waiting, sql, args)
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change == 'membership':
            admin.execute("delete from public.memberships where organization_id=%s and user_id=%s", (source[1], user))
        else:
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], user))
        admin.commit()
        call.join(timeout=15)
        # Authors keep withdrawal rights after becoming viewers, but never after losing membership.
        assert call.finished and call.sqlstate == (None if operation == 'withdraw' and change == 'role' else 'MQ403')


def test_withdrawal_row_wait_rechecks_every_location(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (source[1], source[2]))
        db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s", (source[2], source[1]))
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select id from public.network_transfer_proposals where id=%s for update", (proposal,))
        call = _Call(waiting, DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Author withdrawal'))
        call.start()
        time.sleep(.3)
        assert not call.finished
        admin.execute("""delete from public.membership_locations where organization_id=%s and user_id=%s
            and location_id=(select required_location_ids[2] from public.network_transfer_proposals where id=%s)""",
            (source[1], source[2], proposal))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ404'


def test_conflicting_request_reuse_and_required_reason(transfer):
    source = transfer[0]
    request = uuid4()
    with session(source) as db:
        proposal = db.execute(SUBMIT, (source[1], transfer[1], request, '  Reason  ')).fetchone()[0]
        assert db.execute(SUBMIT, (source[1], transfer[1], request, 'Reason')).fetchone()[0] == proposal
    for reason in ['', ' \n ', 'x' * 2001]:
        with session(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(SUBMIT, (source[1], transfer[1], uuid4(), reason))
        assert error.value.sqlstate == 'MQ422'
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SUBMIT, (source[1], transfer[1], request, 'Different reason'))
    assert error.value.sqlstate == 'MQ409'
    decision_request = uuid4()
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, decision_request, 'approved', 'Reason'))
    with reviewer(transfer) as db, pytest.raises(psycopg.Error) as error:
        db.execute(DECIDE, (source[1], proposal, decision_request, 'rejected', 'Reason'))
    assert error.value.sqlstate == 'MQ409'


def test_parent_cascade_retains_audit_without_operational_changes(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'approved', 'Planning selection'))
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.network_freight_estimates where id=%s", (transfer[1],))
        assert db.execute("select count(*) from public.network_transfer_proposals where id=%s", (proposal,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.audit_log where record_id=%s", (proposal,)).fetchone()[0] == 3


@pytest.mark.parametrize('network', ['zero'], indirect=True)
def test_zero_branches_remain_context_without_blocking_approval(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'approved', 'Complete proposal including zero branch'))
        report = db.execute("select report from public.network_freight_estimates where id=%s", (transfer[1],)).fetchone()[0]
        assert any(line['status'] == 'no_transfer_needed' for line in report['lines'])
        assert db.execute("select selected from public.network_review_list where id=%s", (proposal,)).fetchone()[0] is True


def test_zero_only_estimate_cannot_be_submitted(network):
    source, inputs, _ = network
    with psycopg.connect(source[0]) as db:
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (source[1],))
    with session(source) as db:
        report = db.execute(ALLOCATION_PREVIEW, inputs).fetchone()[0]
        allocation = db.execute(ALLOCATION_SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
        dates = db.execute(DATE_PREVIEW.replace('true', 'false'), (source[1], allocation)).fetchone()[0]
        scenario = db.execute(DATE_SAVE.replace('true', 'false'), (source[1], allocation, uuid4(), dates['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW.replace('true', 'false'), (source[1], scenario)).fetchone()[0]
        estimate = db.execute(SAVE.replace('true', 'false'), (source[1], scenario, uuid4(), report['fingerprint'])).fetchone()[0]
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SUBMIT, (source[1], estimate, uuid4(), 'Zero is not an approval proposal'))
    assert error.value.sqlstate == 'MQ422'


@pytest.mark.parametrize('new_allocation', [False, True])
def test_selection_identity_is_original_allocation_not_date_or_estimate(transfer, new_allocation):
    source = transfer[0]
    first = propose(transfer)
    with session(source) as db:
        freight = db.execute("select report from public.network_freight_estimates where id=%s", (transfer[1],)).fetchone()[0]
        allocation = freight['source']['allocation_id']
        if new_allocation:
            original = freight['source']['source']
            inputs = (source[1], [line['draft_id'] for line in original['lines']], original['source_policy_id'])
            preview = db.execute(ALLOCATION_PREVIEW, inputs).fetchone()[0]
            allocation = db.execute(ALLOCATION_SAVE, (*inputs, uuid4(), preview['fingerprint'])).fetchone()[0]
        dates = db.execute(DATE_PREVIEW.replace('2026-10-10', '2026-10-11'), (source[1], allocation)).fetchone()[0]
        scenario = db.execute(DATE_SAVE.replace('2026-10-10', '2026-10-11'),
                              (source[1], allocation, uuid4(), dates['fingerprint'])).fetchone()[0]
        preview = db.execute(PREVIEW, (source[1], scenario)).fetchone()[0]
        estimate = db.execute(SAVE, (source[1], scenario, uuid4(), preview['fingerprint'])).fetchone()[0]
    if not new_allocation:
        with session(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(SUBMIT, (source[1], estimate, uuid4(), 'Same allocation, different date'))
        assert error.value.sqlstate == 'MQ409' and error.value.diag.message_hint == 'network_pending'
    else:
        with session(source) as db:
            second = db.execute(SUBMIT, (source[1], estimate, uuid4(), 'Independent allocation')).fetchone()[0]
        with reviewer(transfer) as db:
            for proposal in [first, second]:
                db.execute(DECIDE, (source[1], proposal, uuid4(), 'approved', 'Independent planning selection'))
            assert db.execute("select count(*) from public.network_review_list where selected").fetchone()[0] == 2


def test_approval_keeps_saved_commitments_and_dates_as_of_evidence(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with psycopg.connect(source[0]) as db:
        original = db.execute("select report from public.network_freight_estimates where id=%s", (transfer[1],)).fetchone()[0]
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (source[1],))
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (source[1],))
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'approved', 'Review saved evidence'))
        assert db.execute("select report from public.network_freight_estimates where id=%s", (transfer[1],)).fetchone()[0] == original
    with psycopg.connect(source[0]) as db:
        assert db.execute("select sum(quantity) from public.stock_snapshots where organization_id=%s", (source[1],)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (source[1],)).fetchone()[0] == 0
