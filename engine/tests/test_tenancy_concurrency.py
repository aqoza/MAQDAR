"""Concurrency checks for the Step 3 tenancy RPCs that pgTAP cannot express (one session only).

Each test commits a small fixture as postgres, runs the same RPC from two connections at once and
asserts that the second waits for the first and then sees its effect. Without the advisory locks in
the tenancy_auth_completion migration both calls would pass their checks and commit.
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


@dataclass
class Fixture:
    dsn: str
    users: list[uuid.UUID] = field(default_factory=list)
    organizations: list[uuid.UUID] = field(default_factory=list)


@pytest.fixture
def fixture(dsn: str) -> Iterator[Fixture]:
    created = Fixture(dsn)
    yield created
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("delete from public.organizations where id = any(%s)", (created.organizations,))
        conn.execute("delete from auth.users where id = any(%s)", (created.users,))


def _user(fx: Fixture, conn: psycopg.Connection) -> uuid.UUID:
    user_id = uuid.uuid4()
    conn.execute(
        "insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())",
        (user_id, f"concurrency-{user_id}@test.local"),
    )
    fx.users.append(user_id)
    return user_id


def _organization(fx: Fixture, conn: psycopg.Connection, owners: list[uuid.UUID]) -> uuid.UUID:
    org_id = uuid.uuid4()
    conn.execute(
        "insert into public.organizations (id, slug, name) values (%s, %s, 'Concurrency test')",
        (org_id, f"concurrency-{org_id.hex[:12]}"),
    )
    for owner in owners:
        conn.execute(
            "insert into public.memberships (organization_id, user_id, role) values (%s, %s, 'owner')",
            (org_id, owner),
        )
    fx.organizations.append(org_id)
    return org_id


def _session(dsn: str, user_id: uuid.UUID) -> psycopg.Connection:
    """A connection inside an open transaction, impersonating the user like PostgREST does."""
    conn = psycopg.connect(dsn)
    claims = json.dumps({"sub": str(user_id), "role": "authenticated", "email": f"concurrency-{user_id}@test.local"})
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
    conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
    return conn


class _Call(threading.Thread):
    """Runs one statement on its own connection and records the SQLSTATE it fails with, if any."""

    def __init__(self, conn: psycopg.Connection, statement: str, params: tuple) -> None:
        super().__init__(daemon=True)
        self.conn, self.statement, self.params = conn, statement, params
        self.sqlstate: str | None = None
        self.finished = False

    def run(self) -> None:
        try:
            self.conn.execute(self.statement, self.params)
            self.conn.commit()
        except psycopg.Error as exc:
            self.sqlstate = exc.sqlstate
            self.conn.rollback()
        finally:
            self.finished = True


def _race(first: psycopg.Connection, second: psycopg.Connection, statement: str, params1: tuple, params2: tuple) -> _Call:
    """First call runs and keeps its transaction open; the second must wait until it commits."""
    first.execute(statement, params1)
    waiter = _Call(second, statement, params2)
    waiter.start()
    time.sleep(BLOCK_SECONDS)
    assert not waiter.finished, "the second call did not wait for the first transaction"
    first.commit()
    waiter.join(timeout=15)
    assert waiter.finished, "the second call never completed"
    return waiter


def test_two_owners_leaving_at_once_keep_one_owner(fixture: Fixture) -> None:
    with psycopg.connect(fixture.dsn, autocommit=True) as admin:
        a, b = _user(fixture, admin), _user(fixture, admin)
        org = _organization(fixture, admin, [a, b])

    first, second = _session(fixture.dsn, a), _session(fixture.dsn, b)
    try:
        waiter = _race(first, second, "select public.remove_member(%s, %s)", (org, a), (org, b))
    finally:
        first.close()
        second.close()

    assert waiter.sqlstate == "MQ409"
    with psycopg.connect(fixture.dsn) as conn:
        owners = conn.execute(
            "select array_agg(user_id) from public.memberships where organization_id = %s and role = 'owner'", (org,)
        ).fetchone()[0]
    assert owners == [b]


def test_two_owners_demoting_each_other_keep_one_owner(fixture: Fixture) -> None:
    with psycopg.connect(fixture.dsn, autocommit=True) as admin:
        a, b = _user(fixture, admin), _user(fixture, admin)
        org = _organization(fixture, admin, [a, b])

    first, second = _session(fixture.dsn, a), _session(fixture.dsn, b)
    try:
        waiter = _race(
            first, second, "select public.set_member_role(%s, %s, 'admin')", (org, b), (org, a)
        )
    finally:
        first.close()
        second.close()

    # B was demoted by A while waiting, so B (now an admin) may no longer touch an owner.
    assert waiter.sqlstate == "MQ403"
    with psycopg.connect(fixture.dsn) as conn:
        owners = conn.execute(
            "select count(*) from public.memberships where organization_id = %s and role = 'owner'", (org,)
        ).fetchone()[0]
    assert owners == 1


def test_parallel_organization_creation_respects_the_daily_cap(fixture: Fixture) -> None:
    with psycopg.connect(fixture.dsn, autocommit=True) as admin:
        user = _user(fixture, admin)
        for _ in range(4):
            org = _organization(fixture, admin, [user])
            admin.execute("update public.organizations set created_by = %s where id = %s", (user, org))

    first, second = _session(fixture.dsn, user), _session(fixture.dsn, user)
    slug1, slug2 = f"cap-{uuid.uuid4().hex[:12]}", f"cap-{uuid.uuid4().hex[:12]}"
    try:
        waiter = _race(
            first, second, "select public.create_organization(%s, 'Cap test')", (slug1,), (slug2,)
        )
    finally:
        first.close()
        second.close()

    assert waiter.sqlstate == "MQ429"
    with psycopg.connect(fixture.dsn) as conn:
        rows = conn.execute(
            "select id from public.organizations where created_by = %s", (user,)
        ).fetchall()
    fixture.organizations.extend(row[0] for row in rows)
    assert len(rows) == 5


def test_parallel_first_invitations_to_one_address_serialise(fixture: Fixture) -> None:
    with psycopg.connect(fixture.dsn, autocommit=True) as admin:
        a, b = _user(fixture, admin), _user(fixture, admin)
        org = _organization(fixture, admin, [a, b])

    first, second = _session(fixture.dsn, a), _session(fixture.dsn, b)
    email = f"invitee-{uuid.uuid4().hex[:8]}@test.local"
    try:
        waiter = _race(
            first, second, "select * from public.invite_member(%s, %s, 'viewer')", (org, email), (org, email)
        )
    finally:
        first.close()
        second.close()

    # Without the lock the second call would hit the pending-invitation unique index (23505).
    assert waiter.sqlstate == "MQ429"
    with psycopg.connect(fixture.dsn) as conn:
        pending = conn.execute(
            "select count(*) from public.organization_invitations where organization_id = %s and email = %s",
            (org, email),
        ).fetchone()[0]
    assert pending == 1
