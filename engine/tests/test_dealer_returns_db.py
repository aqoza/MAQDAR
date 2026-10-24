"""Independent local sessions exercise return retries and current authority after waits."""
import json
import time
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.dealer_return_save(%s,%s,%s)"
WITHDRAW = "select public.dealer_return_withdraw(%s,%s,%s)"
INPUT = dict(item_code="ITEM", source_code="B", location_code="H", quantity="2.125", unit="EA",
             requested_date="2026-10-24", condition="unknown", reason="Declared return", confirmed=True)


@pytest.fixture
def returns(dsn):
    if urlparse(dsn).hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Return fixtures require loopback")
    org, user = uuid4(), uuid4()
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Return tests')", (org, f"returns-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"returns-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        for code, kind in [("B", "branch"), ("H", "hub")]:
            db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'Location',%s,'SA','Asia/Riyadh')", (org, code, kind))
        db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,'ITEM','Item','Test','EA',1,'SAR')", (org,))
    try:
        yield dsn, org, user
    finally:
        with psycopg.connect(dsn) as db:
            db.execute("delete from public.organizations where id=%s", (org,))
            db.execute("delete from auth.users where id=%s", (user,))
            db.execute("delete from public.audit_log where organization_id=%s", (org,))


def session(returns):
    db = psycopg.connect(returns[0])
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(returns[2]), role="authenticated")),))
    return db


@pytest.mark.parametrize("conflict", [False, True])
def test_return_retry_serialization(returns, conflict):
    args = returns[1], Jsonb(INPUT), uuid4()
    other = (args[0], Jsonb({**INPUT, "quantity": "3"}), args[2]) if conflict else args
    with session(returns) as first, session(returns) as second:
        assert _race(first, second, SAVE, args, other).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(returns[0]) as db:
        assert db.execute("select count(*) from public.dealer_return_requests where organization_id=%s", (returns[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='dealer_return_requests'", (returns[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("retry", [False, True])
def test_return_rechecks_editor_after_wait(returns, retry):
    args = returns[1], Jsonb(INPUT), uuid4()
    if retry:
        with session(returns) as db:
            db.execute(SAVE, args)
    with psycopg.connect(returns[0]) as admin, session(returns) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.dealer-return:'||%s||':'||%s,0))", (str(returns[1]), str(args[2])))
        call = _Call(waiting, SAVE, args)
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s", (returns[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


@pytest.mark.parametrize("table,change,expected", [
    ("locations", "update public.locations set is_active=false where organization_id=%s", "MQ404"),
    ("items", "update public.items set unit_of_measure='SET' where organization_id=%s", "MQ422"),
    ("locations", "delete from public.memberships where organization_id=%s", "MQ403"),
])
def test_return_rechecks_after_catalog_wait(returns, table, change, expected):
    with psycopg.connect(returns[0]) as admin, session(returns) as waiting:
        admin.execute(f"select id from public.{table} where organization_id=%s order by id for update", (returns[1],))
        call = _Call(waiting, SAVE, (returns[1], Jsonb(INPUT), uuid4()))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute(change, (returns[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


@pytest.mark.parametrize("retry", [False, True])
def test_withdraw_rechecks_membership_after_wait(returns, retry):
    with session(returns) as db:
        saved = db.execute(SAVE, (returns[1], Jsonb(INPUT), uuid4())).fetchone()[0]
        if retry:
            db.execute(WITHDRAW, (returns[1], saved, "Correction"))
    with psycopg.connect(returns[0]) as admin, session(returns) as waiting:
        admin.execute("select id from public.dealer_return_requests where id=%s for update", (saved,))
        call = _Call(waiting, WITHDRAW, (returns[1], saved, "Correction"))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("delete from public.memberships where organization_id=%s", (returns[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ404"


def test_withdraw_concurrency_keeps_one_update(returns):
    with session(returns) as db:
        saved = db.execute(SAVE, (returns[1], Jsonb(INPUT), uuid4())).fetchone()[0]
    args = returns[1], saved, "Correction"
    with session(returns) as first, session(returns) as second:
        assert _race(first, second, WITHDRAW, args, args).sqlstate is None
    with psycopg.connect(returns[0]) as db:
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='dealer_return_requests' and operation='UPDATE'", (returns[1],)).fetchone()[0] == 1
