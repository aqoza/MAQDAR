"""CSV, truth and manifest writing for a generated bundle."""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import IO, Iterable, Sequence

import numpy as np
import polars as pl

from .. import importformat
from . import GENERATOR_VERSION
from .presets import Preset

EPOCH = date(1970, 1, 1)


def format_decimal(value: Decimal | int | float, scale: int = 3) -> str:
    """Fixed-point text with at most ``scale`` fractional digits and no exponent."""
    if isinstance(value, Decimal):
        text = format(value, "f")
    elif isinstance(value, int):
        return str(value)
    else:
        text = format(Decimal(str(value)).quantize(Decimal(1).scaleb(-scale)), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def format_bool(value: bool) -> str:
    return "true" if value else "false"


def write_table(path: Path, header: Sequence[str], rows: Iterable[Sequence[object]]) -> int:
    """Writes a small table with the import-format dialect. Returns the row count."""
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(header)
        for row in rows:
            writer.writerow(["" if v is None else v for v in row])
            count += 1
    return count


class DemandPartWriter:
    """Appends demand batches to monthly part files, keeping each part's header exactly once."""

    def __init__(self, out_dir: Path, window_start: date, item_codes: Sequence[str], location_codes: Sequence[str]) -> None:
        self.dir = out_dir / "demand_history"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.window_start = window_start
        self.epoch_offset = (window_start - EPOCH).days
        self.item_codes = np.asarray(item_codes, dtype=object)
        self.location_codes = np.asarray(location_codes, dtype=object)
        self._handles: dict[str, IO[bytes]] = {}
        self.rows_per_part: dict[str, int] = {}
        self.header = importformat.ENTITY_BY_NAME["demand_history"].header

    def _handle(self, part: str) -> IO[bytes]:
        if part not in self._handles:
            self._handles[part] = (self.dir / f"{part}.csv").open("wb")
            self.rows_per_part[part] = 0
        return self._handles[part]

    def append(self, item_index: np.ndarray, location_index: np.ndarray, day_index: np.ndarray, quantity: np.ndarray, lost: np.ndarray) -> None:
        if item_index.size == 0:
            return
        epoch_days = day_index.astype(np.int32) + self.epoch_offset
        frame = pl.DataFrame(
            {
                "item_code": pl.Series(self.item_codes[item_index].tolist(), dtype=pl.Utf8),
                "location_code": pl.Series(self.location_codes[location_index].tolist(), dtype=pl.Utf8),
                "demand_date": pl.Series(epoch_days, dtype=pl.Int32).cast(pl.Date),
                "quantity": pl.Series(quantity, dtype=pl.Int32),
                "lost_sales_quantity": pl.Series(lost, dtype=pl.Int32),
            }
        ).select(self.header)
        part_key = frame["demand_date"].dt.strftime("%Y-%m")
        for part in part_key.unique(maintain_order=True).to_list():
            chunk = frame.filter(part_key == part)
            handle = self._handle(part)
            chunk.write_csv(
                handle,
                include_header=self.rows_per_part[part] == 0,
                line_terminator="\n",
                date_format="%Y-%m-%d",
                quote_style="necessary",
            )
            self.rows_per_part[part] += chunk.height

    def close(self) -> list[Path]:
        for handle in self._handles.values():
            handle.close()
        return [self.dir / f"{part}.csv" for part in sorted(self._handles)]


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def count_rows(path: Path) -> int:
    with path.open("rb") as handle:
        lines = sum(block.count(b"\n") for block in iter(lambda: handle.read(1 << 20), b""))
    return max(lines - 1, 0)


@dataclass
class ManifestFile:
    path: str
    rows: int
    bytes: int
    sha256: str


@dataclass
class Manifest:
    preset: str
    seed: int
    window_start: date
    window_end: date
    density: float
    organization_id: str
    organization_slug: str
    organization_name: str
    files: list[ManifestFile] = field(default_factory=list)
    generated_at: str = ""
    numpy_version: str = ""
    polars_version: str = ""

    def to_json(self) -> dict:
        return {
            "format_version": importformat.FORMAT_VERSION,
            "generator_version": GENERATOR_VERSION,
            "preset": self.preset,
            "seed": self.seed,
            "window_start": self.window_start.isoformat(),
            "window_end": self.window_end.isoformat(),
            "density": self.density,
            "organization": {
                "id": self.organization_id,
                "slug": self.organization_slug,
                "name": self.organization_name,
                "base_currency": "SAR",
                "home_country": "SA",
            },
            "generated_at": self.generated_at,
            "versions": {"numpy": self.numpy_version, "polars": self.polars_version},
            "files": [f.__dict__ for f in self.files],
        }


def build_manifest(preset: Preset, out_dir: Path, files: Sequence[Path]) -> Manifest:
    manifest = Manifest(
        preset=preset.name,
        seed=preset.seed,
        window_start=preset.window_start,
        window_end=preset.window_end,
        density=preset.density,
        organization_id=str(preset.organization_id),
        organization_slug=preset.organization_slug,
        organization_name=preset.organization_name,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        numpy_version=np.__version__,
        polars_version=pl.__version__,
    )
    for path in files:
        manifest.files.append(
            ManifestFile(
                path=path.relative_to(out_dir).as_posix(),
                rows=count_rows(path),
                bytes=path.stat().st_size,
                sha256=sha256_of(path),
            )
        )
    return manifest


def write_manifest(out_dir: Path, manifest: Manifest) -> Path:
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(manifest.to_json(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return path


def read_manifest(out_dir: Path) -> dict:
    return json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
