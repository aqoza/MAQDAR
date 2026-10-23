"""Real captured-calendar parity, authorization, retries and publication tests."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import time
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker
from test_simulation_db import policy
from test_constraints_db import simulation, enqueue as constraints_enqueue, config
from zeespare_engine.worker import process_one
from zeespare_engine.policy_calendars import calculate

pytestmark = pytest.mark.db


@pytest.fixture
def comparison(planning, simulation):
    run = constraints_enqueue(planning, simulation, maxima=[
        config("6", 0, 1, "0", "2.5"), config("6", 3, 2, "10", "4"),
        config("999999999999999.999", 365, 365, "0", "0.008"),
    ])
    with worker(planning[0]) as db:
        assert process_one(db)
    calendar = uuid4()
    with psycopg.connect(planning[0]) as db:
        db.execute("""insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
         values(%s,%s,'CAL','Calendar','SA',array[5,6],false)""", (calendar,planning[1]))
        db.execute("update public.locations set work_calendar_id=%s where organization_id=%s", (calendar,planning[1]))
    return run, calendar


def call(planning, function, args, user=None, org=None, application_name="calendar-test"):
    with psycopg.connect(planning[0], application_name=application_name) as db:
        db.execute("set local role authenticated")
        db.execute("select set_config('request.jwt.claims',%s,true)",
                   (json.dumps(dict(sub=str(user or planning[2]), org_id=str(org or planning[1]), role="authenticated")),))
        # Function names are test constants, never caller input.
        return db.execute(f"select public.{function}({','.join(['%s']*len(args))})", args).fetchone()[0]


def preview(planning, comparison):
    return call(planning, "simulation_calendars_preview", (planning[1], *comparison))


def enqueue(planning, comparison, captured, request=None):
    return call(planning, "simulation_calendars_enqueue",
                (planning[1], *comparison, request or uuid4(), captured["fingerprint"], True))


def test_real_worker_exact_parity_and_saved_evidence_survives_changes(planning, comparison):
    captured = preview(planning, comparison)
    request = uuid4()
    run = enqueue(planning, comparison, captured, request)
    with psycopg.connect(planning[0]) as db:
        payload = db.execute("select payload from planning.simulation_inputs where run_id=%s", (run,)).fetchone()[0]
        assert db.execute("select app.simulation_calendar_output(%s)", (Jsonb(payload),)).fetchone()[0] == calculate(payload)
        db.execute("update public.work_calendars set weekend_days=array[1,2] where id=%s", (comparison[1],))
        db.execute("delete from public.planning_runs where id=%s", (comparison[0],))
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        evidence = db.execute("select evidence from public.policy_simulations where run_id=%s", (run,)).fetchone()[0]
        assert evidence == dict(payload, output=calculate(payload))
        assert evidence["source_comparison"]["evidence"] == captured["source_comparison"]["evidence"]
        assert db.execute("select count(*) from planning.simulation_inputs where run_id=%s", (run,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (planning[1],)).fetchone()[0] == 0
    assert enqueue(planning, comparison, captured, request) == run


def test_changed_calendar_requires_refresh_and_concurrent_retry_is_single_run(planning, comparison):
    captured = preview(planning, comparison)
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.work_calendars set weekend_days=array[1] where id=%s", (comparison[1],))
    with pytest.raises(psycopg.Error) as error:
        enqueue(planning, comparison, captured)
    assert error.value.sqlstate == "MQ409"
    fresh = preview(planning, comparison)
    assert fresh["fingerprint"] != captured["fingerprint"]
    request = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(lambda _: enqueue(planning, comparison, fresh, request), range(2)))
    assert runs[0] == runs[1]
    with pytest.raises(psycopg.Error) as error:
        enqueue(planning, comparison, captured, request)
    assert error.value.sqlstate == "MQ409"


def test_missing_holiday_coverage_publishes_explicit_unavailable_diagnosis(planning, comparison):
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.work_calendars set observe_public_holidays=true where id=%s", (comparison[1],))
    captured = preview(planning, comparison)
    run = enqueue(planning, comparison, captured)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        evidence = db.execute("select evidence from public.policy_simulations where run_id=%s", (run,)).fetchone()[0]
        assert evidence["output"] == calculate(evidence)
        assert evidence["output"]["status"] == "calendar_unknown"
        assert evidence["output"]["variants"] == []


def test_output_tampering_and_expired_lease_cannot_publish(planning, comparison):
    run = enqueue(planning, comparison, preview(planning, comparison))
    with worker(planning[0]) as db:
        claim = db.execute("select * from app.planning_claim()").fetchone()
        assert claim[0] == run
        payload = db.execute("select app.planning_task(%s,%s)", claim).fetchone()[0]
        output = calculate(payload)
        for key in ("order_quantity", "order_due", "nominal_reviews", "order_gap", "closing_stock", "receipt_search"):
            changed = deepcopy(output)
            changed["variants"][0]["ledger"][0][key] = "tampered"
            with pytest.raises(psycopg.Error) as error:
                db.execute("select app.simulation_finish(%s,%s,%s)", (*claim, Jsonb(changed)))
            assert error.value.sqlstate == "MQ422"
        with pytest.raises(psycopg.Error):
            db.execute("select app.simulation_finish(%s,%s,%s)", (*claim, Jsonb(dict(output, variants=[]))))
    with psycopg.connect(planning[0]) as db:
        db.execute("update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=%s", (run,))
    with worker(planning[0]) as db:
        assert db.execute("select app.simulation_finish(%s,%s,%s)", (*claim, Jsonb(output))).fetchone()[0] is False


def test_current_membership_branch_and_tenant_boundaries(planning, comparison):
    captured = preview(planning, comparison)
    for role in ("viewer", "approver", "branch_user"):
        with psycopg.connect(planning[0]) as db:
            db.execute("update public.memberships set role=%s where organization_id=%s", (role, planning[1]))
        with pytest.raises(psycopg.Error) as error:
            enqueue(planning, comparison, captured)
        assert error.value.sqlstate == "MQ403"
        if role == "branch_user":
            with pytest.raises(psycopg.Error) as error:
                preview(planning, comparison)
            assert error.value.sqlstate == "MQ404"
        else:
            assert preview(planning, comparison)["fingerprint"] == captured["fingerprint"]
    with psycopg.connect(planning[0]) as db:
        db.execute("update public.memberships set role='planner' where organization_id=%s", (planning[1],))
    with pytest.raises(psycopg.Error) as error:
        call(planning, "simulation_calendars_preview", (planning[1], *comparison), org=uuid4())
    assert error.value.sqlstate == "MQ404"
    with pytest.raises(psycopg.Error) as error:
        call(planning, "simulation_calendars_preview", (planning[1], *comparison), user=uuid4())
    assert error.value.sqlstate == "MQ404"
    with pytest.raises(psycopg.Error) as error:
        preview(planning, (comparison[0], uuid4()))
    assert error.value.sqlstate == "MQ422"


def test_sql_python_calendar_boundary_parity(dsn):
    from datetime import date, timedelta
    from test_policy_calendars import task
    cases = [
        config("6", 0, 1, "10", "0.007"), config("6", 1, 2, "0", "2.5"),
        config("0", 0, 365, "0", "1"), config("999999999999999.999",365,365,"0","0.008"),
    ]
    with psycopg.connect(dsn) as db:
        for settings in cases:
            for offset in range(4):
                captured = task([settings])
                for stage in ("ordering", "receiving"):
                    for key, day in captured["calendars"][f"{stage}_days"].items():
                        day["working"] = (date.fromisoformat(key).weekday()+offset)%7 not in (5,6)
                expected = calculate(captured)
                actual = db.execute("select app.simulation_calendar_output(%s)", (Jsonb(captured),)).fetchone()[0]
                assert actual == expected
        for working in (False, None):
            captured = task()
            for n in range(90):
                captured["calendars"]["receiving_days"][str(date(2026,1,2)+timedelta(days=n))]["working"] = working
            assert db.execute("select app.simulation_calendar_output(%s)", (Jsonb(captured),)).fetchone()[0] == calculate(captured)


@pytest.mark.parametrize("retry", [False, True])
def test_membership_revoked_while_waiting_for_request_lock(planning, comparison, retry):
    captured, request = preview(planning, comparison), uuid4()
    assert captured["options"]["calendars_confirmed"] is False
    if retry:
        enqueue(planning, comparison, captured, request)
        with worker(planning[0]) as db:
            assert process_one(db)
    name = f"calendars-authority-{uuid4()}"
    with psycopg.connect(planning[0]) as lock:
        lock.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||%s,0))", (str(planning[1]),))
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(call, planning, "simulation_calendars_enqueue",
                (planning[1], *comparison, request, captured["fingerprint"], True), application_name=name)
            try:
                with psycopg.connect(planning[0], autocommit=True) as admin:
                    deadline, waiting = time.monotonic()+10, False
                    while time.monotonic() < deadline:
                        waiting = admin.execute("select exists(select 1 from pg_stat_activity where application_name=%s and wait_event_type='Lock')", (name,)).fetchone()[0]
                        if waiting: break
                        time.sleep(0.02)
                    assert waiting
                    admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (planning[1], planning[2]))
            finally:
                lock.commit()
            with pytest.raises(psycopg.Error) as error:
                pending.result(timeout=10)
            assert error.value.sqlstate == "MQ403"
