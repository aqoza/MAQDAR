"""Independent Decimal oracles, captured sales, and save/access races."""
import time
from datetime import datetime, timedelta
from decimal import Decimal, localcontext
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_installed_base_db import population, session  # noqa: F401
from test_installed_base_demand_db import args as scenario_args, SAVE as SCENARIO_SAVE
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.installed_base_evaluation_save(%s,%s,%s,%s)"
PREVIEW = "select public.installed_base_evaluation_preview(%s,%s)"


@pytest.fixture
def evaluation(population):
    try:
        yield population
    finally:
        with psycopg.connect(population[0]) as db:
            db.execute("delete from public.demand_history where organization_id=%s", (population[1],))


def args(evaluation, rate="1", assets="3", parts="1", horizon=3, cutoff=None):
    source = scenario_args(evaluation, [dict(group_code="A", group_name="Group", installed_on=None,
                          active_assets=assets, parts_per_asset=parts)], rate, horizon)
    with session(evaluation) as db:
        if cutoff:
            payload = {**source[1].obj, "cutoff": cutoff}
            fingerprint = db.execute("select public.installed_base_demand_preview(%s,%s)", (evaluation[1], Jsonb(payload))).fetchone()[0]["fingerprint"]
            source = (source[0], Jsonb(payload), source[2], fingerprint)
        scenario = db.execute(SCENARIO_SAVE, source).fetchone()[0]
    return evaluation[1], Jsonb(dict(scenario_id=str(scenario), evaluation_name="Evaluation", confirmed=True))


def sales(evaluation, day="2026-01-03", quantity="1", lost="2", unit="EA"):
    with psycopg.connect(evaluation[0]) as db:
        db.execute("""insert into public.demand_history(organization_id,item_id,location_id,demand_date,quantity,lost_sales_quantity,unit_of_measure)
          select i.organization_id,i.id,l.id,%s,%s,%s,%s from public.items i join public.locations l using(organization_id)
          where i.organization_id=%s""", (day, quantity, lost, unit, evaluation[1]))


def saved_args(evaluation):
    call = args(evaluation)
    sales(evaluation)
    with session(evaluation) as db:
        return (*call, uuid4(), db.execute(PREVIEW, call).fetchone()[0]["fingerprint"])


@pytest.mark.parametrize("assets,parts,rate", [
    ("3", "1", "1"), ("12", "0.001", "0.000000001"),
    ("999999999999999", "999999999999999.999", "999999.999999999"),
    ("0", "1", "0"),
])
def test_decimal_oracle(evaluation, assets, parts, rate):
    call = args(evaluation, rate, assets, parts)
    sales(evaluation)
    sales(evaluation, "2026-01-05", "5", "0")
    with session(evaluation) as db:
        report = db.execute(PREVIEW, call).fetchone()[0]
    with localcontext() as ctx:
        ctx.prec = 150
        expected = Decimal(assets)*Decimal(parts)*Decimal(rate)
        errors = [expected-1, expected, expected-5]
        absolute = sum(abs(e) for e in errors)
        squared = sum(e*e for e in errors)
        assert Decimal(report["totals"]["expected"]) == 3*expected
        assert Decimal(report["totals"]["squared_error"]) == squared
        assert Decimal(report["totals"]["absolute_error"]) == absolute
        tolerance = Decimal("0.000000000000000000000001")
        assert abs(Decimal(report["metrics"]["mae"]) - absolute/3) <= tolerance
        assert abs(Decimal(report["metrics"]["rmse"]) - (squared/3).sqrt()) <= tolerance
        assert abs(Decimal(report["metrics"]["bias"]) - sum(errors)/3) <= tolerance
    assert report["totals"]["sold"] == "6" and report["totals"]["lost_sales"] == "2"
    assert report["days"][1]["recorded"] is False


@pytest.mark.parametrize("unit", [None, "KG"])
def test_lost_only_row_requires_matching_unit(evaluation, unit):
    call = args(evaluation)
    sales(evaluation, quantity="0", unit=unit)
    with session(evaluation) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW, call)
    assert error.value.sqlstate == "MQ422"


@pytest.mark.parametrize("days_ago,allowed", [(1, False), (2, True)])
def test_today_is_not_completed(evaluation, days_ago, allowed):
    cutoff = (datetime.now(ZoneInfo("Asia/Riyadh")).date()-timedelta(days=days_ago)).isoformat()
    call = args(evaluation, horizon=1, cutoff=cutoff)
    with session(evaluation) as db:
        if allowed:
            report = db.execute(PREVIEW, call).fetchone()[0]
            assert report["recorded_days"] == 0 and report["zero_filled_days"] == 1
            assert report["metrics"]["rmse"] == "3"
        else:
            with pytest.raises(psycopg.Error) as error:
                db.execute(PREVIEW, call)
            assert error.value.sqlstate == "MQ422"


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_canonical_requests(evaluation, conflict):
    original = saved_args(evaluation)
    second = (original[0], Jsonb({**original[1].obj, "evaluation_name": "Other"}), *original[2:]) if conflict else original
    with session(evaluation) as a, session(evaluation) as b:
        assert _race(a,b,SAVE,original,second).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(evaluation[0]) as db:
        assert db.execute("select count(*) from public.installed_base_evaluations where organization_id=%s", (evaluation[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='installed_base_evaluations'", (evaluation[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("retry", [False, True])
@pytest.mark.parametrize("change,expected", [
    ("update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
    ("delete from public.memberships where organization_id=%s", "MQ403"),
    ("update public.demand_history set quantity=8 where organization_id=%s", "MQ409"),
])
def test_retry_wait_rechecks_authority_and_capture(evaluation, retry, change, expected):
    call_args = saved_args(evaluation)
    if retry:
        with session(evaluation) as db:
            db.execute(SAVE,call_args)
    with psycopg.connect(evaluation[0]) as admin, session(evaluation) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.installed-base-evaluation:'||%s||':'||%s,0))", (str(evaluation[1]),str(call_args[2])))
        call = _Call(waiting,SAVE,call_args); call.start(); time.sleep(1)
        assert not call.finished
        admin.execute(change,(evaluation[1],)); admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate == (None if retry and expected=="MQ409" else expected)


@pytest.mark.parametrize("change,expected", [
    ("delete from public.installed_base_demand_scenarios where organization_id=%s", "MQ404"),
    ("update public.installed_base_demand_scenarios set report=jsonb_set(report,'{input,scenario_name}','\"Changed\"') where organization_id=%s", "MQ409"),
    ("update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
])
def test_source_row_wait_rechecks(evaluation, change, expected):
    call_args = saved_args(evaluation)
    with psycopg.connect(evaluation[0]) as admin, session(evaluation) as waiting:
        admin.execute("select id from public.installed_base_demand_scenarios where organization_id=%s for update",(evaluation[1],))
        call = _Call(waiting,SAVE,call_args); call.start(); time.sleep(1)
        assert not call.finished
        admin.execute(change,(evaluation[1],)); admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


def test_captured_sales_and_scenario_survive_source_deletion(evaluation):
    call_args = saved_args(evaluation)
    with session(evaluation) as db:
        saved = db.execute(SAVE,call_args).fetchone()[0]
        original = db.execute("select report from public.installed_base_evaluations where id=%s",(saved,)).fetchone()[0]
    with psycopg.connect(evaluation[0]) as db:
        db.execute("delete from public.demand_history where organization_id=%s",(evaluation[1],))
        db.execute("delete from public.installed_base_demand_scenarios where organization_id=%s",(evaluation[1],))
    with session(evaluation) as db:
        assert db.execute(SAVE,call_args).fetchone()[0] == saved
        assert db.execute("select report from public.installed_base_evaluations where id=%s",(saved,)).fetchone()[0] == original
