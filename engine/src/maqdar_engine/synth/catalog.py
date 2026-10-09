"""Items: product groups, brands, names, costs, demand archetypes, lifecycle and supersession chains."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

import numpy as np

from .network import Brand, ProductGroup, brands, currencies, product_groups
from .presets import ARCHETYPE_MIX, Preset

# Occurrence probability per open day at the central warehouse and size parameters per archetype.
# ADI targets stay at least 0.1 away from the 1.32 cutoff and CV² away from 0.49.
ARCHETYPES: dict[str, dict[str, float]] = {
    "smooth": {"p": 0.85, "size_scale": 2.0, "cv2": 0.20},
    "erratic": {"p": 0.85, "size_scale": 3.0, "cv2": 1.00},
    "intermittent": {"p": 0.20, "size_scale": 1.5, "cv2": 0.20},
    "lumpy": {"p": 0.15, "size_scale": 3.0, "cv2": 1.00},
}
P_JITTER = (0.75, 1.25)
P_BOUNDS = {"smooth": (0.80, 0.98), "erratic": (0.80, 0.98), "intermittent": (0.08, 0.40), "lumpy": (0.05, 0.35)}
LIFECYCLE_MIX = {"active": 0.85, "new": 0.07, "declining": 0.05, "discontinued": 0.03}
NEW_RAMP_DAYS = 90
USE_UP_DAYS = 120
NAME_AR_SHARE = 0.5

SINGULAR_EN = {
    "battery": "Battery",
    "ac_compressor": "A/C compressor",
    "ac_condenser": "A/C condenser",
    "ac_parts": "A/C blower assembly",
    "cabin_filter": "Cabin filter",
    "air_filter": "Air filter",
    "oil_filter": "Oil filter",
    "fuel_filter": "Fuel filter",
    "coolant": "Coolant",
    "engine_oil": "Engine oil",
    "brake_pad": "Brake pad set",
    "brake_disc": "Brake disc",
    "belt": "Drive belt",
    "spark_plug": "Spark plug",
    "wiper_blade": "Wiper blade",
    "tyre": "Tyre",
    "suspension": "Shock absorber",
    "electrical": "Sensor",
    "lighting": "Headlamp",
    "body_panel": "Body panel",
    "engine_component": "Engine component",
}
SINGULAR_AR = {
    "battery": "بطارية",
    "ac_compressor": "ضاغط تكييف",
    "ac_condenser": "مكثف تكييف",
    "ac_parts": "مجموعة مروحة تكييف",
    "cabin_filter": "فلتر مقصورة",
    "air_filter": "فلتر هواء",
    "oil_filter": "فلتر زيت",
    "fuel_filter": "فلتر وقود",
    "coolant": "سائل تبريد",
    "engine_oil": "زيت محرك",
    "brake_pad": "طقم فحمات فرامل",
    "brake_disc": "قرص فرامل",
    "belt": "حزام",
    "spark_plug": "شمعة إشعال",
    "wiper_blade": "مساحة زجاج",
    "tyre": "إطار",
    "suspension": "ممتص صدمات",
    "electrical": "حساس",
    "lighting": "مصباح أمامي",
    "body_panel": "لوحة هيكل",
    "engine_component": "مكوّن محرك",
}


@dataclass
class Item:
    index: int
    code: str
    name_en: str
    name_ar: str | None
    brand: Brand
    group: ProductGroup
    unit_cost: Decimal
    currency: str
    archetype: str
    velocity: float
    p_base: float
    size_mean: float
    size_cv2: float
    status: str = "active"
    introduced_on: date | None = None
    discontinued_on: date | None = None
    chain_id: str | None = None
    chain_position: int | None = None
    family: int = 0
    """Index of the demand family (a chain or a single item) the item belongs to."""


@dataclass
class Supersession:
    predecessor: Item
    successor: Item
    effective_on: date
    quantity_factor: Decimal
    chain_id: str


@dataclass
class Family:
    index: int
    items: list[Item]
    links: list[Supersession] = field(default_factory=list)


@dataclass
class Catalog:
    items: list[Item]
    families: list[Family]
    supersessions: list[Supersession]


def _weighted_choice(rng: np.random.Generator, options: list, weights: list[float], size: int) -> np.ndarray:
    w = np.array(weights, dtype=np.float64)
    w /= w.sum()
    return rng.choice(len(options), size=size, p=w)


def _round_money(value: float, currency: str) -> Decimal:
    units = currencies()[currency].minor_units
    quantum = Decimal(1).scaleb(-units)
    return Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP)


def build_catalog(preset: Preset, rng: np.random.Generator) -> Catalog:
    groups = list(product_groups())
    brand_list = list(brands())
    n = preset.items
    start, end = preset.window_start, preset.window_end

    group_idx = _weighted_choice(rng, groups, [g.share for g in groups], n)
    brand_idx = _weighted_choice(rng, brand_list, [b.share for b in brand_list], n)
    archetype_names = list(ARCHETYPE_MIX)
    archetype_idx = _weighted_choice(rng, archetype_names, list(ARCHETYPE_MIX.values()), n)
    velocity = np.exp(rng.normal(0.0, 1.0, size=n))
    cost_noise = rng.normal(0.0, 1.0, size=n)
    p_jitter = rng.uniform(*P_JITTER, size=n)
    name_ar_draw = rng.random(n)
    variant = rng.integers(1000, 9999, size=n)
    lifecycle_names = list(LIFECYCLE_MIX)
    lifecycle_idx = _weighted_choice(rng, lifecycle_names, list(LIFECYCLE_MIX.values()), n)
    window_days = (end - start).days

    items: list[Item] = []
    for i in range(n):
        group = groups[int(group_idx[i])]
        brand = brand_list[int(brand_idx[i])]
        archetype = archetype_names[int(archetype_idx[i])]
        params = ARCHETYPES[archetype]
        lo, hi = P_BOUNDS[archetype]
        p_base = float(np.clip(params["p"] * p_jitter[i], lo, hi))
        cost = group.price_median_sar * float(np.exp(group.price_log_sigma * cost_noise[i]))
        cost = float(np.clip(cost, 0.5, 60_000.0))
        code = f"P-{i + 1:06d}"
        token = f"{brand.code}-{int(variant[i])}"
        name_en = f"{SINGULAR_EN[group.code]} {token}"
        name_ar = f"{SINGULAR_AR[group.code]} {brand.name_ar} {int(variant[i])}" if name_ar_draw[i] < NAME_AR_SHARE else None
        item = Item(
            index=i,
            code=code,
            name_en=name_en,
            name_ar=name_ar,
            brand=brand,
            group=group,
            unit_cost=_round_money(cost, "SAR"),
            currency="SAR",
            archetype=archetype,
            velocity=float(velocity[i]),
            p_base=p_base,
            size_mean=max(1.0, params["size_scale"] * float(velocity[i])),
            size_cv2=params["cv2"],
        )
        lifecycle = lifecycle_names[int(lifecycle_idx[i])]
        if lifecycle == "new":
            offset = int(rng.integers(30, max(31, window_days - 120)))
            item.introduced_on = start + timedelta(days=offset)
            item.status = "new" if (end - item.introduced_on).days < 180 else "active"
        elif lifecycle == "discontinued":
            offset = int(rng.integers(180, max(181, window_days - 30)))
            item.introduced_on = start - timedelta(days=int(rng.integers(100, 2000)))
            item.discontinued_on = start + timedelta(days=offset)
            item.status = "discontinued"
        elif lifecycle == "declining":
            item.introduced_on = start - timedelta(days=int(rng.integers(1500, 4000)))
            item.status = "phase_out"
        else:
            item.introduced_on = start - timedelta(days=int(rng.integers(100, 3000)))
        items.append(item)

    families: list[Family] = []
    supersessions = _build_chains(preset, rng, items, families)
    # Every remaining item is its own family.
    in_family = {it.index for f in families for it in f.items}
    for item in items:
        if item.index not in in_family:
            family = Family(index=len(families), items=[item])
            item.family = family.index
            families.append(family)
    return Catalog(items=items, families=families, supersessions=supersessions)


def _build_chains(preset: Preset, rng: np.random.Generator, items: list[Item], families: list[Family]) -> list[Supersession]:
    """Forms supersession chains of 2-4 items within a product group; demand flows along the chain."""
    n_chain_items = int(round(preset.items * preset.chain_share))
    if n_chain_items < 2:
        return []
    by_group: dict[str, list[Item]] = {}
    for item in items:
        if item.status == "active" and item.introduced_on is not None and item.introduced_on < preset.window_start:
            by_group.setdefault(item.group.code, []).append(item)
    pool = [it for group_items in by_group.values() for it in group_items]
    supersessions: list[Supersession] = []
    used = 0
    start, end = preset.window_start, preset.window_end
    group_codes = list(by_group)
    while used < n_chain_items and group_codes:
        code = group_codes[int(rng.integers(len(group_codes)))]
        candidates = by_group[code]
        if len(candidates) < 2:
            group_codes.remove(code)
            continue
        length = int(rng.choice([2, 3, 4], p=[0.6, 0.3, 0.1]))
        length = min(length, len(candidates), n_chain_items - used if n_chain_items - used >= 2 else 2)
        members = [candidates.pop(0) for _ in range(length)]
        chain_id = f"CH-{len(families) + 1:05d}"
        family = Family(index=len(families), items=members)
        families.append(family)
        # First link somewhere between 200 days before the window and 60 days before its end.
        effective = start + timedelta(days=int(rng.integers(-200, (end - start).days - 60)))
        for position, item in enumerate(members):
            item.chain_id = chain_id
            item.chain_position = position
            item.family = family.index
            if position > 0:
                item.introduced_on = effective
                item.status = "new" if (end - effective).days < 180 else "active"
                predecessor = members[position - 1]
                predecessor.discontinued_on = effective + timedelta(days=USE_UP_DAYS)
                predecessor.status = "discontinued" if predecessor.discontinued_on <= end else "phase_out"
                factor = Decimal("1.000")
                if rng.random() < 0.1:
                    factor = Decimal("2.000") if rng.random() < 0.5 else Decimal("0.500")
                link = Supersession(
                    predecessor=predecessor,
                    successor=item,
                    effective_on=effective,
                    quantity_factor=factor,
                    chain_id=chain_id,
                )
                supersessions.append(link)
                family.links.append(link)
                effective = effective + timedelta(days=int(rng.integers(180, 300)))
        used += length
    return supersessions


def lifecycle_curve(item: Item, dates_index: np.ndarray, start: date) -> np.ndarray:
    """Multiplier per day for new ramps, discontinuations and declining items (chain fades are separate)."""
    n = dates_index.size
    curve = np.ones(n, dtype=np.float64)
    if item.introduced_on is not None and item.introduced_on > start:
        offset = (item.introduced_on - start).days
        ramp = np.clip((dates_index - offset + 1) / NEW_RAMP_DAYS, 0.0, 1.0)
        curve *= np.where(dates_index < offset, 0.0, 1 / (1 + np.exp(-10 * (ramp - 0.5))))
    if item.discontinued_on is not None and item.chain_id is None:
        offset = (item.discontinued_on - start).days
        curve[dates_index > offset] = 0.0
    if item.status == "phase_out" and item.chain_id is None:
        # Declining installed base: halves over the window.
        curve *= np.exp(-np.log(2) * dates_index / max(n, 1))
    return curve
