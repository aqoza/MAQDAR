"""Local concurrent sessions verify fixed membership, archive ordering and live authority."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_regional_stock_db import INPUT, regional, session  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
CREATE = "select public.stock_region_save(%s,%s,%s,%s)"
ARCHIVE = "select public.stock_region_archive(%s,%s)"
ASSESS = "select public.regional_stock_save(%s,%s,%s,%s)"
REGION_INPUT = dict(name_en="Region", name_ar=None, location_codes=["L", "M"], confirmed=True)


def create_args(regional):
    with session(regional) as db:
        preview = db.execute("select public.stock_region_preview(%s,%s)", (regional[1], Jsonb(REGION_INPUT))).fetchone()[0]
    return regional[1], Jsonb(REGION_INPUT), uuid4(), preview["fingerprint"]


def saved_region(regional):
    args = create_args(regional)
    with session(regional) as db:
        result = db.execute(CREATE, args).fetchone()[0]
    return result, args


def assessment_args(regional, region_id):
    data = {key: value for key, value in INPUT.items() if key != "location_codes"}
    data["region_id"] = str(region_id)
    with session(regional) as db:
        preview = db.execute("select public.regional_stock_preview(%s,%s)", (regional[1], Jsonb(data))).fetchone()[0]
    return regional[1], Jsonb(data), uuid4(), preview["fingerprint"]


@pytest.mark.parametrize("conflict", [False, True])
def test_region_create_serializes_retries(regional, conflict):
    args = create_args(regional)
    other = (args[0], Jsonb({**REGION_INPUT, "name_en": "Other"}), *args[2:]) if conflict else args
    with session(regional) as first, session(regional) as second:
        assert _race(first, second, CREATE, args, other).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(regional[0]) as db:
        assert db.execute("select count(*) from public.stock_regions where organization_id=%s", (regional[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='stock_regions'", (regional[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("retry", [False, True])
def test_region_create_rechecks_editor_after_wait(regional, retry):
    args = create_args(regional)
    if retry:
        with session(regional) as db:
            db.execute(CREATE, args)
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.stock-region:'||%s||':'||%s,0))", (str(regional[1]), str(args[2])))
        call = _Call(waiting, CREATE, args)
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s", (regional[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


@pytest.mark.parametrize("change,expected", [
    ("update public.locations set name_en='Changed' where organization_id=%s", "MQ409"),
    ("update public.locations set is_active=false where organization_id=%s", "MQ404"),
    ("update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
])
def test_region_create_refreshes_after_location_wait(regional, change, expected):
    args = create_args(regional)
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select id from public.locations where organization_id=%s order by id for update", (regional[1],))
        call = _Call(waiting, CREATE, args)
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute(change, (regional[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


@pytest.mark.parametrize("retry", [False, True])
def test_archive_rechecks_role_after_row_wait(regional, retry):
    region_id, _ = saved_region(regional)
    if retry:
        with session(regional) as db:
            db.execute(ARCHIVE, (regional[1], region_id))
    with psycopg.connect(regional[0]) as admin, session(regional) as waiting:
        admin.execute("select id from public.stock_regions where id=%s for update", (region_id,))
        call = _Call(waiting, ARCHIVE, (regional[1], region_id))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("delete from public.memberships where organization_id=%s", (regional[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


def test_concurrent_archives_keep_first_attribution_and_one_audit(regional):
    region_id, _ = saved_region(regional)
    with session(regional) as first, session(regional) as second:
        assert _race(first, second, ARCHIVE, (regional[1], region_id), (regional[1], region_id)).sqlstate is None
    with psycopg.connect(regional[0]) as db:
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='stock_regions' and operation='UPDATE'", (regional[1],)).fetchone()[0] == 1


def test_archive_wins_before_new_assessment_rechecks_region(regional):
    region_id, _ = saved_region(regional)
    args = assessment_args(regional, region_id)
    with session(regional) as archiving, session(regional) as waiting:
        archiving.execute(ARCHIVE, (regional[1], region_id))
        call = _Call(waiting, ASSESS, args)
        call.start()
        time.sleep(0.5)
        assert not call.finished
        archiving.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ404"


def test_saved_assessment_survives_following_archive_and_retries(regional):
    region_id, _ = saved_region(regional)
    args = assessment_args(regional, region_id)
    with session(regional) as saving, session(regional) as archiving:
        assessment = saving.execute(ASSESS, args).fetchone()[0]
        call = _Call(archiving, ARCHIVE, (regional[1], region_id))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        saving.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate is None
        archiving.commit()
    with session(regional) as retry:
        assert retry.execute(ASSESS, args).fetchone()[0] == assessment


def test_region_delete_waits_and_cascades_without_orphan(regional):
    args = create_args(regional)
    with session(regional) as saving, psycopg.connect(regional[0]) as deleting:
        saving.execute(CREATE, args)
        deleting.execute("delete from public.stock_snapshots where organization_id=%s", (regional[1],))
        call = _Call(deleting, "delete from public.locations where organization_id=%s", (regional[1],))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        saving.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate is None
        deleting.commit()
    with session(regional) as db:
        assert db.execute("select count(*) from public.stock_regions").fetchone()[0] == 0
