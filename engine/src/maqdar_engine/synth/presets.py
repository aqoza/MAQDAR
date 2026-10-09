"""Dataset presets and the fixed generation window."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import date, timedelta

WINDOW_START = date(2023, 10, 1)
WINDOW_END = date(2026, 9, 30)
N_DAYS = (WINDOW_END - WINDOW_START).days + 1  # 1,096

NAMESPACE = uuid.UUID("6f1d2b4e-8c3a-4f5e-9a7b-0c1d2e3f4a5b")
"""Namespace for every deterministic uuid5 the generator and loader produce."""

TIER_SCALE = {"central": 1.0, "hub": 0.5, "branch": 0.25}
"""Occurrence-probability multiplier per location type (central sees wholesale demand)."""

ARCHETYPE_MIX = {"smooth": 0.20, "erratic": 0.10, "intermittent": 0.40, "lumpy": 0.30}
"""Share of items per Syntetos-Boylan archetype."""

STOCKING_WEIGHT = {"smooth": 1.6, "erratic": 1.4, "intermittent": 0.9, "lumpy": 0.6}
"""Relative chance that a hub or branch stocks an item of this archetype (mean 1 over the mix)."""


@dataclass(frozen=True)
class Preset:
    name: str
    seed: int
    items: int
    location_codes: tuple[str, ...] | None
    """Subset of the 40-location network, or None for all."""
    hub_share: float
    branch_share: float
    density: float
    suppliers: int
    chain_share: float
    """Share of items that belong to a supersession chain."""
    months: int = 36
    batch_items: int = 2000
    """Items per writing batch; never changes the output."""

    @property
    def window_start(self) -> date:
        if self.months >= 36:
            return WINDOW_START
        year = WINDOW_END.year
        month = WINDOW_END.month - self.months + 1
        while month <= 0:
            month += 12
            year -= 1
        return date(year, month, 1)

    @property
    def window_end(self) -> date:
        return WINDOW_END

    @property
    def n_days(self) -> int:
        return (self.window_end - self.window_start).days + 1

    @property
    def organization_slug(self) -> str:
        return f"synth-{self.name}"

    @property
    def organization_name(self) -> str:
        return f"Synthetic network ({self.name}, {self.items:,} items)"

    @property
    def organization_id(self) -> uuid.UUID:
        return uuid.uuid5(NAMESPACE, f"organization/{self.organization_slug}")

    def with_overrides(self, **changes: object) -> "Preset":
        return replace(self, **changes)


TINY_LOCATIONS = (
    "RUH-DC",
    "DXB-HUB",
    "KWI-HUB",
    "SA-RUH-N",
    "SA-JED",
    "AE-DXB-DEI",
    "QA-DOH-IND",
    "OM-RUW",
)

PRESETS: dict[str, Preset] = {
    "tiny": Preset(
        name="tiny",
        seed=7,
        items=24,
        location_codes=TINY_LOCATIONS,
        hub_share=0.6,
        branch_share=0.4,
        density=1.0,
        suppliers=6,
        chain_share=0.25,
        batch_items=8,
    ),
    "medium": Preset(
        name="medium",
        seed=11,
        items=300,
        location_codes=None,
        hub_share=0.4,
        branch_share=0.12,
        density=1.0,
        suppliers=12,
        chain_share=0.08,
        batch_items=100,
    ),
    "small": Preset(
        name="small",
        seed=1,
        items=1_000,
        location_codes=None,
        hub_share=0.35,
        branch_share=0.08,
        density=1.0,
        suppliers=25,
        chain_share=0.06,
        batch_items=500,
    ),
    "large": Preset(
        name="large",
        seed=2,
        items=50_000,
        location_codes=None,
        hub_share=0.30,
        branch_share=0.05,
        density=0.5,
        suppliers=120,
        chain_share=0.06,
        batch_items=2000,
    ),
}


def day_index(d: date, start: date) -> int:
    return (d - start).days


def date_at(index: int, start: date) -> date:
    return start + timedelta(days=int(index))
