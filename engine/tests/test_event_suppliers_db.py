"""Independent-session authority and supplier-evidence races for event scenarios."""
import time
from decimal import Decimal, ROUND_CEILING
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb
import pytest
from test_event_replenishment_db import event_draft, policy_event, event, planning, saved_forecast, enqueue_policy, worker
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race
from zeespare_engine.worker import process_one
pytestmark = pytest.mark.db
PREVIEW = "select public.event_supplier_preview(%s,%s,'SUP',true)"
SAVE = "select public.event_supplier_save(%s,%s,'SUP',true,%s,%s)"
DRAFT_SAVE = "select public.event_replenishment_save(%s,%s,'0',true,true,%s,%s)"

@pytest.fixture
def event_supplier(event_draft):
    source, scenario, draft_report = event_draft
    with session(source) as db:
        draft = db.execute(DRAFT_SAVE, (source[1], scenario, uuid4(), draft_report['fingerprint'])).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        supplier = uuid4()
        item = draft_report['scenario']['event']['source']['item_id']
        lead = draft_report['scenario']['policy']['evidence']['options']['lead_time']
        db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'SUP','Supplier','SA','SAR',1,1)", (supplier, source[1]))
        db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure) values(%s,%s,%s,%s,2,1.5,1,'SAR','EA')", (source[1], supplier, item, lead))
    with session(source) as db:
        report = db.execute(PREVIEW, (source[1], draft)).fetchone()[0]
        assert report['status'] == 'available'
    yield (source, draft, report)

def test_supplier_retries_save_one_record(event_supplier):
    source, draft, report = event_supplier
    args = (source[1], draft, uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select report from public.event_supplier_scenarios where organization_id=%s', (source[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_supplier_scenarios'", (source[1],)).fetchone()[0] == 1

@pytest.mark.parametrize('change,expected', [('role', 'MQ403'), ('membership', 'MQ403'), ('terms', 'MQ409'), ('supplier', 'MQ409'), ('draft', 'MQ409'), ('deleted', 'MQ404')])
def test_supplier_rechecks_after_wait(event_supplier, change, expected):
    source, draft, report = event_supplier
    request = uuid4()
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-supplier:'||%s||':'||%s,0))", (str(source[1]), str(request)))
        call = _Call(waiting, SAVE, (source[1], draft, request, report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        elif change == 'terms':
            admin.execute('update public.supplier_items set pack_size=2 where organization_id=%s', (source[1],))
        elif change == 'supplier':
            admin.execute('update public.suppliers set is_active=false where organization_id=%s', (source[1],))
        elif change == 'draft':
            admin.execute('update public.event_replenishment_drafts set report=report||\'{"changed":true}\'::jsonb where id=%s', (draft,))
        else:
            admin.execute('delete from public.event_replenishment_drafts where id=%s', (draft,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_supplier_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 0

def test_real_worker_chain_through_supplier(planning):
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.demand_history set unit_of_measure='EA' where organization_id=%s", (planning[1],))
    forecast = saved_forecast(planning)
    run = enqueue_policy(planning, forecast)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        policy, maximum, item, location, cutoff = db.execute("select id,summary#>>'{protection,target}',item_id,location_id,(evidence#>>'{forecast,to_date}')::date from public.inventory_policies where run_id=%s", (run,)).fetchone()
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,%s,0,0,1,'SAR','EA')", (planning[1], item, location, cutoff))
    with session(planning) as db:
        args = (planning[1], forecast, 'recall', 'Service campaign', 'Fixed incremental demand', 'EA', Jsonb([dict(date='2026-10-02', quantity='2.001')]), True)
        preview = db.execute('select public.planned_event_preview(%s,%s,%s,%s,%s,%s,%s,%s)', args).fetchone()[0]
        event_id = db.execute('select public.planned_event_save(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)', (*args, uuid4(), preview['fingerprint'])).fetchone()[0]
        comparison = db.execute("select public.event_policy_preview(%s,%s,%s,'Fixed event comparison')", (planning[1], event_id, policy)).fetchone()[0]
        scenario = db.execute("select public.event_policy_save(%s,%s,%s,'Fixed event comparison',%s,%s)", (planning[1], event_id, policy, uuid4(), comparison['fingerprint'])).fetchone()[0]
        report = db.execute("select public.event_replenishment_preview(%s,%s,'0',true,true)", (planning[1], scenario)).fetchone()[0]
        assert report['status'] == 'available'
        assert Decimal(report['baseline_gap']) == Decimal(maximum)
        assert Decimal(report['adjusted_gap']) == Decimal(maximum) + Decimal('2.001')
        assert report['gap_increase'] == '2.001'
        draft = db.execute(DRAFT_SAVE, (planning[1], scenario, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        supplier = uuid4()
        lead = report['scenario']['policy']['evidence']['options']['lead_time']
        db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'SUP','Supplier','SA','SAR',1,1)", (supplier, planning[1]))
        db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure) values(%s,%s,%s,%s,2,1.5,1,'SAR','EA')", (planning[1], supplier, item, lead))
    with session(planning) as db:
        comparison = db.execute(PREVIEW, (planning[1], draft)).fetchone()[0]
        assert comparison['status'] == 'available'
        for side in ['baseline', 'adjusted']:
            gap = Decimal(report[side + '_gap'])
            expected = Decimal(0) if gap == 0 else (max(gap, Decimal(2)) / Decimal('1.5')).to_integral_value(rounding=ROUND_CEILING) * Decimal('1.5')
            assert Decimal(comparison[side]['quantity']) == expected
        assert db.execute(SAVE, (planning[1], draft, uuid4(), comparison['fingerprint'])).fetchone()[0]
