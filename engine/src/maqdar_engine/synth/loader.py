"""Loads a validated bundle into the LOCAL Supabase stack's application tables.

Safety: the DSN must point at a loopback host (no override), the server must be Postgres 17 with
the Step 2 migrations applied, and the role must bypass row-level security (COPY cannot target
RLS tables otherwise). Natural keys are turned into deterministic uuid5 ids client side, so no
read-back is needed and reloads are idempotent. Everything happens in one transaction.

demand_history has no foreign keys, so references are checked twice: codes are matched against the
bundle's own parents before each COPY (fails fast, before minutes of loading), and a set-based
anti-join over distinct item-location pairs runs at the end, after the parent tables are analyzed.
Without fresh statistics the planner believed the new organization had one item and nested-looped a
materialised copy of all 50,000 for each of 13 M demand rows (killed after 2.7 CPU-hours).
"""

from __future__ import annotations

import io
import time
import uuid
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable

import polars as pl
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from .. import importformat
from .presets import NAMESPACE
from .validate import entity_files, read_csv_text
from .writer import read_manifest

DEFAULT_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
REQUIRED_MIGRATIONS = ("20261009085052", "20261009085056", "20261009085100", "20261009085104")
COPY_BATCH_ROWS = 250_000

Progress = Callable[[str], None]


class LoaderRefused(RuntimeError):
    """The target is not the local stack or is not ready."""


def check_dsn(dsn: str) -> dict[str, str]:
    """Rejects anything that is not explicitly the local stack. Raises LoaderRefused."""
    lowered = dsn.lower()
    for marker in ("supabase.co", "supabase.com", "service="):
        if marker in lowered:
            raise LoaderRefused(f"refusing DSN containing {marker!r}: the loader only targets the local stack")
    try:
        params = conninfo_to_dict(dsn)
    except psycopg.ProgrammingError as exc:
        raise LoaderRefused(f"invalid DSN: {exc}") from exc
    host = params.get("host")
    if not host:
        raise LoaderRefused("DSN must name a host explicitly (localhost, 127.0.0.1 or ::1)")
    for candidate in str(host).split(","):
        if candidate.strip().strip("[]") not in LOOPBACK_HOSTS:
            raise LoaderRefused(f"host {candidate!r} is not loopback; the loader never touches remote databases")
    hostaddr = params.get("hostaddr")
    if hostaddr and str(hostaddr) not in LOOPBACK_HOSTS:
        raise LoaderRefused(f"hostaddr {hostaddr!r} is not loopback")
    return {k: str(v) for k, v in params.items()}


def preflight(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("select current_setting('server_version_num')::int")
        version = int(cur.fetchone()[0])
        if not 170000 <= version < 180000:
            raise LoaderRefused(f"expected PostgreSQL 17, found server_version_num {version}")
        cur.execute("select to_regclass('supabase_migrations.schema_migrations') is not null")
        if not cur.fetchone()[0]:
            raise LoaderRefused("supabase_migrations.schema_migrations is missing: this is not a Supabase stack")
        cur.execute("select version from supabase_migrations.schema_migrations")
        applied = {row[0] for row in cur.fetchall()}
        missing = [m for m in REQUIRED_MIGRATIONS if m not in applied]
        if missing:
            raise LoaderRefused(f"migrations not applied on the target: {missing}; run `pnpm db:reset`")
        cur.execute("select rolbypassrls from pg_roles where rolname = current_user")
        if not cur.fetchone()[0]:
            raise LoaderRefused("the connection role cannot bypass row-level security; connect as postgres")


def row_id(organization_id: uuid.UUID, entity: str, code: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"{organization_id}/{entity}/{code}")


@dataclass
class LoadReport:
    organization_id: uuid.UUID
    rows: dict[str, int] = field(default_factory=dict)
    membership_user_id: uuid.UUID | None = None


def _frame_for_table(
    frame: pl.DataFrame,
    entity: importformat.Entity,
    organization_id: uuid.UUID,
    known: dict[str, set[str]],
    source: str,
) -> tuple[list[str], pl.DataFrame]:
    """Maps a CSV frame onto the table's column list (ids resolved client side).

    `known` holds the natural keys already loaded per entity; a lookup column whose code is not in
    its parent's set raises LoaderRefused before anything is copied.
    """
    org = str(organization_id)
    columns: dict[str, pl.Series] = {"organization_id": pl.Series([org] * frame.height, dtype=pl.Utf8)}
    if not entity.monthly_parts:
        key_frame = frame.select(list(entity.natural_key))
        keys = ["|".join(str(v) for v in row) for row in key_frame.iter_rows()]
        columns["id"] = pl.Series([str(row_id(organization_id, entity.name, key)) for key in keys], dtype=pl.Utf8)
        known.setdefault(entity.name, set()).update(keys)
    for column in entity.columns:
        series = frame[column.name]
        series = pl.Series(column.target, [None if v == "" else v for v in series.to_list()], dtype=pl.Utf8)
        if column.lookup:
            parents = known.get(column.lookup, set())
            cache: dict[str, str] = {}
            unknown: set[str] = set()
            mapped = []
            for value in series.to_list():
                if value is None:
                    mapped.append(None)
                elif value in cache:
                    mapped.append(cache[value])
                else:
                    if value not in parents:
                        unknown.add(value)
                    cache[value] = str(row_id(organization_id, column.lookup, value))
                    mapped.append(cache[value])
            if unknown:
                sample = ", ".join(sorted(unknown)[:5])
                raise LoaderRefused(
                    f"{source}: {len(unknown)} {column.name} value(s) do not exist in {column.lookup} ({sample}); nothing was committed"
                )
            series = pl.Series(column.target, mapped, dtype=pl.Utf8)
        columns[column.target] = series
    out = pl.DataFrame(columns)
    return list(out.columns), out


def _copy_frame(cur: psycopg.Cursor, table: str, column_names: list[str], frame: pl.DataFrame) -> int:
    schema, name = table.split(".")
    statement = sql.SQL("copy {}.{} ({}) from stdin with (format csv, header match, null '')").format(
        sql.Identifier(schema),
        sql.Identifier(name),
        sql.SQL(", ").join(sql.Identifier(c) for c in column_names),
    )
    total = 0
    for offset in range(0, frame.height, COPY_BATCH_ROWS):
        chunk = frame.slice(offset, COPY_BATCH_ROWS)
        buffer = io.BytesIO()
        chunk.write_csv(buffer, include_header=True, line_terminator="\n", quote_style="necessary")
        with cur.copy(statement) as copy:
            copy.write(buffer.getvalue())
        total += chunk.height
    return total


def load_bundle(
    out_dir: Path,
    dsn: str = DEFAULT_DSN,
    replace: bool = False,
    member_email: str | None = None,
    progress: Progress = print,
) -> LoadReport:
    check_dsn(dsn)
    manifest = read_manifest(out_dir)
    org = manifest["organization"]
    organization_id = uuid.UUID(org["id"])
    report = LoadReport(organization_id=organization_id)

    with psycopg.connect(dsn, autocommit=False) as conn:
        preflight(conn)
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("set local time zone 'UTC'")
            cur.execute("set local synchronous_commit = off")
            cur.execute("set local work_mem = '64MB'")
            known: dict[str, set[str]] = {}
            cur.execute("select 1 from public.organizations where id = %s", (organization_id,))
            if cur.fetchone():
                if not replace:
                    raise LoaderRefused(f"organization {org['slug']} already exists; pass --replace to reload")
                started = time.perf_counter()
                # demand_history has no foreign keys, so its rows go first; the rest cascades.
                cur.execute("delete from public.demand_history where organization_id = %s", (organization_id,))
                cur.execute("delete from public.organizations where id = %s", (organization_id,))
                progress(f"replaced organization {org['slug']} (deleted in {time.perf_counter() - started:.1f}s)")
            cur.execute(
                "insert into public.organizations (id, slug, name, base_currency, home_country) values (%s, %s, %s, %s, %s)",
                (organization_id, org["slug"], org["name"], org["base_currency"], org["home_country"]),
            )
            cur.execute(
                "select app.ensure_demand_history_partitions(%s, %s)",
                (date.fromisoformat(manifest["window_start"]), date.fromisoformat(manifest["window_end"])),
            )
            for entity in importformat.ENTITIES:
                total = 0
                started = time.perf_counter()
                for path in entity_files(out_dir, entity):
                    frame = read_csv_text(path)
                    source = path.relative_to(out_dir).as_posix()
                    column_names, mapped = _frame_for_table(frame, entity, organization_id, known, source)
                    total += _copy_frame(cur, entity.table, column_names, mapped)
                report.rows[entity.name] = total
                progress(f"loaded {entity.table}: {total:,} rows in {time.perf_counter() - started:.1f}s")
            started = time.perf_counter()
            # Fresh statistics on the parents are what keep the reference check linear: the quadratic
            # plan needs an underestimated inner side. demand_history is left to autovacuum because an
            # ANALYZE of the partitioned table re-samples every partition (40 s with the large preset
            # present, for a tiny load). Table names come from the contract, not from input.
            cur.execute("analyze " + ", ".join(entity.table for entity in importformat.ENTITIES if not entity.monthly_parts))
            progress(f"analyzed master data in {time.perf_counter() - started:.1f}s")
            started = time.perf_counter()
            _check_demand_references(cur, organization_id)
            progress(f"checked demand references in {time.perf_counter() - started:.1f}s")
            if member_email:
                cur.execute("select id from auth.users where email = %s", (member_email,))
                row = cur.fetchone()
                if row is None:
                    raise LoaderRefused(f"no auth user with email {member_email!r}; sign in once first")
                cur.execute(
                    "insert into public.memberships (organization_id, user_id, role) values (%s, %s, 'owner') "
                    "on conflict (organization_id, user_id) do update set role = excluded.role",
                    (organization_id, row[0]),
                )
                report.membership_user_id = row[0]
                progress(f"granted owner membership to {member_email}")
    return report


def _check_demand_references(cur: psycopg.Cursor, organization_id: uuid.UUID) -> None:
    """Set-based replacement for the foreign keys demand_history deliberately lacks.

    The DISTINCT collapses millions of demand rows to at most items × locations pairs before the
    anti-joins, so even a badly estimated plan stays cheap (one pass over the organization's rows).
    """
    cur.execute(
        """
        with pairs as materialized (
          select distinct item_id, location_id
          from public.demand_history
          where organization_id = %(org)s
        )
        select
          (select count(*) from pairs p
           where not exists (select 1 from public.items i where i.organization_id = %(org)s and i.id = p.item_id)),
          (select count(*) from pairs p
           where not exists (select 1 from public.locations l where l.organization_id = %(org)s and l.id = p.location_id))
        """,
        {"org": organization_id},
    )
    missing_items, missing_locations = cur.fetchone()
    if missing_items or missing_locations:
        raise LoaderRefused(
            f"demand rows reference {missing_items} unknown item id(s) and {missing_locations} unknown location id(s); nothing was committed"
        )


def table_counts(dsn: str, organization_id: uuid.UUID) -> dict[str, int]:
    """Row counts per application table for one organization (used by tests and `verify`)."""
    check_dsn(dsn)
    counts: dict[str, int] = {}
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        for entity in importformat.ENTITIES:
            schema, name = entity.table.split(".")
            cur.execute(
                sql.SQL("select count(*) from {}.{} where organization_id = %s").format(sql.Identifier(schema), sql.Identifier(name)),
                (organization_id,),
            )
            counts[entity.name] = int(cur.fetchone()[0])
    return counts
