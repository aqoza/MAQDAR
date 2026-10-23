"""Event drafts bind saved evidence and recheck live authority/feeds after waits."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_planned_events_db import event
from test_event_policies_db import policy_event, SAVE as POLICY_SAVE
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race
from test_planning_db import planning, worker
from test_policy_db import saved_forecast, enqueue_policy
from zeespare_engine.worker import process_one

pytestmark = pytest.mark.db
PREVIEW = "select public.event_replenishment_preview(%s,%s,'0',true,true)"
SAVE = "select public.event_replenishment_save(%s,%s,'0',true,true,%s,%s)"


@pytest.fixture
def event_draft(policy_event):
    source, event_id, policy, _ = policy_event
    with psycopg.connect(source[0]) as db:
        item, location = db.execute('select item_id,location_id from public.inventory_policies where id=%s', (policy,)).fetchone()
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'ITEM','Item','Test','EA',1,'SAR')", (item, source[1]))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',0,0,1,'SAR','EA')", (source[1], item, location))
        provenance = Jsonb(dict(method='source-units-v1', status='consistent', unit='EA', rows=1, unknown_rows=0, units=['EA']))
        db.execute("update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,source,unit_provenance}',%s) where id=%s", (provenance, policy))
        db.execute("update public.planned_event_scenarios set report=jsonb_set(report,'{source,evidence,source,unit_provenance}',%s) where id=%s", (provenance, event_id))
    with session(source) as db:
        fingerprint = db.execute("select public.event_policy_preview(%s,%s,%s,'Fixed event comparison')->>'fingerprint'", (source[1], event_id, policy)).fetchone()[0]
        scenario = db.execute(POLICY_SAVE, (source[1], event_id, policy, uuid4(), fingerprint)).fetchone()[0]
        report = db.execute(PREVIEW, (source[1], scenario)).fetchone()[0]
        assert report['status'] == 'available'
    yield source, scenario, report


def test_event_draft_retries_save_one_record(event_draft):
    source, scenario, report = event_draft
    args = source[1], scenario, uuid4(), report['fingerprint']
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select report from public.event_replenishment_drafts where organization_id=%s', (source[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_replenishment_drafts'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('role', 'MQ403'), ('membership', 'MQ403'), ('stock', 'MQ409'), ('inbound', 'MQ409'), ('scenario', 'MQ409'), ('deleted', 'MQ404')])
def test_event_draft_rechecks_after_lock(event_draft, change, expected):
    source, scenario, report = event_draft
    request = uuid4()
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-replenishment:'||%s||':'||%s,0))", (str(source[1]), str(request)))
        call = _Call(waiting, SAVE, (source[1], scenario, request, report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        elif change == 'stock':
            admin.execute('update public.stock_snapshots set quantity=1 where organization_id=%s', (source[1],))
        elif change == 'inbound':
            supplier = uuid4()
            item, location = admin.execute('select item_id,location_id from public.inventory_policies where organization_id=%s', (source[1],)).fetchone()
            admin.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'SUP','Supplier','SA','SAR',1,1)", (supplier, source[1]))
            admin.execute("insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values(%s,'NEW','1',%s,%s,%s,'2026-10-11',1,1,'SAR','open','EA')", (source[1], item, location, supplier))
        elif change == 'scenario':
            admin.execute("update public.event_policy_scenarios set report=report||'{\"changed\":true}'::jsonb where id=%s", (scenario,))
        else:
            admin.execute('delete from public.event_policy_scenarios where id=%s', (scenario,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_replenishment_drafts where organization_id=%s', (source[1],)).fetchone()[0] == 0


def test_real_worker_forecast_policy_event_to_replenishment(planning):
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
        args = planning[1], forecast, 'recall', 'Service campaign', 'Fixed incremental demand', 'EA', Jsonb([dict(date='2026-10-02', quantity='2.001')]), True
        preview = db.execute('select public.planned_event_preview(%s,%s,%s,%s,%s,%s,%s,%s)', args).fetchone()[0]
        event_id = db.execute('select public.planned_event_save(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)', (*args, uuid4(), preview['fingerprint'])).fetchone()[0]
        comparison = db.execute("select public.event_policy_preview(%s,%s,%s,'Fixed event comparison')", (planning[1], event_id, policy)).fetchone()[0]
        scenario = db.execute(POLICY_SAVE, (planning[1], event_id, policy, uuid4(), comparison['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW, (planning[1], scenario)).fetchone()[0]
        assert report['status'] == 'available'
        assert Decimal(report['baseline_gap']) == Decimal(maximum)
        assert Decimal(report['adjusted_gap']) == Decimal(maximum) + Decimal('2.001')
        assert report['gap_increase'] == '2.001'
        assert db.execute(SAVE, (planning[1], scenario, uuid4(), report['fingerprint'])).fetchone()[0]
