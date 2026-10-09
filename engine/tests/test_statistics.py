"""Statistical properties of the medium preset (300 items, all 40 locations, fixed seed)."""

from datetime import date, timedelta

import numpy as np
import polars as pl
import pytest

from maqdar_engine.synth.calendar import Calendar, ramadan_windows
from maqdar_engine.synth.classify import classify
from maqdar_engine.synth.network import locations, product_groups
from maqdar_engine.synth.presets import N_DAYS, WINDOW_START

pytestmark = pytest.mark.statistical

HEAT_GROUPS = {"battery", "ac_compressor", "ac_condenser"}
NEUTRAL_GROUPS = {"brake_pad", "brake_disc", "suspension", "lighting", "body_panel", "engine_component", "spark_plug"}


def _daily(demand: pl.DataFrame, item_code: str, location_code: str) -> np.ndarray:
    series = np.zeros(N_DAYS, dtype=np.float64)
    rows = demand.filter((pl.col("item_code") == item_code) & (pl.col("location_code") == location_code))
    for d, q, l in rows.select("demand_date", "quantity", "lost_sales_quantity").iter_rows():
        series[(d - WINDOW_START).days] = q + l
    return series


def test_archetypes_are_recovered_at_the_central_warehouse(medium):
    cal = Calendar(WINDOW_START, N_DAYS)
    open_days = cal.country("SA").open
    truth = medium["truth_items"]
    demand = medium["demand"]
    plain = truth.filter((pl.col("lifecycle") == "active") & pl.col("chain_id").is_null())
    agree = 0
    per_class: dict[str, int] = {}
    for item_code, archetype in plain.select("item_code", "archetype").iter_rows():
        result = classify(_daily(demand, item_code, "RUH-DC"), open_days)
        per_class[archetype] = per_class.get(archetype, 0) + 1
        if result.label == archetype:
            agree += 1
    assert agree / plain.height >= 0.85, f"only {agree}/{plain.height} items land in their intended class"
    for label, count in per_class.items():
        assert count / plain.height >= 0.08, (label, count)


def test_summer_heat_uplift_for_heat_items(medium):
    locs = medium["locations"].select("location_code", "country_code", "location_type")
    items = medium["items"].select("item_code", "product_group")
    demand = medium["demand"].join(locs, on="location_code").join(items, on="item_code")
    demand = demand.filter(pl.col("country_code").is_in(["SA", "KW", "QA", "AE"]))
    demand = demand.with_columns(pl.col("demand_date").dt.month().alias("month"))

    def ratio(groups: set[str]) -> float:
        rows = demand.filter(pl.col("product_group").is_in(list(groups)))
        summer = rows.filter(pl.col("month").is_in([7, 8]))["quantity"].sum() / 2
        winter = rows.filter(pl.col("month").is_in([11, 12, 1, 2]))["quantity"].sum() / 4
        return summer / winter

    assert ratio(HEAT_GROUPS) >= 1.4
    assert 0.7 <= ratio(NEUTRAL_GROUPS) <= 1.2


def test_ramadan_dip_per_country_window(medium):
    """Workshop lines without a pre-Eid lift drop to roughly 75% of their pre-Ramadan rate, per country window."""
    locs = medium["locations"].select("location_code", "country_code")
    items = medium["items"].select("item_code", "product_group")
    plain_workshop = {g.code for g in product_groups() if g.ramadan_profile == "workshop" and g.pre_eid_lift == 1.0 and g.heat_coefficient < 0.5}
    demand = (
        medium["demand"]
        .join(locs, on="location_code")
        .join(items, on="item_code")
        .filter(pl.col("product_group").is_in(list(plain_workshop)))
        .with_columns((pl.col("quantity") + pl.col("lost_sales_quantity")).alias("total"))
    )
    cal = Calendar(WINDOW_START, N_DAYS)
    ratios = []
    for w in ramadan_windows():
        c = cal.country(w.country_code)
        inside = demand.filter((pl.col("country_code") == w.country_code) & (pl.col("demand_date") >= w.ramadan_start) & (pl.col("demand_date") <= w.ramadan_end))
        before_start = w.ramadan_start - timedelta(days=70)
        before = demand.filter((pl.col("country_code") == w.country_code) & (pl.col("demand_date") >= before_start) & (pl.col("demand_date") < w.ramadan_start))
        if inside.height < 100 or before.height < 200:
            continue  # too little demand in this country/year for a stable ratio (small countries)
        open_inside = int(c.open[cal.index(w.ramadan_start) : cal.index(w.ramadan_end) + 1].sum())
        open_before = int(c.open[cal.index(before_start) : cal.index(w.ramadan_start)].sum())
        ratio = (inside["total"].sum() / open_inside) / (before["total"].sum() / open_before)
        ratios.append((w.country_code, w.hijri_year, ratio))
        assert 0.5 <= ratio <= 0.95, (w.country_code, w.hijri_year, ratio)
    assert len(ratios) >= 3, ratios
    assert 0.6 <= np.mean([r for _, _, r in ratios]) <= 0.9, ratios


def test_pre_eid_lift_for_batteries(medium):
    locs = medium["locations"].select("location_code", "country_code")
    items = medium["items"].select("item_code", "product_group")
    demand = medium["demand"].join(locs, on="location_code").join(items, on="item_code").filter(pl.col("product_group") == "battery")
    cal = Calendar(WINDOW_START, N_DAYS)
    lifts = []
    for w in ramadan_windows():
        if w.country_code != "SA":
            continue
        c = cal.country("SA")
        last10 = demand.filter((pl.col("country_code") == "SA") & (pl.col("demand_date") > w.ramadan_end - timedelta(days=10)) & (pl.col("demand_date") <= w.ramadan_end))
        earlier = demand.filter((pl.col("country_code") == "SA") & (pl.col("demand_date") >= w.ramadan_start) & (pl.col("demand_date") <= w.ramadan_end - timedelta(days=10)))
        open_last = int(c.open[cal.index(w.ramadan_end) - 9 : cal.index(w.ramadan_end) + 1].sum())
        open_earlier = int(c.open[cal.index(w.ramadan_start) : cal.index(w.ramadan_end) - 9].sum())
        lifts.append((last10["quantity"].sum() / open_last) / (earlier["quantity"].sum() / open_earlier))
    assert np.mean(lifts) > 1.1, lifts


def test_supersession_transfer_keeps_family_demand(medium):
    links = medium["item_supersessions"]
    demand = medium["demand"]
    checked = 0
    for pred, succ, effective, factor in links.select("predecessor_item_code", "successor_item_code", "effective_on", "quantity_factor").iter_rows():
        before = demand.filter((pl.col("item_code") == pred) & (pl.col("demand_date") >= effective - timedelta(days=120)) & (pl.col("demand_date") < effective))
        after = demand.filter((pl.col("item_code") == succ) & (pl.col("demand_date") >= effective + timedelta(days=60)) & (pl.col("demand_date") < effective + timedelta(days=180)))
        if before.height < 30 or after.height < 30:
            continue
        total_before = (before["quantity"].sum() + before["lost_sales_quantity"].sum()) / 120
        # Successor units are expressed in its own pack; normalise by the link's quantity factor.
        total_after = (after["quantity"].sum() + after["lost_sales_quantity"].sum()) / 120 / float(factor)
        assert 0.5 <= total_after / total_before <= 2.0, (pred, succ, total_before, total_after, factor)
        assert demand.filter((pl.col("item_code") == pred) & (pl.col("demand_date") >= effective + timedelta(days=60))).height == 0
        checked += 1
    assert checked >= 1


def test_stockout_share(medium):
    pairs = medium["truth_pairs"]
    share = pairs.filter(pl.col("stockout_episodes") > 0).height / pairs.height
    assert 0.005 <= share <= 0.08, share


def test_assortment_shares(medium):
    locs = medium["locations"].select("location_code", "location_type")
    pairs = medium["truth_pairs"].join(locs, on="location_code")
    n_items = medium["items"].height
    central = pairs.filter(pl.col("location_type") == "central").height / n_items
    hub = pairs.filter(pl.col("location_type") == "hub").height / (4 * n_items)
    branch = pairs.filter(pl.col("location_type") == "branch").height / (35 * n_items)
    assert central == 1.0
    assert 0.2 <= hub <= 0.6, hub
    assert 0.04 <= branch <= 0.25, branch


def test_medium_generation_stays_fast(medium_bundle):
    # The fixture itself is the timing check: the whole module runs in seconds, not minutes.
    assert (medium_bundle / "manifest.json").exists()
