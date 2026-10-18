"""Saved event scenarios enforce live authority and stable concurrent retries."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.planned_event_preview(%s,%s,'campaign','Launch','Additional demand','EA','[{\"date\":\"2026-10-11\",\"quantity\":\"2\"}]',true)"
SAVE = "select public.planned_event_save(%s,%s,'campaign','Launch','Additional demand','EA','[{\"date\":\"2026-10-11\",\"quantity\":\"2\"}]',true,%s,%s)"


@pytest.fixture
def event(dsn):
    org, user, location, run, forecast = [uuid4() for _ in range(5)]
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Events')", (org, f"event-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"event-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'L','Branch','branch','SA','Asia/Riyadh')", (location, org))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-10','forecast','succeeded','{}','{}',now())", (run, org, location, uuid4()))
        evidence = {"source": {"unit_provenance": {"status": "consistent", "unit": "EA"}}, "output": {"status": "selected", "forecast": [{"date": "2026-10-11", "quantity": "1.001"}]}}
        db.execute("insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,%s,'ITEM','Item','selected','mean','{}',%s)", (forecast, org, run, location, uuid4(), Jsonb(evidence)))
    source = dsn, org, user, forecast
    with session(source) as db:
        report = db.execute(PREVIEW, (org, forecast)).fetchone()[0]
    yield source, report
    with psycopg.connect(dsn) as db:
        db.execute("delete from public.organizations where id=%s", (org,))
        db.execute("delete from auth.users where id=%s", (user,))
        db.execute("delete from public.audit_log where organization_id=%s", (org,))


def test_event_concurrent_retry_saves_once(event):
    source, report = event
    args = source[1], source[3], uuid4(), report['fingerprint']
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.planned_event_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='planned_event_scenarios'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('role', 'MQ403'), ('membership', 'MQ403'), ('source', 'MQ409'), ('deleted', 'MQ404')])
def test_event_rechecks_after_lock(event, change, expected):
    source, report = event
    request = uuid4()
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.planned-event:'||%s||':'||%s,0))", (str(source[1]), str(request)))
        call = _Call(waiting, SAVE, (source[1], source[3], request, report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        elif change == 'source':
            admin.execute("update public.forecast_results set evidence=jsonb_set(evidence,'{output,forecast,0,quantity}','\"2.001\"') where id=%s", (source[3],))
        else:
            admin.execute('delete from public.forecast_results where id=%s', (source[3],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.planned_event_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 0
