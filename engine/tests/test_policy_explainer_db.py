"""Policy explanations serialize quotas and recheck authority after database waits."""
import json
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from test_tenancy_concurrency import fixture, _user, _organization, _session, _Call, _race  # noqa: F401

pytestmark = pytest.mark.db
REQUEST = "select public.policy_explainer_request(%s,%s,%s,%s,'en',%s,true)"
DISPATCH = "select public.policy_explainer_dispatch(%s,%s,'claude-sonnet-5-5')"
COMPLETE = "select public.policy_explainer_complete(%s,%s,%s,'claude-sonnet-5-5',null)"
ANSWER = dict(paragraphs=[dict(text='Three calendar days.', references=['policy_inputs'])])


@pytest.fixture
def policy(fixture):
    with psycopg.connect(fixture.dsn) as db:
        actor = _user(fixture, db)
        org = _organization(fixture, db, [actor])
        location, run, policy, forecast_run, item = [uuid4() for _ in range(5)]
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'AI','AI','branch','SA','Asia/Riyadh')", (location, org))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-01','policy','succeeded','{}','{}',now())", (run, org, location, uuid4()))
        period = dict(days=3, forecast='3', quantile='4', target='4', safety_stock='1')
        evidence = dict(method='policy-v1',options=dict(lead_time=3,review_interval=4,service_level='0.95'),forecast=dict(run_id=str(forecast_run),method='baseline-v1',to_date='2026-10-01',horizon=28,output=dict(model='naive')),output=dict(lead_time=period,protection=dict(period,days=7),residual_count=84,positive_days=90,samples=5000))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'AI-PART','EA','available','{}',%s)", (policy,org,run,location,uuid4(),item,Jsonb(evidence)))
    with _session(fixture.dsn, actor) as db:
        db.execute('select public.policy_explainer_configure(%s,true)', (org,))
        fingerprint = db.execute('select public.policy_explainer_preview(%s,%s)', (org,policy)).fetchone()[0]['fingerprint']
    return fixture.dsn, org, actor, policy, fingerprint


def request_args(source, identity=None):
    return source[1], source[3], identity or uuid4(), 'Why this maximum?', source[4]


def server(dsn):
    db = psycopg.connect(dsn)
    db.execute('set local role service_role')
    return db


@pytest.mark.parametrize('same_identity', [True, False])
def test_concurrent_request_identity_and_minute_quota(policy, same_identity):
    first_args = request_args(policy)
    second_args = first_args if same_identity else request_args(policy)
    with _session(policy[0],policy[2]) as first, _session(policy[0],policy[2]) as second:
        call = _race(first,second,REQUEST,first_args,second_args)
        assert call.sqlstate == (None if same_identity else 'MQ429')
    with psycopg.connect(policy[0]) as db:
        assert db.execute('select count(*) from public.policy_explanations where organization_id=%s',(policy[1],)).fetchone()[0] == 1


def test_concurrent_dispatch_cannot_send_twice(policy):
    with _session(policy[0],policy[2]) as db:
        record = db.execute(REQUEST,request_args(policy)).fetchone()[0]
    with server(policy[0]) as first, server(policy[0]) as second:
        first_result = first.execute(DISPATCH,(record,policy[2])).fetchone()[0]
        assert first_result['dispatch'] is True
        call = _Call(second,DISPATCH,(record,policy[2]))
        call.start()
        time.sleep(.15)
        assert not call.finished
        first.commit()
        call.join(10)
        assert call.finished and call.sqlstate is None
    with server(policy[0]) as db:
        assert db.execute(DISPATCH,(record,policy[2])).fetchone()[0] == {'dispatch': False}


@pytest.mark.parametrize('stage', ['request','dispatch','complete'])
@pytest.mark.parametrize('change', ['demote','disable'])
def test_authority_rechecked_after_org_lock(policy, stage, change):
    args = request_args(policy)
    if stage != 'request':
        with _session(policy[0],policy[2]) as db:
            record = db.execute(REQUEST,args).fetchone()[0]
        if stage == 'complete':
            with server(policy[0]) as db:
                db.execute(DISPATCH,(record,policy[2]))
    waiting = _session(policy[0],policy[2]) if stage == 'request' else server(policy[0])
    try:
        with psycopg.connect(policy[0]) as admin:
            admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.policy-explainer:'||%s,0))",(str(policy[1]),))
            sql, params = (REQUEST,args) if stage == 'request' else (DISPATCH,(record,policy[2])) if stage == 'dispatch' else (COMPLETE,(record,policy[2],Jsonb(ANSWER)))
            call = _Call(waiting,sql,params)
            call.start()
            deadline = time.monotonic()+5
            while not admin.execute('select cardinality(pg_blocking_pids(%s))',(waiting.info.backend_pid,)).fetchone()[0]:
                assert time.monotonic()<deadline and not call.finished
                time.sleep(.02)
            if change == 'demote':
                admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(policy[1],policy[2]))
            else:
                admin.execute('update public.policy_explainer_settings set enabled=false where organization_id=%s',(policy[1],))
            admin.commit()
            call.join(10)
            assert call.finished and call.sqlstate == 'MQ403'
            assert admin.execute('select count(*) from public.policy_explanations where organization_id=%s and answer is not null',(policy[1],)).fetchone()[0] == 0
    finally:
        waiting.close()
