"""Concurrency checks for the Step 5a import RPCs that pgTAP cannot express (one session only).

Every demand writer and the items/locations delete guard share the advisory lock
``maqdar.import:<organization>``: commit steps take it with a try-lock (busy: MQ409
import_in_progress, no waiting) and ``app.refuse_delete_with_demand()`` takes it shared before it
probes for demand, so a delete waits for the running step and then sees the demand it committed.

Each test commits its own organization as postgres, drives the RPCs from connections that
impersonate planners (role authenticated plus request.jwt.claims, like PostgREST and
``test_tenancy_concurrency.py``; here session-wide, because one connection runs many transactions),
and deletes the organization afterwards: demand rows first, then the organization with the delete
guard switched off for that transaction.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import psycopg
import pytest
from psycopg.types.json import Jsonb

from maqdar_engine import importformat

pytestmark = pytest.mark.db

ENTITIES = {entity.name: entity for entity in importformat.ENTITIES}
DEMAND_COLUMNS = ["item_code", "location_code", "demand_date", "quantity"]
ITEM_COLUMNS = ["item_code", "name_en", "product_group", "unit_of_measure", "unit_cost", "currency"]
LOCATIONS = ("L1", "L2")
FIRST_DAY = date(2021, 1, 1)
# 3 items x 2 locations x 834 days = 5,004 demand rows: above 5,000 staged rows, so the commit is stepped.
DAYS = 834
DEMAND_ROWS = 3 * len(LOCATIONS) * DAYS
# Ten stored items followed by 4,991 new ones: 5,001 rows, a stepped commit whose first unit merges rows 1-5,000.
STORED_ITEMS = [f"I-{n:05d}" for n in range(1, 11)]
NEW_ITEMS = [f"N-{n:05d}" for n in range(11, 5002)]

STEP = "select public.import_commit_step(%s, %s::integer)"
# Seconds a blocked call may take to show up in pg_locks, and the bound for "returns immediately".
WAIT_SECONDS = 15.0
IMMEDIATE_SECONDS = 2.0


@dataclass
class Tenant:
    dsn: str
    organization: uuid.UUID
    planners: tuple[uuid.UUID, uuid.UUID]
    items: dict[str, uuid.UUID] = field(default_factory=dict)


@dataclass
class ImportFile:
    """One file of an import: the contract columns it provides and its rows (column -> cell text)."""

    entity: str
    columns: list[str]
    rows: list[dict[str, str]]

    def cells(self, row: dict[str, str]) -> list[str | None]:
        return [row.get(c.name, "") if c.name in self.columns else None for c in ENTITIES[self.entity].columns]

    def payload(self, first_row: int, last_row: int) -> str:
        """The p_rows argument of import_stage_chunk: [row_no, cell, ...] per row, null for unmapped columns."""
        rows = [[n, *self.cells(self.rows[n - 1])] for n in range(first_row, last_row + 1)]
        return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))

    def manifest(self, file_no: int) -> dict[str, Any]:
        original = self.payload(1, len(self.rows)).encode()  # stands in for the uploaded file
        return {
            "file_no": file_no,
            "entity": self.entity,
            "original_name": f"{self.entity}.csv",
            "extension": "csv",
            "content_type": "text/csv",
            "size_bytes": len(original),
            "sha256": hashlib.sha256(original).hexdigest(),
            "rows_total": len(self.rows),
            "columns": self.columns,
        }


def _email(user: uuid.UUID) -> str:
    return f"import-concurrency-{user}@test.local"


@pytest.fixture
def tenant(dsn: str) -> Iterator[Tenant]:
    organization = uuid.uuid4()
    planners = (uuid.uuid4(), uuid.uuid4())
    try:
        with psycopg.connect(dsn, autocommit=True) as admin:
            for user in planners:
                admin.execute(
                    "insert into auth.users (id, email, email_confirmed_at) values (%s, %s, now())", (user, _email(user))
                )
            admin.execute(
                "insert into public.organizations (id, slug, name) values (%s, %s, 'Import concurrency test')",
                (organization, f"import-concurrency-{organization.hex[:12]}"),
            )
            for user in planners:
                admin.execute(
                    "insert into public.memberships (organization_id, user_id, role) values (%s, %s, 'planner')",
                    (organization, user),
                )
            for code in LOCATIONS:
                admin.execute(
                    "insert into public.locations (organization_id, code, name_en, location_type, country_code, timezone)"
                    " values (%s, %s, %s, 'branch', 'SA', 'Asia/Riyadh')",
                    (organization, code, f"Location {code}"),
                )
        yield Tenant(dsn, organization, planners)
    finally:
        # demand_history has no foreign keys, so its rows go first; the rest (imports included) cascades.
        with psycopg.connect(dsn) as conn:
            conn.execute("delete from public.demand_history where organization_id = %s", (organization,))
            conn.execute("set local maqdar.demand_guard = 'off'")
            conn.execute("delete from public.organizations where id = %s", (organization,))
            conn.execute("delete from auth.users where id = any(%s)", (list(planners),))


def _add_items(tenant: Tenant, codes: Sequence[str], name: Callable[[str], str] = lambda code: f"Item {code}") -> None:
    with psycopg.connect(tenant.dsn, autocommit=True) as admin:
        for code in codes:
            row = admin.execute(
                "insert into public.items (organization_id, code, name_en, product_group, unit_of_measure, unit_cost, currency)"
                " values (%s, %s, %s, 'PG', 'EA', 1.5, 'SAR') returning id",
                (tenant.organization, code, name(code)),
            ).fetchone()
            tenant.items[code] = row[0]


def _demand_file(item_codes: Sequence[str]) -> ImportFile:
    """Demand for every item at both locations on DAYS consecutive days, the first item's rows first."""
    rows = [
        {
            "item_code": item,
            "location_code": location,
            "demand_date": (FIRST_DAY + timedelta(days=day)).isoformat(),
            "quantity": str(1 + day % 5),
        }
        for item in item_codes
        for location in LOCATIONS
        for day in range(DAYS)
    ]
    return ImportFile("demand_history", DEMAND_COLUMNS, rows)


def _item_row(code: str, name: str) -> dict[str, str]:
    return {
        "item_code": code,
        "name_en": name,
        "product_group": "PG",
        "unit_of_measure": "EA",
        "unit_cost": "1.5",
        "currency": "SAR",
    }


def _item_file() -> ImportFile:
    """Renames I-00001..I-00005, repeats I-00006..I-00010 unchanged and adds 4,991 new items."""
    rows = [_item_row(code, f"New {code}" if n <= 5 else f"Old {code}") for n, code in enumerate(STORED_ITEMS, start=1)]
    rows += [_item_row(code, f"Item {code}") for code in NEW_ITEMS]
    return ImportFile("items", ITEM_COLUMNS, rows)


def _editor(tenant: Tenant, user: uuid.UUID) -> psycopg.Connection:
    """A connection impersonating the planner like PostgREST does, for every transaction it runs."""
    conn = psycopg.connect(tenant.dsn, autocommit=True)
    claims = json.dumps({"sub": str(user), "role": "authenticated", "email": _email(user)})
    conn.execute("set statement_timeout = '30s'")
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, false)", (claims,))
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(user),))
    conn.autocommit = False
    return conn


def _value(conn: psycopg.Connection, statement: str, params: tuple) -> Any:
    return conn.execute(statement, params).fetchone()[0]


def _stage(conn: psycopg.Connection, batch: uuid.UUID, file_no: int, file: ImportFile, first_row: int, last_row: int) -> dict:
    return _value(
        conn,
        "select public.import_stage_chunk(%s, %s::smallint, %s::integer, %s::text)",
        (batch, file_no, first_row, file.payload(first_row, last_row)),
    )


def _create(conn: psycopg.Connection, tenant: Tenant, files: Sequence[ImportFile]) -> uuid.UUID:
    batch = uuid.uuid4()
    manifest = [file.manifest(file_no) for file_no, file in enumerate(files, start=1)]
    _value(conn, "select public.import_create_batch(%s, %s, %s)", (batch, tenant.organization, Jsonb(manifest)))
    conn.commit()
    return batch


def _validated_import(conn: psycopg.Connection, tenant: Tenant, files: Sequence[ImportFile]) -> uuid.UUID:
    """Creates, stages (one committed transaction per chunk) and seals the files; the batch must validate."""
    batch = _create(conn, tenant, files)
    sealed: dict = {}
    for file_no, file in enumerate(files, start=1):
        size = ENTITIES[file.entity].stage_rows
        for first_row in range(1, len(file.rows) + 1, size):
            _stage(conn, batch, file_no, file, first_row, min(first_row + size - 1, len(file.rows)))
            conn.commit()
        sealed = _value(conn, "select public.import_seal_file(%s, %s::smallint, %s::integer)", (batch, file_no, len(file.rows)))
        conn.commit()
    assert sealed["batch"]["status"] == "validated", sealed
    return batch


def _step(conn: psycopg.Connection, batch: uuid.UUID, max_rows: int | None = None) -> dict:
    return _value(conn, STEP, (batch, max_rows))


def _finish(conn: psycopg.Connection, batch: uuid.UUID) -> dict:
    """Commit steps (each its own transaction) until the commit is done; returns the last state."""
    for _ in range(100):
        state = _step(conn, batch)
        conn.commit()
        if state["done"]:
            return state
    raise AssertionError("the commit did not finish within 100 steps")


def _refused(conn: psycopg.Connection, statement: str, params: tuple) -> tuple[str | None, str | None, float]:
    """Runs a statement that must fail; returns its SQLSTATE, hint and duration, and rolls back."""
    started = time.perf_counter()
    try:
        conn.execute(statement, params)
    except psycopg.Error as exc:
        elapsed = time.perf_counter() - started
        conn.rollback()
        return exc.sqlstate, exc.diag.message_hint, elapsed
    conn.rollback()
    raise AssertionError(f"expected an error from {statement}")


def _hold_import_lock(conn: psycopg.Connection, tenant: Tenant) -> None:
    """Takes the organization's import lock in an open transaction, as another writer's step would."""
    conn.execute(
        "select pg_advisory_xact_lock(hashtextextended('maqdar.import:' || %s::text, 0))", (tenant.organization,)
    )


class _Background(threading.Thread):
    """Runs work(conn) on its own connection, then commits; records the result, or the SQLSTATE and hint."""

    def __init__(self, conn: psycopg.Connection, work: Callable[[psycopg.Connection], Any]) -> None:
        super().__init__(daemon=True)
        self.conn, self.work = conn, work
        self.pid = conn.info.backend_pid
        self.result: Any = None
        self.sqlstate: str | None = None
        self.hint: str | None = None
        self.error: BaseException | None = None
        self.done = threading.Event()

    def run(self) -> None:
        try:
            self.result = self.work(self.conn)
            self.conn.commit()
        except psycopg.Error as exc:
            self.sqlstate, self.hint = exc.sqlstate, exc.diag.message_hint
            self.conn.rollback()
        except BaseException as exc:  # surfaced in the test thread by outcome()
            self.error = exc
            self.conn.rollback()
        finally:
            self.done.set()

    def outcome(self) -> None:
        self.join(timeout=60)
        assert not self.is_alive(), "the call never completed"
        if self.error is not None:
            raise self.error


def _wait_until_blocked(admin: psycopg.Connection, call: _Background, holder: psycopg.Connection) -> str:
    """Waits until the call's backend is blocked by the holder's transaction; returns the lock types it waits on."""
    holder_pid = holder.info.backend_pid
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        assert not call.done.is_set(), f"the call finished instead of waiting (sqlstate {call.sqlstate}, result {call.result})"
        blocked, locktypes = admin.execute(
            "select %s = any (pg_blocking_pids(%s)),"
            " (select string_agg(distinct l.locktype, ',') from pg_locks l where l.pid = %s and not l.granted)",
            (holder_pid, call.pid, call.pid),
        ).fetchone()
        if blocked:
            return locktypes
        time.sleep(0.05)
    raise AssertionError("the call was never blocked by the other transaction")


def _demand_count(conn: psycopg.Connection, tenant: Tenant, item: str | None = None) -> int:
    """The organization's demand rows (of one item when given) that this connection sees."""
    if item is None:
        return _value(conn, "select count(*) from public.demand_history where organization_id = %s", (tenant.organization,))
    return _value(
        conn,
        "select count(*) from public.demand_history where organization_id = %s and item_id = %s",
        (tenant.organization, tenant.items[item]),
    )


def _orphans(conn: psycopg.Connection, tenant: Tenant) -> int:
    """Demand rows whose item or location does not exist (demand_history has no foreign keys)."""
    return _value(
        conn,
        "select count(*) from public.demand_history d where d.organization_id = %s"
        " and (not exists (select 1 from public.items i where i.organization_id = d.organization_id and i.id = d.item_id)"
        " or not exists (select 1 from public.locations l"
        "                where l.organization_id = d.organization_id and l.id = d.location_id))",
        (tenant.organization,),
    )


def _batch_status(conn: psycopg.Connection, batch: uuid.UUID) -> str:
    return _value(conn, "select status from public.import_batches where id = %s", (batch,))


def _item(conn: psycopg.Connection, tenant: Tenant, code: str) -> tuple[str, datetime]:
    return conn.execute(
        "select name_en, updated_at from public.items where organization_id = %s and code = %s", (tenant.organization, code)
    ).fetchone()


def _ui_update(conn: psycopg.Connection, tenant: Tenant, code: str, name: str, updated_at: datetime) -> list[tuple]:
    """saveEntity's update: the row only when it still has the updated_at the form was loaded with."""
    return conn.execute(
        "update public.items set name_en = %s"
        " where organization_id = %s and id = %s and updated_at = %s returning id, updated_at",
        (name, tenant.organization, tenant.items[code], updated_at),
    ).fetchall()


def test_item_delete_during_a_demand_step_waits_then_refuses(tenant: Tenant) -> None:
    _add_items(tenant, ["C-T", "C-A", "C-B"])
    importer, deleter = _editor(tenant, tenant.planners[0]), _editor(tenant, tenant.planners[1])
    try:
        batch = _validated_import(importer, tenant, [_demand_file(["C-T", "C-A", "C-B"])])
        # Steps of one row per unit, in a transaction that stays open, until C-T has (uncommitted) demand.
        for _ in range(20):
            state = _step(importer, batch, 1)
            if _demand_count(importer, tenant, "C-T") > 0:
                break
        else:
            raise AssertionError("no demand row was merged")
        assert state["status"] == "committing", state

        with psycopg.connect(tenant.dsn, autocommit=True) as admin:
            # Nothing is committed yet: without the shared lock the guard's probe would find no demand.
            assert _demand_count(admin, tenant) == 0
            delete = _Background(
                deleter,
                lambda c: c.execute(
                    "delete from public.items where organization_id = %s and code = 'C-T'", (tenant.organization,)
                ).rowcount,
            )
            delete.start()
            assert _wait_until_blocked(admin, delete, importer) == "advisory"
            importer.commit()
            delete.outcome()
        assert delete.sqlstate == "MQ409", (delete.sqlstate, delete.result)

        final = _finish(importer, batch)
    finally:
        importer.close()
        deleter.close()

    assert final["status"] == "succeeded", final
    assert final["counts"]["demand_history"]["inserted"] == DEMAND_ROWS
    with psycopg.connect(tenant.dsn) as admin:
        assert _value(admin, "select count(*) from public.items where id = %s", (tenant.items["C-T"],)) == 1
        assert _demand_count(admin, tenant, "C-T") == len(LOCATIONS) * DAYS
        assert _demand_count(admin, tenant) == DEMAND_ROWS
        assert _orphans(admin, tenant) == 0


def test_item_deleted_before_a_demand_step_fails_the_step_without_orphans(tenant: Tenant) -> None:
    _add_items(tenant, ["C-X", "C-A", "C-B"])
    importer, deleter = _editor(tenant, tenant.planners[0]), _editor(tenant, tenant.planners[1])
    holder = psycopg.connect(tenant.dsn)
    try:
        batch = _validated_import(importer, tenant, [_demand_file(["C-X", "C-A", "C-B"])])

        # The delete passes the guard (C-X has no demand yet) and keeps the shared import lock until it commits.
        deleted = deleter.execute(
            "delete from public.items where organization_id = %s and code = 'C-X'", (tenant.organization,)
        ).rowcount
        assert deleted == 1
        with psycopg.connect(tenant.dsn, autocommit=True) as admin:
            modes = admin.execute(
                "select array_agg(mode) from pg_locks where pid = %s and locktype = 'advisory' and granted",
                (deleter.info.backend_pid,),
            ).fetchone()[0]
        assert modes == ["ShareLock"]
        sqlstate, hint, elapsed = _refused(importer, STEP, (batch, 1))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        deleter.commit()

        # The first merge range re-checks its references under the lock and fails before writing anything.
        failed = _finish(importer, batch)
        assert (failed["status"], failed["failure_code"]) == ("failed", "changed_during_commit"), failed
        with psycopg.connect(tenant.dsn) as admin:
            assert _demand_count(admin, tenant) == 0
            assert _value(admin, "select merged_through_row from public.import_files where batch_id = %s", (batch,)) == 0
            assert (
                _value(
                    admin,
                    "select count(*) from public.import_errors where batch_id = %s and code = 'unknown_reference'"
                    " and column_name = 'item_code' and detail ->> 'phase' = 'commit'",
                    (batch,),
                )
                == len(LOCATIONS) * DAYS
            )

        # import_resume takes the same try-lock.
        _hold_import_lock(holder, tenant)
        sqlstate, hint, elapsed = _refused(importer, "select public.import_resume(%s)", (batch,))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        holder.commit()

        # With the item back, the resumed commit retries the failed unit and completes.
        _add_items(tenant, ["C-X"])
        assert _value(importer, "select public.import_resume(%s)", (batch,))["status"] == "committing"
        importer.commit()
        final = _finish(importer, batch)
    finally:
        importer.close()
        deleter.close()
        holder.close()

    assert final["status"] == "succeeded", final
    with psycopg.connect(tenant.dsn) as admin:
        assert _demand_count(admin, tenant) == DEMAND_ROWS
        assert _orphans(admin, tenant) == 0


def test_a_second_commit_in_the_organization_is_refused(tenant: Tenant) -> None:
    _add_items(tenant, ["C-T", "C-A", "C-B"])
    first, second = _editor(tenant, tenant.planners[0]), _editor(tenant, tenant.planners[1])
    try:
        demand = _validated_import(first, tenant, [_demand_file(["C-T", "C-A", "C-B"])])
        items = _validated_import(second, tenant, [ImportFile("items", ITEM_COLUMNS, [_item_row("NEW-1", "New item")])])

        # While the first commit's step is still open, the second cannot take the import lock.
        assert _step(first, demand, 1)["status"] == "committing"
        sqlstate, hint, elapsed = _refused(second, STEP, (items, None))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        first.commit()

        # Between steps the lock is free, but the first batch keeps the organization's committing slot.
        sqlstate, hint, _ = _refused(second, STEP, (items, None))
        assert (sqlstate, hint) == ("MQ409", "another_commit")
        with psycopg.connect(tenant.dsn) as admin:
            assert _batch_status(admin, items) == "validated"
            assert _batch_status(admin, demand) == "committing"

        assert _finish(first, demand)["status"] == "succeeded"
        state = _step(second, items)
        second.commit()
    finally:
        first.close()
        second.close()

    assert (state["done"], state["status"], state["counts"]["items"]["inserted"]) == (True, "succeeded", 1), state
    with psycopg.connect(tenant.dsn) as admin:
        assert _demand_count(admin, tenant) == DEMAND_ROWS
        assert _value(
            admin, "select count(*) from public.items where organization_id = %s and code = 'NEW-1'", (tenant.organization,)
        ) == 1


def test_concurrent_identical_chunks_are_staged_once(tenant: Tenant) -> None:
    _add_items(tenant, ["C-A", "C-B"])
    rows = [
        {"item_code": item, "location_code": "L1", "demand_date": (FIRST_DAY + timedelta(days=day)).isoformat(), "quantity": "2"}
        for item in ("C-A", "C-B")
        for day in range(20)
    ]
    rows[4]["item_code"] = "C-ZZZ"  # one unknown reference, so a doubled check would show as two errors
    file = ImportFile("demand_history", DEMAND_COLUMNS, rows)
    first, second = _editor(tenant, tenant.planners[0]), _editor(tenant, tenant.planners[1])
    burst = [_editor(tenant, tenant.planners[n % 2]) for n in range(4)]
    try:
        batch = _create(first, tenant, [file])

        # Race: the identical second call waits for the first transaction, then replays its stored result.
        staged = _stage(first, batch, 1, file, 1, 20)
        replay = _Background(second, lambda c: _stage(c, batch, 1, file, 1, 20))
        replay.start()
        with psycopg.connect(tenant.dsn, autocommit=True) as admin:
            _wait_until_blocked(admin, replay, first)
        first.commit()
        replay.outcome()
        assert replay.sqlstate is None, (replay.sqlstate, replay.hint)
        assert (staged["replayed"], staged["staged"], staged["errors_added"]) == (False, 20, 1), staged
        assert replay.result == {**staged, "replayed": True}

        # Burst: four identical calls at once; exactly one stages, the others replay its result.
        barrier = threading.Barrier(len(burst))

        def stage_together(conn: psycopg.Connection) -> dict:
            barrier.wait(timeout=10)
            return _stage(conn, batch, 1, file, 21, 40)

        calls = [_Background(conn, stage_together) for conn in burst]
        for call in calls:
            call.start()
        for call in calls:
            call.outcome()
        assert [call.sqlstate for call in calls] == [None] * len(calls)
        results = [call.result for call in calls]
        assert sorted(result["replayed"] for result in results) == [False, True, True, True]
        assert all({**result, "replayed": False} == {**results[0], "replayed": False} for result in results)

        sealed = _value(first, "select public.import_seal_file(%s, 1::smallint, %s::integer)", (batch, len(rows)))
        first.commit()
    finally:
        for conn in (first, second, *burst):
            conn.close()

    assert (sealed["rows_staged"], sealed["error_count"], sealed["batch"]["status"]) == (40, 1, "invalid"), sealed
    with psycopg.connect(tenant.dsn) as admin:
        assert _value(admin, "select count(*) from ingest.staged_chunks where batch_id = %s", (batch,)) == 2
        assert _value(admin, "select count(*) from ingest.staged_rows where batch_id = %s", (batch,)) == 40
        assert _value(admin, "select rows_staged from public.import_batches where id = %s", (batch,)) == 40
        assert _value(admin, "select count(*) from public.import_errors where batch_id = %s and level = 'error'", (batch,)) == 1


def test_ui_update_during_an_item_merge_step_waits_and_keeps_the_import(tenant: Tenant) -> None:
    _add_items(tenant, STORED_ITEMS, name=lambda code: f"Old {code}")
    importer, ui = _editor(tenant, tenant.planners[0]), _editor(tenant, tenant.planners[1])
    try:
        batch = _validated_import(importer, tenant, [_item_file()])
        with psycopg.connect(tenant.dsn, autocommit=True) as admin:
            _, loaded_at = _item(admin, tenant, "I-00001")  # the form a user opened before the import
            _, untouched_at = _item(admin, tenant, "I-00006")

            # The merge of rows 1-5,000 runs in a transaction that stays open.
            for _ in range(20):
                _step(importer, batch)
                if _item(importer, tenant, "I-00001")[0] == "New I-00001":
                    break
            else:
                raise AssertionError("the item merge did not run")

            save = _Background(ui, lambda c: _ui_update(c, tenant, "I-00001", "UI edit", loaded_at))
            save.start()
            assert _wait_until_blocked(admin, save, importer) == "transactionid"
            importer.commit()
            save.outcome()
        # The row changed while the save waited: the stale form matches nothing (the UI reports a conflict).
        assert (save.sqlstate, save.result) == (None, [])

        final = _finish(importer, batch)
        assert final["status"] == "succeeded", final
        assert final["counts"]["items"] == {"inserted": 4991, "updated": 5, "unchanged": 5, "deleted": 0, "skipped": 0}

        with psycopg.connect(tenant.dsn, autocommit=True) as admin:
            names = dict(
                admin.execute(
                    "select code, name_en from public.items where organization_id = %s and code like 'I-%%'",
                    (tenant.organization,),
                ).fetchall()
            )
            assert names == {code: f"{'New' if n <= 5 else 'Old'} {code}" for n, code in enumerate(STORED_ITEMS, start=1)}
            assert _item(admin, tenant, "I-00001")[1] > loaded_at
            assert _item(admin, tenant, "I-00006")[1] == untouched_at
            assert _value(admin, "select count(*) from public.items where organization_id = %s", (tenant.organization,)) == 5001
            _, current = _item(admin, tenant, "I-00001")

        # The form reloaded after the import saves normally.
        assert len(_ui_update(ui, tenant, "I-00001", "UI edit", current)) == 1
        ui.commit()
    finally:
        importer.close()
        ui.close()


def test_item_merge_step_waits_for_an_open_ui_update(tenant: Tenant) -> None:
    _add_items(tenant, STORED_ITEMS, name=lambda code: f"Old {code}")
    importer, ui = _editor(tenant, tenant.planners[0]), _editor(tenant, tenant.planners[1])
    try:
        batch = _validated_import(importer, tenant, [_item_file()])
        # A user saves two rows the file renames: one to another name, one to exactly the file's name.
        for code, name in (("I-00002", "UI edit"), ("I-00003", "New I-00003")):
            assert len(_ui_update(ui, tenant, code, name, _item(ui, tenant, code)[1])) == 1

        commit = _Background(importer, lambda c: _finish(c, batch))
        commit.start()
        with psycopg.connect(tenant.dsn, autocommit=True) as admin:
            _wait_until_blocked(admin, commit, ui)
        ui.commit()
        commit.outcome()
    finally:
        importer.close()
        ui.close()

    assert commit.sqlstate is None, (commit.sqlstate, commit.hint)
    final = commit.result
    assert final["status"] == "succeeded", final
    # The step re-reads the saved rows: I-00002 takes the file's name, I-00003 already has it (unchanged).
    assert final["counts"]["items"] == {"inserted": 4991, "updated": 4, "unchanged": 6, "deleted": 0, "skipped": 0}
    with psycopg.connect(tenant.dsn) as admin:
        names = dict(
            admin.execute(
                "select code, name_en from public.items where organization_id = %s and code like 'I-%%'", (tenant.organization,)
            ).fetchall()
        )
        assert names == {code: f"{'New' if n <= 5 else 'Old'} {code}" for n, code in enumerate(STORED_ITEMS, start=1)}
        assert _value(admin, "select count(*) from public.items where organization_id = %s", (tenant.organization,)) == 5001


def test_commit_step_does_not_wait_for_a_held_import_lock(tenant: Tenant) -> None:
    _add_items(tenant, ["C-T", "C-A", "C-B"])
    importer = _editor(tenant, tenant.planners[0])
    holder = psycopg.connect(tenant.dsn)
    try:
        batch = _validated_import(importer, tenant, [_demand_file(["C-T", "C-A", "C-B"])])

        # A validated batch: the try-lock fails at once and nothing changes.
        _hold_import_lock(holder, tenant)
        sqlstate, hint, elapsed = _refused(importer, STEP, (batch, 1))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        with psycopg.connect(tenant.dsn) as admin:
            assert _batch_status(admin, batch) == "validated"
        holder.commit()

        state = _step(importer, batch, 1)
        importer.commit()
        assert state["status"] == "committing", state

        # A batch between steps: the same.
        _hold_import_lock(holder, tenant)
        sqlstate, hint, elapsed = _refused(importer, STEP, (batch, 1))
        assert (sqlstate, hint) == ("MQ409", "import_in_progress")
        assert elapsed < IMMEDIATE_SECONDS
        holder.commit()

        final = _finish(importer, batch)
    finally:
        importer.close()
        holder.close()

    assert final["status"] == "succeeded", final
    with psycopg.connect(tenant.dsn) as admin:
        assert _demand_count(admin, tenant) == DEMAND_ROWS
        assert _orphans(admin, tenant) == 0
