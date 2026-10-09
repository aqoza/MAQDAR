"""Calendars and demand multipliers per location and product group.

Everything date-related is data: weekends come from countries.csv, closures from
public_holidays.csv and the Ramadan/Eid windows from ramadan_windows.csv. The magnitudes below
(heat, dust, Ramadan, Eid, Hajj, summer exodus) are modelling assumptions documented in
docs/synthetic-data.md, not measured facts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache

import numpy as np

from .network import Location, ProductGroup, _rows, countries

# Monthly heat index per country (1 = peak summer). Oman peaks earlier (May-June) than the
# northern Gulf; July-August are the peak in KSA, Kuwait, Qatar and the UAE.
HEAT_INDEX: dict[str, tuple[float, ...]] = {
    "SA": (0, 0, 0, 0.1, 0.4, 0.7, 1.0, 1.0, 0.6, 0.2, 0, 0),
    "KW": (0, 0, 0, 0.1, 0.45, 0.75, 1.0, 1.0, 0.65, 0.2, 0, 0),
    "QA": (0, 0, 0, 0.1, 0.4, 0.7, 1.0, 0.95, 0.6, 0.2, 0, 0),
    "AE": (0, 0, 0, 0.1, 0.35, 0.65, 0.95, 1.0, 0.6, 0.2, 0, 0),
    "OM": (0, 0, 0, 0.2, 0.8, 1.0, 0.6, 0.5, 0.4, 0.2, 0, 0),
}
HEAT_UPLIFT = 0.8  # battery (coefficient 1.0) reaches x1.8 at peak
WINTER_DIP = 0.15  # heat items sell 15% less in December-February
DUST_INDEX: dict[int, float] = {3: 0.5, 4: 0.7, 5: 1.0, 6: 0.8}
DUST_UPLIFT = 0.35  # filters (coefficient 1.0) reach x1.35 at the May peak
RAMADAN_PROFILE: dict[str, float] = {"workshop": 0.75, "counter": 0.85, "battery": 1.0, "tyre": 0.9}
GOVERNMENT_QUIET = 0.8
POST_EID_LIFT = 1.15
POST_EID_DAYS = 5
PRE_EID_DAYS = 10
EXODUS: dict[str, float] = {"AE": 0.85, "QA": 0.85, "KW": 0.85, "SA": 0.92, "OM": 0.92}
EXODUS_START = (7, 1)
EXODUS_END = (8, 25)
HAJJ_CORE_QUIET = 0.85  # KSA outside the west: 8-13 Dhul Hijjah
HAJJ_FLEET_UPLIFT = 1.5  # western KSA fleet groups: 1 + 1.5 * hajj_fleet over 1-13 Dhul Hijjah
FIRST_OPEN_DAY = 1.15
LAST_OPEN_DAY = 0.9
MAX_MULTIPLIER = 4.0


@dataclass(frozen=True)
class Holiday:
    country_code: str
    holiday_date: date
    name_en: str
    kind: str
    sector: str
    shifted_from: date | None
    source: str
    note: str


@dataclass(frozen=True)
class RamadanWindow:
    country_code: str
    hijri_year: int
    ramadan_start: date
    ramadan_end: date
    eid_al_fitr: date
    arafat_day: date
    eid_al_adha: date
    source: str


def _date(value: str) -> date | None:
    return date.fromisoformat(value) if value else None


@lru_cache(maxsize=1)
def holidays() -> tuple[Holiday, ...]:
    return tuple(
        Holiday(
            country_code=r["country_code"],
            holiday_date=date.fromisoformat(r["holiday_date"]),
            name_en=r["name_en"],
            kind=r["kind"],
            sector=r["sector"],
            shifted_from=_date(r["shifted_from"]),
            source=r["source"],
            note=r["note"],
        )
        for r in _rows("public_holidays.csv")
    )


@lru_cache(maxsize=1)
def ramadan_windows() -> tuple[RamadanWindow, ...]:
    return tuple(
        RamadanWindow(
            country_code=r["country_code"],
            hijri_year=int(r["hijri_year"]),
            ramadan_start=date.fromisoformat(r["ramadan_start"]),
            ramadan_end=date.fromisoformat(r["ramadan_end"]),
            eid_al_fitr=date.fromisoformat(r["eid_al_fitr"]),
            arafat_day=date.fromisoformat(r["arafat_day"]),
            eid_al_adha=date.fromisoformat(r["eid_al_adha"]),
            source=r["source"],
        )
        for r in _rows("ramadan_windows.csv")
    )


@dataclass
class CountryCalendar:
    code: str
    weekend: np.ndarray
    closed: np.ndarray
    """All-sector holidays."""
    government_quiet: np.ndarray
    open: np.ndarray
    ramadan: np.ndarray
    pre_eid_fitr: np.ndarray
    post_eid_fitr: np.ndarray
    pre_eid_adha: np.ndarray
    hajj_core: np.ndarray
    """8-13 Dhul Hijjah (Arafat - 1 .. Arafat + 4)."""
    hajj_wide: np.ndarray
    """1-13 Dhul Hijjah (Arafat - 8 .. Arafat + 4)."""
    exodus: np.ndarray
    heat: np.ndarray
    dust: np.ndarray
    week_shape: np.ndarray


class Calendar:
    """Daily arrays over the generation window for every country, plus multipliers per location and group."""

    def __init__(self, start: date, n_days: int) -> None:
        self.start = start
        self.n_days = n_days
        self.dates = [start + timedelta(days=i) for i in range(n_days)]
        self.weekday = np.array([d.isoweekday() for d in self.dates], dtype=np.int16)
        self.month = np.array([d.month for d in self.dates], dtype=np.int16)
        self.day_of_month = np.array([d.day for d in self.dates], dtype=np.int16)
        self._countries: dict[str, CountryCalendar] = {}
        self._multipliers: dict[tuple[str, str], np.ndarray] = {}

    @property
    def end(self) -> date:
        return self.dates[-1]

    def index(self, d: date) -> int:
        return (d - self.start).days

    def _mask_between(self, first: date, last: date) -> np.ndarray:
        mask = np.zeros(self.n_days, dtype=bool)
        lo = max(self.index(first), 0)
        hi = min(self.index(last), self.n_days - 1)
        if lo <= hi:
            mask[lo : hi + 1] = True
        return mask

    def check_coverage(self, country_codes: set[str]) -> None:
        """Refuses to generate for a country whose verified holiday table does not cover the window."""
        for code in sorted(country_codes):
            country = countries()[code]
            if country.holiday_coverage_from is None or country.holiday_coverage_to is None:
                raise ValueError(f"no verified holiday coverage for {code}")
            if date.fromisoformat(country.holiday_coverage_from) > self.start or date.fromisoformat(
                country.holiday_coverage_to
            ) < self.end:
                raise ValueError(
                    f"holiday coverage for {code} ({country.holiday_coverage_from}..{country.holiday_coverage_to}) "
                    f"does not cover the window {self.start}..{self.end}"
                )

    def country(self, code: str) -> CountryCalendar:
        if code in self._countries:
            return self._countries[code]
        info = countries()[code]
        weekend = np.isin(self.weekday, info.weekend_days)
        closed = np.zeros(self.n_days, dtype=bool)
        government = np.zeros(self.n_days, dtype=bool)
        for h in holidays():
            if h.country_code != code:
                continue
            i = self.index(h.holiday_date)
            if 0 <= i < self.n_days:
                if h.sector == "all":
                    closed[i] = True
                elif h.sector == "government":
                    government[i] = True
        open_days = ~weekend & ~closed

        ramadan = np.zeros(self.n_days, dtype=bool)
        pre_fitr = np.zeros(self.n_days, dtype=bool)
        post_fitr = np.zeros(self.n_days, dtype=bool)
        pre_adha = np.zeros(self.n_days, dtype=bool)
        hajj_core = np.zeros(self.n_days, dtype=bool)
        hajj_wide = np.zeros(self.n_days, dtype=bool)
        for w in ramadan_windows():
            if w.country_code != code:
                continue
            ramadan |= self._mask_between(w.ramadan_start, w.ramadan_end)
            pre_fitr |= self._mask_between(w.ramadan_end - timedelta(days=PRE_EID_DAYS - 1), w.ramadan_end)
            post_fitr |= self._mask_between(w.eid_al_fitr + timedelta(days=3), w.eid_al_fitr + timedelta(days=3 + POST_EID_DAYS))
            pre_adha |= self._mask_between(w.arafat_day - timedelta(days=PRE_EID_DAYS), w.arafat_day - timedelta(days=1))
            hajj_core |= self._mask_between(w.arafat_day - timedelta(days=1), w.arafat_day + timedelta(days=4))
            hajj_wide |= self._mask_between(w.arafat_day - timedelta(days=8), w.arafat_day + timedelta(days=4))

        exodus = np.zeros(self.n_days, dtype=bool)
        for year in range(self.start.year, self.end.year + 1):
            exodus |= self._mask_between(date(year, *EXODUS_START), date(year, *EXODUS_END))

        heat = self._interpolate_monthly(HEAT_INDEX.get(code, HEAT_INDEX["SA"]))
        dust = np.array([DUST_INDEX.get(int(m), 0.0) for m in self.month], dtype=np.float64)

        week_shape = np.ones(self.n_days, dtype=np.float64)
        prev_open = np.concatenate(([False], open_days[:-1]))
        next_open = np.concatenate((open_days[1:], [False]))
        prev_weekend = np.concatenate(([False], weekend[:-1]))
        next_weekend = np.concatenate((weekend[1:], [False]))
        week_shape[open_days & ~prev_open & prev_weekend] = FIRST_OPEN_DAY
        week_shape[open_days & ~next_open & next_weekend] = LAST_OPEN_DAY

        cal = CountryCalendar(
            code=code,
            weekend=weekend,
            closed=closed,
            government_quiet=government,
            open=open_days,
            ramadan=ramadan,
            pre_eid_fitr=pre_fitr,
            post_eid_fitr=post_fitr,
            pre_eid_adha=pre_adha,
            hajj_core=hajj_core,
            hajj_wide=hajj_wide,
            exodus=exodus,
            heat=heat,
            dust=dust,
            week_shape=week_shape,
        )
        self._countries[code] = cal
        return cal

    def _interpolate_monthly(self, by_month: tuple[float, ...]) -> np.ndarray:
        """Linear interpolation between month midpoints so seasonal effects ramp smoothly."""
        # Position of each day relative to its month midpoint, on a 0..12 scale.
        days_in_month = np.array(
            [(date(d.year + (d.month == 12), d.month % 12 + 1, 1) - date(d.year, d.month, 1)).days for d in self.dates],
            dtype=np.float64,
        )
        position = (self.month - 1) + (self.day_of_month - 0.5) / days_in_month  # 0..12
        xp = np.arange(12) + 0.5
        values = np.array(by_month, dtype=np.float64)
        xp_wrapped = np.concatenate(([xp[-1] - 12], xp, [xp[0] + 12]))
        fp_wrapped = np.concatenate(([values[-1]], values, [values[0]]))
        return np.interp(position, xp_wrapped, fp_wrapped)

    def multipliers(self, location: Location, group: ProductGroup) -> np.ndarray:
        """Daily multiplier for one location and product group (0 on closed days)."""
        key = (location.code, group.code)
        if key in self._multipliers:
            return self._multipliers[key]
        cal = self.country(location.country_code)
        m = np.ones(self.n_days, dtype=np.float64)

        # Seasonal effects on the rate.
        if group.heat_coefficient > 0:
            m *= 1 + HEAT_UPLIFT * group.heat_coefficient * cal.heat
            m *= np.where(np.isin(self.month, (12, 1, 2)), 1 - WINTER_DIP * group.heat_coefficient, 1.0)
        if group.dust_coefficient > 0:
            region_factor = _dust_region_factor(location)
            m *= 1 + DUST_UPLIFT * group.dust_coefficient * region_factor * cal.dust

        # Ramadan and the two Eids.
        m *= np.where(cal.ramadan, RAMADAN_PROFILE[group.ramadan_profile], 1.0)
        if group.pre_eid_lift > 1:
            m *= np.where(cal.pre_eid_fitr | cal.pre_eid_adha, group.pre_eid_lift, 1.0)
        m *= np.where(cal.post_eid_fitr, POST_EID_LIFT, 1.0)

        # Hajj (KSA only).
        if location.country_code == "SA":
            if location.region_tag == "western" and group.hajj_fleet > 0:
                m *= np.where(cal.hajj_wide, 1 + HAJJ_FLEET_UPLIFT * group.hajj_fleet, 1.0)
            elif location.region_tag != "western":
                m *= np.where(cal.hajj_core, HAJJ_CORE_QUIET, 1.0)

        # Summer exodus: retail dips while residents travel; heat items keep their uplift.
        if group.heat_coefficient < 0.5:
            m *= np.where(cal.exodus, EXODUS.get(location.country_code, 1.0), 1.0)

        # Working-week shape, government quiet days and closures.
        m *= cal.week_shape
        m *= np.where(cal.government_quiet, GOVERNMENT_QUIET, 1.0)
        m = np.clip(m, 0.0, MAX_MULTIPLIER)
        m[~cal.open] = 0.0
        self._multipliers[key] = m
        return m


def _dust_region_factor(location: Location) -> float:
    if location.country_code in ("KW", "QA"):
        return 1.0
    if location.country_code == "SA":
        return 1.0 if location.region_tag == "eastern" else 0.5
    if location.country_code == "AE":
        return 0.5
    return 0.2
