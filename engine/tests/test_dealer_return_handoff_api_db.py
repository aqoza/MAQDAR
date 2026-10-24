"""Return read API: original declarations, current key authority and copied retention."""
from contextlib import contextmanager
from uuid import uuid4

import psycopg
import pytest

from test_dealer_returns_db import returns, session
from test_dealer_return_review_db import review
from test_dealer_return_batches_db import handoff, CREATE as BATCH

pytestmark = pytest.mark.db
GET = "select public.api_dealer_return_handoff_get(%s,%s,%s)"
LIST = "select public.api_dealer_return_handoff_list(%s,%s,%s,%s,%s)"
SINGLE = "dealer-return-handoffs"
BATCHES = "dealer-return-handoff-batches"
SCOPE = "dealer_return_handoffs:read"
OLD_SCOPES = [
    "master_data:read", "master_data:write", "transactions:read", "transactions:write",
    *[f"{family}:{action}" for family in ["purchase_handoffs", "transfer_handoffs", "event_purchase_handoffs",
        "excess_disposition_handoffs", "network_handoffs", "regional_handoffs"] for action in ["read", "acknowledge"]],
]


@contextmanager
def api(source):
    with psycopg.connect(source[0]) as db:
        db.execute("set local role service_role")
        yield db


def key(source, scopes=None):
    digest = uuid4().bytes + uuid4().bytes
    with session(source) as db:
        db.execute("select public.create_api_key(%s,'Return reader',%s,30,%s,'zeespare_sk_test','test')",
                   (source[1], scopes or [SCOPE], digest))
    return digest


@pytest.fixture
def reader(review):
    source = review[0]
    ids = [handoff(review, quantity="999999999999999.999"), handoff(review, "SECOND", quantity="0.001", condition="damaged")]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='admin' where organization_id=%s and user_id=%s", (source[1], source[2]))
    with session(source) as db:
        batch = db.execute(BATCH, (source[1], ids)).fetchone()[0]
        saved = db.execute("select payload from public.dealer_return_batches where id=%s", (batch,)).fetchone()[0]
    return source, ids, batch, saved, key(source)


def test_original_authorizations_and_exact_quantities_with_no_operational_writes(reader):
    source, ids, batch, saved, digest = reader
    with api(source) as db:
        result = db.execute(GET, (digest, BATCHES, batch)).fetchone()[0]["data"]
        assert result["payload"] == saved
        assert result["current"]["sources_available"] is True
        assert result["summary"] == dict(source_code="B", location_code="H", requested_return_date="2026-10-24",
            item_code=None, handoff_count=2, handoff_ids=sorted(str(i) for i in ids))
        assert {line["request"]["report"]["input"]["quantity"] for line in saved["lines"]} == {"999999999999999.999", "0.001"}
        assert {line["request"]["report"]["input"]["condition"] for line in saved["lines"]} == {"unknown", "damaged"}
        for line in saved["lines"]:
            single = db.execute(GET, (digest, SINGLE, line["handoff_id"])).fetchone()[0]["data"]
            assert single["payload"] == line
            assert single["summary"]["item_code"] == line["request"]["report"]["item"]["code"]
            assert single["payload"]["approval"]["eligibility_confirmed"] is True
        listed = db.execute(LIST, (digest, SINGLE, None, 25, None)).fetchone()[0]
        assert len(listed["data"]) == 2 and listed["next_cursor"] is None
        assert all("payload" not in row for row in listed["data"])
    with psycopg.connect(source[0]) as db:
        for table in ["stock_snapshots", "open_orders", "receipts"]:
            assert db.execute(f"select count(*) from public.{table} where organization_id=%s", (source[1],)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and operation='UPDATE' and table_name in ('dealer_return_requests','dealer_return_handoffs','dealer_return_batches')", (source[1],)).fetchone()[0] == 2  # original approvals only


@pytest.mark.parametrize("scope", OLD_SCOPES)
def test_existing_scopes_never_inherit_return_access(reader, scope):
    source, ids, batch, _, _ = reader
    old = key(source, [scope])
    for resource, record in [(SINGLE, ids[0]), (BATCHES, batch)]:
        with api(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(GET, (old, resource, record))
        assert error.value.sqlstate == "MQ403"


@pytest.mark.parametrize("change", ["expired", "revoked", "demoted", "removed", "unknown"])
def test_key_and_current_creator_authority_on_every_read(reader, change):
    source, ids, batch, _, digest = reader
    with psycopg.connect(source[0]) as db:
        if change == "expired":
            db.execute("update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where key_hash=%s", (digest,))
        elif change == "revoked":
            db.execute("update public.api_keys set revoked_at=now() where key_hash=%s", (digest,))
        elif change == "demoted":
            db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == "removed":
            db.execute("delete from public.memberships where organization_id=%s and user_id=%s", (source[1], source[2]))
        else:
            digest = bytes(32)
    for resource, record in [(SINGLE, ids[0]), (BATCHES, batch)]:
        for sql, args in [(GET, (digest, resource, record)), (LIST, (digest, resource, None, 25, None))]:
            with api(source) as db, pytest.raises(psycopg.Error) as error:
                db.execute(sql, args)
            assert error.value.sqlstate == "MQ401"


def test_catalog_changes_and_source_deletion_never_rewrite_copied_authorization(reader):
    source, ids, batch, saved, digest = reader
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.items where organization_id=%s", (source[1],))
        db.execute("update public.locations set code=code||'-NEW',is_active=false where organization_id=%s", (source[1],))
    with api(source) as db:
        result = db.execute(GET, (digest, BATCHES, batch)).fetchone()[0]["data"]
        assert result["payload"] == saved and result["current"]["sources_available"] is True
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.dealer_return_requests where id=%s", (saved["lines"][0]["request"]["id"],))
    with api(source) as db:
        result = db.execute(GET, (digest, BATCHES, batch)).fetchone()[0]["data"]
        assert result["payload"] == saved and result["current"]["sources_available"] is False
        listed = db.execute(LIST, (digest, BATCHES, None, 25, None)).fetchone()[0]
        assert listed["data"][0]["id"] == str(batch) and listed["data"][0]["current"]["sources_available"] is False
    with api(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(GET, (digest, SINGLE, saved["lines"][0]["handoff_id"]))
    assert error.value.sqlstate == "MQ404"
    with session(source) as db:
        assert db.execute("select payload from public.dealer_return_batches where id=%s", (batch,)).fetchone()[0] == saved
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.locations where organization_id=%s", (source[1],))
    with api(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(GET, (digest, BATCHES, batch))
    assert error.value.sqlstate == "MQ404"


def test_creation_paging_ties_bounds_and_resource_filter_binding(reader):
    source, ids, _, _, digest = reader
    with psycopg.connect(source[0]) as db:
        db.execute("update public.dealer_return_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=%s", (source[1],))
    with api(source) as db:
        page = db.execute(LIST, (digest, SINGLE, None, 1, "2026-10-01T00:00:00Z")).fetchone()[0]
        assert page["data"][0]["id"] == min(str(i) for i in ids)
        cursor = page["next_cursor"]
        page2 = db.execute(LIST, (digest, SINGLE, cursor, 100, "2026-10-01T00:00:00Z")).fetchone()[0]
        assert page2["data"][0]["id"] == max(str(i) for i in ids)
        assert page2["next_cursor"] is None and page2["as_of"] == page["as_of"]
        assert db.execute(LIST, (digest, SINGLE, None, 25, "2026-10-02T00:00:00Z")).fetchone()[0]["data"] == []
    for resource, after, limit, since in [
        (BATCHES, cursor, 25, "2026-10-01T00:00:00Z"), (SINGLE, cursor, 25, None),
        (SINGLE, "broken", 25, None), (SINGLE, None, 0, None), (SINGLE, None, 101, None), (SINGLE, None, 25, "infinity"),
    ]:
        with api(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(LIST, (digest, resource, after, limit, since))
        assert error.value.sqlstate == "MQ422"
    with psycopg.connect(source[0]) as db:
        db.execute("update public.dealer_return_handoffs set created_at=now()+interval '1 hour' where organization_id=%s", (source[1],))
    with api(source) as db:
        assert db.execute(LIST, (digest, SINGLE, None, 25, None)).fetchone()[0]["data"] == []


@pytest.mark.parametrize('role', ['planner','approver','viewer','branch_user'])
def test_non_admin_cannot_issue_return_scope(reader, role):
    source, *_ = reader
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role=%s where organization_id=%s and user_id=%s", (role,source[1],source[2]))
    with pytest.raises(psycopg.Error) as error:
        key(source)
    assert error.value.sqlstate == 'MQ403'
