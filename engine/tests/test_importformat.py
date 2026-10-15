import json
import re
from pathlib import Path

import pytest

from maqdar_engine import importformat
from maqdar_engine.importformat import Column, Entity, Rule
from maqdar_engine.synth import GENERATOR_VERSION
from maqdar_engine.synth.network import countries, currencies

from conftest import REPO_ROOT

DOC = REPO_ROOT / "docs" / "import-format.md"
SCHEMA = REPO_ROOT / "docs" / "import-format.schema.json"
SHARED_SCHEMA = REPO_ROOT / "packages" / "shared" / "src" / "import-format.schema.json"
SHARED_PACKAGE = REPO_ROOT / "packages" / "shared" / "package.json"
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
BEGIN = "<!-- import-format:begin -->"
END = "<!-- import-format:end -->"

LOAD_ORDER = (
    "work_calendars",
    "holiday_overrides",
    "locations",
    "network_links",
    "brands",
    "items",
    "item_supersessions",
    "item_interchanges",
    "suppliers",
    "supplier_items",
    "fx_rates",
    "demand_history",
    "stock_snapshots",
    "open_orders",
    "receipts",
)
OPTIONAL = {"stock_snapshots", "open_orders", "receipts", "work_calendars", "holiday_overrides", "network_links", "item_interchanges", "fx_rates"}


def test_every_money_column_has_a_currency_sibling():
    for entity in importformat.ENTITIES:
        kinds = {c.kind for c in entity.columns}
        if "money" in kinds:
            assert "currency" in kinds, entity.name


def test_references_resolve():
    for entity, column in importformat.iter_references():
        ref_entity, ref_column = column.references.split(".")
        if ref_entity == "currencies":
            assert ref_column == "code" and currencies()
        elif ref_entity == "countries":
            assert ref_column == "code" and countries()
        else:
            target = importformat.ENTITY_BY_NAME[ref_entity]
            assert ref_column in target.header, (entity.name, column.name)
            assert target.load_order <= entity.load_order, (entity.name, column.name)


def test_lookup_columns_name_their_target():
    for entity in importformat.ENTITIES:
        for column in entity.columns:
            if column.lookup:
                assert column.db_column and column.db_column.endswith("_id"), (entity.name, column.name)
                assert column.lookup in importformat.ENTITY_BY_NAME


def test_natural_keys_are_first_columns():
    for entity in importformat.ENTITIES:
        assert entity.header[: len(entity.natural_key)] == list(entity.natural_key), entity.name


def test_versions_are_unchanged():
    assert importformat.FORMAT_VERSION == 1
    assert GENERATOR_VERSION == "1.2.0"


def test_load_order_and_optional_entities():
    assert importformat.ENTITY_NAMES == LOAD_ORDER
    assert [e.load_order for e in importformat.ENTITIES] == list(range(1, len(LOAD_ORDER) + 1))
    assert {e.name for e in importformat.ENTITIES if not e.required_in_bundle} == OPTIONAL


def test_step_sizes():
    for entity in importformat.ENTITIES:
        expected = (10_000, 10_000) if entity.name == "demand_history" else (5_000, 5_000)
        assert (entity.stage_rows, entity.merge_rows) == expected, entity.name


def test_rules_over_optional_columns_are_not_groups():
    """A file may map one side of these rules; the other keeps its stored value (checked on effective values)."""
    items = importformat.ENTITY_BY_NAME["items"]
    assert items.column_groups == (("unit_cost", "currency"),)
    assert [(r.code, r.columns) for r in items.row_rules] == [("end_before_start", ("introduced_on", "discontinued_on"))]
    supplier_items = importformat.ENTITY_BY_NAME["supplier_items"]
    assert supplier_items.column_groups == (("unit_price", "currency"),)
    assert [(r.code, r.columns) for r in supplier_items.row_rules] == [("p90_below_p50", ("lead_time_days", "lead_time_days_p90"))]
    grouped = {(e.name, c) for e in importformat.ENTITIES for group in e.column_groups for c in group}
    assert {("items", "introduced_on"), ("items", "discontinued_on")}.isdisjoint(grouped)
    assert {("supplier_items", "lead_time_days"), ("supplier_items", "lead_time_days_p90")}.isdisjoint(grouped)
    # Groups that stay: both sides required (lead times), or meaningless apart (money and currency, freight, holiday dates).
    assert importformat.ENTITY_BY_NAME["suppliers"].column_groups == (("lead_time_days_p50", "lead_time_days_p90"),)


def test_generator_headers_are_unchanged():
    locations = importformat.ENTITY_BY_NAME["locations"]
    suppliers = importformat.ENTITY_BY_NAME["suppliers"]
    assert locations.minimal_header == [
        "location_code", "name_en", "name_ar", "location_type", "country_code", "city",
        "latitude", "longitude", "timezone", "parent_location_code", "is_active",
    ]  # fmt: skip
    assert suppliers.minimal_header == [
        "supplier_code", "name_en", "name_ar", "country_code", "currency",
        "lead_time_days_p50", "lead_time_days_p90", "is_active",
    ]  # fmt: skip
    for entity in (locations, suppliers):
        assert entity.header == entity.minimal_header + ["work_calendar_code"]
        assert entity.accepted_headers == [entity.minimal_header, entity.header]
        column = entity.column("work_calendar_code")
        assert column.omittable and column.nullable and column.lookup == "work_calendars"
    for entity in importformat.ENTITIES:
        if entity.name not in ("locations", "suppliers"):
            assert entity.minimal_header == entity.header, entity.name


def test_supersession_key_is_the_predecessor():
    entity = importformat.ENTITY_BY_NAME["item_supersessions"]
    assert entity.natural_key == ("predecessor_item_code",)
    assert [r.code for r in entity.row_rules] == ["must_differ"]
    assert [r.code for r in entity.set_rules] == ["supersession_cycle"]


def test_slash_only_in_item_codes():
    item_code = re.compile(importformat.ITEM_CODE_PATTERN)
    code = re.compile(importformat.CODE_PATTERN)
    assert item_code.fullmatch("AB-12/34.5_x") and not code.fullmatch("AB-12/34.5_x")
    assert code.fullmatch("RUH-DC") and not code.fullmatch("-RUH") and not code.fullmatch("A" * 65)
    for entity in importformat.ENTITIES:
        for column in entity.columns:
            if column.kind not in importformat.CODE_KINDS:
                continue
            is_item = (entity.name, column.name) == ("items", "item_code") or column.references == "items.item_code"
            assert (column.kind == "item_code") == is_item, (entity.name, column.name)


def test_unordered_pairs():
    assert {e.name for e in importformat.ENTITIES if e.unordered_pair} == {"item_interchanges", "fx_rates"}
    assert importformat.ENTITY_BY_NAME["fx_rates"].natural_key == ("from_currency", "to_currency", "valid_from")
    assert importformat.ENTITY_BY_NAME["item_interchanges"].natural_key == ("item_code", "alternate_item_code")


def test_holiday_scope_key():
    entity = importformat.ENTITY_BY_NAME["holiday_overrides"]
    assert entity.natural_key == ("country_code", "work_calendar_code", "starts_on")
    assert [r.code for r in entity.row_rules] == ["scope_exactly_one", "end_before_start", "holiday_too_long"]
    assert [r.code for r in entity.set_rules] == ["holiday_overlap"]
    assert entity.column_groups == (("starts_on", "ends_on"),)
    assert entity.column("kind").enum == ("closure", "working_day")


def test_step4_columns_match_the_tables():
    """Bounds, scales, enums and defaults of the Step 4 tables (20261011074315_master_data_completion.sql)."""
    links = importformat.ENTITY_BY_NAME["network_links"]
    for name in ("lead_time_days_p50", "lead_time_days_p90"):
        assert (links.column(name).min_value, links.column(name).max_value) == (0, 3650)
    assert links.column("freight_basis").enum == ("none", "per_unit", "per_shipment")
    assert links.column("freight_basis").default == "none"
    assert links.column("freight_cost").kind == "money" and links.column("freight_cost").min_value == 0
    assert links.column_groups == (("lead_time_days_p50", "lead_time_days_p90"), ("freight_basis", "freight_cost", "currency"))
    assert [r.code for r in links.row_rules] == ["must_differ", "p90_below_p50", "freight_mismatch"]

    interchanges = importformat.ENTITY_BY_NAME["item_interchanges"]
    assert interchanges.column("direction").enum == ("one_way", "two_way")
    assert interchanges.column("direction").default == "two_way"
    priority = interchanges.column("priority")
    assert (priority.min_value, priority.max_value, priority.default) == (1, 99, "1")
    assert interchanges.column("note").max_length == 1000

    rate = importformat.ENTITY_BY_NAME["fx_rates"].column("rate")
    assert (rate.scale, rate.integer_digits, rate.greater_than, rate.min_value) == (10, 10, 0, None)

    calendars = importformat.ENTITY_BY_NAME["work_calendars"]
    assert calendars.column("weekend_days").kind == "weekdays"
    assert calendars.column("weekend_days").default == ""
    assert calendars.column("observe_public_holidays").default == "true"
    assert [r.code for r in calendars.row_rules] == ["country_required"]

    brands = importformat.ENTITY_BY_NAME["brands"]
    assert brands.column("brand_type").enum == ("oem", "aftermarket")
    assert brands.column("country_of_origin").references is None


def test_numeric_and_text_metadata():
    for entity in importformat.ENTITIES:
        for column in entity.columns:
            if column.kind in ("decimal", "money"):
                assert column.scale is not None and column.integer_digits is not None, (entity.name, column.name)
                if column.name not in ("latitude", "longitude", "rate"):
                    assert (column.scale, column.integer_digits) == (3, 12), (entity.name, column.name)
            if column.kind == "money":
                assert column.min_value == 0, (entity.name, column.name)
            if column.kind == "integer":
                assert column.integer_digits == 9 and column.scale is None, (entity.name, column.name)
            if column.kind == "text":
                assert column.max_length and column.max_length <= 1000, (entity.name, column.name)
            if column.name in ("name_en", "name_ar"):
                assert column.max_length == 200
    items = importformat.ENTITY_BY_NAME["items"]
    assert items.column("product_group").max_length == 64
    supplier_items = importformat.ENTITY_BY_NAME["supplier_items"]
    assert supplier_items.column("pack_size").greater_than == 0
    assert supplier_items.column("min_order_quantity").min_value == 0
    assert importformat.ENTITY_BY_NAME["item_supersessions"].column("quantity_factor").greater_than == 0
    for name in ("quantity", "lost_sales_quantity"):
        assert importformat.ENTITY_BY_NAME["demand_history"].column(name).min_value == 0


def test_required_for_new_rows():
    items = importformat.ENTITY_BY_NAME["items"]
    required = [c.name for c in items.columns if items.required_for_new(c)]
    assert required == ["name_en", "product_group", "unit_of_measure", "unit_cost", "currency"]
    supplier_items = importformat.ENTITY_BY_NAME["supplier_items"]
    assert [c.name for c in supplier_items.columns if supplier_items.required_for_new(c)] == ["lead_time_days", "unit_price", "currency"]
    demand = importformat.ENTITY_BY_NAME["demand_history"]
    assert not any(demand.required_for_new(c) for c in demand.columns)


def test_patterns_are_portable_and_strict():
    for kind, pattern in importformat.KIND_PATTERNS.items():
        if pattern is None:
            assert kind in ("text", "enum")
            continue
        assert pattern.startswith("^") and pattern.endswith("$"), kind
        assert "\\d" not in pattern and "\\w" not in pattern, kind  # Python's \d matches Arabic-Indic digits
        re.compile(pattern)
    weekdays = re.compile(importformat.KIND_PATTERNS["weekdays"])
    assert weekdays.fullmatch("5;6") and weekdays.fullmatch("") and weekdays.fullmatch("1;2;3;4;5;6")
    assert not weekdays.fullmatch("1;2;3;4;5;6;7") and not weekdays.fullmatch("8") and not weekdays.fullmatch("5,6")
    decimal = re.compile(importformat.DECIMAL_PATTERN)
    assert decimal.fullmatch("-1.5") and decimal.fullmatch("0012")
    for bad in ("1.", ".5", "1,5", "1e3", "١٢", "+1", " 1"):
        assert not decimal.fullmatch(bad), bad
    timezone = re.compile(importformat.KIND_PATTERNS["timezone"])
    assert timezone.fullmatch("America/Argentina/Buenos_Aires") and timezone.fullmatch("Etc/GMT+3")
    assert not timezone.fullmatch("Asia/Riyadh'; drop table x")


def test_error_codes_cover_every_rule_and_kind():
    codes = [code for code, _ in importformat.ERROR_CODES]
    assert len(codes) == len(set(codes))
    assert all(level in ("error", "warning") for _, level in importformat.ERROR_CODES)
    assert importformat.ROW_RULE_CODES | importformat.SET_RULE_CODES <= set(codes)
    assert {c for c in importformat.KIND_ERROR_CODES.values() if c} <= set(codes)
    assert {code for code, level in importformat.ERROR_CODES if level == "warning"} == {"zero_row_new_key", "source_missing"}
    # Never emitted: groups are enforced when the import is created (MQ422 mapping), and demand quantities
    # below 0 are out_of_range.
    assert not {"column_group_incomplete", "demand_negative"} & set(codes)


@pytest.mark.parametrize(
    "build",
    [
        lambda: Column("name", "text"),
        lambda: Column("name", "text", max_length=10, min_value=0),
        lambda: Column("code", "code", max_length=10),
        lambda: Column("kind", "enum", enum=("a",), default="b"),
        lambda: Column("note", "text", max_length=10, omittable=True),
        lambda: Column("n", "integer", scale=2),
        lambda: Column("n", "decimal", min_value=0, greater_than=0),
    ],
)
def test_column_metadata_is_checked(build):
    with pytest.raises(ValueError):
        build()


def _entity(**overrides):
    fields = dict(
        name="things",
        table="public.things",
        file="things.csv",
        description="",
        natural_key=("thing_code",),
        columns=(Column("thing_code", "code"), Column("price", "money", min_value=0), Column("currency", "currency")),
        column_groups=(("price", "currency"),),
    )
    fields.update(overrides)
    return Entity(**fields)


def test_entity_metadata_is_checked():
    assert _entity().header == ["thing_code", "price", "currency"]  # the template itself is valid
    with pytest.raises(ValueError, match="grouped with currency"):
        _entity(column_groups=())
    with pytest.raises(ValueError, match="trailing"):
        _entity(columns=(Column("thing_code", "code"), Column("a", "text", max_length=5, nullable=True, omittable=True), Column("b", "text", max_length=5)), column_groups=())
    with pytest.raises(ValueError, match="unknown row rule"):
        _entity(row_rules=(Rule("nope", ("thing_code",), "thing_code", ""),))
    with pytest.raises(ValueError, match="must be required"):
        _entity(columns=(Column("thing_code", "code", nullable=True),), column_groups=())


def test_markdown_lists_every_file():
    text = importformat.to_markdown()
    for entity in importformat.ENTITIES:
        assert f"`{entity.file}`" in text
        for column in entity.columns:
            assert f"`{column.name}`" in text
        for rule in (*entity.row_rules, *entity.set_rules):
            assert f"`{rule.code}`" in text


def test_outputs_are_deterministic():
    assert importformat.to_markdown() == importformat.to_markdown()
    assert importformat.to_json() == importformat.to_json()
    assert importformat.to_sql() == importformat.to_sql()


def test_schema_json_is_current():
    assert SCHEMA.read_bytes() == importformat.to_json().encode("utf-8"), (
        "docs/import-format.schema.json is stale: run `uv run maqdar-synth format --json --write`"
    )


def test_shared_schema_is_a_byte_identical_copy():
    assert SHARED_SCHEMA.read_bytes() == SCHEMA.read_bytes(), (
        "packages/shared/src/import-format.schema.json is stale: run `uv run maqdar-synth format --json --write`"
    )
    exports = json.loads(SHARED_PACKAGE.read_text(encoding="utf-8"))["exports"]
    assert exports["./import-format.schema.json"] == "./src/import-format.schema.json"


def test_schema_json_shape():
    payload = json.loads(importformat.to_json())
    assert payload["format_version"] == 1
    assert [e["name"] for e in payload["entities"]] == list(LOAD_ORDER)
    assert set(payload["kinds"]) == set(importformat.KINDS)
    keys = None
    for entity in payload["entities"]:
        for column in entity["columns"]:
            keys = keys or set(column)
            assert set(column) == keys, (entity["name"], column["name"])
    items = next(e for e in payload["entities"] if e["name"] == "items")
    unit_cost = next(c for c in items["columns"] if c["name"] == "unit_cost")
    assert unit_cost == {
        "name": "unit_cost",
        "kind": "money",
        "required": True,
        "required_for_new": True,
        "natural_key": False,
        "omittable": False,
        "description": "Standard cost per unit.",
        "pattern": importformat.DECIMAL_PATTERN,
        "max_length": None,
        "scale": 3,
        "integer_digits": 12,
        "min_value": 0,
        "max_value": None,
        "greater_than": None,
        "enum": None,
        "default": None,
        "references": None,
        "lookup": None,
        "target_column": "unit_cost",
    }


def test_docs_import_format_is_current():
    """docs/import-format.md embeds the generated sections between markers; prettier may realign the tables."""
    text = DOC.read_text(encoding="utf-8")
    assert BEGIN in text and END in text, "markers missing from docs/import-format.md"
    embedded = text[text.index(BEGIN) + len(BEGIN) : text.index(END)]
    assert importformat.normalise_markdown(embedded) == importformat.normalise_markdown(importformat.to_markdown()), (
        "docs/import-format.md is stale: run `uv run maqdar-synth format --markdown --write`"
    )


def test_sql_has_one_row_per_entity_and_column():
    sql = importformat.to_sql()
    entities, columns = sql.split("\n\n")
    assert entities.startswith("-- Generated by `uv run maqdar-synth format --sql`")
    assert sum(line.startswith("  ('") for line in entities.splitlines()) == len(importformat.ENTITIES)
    assert sum(line.startswith("  ('") for line in columns.splitlines()) == sum(len(e.columns) for e in importformat.ENTITIES)
    assert "None" not in sql and "\r" not in sql
    assert "  ('items', 6, 'public.items', array['item_code']::text[], false, false, true, 5000, 5000, " in sql
    assert (
        "  ('fx_rates', 4, 'rate', 'decimal', true, false, true, null, '^-?[0-9]+(\\.[0-9]+)?$', null, 10, 10, null, null, 0, "
        "null, null, null, 'rate')"
    ) in sql
    assert "  ('item_interchanges', 3, 'direction', 'enum', true, false, false, 'two_way', null, null, null, null, null, null, null, array['one_way', 'two_way']::text[], null, null, 'direction')" in sql
    marked = importformat.to_sql_with_marks()
    assert marked.startswith(importformat.SQL_BEGIN_MARK + "\n") and marked.endswith(importformat.SQL_END_MARK + "\n")
    assert importformat.extract_sql_block("-- before\n" + marked.replace("\n", "\r\n") + "-- after\n") == sql
    assert importformat.extract_sql_block("select 1;\n") is None


def test_sql_seed_matches_the_latest_migration():
    """The import wizard migration embeds `maqdar-synth format --sql` between the markers."""
    embedded = [(path, importformat.extract_sql_block(path.read_text(encoding="utf-8"))) for path in sorted(MIGRATIONS.glob("*.sql"))]
    embedded = [(path, block) for path, block in embedded if block is not None]
    if not embedded:
        pytest.skip("no migration embeds the generated import contract yet")
    path, block = embedded[-1]
    assert block == importformat.to_sql(), (
        f"{path.name} is stale: run `uv run maqdar-synth format --sql` and replace the block between the markers"
    )
