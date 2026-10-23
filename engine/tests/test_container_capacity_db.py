"""Capacity saves recheck measurements, authority and selection after lock waits."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session
from test_supplier_scenarios_db import scenario
from test_delivery_scenarios_db import delivery
from test_purchase_costs_db import cost
from test_purchase_review_db import purchase, SUBMIT
from test_purchase_handoffs_db import approved, HANDOFF
from test_handoff_batches_db import CREATE
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = 'select public.container_capacity_preview(%s,%s,%s,%s,true)'
SAVE = 'select public.container_capacity_save(%s,%s,%s,%s,true,%s,%s)'


@pytest.fixture
def capacity(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        batch = db.execute(CREATE, (source[1], [handoff])).fetchone()[0]
        newer = db.execute(SUBMIT, (source[1], purchase[2], uuid4(), 'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.supplier_items set shipping_weight_kg=2.5,shipping_volume_m3=0.000001,shipping_valid_from='2026-01-01' where organization_id=%s", (source[1],))
    with session(source) as db:
        report = db.execute(PREVIEW, (source[1], batch, '10', '100')).fetchone()[0]
    assert report['status'] == 'available'
    return purchase, batch, newer, report


def test_capacity_concurrent_retry_saves_one_record_and_audit(capacity):
    purchase, batch, _, report = capacity
    source = purchase[0]
    args = (source[1], batch, '10', '100', uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.container_capacity_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='container_capacity_scenarios'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('measurement','MQ409'),('unit','MQ409'),('selection','MQ409'),('role','MQ403'),('membership','MQ403'),('batch_deleted','MQ404')])
def test_capacity_rechecks_after_wait(capacity, change, expected):
    purchase, batch, newer, report = capacity
    source = purchase[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, SAVE, (source[1], batch, '10', '100', uuid4(), report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'measurement':
            admin.execute('update public.supplier_items set shipping_volume_m3=0.5 where organization_id=%s', (source[1],))
        elif change == 'unit':
            admin.execute('update public.supplier_items set unit_of_measure=null where organization_id=%s', (source[1],))
        elif change == 'selection':
            admin.execute("update public.purchase_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s", (purchase[3][0], uuid4(), newer))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1],source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1],source[2]))
        else:
            admin.execute('delete from public.purchase_handoff_batches where id=%s', (batch,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.container_capacity_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 0
