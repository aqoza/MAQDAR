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
PUBLISH = 'select public.supplier_batch_publication_publish(%s,%s,true,%s)'

@pytest.fixture
def publication(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        batch = db.execute('select public.purchase_handoff_batch_create(%s,%s::uuid[])', (source[1], [handoff])).fetchone()[0]
        preview = db.execute('select public.supplier_batch_publication_preview(%s,%s)', (source[1], batch)).fetchone()[0]
    return purchase, batch, preview

def test_concurrent_publication_is_one_snapshot(publication):
    purchase, batch, preview = publication
    source = purchase[0]
    args = (source[1], batch, preview['fingerprint'])
    with session(source) as a, session(source) as b:
        assert _race(a, b, PUBLISH, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.supplier_batch_publications where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='supplier_batch_publications'", (source[1],)).fetchone()[0] == 1

@pytest.mark.parametrize('change,expected',[('price','MQ409'),('selection','MQ409'),('role','MQ403'),('membership','MQ403'),('source','MQ404')])
def test_publish_rechecks_after_wait(publication,change,expected):
    purchase,batch,preview=publication
    source=purchase[0]
    with session(source) as db:
        newer=db.execute(SUBMIT,(source[1],purchase[2],uuid4(),'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.purchase-review:'||%s,0))",(str(source[1]),))
        call=_Call(waiting,PUBLISH,(source[1],batch,preview['fingerprint']))
        call.start();time.sleep(0.3);assert not call.finished
        if change=='price':admin.execute('update public.supplier_items set unit_price=99 where organization_id=%s',(source[1],))
        elif change=='selection':admin.execute("update public.purchase_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s",(purchase[3][0],uuid4(),newer))
        elif change=='role':admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],source[2]))
        elif change=='membership':admin.execute('delete from public.memberships where organization_id=%s and user_id=%s',(source[1],source[2]))
        else:admin.execute('delete from public.purchase_handoffs where organization_id=%s',(source[1],))
        admin.commit();call.join(timeout=15)
        assert call.finished and call.sqlstate==expected
