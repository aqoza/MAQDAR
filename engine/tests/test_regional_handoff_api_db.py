"""Scoped readers preserve real regional approvals and copied batch evidence."""
from contextlib import contextmanager
from uuid import uuid4

import psycopg
import pytest

from test_regional_batches_db import package, transfer, approve, CREATE as BATCH  # noqa: F401
from test_replenishment_db import session

pytestmark = pytest.mark.db
GET = "select public.api_regional_handoff_get(%s,%s,%s)"
LIST = "select public.api_regional_handoff_list(%s,%s,%s,%s,%s)"
SINGLE = "regional-handoffs"
BATCHES = "regional-handoff-batches"
SCOPE = "regional_handoffs:read"
OLD_SCOPES = [
    "master_data:read", "master_data:write", "transactions:read", "transactions:write",
    "purchase_handoffs:read", "purchase_handoffs:acknowledge",
    "transfer_handoffs:read", "transfer_handoffs:acknowledge",
    "event_purchase_handoffs:read", "event_purchase_handoffs:acknowledge",
    "excess_disposition_handoffs:read", "excess_disposition_handoffs:acknowledge",
    "network_handoffs:read", "network_handoffs:acknowledge",
]


@contextmanager
def api(source):
    with psycopg.connect(source[0]) as db:
        db.execute("set local role service_role")
        yield db


def key(source, scopes=None):
    digest = uuid4().bytes + uuid4().bytes
    with session(source) as db:
        db.execute("select public.create_api_key(%s,'Regional reader',%s,30,%s,'zeespare_sk_test','test')",
                   (source[1], scopes or [SCOPE], digest))
    return digest


@pytest.fixture
def reader(package):
    source, ids, _ = package
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='admin' where organization_id=%s and user_id=%s",
                   (source[1], source[2]))
    with session(source) as db:
        batch = db.execute(BATCH, (source[1], ids)).fetchone()[0]
        saved = db.execute("select payload from public.regional_handoff_batches where id=%s",
                           (batch,)).fetchone()[0]
    return source, ids, batch, saved, key(source)


@pytest.mark.parametrize("transfer", [{}, {"source_a_quantity":"22"}], indirect=True)
def test_exact_payloads_summaries_zero_sources_and_no_operational_writes(reader):
    source, ids, batch, saved, digest = reader
    with psycopg.connect(source[0]) as db:
        before = db.execute("select quantity,allocated_quantity from public.stock_snapshots where organization_id=%s order by item_id,location_id", (source[1],)).fetchall()
    with api(source) as db:
        result = db.execute(GET, (digest, BATCHES, batch)).fetchone()[0]["data"]
        assert result["payload"] == saved
        assert result["current"]["selection"] == "current"
        assert result["summary"]["totals"] == saved["summary"]["totals"]
        assert result["summary"]["source_row_count"] == 4
        assert result["summary"]["handoff_ids"] == sorted(str(i) for i in ids)
        assert result["summary"]["item_code"] is None
        for line in saved["lines"]:
            single = db.execute(GET, (digest, SINGLE, line["handoff_id"])).fetchone()[0]["data"]
            assert single["payload"] == line
            assert single["summary"]["totals"] == line["estimate"]["totals"]
            assert single["summary"]["region_name"] == line["estimate"]["source"]["source"]["region"]["name_en"]
            assert single["summary"]["requested_date"] == line["estimate"]["source"]["requested_date"]
            assert single["summary"]["destination_code"] == line["estimate"]["source"]["source"]["destination"]["policy"]["location_code"]
        page = db.execute(LIST, (digest, SINGLE, None, 1, None)).fetchone()[0]
        next_page = db.execute(LIST, (digest, SINGLE, page["next_cursor"], 1, None)).fetchone()[0]
        assert page["as_of"] == next_page["as_of"] and next_page["next_cursor"] is None
        assert {page["data"][0]["id"], next_page["data"][0]["id"]} == {str(i) for i in ids}
        assert "payload" not in page["data"][0]
    with psycopg.connect(source[0]) as db:
        assert db.execute("select quantity,allocated_quantity from public.stock_snapshots where organization_id=%s order by item_id,location_id", (source[1],)).fetchall() == before
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (source[1],)).fetchone()[0] == 0


@pytest.mark.parametrize("scope", OLD_SCOPES)
def test_no_existing_scope_grants_regional_access(reader, scope):
    source, ids, batch, _, _ = reader
    old = key(source, [scope])
    for resource, record in [(SINGLE, ids[0]), (BATCHES, batch)]:
        with api(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(GET, (old, resource, record))
        assert error.value.sqlstate == "MQ403"


@pytest.mark.parametrize("change", ["expired", "revoked", "demoted", "removed"])
def test_current_key_authority_on_every_read(reader, change):
    source, ids, batch, _, digest = reader
    with psycopg.connect(source[0]) as db:
        if change == "expired":
            db.execute("update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where key_hash=%s", (digest,))
        elif change == "revoked":
            db.execute("update public.api_keys set revoked_at=now() where key_hash=%s", (digest,))
        elif change == "demoted":
            db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        else:
            db.execute("delete from public.memberships where organization_id=%s and user_id=%s", (source[1], source[2]))
    for resource, record in [(SINGLE, ids[0]), (BATCHES, batch)]:
        with api(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(GET, (digest, resource, record))
        assert error.value.sqlstate == "MQ401"


def test_later_selection_and_source_deletion_preserve_complete_copied_batch(reader, transfer):
    source, ids, batch, saved, digest = reader
    approve(transfer)
    with api(source) as db:
        assert db.execute(GET, (digest, SINGLE, ids[0])).fetchone()[0]["data"]["current"]["selection"] == "historical"
        result = db.execute(GET, (digest, BATCHES, batch)).fetchone()[0]["data"]
        assert result["current"]["selection"] == "historical" and result["payload"] == saved
    with psycopg.connect(source[0]) as db:
        db.execute("update public.network_links set freight_cost=999,is_active=false where organization_id=%s", (source[1],))
        db.execute("delete from public.regional_transfer_proposals where id=%s", (saved["lines"][0]["proposal"]["id"],))
    with api(source) as db:
        result = db.execute(GET, (digest, BATCHES, batch)).fetchone()[0]["data"]
        assert result["current"]["selection"] == "unavailable"
        assert result["payload"] == saved and result["summary"]["totals"] == saved["summary"]["totals"]
        listed = db.execute(LIST, (digest, BATCHES, None, 25, None)).fetchone()[0]
        assert listed["data"][0]["id"] == str(batch)
        assert listed["data"][0]["current"]["selection"] == "unavailable"
    with session(source) as db:
        assert db.execute("select payload from public.regional_handoff_batches where id=%s", (batch,)).fetchone()[0] == saved


def test_creation_paging_ties_bounds_and_resource_filter_binding(reader):
    source, ids, _, _, digest = reader
    with psycopg.connect(source[0]) as db:
        db.execute("update public.regional_transfer_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=%s", (source[1],))
    with api(source) as db:
        page = db.execute(LIST, (digest, SINGLE, None, 1, "2026-10-01T00:00:00Z")).fetchone()[0]
        assert page["data"][0]["id"] == min(str(i) for i in ids)
        cursor = page["next_cursor"]
        page2 = db.execute(LIST, (digest, SINGLE, cursor, 100, "2026-10-01T00:00:00Z")).fetchone()[0]
        assert page2["data"][0]["id"] == max(str(i) for i in ids)
        assert page2["next_cursor"] is None and page2["as_of"] == page["as_of"]
        assert db.execute(LIST, (digest, SINGLE, None, 25, "2026-10-02T00:00:00Z")).fetchone()[0]["data"] == []
    for resource, after, limit, since in [
        (BATCHES, cursor, 25, "2026-10-01T00:00:00Z"),
        (SINGLE, cursor, 25, None),
        (SINGLE, "broken", 25, None),
        (SINGLE, None, 0, None),
        (SINGLE, None, 101, None),
        (SINGLE, None, 25, "infinity"),
    ]:
        with api(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(LIST, (digest, resource, after, limit, since))
        assert error.value.sqlstate == "MQ422"
    with psycopg.connect(source[0]) as db:
        db.execute("update public.regional_transfer_handoffs set created_at=now()+interval '1 hour' where organization_id=%s", (source[1],))
    with api(source) as db:
        assert db.execute(LIST, (digest, SINGLE, None, 25, None)).fetchone()[0]["data"] == []


def test_archive_and_region_deletion_do_not_refresh_saved_evidence(reader):
    source, ids, batch, saved, digest = reader
    with psycopg.connect(source[0]) as db:
        db.execute("update public.stock_regions set archived_at=clock_timestamp(),archived_by=%s where organization_id=%s", (source[2],source[1]))
        db.execute("update public.locations set name_en='Renamed',is_active=false where organization_id=%s", (source[1],))
        db.execute("delete from public.stock_regions where organization_id=%s", (source[1],))
    with api(source) as db:
        result=db.execute(GET,(digest,BATCHES,batch)).fetchone()[0]['data']
        assert result['payload']==saved and result['current']['selection']=='current'
        for line in saved['lines']:
            assert db.execute(GET,(digest,SINGLE,line['handoff_id'])).fetchone()[0]['data']['payload']==line


@pytest.mark.parametrize('role',['planner','approver','viewer','branch_user'])
def test_non_admin_cannot_issue_new_scope(reader,role):
    source,*_=reader
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role=%s where organization_id=%s and user_id=%s",(role,source[1],source[2]))
    with pytest.raises(psycopg.Error) as error: key(source)
    assert error.value.sqlstate=='MQ403'
