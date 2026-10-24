"""Terminal review/withdrawal races and authority/catalog changes during lock waits."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_dealer_returns_db import INPUT, SAVE, WITHDRAW, returns, session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
REVIEW = "select public.dealer_return_review(%s,%s,%s,%s,%s)"


@pytest.fixture
def review(returns):
    reviewer = uuid4()
    with psycopg.connect(returns[0]) as db:
        db.execute("insert into auth.users(id,email) values(%s,%s)", (reviewer, f"review-{reviewer}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')", (returns[1], reviewer))
    with session(returns) as db:
        saved = db.execute(SAVE, (returns[1], Jsonb(INPUT), uuid4())).fetchone()[0]
    try:
        yield returns, (returns[0], returns[1], reviewer), saved
    finally:
        with psycopg.connect(returns[0]) as db:
            db.execute("delete from auth.users where id=%s", (reviewer,))


@pytest.mark.parametrize("conflict", [False, True])
def test_review_serializes_retries_and_competing_decisions(review, conflict):
    original, reviewer, saved = review
    args = original[1], saved, "approved", "Eligibility checked", True
    other = (original[1], saved, "rejected", "Not eligible", False) if conflict else args
    with session(reviewer) as first, session(reviewer) as second:
        assert _race(first, second, REVIEW, args, other).sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(original[0]) as db:
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='dealer_return_requests' and operation='UPDATE'", (original[1],)).fetchone()[0] == 1


@pytest.mark.parametrize("withdraw_first", [False, True])
def test_review_and_withdrawal_have_one_terminal_winner(review, withdraw_first):
    original, reviewer, saved = review
    decision = original[1], saved, "approved", "Eligibility checked", True
    withdrawal = original[1], saved, "Correction"
    first_user, next_user = (original, reviewer) if withdraw_first else (reviewer, original)
    first_sql, first_args = (WITHDRAW, withdrawal) if withdraw_first else (REVIEW, decision)
    next_sql, next_args = (REVIEW, decision) if withdraw_first else (WITHDRAW, withdrawal)
    with session(first_user) as first, session(next_user) as waiting:
        first.execute(first_sql, first_args)
        call = _Call(waiting, next_sql, next_args)
        call.start()
        time.sleep(0.5)
        assert not call.finished
        first.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ409"
    with psycopg.connect(original[0]) as db:
        assert db.execute("select decision,withdrawn_at is not null from public.dealer_return_requests where id=%s", (saved,)).fetchone() == ((None, True) if withdraw_first else ("approved", False))


@pytest.mark.parametrize("retry", [False, True])
def test_review_rechecks_authority_after_request_wait(review, retry):
    original, reviewer, saved = review
    args = original[1], saved, "approved", "Eligibility checked", True
    if retry:
        with session(reviewer) as db:
            db.execute(REVIEW, args)
    with psycopg.connect(original[0]) as admin, session(reviewer) as waiting:
        admin.execute("select id from public.dealer_return_requests where id=%s for update", (saved,))
        call = _Call(waiting, REVIEW, args)
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (original[1], reviewer[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ403"


@pytest.mark.parametrize("table,change,expected", [
    ("locations", "update public.locations set is_active=false where organization_id=%s", "MQ409"),
    ("items", "update public.items set unit_of_measure='SET' where organization_id=%s", "MQ409"),
    ("items", "delete from public.items where organization_id=%s", "MQ409"),
    ("locations", "update public.memberships set role='viewer' where organization_id=%s", "MQ403"),
])
def test_approval_rechecks_after_catalog_wait(review, table, change, expected):
    original, reviewer, saved = review
    with psycopg.connect(original[0]) as admin, session(reviewer) as waiting:
        admin.execute(f"select id from public.{table} where organization_id=%s order by id for update", (original[1],))
        call = _Call(waiting, REVIEW, (original[1], saved, "approved", "Eligibility checked", True))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute(change, (original[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


def test_approval_after_endpoint_delete_wait_does_not_deadlock(review):
    original, reviewer, saved = review
    with psycopg.connect(original[0]) as admin, session(reviewer) as waiting:
        admin.execute("select id from public.locations where organization_id=%s order by id for update", (original[1],))
        call = _Call(waiting, REVIEW, (original[1], saved, "approved", "Eligibility checked", True))
        call.start()
        time.sleep(0.5)
        assert not call.finished
        admin.execute("delete from public.locations where organization_id=%s", (original[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ404"
