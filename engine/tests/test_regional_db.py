import json
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker
from test_preparation_db import enqueue_preparation
from maqdar_engine.worker import process_one
from maqdar_engine.regional_forecasting import forecast

pytestmark = pytest.mark.db


def enqueue(fixture):
    with psycopg.connect(fixture[0]) as db:
        db.execute(
            "update public.demand_history set lost_sales_quantity=2.234 where organization_id=%s",
            (fixture[1],),
        )
    source_run = enqueue_preparation(fixture)
    with worker(fixture[0]) as db:
        assert process_one(db)
    with psycopg.connect(fixture[0]) as db:
        preparation = db.execute(
            "select id from public.demand_preparations where run_id=%s", (source_run,)
        ).fetchone()[0]
        db.execute("set local role authenticated")
        db.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (
                json.dumps(
                    {
                        "sub": str(fixture[2]),
                        "org_id": str(fixture[1]),
                        "role": "authenticated",
                    }
                ),
            ),
        )
        run = db.execute(
            "select public.forecast_prepared_enqueue(%s,%s,%s,7,true)",
            (fixture[1], preparation, uuid4()),
        ).fetchone()[0]
    return run, preparation


def test_real_worker_forecasts_saved_group_with_unknown_future_calendar(planning):
    run, preparation = enqueue(planning)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status, evidence = db.execute(
            "select p.status,f.evidence from public.planning_runs p join public.forecast_results f on f.run_id=p.id where p.id=%s",
            (run,),
        ).fetchone()
        assert status == "succeeded"
        assert evidence["source"]["preparation"]["id"] == str(preparation)
        assert evidence["source"]["demand"][-1][1] == "2.246000"
        assert evidence["source"]["demand"][-1][2] == "4.468000"
        assert evidence["output"]["comparison"] == "fixed-group-v1"
        assert evidence["output"]["calendar_model"]["unknown_future_days"] == 7
        assert len(evidence["output"]["forecast"]) == 7
        assert (
            db.execute(
                "select count(*) from planning.forecast_inputs where run_id=%s", (run,)
            ).fetchone()[0]
            == 0
        )


def test_saved_inputs_survive_live_edits_and_retry_then_reject_canceled_publication(
    planning,
):
    run, preparation = enqueue(planning)
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "update public.demand_history set quantity=999 where organization_id=%s",
            (planning[1],),
        )
        db.execute(
            "update public.item_supersessions set quantity_factor=99 where organization_id=%s",
            (planning[1],),
        )
    with worker(planning[0]) as db:
        lease = db.execute("select * from app.planning_claim()").fetchone()
        snapshot = db.execute("select app.planning_task(%s,%s)", lease).fetchone()[0]
        assert snapshot["items"][0]["demand"][-1][1] == "2.246000"
        assert db.execute("select app.planning_fail(%s,%s)", lease).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "insert into public.holiday_overrides(organization_id,country_code,starts_on,ends_on,kind,name_en) values(%s,'SA','2026-10-02','2026-10-02','working_day','Changed after capture')",
            (planning[1],),
        )
        db.execute(
            "update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s",
            (str(run),),
        )
    with worker(planning[0]) as db:
        replacement = db.execute("select * from app.planning_claim()").fetchone()
        assert (
            db.execute("select app.planning_task(%s,%s)", replacement).fetchone()[0]
            == snapshot
        )
        rows = forecast(snapshot)
        with pytest.raises(psycopg.Error):
            db.execute(
                "select app.forecast_finish(%s,%s,%s)",
                (*replacement, Jsonb([dict(rows[0], item_id=str(uuid4()))])),
            )
        assert (
            db.execute(
                "select app.forecast_finish(%s,%s,%s)", (*lease, Jsonb(rows))
            ).fetchone()[0]
            is False
        )
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=%s",
            (run,),
        )
    with worker(planning[0]) as db:
        assert (
            db.execute("select app.planning_task(%s,%s)", replacement).fetchone()[0]
            is None
        )
        assert (
            db.execute(
                "select app.forecast_finish(%s,%s,%s)", (*replacement, Jsonb(rows))
            ).fetchone()[0]
            is False
        )
    with psycopg.connect(planning[0]) as db:
        db.execute(
            "select set_config('request.jwt.claims',%s,true)",
            (
                json.dumps(
                    {
                        "sub": str(planning[2]),
                        "org_id": str(planning[1]),
                        "role": "authenticated",
                    }
                ),
            ),
        )
        db.execute("select public.planning_cancel(%s,%s)", (planning[1], run))
        assert (
            db.execute(
                "select count(*) from planning.forecast_inputs where run_id=%s", (run,)
            ).fetchone()[0]
            == 0
        )
    with worker(planning[0]) as db:
        assert (
            db.execute(
                "select app.forecast_finish(%s,%s,%s)", (*replacement, Jsonb(rows))
            ).fetchone()[0]
            is False
        )


def test_capture_trims_unavailable_lifecycle_gap_to_contiguous_tail(planning):
    run, preparation = enqueue(planning)
    with psycopg.connect(planning[0]) as db:
        # Simulates a legitimately saved lifecycle gap without changing live demand.
        db.execute(
            """update public.demand_preparations set evidence=jsonb_set(evidence,'{output,daily}',
          (select jsonb_agg(case when d->>'date'='2026-09-01' then d||'{"sold":null,"lost":null,"active_sources":0}'::jsonb else d end order by d->>'date')
            from jsonb_array_elements(evidence->'output'->'daily') d)) where id=%s""",
            (preparation,),
        )
    with worker(planning[0]) as db:
        lease = db.execute("select * from app.planning_claim()").fetchone()
        snapshot = db.execute("select app.planning_task(%s,%s)", lease).fetchone()[0]
        assert snapshot["items"][0]["start_day"] == "2026-09-02"
        assert len(snapshot["items"][0]["demand"]) == 30
        assert forecast(snapshot)[0]["status"] == "insufficient"
