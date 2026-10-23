"""Exact scenario arithmetic and independent-session save/access races."""
import time
from decimal import Decimal, localcontext
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_installed_base_db import INPUT as POPULATION_INPUT, population, session  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.installed_base_demand_save(%s,%s,%s,%s)"


def args(population, rows=None, rate="0.000000001", horizon=28):
    with session(population) as db:
        source = {**POPULATION_INPUT, "rows": rows or POPULATION_INPUT["rows"]}
        report = db.execute("select public.installed_base_preview(%s,%s)", (population[1], Jsonb(source))).fetchone()[0]
        dataset = db.execute("select public.installed_base_save(%s,%s,%s,%s)", (population[1], Jsonb(source), uuid4(), report["fingerprint"])).fetchone()[0]
        payload = dict(dataset_id=str(dataset), scenario_name="Demand", cutoff="2026-01-02", horizon_days=horizon, confirmed=True,
                       rates=[dict(group_code=g["group_code"], daily_rate=rate, source="Explicit assumption", available_on="2026-01-02") for g in source["rows"]])
        preview = db.execute("select public.installed_base_demand_preview(%s,%s)", (population[1], Jsonb(payload))).fetchone()[0]
    return population[1], Jsonb(payload), uuid4(), preview["fingerprint"]


@pytest.mark.parametrize("assets,parts,rate,horizon", [
    ("12", "0.001", "0.000000001", 28),
    ("999999999999999", "999999999999999.999", "999999.999999999", 90),
    ("0", "1", "999999.999999999", 1),
    ("12", "2.5", "0", 90),
])
def test_exact_products_and_ledger(population, assets, parts, rate, horizon):
    call_args = args(population, [dict(group_code="A", group_name="Known source", installed_on=None, active_assets=assets, parts_per_asset=parts)], rate, horizon)
    with session(population) as db:
        saved = db.execute(SAVE, call_args).fetchone()[0]
        report = db.execute("select report from public.installed_base_demand_scenarios where id=%s", (saved,)).fetchone()[0]
    with localcontext() as ctx:
        ctx.prec = 100
        expected = Decimal(assets) * Decimal(parts) * Decimal(rate)
        assert Decimal(report["daily_demand"]) == expected
        assert Decimal(report["total_demand"]) == expected * horizon
        assert sum(Decimal(d["expected_demand"]) for d in report["days"]) == expected * horizon
    assert len(report["days"]) == horizon
    assert report["groups"][0]["age_days"] is None
    assert report["source"]["population"]["input"]["as_of"] == "2026-01-01"


def test_thousand_groups_exact_sum(population):
    rows = [dict(group_code=f"G{i:04}", group_name="Group", installed_on=None, active_assets="999999999999999", parts_per_asset="999999999999999.999") for i in range(1000)]
    call_args = args(population, rows, "999999.999999999", 90)
    with session(population) as db:
        report = db.execute("select public.installed_base_demand_preview(%s,%s)", call_args[:2]).fetchone()[0]
    with localcontext() as ctx:
        ctx.prec = 100
        assert Decimal(report["total_demand"]) == Decimal("999999999999999") * Decimal("999999999999999.999") * Decimal("999999.999999999") * 1000 * 90
    assert len(report["groups"]) == 1000 and len(report["days"]) == 90


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_requests_keep_one_record_and_audit(population, conflict):
    original = args(population)
    second = (original[0], Jsonb({**original[1].obj, "scenario_name": "Different"}), *original[2:]) if conflict else original
    with session(population) as a, session(population) as b:
        assert _race(a, b, SAVE, original, second).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(population[0]) as db:
        assert db.execute("select count(*) from public.installed_base_demand_scenarios where organization_id=%s", (population[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='installed_base_demand_scenarios'", (population[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("retry", [False, True])
@pytest.mark.parametrize("change", [
    "update public.memberships set role='viewer' where organization_id=%s and user_id=%s",
    "delete from public.memberships where organization_id=%s and user_id=%s",
])
def test_waiter_rechecks_authority(population, retry, change):
    call_args = args(population)
    if retry:
        with session(population) as db:
            db.execute(SAVE, call_args)
    with psycopg.connect(population[0]) as admin, session(population) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.installed-base-demand:'||%s||':'||%s,0))", (str(population[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (population[1], population[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


@pytest.mark.parametrize("change,expected", [
    ("delete from public.installed_base_datasets where organization_id=%s", "MQ404"),
    ("update public.installed_base_datasets set report=jsonb_set(report,'{input,source}','\"Changed by privileged maintenance\"') where organization_id=%s", "MQ409"),
    ("update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
    ("delete from public.memberships where organization_id=%s", "MQ403"),
])
def test_source_row_wait_rechecks_evidence_and_authority(population, change, expected):
    call_args = args(population)
    with psycopg.connect(population[0]) as admin, session(population) as waiting:
        admin.execute("select id from public.installed_base_datasets where organization_id=%s for update", (population[1],))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (population[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


def test_saved_retry_retains_deleted_population(population):
    call_args = args(population)
    with session(population) as db:
        saved = db.execute(SAVE, call_args).fetchone()[0]
        before = db.execute("select report from public.installed_base_demand_scenarios where id=%s", (saved,)).fetchone()[0]
    with psycopg.connect(population[0]) as admin:
        admin.execute("delete from public.installed_base_datasets where organization_id=%s", (population[1],))
    with session(population) as db:
        assert db.execute(SAVE, call_args).fetchone()[0] == saved
        assert db.execute("select report from public.installed_base_demand_scenarios where id=%s", (saved,)).fetchone()[0] == before
