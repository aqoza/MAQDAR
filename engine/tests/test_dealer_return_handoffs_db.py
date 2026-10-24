"""Return exports serialize once and recheck authority/evidence after lock waits."""
import time

import psycopg
import pytest

from test_dealer_returns_db import returns, session
from test_dealer_return_review_db import review, REVIEW
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
EXPORT = "select public.dealer_return_handoff_create(%s,%s)"


@pytest.fixture
def approved(review):
    original, reviewer, saved = review
    with session(reviewer) as db:
        db.execute(REVIEW, (original[1], saved, "approved", "Eligibility checked", True))
    return original, saved


def test_parallel_handoffs_have_one_payload_and_audit(approved):
    original, saved = approved
    with session(original) as first, session(original) as second:
        assert _race(first, second, EXPORT, (original[1], saved), (original[1], saved)).sqlstate is None
    with psycopg.connect(original[0]) as db:
        assert db.execute("select count(*) from public.dealer_return_handoffs where return_id=%s", (saved,)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='dealer_return_handoffs' and operation='INSERT'", (original[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("table,change,expected", [
    ("locations", "update public.locations set is_active=false where organization_id=%s", "MQ409"),
    ("items", "update public.items set unit_of_measure='SET' where organization_id=%s", "MQ409"),
    ("items", "delete from public.items where organization_id=%s", "MQ409"),
    ("locations", "update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
    ("dealer_return_requests", "delete from public.memberships where organization_id=%s", "MQ403"),
    ("locations", "delete from public.locations where organization_id=%s", "MQ404"),
])
def test_creation_rechecks_after_catalog_or_request_wait(approved, table, change, expected):
    original, saved = approved
    with psycopg.connect(original[0]) as admin, session(original) as waiting:
        admin.execute(f"select id from public.{table} where organization_id=%s order by id for update", (original[1],))
        call = _Call(waiting, EXPORT, (original[1], saved))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute(change, (original[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(original[0]) as db:
        assert db.execute("select count(*) from public.dealer_return_handoffs where organization_id=%s", (original[1],)).fetchone()[0] == 0


def test_retry_preserves_files_after_catalog_change_but_checks_current_editor(approved):
    original, saved = approved
    with session(original) as db:
        exported = db.execute(EXPORT, (original[1], saved)).fetchone()[0]
    with psycopg.connect(original[0]) as db:
        payload = db.execute("select payload from public.dealer_return_handoffs where id=%s", (exported,)).fetchone()[0]
        db.execute("delete from public.items where organization_id=%s", (original[1],))
        db.execute("update public.locations set is_active=false where organization_id=%s", (original[1],))
    with session(original) as db:
        assert db.execute(EXPORT, (original[1], saved)).fetchone()[0] == exported
    with psycopg.connect(original[0]) as db:
        assert db.execute("select payload from public.dealer_return_handoffs where id=%s", (exported,)).fetchone()[0] == payload
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (original[1], original[2]))
    with pytest.raises(psycopg.Error) as exc, session(original) as db:
        db.execute(EXPORT, (original[1], saved))
    assert exc.value.sqlstate == "MQ403"
