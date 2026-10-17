"""Live rate, authority and concurrency checks across independent database sessions."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft as base_draft, session
from test_redistribution_db import redistribution  # noqa: F401
from test_transfer_dates_db import dates  # noqa: F401
from test_transfer_freight_db import freight, SAVE  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SUBMIT = 'select public.transfer_proposal_submit(%s,%s,%s,%s)'
DECIDE = 'select public.transfer_proposal_decide(%s,%s,%s,%s,%s)'


@pytest.fixture
def draft(base_draft):
    # Set the policy horizon before the real quantity/date/freight pipeline runs.
    with psycopg.connect(base_draft[0]) as db:
        db.execute("update public.inventory_policies set evidence=jsonb_set(evidence,'{options,lead_time}','10') where organization_id=%s", (base_draft[1],))
    return base_draft


@pytest.fixture
def transfer(freight):
    source, inputs, report = freight
    assert all(report['source']['receipts'][p]['timing_review_required'] is False for p in ['p50','p90'])
    with session(source) as db:
        estimate = db.execute(SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
        alternate = db.execute(SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    users = [uuid4(), uuid4()]
    with psycopg.connect(source[0]) as db:
        for user in users:
            db.execute('insert into auth.users(id,email) values(%s,%s)', (user, f'transfer-review-{user}@test.local'))
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
        assert db.execute('select count(*) from public.transfer_proposals where organization_id=%s',(source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='transfer_proposals'",(source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('replay', [False, True])
def test_competing_decisions_and_replay(transfer, replay):
    proposal=propose(transfer)
    args=(transfer[0][1],proposal,uuid4(),'approved','Independent review')
    with reviewer(transfer) as first, reviewer(transfer,0 if replay else 1) as second:
        result=_race(first,second,DECIDE,args,args if replay else (transfer[0][1],proposal,uuid4(),'rejected','Alternative'))
        assert result.sqlstate == (None if replay else 'MQ409')
    with psycopg.connect(transfer[0][0]) as db:
        assert db.execute('select status,decided_by from public.transfer_proposals where id=%s',(proposal,)).fetchone() == ('approved',transfer[3][0])
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
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.transfer-review:'||%s,0))",(str(source[1]),))
        call=_Call(waiting,sql,args)
        call.start()
        time.sleep(1)
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
        assert db.execute("select count(*) from public.transfer_proposals where organization_id=%s and status='approved'",(source[1],)).fetchone()[0]==0


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
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.transfer-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, DECIDE, (source[1], proposal, uuid4(), 'withdrawn', 'Author withdrawal'))
        call.start()
        time.sleep(0.3)
        assert not call.finished
        admin.execute("delete from public.membership_locations where organization_id=%s and user_id=%s and location_id=(select source_location_id from public.transfer_proposals where id=%s)", (source[1], source[2], proposal))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ404'
    with psycopg.connect(source[0]) as db:
        assert db.execute('select status from public.transfer_proposals where id=%s', (proposal,)).fetchone()[0] == 'pending'
