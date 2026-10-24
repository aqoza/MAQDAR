"""Event publication races retain live authority, pricing gates and one immutable copy."""
import time
from uuid import uuid4
import psycopg
import pytest
from test_event_purchase_handoffs_db import approved, purchase, propose, reviewer, SUBMIT, DECIDE, event_cost, event_delivery, event_supplier, event_draft, policy_event, event, planning, saved_forecast, enqueue_policy, worker, HANDOFF
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race
pytestmark = pytest.mark.db
PUBLISH = 'select public.supplier_event_batch_publication_publish(%s,%s,true,%s)'

@pytest.fixture
def publication(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        handoff = db.execute('select public.event_purchase_handoff_batch_create(%s,%s::uuid[])', (source[1], [handoff])).fetchone()[0]
        preview = db.execute('select public.supplier_event_batch_publication_preview(%s,%s)', (source[1], handoff)).fetchone()[0]
    return purchase, handoff, preview

def test_concurrent_publication_keeps_one_snapshot_and_audit(publication):
    purchase, handoff, preview = publication
    source = purchase[0]
    args = (source[1], handoff, preview['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, PUBLISH, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.supplier_event_batch_publications where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='supplier_event_batch_publications'", (source[1],)).fetchone()[0] == 1

@pytest.mark.parametrize('change,expected', [('price','MQ409'),('selection','MQ409'),('role','MQ403'),('membership','MQ403'),('source','MQ404'),('supplier','MQ409'),('receiver','MQ409'),('unit','MQ409'),('identity','MQ409')])
def test_publication_rechecks_after_lock_wait(publication, change, expected):
    purchase, handoff, preview = publication
    source = purchase[0]
    with session(source) as db:
        newer = db.execute(SUBMIT, (source[1], purchase[2], uuid4(), 'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, PUBLISH, (source[1], handoff, preview['fingerprint']))
        call.start(); time.sleep(.3); assert not call.finished
        if change == 'price': admin.execute('update public.supplier_items set unit_price=9 where organization_id=%s', (source[1],))
        elif change == 'selection': admin.execute("update public.event_purchase_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s", (purchase[3][0],uuid4(),newer))
        elif change == 'role': admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1],source[2]))
        elif change == 'membership': admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1],source[2]))
        elif change == 'supplier': admin.execute('update public.suppliers set is_active=false where organization_id=%s', (source[1],))
        elif change == 'receiver': admin.execute('update public.locations set is_active=false where organization_id=%s', (source[1],))
        elif change == 'unit': admin.execute("update public.supplier_items set unit_of_measure='EA' where organization_id=%s", (source[1],))
        elif change == 'identity': admin.execute('update public.supplier_items set id=%s where organization_id=%s', (uuid4(),source[1]))
        else: admin.execute('delete from public.event_purchase_handoff_batches where id=%s', (handoff,))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.supplier_event_batch_publications where organization_id=%s', (source[1],)).fetchone()[0] == 0

@pytest.mark.parametrize('change', ['price','supplier','receiver'])
def test_changed_rows_while_waiting_for_row_lock_refuse_publication(publication, change):
    purchase, handoff, preview = publication
    source = purchase[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        if change == 'price': admin.execute('update public.supplier_items set unit_price=9 where organization_id=%s', (source[1],))
        else: admin.execute('update public.' + ('suppliers' if change == 'supplier' else 'locations') + ' set is_active=false where organization_id=%s', (source[1],))
        call = _Call(waiting,PUBLISH,(source[1],handoff,preview['fingerprint']))
        call.start(); time.sleep(.3); assert not call.finished
        admin.commit();call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'

@pytest.mark.parametrize('change', ['price', 'deleted_member'])
def test_second_member_is_revalidated_after_wait(dsn, change):
    from supplier_event_batch_fixture import seed_supplier_event_batch
    owner, prefix = uuid4(), uuid4().hex[:8]
    with psycopg.connect(dsn) as db:
        db.execute('insert into auth.users(id,email) values(%s,%s)',(owner,f'batch-{owner}@test.local'))
        f = seed_supplier_event_batch(db,owner,prefix)
    source = (dsn,f['org'],owner)
    try:
        with session(source) as db:
            preview = db.execute('select public.supplier_event_batch_publication_preview(%s,%s)',(f['org'],f['batch'])).fetchone()[0]
        with psycopg.connect(dsn) as admin, session(source) as waiting:
            if change == 'price':
                admin.execute("update public.supplier_items set unit_price=9 where organization_id=%s and item_id=%s",(f['org'],f'{prefix}-0000-4000-8000-000000010001'))
            else:
                admin.execute('delete from public.event_purchase_handoffs where id=%s',(f['second'],))
            call = _Call(waiting,PUBLISH,(f['org'],f['batch'],preview['fingerprint']))
            call.start();time.sleep(.3);assert not call.finished
            admin.commit();call.join(timeout=15)
            assert call.finished and call.sqlstate == ('MQ409' if change == 'price' else 'MQ404')
        with psycopg.connect(dsn) as db:
            assert db.execute('select count(*) from public.supplier_event_batch_publications where organization_id=%s',(f['org'],)).fetchone()[0] == 0
    finally:
        with psycopg.connect(dsn) as db:
            db.execute('delete from public.organizations where id=any(%s::uuid[])',([f['org'],f['other']],))
            db.execute('delete from auth.users where id=%s or id::text like %s',(owner,prefix+'-0000-4000-8000-%'))
            db.execute('delete from public.audit_log where organization_id=any(%s::uuid[])',([f['org'],f['other']],))
