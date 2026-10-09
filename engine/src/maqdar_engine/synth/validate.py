"""Validates a bundle against the import format: dialect, headers, types, keys, references, manifest."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import polars as pl

from .. import importformat
from .network import countries, currencies
from .writer import count_rows, read_manifest, sha256_of

CODE_RE = r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$"
INTEGER_RE = r"^-?\d+$"
DATE_RE = r"^\d{4}-\d{2}-\d{2}$"
CURRENCY_RE = r"^[A-Z]{3}$"
COUNTRY_RE = r"^[A-Z]{2}$"
BOOLEAN_RE = r"^(true|false)$"


@dataclass(frozen=True)
class Finding:
    file: str
    message: str
    column: str | None = None
    rows: int | None = None

    def __str__(self) -> str:
        where = self.file + (f":{self.column}" if self.column else "")
        count = f" ({self.rows} rows)" if self.rows else ""
        return f"{where}: {self.message}{count}"


def entity_files(out_dir: Path, entity: importformat.Entity) -> list[Path]:
    if entity.monthly_parts:
        parts_dir = out_dir / entity.name
        if parts_dir.is_dir():
            return sorted(p for p in parts_dir.glob("*.csv") if re.fullmatch(r"\d{4}-\d{2}\.csv", p.name))
        single = out_dir / f"{entity.name}.csv"
        return [single] if single.exists() else []
    path = out_dir / entity.file
    return [path] if path.exists() else []


def read_csv_text(path: Path) -> pl.DataFrame:
    """Reads every column as text so the validator sees exactly what was written."""
    return pl.read_csv(path, infer_schema=False, encoding="utf8", null_values=None)


def _dialect_findings(path: Path, rel: str) -> list[Finding]:
    findings: list[Finding] = []
    with path.open("rb") as handle:
        head = handle.read(3)
        if head.startswith(b"\xef\xbb\xbf"):
            findings.append(Finding(rel, "file starts with a UTF-8 byte-order mark"))
        handle.seek(0)
        for block in iter(lambda: handle.read(1 << 20), b""):
            if b"\r" in block:
                findings.append(Finding(rel, "file contains carriage returns (expected LF line endings)"))
                break
    return findings


def _column_findings(frame: pl.DataFrame, entity: importformat.Entity, rel: str) -> list[Finding]:
    findings: list[Finding] = []
    for column in entity.columns:
        series = frame[column.name]
        empty = series.is_null() | (series == "")
        present = ~empty
        if not column.nullable:
            n_empty = int(empty.sum())
            if n_empty:
                findings.append(Finding(rel, "required column has empty values", column.name, n_empty))
        values = series.filter(present)
        bad = 0
        if column.kind == "code":
            bad = int((~values.str.contains(CODE_RE)).sum())
        elif column.kind == "integer":
            bad = int((~values.str.contains(INTEGER_RE)).sum())
        elif column.kind in ("decimal", "money"):
            bad = int((~values.str.contains(rf"^-?\d+(\.\d{{1,{column.scale}}})?$")).sum())
            if column.kind == "money" or column.name in ("quantity", "lost_sales_quantity", "pack_size", "min_order_quantity", "quantity_factor"):
                negative = int(values.str.starts_with("-").sum())
                if negative:
                    findings.append(Finding(rel, "negative values", column.name, negative))
        elif column.kind == "currency":
            bad = int((~values.str.contains(CURRENCY_RE)).sum())
        elif column.kind == "country":
            bad = int((~values.str.contains(COUNTRY_RE)).sum())
        elif column.kind == "date":
            bad = int((~values.str.contains(DATE_RE)).sum())
            if not bad and values.len():
                parsed = values.str.to_date("%Y-%m-%d", strict=False)
                bad = int(parsed.is_null().sum())
        elif column.kind == "boolean":
            bad = int((~values.str.contains(BOOLEAN_RE)).sum())
        elif column.kind == "enum":
            bad = int((~values.is_in(list(column.enum))).sum())
        if bad:
            findings.append(Finding(rel, f"values do not match type {column.type_label}", column.name, bad))
    return findings


def validate_bundle(out_dir: Path, check_sha: bool = True) -> list[Finding]:
    findings: list[Finding] = []
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.exists():
        return [Finding("manifest.json", "missing")]
    manifest = read_manifest(out_dir)
    if manifest.get("format_version") != importformat.FORMAT_VERSION:
        findings.append(Finding("manifest.json", f"format_version {manifest.get('format_version')} is not {importformat.FORMAT_VERSION}"))

    keys: dict[str, set[str]] = {
        "currencies.code": set(currencies()),
        "countries.code": set(countries()),
    }
    manifest_files = {f["path"]: f for f in manifest.get("files", [])}

    for entity in importformat.ENTITIES:
        files = entity_files(out_dir, entity)
        if not files:
            findings.append(Finding(entity.file, "file missing"))
            continue
        pk_frames: list[pl.DataFrame] = []
        for path in files:
            rel = path.relative_to(out_dir).as_posix()
            findings.extend(_dialect_findings(path, rel))
            try:
                frame = read_csv_text(path)
            except Exception as exc:  # noqa: BLE001 - report any parse failure as a finding
                findings.append(Finding(rel, f"cannot be parsed: {exc}"))
                continue
            if frame.columns != entity.header:
                findings.append(Finding(rel, f"header {frame.columns} differs from {entity.header}"))
                continue
            findings.extend(_column_findings(frame, entity, rel))
            pk_frames.append(frame.select(list(entity.natural_key)))
            # References to other files.
            for column in entity.columns:
                if not column.references:
                    continue
                ref_entity, ref_column = column.references.split(".")
                key = column.references
                if key not in keys:
                    ref_files = entity_files(out_dir, importformat.ENTITY_BY_NAME[ref_entity])
                    keys[key] = set()
                    for ref_path in ref_files:
                        keys[key].update(read_csv_text(ref_path)[ref_column].drop_nulls().to_list())
                series = frame[column.name]
                present = series.filter(series.is_not_null() & (series != ""))
                missing = int((~present.is_in(list(keys[key]))).sum()) if present.len() else 0
                if missing:
                    findings.append(Finding(rel, f"values not found in {column.references}", column.name, missing))
            if rel in manifest_files:
                entry = manifest_files[rel]
                rows = count_rows(path)
                if entry["rows"] != rows:
                    findings.append(Finding(rel, f"manifest says {entry['rows']} rows, file has {rows}"))
                if check_sha and entry["sha256"] != sha256_of(path):
                    findings.append(Finding(rel, "sha256 differs from the manifest"))
            else:
                findings.append(Finding(rel, "not listed in manifest.json"))
        if pk_frames:
            combined = pl.concat(pk_frames)
            duplicates = combined.height - combined.unique().height
            if duplicates:
                findings.append(Finding(entity.file, f"duplicate natural keys ({', '.join(entity.natural_key)})", rows=duplicates))
    return findings
