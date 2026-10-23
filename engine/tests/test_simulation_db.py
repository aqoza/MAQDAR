"""Actual queue/worker publication and immutable input recovery, local stack only."""
from concurrent.futures import ThreadPoolExecutor
import json
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker
from test_policy_db import saved_forecast, enqueue_policy
from zeespare_engine.policy_simulation import calculate
from zeespare_engine.worker import process_one

pytestmark = pytest.mark.db


@pytest.fixture
def policy(planning):
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.demand_history set unit_of_measure='EA' where organization_id=%s", (planning[1],))
    forecast_id = saved_forecast(planning)
    source_run = enqueue_policy(planning, forecast_id)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        policy_id, item, location = db.execute(
            "select id,item_id,location_id from public.inventory_policies where run_id=%s and status='available' and unit='EA'",
            (source_run,),
        ).fetchone()
        db.execute("""insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity,unit_of_measure)
                      values(%s,%s,%s,'2026-10-02',4,2,'EA'),(%s,%s,%s,'2026-10-03',4,1,'EA')""",
                   (planning[1], item, location, planning[1], item, location))
    return policy_id, source_run


def enqueue(fixture, policy_id, request=None, alternative="8", opening="2"):
    with psycopg.connect(fixture[0]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",
                   (json.dumps(dict(sub=str(fixture[2]), org_id=str(fixture[1]), role='authenticated')),))
        return db.execute("select public.simulation_enqueue(%s,%s,%s,'2026-10-04',%s,%s,true,true)",
                          (fixture[1], policy_id, request or uuid4(), opening, alternative)).fetchone()[0]


def test_worker_replay_is_exact_and_scoped(planning, policy):
    run = enqueue(planning, policy[0])
    with psycopg.connect(planning[0]) as db:
        captured = db.execute('select payload from planning.simulation_inputs where run_id=%s', (run,)).fetchone()[0]
        assert captured['demand'][-1] == dict(date='2026-10-04', quantity='0', lost_sales_quantity='0', recorded=False)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        evidence, unit = db.execute('select evidence,unit from public.policy_simulations where run_id=%s', (run,)).fetchone()
        assert unit == 'EA'
        assert evidence == dict(captured, output=calculate(captured))
        assert evidence['output']['variants'][0]['metrics']['lost_sales_quantity'] == '3'
        assert db.execute('select count(*) from planning.simulation_inputs where run_id=%s', (run,)).fetchone()[0] == 0
        assert db.execute('select status from public.planning_runs where id=%s', (run,)).fetchone()[0] == 'succeeded'


def test_large_opening_preserves_average_precision_in_publication(planning, policy):
    run = enqueue(planning, policy[0], opening='999999999999999.999')
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        evidence = db.execute('select evidence from public.policy_simulations where run_id=%s', (run,)).fetchone()[0]
        assert evidence['output']['variants'][0]['metrics']['average_closing_stock'] == '999999999999993.332333'


def test_concurrent_retries_freeze_inputs_even_after_source_deletion(planning, policy):
    request = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(lambda _: enqueue(planning, policy[0], request), range(2)))
    assert runs[0] == runs[1]
    with psycopg.connect(planning[0]) as db:
        captured = db.execute('select payload from planning.simulation_inputs where run_id=%s', (runs[0],)).fetchone()[0]
        db.execute("update public.demand_history set quantity=999,unit_of_measure='KG' where organization_id=%s", (planning[1],))
        db.execute('delete from public.planning_runs where id=%s', (policy[1],))
    assert enqueue(planning, policy[0], request) == runs[0]
    with pytest.raises(psycopg.Error) as error:
        enqueue(planning, policy[0], request, alternative='9')
    assert error.value.sqlstate == 'MQ409'
    with worker(planning[0]) as db:
        assert process_one(db)
    assert enqueue(planning, policy[0], request) == runs[0]
    with psycopg.connect(planning[0]) as db:
        assert db.execute('select evidence from public.policy_simulations where run_id=%s', (runs[0],)).fetchone()[0] == dict(captured, output=calculate(captured))


def test_invalid_publication_and_replaced_expired_canceled_leases(planning, policy):
    run = enqueue(planning, policy[0])
    with worker(planning[0]) as db:
        old = db.execute('select * from app.planning_claim()').fetchone()
        captured = db.execute('select app.planning_task(%s,%s)', old).fetchone()[0]
        output = calculate(captured)
        for invalid in (None, {}, dict(output, variants=[])):
            with pytest.raises(psycopg.Error) as error:
                db.execute('select app.simulation_finish(%s,%s,%s)', (*old, Jsonb(invalid)))
            assert error.value.sqlstate == 'MQ422'
        changed = json.loads(json.dumps(output))
        changed['variants'][0]['ledger'][0]['closing_stock'] = '999'
        with pytest.raises(psycopg.Error):
            db.execute('select app.simulation_finish(%s,%s,%s)', (*old, Jsonb(changed)))
        assert db.execute('select app.planning_fail(%s,%s)', old).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s", (str(run),))
    with worker(planning[0]) as db:
        current = db.execute('select * from app.planning_claim()').fetchone()
        assert db.execute('select app.simulation_finish(%s,%s,%s)', (*old, Jsonb(output))).fetchone()[0] is False
        assert db.execute('select app.planning_task(%s,%s)', current).fetchone()[0] == captured
    with psycopg.connect(planning[0]) as db:
        db.execute("update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=%s", (run,))
    with worker(planning[0]) as db:
        assert db.execute('select app.simulation_finish(%s,%s,%s)', (*current, Jsonb(output))).fetchone()[0] is False
        assert db.execute('select app.planning_task(%s,%s)', current).fetchone()[0] is None
    with psycopg.connect(planning[0]) as db:
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(planning[2]), org_id=str(planning[1]), role='authenticated')),))
        db.execute('set local role authenticated')
        db.execute('select public.planning_cancel(%s,%s)', (planning[1], run))
    with worker(planning[0]) as db:
        assert db.execute('select app.simulation_finish(%s,%s,%s)', (*current, Jsonb(output))).fetchone()[0] is False
    with psycopg.connect(planning[0]) as db:
        assert db.execute('select count(*) from planning.simulation_inputs where run_id=%s', (run,)).fetchone()[0] == 0
        assert db.execute('select count(*) from public.policy_simulations where run_id=%s', (run,)).fetchone()[0] == 0
