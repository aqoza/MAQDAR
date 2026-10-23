"""Committed, multi-connection queue tests; only the local Supabase stack."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from decimal import Decimal
import json
from uuid import uuid4

import psycopg
from psycopg.conninfo import conninfo_to_dict
import pytest

from zeespare_engine.worker import process_one
from zeespare_engine.classification import classify
from zeespare_engine.forecasting import forecast as baseline_forecast
from zeespare_engine.expanded_forecasting import forecast as expanded_forecast
from psycopg.types.json import Jsonb


CLASSIFICATION_OPTIONS = dict(adi='1.32', cv2='0.49', abc_a='0.8', abc_b='0.95', xyz_x='0.5', xyz_y='1')

pytestmark = pytest.mark.db


def forecast(snapshot):
    return (expanded_forecast if snapshot['method'] == 'expanded-v1' else baseline_forecast)(snapshot)


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
        db.execute('set role zeespare_worker')
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


def enqueue_classification(fixture, confirmed=True):
    dsn, org, user = fixture
    with psycopg.connect(dsn) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':str(user),'org_id':str(org),'role':'authenticated'}),))
        return db.execute("select public.classification_enqueue(%s,'TEST','2026-10-01','2026-10-02',%s,%s,%s)",
                          (org,uuid4(),confirmed,Jsonb(CLASSIFICATION_OPTIONS))).fetchone()[0]


def test_classification_requires_confirmed_history(planning):
    with pytest.raises(psycopg.Error) as error:
        enqueue_classification(planning,False)
    assert error.value.sqlstate == 'MQ422'


def test_classification_worker_publishes_versioned_evidence(planning):
    run=enqueue_classification(planning)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status,result=db.execute('select status,result from public.planning_runs where id=%s',(run,)).fetchone()
        assert status=='succeeded' and result['method']=='daily-v1'
        pattern,abc,xyz,evidence=db.execute('select pattern,abc,xyz,evidence from public.demand_classifications where run_id=%s',(run,)).fetchone()
        assert (pattern,abc,xyz)==('insufficient','A','U')
        assert Decimal(evidence['source']['quantity'])==Decimal('1.123')
        assert evidence['source']['days']==2
        assert db.execute('select count(*) from planning.classification_inputs where run_id=%s',(run,)).fetchone()[0]==0


def test_retry_reuses_snapshot_despite_imports_and_source_deletion(planning):
    run=enqueue_classification(planning)
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        snapshot=db.execute('select app.planning_task(%s,%s)',lease).fetchone()[0]
        assert db.execute('select app.planning_fail(%s,%s)',lease).fetchone()[0]
    with psycopg.connect(planning[0],autocommit=True) as db:
        db.execute('delete from public.demand_history where organization_id=%s',(planning[1],))
        db.execute('delete from public.items where organization_id=%s',(planning[1],))
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s",(str(run),))
    with worker(planning[0]) as db:
        new_lease=db.execute('select * from app.planning_claim()').fetchone()
        new_snapshot=db.execute('select app.planning_task(%s,%s)',new_lease).fetchone()[0]
        assert new_snapshot==snapshot
        rows=Jsonb(classify(snapshot))
        assert db.execute('select app.classification_finish(%s,%s,%s)',(*lease,rows)).fetchone()[0] is False
        assert db.execute('select app.classification_finish(%s,%s,%s)',(*new_lease,rows)).fetchone()[0] is True
        assert db.execute('select app.classification_finish(%s,%s,%s)',(*new_lease,rows)).fetchone()[0] is False


def test_bad_output_cannot_publish_partial_results(planning):
    run=enqueue_classification(planning)
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        snapshot=db.execute('select app.planning_task(%s,%s)',lease).fetchone()[0]
        rows=classify(snapshot);rows[0]['item_id']=str(uuid4())
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.classification_finish(%s,%s,%s)',(*lease,Jsonb(rows)))
        assert error.value.sqlstate=='MQ422'
        with pytest.raises(psycopg.Error):
            db.execute('select app.planning_execute(%s,%s)',lease)
    with psycopg.connect(planning[0]) as db:
        assert db.execute('select count(*) from public.demand_classifications where run_id=%s',(run,)).fetchone()[0]==0
        assert db.execute('select status from public.planning_runs where id=%s',(run,)).fetchone()[0]=='running'


def enqueue_forecast(fixture, expanded=False):
    dsn, org, user = fixture
    with psycopg.connect(dsn) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':str(user),'org_id':str(org),'role':'authenticated'}),))
        return db.execute(("select public.forecast_expanded_enqueue(" if expanded else "select public.forecast_enqueue(") + "%s,'TEST','2026-07-01','2026-10-01',%s,true,array['TEST'],7)",
                          (org,uuid4())).fetchone()[0]


@pytest.mark.parametrize("expanded", [False, True])
def test_forecast_worker_publishes_scores_and_daily_quantities(planning, expanded):
    run=enqueue_forecast(planning, expanded)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status,result=db.execute('select status,result from public.planning_runs where id=%s',(run,)).fetchone()
        assert status=='succeeded' and result['method']==('expanded-v1' if expanded else 'baseline-v1')
        evidence=db.execute('select evidence from public.forecast_results where run_id=%s',(run,)).fetchone()[0]
        assert evidence['output']['model']=='mean'  # all-zero training folds tie
        assert len(evidence['output']['scores']) >= 7
        if expanded:
            assert evidence['output']['uncertainty']['status']=='available'
            assert evidence['output']['evaluation']['status']=='available'
        assert len(evidence['output']['forecast'])==7
        assert evidence['source']['demand']==[['2026-10-01','1.123','0.000']]
        assert db.execute('select count(*) from planning.forecast_inputs where run_id=%s',(run,)).fetchone()[0]==0


@pytest.mark.parametrize("expanded", [False, True])
def test_forecast_retry_is_immutable_and_old_claim_cannot_publish(planning, expanded):
    run=enqueue_forecast(planning, expanded)
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        snapshot=db.execute('select app.planning_task(%s,%s)',lease).fetchone()[0]
        assert db.execute('select app.planning_fail(%s,%s)',lease).fetchone()[0]
    with psycopg.connect(planning[0],autocommit=True) as db:
        db.execute('delete from public.demand_history where organization_id=%s',(planning[1],))
        db.execute('delete from public.items where organization_id=%s',(planning[1],))
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s",(str(run),))
    with worker(planning[0]) as db:
        replacement=db.execute('select * from app.planning_claim()').fetchone()
        assert db.execute('select app.planning_task(%s,%s)',replacement).fetchone()[0]==snapshot
        rows=forecast(snapshot)
        bad=[dict(rows[0],item_id=str(uuid4()))]
        with pytest.raises(psycopg.Error):
            db.execute('select app.forecast_finish(%s,%s,%s)',(*replacement,Jsonb(bad)))
        assert db.execute('select app.forecast_finish(%s,%s,%s)',(*lease,Jsonb(rows))).fetchone()[0] is False
        assert db.execute('select app.forecast_finish(%s,%s,%s)',(*replacement,Jsonb(rows))).fetchone()[0] is True


@pytest.mark.parametrize("expanded", [False, True])
def test_forecast_cancellation_removes_snapshot_and_fences_publication(planning, expanded):
    run=enqueue_forecast(planning, expanded)
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        snapshot=db.execute('select app.planning_task(%s,%s)',lease).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({'sub':str(planning[2]),'org_id':str(planning[1]),'role':'authenticated'}),))
        db.execute('select public.planning_cancel(%s,%s)',(planning[1],run))
        assert db.execute('select count(*) from planning.forecast_inputs where run_id=%s',(run,)).fetchone()[0]==0
    with worker(planning[0]) as db:
        assert db.execute('select app.forecast_finish(%s,%s,%s)',(*lease,Jsonb(forecast(snapshot)))).fetchone()[0] is False
