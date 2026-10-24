"""Copied return batches: atomic validation, current authority and retention."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_dealer_returns_db import INPUT, SAVE, returns, session
from test_dealer_return_review_db import REVIEW, review
from test_dealer_return_handoffs_db import EXPORT
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
CREATE = "select public.dealer_return_batch_create(%s,%s::uuid[])"
PREVIEW = "select public.dealer_return_batch_preview(%s,%s::uuid[])"


def handoff(review, code="ITEM", **changes):
    original, reviewer, _ = review
    with psycopg.connect(original[0]) as db:
        db.execute("insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'Item','Test','EA',1,'SAR') on conflict(organization_id,code) do nothing", (original[1], code))
    with session(original) as db:
        saved = db.execute(SAVE, (original[1], Jsonb({**INPUT, "item_code": code, **changes}), uuid4())).fetchone()[0]
    with session(reviewer) as db:
        db.execute(REVIEW, (original[1], saved, "approved", "Eligibility checked", True))
    with session(original) as db:
        return db.execute(EXPORT, (original[1], saved)).fetchone()[0]


@pytest.fixture
def batch(review):
    return review[0], [handoff(review), handoff(review, "SECOND", quantity="0.001", condition="damaged")]


def test_canonical_parallel_retry_and_copied_evidence(batch):
    original, ids = batch
    with session(original) as first, session(original) as second:
        assert _race(first, second, CREATE, (original[1], ids), (original[1], ids[::-1])).sqlstate is None
    with session(original) as db:
        preview = db.execute(PREVIEW, (original[1], ids)).fetchone()[0]
        saved = db.execute(CREATE, (original[1], ids)).fetchone()[0]
        assert str(saved) == preview["existing_batch_id"]
        assert preview["summary"]["line_count"] == 2
        assert {p["request"]["report"]["input"]["quantity"] for p in preview["lines"]} == {"2.125", "0.001"}
        assert {p["request"]["report"]["input"]["condition"] for p in preview["lines"]} == {"unknown", "damaged"}
        assert all(p["approval"]["eligibility_confirmed"] for p in preview["lines"])
    with psycopg.connect(original[0]) as db:
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='dealer_return_batches' and operation='INSERT'", (original[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.stock_snapshots where organization_id=%s", (original[1],)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (original[1],)).fetchone()[0] == 0


@pytest.mark.parametrize("bad", [None, [], [None], "duplicate", "large", "multidimensional", "missing"])
def test_invalid_sets_save_nothing(batch, bad):
    original, ids = batch
    selected = {"duplicate": ids + ids, "large": [uuid4() for _ in range(51)], "multidimensional": [ids[:], ids[:]], "missing": [ids[0], uuid4()]}.get(bad, bad) if isinstance(bad, str) else bad
    with pytest.raises(psycopg.Error) as exc, session(original) as db:
        db.execute(CREATE, (original[1], selected))
    assert exc.value.sqlstate == ("MQ404" if bad == "missing" else "MQ422")
    with psycopg.connect(original[0]) as db:
        assert db.execute("select count(*) from public.dealer_return_batches where organization_id=%s", (original[1],)).fetchone()[0] == 0


def test_repeated_item_and_incompatible_date_are_atomic(review, batch):
    original, ids = batch
    duplicate = handoff(review)
    other_date = handoff(review, "THIRD", requested_date="2026-10-25")
    for selected, hint in [(ids + [duplicate], "batch_duplicate_item"), (ids + [other_date], "batch_group_mismatch")]:
        with pytest.raises(psycopg.Error) as exc, session(original) as db:
            db.execute(CREATE, (original[1], selected))
        assert exc.value.sqlstate == "MQ422" and exc.value.diag.message_hint == hint


def test_saved_code_reuse_is_rejected_even_with_different_item_ids(review, batch):
    original, ids = batch
    with psycopg.connect(original[0]) as db:
        db.execute("delete from public.items where organization_id=%s and code='ITEM'", (original[1],))
    replacement = handoff(review)
    with pytest.raises(psycopg.Error) as exc, session(original) as db:
        db.execute(CREATE, (original[1], [ids[0], replacement]))
    assert exc.value.sqlstate == "MQ422" and exc.value.diag.message_hint == "batch_duplicate_item"


@pytest.mark.parametrize("field,code,kind", [("source_code", "B2", "branch"), ("location_code", "H2", "hub")])
def test_different_endpoint_identity_is_not_a_group(review, batch, field, code, kind):
    original, ids = batch
    with psycopg.connect(original[0]) as db:
        db.execute("insert into public.locations(organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'Other',%s,'SA','Asia/Riyadh')", (original[1], code, kind))
    different = handoff(review, "THIRD", **{field: code})
    with pytest.raises(psycopg.Error) as exc, session(original) as db:
        db.execute(CREATE, (original[1], [ids[0], different]))
    assert exc.value.sqlstate == "MQ422" and exc.value.diag.message_hint == "batch_group_mismatch"


def test_fifty_lines_save_complete_with_fixed_separate_declarations(review):
    original = review[0]
    ids = [handoff(review, f"PART-{n}", quantity=f"{n + 1}.001") for n in range(50)]
    with session(original) as db:
        saved = db.execute(CREATE, (original[1], ids)).fetchone()[0]
        payload = db.execute("select payload from public.dealer_return_batches where id=%s", (saved,)).fetchone()[0]
        assert payload["summary"]["line_count"] == len(payload["lines"]) == 50
        assert len({p["request"]["report"]["input"]["quantity"] for p in payload["lines"]}) == 50
        assert db.execute(CREATE, (original[1], ids[::-1])).fetchone()[0] == saved


@pytest.mark.parametrize("change", [
    "update public.items set unit_of_measure='SET' where organization_id=%s",
    "update public.items set code=code||'-RENAMED' where organization_id=%s",
    "delete from public.items where organization_id=%s",
    "update public.locations set is_active=false where organization_id=%s",
    "update public.locations set code=code||'-RENAMED' where organization_id=%s",
    "update public.locations set location_type='central' where organization_id=%s and code='H'",
])
def test_changed_catalog_blocks_first_save(batch, change):
    original, ids = batch
    with psycopg.connect(original[0]) as db:
        db.execute(change, (original[1],))
    with pytest.raises(psycopg.Error) as exc, session(original) as db:
        db.execute(CREATE, (original[1], ids))
    assert exc.value.sqlstate == "MQ409"


@pytest.mark.parametrize("table,change,expected", [
    ("items", "update public.items set unit_of_measure='SET' where organization_id=%s", "MQ409"),
    ("items", "delete from public.items where organization_id=%s", "MQ409"),
    ("locations", "update public.locations set is_active=false where organization_id=%s", "MQ409"),
    ("locations", "delete from public.locations where organization_id=%s", "MQ404"),
    ("dealer_return_requests", "delete from public.dealer_return_requests where organization_id=%s", "MQ404"),
    ("dealer_return_handoffs", "delete from public.memberships where organization_id=%s", "MQ403"),
    ("items", "update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
])
def test_save_rechecks_after_row_wait(batch, table, change, expected):
    original, ids = batch
    with psycopg.connect(original[0]) as admin, session(original) as waiting:
        admin.execute(f"select id from public.{table} where organization_id=%s order by id for update", (original[1],))
        call = _Call(waiting, CREATE, (original[1], ids))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute(change, (original[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(original[0]) as db:
        assert db.execute("select count(*) from public.dealer_return_batches where organization_id=%s", (original[1],)).fetchone()[0] == 0


@pytest.mark.parametrize("retry", [False, True])
def test_authority_rechecked_after_advisory_wait(batch, retry):
    original, ids = batch
    if retry:
        with session(original) as db:
            db.execute(CREATE, (original[1], ids))
    with psycopg.connect(original[0]) as admin, session(original) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.dealer-return-batches:'||%s,0))", (str(original[1]),))
        call = _Call(waiting, CREATE, (original[1], ids))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("delete from public.memberships where organization_id=%s", (original[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


def test_copies_overlap_retry_visibility_and_parent_cascade(batch):
    original, ids = batch
    with session(original) as db:
        saved = db.execute(CREATE, (original[1], ids)).fetchone()[0]
        single = db.execute(CREATE, (original[1], ids[:1])).fetchone()[0]
        payload = db.execute("select payload from public.dealer_return_batches where id=%s", (saved,)).fetchone()[0]
        assert db.execute("select overlap_count,sources_available from public.dealer_return_batch_list where id=%s", (saved,)).fetchone() == (1, True)
        assert db.execute("select batch_count from public.dealer_return_batch_candidates where id=%s", (ids[0],)).fetchone()[0] == 2
    with psycopg.connect(original[0]) as db:
        db.execute("delete from public.items where organization_id=%s", (original[1],))
    with session(original) as db:
        assert db.execute(CREATE, (original[1], ids[::-1])).fetchone()[0] == saved
    with psycopg.connect(original[0]) as db:
        db.execute("delete from public.dealer_return_requests where organization_id=%s", (original[1],))
    with session(original) as db:
        assert db.execute("select payload,sources_available,overlap_count from public.dealer_return_batch_list where id=%s", (saved,)).fetchone() == (payload, False, 1)
    with pytest.raises(psycopg.Error) as exc, session(original) as db:
        db.execute(CREATE, (original[1], ids))
    assert exc.value.sqlstate == "MQ404"
    with psycopg.connect(original[0]) as db:
        db.execute("delete from public.locations where organization_id=%s and code='B'", (original[1],))
        assert db.execute("select count(*) from public.dealer_return_batches where id in (%s,%s)", (saved, single)).fetchone()[0] == 0
