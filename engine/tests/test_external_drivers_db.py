"""Independent sessions exercise driver retries and authority changes during lock waits."""
import json
import time
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.external_driver_save(%s,%s,%s,%s)"
INPUT = dict(item_code="ITEM", location_code="L", driver_name="Temperature", unit="C",
             source="Synthetic source", history_from="2026-01-01", cutoff="2026-01-02",
             forecast_to="2026-01-04", confirmed=True,
             rows=[dict(date="2026-01-01", value="-1.000001", kind="observed", available_on="2026-01-02")])


@pytest.fixture
def driver(dsn):
    if urlparse(dsn).hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Driver fixtures require loopback")
    org, user, location, item = [uuid4() for _ in range(4)]
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Driver tests')", (org, f"drivers-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"drivers-{user}@test.local"))
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


def session(driver):
    db = psycopg.connect(driver[0])
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",
               (json.dumps(dict(sub=str(driver[2]), org_id=str(driver[1]), role="authenticated")),))
    return db


def args(driver):
    with session(driver) as db:
        report = db.execute("select public.external_driver_preview(%s,%s)", (driver[1], Jsonb(INPUT))).fetchone()[0]
    return driver[1], Jsonb(INPUT), uuid4(), report["fingerprint"]


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_requests_keep_one_record_and_audit(driver, conflict):
    original = args(driver)
    second = (original[0], Jsonb({**INPUT, "driver_name": "Different"}), *original[2:]) if conflict else original
    with session(driver) as a, session(driver) as b:
        assert _race(a, b, SAVE, original, second).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(driver[0]) as db:
        assert db.execute("select count(*) from public.external_driver_datasets where organization_id=%s", (driver[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='external_driver_datasets'", (driver[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("retry", [False, True])
@pytest.mark.parametrize("change", [
    "update public.memberships set role='viewer' where organization_id=%s and user_id=%s",
    "delete from public.memberships where organization_id=%s and user_id=%s",
])
def test_waiter_rechecks_authority(driver, retry, change):
    call_args = args(driver)
    if retry:
        with session(driver) as db:
            db.execute(SAVE, call_args)
    with psycopg.connect(driver[0]) as admin, session(driver) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.external-driver:'||%s||':'||%s,0))", (str(driver[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (driver[1], driver[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


def test_waiting_first_save_refreshes_changed_catalog(driver):
    call_args = args(driver)
    with psycopg.connect(driver[0]) as admin, session(driver) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.external-driver:'||%s||':'||%s,0))", (str(driver[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute("update public.items set name_en='Changed' where organization_id=%s", (driver[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ409"
