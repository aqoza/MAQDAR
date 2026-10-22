"""Live rate, authority and concurrency checks across independent database sessions."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import session
from regional_freight_fixture import seed_regional_freight
from psycopg.types.json import Jsonb
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = 'select public.regional_freight_save(%s,%s,true,%s,%s)'
SUBMIT = 'select public.regional_transfer_submit(%s,%s,%s,%s)'
DECIDE = 'select public.regional_transfer_decide(%s,%s,%s,%s,%s)'


@pytest.fixture
def transfer(dsn, request):
    org, user = uuid4(), uuid4()
    users = [uuid4(), uuid4()]
    options = getattr(request, 'param', {})
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Regional review')", (org, f'regional-review-{org}'))
        for actor, role in [(user, 'planner'), *[(u, 'approver') for u in users]]:
            db.execute('insert into auth.users(id,email) values(%s,%s)', (actor, f'regional-review-{actor}@test.local'))
            db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)', (org, actor, role))
        parent, report = seed_regional_freight(db, org, user, policy_lead=10, **options)
        db.execute('set local role authenticated')
        estimate = db.execute(SAVE, (org, parent, uuid4(), report['fingerprint'])).fetchone()[0]
        alternate = db.execute(SAVE, (org, parent, uuid4(), report['fingerprint'])).fetchone()[0]
    yield (dsn, org, user, None), estimate, alternate, users
    with psycopg.connect(dsn) as db:
        db.execute('delete from public.organizations where id=%s', (org,))
        db.execute('delete from auth.users where id=any(%s)', ([user, *users],))
        db.execute('delete from public.audit_log where organization_id=%s', (org,))


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
        assert db.execute('select count(*) from public.regional_transfer_proposals where organization_id=%s',(source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='regional_transfer_proposals'",(source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('replay', [False, True])
def test_competing_decisions_and_replay(transfer, replay):
    proposal=propose(transfer)
    args=(transfer[0][1],proposal,uuid4(),'approved','Independent review')
    with reviewer(transfer) as first, reviewer(transfer,0 if replay else 1) as second:
        result=_race(first,second,DECIDE,args,args if replay else (transfer[0][1],proposal,uuid4(),'rejected','Alternative'))
        assert result.sqlstate == (None if replay else 'MQ409')
    with psycopg.connect(transfer[0][0]) as db:
        assert db.execute('select status,decided_by from public.regional_transfer_proposals where id=%s',(proposal,)).fetchone() == ('approved',transfer[3][0])
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
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.regional-review:'||%s,0))",(str(source[1]),))
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
        assert db.execute("select count(*) from public.regional_transfer_proposals where organization_id=%s and status='approved'",(source[1],)).fetchone()[0]==0


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
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.regional-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Author withdrawal'))
        call.start()
        time.sleep(0.3)
        assert not call.finished
        admin.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=(select required_location_ids[1] from public.regional_transfer_proposals where id=%s)", (source[1], source[2], proposal))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ404'
    with psycopg.connect(source[0]) as db:
        assert db.execute('select status from public.regional_transfer_proposals where id=%s', (proposal,)).fetchone()[0] == 'pending'


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
            assert db.execute("select id from public.regional_review_list where selected").fetchall() == [(first,)]
        with (session(source) if status == 'withdrawn' else reviewer(transfer)) as db:
            db.execute(DECIDE, (source[1], proposal, uuid4(), status, 'Later decision'))
    with session(source) as db:
        assert db.execute("select id from public.regional_review_list where selected").fetchall() == [(proposal,)]
        assert db.execute("select revision,status from public.regional_transfer_proposals order by revision").fetchall() == [
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
        db.execute("update public.regional_freight_estimates set report=jsonb_set(report,%s,%s::jsonb) where id=%s",
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
            admin.execute("select id from public.regional_freight_estimates where id=%s for update", (transfer[1],))
        else:
            admin.execute("select id from public.regional_transfer_proposals where id=%s for update", (proposal,))
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
        admin.execute("select id from public.regional_transfer_proposals where id=%s for update", (proposal,))
        call = _Call(waiting, DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Author withdrawal'))
        call.start()
        time.sleep(.3)
        assert not call.finished
        admin.execute("""delete from public.membership_locations where organization_id=%s and user_id=%s
            and location_id=(select required_location_ids[2] from public.regional_transfer_proposals where id=%s)""",
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
        db.execute("delete from public.regional_freight_estimates where id=%s", (transfer[1],))
        assert db.execute("select count(*) from public.regional_transfer_proposals where id=%s", (proposal,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.audit_log where record_id=%s", (proposal,)).fetchone()[0] == 3


@pytest.mark.parametrize('transfer', [{'source_a_quantity':'22'}], indirect=True)
def test_zero_sources_remain_context_without_receipt_gates(transfer):
    proposal = propose(transfer)
    with reviewer(transfer) as db:
        db.execute(DECIDE, (transfer[0][1], proposal, uuid4(), 'approved', 'Including zero source'))
        report = db.execute('select report from public.regional_freight_estimates where id=%s', (transfer[1],)).fetchone()[0]
        assert any(line['status']=='no_transfer_needed' for line in report['lines'])
        assert db.execute('select selected from public.regional_review_list where id=%s', (proposal,)).fetchone()[0]


@pytest.mark.parametrize('transfer', [{'source_a_quantity':'22', 'source_b_quantity':'22'}], indirect=True)
def test_zero_only_estimate_cannot_be_submitted(transfer):
    with session(transfer[0]) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SUBMIT, (transfer[0][1], transfer[1], uuid4(), 'No transfer'))
    assert error.value.sqlstate == 'MQ422'


def test_approval_keeps_saved_commitments_and_dates_as_of_evidence(transfer):
    source = transfer[0]
    proposal = propose(transfer)
    with psycopg.connect(source[0]) as db:
        original = db.execute("select report from public.regional_freight_estimates where id=%s", (transfer[1],)).fetchone()[0]
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (source[1],))
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (source[1],))
    with reviewer(transfer) as db:
        db.execute(DECIDE, (source[1], proposal, uuid4(), 'approved', 'Review saved evidence'))
        assert db.execute("select report from public.regional_freight_estimates where id=%s", (transfer[1],)).fetchone()[0] == original
    with psycopg.connect(source[0]) as db:
        assert db.execute("select sum(quantity) from public.stock_snapshots where organization_id=%s", (source[1],)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (source[1],)).fetchone()[0] == 0


@pytest.mark.parametrize('operation', ['submit', 'approve'])
@pytest.mark.parametrize('row', ['region', 'location', 'lane'])
def test_archive_while_waiting_prevents_new_review(transfer, operation, row):
    source=transfer[0]
    proposal=propose(transfer) if operation=='approve' else None
    with psycopg.connect(source[0]) as admin, (reviewer(transfer) if operation=='approve' else session(source)) as waiting:
        report=admin.execute('select report from public.regional_freight_estimates where id=%s',(transfer[1],)).fetchone()[0]
        region=report['source']['source']['region']['id']
        if row=='region':
            admin.execute('select id from public.stock_regions where id=%s for update',(region,))
        elif row=='location':
            admin.execute('select id from public.locations where organization_id=%s order by id for update',(source[1],))
        else:
            admin.execute('select id from public.network_links where organization_id=%s order by id for update',(source[1],))
        args=(source[1],transfer[1],uuid4(),'Reason') if operation=='submit' else (source[1],proposal,uuid4(),'approved','Reviewed')
        call=_Call(waiting,SUBMIT if operation=='submit' else DECIDE,args)
        call.start();time.sleep(.3)
        assert not call.finished
        if row=='lane':
            # Lane wait holds region share, so mutate this lane rather than invert the lock order.
            admin.execute('update public.network_links set freight_cost=7 where organization_id=%s',(source[1],))
        else:
            admin.execute('update public.stock_regions set archived_at=now(),archived_by=%s where id=%s',(source[2],region))
        admin.commit();call.join(timeout=15)
        assert call.finished and call.sqlstate==('MQ409' if row=='lane' else 'MQ404')


@pytest.mark.parametrize('decision', ['rejected','withdrawn'])
@pytest.mark.parametrize('change', ['archive','delete_region','freight'])
def test_rejection_and_withdrawal_remain_available_after_evidence_changes(transfer,decision,change):
    source=transfer[0]; proposal=propose(transfer)
    with psycopg.connect(source[0]) as db:
        if change=='archive': db.execute('update public.stock_regions set archived_at=now(),archived_by=%s where organization_id=%s',(source[2],source[1]))
        elif change=='delete_region': db.execute('delete from public.stock_regions where organization_id=%s',(source[1],))
        else: db.execute('update public.network_links set is_active=false where organization_id=%s',(source[1],))
    with (session(source) if decision=='withdrawn' else reviewer(transfer)) as db:
        args=(source[1],proposal,uuid4(),decision,'No longer applicable')
        assert db.execute(DECIDE,args).fetchone()[0]==proposal
        assert db.execute(DECIDE,args).fetchone()[0]==proposal
        assert db.execute('select count(*) from public.regional_review_list').fetchone()[0]==1


@pytest.mark.parametrize('independent', [False, True])
def test_selection_is_scoped_to_original_sourcing_not_estimate(transfer,independent):
    source=transfer[0]; first=propose(transfer)
    with session(source) as db:
        original=db.execute('select report from public.regional_freight_estimates where id=%s',(transfer[1],)).fetchone()[0]
        sourcing=original['source']['sourcing_id']
        if independent:
            inputs=db.execute("select report->'input' from public.regional_sourcing_scenarios where id=%s",(sourcing,)).fetchone()[0]
            preview=db.execute('select public.regional_sourcing_preview(%s,%s)',(source[1],Jsonb(inputs))).fetchone()[0]
            sourcing=db.execute('select public.regional_sourcing_save(%s,%s,%s,%s)',(source[1],Jsonb(inputs),uuid4(),preview['fingerprint'])).fetchone()[0]
        dates=db.execute("select public.regional_date_preview(%s,%s,'2026-10-11',true)",(source[1],sourcing)).fetchone()[0]
        scenario=db.execute("select public.regional_date_save(%s,%s,'2026-10-11',true,%s,%s)",(source[1],sourcing,uuid4(),dates['fingerprint'])).fetchone()[0]
        preview=db.execute('select public.regional_freight_preview(%s,%s,true)',(source[1],scenario)).fetchone()[0]
        estimate=db.execute(SAVE,(source[1],scenario,uuid4(),preview['fingerprint'])).fetchone()[0]
    if not independent:
        with session(source) as db,pytest.raises(psycopg.Error) as error: db.execute(SUBMIT,(source[1],estimate,uuid4(),'Same sourcing'))
        assert error.value.sqlstate=='MQ409'
    else:
        with session(source) as db: second=db.execute(SUBMIT,(source[1],estimate,uuid4(),'Independent sourcing')).fetchone()[0]
        with reviewer(transfer) as db:
            for proposal in [first,second]: db.execute(DECIDE,(source[1],proposal,uuid4(),'approved','Selected'))
            assert db.execute('select count(*) from public.regional_review_list where selected').fetchone()[0]==2
