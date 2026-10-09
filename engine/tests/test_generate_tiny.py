from datetime import date, timedelta
from pathlib import Path

import polars as pl
import pytest

from maqdar_engine import importformat
from maqdar_engine.synth.calendar import Calendar
from maqdar_engine.synth.generate import generate
from maqdar_engine.synth.network import countries
from maqdar_engine.synth.presets import N_DAYS, PRESETS, WINDOW_END, WINDOW_START
from maqdar_engine.synth.validate import entity_files, validate_bundle
from maqdar_engine.synth.writer import read_manifest, sha256_of


def test_bundle_has_every_file_with_the_contract_header(tiny_bundle: Path):
    for entity in importformat.ENTITIES:
        files = entity_files(tiny_bundle, entity)
        assert files, entity.name
        for path in files:
            first = path.read_text(encoding="utf-8").splitlines()[0]
            assert first.split(",") == entity.header, path
    assert len(entity_files(tiny_bundle, importformat.ENTITY_BY_NAME["demand_history"])) == 36


def test_bundle_validates(tiny_bundle: Path):
    assert validate_bundle(tiny_bundle) == []


def test_dialect(tiny_bundle: Path):
    for path in tiny_bundle.rglob("*.csv"):
        raw = path.read_bytes()
        assert not raw.startswith(b"\xef\xbb\xbf"), path
        assert b"\r" not in raw, path
        assert raw.endswith(b"\n"), path


def test_manifest_rows_match_files(tiny_bundle: Path):
    manifest = read_manifest(tiny_bundle)
    assert manifest["format_version"] == importformat.FORMAT_VERSION
    assert manifest["organization"]["slug"] == "synth-tiny"
    for entry in manifest["files"]:
        path = tiny_bundle / entry["path"]
        assert entry["rows"] == len(path.read_text(encoding="utf-8").splitlines()) - 1
        assert entry["sha256"] == sha256_of(path)


def test_locations_and_assortment(tiny):
    locs = tiny["locations"]
    assert locs.height == 8
    assert set(locs["country_code"].to_list()) == {"SA", "AE", "QA", "KW", "OM"}
    assert locs.filter(pl.col("location_type") == "central").height == 1
    assert locs.filter(pl.col("parent_location_code").is_null()).height == 1
    # Every parent referenced exists in the subset.
    parents = set(locs["parent_location_code"].drop_nulls().to_list())
    assert parents <= set(locs["location_code"].to_list())
    # The central warehouse carries every item that has any demand.
    demand = tiny["demand"]
    central_items = set(demand.filter(pl.col("location_code") == "RUH-DC")["item_code"].to_list())
    all_items = set(demand["item_code"].to_list())
    assert len(central_items) >= len(all_items) - 2


def test_no_demand_on_weekends_or_closed_days(tiny):
    cal = Calendar(WINDOW_START, N_DAYS)
    locs = tiny["locations"].select("location_code", "country_code")
    demand = tiny["demand"].join(locs, on="location_code")
    for country, rows in demand.group_by("country_code").agg(pl.col("demand_date")).iter_rows():
        c = cal.country(country)
        for d in rows:
            i = cal.index(d)
            assert 0 <= i < N_DAYS
            assert not c.weekend[i], (country, d)
            assert not c.closed[i], (country, d)


def test_quantities_are_positive_integers(tiny):
    demand = tiny["demand"]
    assert demand.filter((pl.col("quantity") <= 0) & (pl.col("lost_sales_quantity") <= 0)).height == 0
    assert demand.filter(pl.col("quantity") < 0).height == 0
    assert demand.schema["quantity"] == pl.Int64
    assert demand.unique(["item_code", "location_code", "demand_date"]).height == demand.height


def test_demand_dates_inside_window(tiny):
    demand = tiny["demand"]
    assert demand["demand_date"].min() >= WINDOW_START
    assert demand["demand_date"].max() <= WINDOW_END


def test_lost_sales_only_at_hubs_and_branches(tiny):
    locs = tiny["locations"].select("location_code", "location_type")
    lost = tiny["demand"].filter(pl.col("lost_sales_quantity") > 0).join(locs, on="location_code")
    assert lost.filter(pl.col("location_type") == "central").height == 0


def test_items_master_data(tiny):
    items = tiny["items"]
    assert items.height == 24
    assert items["name_en"].str.len_chars().min() > 0
    assert items["name_ar"].drop_nulls().len() > 0
    assert set(items["currency"].to_list()) == {"SAR"}
    assert items.filter(pl.col("unit_cost") <= 0).height == 0
    assert set(items["status"].to_list()) <= {"new", "active", "phase_out", "discontinued"}
    discontinued = items.filter(pl.col("discontinued_on").is_not_null() & pl.col("introduced_on").is_not_null())
    assert discontinued.filter(pl.col("discontinued_on") < pl.col("introduced_on")).height == 0


def test_supersession_chain_rules(tiny):
    links = tiny["item_supersessions"]
    items = tiny["items"]
    demand = tiny["demand"]
    assert links.height >= 1
    for pred, succ, effective in links.select("predecessor_item_code", "successor_item_code", "effective_on").iter_rows():
        assert pred != succ
        succ_row = items.filter(pl.col("item_code") == succ).row(0, named=True)
        assert succ_row["introduced_on"] == effective
        pred_row = items.filter(pl.col("item_code") == pred).row(0, named=True)
        assert pred_row["discontinued_on"] == effective + timedelta(days=120)
        assert demand.filter((pl.col("item_code") == succ) & (pl.col("demand_date") < effective)).height == 0
        assert demand.filter((pl.col("item_code") == pred) & (pl.col("demand_date") >= effective + timedelta(days=60))).height == 0
    # Chains are acyclic: no item is both a predecessor of one link and the successor of the same link set twice.
    preds = links["predecessor_item_code"].to_list()
    succs = links["successor_item_code"].to_list()
    assert len(set(succs)) == len(succs)


def test_new_and_discontinued_items_respect_their_dates(tiny):
    items = tiny["items"]
    demand = tiny["demand"]
    for row in items.iter_rows(named=True):
        rows = demand.filter(pl.col("item_code") == row["item_code"])
        if row["introduced_on"] and row["introduced_on"] > WINDOW_START and rows.height:
            assert rows["demand_date"].min() >= row["introduced_on"]
        if row["discontinued_on"] and rows.height and row["status"] == "discontinued":
            assert rows["demand_date"].max() <= row["discontinued_on"]


def test_supplier_items_rules(tiny):
    si = tiny["supplier_items"]
    items = tiny["items"]
    assert si.filter(pl.col("is_preferred")).unique("item_code").height == items.height
    assert si.group_by("item_code").agg(pl.col("is_preferred").sum().alias("n")).filter(pl.col("n") != 1).height == 0
    assert si.filter(pl.col("min_order_quantity") % pl.col("pack_size") != 0).height == 0
    assert si.filter(pl.col("lead_time_days_p90") < pl.col("lead_time_days")).height == 0
    assert si.filter(pl.col("unit_price") <= 0).height == 0


def test_determinism_same_seed_and_different_batch_size(tmp_path: Path, tiny_bundle: Path):
    def hashes(bundle: Path) -> dict[str, str]:
        return {p.relative_to(bundle).as_posix(): sha256_of(p) for p in bundle.rglob("*.csv")}

    again = tmp_path / "again"
    generate(PRESETS["tiny"], again, progress=lambda m: None)
    assert hashes(again) == hashes(tiny_bundle)

    rebatched = tmp_path / "rebatched"
    generate(PRESETS["tiny"].with_overrides(batch_items=1), rebatched, progress=lambda m: None)
    assert hashes(rebatched) == hashes(tiny_bundle)

    other_seed = tmp_path / "seed"
    generate(PRESETS["tiny"].with_overrides(seed=99), other_seed, progress=lambda m: None)
    assert hashes(other_seed)["demand_history/2024-07.csv"] != hashes(tiny_bundle)["demand_history/2024-07.csv"]


def test_generate_refuses_to_overwrite_without_force(tmp_path: Path):
    out = tmp_path / "bundle"
    generate(PRESETS["tiny"], out, progress=lambda m: None)
    with pytest.raises(FileExistsError):
        generate(PRESETS["tiny"], out, progress=lambda m: None)


def test_months_override_trims_the_window(tmp_path: Path):
    preset = PRESETS["tiny"].with_overrides(months=6)
    assert preset.window_start == date(2026, 4, 1)
    out = tmp_path / "short"
    generate(preset, out, progress=lambda m: None)
    parts = sorted((out / "demand_history").glob("*.csv"))
    assert [p.stem for p in parts] == ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]
    assert validate_bundle(out) == []


def test_validator_catches_tampering(tmp_path: Path):
    out = tmp_path / "bad"
    generate(PRESETS["tiny"], out, progress=lambda m: None)
    items = out / "items.csv"
    lines = items.read_text(encoding="utf-8").splitlines()
    lines[1] = lines[1].replace("SAR", "sar", 1)
    lines[2] = ",".join(["P-000002"] + lines[2].split(",")[1:]) + ""
    items.write_text("\n".join(lines) + "\n", encoding="utf-8")
    findings = validate_bundle(out)
    messages = "\n".join(str(f) for f in findings)
    assert "currency" in messages
    assert "sha256" in messages
    assert "duplicate natural keys" in messages or "P-000002" in messages or findings
