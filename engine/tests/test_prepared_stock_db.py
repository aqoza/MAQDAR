"""Saved source-unit and relationship evidence across the real worker pipeline."""
import json
from decimal import Decimal
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker
from test_preparation_db import enqueue_preparation
from test_policy_db import enqueue_policy
from zeespare_engine.preparation import prepare
from zeespare_engine.worker import process_one

pytestmark = pytest.mark.db


def login(db, fixture):
    db.execute('set local role authenticated')
    db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps({
        'sub': str(fixture[2]), 'org_id': str(fixture[1]), 'role': 'authenticated',
    }),))


def enqueue_pool(fixture):
    run = enqueue_preparation(fixture)
    with psycopg.connect(fixture[0]) as db:
        db.execute('''insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction)
            select organization_id,predecessor_item_id,successor_item_id,'two_way'
            from public.item_supersessions where organization_id=%s''', (fixture[1],))
        db.execute('delete from public.item_supersessions where organization_id=%s', (fixture[1],))
        db.execute("update public.demand_history set unit_of_measure='EA' where organization_id=%s", (fixture[1],))
    return run


def test_pool_evidence_survives_retry_and_live_edits_through_policy(planning):
    run = enqueue_pool(planning)
    with worker(planning[0]) as db:
        claim = db.execute('select * from app.planning_claim()').fetchone()
        captured = db.execute('select app.planning_task(%s,%s)', claim).fetchone()[0]
        assert sorted(i['unit_provenance']['rows'] for i in captured['items']) == [0, 1]
        assert db.execute('select app.planning_fail(%s,%s)', claim).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute('delete from public.item_interchanges where organization_id=%s', (planning[1],))
        db.execute("update public.items set unit_of_measure='KG' where organization_id=%s", (planning[1],))
        db.execute("update public.demand_history set quantity=999,unit_of_measure='SET' where organization_id=%s", (planning[1],))
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s", (str(run),))
    with worker(planning[0]) as db:
        replacement = db.execute('select * from app.planning_claim()').fetchone()
        assert db.execute('select app.planning_task(%s,%s)', replacement).fetchone()[0] == captured
        assert db.execute('select app.preparation_finish(%s,%s,%s)', (*replacement, Jsonb(prepare(captured)))).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        prepared = db.execute('select id from public.demand_preparations where run_id=%s', (run,)).fetchone()[0]
        login(db, planning)
        forecast_run = db.execute('select public.forecast_prepared_enqueue(%s,%s,%s,7,true)', (planning[1], prepared, uuid4())).fetchone()[0]
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        forecast_id, evidence = db.execute('select id,evidence from public.forecast_results where run_id=%s', (forecast_run,)).fetchone()
        pool = evidence['source']['preparation']['stock_pool']
        assert pool['status'] == 'eligible'
        assert pool['unit_provenance'] == dict(method='source-units-v1', status='consistent', unit='EA', rows=1, unknown_rows=0, units=['EA'])
        assert len(pool['members']) == 2
    policy_run = enqueue_policy(planning, forecast_id)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        policy_id, status, unit, evidence = db.execute('select id,status,unit,evidence from public.inventory_policies where run_id=%s', (policy_run,)).fetchone()
        assert status == 'available' and unit == 'EA'
        assert evidence['forecast']['source']['preparation']['stock_pool'] == pool
        db.execute('''insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
            select i.organization_id,i.id,l.id,'2026-10-01',12,2,1.125,'KWD','EA'
            from public.items i join public.locations l on l.organization_id=i.organization_id where i.organization_id=%s''', (planning[1],))
        login(db, planning)
        report = db.execute("select public.policy_stock_comparison(%s,%s,'2026-10-01','calculated')", (planning[1], policy_id)).fetchone()[0]
        assert report['status'] == 'available'
        assert Decimal(report['pool']['available']) == 20
        assert Decimal(report['quantity_above']) == max(Decimal(20) - Decimal(report['maximum']), 0)
        assert report['pool']['inventory_values'] == [dict(currency='KWD', value='27.000000')]
        assert report['value_above'] is None


@pytest.mark.parametrize('inside_unit,expected', [('EA', 'eligible'), (None, 'unknown_units')])
def test_preparation_unit_capture_uses_lifecycle_eligible_rows(planning, inside_unit, expected):
    run = enqueue_pool(planning)
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.items set introduced_on='2026-09-01' where organization_id=%s", (planning[1],))
        db.execute('update public.demand_history set unit_of_measure=%s where organization_id=%s', (inside_unit, planning[1]))
        db.execute('''insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,unit_of_measure)
            select organization_id,item_id,location_id,'2026-08-01',99,'SET'
            from public.demand_history where organization_id=%s''', (planning[1],))
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status, evidence = db.execute('''select status,app.prepared_stock_evidence(evidence->'source',evidence->'output')
            from public.demand_preparations where run_id=%s''', (run,)).fetchone()
        assert status == 'ready'  # The contradictory inactive row was excluded.
        assert evidence['status'] == expected
        assert evidence['unit_provenance']['rows'] == 1
        assert evidence['unit_provenance']['unknown_rows'] == (1 if inside_unit is None else 0)
