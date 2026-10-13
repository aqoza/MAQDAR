"""The bundle validator follows the contract metadata: optional entities and trailing columns, lengths,
digits, bounds, row rules and set rules."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import pytest

from maqdar_engine.synth.validate import validate_bundle

from optional_bundle import add_optional_entities, copy_bundle, edit_rows, read_rows, refresh_manifest, write_rows


@pytest.fixture(scope="session")
def optional_bundle(tiny_bundle: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    bundle = copy_bundle(tiny_bundle, tmp_path_factory.mktemp("optional") / "bundle")
    # One demand part is enough here and keeps each of the many validations fast.
    for part in sorted((bundle / "demand_history").glob("*.csv"))[:-1]:
        part.unlink()
    add_optional_entities(bundle)
    return bundle


@pytest.fixture
def bundle(optional_bundle: Path, tmp_path: Path) -> Path:
    return copy_bundle(optional_bundle, tmp_path / "bundle")


def messages(bundle: Path) -> str:
    return "\n".join(str(f) for f in validate_bundle(bundle))


def rule_rows(bundle: Path, file: str, code: str) -> int | None:
    """Rows a rule finding reports for one file, or None when the rule found nothing."""
    for finding in validate_bundle(bundle):
        if finding.file == file and finding.message.startswith(f"rule {code}:"):
            return finding.rows
    return None


def test_bundle_with_every_optional_entity_validates(optional_bundle: Path):
    assert validate_bundle(optional_bundle) == []


def test_optional_files_may_be_absent_but_required_ones_may_not(bundle: Path):
    for name in ("work_calendars", "holiday_overrides", "network_links", "item_interchanges", "fx_rates"):
        if name != "work_calendars":
            (bundle / f"{name}.csv").unlink()
    refresh_manifest(bundle)
    assert validate_bundle(bundle) == []
    (bundle / "brands.csv").unlink()
    refresh_manifest(bundle)
    assert "brands.csv: file missing" in messages(bundle)


def test_trailing_column_may_be_omitted_but_not_misplaced(bundle: Path):
    header, rows = read_rows(bundle / "locations.csv")
    write_rows(bundle / "locations.csv", [c for c in header if c != "work_calendar_code"], rows)
    refresh_manifest(bundle)
    assert validate_bundle(bundle) == []
    reordered = [header[-1]] + header[:-1]
    write_rows(bundle / "locations.csv", reordered, rows)
    refresh_manifest(bundle)
    assert "locations.csv: header" in messages(bundle)


def test_unknown_work_calendar_is_reported(bundle: Path):
    def change(rows):
        rows[0]["work_calendar_code"] = "NO-SUCH-CAL"

    edit_rows(bundle, "suppliers.csv", change)
    assert "suppliers.csv:work_calendar_code: values not found in work_calendars.work_calendar_code (1 rows)" in messages(bundle)


def test_slash_is_allowed_in_part_numbers_only(bundle: Path):
    _, items = read_rows(bundle / "items.csv")
    old = items[-1]["item_code"]
    new = old.replace("-", "/")
    for path in bundle.rglob("*.csv"):
        if not path.relative_to(bundle).as_posix().startswith("_truth/"):
            path.write_text(path.read_text(encoding="utf-8").replace(old, new), encoding="utf-8", newline="\n")
    refresh_manifest(bundle)
    assert validate_bundle(bundle) == []

    def change(rows):
        rows[0]["supplier_code"] = rows[0]["supplier_code"].replace("-", "/")

    edit_rows(bundle, "suppliers.csv", change)
    assert "suppliers.csv:supplier_code: values do not match type code" in messages(bundle)


def test_trailing_fractional_zeros_do_not_count(bundle: Path):
    def change(rows):
        rows[0]["unit_cost"] = rows[0]["unit_cost"].split(".")[0] + ".5000000"

    edit_rows(bundle, "items.csv", change)
    assert validate_bundle(bundle) == []


def _set(rel_column: str, value: str, row: int = 0) -> tuple[str, Callable]:
    rel, column = rel_column.split(":")

    def change(rows):
        rows[row][column] = value

    return rel, change


def _append(rel: str, **values: str) -> tuple[str, Callable]:
    def change(rows):
        rows.append(dict(values))

    return rel, change


CASES = {
    "slash in a location code": (_set("locations.csv:location_code", "RUH/DC"), "locations.csv:location_code: values do not match type code"),
    "repeated weekend day": (_set("work_calendars.csv:weekend_days", "5;5"), "work_calendars.csv:weekend_days: values do not match type"),
    "weekday out of range": (_set("work_calendars.csv:weekend_days", "0;6"), "work_calendars.csv:weekend_days: values do not match type"),
    "unknown time zone": (_set("locations.csv:timezone", "Mars/Olympus"), "locations.csv:timezone: values do not match type"),
    "product group too long": (_set("items.csv:product_group", "x" * 65), "items.csv:product_group: values longer than 64 characters"),
    "code too long": (_set("brands.csv:brand_code", "B" * 65), "brands.csv:brand_code: values longer than 64 characters"),
    "thirteen integer digits": (_set("items.csv:unit_cost", "1234567890123"), "items.csv:unit_cost: more than 12 integer digits"),
    "four decimals": (_set("items.csv:unit_cost", "1.2345"), "items.csv:unit_cost: more than 3 fractional digits"),
    "negative money": (_set("items.csv:unit_cost", "-1"), "items.csv:unit_cost: values outside ≥ 0"),
    "zero quantity factor": (_set("item_supersessions.csv:quantity_factor", "0"), "item_supersessions.csv:quantity_factor: values outside > 0"),
    "zero pack size": (_set("supplier_items.csv:pack_size", "0"), "supplier_items.csv:pack_size: values outside > 0"),
    "eleven rate decimals": (_set("fx_rates.csv:rate", "1.12345678901"), "fx_rates.csv:rate: more than 10 fractional digits"),
    "latitude out of range": (_set("locations.csv:latitude", "91.5"), "locations.csv:latitude: values outside -90 to 90"),
    "priority out of range": (_set("item_interchanges.csv:priority", "100"), "item_interchanges.csv:priority: values outside 1 to 99"),
    "lead time over ten years": (_set("network_links.csv:lead_time_days_p90", "3651"), "network_links.csv:lead_time_days_p90: values outside 0 to 3650"),
    "ten-digit integer": (_set("suppliers.csv:lead_time_days_p90", "1000000000"), "suppliers.csv:lead_time_days_p90: more than 9 integer digits"),
    "Arabic-Indic digits": (_set("suppliers.csv:lead_time_days_p50", "٥"), "suppliers.csv:lead_time_days_p50: values do not match type"),
    "both holiday scopes": (_set("holiday_overrides.csv:work_calendar_code", "KSA-STD"), "holiday_overrides.csv:country_code: rule scope_exactly_one"),
    "no holiday scope": (_set("holiday_overrides.csv:country_code", ""), "holiday_overrides.csv:country_code: rule scope_exactly_one"),
    "holiday ends before it starts": (_set("holiday_overrides.csv:ends_on", "2026-03-01"), "holiday_overrides.csv:ends_on: rule end_before_start"),
    "holiday longer than 366 days": (_set("holiday_overrides.csv:ends_on", "2027-03-19"), "holiday_overrides.csv:ends_on: rule holiday_too_long"),
    "overlapping holidays": (
        _append("holiday_overrides.csv", country_code="SA", starts_on="2026-03-20", ends_on="2026-03-25", kind="closure", name_en="Overlap"),
        "holiday_overrides.csv:starts_on: rule holiday_overlap",
    ),
    "duplicate holiday key": (
        _append("holiday_overrides.csv", country_code="SA", starts_on="2026-03-18", ends_on="2026-03-18", kind="closure", name_en="Again"),
        "holiday_overrides.csv: duplicate natural keys",
    ),
    "calendar holidays without a country": (_set("work_calendars.csv:country_code", ""), "work_calendars.csv:country_code: rule country_required"),
    "lane to itself": (_set("network_links.csv:to_location_code", "RUH-DC"), "network_links.csv:to_location_code: rule must_differ"),
    "lane p90 below p50": (_set("network_links.csv:lead_time_days_p90", "2"), "network_links.csv:lead_time_days_p90: rule p90_below_p50"),
    "freight cost without basis": (_set("network_links.csv:freight_cost", "2", row=1), "network_links.csv:freight_cost: rule freight_mismatch"),
    "freight basis without currency": (_set("network_links.csv:currency", ""), "network_links.csv:freight_cost: rule freight_mismatch"),
    "reversed interchange pair": (
        _append("item_interchanges.csv", item_code="P-000002", alternate_item_code="P-000001", direction="two_way", priority="3"),
        "item_interchanges.csv: duplicate natural keys",
    ),
    "interchange with itself": (_set("item_interchanges.csv:alternate_item_code", "P-000001"), "item_interchanges.csv:alternate_item_code: rule must_differ"),
    "reversed fx pair on one date": (
        _append("fx_rates.csv", from_currency="SAR", to_currency="USD", valid_from="2026-01-01", rate="0.2666666667"),
        "fx_rates.csv: duplicate natural keys",
    ),
    "fx pair of one currency": (_set("fx_rates.csv:to_currency", "USD"), "fx_rates.csv:to_currency: rule must_differ"),
    "supplier p90 below p50": (_set("suppliers.csv:lead_time_days_p90", "0"), "suppliers.csv:lead_time_days_p90: rule p90_below_p50"),
    "location is its own parent": (_set("locations.csv:parent_location_code", "RUH-DC"), "locations.csv:parent_location_code: rule must_differ"),
    "location parent cycle": (_set("locations.csv:parent_location_code", "DXB-HUB"), "locations.csv:parent_location_code: rule location_cycle"),
    "discontinued before introduced": (
        ("items.csv", lambda rows: rows[0].update(introduced_on="2020-01-02", discontinued_on="2020-01-01")),
        "items.csv:discontinued_on: rule end_before_start",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_validator_reports(bundle: Path, name: str):
    (rel, change), expected = CASES[name]
    edit_rows(bundle, rel, change)
    found = messages(bundle)
    assert expected in found, found


def test_second_successor_is_a_duplicate_key(bundle: Path):
    _, links = read_rows(bundle / "item_supersessions.csv")
    _, items = read_rows(bundle / "items.csv")
    used = {links[0]["predecessor_item_code"], links[0]["successor_item_code"]}
    other = next(row["item_code"] for row in items if row["item_code"] not in used)
    edit_rows(bundle, "item_supersessions.csv", lambda rows: rows + [{**rows[0], "successor_item_code": other}])
    assert "item_supersessions.csv: duplicate natural keys (predecessor_item_code) (1 rows)" in messages(bundle)


def test_supersession_cycle(bundle: Path):
    _, links = read_rows(bundle / "item_supersessions.csv")
    predecessors = {row["predecessor_item_code"] for row in links}
    last = next(row for row in links if row["successor_item_code"] not in predecessors)
    back = {**last, "predecessor_item_code": last["successor_item_code"], "successor_item_code": last["predecessor_item_code"]}
    edit_rows(bundle, "item_supersessions.csv", lambda rows: rows + [back])
    assert rule_rows(bundle, "item_supersessions.csv", "supersession_cycle") == 2


def test_second_preferred_supplier(bundle: Path):
    _, rows = read_rows(bundle / "supplier_items.csv")
    second = next(i for i, row in enumerate(rows) if row["is_preferred"] == "false")

    def change(rows):
        rows[second]["is_preferred"] = "true"

    edit_rows(bundle, "supplier_items.csv", change)
    assert rule_rows(bundle, "supplier_items.csv", "preferred_conflict") == 1
