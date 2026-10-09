"""MAQDAR import format v1.

The single source of truth for the CSV bundle that the synthetic generator writes, the validator
checks, the loader maps onto the application tables and ``docs/import-format.md`` documents.
Natural keys are codes; the import is scoped to the organization performing it, so no file
carries an organization id.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

FORMAT_VERSION = 1

# Column kinds and how they render in CSV / map to Postgres.
KINDS: dict[str, str] = {
    "code": "text (natural key, 1-64 chars, letters, digits, . _ - /)",
    "text": "text",
    "integer": "integer",
    "decimal": "numeric(18,3), at most 3 fractional digits",
    "money": "numeric(18,3) in the row's currency, at most 3 fractional digits",
    "currency": "char(3) ISO 4217 code",
    "country": "char(2) ISO 3166-1 alpha-2 code",
    "date": "date, YYYY-MM-DD",
    "boolean": "true or false",
    "enum": "one of the listed values",
}


@dataclass(frozen=True)
class Column:
    name: str
    kind: str
    description: str = ""
    nullable: bool = False
    enum: tuple[str, ...] = ()
    scale: int = 3
    references: str | None = None
    """``entity.column`` this value must exist in (foreign key by natural key)."""
    db_column: str | None = None
    """Target column in the application table when it differs from the CSV name."""
    lookup: str | None = None
    """Entity whose row id replaces this code in the application table."""

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown column kind {self.kind!r} for {self.name}")
        if self.kind == "enum" and not self.enum:
            raise ValueError(f"enum column {self.name} needs values")
        if self.lookup and not self.db_column:
            raise ValueError(f"lookup column {self.name} needs db_column")

    @property
    def target(self) -> str:
        return self.db_column or self.name

    @property
    def type_label(self) -> str:
        if self.kind == "enum":
            return "one of " + ", ".join(f"`{value}`" for value in self.enum)
        if self.kind == "decimal" and self.scale != 3:
            return f"numeric, at most {self.scale} fractional digits"
        return KINDS[self.kind]


@dataclass(frozen=True)
class Entity:
    name: str
    table: str
    file: str
    description: str
    natural_key: tuple[str, ...]
    columns: tuple[Column, ...]
    monthly_parts: bool = False

    def __post_init__(self) -> None:
        names = [c.name for c in self.columns]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate column names in {self.name}")
        for key in self.natural_key:
            if key not in names:
                raise ValueError(f"natural key {key} is not a column of {self.name}")
        money = {c.name for c in self.columns if c.kind == "money"}
        if money and not any(c.kind == "currency" for c in self.columns):
            raise ValueError(f"{self.name} has money columns {money} but no currency column")

    @property
    def header(self) -> list[str]:
        return [c.name for c in self.columns]

    def column(self, name: str) -> Column:
        for c in self.columns:
            if c.name == name:
                return c
        raise KeyError(name)


ENTITIES: tuple[Entity, ...] = (
    Entity(
        name="locations",
        table="public.locations",
        file="locations.csv",
        description="Warehouses, regional hubs and branches of the network.",
        natural_key=("location_code",),
        columns=(
            Column("location_code", "code", "Unique location code.", db_column="code"),
            Column("name_en", "text", "English name (required)."),
            Column("name_ar", "text", "Arabic name.", nullable=True),
            Column("location_type", "enum", "Role in the network.", enum=("central", "hub", "branch")),
            Column("country_code", "country", "Country of the location (drives weekends and holidays).", references="countries.code"),
            Column("city", "text", "City.", nullable=True),
            Column("latitude", "decimal", "Decimal degrees.", nullable=True, scale=6),
            Column("longitude", "decimal", "Decimal degrees.", nullable=True, scale=6),
            Column("timezone", "text", "IANA time zone, e.g. Asia/Riyadh."),
            Column(
                "parent_location_code",
                "code",
                "Default replenishment source; empty for the central warehouse.",
                nullable=True,
                references="locations.location_code",
                db_column="parent_location_id",
                lookup="locations",
            ),
            Column("is_active", "boolean", "false for closed locations."),
        ),
    ),
    Entity(
        name="items",
        table="public.items",
        file="items.csv",
        description="Service parts.",
        natural_key=("item_code",),
        columns=(
            Column("item_code", "code", "Unique part number.", db_column="code"),
            Column("name_en", "text", "English name (required)."),
            Column("name_ar", "text", "Arabic name.", nullable=True),
            Column("brand", "text", "Brand or make.", nullable=True),
            Column("product_group", "text", "Planning group, e.g. battery, oil_filter."),
            Column("unit_of_measure", "enum", "Stocking unit.", enum=("EA", "SET", "L", "KG")),
            Column("unit_cost", "money", "Standard cost per unit."),
            Column("currency", "currency", "Currency of unit_cost.", references="currencies.code"),
            Column("status", "enum", "Lifecycle status.", enum=("new", "active", "phase_out", "discontinued")),
            Column("introduced_on", "date", "First day the item was available.", nullable=True),
            Column("discontinued_on", "date", "Last day the item was available.", nullable=True),
        ),
    ),
    Entity(
        name="item_supersessions",
        table="public.item_supersessions",
        file="item_supersessions.csv",
        description="Part replacements: demand for the predecessor moves to the successor from effective_on.",
        natural_key=("predecessor_item_code", "successor_item_code"),
        columns=(
            Column(
                "predecessor_item_code",
                "code",
                "Replaced item.",
                references="items.item_code",
                db_column="predecessor_item_id",
                lookup="items",
            ),
            Column(
                "successor_item_code",
                "code",
                "Replacing item.",
                references="items.item_code",
                db_column="successor_item_id",
                lookup="items",
            ),
            Column("effective_on", "date", "First day the successor replaces the predecessor."),
            Column("quantity_factor", "decimal", "Units of successor per unit of predecessor (1 unless the pack changes)."),
            Column("note", "text", "Free text.", nullable=True),
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
            Column("name_en", "text", "English name (required)."),
            Column("name_ar", "text", "Arabic name.", nullable=True),
            Column("country_code", "country", "Country the supplier ships from (any ISO code)."),
            Column("currency", "currency", "Default price currency.", references="currencies.code"),
            Column("lead_time_days_p50", "integer", "Typical lead time in calendar days."),
            Column("lead_time_days_p90", "integer", "Slow lead time (90th percentile) in calendar days."),
            Column("is_active", "boolean", "false for inactive suppliers."),
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
            Column("item_code", "code", "Item.", references="items.item_code", db_column="item_id", lookup="items"),
            Column("supplier_part_number", "text", "Supplier's own part number.", nullable=True),
            Column("lead_time_days", "integer", "Planning lead time in calendar days."),
            Column("lead_time_days_p90", "integer", "Slow lead time in calendar days.", nullable=True),
            Column("min_order_quantity", "decimal", "Minimum order quantity (0 = none)."),
            Column("pack_size", "decimal", "Order multiple."),
            Column("unit_price", "money", "Purchase price per unit."),
            Column("currency", "currency", "Currency of unit_price.", references="currencies.code"),
            Column("is_preferred", "boolean", "Preferred source for the item (exactly one per item)."),
            Column("valid_from", "date", "Price valid from.", nullable=True),
        ),
    ),
    Entity(
        name="demand_history",
        table="public.demand_history",
        file="demand_history/YYYY-MM.csv",
        description="Daily demand per item and location. Only days with demand or lost sales appear; a missing day means zero.",
        natural_key=("item_code", "location_code", "demand_date"),
        columns=(
            Column("item_code", "code", "Item.", references="items.item_code", db_column="item_id", lookup="items"),
            Column("location_code", "code", "Location where the demand arose.", references="locations.location_code", db_column="location_id", lookup="locations"),
            Column("demand_date", "date", "Business day at the location."),
            Column("quantity", "decimal", "Quantity sold or issued."),
            Column("lost_sales_quantity", "decimal", "Quantity requested but not served (stock-out)."),
        ),
        monthly_parts=True,
    ),
)

ENTITY_BY_NAME: dict[str, Entity] = {e.name: e for e in ENTITIES}

CSV_DIALECT_RULES: tuple[str, ...] = (
    "UTF-8 without a byte-order mark; LF line endings.",
    "RFC 4180 quoting: fields containing commas, quotes or newlines are wrapped in double quotes, inner quotes doubled.",
    "One header row whose names and order equal the column tables below (the loader validates with COPY ... HEADER MATCH).",
    "Dates are YYYY-MM-DD. Timestamps (none in v1) would be YYYY-MM-DDTHH:MM:SSZ in UTC.",
    "Numbers use a dot decimal separator, no thousands separators; money and quantities carry at most 3 fractional digits.",
    "Booleans are the literals true and false.",
    "An empty field means NULL; required columns must not be empty.",
    "Files are loaded in the order listed below so every reference resolves.",
    "demand_history is split into monthly parts named YYYY-MM.csv under a demand_history/ folder; a single demand_history.csv with the same header is also accepted.",
    "manifest.json lists every file with its row count and sha256 and records the generator version, seed and window.",
)


def iter_references() -> Iterator[tuple[Entity, Column]]:
    for entity in ENTITIES:
        for column in entity.columns:
            if column.references:
                yield entity, column


def to_markdown() -> str:
    """Renders the per-entity column tables for docs/import-format.md."""
    lines: list[str] = []
    for entity in ENTITIES:
        lines.append(f"### `{entity.file}` → `{entity.table}`")
        lines.append("")
        lines.append(entity.description)
        lines.append("")
        lines.append(f"Natural key: {', '.join(f'`{k}`' for k in entity.natural_key)}.")
        lines.append("")
        lines.append("| Column | Type | Required | Description |")
        lines.append("| --- | --- | --- | --- |")
        for column in entity.columns:
            description = column.description
            if column.references:
                description += f" References `{column.references}`."
            lines.append(
                f"| `{column.name}` | {column.type_label} | {'no' if column.nullable else 'yes'} | {description} |"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def to_json() -> str:
    """Machine-readable contract (for the Step 5 import wizard to derive its validators)."""
    import json

    payload = {
        "format_version": FORMAT_VERSION,
        "dialect": list(CSV_DIALECT_RULES),
        "kinds": KINDS,
        "entities": [
            {
                "name": entity.name,
                "table": entity.table,
                "file": entity.file,
                "monthly_parts": entity.monthly_parts,
                "description": entity.description,
                "natural_key": list(entity.natural_key),
                "columns": [
                    {
                        "name": column.name,
                        "kind": column.kind,
                        "required": not column.nullable,
                        "description": column.description,
                        **({"enum": list(column.enum)} if column.enum else {}),
                        **({"scale": column.scale} if column.kind in ("decimal", "money") else {}),
                        **({"references": column.references} if column.references else {}),
                        "target_column": column.target,
                        **({"lookup": column.lookup} if column.lookup else {}),
                    }
                    for column in entity.columns
                ],
            }
            for entity in ENTITIES
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


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
