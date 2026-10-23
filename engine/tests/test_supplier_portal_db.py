"""Supplier publication/identity boundaries under concurrent authority changes."""
import time
from uuid import uuid4
import psycopg
import pytest
from test_replenishment_db import draft, session
from test_supplier_scenarios_db import scenario
from test_delivery_scenarios_db import delivery
from test_purchase_costs_db import cost
from test_purchase_review_db import purchase, reviewer, SUBMIT, DECIDE
from test_purchase_handoffs_db import approved, HANDOFF
from test_tenancy_concurrency import _Call, _race
pytestmark = pytest.mark.db
PUBLISH = 'select public.supplier_publication_publish(%s,%s,true,%s)'

@pytest.fixture
def publication(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        preview = db.execute('select public.supplier_publication_preview(%s,%s)', (source[1], handoff)).fetchone()[0]
    return purchase, handoff, preview

def test_concurrent_publication_is_one_snapshot(publication):
    purchase, handoff, preview = publication
    source = purchase[0]
    args = (source[1], handoff, preview['fingerprint'])
    with session(source) as a, session(source) as b:
        assert _race(a, b, PUBLISH, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.supplier_publications where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='supplier_publications'", (source[1],)).fetchone()[0] == 1

@pytest.mark.parametrize('change,expected',[('price','MQ409'),('selection','MQ409'),('role','MQ403'),('membership','MQ403'),('source','MQ404')])
def test_publish_rechecks_after_wait(publication,change,expected):
    purchase,handoff,preview=publication
    source=purchase[0]
    with session(source) as db:
        newer=db.execute(SUBMIT,(source[1],purchase[2],uuid4(),'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.purchase-review:'||%s,0))",(str(source[1]),))
        call=_Call(waiting,PUBLISH,(source[1],handoff,preview['fingerprint']))
        call.start();time.sleep(0.3);assert not call.finished
        if change=='price':admin.execute('update public.supplier_items set unit_price=99 where organization_id=%s',(source[1],))
        elif change=='selection':admin.execute("update public.purchase_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s",(purchase[3][0],uuid4(),newer))
        elif change=='role':admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],source[2]))
        elif change=='membership':admin.execute('delete from public.memberships where organization_id=%s and user_id=%s',(source[1],source[2]))
        else:admin.execute('delete from public.purchase_handoffs where id=%s',(handoff,))
        admin.commit();call.join(timeout=15)
        assert call.finished and call.sqlstate==expected

def test_accept_rechecks_revocation_after_wait(publication):
    purchase,_,_=publication
    source=purchase[0]
    supplier_user=uuid4()
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='owner' where organization_id=%s and user_id=%s",(source[1],source[2]))
        supplier=db.execute('select id from public.suppliers where organization_id=%s',(source[1],)).fetchone()[0]
        db.execute("insert into auth.users(id,email,email_confirmed_at) values(%s,'supplier-race@test.local',now())",(supplier_user,))
    try:
        with session(source) as db:
            grant=db.execute('select public.supplier_portal_invite(%s,%s,%s)',(source[1],supplier,'supplier-race@test.local')).fetchone()[0]['id']
        with psycopg.connect(source[0]) as admin, psycopg.connect(source[0]) as waiting:
            admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.supplier-portal:'||%s,0))",(str(source[1]),))
            waiting.execute('set local role authenticated')
            waiting.execute("select set_config('request.jwt.claims',json_build_object('sub',%s::text,'role','authenticated')::text,true)",(supplier_user,))
            call=_Call(waiting,'select public.supplier_portal_accept(%s)',(grant,))
            call.start();time.sleep(0.3);assert not call.finished
            admin.execute('update public.supplier_portal_grants set revoked_at=now(),revoked_by=%s where id=%s',(source[2],grant))
            admin.commit();call.join(timeout=15)
            assert call.finished and call.sqlstate=='MQ404'
    finally:
        with psycopg.connect(source[0]) as db:db.execute('delete from auth.users where id=%s',(supplier_user,))
