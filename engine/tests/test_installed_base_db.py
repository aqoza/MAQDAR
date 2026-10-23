"""Independent sessions exercise population retries and authority changes during lock waits."""
import json
import time
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.installed_base_save(%s,%s,%s,%s)"
INPUT = dict(item_code="ITEM", location_code="L", dataset_name="Population", unit="EA",
             source="Synthetic source", as_of="2026-01-01", available_on="2026-01-02",
             confirmed=True, non_overlapping=True,
             rows=[dict(group_code="A", group_name="Group A", installed_on=None,
                        active_assets="12", parts_per_asset="0.001")])


@pytest.fixture
def population(dsn):
    if urlparse(dsn).hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Population fixtures require loopback")
    org, user, location, item = [uuid4() for _ in range(4)]
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Population tests')", (org, f"populations-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"populations-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'L','Location','branch','SA','Asia/Riyadh')", (location, org))
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'ITEM','Item','Test','EA',1,'SAR')", (item, org))
    try:
        yield dsn, org, user
    finally:
        with psycopg.connect(dsn) as db:
            db.execute("delete from public.organizations where id=%s", (org,))
            db.execute("delete from auth.users where id=%s", (user,))
            db.execute("delete from public.audit_log where organization_id=%s", (org,))


def session(population):
    db = psycopg.connect(population[0])
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",
               (json.dumps(dict(sub=str(population[2]), org_id=str(population[1]), role="authenticated")),))
    return db


def args(population):
    with session(population) as db:
        report = db.execute("select public.installed_base_preview(%s,%s)", (population[1], Jsonb(INPUT))).fetchone()[0]
    return population[1], Jsonb(INPUT), uuid4(), report["fingerprint"]


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_requests_keep_one_record_and_audit(population, conflict):
    original = args(population)
    second = (original[0], Jsonb({**INPUT, "dataset_name": "Different"}), *original[2:]) if conflict else original
    with session(population) as a, session(population) as b:
        assert _race(a, b, SAVE, original, second).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(population[0]) as db:
        assert db.execute("select count(*) from public.installed_base_datasets where organization_id=%s", (population[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='installed_base_datasets'", (population[1],)).fetchone()[0] == 1


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
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.installed-base:'||%s||':'||%s,0))", (str(population[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (population[1], population[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


def test_waiting_first_save_refreshes_changed_catalog(population):
    call_args = args(population)
    with psycopg.connect(population[0]) as admin, session(population) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.installed-base:'||%s||':'||%s,0))", (str(population[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute("update public.items set name_en='Changed' where organization_id=%s", (population[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ409"
