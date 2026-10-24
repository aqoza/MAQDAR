"""Supplier explanations share quotas and recheck authority after database waits."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from supplier_explainer_fixture import seed_scenario
from test_tenancy_concurrency import fixture, _user, _organization, _session, _Call, _race  # noqa: F401

pytestmark = pytest.mark.db
REQUEST = "select public.supplier_explainer_request(%s,%s,%s,%s,'en',%s,true)"
DISPATCH = "select public.policy_explainer_dispatch(%s,%s,'claude-sonnet-5-5')"
COMPLETE = "select public.policy_explainer_complete(%s,%s,%s,'claude-sonnet-5-5',null)"
ANSWER = dict(paragraphs=[dict(text='Captured rounding only.', references=['rounding_calculation'])])


@pytest.fixture
def scenario(fixture):
    with psycopg.connect(fixture.dsn) as db:
        actor = _user(fixture, db)
        org = _organization(fixture, db, [actor])
        location=uuid4()
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'AI','AI','branch','SA','Asia/Riyadh')",(location,org))
        scenario,_=seed_scenario(db,org,actor,location)
    with _session(fixture.dsn, actor) as db:
        db.execute('select public.policy_explainer_configure(%s,true)', (org,))
        fingerprint = db.execute('select public.supplier_explainer_preview(%s,%s)', (org,scenario)).fetchone()[0]['fingerprint']
    return fixture.dsn, org, actor, scenario, fingerprint


def request_args(source, identity=None):
    return source[1], source[3], identity or uuid4(), 'Why this rounding?', source[4]


def server(dsn):
    db = psycopg.connect(dsn)
    db.execute('set local role service_role')
    return db


@pytest.mark.parametrize('same_identity', [True, False])
def test_concurrent_request_identity_and_minute_quota(scenario, same_identity):
    first_args = request_args(scenario)
    second_args = first_args if same_identity else request_args(scenario)
    with _session(scenario[0],scenario[2]) as first, _session(scenario[0],scenario[2]) as second:
        call = _race(first,second,REQUEST,first_args,second_args)
        assert call.sqlstate == (None if same_identity else 'MQ429')
    with psycopg.connect(scenario[0]) as db:
        assert db.execute('select count(*) from public.policy_explanations where organization_id=%s',(scenario[1],)).fetchone()[0] == 1


def test_concurrent_dispatch_cannot_send_twice(scenario):
    with _session(scenario[0],scenario[2]) as db:
        record = db.execute(REQUEST,request_args(scenario)).fetchone()[0]
    with server(scenario[0]) as first, server(scenario[0]) as second:
        first_result = first.execute(DISPATCH,(record,scenario[2])).fetchone()[0]
        assert first_result['dispatch'] is True
        call = _Call(second,DISPATCH,(record,scenario[2]))
        call.start()
        time.sleep(.15)
        assert not call.finished
        first.commit()
        call.join(10)
        assert call.finished and call.sqlstate is None
    with server(scenario[0]) as db:
        assert db.execute(DISPATCH,(record,scenario[2])).fetchone()[0] == {'dispatch': False}


@pytest.mark.parametrize('stage', ['request','dispatch','complete'])
@pytest.mark.parametrize('change', ['demote','disable'])
def test_authority_rechecked_after_org_lock(scenario, stage, change):
    args = request_args(scenario)
    if stage != 'request':
        with _session(scenario[0],scenario[2]) as db:
            record = db.execute(REQUEST,args).fetchone()[0]
        if stage == 'complete':
            with server(scenario[0]) as db:
                db.execute(DISPATCH,(record,scenario[2]))
    waiting = _session(scenario[0],scenario[2]) if stage == 'request' else server(scenario[0])
    try:
        with psycopg.connect(scenario[0]) as admin:
            admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.policy-explainer:'||%s,0))",(str(scenario[1]),))
            sql, params = (REQUEST,args) if stage == 'request' else (DISPATCH,(record,scenario[2])) if stage == 'dispatch' else (COMPLETE,(record,scenario[2],Jsonb(ANSWER)))
            call = _Call(waiting,sql,params)
            call.start()
            deadline = time.monotonic()+5
            while not admin.execute('select cardinality(pg_blocking_pids(%s))',(waiting.info.backend_pid,)).fetchone()[0]:
                assert time.monotonic()<deadline and not call.finished
                time.sleep(.02)
            if change == 'demote':
                admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(scenario[1],scenario[2]))
            else:
                admin.execute('update public.policy_explainer_settings set enabled=false where organization_id=%s',(scenario[1],))
            admin.commit()
            call.join(10)
            assert call.finished and call.sqlstate == 'MQ403'
            assert admin.execute('select count(*) from public.policy_explanations where organization_id=%s and answer is not null',(scenario[1],)).fetchone()[0] == 0
    finally:
        waiting.close()
