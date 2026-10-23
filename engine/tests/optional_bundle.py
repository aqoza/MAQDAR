"""Test helpers: extend a generated bundle with the optional entities and trailing columns.

The generator writes only the required entities (its output is frozen at 1.1.0), so the validator
and loader tests build the optional files here from the bundle's own codes.
"""

from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path
from typing import Callable, Sequence

from zeespare_engine.synth.writer import count_rows, sha256_of

CALENDAR = "KSA-STD"


def read_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def write_rows(path: Path, header: Sequence[str], rows: Sequence[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow([row.get(column, "") or "" for column in header])


def refresh_manifest(bundle: Path) -> None:
    """Re-counts and re-hashes every CSV of the bundle (keeping the manifest's order, new files appended)."""
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    paths = [entry["path"] for entry in manifest["files"] if (bundle / entry["path"]).exists()]
    for path in sorted(bundle.rglob("*.csv")):
        rel = path.relative_to(bundle).as_posix()
        if not rel.startswith("_truth/") and rel not in paths:
            paths.append(rel)
    manifest["files"] = [
        {"path": rel, "rows": count_rows(bundle / rel), "bytes": (bundle / rel).stat().st_size, "sha256": sha256_of(bundle / rel)}
        for rel in paths
    ]
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def edit_rows(bundle: Path, rel: str, change: Callable[[list[dict[str, str]]], list[dict[str, str]] | None]) -> None:
    """Applies `change` to the rows of one file (in place or by returning new rows) and refreshes the manifest."""
    header, rows = read_rows(bundle / rel)
    result = change(rows)
    write_rows(bundle / rel, header, rows if result is None else result)
    refresh_manifest(bundle)


def copy_bundle(source: Path, target: Path) -> Path:
    shutil.copytree(source, target)
    return target


def add_optional_entities(bundle: Path) -> dict[str, int]:
    """Writes the five optional files and fills work_calendar_code on locations and suppliers.

    Returns the row count per optional entity.
    """
    _, locations = read_rows(bundle / "locations.csv")
    _, items = read_rows(bundle / "items.csv")
    central = next(row for row in locations if row["location_type"] == "central")
    other = next(row for row in locations if row["location_type"] != "central")
    a, b, c = (row["item_code"] for row in items[:3])

    files = {
        "work_calendars.csv": (
            ["work_calendar_code", "name_en", "name_ar", "country_code", "weekend_days", "observe_public_holidays", "is_active"],
            [
                {"work_calendar_code": CALENDAR, "name_en": "Saudi standard week", "name_ar": "أسبوع العمل السعودي", "country_code": "SA", "weekend_days": "5;6", "observe_public_holidays": "true", "is_active": "true"},
                {"work_calendar_code": "UAE-STD", "name_en": "UAE standard week", "country_code": "AE", "weekend_days": "6;7", "observe_public_holidays": "true", "is_active": "true"},
                {"work_calendar_code": "NONSTOP", "name_en": "Seven-day operation", "weekend_days": "", "observe_public_holidays": "false", "is_active": "true"},
            ],
        ),
        "holiday_overrides.csv": (
            ["country_code", "work_calendar_code", "starts_on", "ends_on", "kind", "name_en", "name_ar", "note"],
            [
                {"country_code": "SA", "starts_on": "2026-03-18", "ends_on": "2026-03-22", "kind": "closure", "name_en": "Stocktake"},
                {"country_code": "SA", "starts_on": "2026-04-01", "ends_on": "2026-04-01", "kind": "closure", "name_en": "Audit day"},
                {"work_calendar_code": CALENDAR, "starts_on": "2026-09-23", "ends_on": "2026-09-23", "kind": "working_day", "name_en": "National day cover", "note": "Shift, with overtime"},
            ],
        ),
        "network_links.csv": (
            ["from_location_code", "to_location_code", "lead_time_days_p50", "lead_time_days_p90", "freight_basis", "freight_cost", "currency", "is_active"],
            [
                {"from_location_code": central["location_code"], "to_location_code": other["location_code"], "lead_time_days_p50": "3", "lead_time_days_p90": "6", "freight_basis": "per_unit", "freight_cost": "1.25", "currency": "SAR", "is_active": "true"},
                {"from_location_code": other["location_code"], "to_location_code": central["location_code"], "lead_time_days_p50": "4", "lead_time_days_p90": "8", "freight_basis": "none", "is_active": "true"},
            ],
        ),
        "item_interchanges.csv": (
            ["item_code", "alternate_item_code", "direction", "priority", "note"],
            [
                {"item_code": a, "alternate_item_code": b, "direction": "two_way", "priority": "1"},
                {"item_code": c, "alternate_item_code": a, "direction": "one_way", "priority": "2", "note": "Aftermarket alternate"},
            ],
        ),
        "fx_rates.csv": (
            ["from_currency", "to_currency", "valid_from", "rate", "note"],
            [
                {"from_currency": "USD", "to_currency": "SAR", "valid_from": "2026-01-01", "rate": "3.75", "note": "Peg"},
                {"from_currency": "SAR", "to_currency": "AED", "valid_from": "2026-01-01", "rate": "0.9793"},
                {"from_currency": "USD", "to_currency": "SAR", "valid_from": "2026-07-01", "rate": "3.7512345678"},
            ],
        ),
    }
    for name, (header, rows) in files.items():
        write_rows(bundle / name, header, rows)

    for name in ("locations.csv", "suppliers.csv"):
        header, rows = read_rows(bundle / name)
        for index, row in enumerate(rows):
            row["work_calendar_code"] = CALENDAR if index == 0 else ""
        write_rows(bundle / name, header + ["work_calendar_code"], rows)
    refresh_manifest(bundle)
    return {name.removesuffix(".csv"): len(rows) for name, (_, rows) in files.items()}
