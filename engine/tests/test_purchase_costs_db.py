"""Concurrent retries and live price/authority checks for saved cost estimates."""
import time
from uuid import uuid4
import psycopg
import pytest
from test_replenishment_db import draft, session
from test_supplier_scenarios_db import scenario
from test_delivery_scenarios_db import delivery, preview as delivery_preview, SAVE as DELIVERY_SAVE
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.purchase_cost_preview(%s,%s,true)"
SAVE = "select public.purchase_cost_save(%s,%s,true,%s,%s)"

@pytest.fixture
def cost(delivery):
    source, scenario_id = delivery
    report = delivery_preview(delivery)
    with session(source) as db:
        delivery_id = db.execute(DELIVERY_SAVE, (source[1], scenario_id, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.supplier_items set unit_price=1.005,valid_from='2026-10-10' where organization_id=%s", (source[1],))
    return source, delivery_id

def preview(cost):
    with session(cost[0]) as db:
        report = db.execute(PREVIEW, (cost[0][1], cost[1])).fetchone()[0]
        assert report['status'] == 'available'
        return report

def test_cost_parallel_retries(cost):
    source, delivery_id = cost
    report = preview(cost)
    args = (source[1], delivery_id, uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select report from public.purchase_cost_estimates where organization_id=%s', (source[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='purchase_cost_estimates'", (source[1],)).fetchone()[0] == 1

@pytest.mark.parametrize('change,expected', [('price', 'MQ409'), ('role', 'MQ403')])
def test_cost_rechecks_after_lock_wait(cost, change, expected):
    source, delivery_id = cost
    report = preview(cost)
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.purchase-cost:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, SAVE, (source[1], delivery_id, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'price':
            admin.execute('update public.supplier_items set unit_price=2 where organization_id=%s', (source[1],))
        else:
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.purchase_cost_estimates where organization_id=%s', (source[1],)).fetchone()[0] == 0
