"""MAQDAR import format v1.

The single source of truth for the CSV bundle that the synthetic generator writes, the validator
checks, the loader maps onto the application tables, the import wizard validates in SQL
(``ingest.contract_entities`` / ``ingest.contract_columns``, seeded from ``to_sql()``) and
``docs/import-format.md`` documents. Natural keys are codes; the import is scoped to the
organization performing it, so no file carries an organization id.

Version 1 is frozen once the import wizard ships: later changes are additive (optional entities and
optional trailing columns), never a renamed, removed or reordered column.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Iterator

FORMAT_VERSION = 1

CODE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
ITEM_CODE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$"
DECIMAL_PATTERN = r"^-?[0-9]+(\.[0-9]+)?$"

# Column kinds: a description, the syntax every non-empty value must match (POSIX-compatible
# regular expressions that Postgres, Python and JavaScript read alike; [0-9] rather than \d, which
# matches Arabic-Indic digits in Python) and the error code a value that does not match gets.
# Enums have no pattern (their values are listed per column); text has none either.
KINDS: dict[str, str] = {
    "code": "code: 1-64 characters, letters, digits, . _ and -, starting with a letter or digit",
    "item_code": "part number: 1-64 characters, letters, digits, . _ - and /, starting with a letter or digit",
    "text": "text",
    "integer": "integer",
    "decimal": "decimal number with a dot separator",
    "money": "decimal amount in the row's currency, dot separator",
    "currency": "ISO 4217 currency code (three capital letters)",
    "country": "ISO 3166-1 alpha-2 country code (two capital letters)",
    "date": "date, YYYY-MM-DD",
    "boolean": "true or false",
    "enum": "one of the listed values",
    "weekdays": "ISO weekdays 1-7 (1 = Monday) joined by ; (for example 5;6), distinct, at most 6; empty for none",
    "timezone": "IANA time zone name, for example Asia/Riyadh",
}

KIND_PATTERNS: dict[str, str | None] = {
    "code": CODE_PATTERN,
    "item_code": ITEM_CODE_PATTERN,
    "text": None,
    "integer": r"^-?[0-9]+$",
    "decimal": DECIMAL_PATTERN,
    "money": DECIMAL_PATTERN,
    "currency": r"^[A-Z]{3}$",
    "country": r"^[A-Z]{2}$",
    "date": r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    "boolean": r"^(true|false)$",
    "enum": None,
    "weekdays": r"^([1-7](;[1-7]){0,5})?$",
    "timezone": r"^[A-Za-z][A-Za-z0-9_+/-]*$",
}

KIND_ERROR_CODES: dict[str, str | None] = {
    "code": "invalid_code",
    "item_code": "invalid_item_code",
    "text": None,
    "integer": "invalid_integer",
    "decimal": "invalid_decimal",
    "money": "invalid_decimal",
    "currency": "unknown_currency",
    "country": "unknown_country",
    "date": "invalid_date",
    "boolean": "invalid_boolean",
    "enum": "invalid_enum",
    "weekdays": "invalid_weekdays",
    "timezone": "invalid_timezone",
}

NUMERIC_KINDS = frozenset({"integer", "decimal", "money"})
CODE_KINDS = frozenset({"code", "item_code"})

# Rules that compare columns of one row. Each is handwritten SQL in the import wizard and Python
# in synth/validate.py; the code is what an import error reports.
ROW_RULE_CODES = frozenset(
    {
        "end_before_start",
        "p90_below_p50",
        "must_differ",
        "freight_mismatch",
        "country_required",
        "scope_exactly_one",
        "holiday_too_long",
        "date_outside_history_window",
    }
)
# Rules over the rows of a whole file (plus the stored rows they do not replace).
SET_RULE_CODES = frozenset({"holiday_overlap", "supersession_cycle", "location_cycle", "preferred_conflict"})

# Stable machine codes of import errors and warnings (import_errors.code); the web app translates
# them through the ImportErrors message namespace.
ERROR_CODES: tuple[tuple[str, str], ...] = (
    ("required", "error"),
    ("required_for_new", "error"),
    ("too_long", "error"),
    ("invalid_code", "error"),
    ("invalid_item_code", "error"),
    ("invalid_integer", "error"),
    ("invalid_decimal", "error"),
    ("too_many_decimals", "error"),
    ("too_many_digits", "error"),
    ("out_of_range", "error"),
    ("invalid_date", "error"),
    ("invalid_boolean", "error"),
    ("invalid_enum", "error"),
    ("invalid_weekdays", "error"),
    ("invalid_timezone", "error"),
    ("unknown_currency", "error"),
    ("unknown_country", "error"),
    ("unknown_reference", "error"),
    ("duplicate_key", "error"),
    ("end_before_start", "error"),
    ("p90_below_p50", "error"),
    ("must_differ", "error"),
    ("freight_mismatch", "error"),
    ("country_required", "error"),
    ("scope_exactly_one", "error"),
    ("holiday_too_long", "error"),
    ("holiday_overlap", "error"),
    ("supersession_cycle", "error"),
    ("location_cycle", "error"),
    ("preferred_conflict", "error"),
    ("date_outside_history_window", "error"),
    ("source_size_mismatch", "error"),
    ("changed_during_commit", "error"),
    ("concurrent_change", "error"),
    ("zero_row_new_key", "warning"),
    ("source_missing", "warning"),
)

NAME_MAX_LENGTH = 200
NOTE_MAX_LENGTH = 1000
TIME_ZONE_MAX_LENGTH = 64
CODE_MAX_LENGTH = 64
MONEY_INTEGER_DIGITS = 12
"""numeric(18,3) holds 15 integer digits; 12 keep every value exact as a JavaScript number."""
INTEGER_DIGITS = 9
MASTER_STAGE_ROWS = 5_000
DEMAND_STAGE_ROWS = 10_000
MASTER_MERGE_ROWS = 5_000
DEMAND_MERGE_ROWS = 10_000
"""Rows per stepped-commit unit of demand: 20,000-row units of a fresh import hit the 8 s statement
timeout in end-to-end runs (10,000 take 0.6 to 1.5 s)."""


@dataclass(frozen=True)
class Column:
    name: str
    kind: str
    description: str = ""
    nullable: bool = False
    """True when a cell may be empty (an empty cell stores NULL, or no weekend days for weekdays)."""
    enum: tuple[str, ...] = ()
    scale: int | None = None
    """Fractional digits kept (decimal and money; 3 unless set)."""
    integer_digits: int | None = None
    """Digits before the decimal point (12 for decimal and money, 9 for integers, unless set)."""
    max_length: int | None = None
    """Characters (code kinds 64, timezone 64; text columns must set it)."""
    min_value: int | None = None
    max_value: int | None = None
    greater_than: int | None = None
    default: str | None = None
    """Canonical value a new row gets when the column is not provided (the table default)."""
    references: str | None = None
    """``entity.column`` this value must exist in (foreign key by natural key)."""
    db_column: str | None = None
    """Target column in the application table when it differs from the CSV name."""
    lookup: str | None = None
    """Entity whose row id replaces this code in the application table."""
    omittable: bool = False
    """An optional trailing column that a bundle file may leave out of its header."""

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown column kind {self.kind!r} for {self.name}")
        if self.kind == "enum" and not self.enum:
            raise ValueError(f"enum column {self.name} needs values")
        if self.kind != "enum" and self.enum:
            raise ValueError(f"only enum columns list values ({self.name})")
        if self.lookup and not self.db_column:
            raise ValueError(f"lookup column {self.name} needs db_column")
        if self.kind in ("decimal", "money"):
            object.__setattr__(self, "scale", 3 if self.scale is None else self.scale)
            object.__setattr__(self, "integer_digits", MONEY_INTEGER_DIGITS if self.integer_digits is None else self.integer_digits)
        elif self.kind == "integer":
            if self.scale is not None:
                raise ValueError(f"integer column {self.name} has no scale")
            object.__setattr__(self, "integer_digits", INTEGER_DIGITS if self.integer_digits is None else self.integer_digits)
        elif self.scale is not None or self.integer_digits is not None:
            raise ValueError(f"scale and integer_digits apply to numeric columns only ({self.name})")
        if self.kind not in NUMERIC_KINDS and (self.min_value, self.max_value, self.greater_than) != (None, None, None):
            raise ValueError(f"bounds apply to numeric columns only ({self.name})")
        if self.min_value is not None and self.greater_than is not None:
            raise ValueError(f"{self.name}: use either min_value or greater_than")
        if self.kind in CODE_KINDS:
            if self.max_length not in (None, CODE_MAX_LENGTH):
                raise ValueError(f"code column {self.name} is at most {CODE_MAX_LENGTH} characters")
            object.__setattr__(self, "max_length", CODE_MAX_LENGTH)
        elif self.kind == "timezone":
            object.__setattr__(self, "max_length", self.max_length or TIME_ZONE_MAX_LENGTH)
        elif self.kind == "text":
            if not self.max_length:
                raise ValueError(f"text column {self.name} needs max_length")
        elif self.max_length is not None:
            raise ValueError(f"max_length applies to text, code and timezone columns only ({self.name})")
        if self.default is not None and self.kind == "enum" and self.default not in self.enum:
            raise ValueError(f"default {self.default!r} of {self.name} is not one of its values")
        if self.omittable and not self.nullable:
            raise ValueError(f"omittable column {self.name} must be optional")

    @property
    def target(self) -> str:
        return self.db_column or self.name

    @property
    def required(self) -> bool:
        """A provided cell must not be empty."""
        return not self.nullable

    @property
    def pattern(self) -> str | None:
        return KIND_PATTERNS[self.kind]

    @property
    def error_code(self) -> str | None:
        """Code of a non-empty value that does not match the kind's syntax."""
        return KIND_ERROR_CODES[self.kind]

    @property
    def bounds_label(self) -> str:
        if self.min_value is not None and self.max_value is not None:
            return f"{self.min_value} to {self.max_value}"
        parts = []
        if self.min_value is not None:
            parts.append(f"≥ {self.min_value}")
        if self.greater_than is not None:
            parts.append(f"> {self.greater_than}")
        if self.max_value is not None:
            parts.append(f"≤ {self.max_value}")
        return ", ".join(parts)

    @property
    def type_label(self) -> str:
        if self.kind == "enum":
            return "one of " + ", ".join(f"`{value}`" for value in self.enum)
        if self.kind == "code":
            return "code (1-64 characters: letters, digits, `.` `_` `-`)"
        if self.kind == "item_code":
            return "part number (1-64 characters: letters, digits, `.` `_` `-` `/`)"
        if self.kind == "text":
            return f"text, at most {self.max_length} characters"
        if self.kind == "integer":
            label = "integer"
            bounds = self.bounds_label
            if self.max_value is None:
                label += f", at most {self.integer_digits} digits"
            return label + (f", {bounds}" if bounds else "")
        if self.kind in ("decimal", "money"):
            label = "money in `currency`" if self.kind == "money" else "decimal"
            label += f", ≤ {self.integer_digits} integer and ≤ {self.scale} fractional digits"
            bounds = self.bounds_label
            return label + (f", {bounds}" if bounds else "")
        if self.kind == "currency":
            return "ISO 4217 currency code"
        if self.kind == "country":
            return "ISO 3166-1 alpha-2 country code"
        if self.kind == "date":
            return "date, `YYYY-MM-DD`"
        if self.kind == "boolean":
            return "`true` or `false`"
        if self.kind == "weekdays":
            return "ISO weekdays 1-7 (1 = Monday) joined by `;`, e.g. `5;6`; distinct, at most 6"
        if self.kind == "timezone":
            return f"IANA time zone name, at most {self.max_length} characters"
        return KINDS[self.kind]


@dataclass(frozen=True)
class Rule:
    """A row rule (compares columns of one row) or a set rule (over a whole file)."""

    code: str
    columns: tuple[str, ...]
    column: str
    """The column an error is reported on."""
    description: str


@dataclass(frozen=True)
class Entity:
    name: str
    table: str
    file: str
    description: str
    natural_key: tuple[str, ...]
    columns: tuple[Column, ...]
    monthly_parts: bool = False
    unordered_pair: bool = False
    """The first two natural-key columns form an unordered pair: (a, b) and (b, a) are one key."""
    required_in_bundle: bool = True
    """False for optional entities: a bundle may leave the file out."""
    column_groups: tuple[tuple[str, ...], ...] = ()
    """Columns that a file provides together or not at all."""
    row_rules: tuple[Rule, ...] = ()
    set_rules: tuple[Rule, ...] = ()
    stage_rows: int = MASTER_STAGE_ROWS
    """Most rows the import wizard sends in one chunk."""
    merge_rows: int = MASTER_MERGE_ROWS
    """Most staged rows one stepped commit unit merges."""

    def __post_init__(self) -> None:
        names = [c.name for c in self.columns]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate column names in {self.name}")
        for key in self.natural_key:
            if key not in names:
                raise ValueError(f"natural key {key} is not a column of {self.name}")
        scope_columns = {c for rule in self.row_rules if rule.code == "scope_exactly_one" for c in rule.columns}
        for key in self.natural_key:
            if self.column(key).nullable and key not in scope_columns:
                raise ValueError(f"natural key {key} of {self.name} must be required (or one of a scope_exactly_one pair)")
        money = {c.name for c in self.columns if c.kind == "money"}
        if money and not any(c.kind == "currency" for c in self.columns):
            raise ValueError(f"{self.name} has money columns {money} but no currency column")
        for column in money:
            if not any(column in group and "currency" in group for group in self.column_groups):
                raise ValueError(f"{self.name}.{column} must be grouped with currency")
        for group in self.column_groups:
            if len(group) < 2 or any(c not in names for c in group):
                raise ValueError(f"bad column group {group} in {self.name}")
        for rule in self.row_rules + self.set_rules:
            if any(c not in names for c in rule.columns) or rule.column not in rule.columns:
                raise ValueError(f"rule {rule.code} of {self.name} names unknown columns")
        for rule in self.row_rules:
            if rule.code not in ROW_RULE_CODES:
                raise ValueError(f"unknown row rule {rule.code} in {self.name}")
        for rule in self.set_rules:
            if rule.code not in SET_RULE_CODES:
                raise ValueError(f"unknown set rule {rule.code} in {self.name}")
        omittable = [i for i, c in enumerate(self.columns) if c.omittable]
        if omittable and omittable != list(range(len(self.columns) - len(omittable), len(self.columns))):
            raise ValueError(f"omittable columns of {self.name} must be trailing")
        for index in omittable:
            column = self.columns[index]
            if column.name in self.natural_key or any(column.name in group for group in self.column_groups):
                raise ValueError(f"omittable column {column.name} cannot be a key or grouped")
        if self.unordered_pair:
            if len(self.natural_key) < 2:
                raise ValueError(f"unordered pair of {self.name} needs two key columns")
            first, second = (self.column(k) for k in self.natural_key[:2])
            if first.kind != second.kind or first.references != second.references:
                raise ValueError(f"unordered pair columns of {self.name} differ in kind or reference")
        if self.stage_rows <= 0 or self.merge_rows <= 0:
            raise ValueError(f"step sizes of {self.name} must be positive")

    @property
    def header(self) -> list[str]:
        """Every column in contract order."""
        return [c.name for c in self.columns]

    @property
    def minimal_header(self) -> list[str]:
        """The header without the optional trailing columns (what the generator writes)."""
        return [c.name for c in self.columns if not c.omittable]

    @property
    def accepted_headers(self) -> list[list[str]]:
        """Bundle headers the validator and loader accept: the minimal header plus any prefix of the omittable columns."""
        start = len(self.minimal_header)
        return [self.header[:n] for n in range(start, len(self.columns) + 1)]

    @property
    def load_order(self) -> int:
        return ENTITY_NAMES.index(self.name) + 1

    def column(self, name: str) -> Column:
        for c in self.columns:
            if c.name == name:
                return c
        raise KeyError(name)

    def is_natural_key(self, name: str) -> bool:
        return name in self.natural_key

    def required_for_new(self, column: Column) -> bool:
        """The column must be provided when a file creates rows: required, no table default, not a key."""
        return column.required and column.default is None and not self.is_natural_key(column.name)


def _name_columns() -> tuple[Column, Column]:
    return (
        Column("name_en", "text", "English name.", max_length=NAME_MAX_LENGTH),
        Column("name_ar", "text", "Arabic name.", nullable=True, max_length=NAME_MAX_LENGTH),
    )


def _work_calendar_column() -> Column:
    return Column(
        "work_calendar_code",
        "code",
        "Work calendar; empty for the country default (weekends and public holidays).",
        nullable=True,
        references="work_calendars.work_calendar_code",
        db_column="work_calendar_id",
        lookup="work_calendars",
        omittable=True,
    )


def _active_column(description: str) -> Column:
    return Column("is_active", "boolean", description, default="true")


ENTITIES: tuple[Entity, ...] = (
    Entity(
        name="work_calendars",
        table="public.work_calendars",
        file="work_calendars.csv",
        description="Working-day calendars: weekend days and whether a country's public holidays apply. Locations and suppliers without a calendar use their country's default.",
        natural_key=("work_calendar_code",),
        required_in_bundle=False,
        columns=(
            Column("work_calendar_code", "code", "Unique calendar code.", db_column="code"),
            *_name_columns(),
            Column(
                "country_code",
                "country",
                "Country whose public holidays apply (sector all).",
                nullable=True,
                references="countries.code",
            ),
            Column("weekend_days", "weekdays", "Weekend days; empty for none.", nullable=True, default=""),
            Column(
                "observe_public_holidays",
                "boolean",
                "The country's public holidays are non-working days (needs country_code).",
                default="true",
            ),
            _active_column("false for calendars no longer used."),
        ),
        row_rules=(
            Rule(
                "country_required",
                ("country_code", "observe_public_holidays"),
                "country_code",
                "`observe_public_holidays` (true unless provided) needs a `country_code`.",
            ),
        ),
    ),
    Entity(
        name="holiday_overrides",
        table="public.holiday_overrides",
        file="holiday_overrides.csv",
        description="Calendar exceptions for one country (every location and supplier there without its own calendar) or one work calendar: closure adds non-working days, working_day cancels a public holiday or weekend day.",
        natural_key=("country_code", "work_calendar_code", "starts_on"),
        required_in_bundle=False,
        columns=(
            Column(
                "country_code",
                "country",
                "Country scope; empty when work_calendar_code is set.",
                nullable=True,
                references="countries.code",
            ),
            Column(
                "work_calendar_code",
                "code",
                "Calendar scope; empty when country_code is set.",
                nullable=True,
                references="work_calendars.work_calendar_code",
                db_column="work_calendar_id",
                lookup="work_calendars",
            ),
            Column("starts_on", "date", "First day."),
            Column("ends_on", "date", "Last day (on or after starts_on, at most 366 days in all)."),
            Column(
                "kind",
                "enum",
                "closure: non-working days; working_day: working days despite a holiday or weekend.",
                enum=("closure", "working_day"),
            ),
            *_name_columns(),
            Column("note", "text", "Free text.", nullable=True, max_length=NOTE_MAX_LENGTH),
        ),
        column_groups=(("starts_on", "ends_on"),),
        row_rules=(
            Rule(
                "scope_exactly_one",
                ("country_code", "work_calendar_code"),
                "country_code",
                "Exactly one of `country_code` and `work_calendar_code` is set.",
            ),
            Rule("end_before_start", ("starts_on", "ends_on"), "ends_on", "`ends_on` is on or after `starts_on`."),
            Rule(
                "holiday_too_long",
                ("starts_on", "ends_on"),
                "ends_on",
                "An override covers at most 366 days.",
            ),
        ),
        set_rules=(
            Rule(
                "holiday_overlap",
                ("country_code", "work_calendar_code", "starts_on", "ends_on"),
                "starts_on",
                "Overrides of one scope do not overlap (within the file and with stored overrides it does not replace).",
            ),
        ),
    ),
    Entity(
        name="locations",
        table="public.locations",
        file="locations.csv",
        description="Warehouses, regional hubs and branches of the network.",
        natural_key=("location_code",),
        columns=(
            Column("location_code", "code", "Unique location code.", db_column="code"),
            *_name_columns(),
            Column("location_type", "enum", "Role in the network.", enum=("central", "hub", "branch")),
            Column("country_code", "country", "Country of the location (drives weekends and holidays).", references="countries.code"),
            Column("city", "text", "City.", nullable=True, max_length=100),
            Column("latitude", "decimal", "Decimal degrees.", nullable=True, scale=6, integer_digits=3, min_value=-90, max_value=90),
            Column("longitude", "decimal", "Decimal degrees.", nullable=True, scale=6, integer_digits=3, min_value=-180, max_value=180),
            Column("timezone", "timezone", "Time zone of the location."),
            Column(
                "parent_location_code",
                "code",
                "Default replenishment source; empty for the central warehouse.",
                nullable=True,
                references="locations.location_code",
                db_column="parent_location_id",
                lookup="locations",
            ),
            _active_column("false for closed locations."),
            _work_calendar_column(),
        ),
        row_rules=(
            Rule(
                "must_differ",
                ("location_code", "parent_location_code"),
                "parent_location_code",
                "A location is not its own parent.",
            ),
        ),
        set_rules=(
            Rule(
                "location_cycle",
                ("location_code", "parent_location_code"),
                "parent_location_code",
                "Parents never form a cycle.",
            ),
        ),
    ),
    Entity(
        name="network_links",
        table="public.network_links",
        file="network_links.csv",
        description="Transfer lanes between locations: lead times in calendar days and the freight cost per unit or per shipment. One lane per ordered pair.",
        natural_key=("from_location_code", "to_location_code"),
        required_in_bundle=False,
        columns=(
            Column(
                "from_location_code",
                "code",
                "Sending location.",
                references="locations.location_code",
                db_column="from_location_id",
                lookup="locations",
            ),
            Column(
                "to_location_code",
                "code",
                "Receiving location.",
                references="locations.location_code",
                db_column="to_location_id",
                lookup="locations",
            ),
            Column("lead_time_days_p50", "integer", "Typical transfer lead time in calendar days.", min_value=0, max_value=3650),
            Column("lead_time_days_p90", "integer", "Slow (90th percentile) lead time in calendar days.", min_value=0, max_value=3650),
            Column(
                "freight_basis",
                "enum",
                "How freight is charged.",
                enum=("none", "per_unit", "per_shipment"),
                default="none",
            ),
            Column("freight_cost", "money", "Freight cost; empty when freight_basis is none.", nullable=True, min_value=0),
            Column(
                "currency",
                "currency",
                "Currency of freight_cost; empty when freight_basis is none.",
                nullable=True,
                references="currencies.code",
            ),
            _active_column("false for lanes no longer used."),
        ),
        column_groups=(("lead_time_days_p50", "lead_time_days_p90"), ("freight_basis", "freight_cost", "currency")),
        row_rules=(
            Rule("must_differ", ("from_location_code", "to_location_code"), "to_location_code", "The two locations differ."),
            Rule(
                "p90_below_p50",
                ("lead_time_days_p50", "lead_time_days_p90"),
                "lead_time_days_p90",
                "`lead_time_days_p90` is at least `lead_time_days_p50`.",
            ),
            Rule(
                "freight_mismatch",
                ("freight_basis", "freight_cost", "currency"),
                "freight_cost",
                "`freight_basis` none has no cost and no currency; any other basis needs both.",
            ),
        ),
    ),
    Entity(
        name="brands",
        table="public.brands",
        file="brands.csv",
        description="Makes and aftermarket brands that items belong to.",
        natural_key=("brand_code",),
        columns=(
            Column("brand_code", "code", "Unique brand code.", db_column="code"),
            *_name_columns(),
            Column("brand_type", "enum", "Genuine (OEM) or aftermarket.", nullable=True, enum=("oem", "aftermarket")),
            Column("country_of_origin", "country", "Country of origin (any ISO code).", nullable=True),
            _active_column("false for brands no longer sold."),
        ),
    ),
    Entity(
        name="items",
        table="public.items",
        file="items.csv",
        description="Service parts.",
        natural_key=("item_code",),
        columns=(
            Column("item_code", "item_code", "Unique part number.", db_column="code"),
            *_name_columns(),
            Column(
                "brand_code",
                "code",
                "Brand or make.",
                nullable=True,
                references="brands.brand_code",
                db_column="brand_id",
                lookup="brands",
            ),
            Column("product_group", "text", "Planning group, e.g. battery, oil_filter.", max_length=64),
            Column("unit_of_measure", "enum", "Stocking unit.", enum=("EA", "SET", "L", "KG")),
            Column("unit_cost", "money", "Standard cost per unit.", min_value=0),
            Column("currency", "currency", "Currency of unit_cost.", references="currencies.code"),
            Column(
                "status",
                "enum",
                "Lifecycle status.",
                enum=("new", "active", "phase_out", "discontinued"),
                default="active",
            ),
            Column("introduced_on", "date", "First day the item was available.", nullable=True),
            Column("discontinued_on", "date", "Last day the item was available.", nullable=True),
        ),
        column_groups=(("unit_cost", "currency"),),
        row_rules=(
            Rule(
                "end_before_start",
                ("introduced_on", "discontinued_on"),
                "discontinued_on",
                "`discontinued_on` is on or after `introduced_on`; a file may map either one, and the other keeps its stored value.",
            ),
        ),
    ),
    Entity(
        name="item_supersessions",
        table="public.item_supersessions",
        file="item_supersessions.csv",
        description="Part replacements: demand for the predecessor moves to the successor from effective_on. One successor per predecessor.",
        natural_key=("predecessor_item_code",),
        columns=(
            Column(
                "predecessor_item_code",
                "item_code",
                "Replaced item.",
                references="items.item_code",
                db_column="predecessor_item_id",
                lookup="items",
            ),
            Column(
                "successor_item_code",
                "item_code",
                "Replacing item.",
                references="items.item_code",
                db_column="successor_item_id",
                lookup="items",
            ),
            Column("effective_on", "date", "First day the successor replaces the predecessor."),
            Column(
                "quantity_factor",
                "decimal",
                "Units of successor per unit of predecessor (1 unless the pack changes).",
                greater_than=0,
                default="1",
            ),
            Column("note", "text", "Free text.", nullable=True, max_length=NOTE_MAX_LENGTH),
        ),
        row_rules=(
            Rule(
                "must_differ",
                ("predecessor_item_code", "successor_item_code"),
                "successor_item_code",
                "An item does not supersede itself.",
            ),
        ),
        set_rules=(
            Rule(
                "supersession_cycle",
                ("predecessor_item_code", "successor_item_code"),
                "successor_item_code",
                "Supersession chains never form a cycle.",
            ),
        ),
    ),
    Entity(
        name="item_interchanges",
        table="public.item_interchanges",
        file="item_interchanges.csv",
        description="Interchangeable parts. one_way: the alternate may be issued when the item is requested, never the reverse; two_way: both directions. One row per unordered pair; a reversed pair replaces the stored orientation when the file maps direction (otherwise the stored orientation and direction are kept).",
        natural_key=("item_code", "alternate_item_code"),
        unordered_pair=True,
        required_in_bundle=False,
        columns=(
            Column(
                "item_code",
                "item_code",
                "Requested item.",
                references="items.item_code",
                db_column="item_id",
                lookup="items",
            ),
            Column(
                "alternate_item_code",
                "item_code",
                "Item that may be issued instead.",
                references="items.item_code",
                db_column="alternate_item_id",
                lookup="items",
            ),
            Column("direction", "enum", "Direction of the interchange.", enum=("one_way", "two_way"), default="two_way"),
            Column("priority", "integer", "Order in which alternates are tried (1 first).", min_value=1, max_value=99, default="1"),
            Column("note", "text", "Free text.", nullable=True, max_length=NOTE_MAX_LENGTH),
        ),
        row_rules=(
            Rule("must_differ", ("item_code", "alternate_item_code"), "alternate_item_code", "The two items differ."),
        ),
    ),
    Entity(
        name="suppliers",
        table="public.suppliers",
        file="suppliers.csv",
        description="Suppliers and their typical lead times.",
        natural_key=("supplier_code",),
        columns=(
            Column("supplier_code", "code", "Unique supplier code.", db_column="code"),
            *_name_columns(),
            Column("country_code", "country", "Country the supplier ships from (any ISO code)."),
            Column("currency", "currency", "Default price currency.", references="currencies.code"),
            Column("lead_time_days_p50", "integer", "Typical lead time in calendar days.", min_value=0),
            Column("lead_time_days_p90", "integer", "Slow lead time (90th percentile) in calendar days.", min_value=0),
            _active_column("false for inactive suppliers."),
            _work_calendar_column(),
        ),
        column_groups=(("lead_time_days_p50", "lead_time_days_p90"),),
        row_rules=(
            Rule(
                "p90_below_p50",
                ("lead_time_days_p50", "lead_time_days_p90"),
                "lead_time_days_p90",
                "`lead_time_days_p90` is at least `lead_time_days_p50`.",
            ),
        ),
    ),
    Entity(
        name="supplier_items",
        table="public.supplier_items",
        file="supplier_items.csv",
        description="What each supplier sells: lead time, minimum order quantity, pack size and price.",
        natural_key=("supplier_code", "item_code"),
        columns=(
            Column("supplier_code", "code", "Supplier.", references="suppliers.supplier_code", db_column="supplier_id", lookup="suppliers"),
            Column("item_code", "item_code", "Item.", references="items.item_code", db_column="item_id", lookup="items"),
            Column("supplier_part_number", "text", "Supplier's own part number.", nullable=True, max_length=100),
            Column("lead_time_days", "integer", "Planning lead time in calendar days.", min_value=0),
            Column("lead_time_days_p90", "integer", "Slow lead time in calendar days.", nullable=True, min_value=0),
            Column("min_order_quantity", "decimal", "Minimum order quantity (0 = none).", min_value=0, default="0"),
            Column("pack_size", "decimal", "Order multiple.", greater_than=0, default="1"),
            Column("unit_price", "money", "Purchase price per unit.", min_value=0),
            Column("currency", "currency", "Currency of unit_price.", references="currencies.code"),
            Column("is_preferred", "boolean", "Preferred source for the item (at most one per item).", default="false"),
            Column("valid_from", "date", "Price valid from.", nullable=True),
            Column("unit_of_measure", "enum", "Source-supplied unit for MOQ, pack multiple and unit price; empty means unknown.", nullable=True, omittable=True, enum=("EA", "SET", "L", "KG")),
        ),
        column_groups=(("unit_price", "currency"),),
        row_rules=(
            Rule(
                "p90_below_p50",
                ("lead_time_days", "lead_time_days_p90"),
                "lead_time_days_p90",
                "`lead_time_days_p90` is empty or at least `lead_time_days`; a file may map either one, and the other keeps its stored value.",
            ),
        ),
        set_rules=(
            Rule(
                "preferred_conflict",
                ("item_code", "is_preferred"),
                "is_preferred",
                "At most one preferred supplier per item in the file; importing a preferred row clears the item's other preferred row.",
            ),
        ),
    ),
    Entity(
        name="fx_rates",
        table="public.fx_rates",
        file="fx_rates.csv",
        description="Exchange rates: 1 from_currency = rate to_currency from valid_from until the next row of the pair. One row per unordered pair and date; a reversed pair replaces the stored orientation when the file maps rate (otherwise the stored orientation and rate are kept).",
        natural_key=("from_currency", "to_currency", "valid_from"),
        unordered_pair=True,
        required_in_bundle=False,
        columns=(
            Column("from_currency", "currency", "Currency converted from.", references="currencies.code"),
            Column("to_currency", "currency", "Currency converted to.", references="currencies.code"),
            Column("valid_from", "date", "First day the rate applies."),
            Column("rate", "decimal", "Units of to_currency per unit of from_currency.", scale=10, integer_digits=10, greater_than=0),
            Column("note", "text", "Free text.", nullable=True, max_length=NOTE_MAX_LENGTH),
        ),
        row_rules=(
            Rule("must_differ", ("from_currency", "to_currency"), "to_currency", "The two currencies differ."),
        ),
    ),
    Entity(
        name="demand_history",
        table="public.demand_history",
        file="demand_history/YYYY-MM.csv",
        description="Daily demand per item and location. Only days with demand or lost sales appear; a missing day means zero.",
        natural_key=("item_code", "location_code", "demand_date"),
        columns=(
            Column("item_code", "item_code", "Item.", references="items.item_code", db_column="item_id", lookup="items"),
            Column("location_code", "code", "Location where the demand arose.", references="locations.location_code", db_column="location_id", lookup="locations"),
            Column("demand_date", "date", "Business day at the location."),
            Column("quantity", "decimal", "Quantity sold or issued.", min_value=0, default="0"),
            Column("lost_sales_quantity", "decimal", "Quantity requested but not served (stock-out).", min_value=0, default="0"),
            Column("unit_of_measure", "enum", "Source unit for sold and lost quantities; absent means unknown.", nullable=True, omittable=True, enum=("EA", "SET", "L", "KG")),
        ),
        monthly_parts=True,
        row_rules=(
            Rule(
                "date_outside_history_window",
                ("demand_date",),
                "demand_date",
                "`demand_date` falls in a month the database keeps demand for and is at most tomorrow.",
            ),
        ),
        stage_rows=DEMAND_STAGE_ROWS,
        merge_rows=DEMAND_MERGE_ROWS,
    ),
)

def _transaction_references() -> tuple[Column, ...]:
    return (
        Column("item_code", "item_code", "Item.", references="items.item_code", db_column="item_id", lookup="items"),
        Column("location_code", "code", "Stock location.", references="locations.location_code", db_column="location_id", lookup="locations"),
    )


ENTITIES += (
    Entity(
        name="stock_snapshots", table="public.stock_snapshots", file="stock_snapshots.csv",
        description="Daily stock observations. Missing observations are unknown, not zero. The dashboard uses the latest observation on or before its reporting day for each item and location. Available stock is quantity minus allocated_quantity; allocations may exceed stock.",
        natural_key=("item_code", "location_code", "snapshot_date"), required_in_bundle=False,
        columns=(
            *_transaction_references(),
            Column("snapshot_date", "date", "Business date of the observation."),
            Column("quantity", "decimal", "Physical units on hand.", min_value=0),
            Column("allocated_quantity", "decimal", "Units already allocated.", min_value=0, default="0"),
            Column("unit_cost", "money", "Inventory cost per physical unit.", min_value=0),
            Column("currency", "currency", "Cost currency.", references="currencies.code"),
            Column("unit_of_measure", "enum", "Source unit for physical/allocated quantity and unit cost; absent means unknown.", nullable=True, omittable=True, enum=("EA", "SET", "L", "KG")),
        ), column_groups=(("unit_cost", "currency"),),
    ),
    Entity(
        name="open_orders", table="public.open_orders", file="open_orders.csv",
        description="Outstanding inbound order lines. Quantity is the remaining open quantity, not the original ordered quantity. Set it to zero or status to closed/canceled to retire a line; receipts do not automatically change orders or stock.",
        natural_key=("order_code", "line_code"), required_in_bundle=False,
        columns=(
            Column("order_code", "code", "External order reference."),
            Column("line_code", "code", "External line reference, unique within the order."),
            *_transaction_references(),
            Column("supplier_code", "code", "Supplier.", references="suppliers.supplier_code", db_column="supplier_id", lookup="suppliers"),
            Column("expected_date", "date", "Expected arrival business date."),
            Column("quantity", "decimal", "Remaining quantity.", min_value=0),
            Column("unit_cost", "money", "Cost per unit.", min_value=0),
            Column("currency", "currency", "Cost currency.", references="currencies.code"),
            Column("status", "enum", "Current line status.", enum=("open", "closed", "canceled"), default="open"),
            Column("unit_of_measure", "enum", "Source unit for remaining quantity and unit cost; absent means unknown.", nullable=True, omittable=True, enum=("EA", "SET", "L", "KG")),
        ), column_groups=(("unit_cost", "currency"),),
    ),
    Entity(
        name="receipts", table="public.receipts", file="receipts.csv",
        description="Inbound receipt lines, keyed by external receipt and line references. Corrections replace a line. Importing a receipt never increments a stock snapshot or decrements an open order; each feed remains authoritative.",
        natural_key=("receipt_code", "line_code"), required_in_bundle=False,
        columns=(
            Column("receipt_code", "code", "External receipt reference."),
            Column("line_code", "code", "External line reference, unique within the receipt."),
            *_transaction_references(),
            Column("supplier_code", "code", "Supplier.", references="suppliers.supplier_code", db_column="supplier_id", lookup="suppliers"),
            Column("receipt_date", "date", "Received business date."),
            Column("quantity", "decimal", "Units received.", greater_than=0),
            Column("unit_cost", "money", "Cost per received unit.", min_value=0),
            Column("currency", "currency", "Cost currency.", references="currencies.code"),
        ), column_groups=(("unit_cost", "currency"),),
    ),
)

ENTITY_NAMES: tuple[str, ...] = tuple(e.name for e in ENTITIES)
ENTITY_BY_NAME: dict[str, Entity] = {e.name: e for e in ENTITIES}

CSV_DIALECT_RULES: tuple[str, ...] = (
    "UTF-8 without a byte-order mark; LF line endings.",
    "RFC 4180 quoting: fields containing commas, quotes or newlines are wrapped in double quotes, inner quotes doubled.",
    "One header row whose names and order equal the column tables below; a file may leave out the optional trailing columns marked as such.",
    "Dates are YYYY-MM-DD. Timestamps (none in v1) would be YYYY-MM-DDTHH:MM:SSZ in UTC.",
    "Numbers use a dot decimal separator, no thousands separators; money and quantities carry at most 12 integer and 3 fractional digits (trailing fractional zeros do not count).",
    "Booleans are the literals true and false.",
    "An empty field means NULL; required columns must not be empty.",
    "Files are loaded in the order listed below so every reference resolves; files of optional entities may be absent.",
    "demand_history is split into monthly parts named YYYY-MM.csv under a demand_history/ folder; a single demand_history.csv with the same header is also accepted.",
    "manifest.json lists every file with its row count and sha256 and records the generator version, seed and window.",
)


def _check_references() -> None:
    for entity in ENTITIES:
        for column in entity.columns:
            if column.lookup:
                target = ENTITY_BY_NAME[column.lookup]
                if target.load_order > entity.load_order:
                    raise ValueError(f"{entity.name}.{column.name} looks up {target.name}, which loads later")
                if column.references != f"{target.name}.{target.natural_key[0]}" or len(target.natural_key) != 1:
                    raise ValueError(f"{entity.name}.{column.name} must reference the single-column key of {target.name}")


_check_references()


def iter_references() -> Iterator[tuple[Entity, Column]]:
    for entity in ENTITIES:
        for column in entity.columns:
            if column.references:
                yield entity, column


# --------------------------------------------------------------------------------------------
# Markdown (docs/import-format.md)
# --------------------------------------------------------------------------------------------


def _default_label(entity: Entity, column: Column) -> str:
    if entity.is_natural_key(column.name):
        return "key"
    if column.default is not None:
        return f"`{column.default}`" if column.default else "empty"
    return "empty" if column.nullable else "—"


def to_markdown() -> str:
    """Renders the per-entity sections for docs/import-format.md."""
    lines: list[str] = []
    for entity in ENTITIES:
        lines.append(f"### `{entity.file}` → `{entity.table}`")
        lines.append("")
        lines.append(entity.description)
        lines.append("")
        key = " + ".join(f"`{k}`" for k in entity.natural_key)
        if entity.name == "holiday_overrides":
            key = "`country_code` or `work_calendar_code` (exactly one per row; both columns are present) + `starts_on`"
        elif entity.unordered_pair:
            first, second, *rest = entity.natural_key
            key = f"the unordered pair `{first}` and `{second}`" + "".join(f" + `{k}`" for k in rest)
        facts = [f"Natural key: {key}."]
        facts.append(f"Load order {entity.load_order}.")
        if not entity.required_in_bundle:
            facts.append("Optional: a bundle may leave this file out.")
        lines.append(" ".join(facts))
        lines.append("")
        if entity.column_groups:
            groups = "; ".join(" + ".join(f"`{c}`" for c in group) for group in entity.column_groups)
            lines.append(f"Provided together: {groups}.")
            lines.append("")
        rules = [*entity.row_rules, *entity.set_rules]
        if rules:
            lines.append("Rules:")
            lines.append("")
            for rule in rules:
                lines.append(f"- `{rule.code}`: {rule.description}")
            lines.append("")
        lines.append("| Column | Type | Required | Default for new rows | Description |")
        lines.append("| --- | --- | --- | --- | --- |")
        for column in entity.columns:
            description = column.description
            if column.references:
                description += f" References `{column.references}`."
            if column.omittable:
                description += " Optional trailing column: a file may leave it out."
            lines.append(
                f"| `{column.name}` | {column.type_label} | {'yes' if column.required else 'no'} | {_default_label(entity, column)} | {description} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# --------------------------------------------------------------------------------------------
# JSON (docs/import-format.schema.json and packages/shared/src/import-format.schema.json)
# --------------------------------------------------------------------------------------------


def _rule_json(rule: Rule) -> dict[str, object]:
    return {"code": rule.code, "columns": list(rule.columns), "column": rule.column, "description": rule.description}


def _column_json(entity: Entity, column: Column) -> dict[str, object]:
    return {
        "name": column.name,
        "kind": column.kind,
        "required": column.required,
        "required_for_new": entity.required_for_new(column),
        "natural_key": entity.is_natural_key(column.name),
        "omittable": column.omittable,
        "description": column.description,
        "pattern": column.pattern,
        "max_length": column.max_length,
        "scale": column.scale,
        "integer_digits": column.integer_digits,
        "min_value": column.min_value,
        "max_value": column.max_value,
        "greater_than": column.greater_than,
        "enum": list(column.enum) if column.enum else None,
        "default": column.default,
        "references": column.references,
        "lookup": column.lookup,
        "target_column": column.target,
    }


def to_json() -> str:
    """Machine-readable contract (the import wizard derives its validators and templates from it)."""
    payload = {
        "format_version": FORMAT_VERSION,
        "dialect": list(CSV_DIALECT_RULES),
        "kinds": {
            kind: {"description": KINDS[kind], "pattern": KIND_PATTERNS[kind], "error_code": KIND_ERROR_CODES[kind]}
            for kind in KINDS
        },
        "error_codes": [{"code": code, "level": level} for code, level in ERROR_CODES],
        "entities": [
            {
                "name": entity.name,
                "table": entity.table,
                "file": entity.file,
                "load_order": entity.load_order,
                "required_in_bundle": entity.required_in_bundle,
                "monthly_parts": entity.monthly_parts,
                "unordered_pair": entity.unordered_pair,
                "description": entity.description,
                "natural_key": list(entity.natural_key),
                "column_groups": [list(group) for group in entity.column_groups],
                "row_rules": [_rule_json(rule) for rule in entity.row_rules],
                "set_rules": [_rule_json(rule) for rule in entity.set_rules],
                "stage_rows": entity.stage_rows,
                "merge_rows": entity.merge_rows,
                "columns": [_column_json(entity, column) for column in entity.columns],
            }
            for entity in ENTITIES
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


# --------------------------------------------------------------------------------------------
# SQL seed (ingest.contract_entities / ingest.contract_columns in the import wizard migration)
# --------------------------------------------------------------------------------------------

SQL_BEGIN_MARK = "-- BEGIN GENERATED import contract"
SQL_END_MARK = "-- END GENERATED import contract"

CONTRACT_ENTITY_COLUMNS: tuple[str, ...] = (
    "entity",
    "load_order",
    "table_name",
    "natural_key",
    "unordered_pair",
    "monthly_parts",
    "required_in_bundle",
    "stage_rows",
    "merge_rows",
    "row_rules",
    "set_rules",
    "column_groups",
)
CONTRACT_COLUMN_COLUMNS: tuple[str, ...] = (
    "entity",
    "position",
    "name",
    "kind",
    "required",
    "natural_key",
    "required_for_new",
    "default_value",
    "pattern",
    "max_length",
    "scale",
    "integer_digits",
    "min_value",
    "max_value",
    "greater_than",
    "enum_values",
    "reference",
    "lookup_entity",
    "db_column",
)


def _sql_text(value: str | None) -> str:
    if value is None:
        return "null"
    return "'" + value.replace("'", "''") + "'"


def _sql_number(value: int | None) -> str:
    return "null" if value is None else str(int(value))


def _sql_bool(value: bool) -> str:
    return "true" if value else "false"


def _sql_text_array(values: tuple[str, ...] | list[str] | None) -> str:
    if values is None:
        return "null"
    return "array[" + ", ".join(_sql_text(v) for v in values) + "]::text[]"


def _sql_values(rows: list[list[str]]) -> str:
    return ",\n".join("  (" + ", ".join(row) + ")" for row in rows)


def to_sql() -> str:
    """The INSERT statements seeding the contract tables (without the markers), one row per entity and per column in contract order."""
    entity_rows = [
        [
            _sql_text(entity.name),
            _sql_number(entity.load_order),
            _sql_text(entity.table),
            _sql_text_array(entity.natural_key),
            _sql_bool(entity.unordered_pair),
            _sql_bool(entity.monthly_parts),
            _sql_bool(entity.required_in_bundle),
            _sql_number(entity.stage_rows),
            _sql_number(entity.merge_rows),
            _sql_text_array([rule.code for rule in entity.row_rules]),
            _sql_text_array([rule.code for rule in entity.set_rules]),
            _sql_text(json.dumps([list(group) for group in entity.column_groups])) + "::jsonb",
        ]
        for entity in ENTITIES
    ]
    column_rows = [
        [
            _sql_text(entity.name),
            _sql_number(position),
            _sql_text(column.name),
            _sql_text(column.kind),
            _sql_bool(column.required),
            _sql_bool(entity.is_natural_key(column.name)),
            _sql_bool(entity.required_for_new(column)),
            _sql_text(column.default),
            _sql_text(column.pattern),
            _sql_number(column.max_length),
            _sql_number(column.scale),
            _sql_number(column.integer_digits),
            _sql_number(column.min_value),
            _sql_number(column.max_value),
            _sql_number(column.greater_than),
            _sql_text_array(column.enum) if column.enum else "null",
            _sql_text(column.references),
            _sql_text(column.lookup),
            _sql_text(column.target),
        ]
        for entity in ENTITIES
        for position, column in enumerate(entity.columns, start=1)
    ]
    return (
        "-- Generated by `uv run maqdar-synth format --sql` from engine/src/maqdar_engine/importformat.py\n"
        f"-- (import format v{FORMAT_VERSION}); do not edit by hand.\n"
        f"insert into ingest.contract_entities ({', '.join(CONTRACT_ENTITY_COLUMNS)}) values\n"
        + _sql_values(entity_rows)
        + ";\n\n"
        f"insert into ingest.contract_columns ({', '.join(CONTRACT_COLUMN_COLUMNS)}) values\n"
        + _sql_values(column_rows)
        + ";\n"
    )


def to_sql_with_marks() -> str:
    return f"{SQL_BEGIN_MARK}\n{to_sql()}{SQL_END_MARK}\n"


def extract_sql_block(migration_sql: str) -> str | None:
    """The text between the marker lines of a migration (without them), or None when it has none."""
    text = migration_sql.replace("\r\n", "\n")
    lines = text.split("\n")
    try:
        start = lines.index(SQL_BEGIN_MARK)
        end = lines.index(SQL_END_MARK, start + 1)
    except ValueError:
        return None
    return "\n".join(lines[start + 1 : end]) + "\n"


def normalise_markdown(text: str) -> str:
    """Collapses whitespace inside table cells so prettier's alignment never matters."""
    rows = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            cells = [" ".join(cell.split()) for cell in stripped.strip("|").split("|")]
            cells = ["---" if cell and set(cell) <= set("-:") else cell for cell in cells]
            rows.append("|" + "|".join(cells) + "|")
        elif stripped:
            rows.append(" ".join(stripped.split()))
    return "\n".join(rows)
