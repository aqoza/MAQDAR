"""Concurrency checks for the Step 4 supersession cycle guard that pgTAP cannot express.

The guard is an AFTER row trigger that takes a per-organization advisory lock and then walks the
chain from the new successor. Two transactions that each add one half of a cycle would both pass
the walk if they ran unserialised (neither sees the other's uncommitted row). With the lock the
second waits for the first to commit, then sees its row and fails with MQ422.

Each test commits a small fixture as postgres (one organization, two planners, a few items),
inserts from two impersonated sessions like PostgREST does, and deletes the organization after.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field

import psycopg
import pytest

pytestmark = pytest.mark.db

BLOCK_SECONDS = 1.0
INSERT = (
    "insert into public.item_supersessions (organization_id, predecessor_item_id, successor_item_id, effective_on) "
    "values (%s, %s, %s, '2026-01-01')"
)


@dataclass
class Fixture:
    dsn: str
    organization: uuid.UUID
    planners: tuple[uuid.UUID, uuid.UUID]
    items: dict[str, uuid.UUID] = field(default_factory=dict)


@pytest.fixture
def fixture(dsn: str) -> Iterator[Fixture]:
    org = uuid.uuid4()
    planners = (uuid.uuid4(), uuid.uuid4())
    created = Fixture(dsn, org, planners)
    try:
        with psycopg.connect(dsn, autocommit=True) as admin:
            for user_id in planners:
                admin.execute(
                    "insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
                    (user_id, f"supersession-{user_id}@test.local"),
                )
            admin.execute(
                "insert into public.organizations (id, slug, name) values (%s, %s, 'Supersession guard test')",
                (org, f"supersession-{org.hex[:12]}"),
            )
            for user_id in planners:
                admin.execute(
                    "insert into public.memberships (organization_id, user_id, role) values (%s, %s, 'planner')",
                    (org, user_id),
                )
            for code in ("A", "B", "C", "D"):
                item_id = uuid.uuid4()
                admin.execute(
                    "insert into public.items (id, organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency) "
                    "values (%s, %s, %s, %s, 'battery', 'EA', 1, 'SAR')",
                    (item_id, org, f"GUARD-{code}", f"Guard item {code}"),
                )
                created.items[code] = item_id
        yield created
    finally:
        with psycopg.connect(dsn, autocommit=True) as admin:
            admin.execute("delete from public.organizations where id = %s", (org,))
            admin.execute("delete from auth.users where id = any(%s)", (list(planners),))


def _session(dsn: str, user_id: uuid.UUID) -> psycopg.Connection:
    """A connection inside an open transaction, impersonating the user like PostgREST does."""
    conn = psycopg.connect(dsn)
    claims = json.dumps({"sub": str(user_id), "role": "authenticated", "email": f"supersession-{user_id}@test.local"})
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
    conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
    return conn


class _Call(threading.Thread):
    """Runs one statement on its own connection and records how it fails, if it does."""

    def __init__(self, conn: psycopg.Connection, statement: str, params: tuple) -> None:
        super().__init__(daemon=True)
        self.conn, self.statement, self.params = conn, statement, params
        self.sqlstate: str | None = None
        self.hint: str | None = None
        self.finished = False

    def run(self) -> None:
        try:
            self.conn.execute(self.statement, self.params)
            self.conn.commit()
        except psycopg.Error as exc:
            self.sqlstate = exc.sqlstate
            self.hint = exc.diag.message_hint
            self.conn.rollback()
        finally:
            self.finished = True


def _race(fx: Fixture, first_link: tuple[str, str], second_link: tuple[str, str]) -> _Call:
    """The first insert runs and keeps its transaction open; the second must wait until it commits."""
    first, second = _session(fx.dsn, fx.planners[0]), _session(fx.dsn, fx.planners[1])
    try:
        first.execute(INSERT, (fx.organization, fx.items[first_link[0]], fx.items[first_link[1]]))
        waiter = _Call(second, INSERT, (fx.organization, fx.items[second_link[0]], fx.items[second_link[1]]))
        waiter.start()
        time.sleep(BLOCK_SECONDS)
        assert not waiter.finished, "the second insert did not wait for the first transaction"
        first.commit()
        waiter.join(timeout=15)
        assert waiter.finished, "the second insert never completed"
        return waiter
    finally:
        first.close()
        second.close()


def _links(fx: Fixture) -> set[tuple[str, str]]:
    names = {item_id: code for code, item_id in fx.items.items()}
    with psycopg.connect(fx.dsn) as conn:
        rows = conn.execute(
            "select predecessor_item_id, successor_item_id from public.item_supersessions where organization_id = %s",
            (fx.organization,),
        ).fetchall()
    return {(names[p], names[s]) for p, s in rows}


def test_reverse_links_added_at_once_cannot_close_a_cycle(fixture: Fixture) -> None:
    waiter = _race(fixture, ("A", "B"), ("B", "A"))

    assert waiter.sqlstate == "MQ422"
    assert waiter.hint == "successor_item_code"
    assert _links(fixture) == {("A", "B")}


def test_links_added_at_once_cannot_close_a_longer_cycle(fixture: Fixture) -> None:
    with psycopg.connect(fixture.dsn, autocommit=True) as admin:
        admin.execute(INSERT, (fixture.organization, fixture.items["A"], fixture.items["B"]))

    # A -> B is committed; B -> C and C -> A together would close A -> B -> C -> A.
    waiter = _race(fixture, ("B", "C"), ("C", "A"))

    assert waiter.sqlstate == "MQ422"
    assert _links(fixture) == {("A", "B"), ("B", "C")}


def test_unrelated_links_wait_for_each_other_and_both_commit(fixture: Fixture) -> None:
    # The lock is per organization, so the second insert still waits, but it then succeeds.
    waiter = _race(fixture, ("A", "B"), ("C", "D"))

    assert waiter.sqlstate is None
    assert _links(fixture) == {("A", "B"), ("C", "D")}
