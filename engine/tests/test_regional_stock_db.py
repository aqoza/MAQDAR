"""Independent sessions exercise regional retries and authority changes during lock waits."""
import json
import time
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.regional_stock_save(%s,%s,%s,%s)"
INPUT = dict(item_code="ITEM", location_codes=["L", "M"], assessment_name="Regional", unit="EA",
             as_of="2026-01-01", confirmed=True)


@pytest.fixture
def regional(dsn):
    if urlparse(dsn).hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Regional fixtures require loopback")
    org, user, location, item = [uuid4() for _ in range(4)]
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Regional tests')", (org, f"regionals-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"regionals-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'L','Location','branch','SA','Asia/Riyadh')", (location, org))
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'ITEM','Item','Test','EA',1,'SAR')", (item, org))
        db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,'M','Other','branch','SA','Asia/Riyadh')", (org,))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) select organization_id,%s,id,'2026-01-01',10,2,1,'SAR','EA' from public.locations where organization_id=%s", (item,org))
    try:
        yield dsn, org, user
    finally:
        with psycopg.connect(dsn) as db:
            db.execute("delete from public.organizations where id=%s", (org,))
            db.execute("delete from auth.users where id=%s", (user,))
            db.execute("delete from public.audit_log where organization_id=%s", (org,))


def session(regional):
    db = psycopg.connect(regional[0])
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)",
               (json.dumps(dict(sub=str(regional[2]), org_id=str(regional[1]), role="authenticated")),))
    return db


def args(regional):
    with session(regional) as db:
        report = db.execute("select public.regional_stock_preview(%s,%s)", (regional[1], Jsonb(INPUT))).fetchone()[0]
    return regional[1], Jsonb(INPUT), uuid4(), report["fingerprint"]


@pytest.mark.parametrize("conflict", [False, True])
def test_concurrent_requests_keep_one_record_and_audit(regional, conflict):
    original = args(regional)
    second = (original[0], Jsonb({**INPUT, "assessment_name": "Different"}), *original[2:]) if conflict else original
    with session(regional) as a, session(regional) as b:
        assert _race(a, b, SAVE, original, second).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(regional[0]) as db:
        assert db.execute("select count(*) from public.regional_stock_assessments where organization_id=%s", (regional[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='regional_stock_assessments'", (regional[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("retry", [False, True])
@pytest.mark.parametrize("change", [
    "update public.memberships set role='viewer' where organization_id=%s and user_id=%s",
    "delete from public.memberships where organization_id=%s and user_id=%s",
])
def test_waiter_rechecks_authority(regional, retry, change):
    call_args = args(regional)
    if retry:
        with session(regional) as db:
            db.execute(SAVE, call_args)
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-stock:'||%s||':'||%s,0))", (str(regional[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (regional[1], regional[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


def test_waiting_first_save_refreshes_changed_catalog(regional):
    call_args = args(regional)
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-stock:'||%s||':'||%s,0))", (str(regional[1]), str(call_args[2])))
        call = _Call(waiting, SAVE, call_args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute("update public.items set name_en='Changed' where organization_id=%s", (regional[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ409"


@pytest.mark.parametrize("table", ["items", "locations", "stock_snapshots"])
def test_changed_evidence_refreshed_after_request_lock(regional, table):
    call_args=args(regional)
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-stock:'||%s||':'||%s,0))",(str(regional[1]),str(call_args[2])))
        call=_Call(waiting,SAVE,call_args); call.start(); time.sleep(1)
        assert not call.finished
        column="quantity=11" if table=="stock_snapshots" else "name_en='Changed'"
        admin.execute(f"update public.{table} set {column} where organization_id=%s",(regional[1],)); admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate=="MQ409"


@pytest.mark.parametrize("change,expected", [
    ("update public.locations set name_en='Changed' where organization_id=%s", "MQ409"),
    ("update public.locations set is_active=false where organization_id=%s", "MQ404"),
    ("update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
])
def test_catalog_lock_wait_refreshes_evidence_and_authority(regional,change,expected):
    call_args=args(regional)
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select id from public.locations where organization_id=%s order by id for update",(regional[1],))
        call=_Call(waiting,SAVE,call_args); call.start(); time.sleep(1)
        assert not call.finished
        admin.execute(change,(regional[1],)); admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate==expected


def test_delete_waits_then_cascades_new_assessment(regional):
    call_args=args(regional)
    with session(regional) as saving, psycopg.connect(regional[0]) as deleting:
        saving.execute(SAVE,call_args)
        call=_Call(deleting,"delete from public.stock_snapshots where organization_id=%s",(regional[1],))
        call.start();call.join(timeout=15)
        assert call.finished and call.sqlstate is None
        call=_Call(deleting,"delete from public.locations where organization_id=%s",(regional[1],))
        call.start();time.sleep(1); assert not call.finished
        saving.commit();call.join(timeout=15)
        assert call.finished and call.sqlstate is None
    with psycopg.connect(regional[0]) as db:
        assert db.execute("select count(*) from public.regional_stock_assessments where organization_id=%s",(regional[1],)).fetchone()[0]==0


@pytest.mark.parametrize("retry",[False,True])
def test_scope_revocation_during_retry_wait(regional,retry):
    call_args=args(regional)
    if retry:
        with session(regional) as db: db.execute(SAVE,call_args)
    with psycopg.connect(regional[0]) as admin,session(regional) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-stock:'||%s||':'||%s,0))",(str(regional[1]),str(call_args[2])))
        call=_Call(waiting,SAVE,call_args);call.start();time.sleep(1)
        assert not call.finished
        admin.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",regional[1:])
        admin.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and code='L'",(regional[2],regional[1]));admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ403'
