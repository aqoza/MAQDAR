"""Independent event price arithmetic, real source chain and post-lock authorization."""
import time
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

import psycopg
import pytest

from test_event_deliveries_db import (
    event_delivery, event_supplier, event_draft, policy_event, event, planning,
    saved_forecast, enqueue_policy, worker,
)
from test_event_deliveries_db import test_real_worker_chain_through_delivery as build_real_delivery_chain
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = 'select public.event_purchase_cost_preview(%s,%s,true)'
SAVE = 'select public.event_purchase_cost_save(%s,%s,true,%s,%s)'


@pytest.fixture
def event_cost(event_delivery):
    source, scenario, report = event_delivery
    with session(source) as db:
        delivery = db.execute("select public.event_delivery_save(%s,%s,'2026-10-10',true,%s,%s)", (source[1], scenario, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.supplier_items set unit_price=1.234,valid_from='2026-10-10' where organization_id=%s", (source[1],))
    with session(source) as db:
        preview = db.execute(PREVIEW, (source[1], delivery)).fetchone()[0]
        assert preview['status'] == 'available' and preview['source'] == report
    return source, delivery, preview


def test_event_cost_parallel_retries(event_cost):
    source, delivery, report = event_cost
    args = (source[1], delivery, uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select report from public.event_purchase_cost_estimates where organization_id=%s', (source[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_purchase_cost_estimates'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [
    ('role','MQ403'),('membership','MQ403'),('price','MQ409'),('unit','MQ409'),
    ('date','MQ409'),('currency','MQ409'),('supplier','MQ409'),('receiver','MQ409'),
    ('source','MQ409'),('deleted','MQ404'),
])
def test_event_cost_rechecks_after_wait(event_cost, change, expected):
    source, delivery, report = event_cost
    request = uuid4()
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-cost:'||%s||':'||%s,0))", (str(source[1]),str(request)))
        call = _Call(waiting, SAVE, (source[1], delivery, request, report['fingerprint']))
        call.start(); time.sleep(1)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1],source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1],source[2]))
        elif change == 'price':
            admin.execute('update public.supplier_items set unit_price=2 where organization_id=%s', (source[1],))
        elif change == 'unit':
            admin.execute("update public.supplier_items set unit_of_measure='SET' where organization_id=%s", (source[1],))
        elif change == 'date':
            admin.execute("update public.supplier_items set valid_from='2026-11-01' where organization_id=%s", (source[1],))
        elif change == 'currency':
            admin.execute("update public.supplier_items set currency='KWD' where organization_id=%s", (source[1],))
        elif change == 'supplier':
            admin.execute('update public.suppliers set is_active=false where organization_id=%s', (source[1],))
        elif change == 'receiver':
            admin.execute('update public.locations set is_active=false where organization_id=%s', (source[1],))
        elif change == 'source':
            admin.execute("update public.event_delivery_scenarios set report=report||'{\"changed\":true}'::jsonb where id=%s", (delivery,))
        else:
            admin.execute('delete from public.event_delivery_scenarios where id=%s', (delivery,))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_cost_estimates where organization_id=%s', (source[1],)).fetchone()[0] == 0


@pytest.mark.parametrize('currency,quantum', [('SAR','0.01'),('KWD','0.001')])
def test_real_worker_chain_through_costs(planning, currency, quantum):
    build_real_delivery_chain(planning)
    with psycopg.connect(planning[0]) as db:
        delivery, source = db.execute('select id,report from public.event_delivery_scenarios where organization_id=%s', (planning[1],)).fetchone()
        db.execute('update public.supplier_items set unit_price=1.235,valid_from=%s,currency=%s where organization_id=%s', (source['order_date'],currency,planning[1]))
    with session(planning) as db:
        report = db.execute(PREVIEW, (planning[1],delivery)).fetchone()[0]
        assert report['status'] == 'available' and report['source'] == source
        totals = {}
        for side in ['baseline','adjusted']:
            product = Decimal(source['source'][side]['quantity']) * Decimal('1.235')
            totals[side] = product.quantize(Decimal(quantum), rounding=ROUND_HALF_UP)
            assert Decimal(report[side]['exact_product']) == product
            assert Decimal(report[side]['subtotal']) == totals[side]
        assert Decimal(report['cost_increase']) == totals['adjusted'] - totals['baseline']
        assert db.execute(SAVE, (planning[1],delivery,uuid4(),report['fingerprint'])).fetchone()[0]
