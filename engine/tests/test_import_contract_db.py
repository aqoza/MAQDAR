"""The import contract against the local database (`-m db`).

* Every contract column exists in its application table with matching nullability, default, enum
  values and code pattern, and every NOT NULL column without a default is part of the contract.
* The generated seed (`zeespare-synth format --sql`) runs against tables shaped like
  ``ingest.contract_entities`` / ``ingest.contract_columns`` (temporary copies, rolled back).
* Once the import wizard migration exists, its seeded rows equal the Python contract.
"""

from __future__ import annotations

import re
from decimal import Decimal

import psycopg
import pytest

from zeespare_engine import importformat

pytestmark = pytest.mark.db

# The contract tables as the import wizard migration is expected to create them (in `ingest`).
CONTRACT_DDL = """
create temporary table contract_entities (
  entity text primary key,
  load_order smallint not null unique,
  table_name text not null,
  natural_key text[] not null,
  unordered_pair boolean not null,
  monthly_parts boolean not null,
  required_in_bundle boolean not null,
  stage_rows integer not null,
  merge_rows integer not null,
  row_rules text[] not null,
  set_rules text[] not null,
  column_groups jsonb not null
) on commit drop;
create temporary table contract_columns (
  entity text not null references contract_entities (entity),
  position smallint not null,
  name text not null,
  kind text not null,
  required boolean not null,
  natural_key boolean not null,
  required_for_new boolean not null,
  default_value text,
  pattern text,
  max_length integer,
  scale smallint,
  integer_digits smallint,
  min_value numeric,
  max_value numeric,
  greater_than numeric,
  enum_values text[],
  reference text,
  lookup_entity text references contract_entities (entity),
  db_column text not null,
  primary key (entity, position),
  unique (entity, name)
) on commit drop;
"""

# Columns the application maintains itself (never imported).
SYSTEM_COLUMNS = {"id", "organization_id", "created_at", "updated_at", "search_text", "scope_key"}


def _table_columns(cur: psycopg.Cursor, table: str) -> dict[str, tuple[bool, str | None]]:
    schema, name = table.split(".")
    cur.execute(
        "select column_name, is_nullable = 'YES', column_default from information_schema.columns"
        " where table_schema = %s and table_name = %s",
        (schema, name),
    )
    return {row[0]: (row[1], row[2]) for row in cur.fetchall()}


def _default_text(cur: psycopg.Cursor, expression: str) -> str:
    cur.execute(f"select ({expression})::text")  # the expression comes from the catalog, not from input
    return cur.fetchone()[0]


def _canonical_default(column: importformat.Column) -> str:
    if column.kind == "weekdays":
        return "{" + ",".join(column.default.split(";")) + "}" if column.default else "{}"
    return column.default


def _check_definitions(cur: psycopg.Cursor, table: str) -> list[str]:
    cur.execute("select pg_get_constraintdef(oid) from pg_constraint where conrelid = %s::regclass and contype = 'c'", (table,))
    return [row[0] for row in cur.fetchall()]


def test_contract_columns_exist_in_the_application_tables(dsn: str):
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        for entity in importformat.ENTITIES:
            table = _table_columns(cur, entity.table)
            assert table, entity.table
            targets = set()
            for column in entity.columns:
                assert column.target in table, (entity.name, column.name)
                targets.add(column.target)
                nullable, default = table[column.target]
                if column.kind == "weekdays":
                    assert not nullable, (entity.name, column.name)  # empty means '{}', not NULL
                else:
                    assert nullable == column.nullable, (entity.name, column.name)
                if column.default is None:
                    assert default is None, (entity.name, column.name, default)
                else:
                    assert default is not None, (entity.name, column.name)
                    assert _default_text(cur, default) == _canonical_default(column), (entity.name, column.name)
            uncovered = [
                name
                for name, (nullable, default) in table.items()
                if not nullable and default is None and name not in SYSTEM_COLUMNS and name not in targets
            ]
            assert uncovered == [], (entity.name, uncovered)


def test_enum_values_and_code_patterns_match_the_check_constraints(dsn: str):
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        for entity in importformat.ENTITIES:
            checks = _check_definitions(cur, entity.table)
            for column in entity.columns:
                if column.kind == "enum":
                    found = [
                        set(re.findall(r"'([^']*)'::text", match))
                        for definition in checks
                        for match in re.findall(rf"\b{column.target} = ANY \(ARRAY\[(.*?)\]\)", definition)
                    ]
                    assert found == [set(column.enum)], (entity.name, column.name, found)
                if column.kind in importformat.CODE_KINDS and column.target == "code":
                    assert any(f"(code ~ '{column.pattern}'::text)" in definition for definition in checks), (entity.name, column.name)


def _python_entity_rows() -> list[tuple]:
    return [
        (
            e.name,
            e.load_order,
            e.table,
            list(e.natural_key),
            e.unordered_pair,
            e.monthly_parts,
            e.required_in_bundle,
            e.stage_rows,
            e.merge_rows,
            [r.code for r in e.row_rules],
            [r.code for r in e.set_rules],
            [list(group) for group in e.column_groups],
        )
        for e in importformat.ENTITIES
    ]


def _number(value: int | None) -> Decimal | None:
    return None if value is None else Decimal(value)


def _python_column_rows() -> list[tuple]:
    return [
        (
            e.name,
            position,
            c.name,
            c.kind,
            c.required,
            e.is_natural_key(c.name),
            e.required_for_new(c),
            c.default,
            c.pattern,
            c.max_length,
            c.scale,
            c.integer_digits,
            _number(c.min_value),
            _number(c.max_value),
            _number(c.greater_than),
            list(c.enum) if c.enum else None,
            c.references,
            c.lookup,
            c.target,
        )
        for e in importformat.ENTITIES
        for position, c in enumerate(e.columns, start=1)
    ]


def _select(cur: psycopg.Cursor, schema: str) -> tuple[list[tuple], list[tuple]]:
    cur.execute(f"select {', '.join(importformat.CONTRACT_ENTITY_COLUMNS)} from {schema}.contract_entities order by load_order")
    entities = [tuple(row) for row in cur.fetchall()]
    cur.execute(f"select {', '.join(importformat.CONTRACT_COLUMN_COLUMNS)} from {schema}.contract_columns order by entity collate \"C\", position")
    columns = [tuple(row) for row in cur.fetchall()]
    return entities, columns


def test_generated_seed_loads_into_contract_shaped_tables(dsn: str):
    seed = importformat.to_sql().replace("insert into ingest.", "insert into pg_temp.")
    with psycopg.connect(dsn) as conn:
        with conn.transaction(force_rollback=True), conn.cursor() as cur:
            cur.execute(CONTRACT_DDL)
            cur.execute(seed)
            entities, columns = _select(cur, "pg_temp")
            assert entities == _python_entity_rows()
            assert columns == sorted(_python_column_rows(), key=lambda row: (row[0], row[1]))
            # Every pattern is a valid Postgres regular expression with the same verdicts as Python.
            cur.execute("select distinct pattern from pg_temp.contract_columns where pattern is not null")
            for (pattern,) in cur.fetchall():
                for sample in ("5;6", "", "P-1/2", "RUH-DC", "-1.25", "2026-02-30", "true", "SAR", "Asia/Riyadh", "١٢"):
                    cur.execute("select %s ~ %s", (sample, pattern))
                    assert cur.fetchone()[0] == bool(re.search(pattern, sample)), (pattern, sample)


def test_migrated_contract_equals_the_python_contract(dsn: str):
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select to_regclass('ingest.contract_entities') is not null")
        if not cur.fetchone()[0]:
            pytest.skip("the import wizard migration (ingest.contract_*) is not applied yet")
        entities, columns = _select(cur, "ingest")
    assert entities == _python_entity_rows()
    assert columns == sorted(_python_column_rows(), key=lambda row: (row[0], row[1]))


def test_import_error_codes_and_levels_match_the_contract(dsn: str):
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select to_regclass('public.import_errors') is not null")
        if not cur.fetchone()[0]:
            pytest.skip("the import wizard migration (import_errors) is not applied yet")
        cur.execute(
            "select conname, pg_get_constraintdef(oid) from pg_constraint"
            " where conrelid = 'public.import_errors'::regclass and contype = 'c'"
            " and conname in ('import_errors_code_check', 'import_errors_level_matches_code')"
        )
        definitions = dict(cur.fetchall())
    codes = set(re.findall(r"'([a-z0-9_]+)'::text", definitions["import_errors_code_check"]))
    warnings = set(re.findall(r"'([a-z0-9_]+)'::text", definitions["import_errors_level_matches_code"])) - {"warning"}
    assert codes == {code for code, _ in importformat.ERROR_CODES}
    assert warnings == {code for code, level in importformat.ERROR_CODES if level == "warning"}
