"""Suppliers and supplier items (lead times, minimum order quantities, pack sizes, prices)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

import numpy as np

from .catalog import Item
from .network import currencies
from .presets import Preset

# region, country, currency, p50 days, p90 days, share of suppliers
REGIONS: tuple[tuple[str, str, str, int, int, float], ...] = (
    ("local", "SA", "SAR", 5, 10, 0.30),
    ("local", "AE", "AED", 6, 12, 0.10),
    ("regional", "AE", "AED", 10, 18, 0.20),
    ("asia", "JP", "JPY", 45, 70, 0.12),
    ("asia", "KR", "USD", 40, 65, 0.08),
    ("asia", "CN", "USD", 35, 60, 0.08),
    ("eu_us", "DE", "EUR", 35, 55, 0.07),
    ("eu_us", "US", "USD", 40, 60, 0.05),
)

FX_FROM_SAR: dict[str, float] = {
    "SAR": 1.0,
    "AED": 0.9795,
    "QAR": 0.9707,
    "KWD": 0.0819,
    "OMR": 0.1026,
    "USD": 0.2667,
    "EUR": 0.2450,
    "JPY": 40.0,
    "CNY": 1.92,
}

NAME_STEMS = (
    "Al Noor", "Falcon", "Oryx", "Sahara", "Nakheel", "Gulf Star", "Marhaba", "Zenith", "Aurora", "Nova", "Dune",
    "Al Bahr", "Crescent", "Horizon", "Palm", "Pearl", "Summit", "Atlas", "Meridian", "Pioneer", "Apex", "Vertex",
    "Cedar", "Saqr", "Jazeera", "Rimal", "Najd", "Hijaz", "Tihama", "Dhahran",
)
NAME_SUFFIX = {
    "local": "Trading Co.",
    "regional": "Parts Distribution LLC",
    "asia": "Industrial Co., Ltd.",
    "eu_us": "Components GmbH",
}
SECOND_SOURCE_SHARE = 0.3


@dataclass
class Supplier:
    index: int
    code: str
    name_en: str
    name_ar: str | None
    region: str
    country_code: str
    currency: str
    lead_time_days_p50: int
    lead_time_days_p90: int


@dataclass
class SupplierItem:
    supplier: Supplier
    item: Item
    supplier_part_number: str
    lead_time_days: int
    lead_time_days_p90: int
    min_order_quantity: int
    pack_size: int
    unit_price: Decimal
    currency: str
    is_preferred: bool


def _round_money(value: float, currency: str) -> Decimal:
    units = currencies()[currency].minor_units
    return Decimal(str(value)).quantize(Decimal(1).scaleb(-units), rounding=ROUND_HALF_UP)


def build_suppliers(preset: Preset, rng: np.random.Generator) -> list[Supplier]:
    weights = np.array([r[5] for r in REGIONS])
    weights /= weights.sum()
    region_idx = rng.choice(len(REGIONS), size=preset.suppliers, p=weights)
    stems = rng.permutation(len(NAME_STEMS))
    suppliers: list[Supplier] = []
    for i in range(preset.suppliers):
        region, country, currency, p50, p90, _ = REGIONS[int(region_idx[i])]
        jitter = float(rng.uniform(0.8, 1.2))
        p50_days = max(1, int(round(p50 * jitter)))
        p90_days = max(p50_days + 1, int(round(p90 * jitter * float(rng.uniform(0.95, 1.15)))))
        stem = NAME_STEMS[int(stems[i % len(NAME_STEMS)])]
        suffix = NAME_SUFFIX[region]
        name = f"{stem} {suffix}" if i < len(NAME_STEMS) else f"{stem} {suffix} {i // len(NAME_STEMS) + 1}"
        suppliers.append(
            Supplier(
                index=i,
                code=f"SUP-{i + 1:03d}",
                name_en=name,
                name_ar=None,
                region=region,
                country_code=country,
                currency=currency,
                lead_time_days_p50=p50_days,
                lead_time_days_p90=p90_days,
            )
        )
    return suppliers


def build_supplier_items(items: list[Item], suppliers: list[Supplier], rng: np.random.Generator) -> list[SupplierItem]:
    """One preferred supplier per item, a second source for a share of items."""
    rows: list[SupplierItem] = []
    n_sup = len(suppliers)
    for item in items:
        primary = int(rng.integers(n_sup))
        chosen = [primary]
        if n_sup > 1 and rng.random() < SECOND_SOURCE_SHARE:
            second = int(rng.integers(n_sup - 1))
            if second >= primary:
                second += 1
            chosen.append(second)
        pack = int(rng.choice(item.group.pack_sizes))
        for rank, supplier_index in enumerate(chosen):
            supplier = suppliers[supplier_index]
            lead = max(1, int(round(supplier.lead_time_days_p50 * float(rng.uniform(0.85, 1.15)))))
            lead_p90 = max(lead, int(round(supplier.lead_time_days_p90 * float(rng.uniform(0.9, 1.2)))))
            moq = pack * int(rng.choice(item.group.moq_multipliers))
            price_sar = float(item.unit_cost) * float(rng.uniform(0.85, 1.05)) * (1.03 if rank else 1.0)
            price = _round_money(price_sar * FX_FROM_SAR[supplier.currency], supplier.currency)
            rows.append(
                SupplierItem(
                    supplier=supplier,
                    item=item,
                    supplier_part_number=f"{supplier.code[-3:]}-{item.code[2:]}",
                    lead_time_days=lead,
                    lead_time_days_p90=lead_p90,
                    min_order_quantity=moq,
                    pack_size=pack,
                    unit_price=price,
                    currency=supplier.currency,
                    is_preferred=rank == 0,
                )
            )
    return rows
