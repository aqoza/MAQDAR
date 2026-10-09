"""Orchestrates a full bundle: master data, demand, truth files and the manifest."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

import numpy as np

from .. import importformat
from .calendar import Calendar
from .catalog import Catalog, build_catalog
from .demand import FamilyDemand, simulate_family
from .network import Location, select_locations
from .presets import Preset
from .suppliers import build_supplier_items, build_suppliers
from .writer import DemandPartWriter, Manifest, build_manifest, format_bool, format_decimal, write_manifest, write_table

Progress = Callable[[str], None]


def _parent_code(location: Location, codes: set[str], central: str) -> str | None:
    if location.parent_code is None:
        return None
    return location.parent_code if location.parent_code in codes else central


def generate(preset: Preset, out_dir: Path, force: bool = False, progress: Progress = print) -> Manifest:
    if (out_dir / "manifest.json").exists() and not force:
        raise FileExistsError(f"{out_dir} already holds a bundle; pass --force to overwrite")
    if out_dir.exists() and force:
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    locations = list(select_locations(preset.location_codes))
    location_codes = {loc.code for loc in locations}
    central = next(loc.code for loc in locations if loc.location_type == "central")
    calendar = Calendar(preset.window_start, preset.n_days)
    calendar.check_coverage({loc.country_code for loc in locations})

    progress(f"[{preset.name}] catalog: {preset.items:,} items, {len(locations)} locations, window {preset.window_start}..{preset.window_end}")
    catalog = build_catalog(preset, np.random.default_rng([preset.seed, 0]))
    suppliers = build_suppliers(preset, np.random.default_rng([preset.seed, 1]))
    supplier_items = build_supplier_items(catalog.items, suppliers, np.random.default_rng([preset.seed, 2]))

    files: list[Path] = []
    files.append(_write_locations(out_dir, locations, location_codes, central))
    files.append(_write_items(out_dir, catalog))
    files.append(_write_supersessions(out_dir, catalog))
    files.append(_write_suppliers(out_dir, suppliers))
    files.append(_write_supplier_items(out_dir, supplier_items))

    progress(f"[{preset.name}] demand: {len(catalog.families):,} families")
    files.extend(_write_demand(preset, out_dir, catalog, locations, calendar, progress))

    truth_files = _write_truth(out_dir, catalog)
    manifest = build_manifest(preset, out_dir, files)
    manifest_path = write_manifest(out_dir, manifest)
    progress(f"[{preset.name}] wrote {manifest_path} ({sum(f.rows for f in manifest.files):,} rows in {len(files)} files, truth in {len(truth_files)} files)")
    return manifest


def _write_locations(out_dir: Path, locations: list[Location], codes: set[str], central: str) -> Path:
    path = out_dir / importformat.ENTITY_BY_NAME["locations"].file
    header = importformat.ENTITY_BY_NAME["locations"].header
    rows = (
        (
            loc.code,
            loc.name_en,
            loc.name_ar or None,
            loc.location_type,
            loc.country_code,
            loc.city,
            loc.latitude,
            loc.longitude,
            loc.timezone,
            _parent_code(loc, codes, central),
            format_bool(True),
        )
        for loc in locations
    )
    write_table(path, header, rows)
    return path


def _write_items(out_dir: Path, catalog: Catalog) -> Path:
    entity = importformat.ENTITY_BY_NAME["items"]
    path = out_dir / entity.file
    rows = (
        (
            item.code,
            item.name_en,
            item.name_ar,
            item.brand.name_en,
            item.group.code,
            item.group.unit_of_measure,
            format_decimal(item.unit_cost),
            item.currency,
            item.status,
            item.introduced_on.isoformat() if item.introduced_on else None,
            item.discontinued_on.isoformat() if item.discontinued_on else None,
        )
        for item in catalog.items
    )
    write_table(path, entity.header, rows)
    return path


def _write_supersessions(out_dir: Path, catalog: Catalog) -> Path:
    entity = importformat.ENTITY_BY_NAME["item_supersessions"]
    path = out_dir / entity.file
    links = sorted(catalog.supersessions, key=lambda s: (s.predecessor.index, s.successor.index))
    rows = (
        (
            link.predecessor.code,
            link.successor.code,
            link.effective_on.isoformat(),
            format_decimal(link.quantity_factor),
            f"{link.chain_id} link {link.successor.chain_position}",
        )
        for link in links
    )
    write_table(path, entity.header, rows)
    return path


def _write_suppliers(out_dir: Path, suppliers) -> Path:
    entity = importformat.ENTITY_BY_NAME["suppliers"]
    path = out_dir / entity.file
    rows = (
        (
            s.code,
            s.name_en,
            s.name_ar,
            s.country_code,
            s.currency,
            s.lead_time_days_p50,
            s.lead_time_days_p90,
            format_bool(True),
        )
        for s in suppliers
    )
    write_table(path, entity.header, rows)
    return path


def _write_supplier_items(out_dir: Path, supplier_items) -> Path:
    entity = importformat.ENTITY_BY_NAME["supplier_items"]
    path = out_dir / entity.file
    ordered = sorted(supplier_items, key=lambda si: (si.supplier.index, si.item.index))
    rows = (
        (
            si.supplier.code,
            si.item.code,
            si.supplier_part_number,
            si.lead_time_days,
            si.lead_time_days_p90,
            format_decimal(si.min_order_quantity),
            format_decimal(si.pack_size),
            format_decimal(si.unit_price),
            si.currency,
            format_bool(si.is_preferred),
            None,
        )
        for si in ordered
    )
    write_table(path, entity.header, rows)
    return path


def _write_demand(
    preset: Preset,
    out_dir: Path,
    catalog: Catalog,
    locations: list[Location],
    calendar: Calendar,
    progress: Progress,
) -> list[Path]:
    writer = DemandPartWriter(
        out_dir,
        preset.window_start,
        [item.code for item in catalog.items],
        [loc.code for loc in locations],
    )
    truth_rows: list[tuple] = []
    families = sorted(catalog.families, key=lambda f: min(it.index for it in f.items))
    batch: list[FamilyDemand] = []
    batch_items = 0
    total_rows = 0
    done = 0

    def flush() -> None:
        nonlocal total_rows
        if not batch:
            return
        item_index = np.concatenate([b.item_index for b in batch])
        location_index = np.concatenate([b.location_index for b in batch])
        day_index = np.concatenate([b.day_index for b in batch])
        quantity = np.concatenate([b.quantity for b in batch])
        lost = np.concatenate([b.lost for b in batch])
        # Families are already sorted internally and processed in a fixed order, so no global sort.
        writer.append(item_index, location_index, day_index, quantity, lost)
        total_rows += item_index.size
        batch.clear()

    for family in families:
        result = simulate_family(family, locations, calendar, preset)
        batch.append(result)
        batch_items += len(family.items)
        for t in result.truth:
            truth_rows.append(
                (
                    t.item.code,
                    t.location.code,
                    t.item.archetype,
                    f"{t.p_effective:.4f}",
                    f"{t.size_mean:.3f}",
                    f"{t.size_cv2:.3f}",
                    t.stockout_episodes,
                )
            )
        done += 1
        if batch_items >= preset.batch_items:
            flush()
            batch_items = 0
            progress(f"[{preset.name}] demand: {done:,}/{len(families):,} families, {total_rows:,} rows")
    flush()
    parts = writer.close()
    progress(f"[{preset.name}] demand: {total_rows:,} rows in {len(parts)} monthly parts")

    truth_dir = out_dir / "_truth"
    write_table(
        truth_dir / "pairs.csv",
        ["item_code", "location_code", "archetype", "p_effective", "size_mean", "size_cv2", "stockout_episodes"],
        truth_rows,
    )
    return parts


def _write_truth(out_dir: Path, catalog: Catalog) -> list[Path]:
    truth_dir = out_dir / "_truth"
    items_path = truth_dir / "items.csv"
    write_table(
        items_path,
        [
            "item_code",
            "archetype",
            "p_base",
            "size_mean",
            "size_cv2",
            "velocity",
            "heat_coefficient",
            "dust_coefficient",
            "ramadan_profile",
            "lifecycle",
            "chain_id",
            "chain_position",
            "family",
        ],
        (
            (
                item.code,
                item.archetype,
                f"{item.p_base:.4f}",
                f"{item.size_mean:.3f}",
                f"{item.size_cv2:.3f}",
                f"{item.velocity:.4f}",
                item.group.heat_coefficient,
                item.group.dust_coefficient,
                item.group.ramadan_profile,
                item.status,
                item.chain_id,
                item.chain_position,
                item.family,
            )
            for item in catalog.items
        ),
    )
    return [items_path, truth_dir / "pairs.csv"]
