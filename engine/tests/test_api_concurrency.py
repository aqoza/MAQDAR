"""Concurrency checks for the Step 5b REST API RPCs that pgTAP cannot express (one session only).

public.api_upsert runs one request in one transaction over the 5a pipeline. It takes the 5a import
lock ``maqdar.import:<organization>`` with a try-lock (busy: MQ409 import_in_progress, no waiting),
so API writes, wizard commit steps and the items/locations delete guard exclude each other per
organization, and it sets ``maqdar.import_analyze = skip_locked`` for its call, so the 5a statistics
helpers never wait for another organization's ANALYZE.

API calls run on connections with role service_role (what the route handlers' secret key maps to);
wizard and UI actions run on connections that impersonate members like PostgREST does (role
authenticated plus request.jwt.claims). Each test commits its own organizations as postgres (owner,
two planners, locations L1 and L2, an API key created through create_api_key) and deletes them
afterwards: demand rows first, then the organizations with the delete guard switched off. The wizard
and lock helpers come from ``test_import_concurrency.py``.
"""

from __future__ import annotations

import hashlib
import secrets
import string
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb
from test_import_concurrency import (
    DEMAND_ROWS,
    FIRST_DAY,
    IMMEDIATE_SECONDS,
    LOCATIONS,
    STEP,
    Tenant,
    _add_items,
    _Background,
    _batch_status,
    _demand_count,
    _demand_file,
    _editor,
    _email,
    _finish,
    _item_row,
    _orphans,
    _refused,
    _step,
    _validated_import,
    _value,
    _wait_until_blocked,
)

pytestmark = pytest.mark.db

SCOPES = ["master_data:read", "master_data:write", "transactions:read", "transactions:write"]
BASE62 = string.digits + string.ascii_uppercase + string.ascii_lowercase
UPSERT = "select public.api_upsert(%s, %s, %s, %s)"
REVOKE = "select public.revoke_api_key(%s)"
DELETE_ITEM = "delete from public.items where organization_id = %s and code = %s"
# The 5a statistics helper as the wizard calls it (no batch counts: only the staleness rules apply).
PREPARE_ITEMS = "select app.import_prepare_stats(%s, array['items'])"
# The plan's bounds: a busy organization answers 409 in under 100 ms, and another organization's write
# finishes in under 500 ms while the first holds an ANALYZE lock.
REFUSED_SECONDS = 0.1
UNBLOCKED_SECONDS = 0.5

# import_prepare_stats's staleness rules for public.items (batch counts aside): never analyzed but not
# empty, grown by more than 20 % (plus 8 pages), or more than 10 % of its rows modified since the last
# ANALYZE. ANALYZE updates relpages, reltuples and the modification count at once, even inside a
# transaction that is still open. Second column: filler rows that cover the 10 % rule.
ITEMS_STALE = (
    "select (c.reltuples <= 0 and p.pages > 0) or p.pages > c.relpages * 1.2 + 8"
    " or coalesce(s.n_mod_since_analyze, 0) > 0.1 * greatest(c.reltuples, 0),"
    " (ceil(0.1 * greatest(c.reltuples, 0)) + 100)::integer"
    " from pg_catalog.pg_class c"
    " cross join lateral (select pg_catalog.pg_relation_size(c.oid) / current_setting('block_size')::integer as pages) p"
    " left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid"
    " where c.oid = 'public.items'::regclass"
)
STATS_FLUSH_SECONDS = 2.0  # a backend publishes its modification counts at most once a second
FILLER_ITEMS = (
    "insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)"
    " select %s, 'F-' || lpad(n::text, 7, '0'), 'Filler ' || n, 'PG', 'EA', 1.5, 'SAR'"
    " from generate_series(%s::integer, %s::integer) as n"
)
# Backends holding public.items' ANALYZE lock: ANALYZE and VACUUM, autovacuum's included.
ANALYZE_LOCKS = (
    "select coalesce(array_agg(l.pid), '{}') from pg_catalog.pg_locks l where l.locktype = 'relation'"
    " and l.relation = 'public.items'::regclass and l.mode = 'ShareUpdateExclusiveLock' and l.granted"
)
# The organization's import lock (a bigint advisory key: classid holds the high, objid the low 32 bits).
IMPORT_LOCK_HELD = (
    "select exists (select 1 from pg_catalog.pg_locks l"
    " cross join (select hashtextextended('maqdar.import:' || %s::text, 0) as k) h"
    " where l.pid = %s and l.locktype = 'advisory' and l.mode = 'ExclusiveLock' and l.granted"
    " and l.classid::bigint = (h.k >> 32) & 4294967295 and l.objid::bigint = h.k & 4294967295 and l.objsubid = 1)"
)


@dataclass(frozen=True)
class ApiKey:
    id: uuid.UUID
    key_hash: bytes  # SHA-256 of the plaintext key: what the Worker sends as p_key_hash


@dataclass
class Org(Tenant):
    """A Tenant whose owner creates its API keys."""

    owner: uuid.UUID = field(kw_only=True)
    keys: list[ApiKey] = field(default_factory=list, kw_only=True)


def _create_key(org: Org, name: str) -> ApiKey:
    """A 30-day key with every scope, created by the owner as Settings does; only its SHA-256 is stored."""
    secret = "maqdar_sk_" + "".join(secrets.choice(BASE62) for _ in range(49))
    key_hash = hashlib.sha256(secret.encode()).digest()
    conn = _editor(org, org.owner)
    try:
        key_id = _value(
            conn,
            "select public.create_api_key(%s, %s, %s::text[], 30, %s, %s, %s)",
            (org.organization, name, SCOPES, key_hash, secret[:14], secret[-4:]),
        )
        conn.commit()
    finally:
        conn.close()
    key = ApiKey(key_id, key_hash)
    org.keys.append(key)
    return key


@pytest.fixture
def orgs(dsn: str) -> Iterator[Callable[[], Org]]:
    """Creates committed organizations (owner, two planners, locations L1 and L2, one API key) on demand."""
    organizations: list[uuid.UUID] = []
    users: list[uuid.UUID] = []

    def create() -> Org:
        organization, owner, planners = uuid.uuid4(), uuid.uuid4(), (uuid.uuid4(), uuid.uuid4())
        with psycopg.connect(dsn, autocommit=True) as admin:
            for user in (owner, *planners):
                admin.execute(
                    "insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())", (user, _email(user))
                )
                users.append(user)
            admin.execute(
                "insert into public.organizations (id, slug, name) values (%s, %s, 'API concurrency test')",
                (organization, f"api-concurrency-{organization.hex[:12]}"),
            )
            organizations.append(organization)
            for user, role in ((owner, "owner"), (planners[0], "planner"), (planners[1], "planner")):
                admin.execute(
                    "insert into public.memberships (organization_id, user_id, role) values (%s, %s, %s)",
                    (organization, user, role),
                )
            for code in LOCATIONS:
                admin.execute(
                    "insert into public.locations (organization_id, code, name_en, location_type, country_code, timezone)"
                    " values (%s, %s, %s, 'branch', 'SA', 'Asia/Riyadh')",
                    (organization, code, f"Location {code}"),
                )
        org = Org(dsn, organization, planners, owner=owner)
        _create_key(org, "Integration")
        return org

    try:
        yield create
    finally:
        # demand_history has no foreign keys, so its rows go first; the rest (keys and imports included) cascades.
        with psycopg.connect(dsn) as conn:
            if organizations:
                conn.execute("delete from public.demand_history where organization_id = any(%s)", (organizations,))
                conn.execute("set local maqdar.demand_guard = 'off'")
                conn.execute("delete from public.organizations where id = any(%s)", (organizations,))
            if users:
                conn.execute("delete from auth.users where id = any(%s)", (users,))


def _api(dsn: str) -> psycopg.Connection:
    """A connection calling the api_* RPCs like the route handlers do (the secret key maps to service_role)."""
    conn = psycopg.connect(dsn, autocommit=True)
    conn.execute("set statement_timeout = '30s'")
    conn.execute("set role service_role")
    conn.execute("select set_config('request.jwt.claims', %s, false)", ('{"role": "service_role"}',))
    conn.autocommit = False
    return conn


def _params(key: ApiKey, entity: str, records: list[dict[str, str]], request_id: uuid.UUID | None = None) -> tuple:
    return (key.key_hash, entity, Jsonb({"records": records}), request_id or uuid.uuid4())


def _upsert(conn: psycopg.Connection, key: ApiKey, entity: str, records: list[dict[str, str]]) -> dict:
    return _value(conn, UPSERT, _params(key, entity, records))


def _recorded(result: dict, inserted: int) -> None:
    """The write succeeded, changed data (so it is recorded as an import batch) and inserted that many rows."""
    assert (result["result"], result["recorded"], result["counts"]["inserted"]) == ("succeeded", True, inserted), result


def _items(code: str) -> list[dict[str, str]]:
    return [_item_row(code, f"Item {code}")]


def _demand(item_codes: Sequence[str], days: int) -> list[dict[str, str]]:
    return [
        {
            "item_code": item,
            "location_code": location,
            "demand_date": (FIRST_DAY + timedelta(days=day)).isoformat(),
            "quantity": "2",
        }
        for item in item_codes
        for location in LOCATIONS
        for day in range(days)
    ]


def _codes(conn: psycopg.Connection, org: Org) -> set[str]:
    rows = conn.execute("select code from public.items where organization_id = %s", (org.organization,)).fetchall()
    return {code for (code,) in rows}


def _api_batches(conn: psycopg.Connection, org: Org, column: str | None = None, value: Any = None) -> int:
    """The organization's recorded API writes, or those whose api_key_id or api_request_id is value."""
    statement = "select count(*) from public.import_batches where organization_id = %s and source = 'api'"
    if column is None:
        return _value(conn, statement, (org.organization,))
    assert column in ("api_key_id", "api_request_id")
    return _value(conn, f"{statement} and {column} = %s", (org.organization, value))


def _make_items_stale(admin: psycopg.Connection, filler: Org) -> None:
    """Adds committed filler items to another organization until import_prepare_stats would ANALYZE items."""
    inserted_at = None
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        stale, rows = admin.execute(ITEMS_STALE).fetchone()
        if stale:
            return
        if inserted_at is None or time.monotonic() - inserted_at > STATS_FLUSH_SECONDS:
            done = _value(admin, "select count(*) from public.items where organization_id = %s", (filler.organization,))
            admin.execute(FILLER_ITEMS, (filler.organization, done + 1, done + rows))
            inserted_at = time.monotonic()
        time.sleep(0.05)
    raise AssertionError("public.items did not look stale within 60 seconds")


def _hold_items_analyze_lock(admin: psycopg.Connection, writer: psycopg.Connection, org: Org, filler: Org) -> None:
    """Runs org's write of A-1 in writer's open transaction until it analyzed public.items, so it holds the
    ANALYZE lock until it commits. Autovacuum takes the same lock (VACUUM after the fixtures' deletes, ANALYZE
    after the filler rows) and an API write skips a locked table, so wait for it and try again."""
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        _make_items_stale(admin, filler)
        if _value(admin, ANALYZE_LOCKS, ()):
            time.sleep(0.1)
            continue
        _recorded(_upsert(writer, org.keys[0], "items", _items("A-1")), 1)
        if writer.info.backend_pid in _value(admin, ANALYZE_LOCKS, ()):
            return
        writer.rollback()
    raise AssertionError("the write never analyzed public.items")


def test_one_api_write_per_organization_at_a_time(orgs: Callable[[], Org]) -> None:
    a, b = orgs(), orgs()
    first, second, other = _api(a.dsn), _api(a.dsn), _api(b.dsn)
    refused = uuid.uuid4()
    try:
        # Warm the sessions (PL/pgSQL compiles once per session) so the timings below are the calls' own.
        for conn, org, code in ((second, a, "A-0"), (other, b, "B-0")):
            _recorded(_upsert(conn, org.keys[0], "items", _items(code)), 1)
            conn.commit()

        with psycopg.connect(a.dsn, autocommit=True) as admin:
            # The next authorization records last_used_at, so the open write also holds the key's row lock.
            admin.execute("update public.api_keys set last_used_at = null where id = %s", (a.keys[0].id,))
            _recorded(_upsert(first, a.keys[0], "items", _items("A-1")), 1)
            assert _value(admin, IMPORT_LOCK_HELD, (a.organization, first.info.backend_pid))

            # Same organization, same key: refused at once (no wait for the import lock or the key row).
            sqlstate, hint, elapsed = _refused(second, UPSERT, _params(a.keys[0], "items", _items("A-2"), refused))
            assert (sqlstate, hint) == ("MQ409", "import_in_progress")
            assert elapsed < REFUSED_SECONDS, elapsed

            # Another organization writes while A's lock is held.
            started = time.perf_counter()
            _recorded(_upsert(other, b.keys[0], "items", _items("B-1")), 1)
            other.commit()
            assert time.perf_counter() - started < IMMEDIATE_SECONDS

        first.commit()
        # The 409 is retryable: the same records go through once the lock is free.
        _recorded(_upsert(second, a.keys[0], "items", _items("A-2")), 1)
        second.commit()
    finally:
        for conn in (first, second, other):
            conn.close()

    with psycopg.connect(a.dsn) as admin:
        assert _codes(admin, a) == {"A-0", "A-1", "A-2"}
        assert _codes(admin, b) == {"B-0", "B-1"}
        assert _api_batches(admin, a) == 3
        assert _api_batches(admin, a, "api_request_id", refused) == 0
        assert _value(admin, "select last_used_at is not null from public.api_keys where id = %s", (a.keys[0].id,))


def test_api_writes_and_wizard_commits_exclude_each_other(orgs: Callable[[], Org]) -> None:
    org = orgs()
    key = org.keys[0]
    _add_items(org, ["C-T", "C-A", "C-B"])
    wizard, writer = _editor(org, org.planners[0]), _api(org.dsn)
    refused = uuid.uuid4()
    try:
        batch = _validated_import(wizard, org, [_demand_file(["C-T", "C-A", "C-B"])])

        # An open API write holds the import lock: the wizard's first commit step is refused at once.
        _recorded(_upsert(writer, key, "items", _items("API-1")), 1)
        sqlstate, hint, elapsed = _refused(wizard, STEP, (batch, 1))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        writer.commit()
        with psycopg.connect(org.dsn) as admin:
            assert _batch_status(admin, batch) == "validated"

        # Between steps the lock is free, but the stepped commit keeps the organization's committing slot.
        state = _step(wizard, batch, 1)
        wizard.commit()
        assert (state["status"], state["done"]) == ("committing", False), state
        sqlstate, hint, elapsed = _refused(writer, UPSERT, _params(key, "items", _items("API-2"), refused))
        assert (sqlstate, hint) == ("MQ409", "another_commit")
        assert elapsed < IMMEDIATE_SECONDS
        with psycopg.connect(org.dsn) as admin:
            assert _batch_status(admin, batch) == "committing"
            assert "API-2" not in _codes(admin, org)

        final = _finish(wizard, batch)
        _recorded(_upsert(writer, key, "items", _items("API-2")), 1)
        writer.commit()
    finally:
        wizard.close()
        writer.close()

    assert final["status"] == "succeeded", final
    with psycopg.connect(org.dsn) as admin:
        assert _demand_count(admin, org) == DEMAND_ROWS
        assert {"API-1", "API-2"} <= _codes(admin, org)
        assert _api_batches(admin, org) == 2
        assert _api_batches(admin, org, "api_request_id", refused) == 0


def test_an_api_write_never_waits_for_another_organizations_analyze(orgs: Callable[[], Org]) -> None:
    a, b, filler = orgs(), orgs(), orgs()
    writer_a, writer_b = _api(a.dsn), _api(b.dsn)
    control = psycopg.connect(a.dsn)  # postgres, like the definer helpers; no maqdar.import_analyze
    warnings: list[tuple[str | None, str | None]] = []
    writer_b.add_notice_handler(lambda diag: warnings.append((diag.sqlstate, diag.message_primary)))
    skipped = ("55P03", 'skipping analyze of "items" --- lock not available')
    try:
        # Warm the sessions; these writes may ANALYZE items themselves (nobody else holds it yet).
        for conn, org, code in ((writer_a, a, "A-0"), (writer_b, b, "B-0")):
            _recorded(_upsert(conn, org.keys[0], "items", _items(code)), 1)
            conn.commit()

        with psycopg.connect(a.dsn, autocommit=True) as admin:
            # A's write finds items stale, analyzes it and keeps ShareUpdateExclusiveLock until it commits.
            _hold_items_analyze_lock(admin, writer_a, a, filler)

            # That ANALYZE already reset the statistics in place: make items stale again, so B's write wants it too.
            _make_items_stale(admin, filler)
            warnings.clear()
            started = time.perf_counter()
            result = _upsert(writer_b, b.keys[0], "items", _items("B-1"))
            elapsed = time.perf_counter() - started
            writer_b.commit()
            _recorded(result, 1)
            assert elapsed < UNBLOCKED_SECONDS, elapsed
            assert skipped in warnings, warnings

            # Control: the same helper call on the same stale table; only the setting differs.
            control.execute("select set_config('maqdar.import_analyze', 'skip_locked', true)")
            started = time.perf_counter()
            assert _value(control, PREPARE_ITEMS, (uuid.uuid4(),)) == ["public.items"]
            assert time.perf_counter() - started < UNBLOCKED_SECONDS
            control.rollback()

            def prepare_without_setting(conn: psycopg.Connection) -> list[str]:
                conn.execute("select set_config('maqdar.import_analyze', '', true)")
                return _value(conn, PREPARE_ITEMS, (uuid.uuid4(),))

            waiting = _Background(control, prepare_without_setting)
            waiting.start()
            assert _wait_until_blocked(admin, waiting, writer_a) == "relation"
            writer_a.commit()
            waiting.outcome()
        assert (waiting.sqlstate, waiting.result) == (None, ["public.items"])
    finally:
        for conn in (writer_a, writer_b, control):
            conn.close()

    with psycopg.connect(a.dsn) as admin:
        assert _codes(admin, a) == {"A-0", "A-1"}
        assert _codes(admin, b) == {"B-0", "B-1"}


def test_ui_item_delete_during_an_api_demand_write_waits_then_refuses(orgs: Callable[[], Org]) -> None:
    org = orgs()
    key = org.keys[0]
    _add_items(org, ["C-T", "C-A", "C-X"])
    writer, deleter = _api(org.dsn), _editor(org, org.planners[1])
    records = _demand(["C-T", "C-A"], days=30)
    try:
        # The demand write stays open; its rows are not committed yet.
        _recorded(_upsert(writer, key, "demand_history", records), len(records))
        with psycopg.connect(org.dsn, autocommit=True) as admin:
            # Without the shared import lock the delete guard's probe would find no demand.
            assert _demand_count(admin, org) == 0
            delete = _Background(deleter, lambda c: c.execute(DELETE_ITEM, (org.organization, "C-T")).rowcount)
            delete.start()
            assert _wait_until_blocked(admin, delete, writer) == "advisory"
            writer.commit()
            delete.outcome()
        assert delete.sqlstate == "MQ409", (delete.sqlstate, delete.result)

        # The other order: a delete that passed the guard keeps the shared lock until it commits, so the
        # API write is refused at once; once the delete commits, the item is an unknown reference.
        cx = _demand(["C-X"], days=3)
        assert deleter.execute(DELETE_ITEM, (org.organization, "C-X")).rowcount == 1
        sqlstate, hint, elapsed = _refused(writer, UPSERT, _params(key, "demand_history", cx))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        deleter.commit()
        invalid = _upsert(writer, key, "demand_history", cx)
        writer.commit()
        assert invalid["result"] == "invalid", invalid
        assert invalid["error_counts"] == {"unknown_reference": {"item_code": len(cx)}}, invalid
    finally:
        writer.close()
        deleter.close()

    with psycopg.connect(org.dsn) as admin:
        assert _codes(admin, org) == {"C-T", "C-A"}
        assert _demand_count(admin, org, "C-T") == len(LOCATIONS) * 30
        assert _demand_count(admin, org) == len(records)
        assert _orphans(admin, org) == 0
        assert _api_batches(admin, org) == 1


def test_a_revoke_during_a_write_lets_it_finish_and_stops_the_next_call(orgs: Callable[[], Org]) -> None:
    org = orgs()
    used = org.keys[0]
    unused = _create_key(org, "Second integration")
    writer, owner = _api(org.dsn), _editor(org, org.owner)
    try:
        # A key used within the last minute: the write takes no lock the revoke waits for (the batch's
        # foreign key only takes FOR KEY SHARE), so the revoke commits while the write is still open.
        _recorded(_upsert(writer, used, "items", _items("K1-0")), 1)
        writer.commit()
        _recorded(_upsert(writer, used, "items", _items("K1-1")), 1)
        revoke = _Background(owner, lambda c: c.execute(REVOKE, (used.id,)).fetchone())
        revoke.start()
        assert revoke.done.wait(IMMEDIATE_SECONDS), "the revoke waited for the write"
        revoke.outcome()
        assert revoke.sqlstate is None, (revoke.sqlstate, revoke.hint)
        writer.commit()
        sqlstate, hint, _ = _refused(writer, UPSERT, _params(used, "items", _items("K1-2")))
        assert (sqlstate, hint) == ("MQ401", "revoked")

        # A key's first use in a minute records last_used_at (a row lock): the revoke waits for that write
        # to commit, then applies.
        _recorded(_upsert(writer, unused, "items", _items("K2-1")), 1)
        revoke = _Background(owner, lambda c: c.execute(REVOKE, (unused.id,)).fetchone())
        revoke.start()
        with psycopg.connect(org.dsn, autocommit=True) as admin:
            assert _wait_until_blocked(admin, revoke, writer) == "transactionid"
        writer.commit()
        revoke.outcome()
        assert revoke.sqlstate is None, (revoke.sqlstate, revoke.hint)
        sqlstate, hint, _ = _refused(writer, UPSERT, _params(unused, "items", _items("K2-2")))
        assert (sqlstate, hint) == ("MQ401", "revoked")
    finally:
        writer.close()
        owner.close()

    with psycopg.connect(org.dsn) as admin:
        assert _codes(admin, org) == {"K1-0", "K1-1", "K2-1"}
        assert _api_batches(admin, org, "api_key_id", used.id) == 2
        assert _api_batches(admin, org, "api_key_id", unused.id) == 1
        keys = admin.execute(
            "select id, revoked_at is not null, revoked_by, last_used_at is not null from public.api_keys"
            " where organization_id = %s",
            (org.organization,),
        ).fetchall()
        assert sorted(keys) == sorted([(used.id, True, org.owner, True), (unused.id, True, org.owner, True)])
