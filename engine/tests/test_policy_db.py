import json
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker, enqueue_forecast
from test_regional_db import enqueue as enqueue_regional
from zeespare_engine.worker import process_one
from zeespare_engine.inventory_policy import calculate

pytestmark = pytest.mark.db


def enqueue_policy(fixture, forecast_id, request=None):
    with psycopg.connect(fixture[0]) as db:
        db.execute("set local role authenticated")
        db.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (
                json.dumps(
                    dict(
                        sub=str(fixture[2]),
                        org_id=str(fixture[1]),
                        role="authenticated",
                    )
                ),
            ),
        )
        return db.execute(
            "select public.policy_enqueue(%s,%s,%s,3,4,0.95)",
            (fixture[1], forecast_id, request or uuid4()),
        ).fetchone()[0]


def saved_forecast(fixture, regional=False):
    run = enqueue_regional(fixture)[0] if regional else enqueue_forecast(fixture)
    with worker(fixture[0]) as db:
        assert process_one(db)
    with psycopg.connect(fixture[0]) as db:
        return db.execute(
            "select id from public.forecast_results where run_id=%s", (run,)
        ).fetchone()[0]


@pytest.mark.parametrize("regional", [False, True])
def test_worker_publishes_policy_with_exact_saved_source_and_units(planning, regional):
    source = saved_forecast(planning, regional)
    run = enqueue_policy(planning, source)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status, unit, evidence = db.execute(
            "select status,unit,evidence from public.inventory_policies where run_id=%s",
            (run,),
        ).fetchone()
        assert status == "available"
        assert unit == ("EA" if regional else None)
        original = db.execute(
            "select evidence from public.forecast_results where id=%s", (source,)
        ).fetchone()[0]
        assert evidence["forecast"]["source"] == original["source"]
        assert evidence["forecast"]["output"] == original["output"]
        assert evidence["output"]["residual_count"] >= 20
        assert (
            db.execute(
                "select count(*) from planning.policy_inputs where run_id=%s", (run,)
            ).fetchone()[0]
            == 0
        )


def test_policy_capture_retry_cancellation_and_stale_lease(planning):
    source = saved_forecast(planning)
    request = uuid4()
    run = enqueue_policy(planning, source, request)
    assert enqueue_policy(planning, source, request) == run
    with psycopg.connect(planning[0]) as db:
        captured = db.execute(
            "select payload from planning.policy_inputs where run_id=%s", (run,)
        ).fetchone()[0]
        db.execute(
            "update public.items set unit_of_measure=%s where organization_id=%s",
            ("SET", planning[1]),
        )
        db.execute(
            "update public.demand_history set quantity=999 where organization_id=%s",
            (planning[1],),
        )
    with worker(planning[0]) as db:
        old = db.execute("select * from app.planning_claim()").fetchone()
        assert (
            db.execute("select app.planning_task(%s,%s)", old).fetchone()[0] == captured
        )
        assert db.execute("select app.planning_fail(%s,%s)", old).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s",
            (str(run),),
        )
        # Saved evidence is already copied; deletion by a privileged retention job cannot change it.
        db.execute(
            "delete from public.planning_runs where id=(select run_id from public.forecast_results where id=%s)",
            (source,),
        )
    rows = calculate(captured)
    with worker(planning[0]) as db:
        current = db.execute("select * from app.planning_claim()").fetchone()
        assert (
            db.execute("select app.planning_task(%s,%s)", current).fetchone()[0]
            == captured
        )
        assert (
            db.execute(
                "select app.policy_finish(%s,%s,%s)", (*old, Jsonb(rows))
            ).fetchone()[0]
            is False
        )
        with pytest.raises(psycopg.Error):
            db.execute(
                "select app.policy_finish(%s,%s,%s)",
                (*current, Jsonb([dict(rows[0], protection=None)])),
            )
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=%s",
            (run,),
        )
    with worker(planning[0]) as db:
        assert (
            db.execute("select app.planning_task(%s,%s)", current).fetchone()[0] is None
        )
        assert (
            db.execute(
                "select app.policy_finish(%s,%s,%s)", (*current, Jsonb(rows))
            ).fetchone()[0]
            is False
        )
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (
                json.dumps(
                    dict(
                        sub=str(planning[2]),
                        org_id=str(planning[1]),
                        role="authenticated",
                    )
                ),
            ),
        )
        db.execute("select public.planning_cancel(%s,%s)", (planning[1], run))
        assert (
            db.execute(
                "select count(*) from planning.policy_inputs where run_id=%s", (run,)
            ).fetchone()[0]
            == 0
        )
    with worker(planning[0]) as db:
        assert (
            db.execute(
                "select app.policy_finish(%s,%s,%s)", (*current, Jsonb(rows))
            ).fetchone()[0]
            is False
        )
