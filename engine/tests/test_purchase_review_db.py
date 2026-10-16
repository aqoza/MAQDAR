"""Live price, authority and concurrency checks across independent database sessions."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session
from test_supplier_scenarios_db import scenario
from test_delivery_scenarios_db import delivery
from test_purchase_costs_db import cost, preview, SAVE
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SUBMIT = 'select public.purchase_proposal_submit(%s,%s,%s,%s)'
DECIDE = 'select public.purchase_proposal_decide(%s,%s,%s,%s,%s)'


@pytest.fixture
def purchase(cost):
    source, delivery_id = cost
    report = preview(cost)
    assert report['source']['policy_recalculation_required'] is False
    with session(source) as db:
        estimate = db.execute(SAVE, (source[1], delivery_id, uuid4(), report['fingerprint'])).fetchone()[0]
        alternate = db.execute(SAVE, (source[1], delivery_id, uuid4(), report['fingerprint'])).fetchone()[0]
    users = [uuid4(), uuid4()]
    with psycopg.connect(source[0]) as db:
        for user in users:
            db.execute('insert into auth.users(id,email) values(%s,%s)', (user, f'purchase-{user}@test.local'))
            db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')", (source[1],user))
    yield source, estimate, alternate, users
    with psycopg.connect(source[0]) as db:
        db.execute('delete from auth.users where id=any(%s)', (users,))


def reviewer(purchase, index=0):
    source = purchase[0]
    return session((source[0], source[1], purchase[3][index], source[3]))


def propose(purchase):
    with session(purchase[0]) as db:
        return db.execute(SUBMIT,(purchase[0][1],purchase[1],uuid4(),'Purchase reason')).fetchone()[0]


@pytest.mark.parametrize('replay', [False, True])
def test_pending_across_estimates_and_submission_replay(purchase, replay):
    source, estimate, alternate, _ = purchase
    first_args = (source[1],estimate,uuid4(),'Purchase reason')
    second_args = first_args if replay else (source[1],alternate,uuid4(),'Alternative estimate')
    with session(source) as first, session(source) as second:
        assert _race(first,second,SUBMIT,first_args,second_args).sqlstate == (None if replay else 'MQ409')
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.purchase_proposals where organization_id=%s',(source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='purchase_proposals'",(source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('replay', [False, True])
def test_competing_decisions_and_replay(purchase, replay):
    proposal=propose(purchase)
    args=(purchase[0][1],proposal,uuid4(),'approved','Independent review')
    with reviewer(purchase) as first, reviewer(purchase,0 if replay else 1) as second:
        result=_race(first,second,DECIDE,args,args if replay else (purchase[0][1],proposal,uuid4(),'rejected','Alternative'))
        assert result.sqlstate == (None if replay else 'MQ409')
    with psycopg.connect(purchase[0][0]) as db:
        assert db.execute('select status,decided_by from public.purchase_proposals where id=%s',(proposal,)).fetchone() == ('approved',purchase[3][0])
        assert db.execute('select count(*) from public.audit_log where record_id=%s',(proposal,)).fetchone()[0] == 2


@pytest.mark.parametrize('operation', ['submit','approve'])
@pytest.mark.parametrize('change,expected', [('price','MQ409'),('role','MQ403'),('membership','MQ403')])
def test_rechecks_after_lock_wait(purchase, operation, change, expected):
    source=purchase[0]
    if operation=='approve':
        proposal=propose(purchase)
        sql,args,waiting,user=DECIDE,(source[1],proposal,uuid4(),'approved','Reviewed'),reviewer(purchase),purchase[3][0]
    else:
        sql,args,waiting,user=SUBMIT,(source[1],purchase[1],uuid4(),'Purchase reason'),session(source),source[2]
    with psycopg.connect(source[0]) as admin, waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.purchase-review:'||%s,0))",(str(source[1]),))
        call=_Call(waiting,sql,args)
        call.start()
        time.sleep(1)
        assert not call.finished
        if change=='price':
            admin.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(source[1],))
        elif change=='role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],user))
        else:
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s',(source[1],user))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate==expected
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.purchase_proposals where organization_id=%s and status='approved'",(source[1],)).fetchone()[0]==0


def test_terminal_retries_ignore_later_price_changes_but_check_live_authority(purchase):
    source=purchase[0]
    args=(source[1],purchase[1],uuid4(),'Purchase reason')
    with session(source) as db:
        proposal=db.execute(SUBMIT,args).fetchone()[0]
    decision=(source[1],proposal,uuid4(),'approved','Independent review')
    with reviewer(purchase) as db:
        db.execute(DECIDE,decision)
    with psycopg.connect(source[0]) as db:
        db.execute('update public.supplier_items set unit_price=2 where organization_id=%s',(source[1],))
    with session(source) as db:
        assert db.execute(SUBMIT,args).fetchone()[0]==proposal
    with reviewer(purchase) as db:
        assert db.execute(DECIDE,decision).fetchone()[0]==proposal
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],purchase[3][0]))
    with reviewer(purchase) as db, pytest.raises(psycopg.Error) as error:
        db.execute(DECIDE,decision)
    assert error.value.sqlstate=='MQ403'
