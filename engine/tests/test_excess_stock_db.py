"""Real transaction races protect immutable assessments and current authority."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_replenishment_db import draft, session  # noqa: F401 -- shared isolated fixture
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SAVE = "select public.excess_stock_save(%s,%s,'Stock review',true,%s,%s)"


def choices(source):
    return Jsonb([dict(policy_id=str(source[3]), maximum="calculated")])


def preview(source):
    with session(source) as db:
        return db.execute("select public.excess_stock_preview(%s,%s)", (source[1], choices(source))).fetchone()[0]


def test_parallel_retries_save_one_record_and_audit(draft):
    report = preview(draft)
    args = (draft[1], choices(draft), uuid4(), report["fingerprint"])
    with session(draft) as first, session(draft) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select report from public.excess_stock_assessments where organization_id=%s", (draft[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='excess_stock_assessments'", (draft[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("change,code", [
    ("update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
    ("delete from public.memberships where organization_id=%s", "MQ403"),
    ("update public.stock_snapshots set quantity=100 where organization_id=%s", "MQ409"),
    ("update public.stock_snapshots set unit_of_measure=null where organization_id=%s", "MQ409"),
    ("delete from public.planning_runs where organization_id=%s", "MQ404"),
])
def test_lock_wait_rechecks_sources_and_authority(draft, change, code):
    report = preview(draft)
    with psycopg.connect(draft[0]) as admin, session(draft) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.excess-stock:'||%s,0))", (str(draft[1]),))
        call = _Call(waiting, SAVE, (draft[1], choices(draft), uuid4(), report["fingerprint"]))
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (draft[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == code
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select count(*) from public.excess_stock_assessments where organization_id=%s", (draft[1],)).fetchone()[0] == 0


def test_retry_preserves_history_but_rechecks_editor(draft):
    report = preview(draft)
    args = (draft[1], choices(draft), uuid4(), report["fingerprint"])
    with session(draft) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        db.execute("update public.stock_snapshots set quantity=100 where organization_id=%s", (draft[1],))
    with session(draft) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
    with psycopg.connect(draft[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s", (draft[1],))
    with session(draft) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, args)
    assert error.value.sqlstate == "MQ403"


@pytest.mark.parametrize("field,value,expected", [
    ("snapshot_date", "2026-10-02", "stock_stale"),
    ("snapshot_date", "2026-10-11", "stock_missing"),
    ("unit_of_measure", None, "stock_unit_unknown"),
    ("unit_of_measure", "KG", "unit_mismatch"),
])
def test_unavailable_evidence_blocks_complete_save(draft, field, value, expected):
    with psycopg.connect(draft[0]) as db:
        db.execute(psycopg.sql.SQL("update public.stock_snapshots set {}=%s where organization_id=%s").format(psycopg.sql.Identifier(field)), (value, draft[1]))
    report = preview(draft)
    assert report["lines"][0]["comparison"]["status"] == expected
    assert report["totals"] is None
    with session(draft) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (draft[1], choices(draft), uuid4(), report["fingerprint"]))
    assert error.value.sqlstate == "MQ422"
