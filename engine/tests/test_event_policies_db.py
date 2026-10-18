"""Event-policy saves serialize retries and recheck authority/evidence after waits."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_planned_events_db import event, PREVIEW, SAVE as EVENT_SAVE
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race
from test_planning_db import planning, worker
from test_policy_db import saved_forecast, enqueue_policy
from maqdar_engine.worker import process_one

pytestmark = pytest.mark.db
SAVE = "select public.event_policy_save(%s,%s,%s,'Fixed event comparison',%s,%s)"


@pytest.fixture
def policy_event(event):
    source, _ = event
    dsn, org, user, forecast = source
    policy, run = uuid4(), uuid4()
    with psycopg.connect(dsn) as db:
        f = db.execute('select location_id,item_id,run_id,evidence from public.forecast_results where id=%s', (forecast,)).fetchone()
        evidence = f[3]
        evidence['source'].update(introduced_on=None, discontinued_on=None, end_day='2026-10-10')
        db.execute('update public.forecast_results set evidence=%s where id=%s', (Jsonb(evidence), forecast))
        db.execute("update public.planning_runs set options='{}'::jsonb||jsonb_build_object('method','expanded-v1','horizon',1) where id=%s", (f[2],))
        options = dict(method='policy-v1', forecast_id=str(forecast), lead_time=0, review_interval=1, service_level='0.95')
        zero = dict(days=0, forecast='0.000', quantile='0.000', target='0.000', safety_stock='0.000')
        protection = dict(days=1, forecast='1.001', quantile='2.001', target='2.001', safety_stock='1.000')
        output = dict(status='available', lead_time=zero, protection=protection)
        payload = dict(method='policy-v1', options=options, forecast=dict(id=str(forecast), run_id=str(f[2]), item_id=str(f[1]), unit='EA', method='expanded-v1', to_date='2026-10-10', horizon=1, source=evidence['source'], output=evidence['output']), output=output)
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-10','policy','succeeded',%s,'{}',now())", (run, org, f[0], uuid4(), Jsonb(options)))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'ITEM','EA','available',%s,%s)", (policy, org, run, f[0], forecast, f[1], Jsonb(output), Jsonb(payload)))
    with session(source) as db:
        report = db.execute(PREVIEW, (org, forecast)).fetchone()[0]
        event_id = db.execute(EVENT_SAVE, (org, forecast, uuid4(), report['fingerprint'])).fetchone()[0]
        preview = db.execute("select public.event_policy_preview(%s,%s,%s,'Fixed event comparison')", (org, event_id, policy)).fetchone()[0]
        assert preview['status'] == 'available'
    yield source, event_id, policy, preview['fingerprint']


def test_identical_event_policy_retry_saves_once(policy_event):
    source, event_id, policy, fingerprint = policy_event
    args = source[1], event_id, policy, uuid4(), fingerprint
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_policy_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_policy_scenarios'", (source[1],)).fetchone()[0] == 1


def test_event_comparison_accepts_real_worker_published_policy(planning):
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.demand_history set unit_of_measure='EA' where organization_id=%s", (planning[1],))
    forecast = saved_forecast(planning)
    run = enqueue_policy(planning, forecast)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        policy, baseline, evidence = db.execute('select id,summary,evidence from public.inventory_policies where run_id=%s', (run,)).fetchone()
        assert 'calibration' not in baseline and evidence['output']['calibration']
    with session(planning) as db:
        args = planning[1], forecast, 'recall', 'Known service demand', 'Fixed addition', 'EA', Jsonb([dict(date='2026-10-02', quantity='2.001')]), True
        preview = db.execute('select public.planned_event_preview(%s,%s,%s,%s,%s,%s,%s,%s)', args).fetchone()[0]
        event_id = db.execute('select public.planned_event_save(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)', (*args, uuid4(), preview['fingerprint'])).fetchone()[0]
        result = db.execute("select public.event_policy_preview(%s,%s,%s,'Fixed event comparison')", (planning[1], event_id, policy)).fetchone()[0]
        assert result['status'] == 'available'
        for key in ('lead_time', 'protection'):
            assert Decimal(result['periods'][key]['adjusted']['target']) == Decimal(baseline[key]['target']) + Decimal('2.001')
            assert result['periods'][key]['adjusted']['safety_stock'] == baseline[key]['safety_stock']
        assert result['policy']['evidence'] == evidence
        assert db.execute(SAVE, (planning[1], event_id, policy, uuid4(), result['fingerprint'])).fetchone()[0]


@pytest.mark.parametrize('change,expected', [('role', 'MQ403'), ('membership', 'MQ403'), ('policy', 'MQ409'), ('event', 'MQ409'), ('deleted', 'MQ404')])
def test_event_policy_rechecks_after_lock(policy_event, change, expected):
    source, event_id, policy, fingerprint = policy_event
    request = uuid4()
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.event-policy:'||%s||':'||%s,0))", (str(source[1]), str(request)))
        call = _Call(waiting, SAVE, (source[1], event_id, policy, request, fingerprint))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        elif change == 'policy':
            admin.execute("update public.inventory_policies set evidence=evidence||'{\"changed\":true}'::jsonb where id=%s", (policy,))
        elif change == 'event':
            admin.execute("update public.planned_event_scenarios set report=report||'{\"changed\":true}'::jsonb where id=%s", (event_id,))
        else:
            admin.execute('delete from public.inventory_policies where id=%s', (policy,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_policy_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 0
