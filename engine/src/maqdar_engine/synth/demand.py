"""Daily demand simulation.

Each demand family (a supersession chain or a single item) is simulated per stocked location
with its own random generator seeded from the family index and the preset seed, so results do
not depend on batch size or on how many other items exist. Demand is an occurrence x size process
on open days: a Bernoulli draw with probability ``p_t`` (archetype base x tier x calendar
multiplier x lifecycle) and an integer size from 1 + negative binomial (low CV²) or a rounded
lognormal (high CV²). Chains split one family series between predecessor and successor with a
logistic cross-fade around the effective date. Stock-out episodes move quantity into lost sales.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import numpy as np

from .calendar import Calendar
from .catalog import Family, Item, lifecycle_curve
from .network import Location
from .presets import STOCKING_WEIGHT, TIER_SCALE, Preset

SIZE_TIER = {"central": 4.0, "hub": 2.0, "branch": 1.0}
P_CAP = 0.98
STOCKOUT_PAIR_SHARE = {"central": 0.0, "hub": 0.02, "branch": 0.05}
STOCKOUT_EPISODE_DAYS = (5, 20)
CROSSFADE_SCALE_DAYS = 8.0
CROSSFADE_DAYS = 60


@dataclass
class PairTruth:
    item: Item
    location: Location
    p_effective: float
    size_mean: float
    size_cv2: float
    stockout_episodes: int


@dataclass
class FamilyDemand:
    item_index: np.ndarray
    location_index: np.ndarray
    day_index: np.ndarray
    quantity: np.ndarray
    lost: np.ndarray
    truth: list[PairTruth]


def family_rng(family_index: int, seed: int) -> np.random.Generator:
    return np.random.default_rng([family_index, seed])


def stocked_locations(
    item: Item, locations: list[Location], preset: Preset, rng: np.random.Generator
) -> list[int]:
    """Indexes (into ``locations``) where the item is stocked. Central always, hubs and branches by share."""
    chosen: list[int] = []
    weight = STOCKING_WEIGHT[item.archetype]
    for idx, loc in enumerate(locations):
        if loc.location_type == "central":
            chosen.append(idx)
            continue
        share = preset.hub_share if loc.location_type == "hub" else preset.branch_share
        if rng.random() < min(1.0, share * weight * loc.size_factor):
            chosen.append(idx)
    return chosen


def lognormal_params(mean: float, cv2: float) -> tuple[float, float]:
    sigma2 = np.log1p(cv2)
    return float(np.log(mean) - sigma2 / 2), float(np.sqrt(sigma2))


def draw_sizes(rng: np.random.Generator, count: int, mean: float, cv2: float) -> np.ndarray:
    """Integer demand sizes >= 1 with the requested mean and CV²."""
    if count == 0:
        return np.zeros(0, dtype=np.int64)
    if cv2 >= 0.5:
        mu, sigma = lognormal_params(mean, cv2)
        return np.maximum(1, np.rint(rng.lognormal(mu, sigma, size=count))).astype(np.int64)
    m = mean - 1.0
    if m <= 0.05:
        return np.ones(count, dtype=np.int64)
    # 1 + NB with the tsintermittent simID mapping; falls back to 1 + Poisson when CV² is too small.
    p_nb = m / (cv2 * (m + 1.0) ** 2)
    if 0 < p_nb < 1:
        n_nb = m * p_nb / (1 - p_nb)
        return 1 + rng.negative_binomial(n_nb, p_nb, size=count).astype(np.int64)
    return 1 + rng.poisson(m, size=count).astype(np.int64)


def crossfade_shares(family: Family, calendar: Calendar) -> np.ndarray:
    """Share of the family series per item and day, shape (n_items, n_days), columns sum to 1."""
    n_items = len(family.items)
    n_days = calendar.n_days
    shares = np.zeros((n_items, n_days), dtype=np.float64)
    remaining = np.ones(n_days, dtype=np.float64)
    days = np.arange(n_days, dtype=np.float64)
    for position, link in enumerate(family.links):
        t_eff = calendar.index(link.effective_on)
        # The successor starts selling on effective_on and takes over within CROSSFADE_DAYS;
        # the predecessor's residual (dealer use-up) ends there, well before discontinued_on.
        successor_share = 1.0 / (1.0 + np.exp(-(days - (t_eff + CROSSFADE_DAYS / 2)) / CROSSFADE_SCALE_DAYS))
        successor_share[days < t_eff] = 0.0
        successor_share[days >= t_eff + CROSSFADE_DAYS] = 1.0
        shares[position] = remaining * (1.0 - successor_share)
        remaining = remaining * successor_share
    shares[n_items - 1] = remaining
    return shares


def simulate_family(
    family: Family,
    locations: list[Location],
    calendar: Calendar,
    preset: Preset,
) -> FamilyDemand:
    rng = family_rng(family.index, preset.seed)
    n_days = calendar.n_days
    day_idx = np.arange(n_days)
    lead_item = family.items[0]
    group = lead_item.group
    # The family's assortment is the union over its items; successors inherit it.
    stocked = sorted({idx for item in family.items for idx in stocked_locations(item, locations, preset, rng)})
    shares = crossfade_shares(family, calendar) if len(family.items) > 1 else None

    item_cols: list[np.ndarray] = []
    loc_cols: list[np.ndarray] = []
    day_cols: list[np.ndarray] = []
    qty_cols: list[np.ndarray] = []
    lost_cols: list[np.ndarray] = []
    truth: list[PairTruth] = []

    for loc_index in stocked:
        location = locations[loc_index]
        multipliers = calendar.multipliers(location, group)
        tier = TIER_SCALE[location.location_type] * location.size_factor
        p = lead_item.p_base * tier * preset.density
        rate = p * multipliers
        if shares is None:
            rate = rate * lifecycle_curve(lead_item, day_idx, calendar.start)
        p_t = np.minimum(rate, P_CAP)
        size_scale = np.maximum(1.0, rate / P_CAP)
        occurrence = rng.random(n_days) < p_t
        hits = np.flatnonzero(occurrence)
        mean_size = lead_item.size_mean * SIZE_TIER[location.location_type]
        sizes = draw_sizes(rng, hits.size, mean_size, lead_item.size_cv2)
        quantity = np.zeros(n_days, dtype=np.int64)
        quantity[hits] = np.maximum(1, np.rint(sizes * size_scale[hits])).astype(np.int64)

        # Stock-out episodes turn demand into lost sales.
        episodes = 0
        lost = np.zeros(n_days, dtype=np.int64)
        if rng.random() < STOCKOUT_PAIR_SHARE[location.location_type]:
            episodes = int(rng.integers(1, 4))
            for _ in range(episodes):
                length = int(rng.integers(*STOCKOUT_EPISODE_DAYS))
                start = int(rng.integers(0, max(1, n_days - length)))
                window = slice(start, start + length)
                lost[window] += quantity[window]
                quantity[window] = 0

        per_item = _split_family(family, quantity, lost, shares, rng)
        for position, item in enumerate(family.items):
            q, l = per_item[position]
            nz = np.flatnonzero((q > 0) | (l > 0))
            if nz.size == 0:
                continue
            item_cols.append(np.full(nz.size, item.index, dtype=np.int32))
            loc_cols.append(np.full(nz.size, loc_index, dtype=np.int16))
            day_cols.append(nz.astype(np.int32))
            qty_cols.append(q[nz].astype(np.int32))
            lost_cols.append(l[nz].astype(np.int32))
        for item in family.items:
            truth.append(
                PairTruth(
                    item=item,
                    location=location,
                    p_effective=float(min(p, P_CAP)),
                    size_mean=mean_size,
                    size_cv2=lead_item.size_cv2,
                    stockout_episodes=episodes,
                )
            )

    def cat(cols: list[np.ndarray], dtype) -> np.ndarray:
        return np.concatenate(cols) if cols else np.zeros(0, dtype=dtype)

    item_index = cat(item_cols, np.int32)
    location_index = cat(loc_cols, np.int16)
    day_index = cat(day_cols, np.int32)
    quantity = cat(qty_cols, np.int32)
    lost = cat(lost_cols, np.int32)
    # Sorted inside the family so the output order never depends on batching.
    order = np.lexsort((day_index, location_index, item_index))
    return FamilyDemand(
        item_index=item_index[order],
        location_index=location_index[order],
        day_index=day_index[order],
        quantity=quantity[order],
        lost=lost[order],
        truth=truth,
    )


def _split_family(
    family: Family,
    quantity: np.ndarray,
    lost: np.ndarray,
    shares: np.ndarray | None,
    rng: np.random.Generator,
) -> list[tuple[np.ndarray, np.ndarray]]:
    if shares is None:
        return [(quantity, lost)]
    n_items = len(family.items)
    total = quantity + lost
    days = np.flatnonzero(total > 0)
    split = np.zeros((n_items, quantity.size), dtype=np.int64)
    for d in days:
        split[:, d] = rng.multinomial(int(total[d]), shares[:, d])
    out: list[tuple[np.ndarray, np.ndarray]] = []
    lost_share = np.divide(lost, total, out=np.zeros_like(lost, dtype=np.float64), where=total > 0)
    for position, item in enumerate(family.items):
        units = split[position]
        factor = _factor_for(family, position)
        if factor != 1:
            units = np.where(units > 0, np.maximum(1, np.rint(units * factor)), 0).astype(np.int64)
        item_lost = np.rint(units * lost_share).astype(np.int64)
        out.append((units - item_lost, item_lost))
    return out


def _factor_for(family: Family, position: int) -> float:
    """Cumulative quantity factor from the chain head to this position."""
    factor = Decimal(1)
    for link in family.links[:position]:
        factor *= link.quantity_factor
    return float(factor)
