"""Committed, multi-connection queue tests; only the local Supabase stack."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import Decimal
import json
from uuid import uuid4

import psycopg
from psycopg.conninfo import conninfo_to_dict
import pytest

from maqdar_engine.worker import process_one

pytestmark = pytest.mark.db


@pytest.fixture
def planning(dsn):
    assert conninfo_to_dict(dsn).get('host') in {'localhost', '127.0.0.1', '::1'}
    org, user, location, item = (uuid4() for _ in range(4))
    with psycopg.connect(dsn, autocommit=True) as db:
        db.execute('insert into auth.users(id,email) values(%s,%s)', (user, f'{user}@test.local'))
        db.execute('insert into public.organizations(id,slug,name) values(%s,%s,%s)', (org, f'planning-{org}', 'Planning test'))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org,user))
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'TEST','Test','branch','SA','Asia/Riyadh')", (location,org))
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'TEST','Test','Test','EA',1,'SAR')", (item,org))
        db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity) values(%s,%s,%s,'2026-10-01',1.123)", (org,item,location))
    try:
        yield dsn, org, user
    finally:
        with psycopg.connect(dsn, autocommit=True) as db:
            db.execute("delete from pgmq.q_planning where (message->>'run_id')::uuid in (select id from public.planning_runs where organization_id=%s)", (org,))
            db.execute("delete from pgmq.a_planning where (message->>'run_id')::uuid in (select id from public.planning_runs where organization_id=%s)", (org,))
            db.execute('delete from public.demand_history where organization_id=%s', (org,))
            db.execute('delete from public.organizations where id=%s', (org,))
            db.execute('delete from public.audit_log where organization_id=%s', (org,))
            db.execute('delete from auth.users where id=%s', (user,))


def enqueue(fixture, request):
    dsn, org, user = fixture
    with psycopg.connect(dsn) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':str(user),'org_id':str(org),'role':'authenticated'}),))
        return db.execute("select public.planning_enqueue(%s,'TEST','2026-10-01','2026-10-01',%s)", (org,request)).fetchone()[0]


@contextmanager
def worker(dsn):
    with psycopg.connect(dsn, autocommit=True) as db:
        db.execute('set role maqdar_worker')
        db.execute("set statement_timeout='90s'")
        yield db


def test_concurrent_replay_creates_one_message(planning):
    request = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(lambda _: enqueue(planning,request), range(2)))
    assert runs[0] == runs[1]
    with psycopg.connect(planning[0]) as db:
        assert db.execute("select count(*) from pgmq.q_planning where message->>'run_id'=%s", (str(runs[0]),)).fetchone()[0] == 1


def test_two_workers_publish_only_one_result(planning):
    run = enqueue(planning,uuid4())

    def execute(_):
        with worker(planning[0]) as db:
            return process_one(db)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(execute, range(2)))
    assert sorted(results) == [False, True]
    with psycopg.connect(planning[0]) as db:
        status, attempts, result = db.execute('select status,attempts,result from public.planning_runs where id=%s', (run,)).fetchone()
        assert (status,attempts) == ('succeeded',1)
        assert Decimal(result['quantity']) == Decimal('1.123')
        assert result['stored_rows'] == 1


def test_expired_claim_is_recovered_and_fenced(planning):
    run = enqueue(planning,uuid4())
    with worker(planning[0]) as db:
        original = db.execute('select * from app.planning_claim()').fetchone()
    with psycopg.connect(planning[0],autocommit=True) as db:
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s", (str(run),))
        db.execute("update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=%s", (run,))
    with worker(planning[0]) as db:
        replacement = db.execute('select * from app.planning_claim()').fetchone()
        assert replacement[0] == run
        assert replacement[1] != original[1]
        assert db.execute('select app.planning_execute(%s,%s)', original).fetchone()[0] is False
        assert db.execute('select app.planning_execute(%s,%s)', replacement).fetchone()[0] is True
