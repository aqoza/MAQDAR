from __future__ import annotations

import os
from pathlib import Path

import polars as pl
import pytest

from maqdar_engine.synth.generate import generate
from maqdar_engine.synth.presets import PRESETS

REPO_ROOT = Path(__file__).resolve().parents[2]


def _quiet(_: str) -> None:
    pass


@pytest.fixture(scope="session")
def tiny_bundle(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("tiny")
    generate(PRESETS["tiny"], out, force=True, progress=_quiet)
    return out


@pytest.fixture(scope="session")
def medium_bundle(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("medium")
    generate(PRESETS["medium"], out, force=True, progress=_quiet)
    return out


def read_bundle(bundle: Path) -> dict[str, pl.DataFrame]:
    """Reads a bundle into typed polars frames (demand parts concatenated)."""
    parts = sorted((bundle / "demand_history").glob("*.csv"))
    demand = pl.concat([pl.read_csv(p, schema_overrides={"demand_date": pl.Date}) for p in parts])
    return {
        "locations": pl.read_csv(bundle / "locations.csv"),
        "items": pl.read_csv(bundle / "items.csv", schema_overrides={"introduced_on": pl.Date, "discontinued_on": pl.Date}),
        "item_supersessions": pl.read_csv(bundle / "item_supersessions.csv", schema_overrides={"effective_on": pl.Date}),
        "suppliers": pl.read_csv(bundle / "suppliers.csv"),
        "supplier_items": pl.read_csv(bundle / "supplier_items.csv"),
        "demand": demand,
        "truth_items": pl.read_csv(bundle / "_truth" / "items.csv"),
        "truth_pairs": pl.read_csv(bundle / "_truth" / "pairs.csv"),
    }


@pytest.fixture(scope="session")
def tiny(tiny_bundle: Path) -> dict[str, pl.DataFrame]:
    return read_bundle(tiny_bundle)


@pytest.fixture(scope="session")
def medium(medium_bundle: Path) -> dict[str, pl.DataFrame]:
    return read_bundle(medium_bundle)


@pytest.fixture(scope="session")
def dsn() -> str:
    value = os.environ.get("MAQDAR_TEST_DSN")
    if not value:
        pytest.skip("set MAQDAR_TEST_DSN to the local stack DSN to run database tests")
    return value
