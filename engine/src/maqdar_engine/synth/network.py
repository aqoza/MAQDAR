"""Static reference data shipped with the package: locations, product groups, brands, countries."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources


def _rows(name: str) -> list[dict[str, str]]:
    data_dir = resources.files("maqdar_engine.synth") / "data"
    with (data_dir / name).open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


@dataclass(frozen=True)
class Country:
    code: str
    name_en: str
    currency_code: str
    weekend_days: tuple[int, ...]
    vat_rate: float
    timezone: str
    utc_offset_minutes: int
    holiday_coverage_from: str | None
    holiday_coverage_to: str | None


@dataclass(frozen=True)
class Location:
    code: str
    name_en: str
    name_ar: str
    location_type: str
    country_code: str
    city: str
    latitude: str
    longitude: str
    timezone: str
    parent_code: str | None
    region_tag: str
    size_factor: float


@dataclass(frozen=True)
class ProductGroup:
    code: str
    name_en: str
    name_ar: str
    unit_of_measure: str
    pack_sizes: tuple[int, ...]
    moq_multipliers: tuple[int, ...]
    price_median_sar: float
    price_log_sigma: float
    heat_coefficient: float
    dust_coefficient: float
    ramadan_profile: str
    pre_eid_lift: float
    hajj_fleet: float
    share: float


@dataclass(frozen=True)
class Brand:
    code: str
    name_en: str
    name_ar: str
    brand_type: str
    country_of_origin: str
    share: float


@dataclass(frozen=True)
class Currency:
    code: str
    name_en: str
    minor_units: int


@lru_cache(maxsize=1)
def countries() -> dict[str, Country]:
    out = {}
    for r in _rows("countries.csv"):
        out[r["code"]] = Country(
            code=r["code"],
            name_en=r["name_en"],
            currency_code=r["currency_code"],
            weekend_days=tuple(int(x) for x in r["weekend_days"].split(";")),
            vat_rate=float(r["vat_rate"]),
            timezone=r["timezone"],
            utc_offset_minutes=int(r["utc_offset_minutes"]),
            holiday_coverage_from=r["holiday_coverage_from"] or None,
            holiday_coverage_to=r["holiday_coverage_to"] or None,
        )
    return out


@lru_cache(maxsize=1)
def currencies() -> dict[str, Currency]:
    return {
        r["code"]: Currency(code=r["code"], name_en=r["name_en"], minor_units=int(r["minor_units"]))
        for r in _rows("currencies.csv")
    }


@lru_cache(maxsize=1)
def locations() -> tuple[Location, ...]:
    out = []
    for r in _rows("locations.csv"):
        out.append(
            Location(
                code=r["location_code"],
                name_en=r["name_en"],
                name_ar=r["name_ar"],
                location_type=r["location_type"],
                country_code=r["country_code"],
                city=r["city"],
                latitude=r["latitude"],
                longitude=r["longitude"],
                timezone=r["timezone"],
                parent_code=r["parent_location_code"] or None,
                region_tag=r["region_tag"],
                size_factor=float(r["size_factor"]),
            )
        )
    return tuple(out)


@lru_cache(maxsize=1)
def product_groups() -> tuple[ProductGroup, ...]:
    out = []
    for r in _rows("product_groups.csv"):
        out.append(
            ProductGroup(
                code=r["code"],
                name_en=r["name_en"],
                name_ar=r["name_ar"],
                unit_of_measure=r["unit_of_measure"],
                pack_sizes=tuple(int(x) for x in r["pack_sizes"].split(";")),
                moq_multipliers=tuple(int(x) for x in r["moq_multipliers"].split(";")),
                price_median_sar=float(r["price_median_sar"]),
                price_log_sigma=float(r["price_log_sigma"]),
                heat_coefficient=float(r["heat_coefficient"]),
                dust_coefficient=float(r["dust_coefficient"]),
                ramadan_profile=r["ramadan_profile"],
                pre_eid_lift=float(r["pre_eid_lift"]),
                hajj_fleet=float(r["hajj_fleet"]),
                share=float(r["share"]),
            )
        )
    return tuple(out)


@lru_cache(maxsize=1)
def brands() -> tuple[Brand, ...]:
    return tuple(
        Brand(
            code=r["code"],
            name_en=r["name_en"],
            name_ar=r["name_ar"],
            brand_type=r["brand_type"],
            country_of_origin=r["country_of_origin"],
            share=float(r["share"]),
        )
        for r in _rows("brands.csv")
    )


def select_locations(codes: tuple[str, ...] | None) -> tuple[Location, ...]:
    """Returns the preset's locations in network order (central, hubs, branches)."""
    all_locations = locations()
    if codes is None:
        return all_locations
    wanted = set(codes)
    chosen = tuple(loc for loc in all_locations if loc.code in wanted)
    missing = wanted - {loc.code for loc in chosen}
    if missing:
        raise ValueError(f"unknown location codes: {sorted(missing)}")
    return chosen
