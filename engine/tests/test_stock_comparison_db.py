"""Source-unit capture, publication and policy propagation on the local worker boundary."""
import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker, enqueue_forecast, forecast
from test_policy_db import enqueue_policy
from test_preparation_db import enqueue_preparation
from maqdar_engine.preparation import prepare
from maqdar_engine.worker import process_one

pytestmark = pytest.mark.db


def test_preparation_captures_unit_conflicts_and_fences_older_workers(planning):
    label_history(planning, 'SET')
    run = enqueue_preparation(planning)
    with worker(planning[0]) as db:
        claim = db.execute('select * from app.planning_claim()').fetchone()
        captured = db.execute('select app.planning_task(%s,%s)', claim).fetchone()[0]
        assert any(item['unit_conflict'] for item in captured['items'])
        rows = prepare(captured)
        assert rows[0]['status'] == 'blocked' and rows[0]['issue'] == 'unit_mismatch'
        older_input = dict(captured, items=[dict(item, unit_conflict=False) for item in captured['items']])
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.preparation_finish(%s,%s,%s)', (*claim, Jsonb(prepare(older_input))))
        assert error.value.sqlstate == 'MQ422'
        assert db.execute('select app.preparation_finish(%s,%s,%s)', (*claim, Jsonb(rows))).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        assert db.execute('select status from public.demand_preparations where run_id=%s', (run,)).fetchone()[0] == 'blocked'


def label_history(fixture, unit):
    with psycopg.connect(fixture[0]) as db:
        db.execute('update public.demand_history set unit_of_measure=%s where organization_id=%s', (unit, fixture[1]))


def test_unit_capture_is_immutable_and_flows_into_policy(planning):
    label_history(planning, 'EA')
    run = enqueue_forecast(planning)
    with worker(planning[0]) as db:
        claim = db.execute('select * from app.planning_claim()').fetchone()
        captured = db.execute('select app.planning_task(%s,%s)', claim).fetchone()[0]
    expected = dict(method='source-units-v1', status='consistent', unit='EA', rows=1, unknown_rows=0, units=['EA'])
    assert captured['items'][0]['unit_provenance'] == expected
    label_history(planning, 'SET')
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.items set unit_of_measure='KG' where organization_id=%s", (planning[1],))
    with worker(planning[0]) as db:
        assert db.execute('select app.planning_task(%s,%s)', claim).fetchone()[0] == captured
        assert db.execute('select app.forecast_finish(%s,%s,%s)', (*claim, Jsonb(forecast(captured)))).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        source = db.execute('select id,evidence from public.forecast_results where run_id=%s', (run,)).fetchone()
        assert source[1]['source']['unit_provenance'] == expected
    policy = enqueue_policy(planning, source[0])
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        unit, evidence = db.execute('select unit,evidence from public.inventory_policies where run_id=%s', (policy,)).fetchone()
        assert unit == 'EA'
        assert evidence['forecast']['source']['unit_provenance'] == expected


@pytest.mark.parametrize('expanded', [False, True])
def test_mixed_units_publish_a_diagnostic_and_fence_old_worker_output(planning, expanded):
    label_history(planning, 'EA')
    with psycopg.connect(planning[0]) as db:
        db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,unit_of_measure) select organization_id,item_id,location_id,'2026-09-30',2,'SET' from public.demand_history where organization_id=%s", (planning[1],))
    run = enqueue_forecast(planning, expanded)
    with worker(planning[0]) as db:
        claim = db.execute('select * from app.planning_claim()').fetchone()
        captured = db.execute('select app.planning_task(%s,%s)', claim).fetchone()[0]
        rows = forecast(captured)
        assert rows[0]['status'] == 'incompatible_units'
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.forecast_finish(%s,%s,%s)', (*claim, Jsonb([dict(rows[0], status='insufficient')])) )
        assert error.value.sqlstate == 'MQ422'
        assert db.execute('select app.forecast_finish(%s,%s,%s)', (*claim, Jsonb(rows))).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        status, evidence = db.execute('select status,evidence from public.forecast_results where run_id=%s', (run,)).fetchone()
        assert status == 'incompatible_units'
        assert evidence['source']['unit_provenance']['units'] == ['EA', 'SET']


def test_partial_units_do_not_infer_a_label(planning):
    with psycopg.connect(planning[0]) as db:
        db.execute("insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,unit_of_measure) select organization_id,item_id,location_id,'2026-09-30',2,'EA' from public.demand_history where organization_id=%s", (planning[1],))
    run = enqueue_forecast(planning)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status, evidence = db.execute('select status,evidence from public.forecast_results where run_id=%s', (run,)).fetchone()
        assert status == 'selected'
        assert evidence['source']['unit_provenance'] == dict(method='source-units-v1', status='unknown', unit=None, rows=2, unknown_rows=1, units=['EA'])
