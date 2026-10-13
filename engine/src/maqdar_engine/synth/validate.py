"""Validates a bundle against the import format: dialect, headers, types, keys, references, rules, manifest.

Driven by the contract metadata in ``importformat``: patterns, lengths, digits and bounds per column,
the row rules that compare columns of one row and the set rules over a whole file. Optional entities
may be absent and a file may leave out its optional trailing columns.
"""

from __future__ import annotations

import re
import zoneinfo
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path

import polars as pl

from .. import importformat
from .network import countries, currencies
from .writer import count_rows, read_manifest, sha256_of

MAX_HOLIDAY_DAYS = 366


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


@lru_cache(maxsize=1)
def time_zones() -> frozenset[str]:
    """IANA zone names known to this Python (tzdata on Windows); empty when none are installed."""
    return frozenset(zoneinfo.available_timezones())


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


def _empty(series: pl.Series) -> pl.Series:
    return series.is_null() | (series == "")


def _integer_part_digits(values: pl.Series) -> pl.Series:
    """Digits before the decimal point, without sign and leading zeros (values match the decimal pattern)."""
    return values.str.replace(r"^-", "").str.replace(r"\..*$", "").str.replace(r"^0+", "").str.len_chars()


def _fraction_digits(values: pl.Series) -> pl.Series:
    """Fractional digits that matter: trailing zeros do not count against the scale."""
    fraction = values.str.extract(r"\.([0-9]+)$", 1).fill_null("")
    return fraction.str.replace(r"0+$", "").str.len_chars()


def _column_findings(frame: pl.DataFrame, entity: importformat.Entity, rel: str) -> list[Finding]:
    findings: list[Finding] = []
    for column in entity.columns:
        if column.name not in frame.columns:
            continue
        series = frame[column.name]
        empty = _empty(series)
        if column.required:
            n_empty = int(empty.sum())
            if n_empty:
                findings.append(Finding(rel, "required column has empty values", column.name, n_empty))
        values = series.filter(~empty)
        if not values.len():
            continue
        if column.max_length is not None:
            too_long = int((values.str.len_chars() > column.max_length).sum())
            if too_long:
                findings.append(Finding(rel, f"values longer than {column.max_length} characters", column.name, too_long))
        bad = 0
        if column.pattern is not None:
            matches = values.str.contains(column.pattern)
            bad = int((~matches).sum())
            values = values.filter(matches)
        if column.kind == "enum":
            bad = int((~values.is_in(list(column.enum))).sum())
        elif column.kind == "date" and values.len():
            bad += int(values.str.to_date("%Y-%m-%d", strict=False).is_null().sum())
        elif column.kind == "weekdays" and values.len():
            days = values.str.split(";")
            bad += int((days.list.unique().list.len() != days.list.len()).sum())
        elif column.kind == "timezone" and values.len() and time_zones():
            bad += int((~values.is_in(sorted(time_zones() | {"UTC"}))).sum())
        if bad:
            findings.append(Finding(rel, f"values do not match type {column.type_label}", column.name, bad))
        if column.kind in importformat.NUMERIC_KINDS and values.len():
            findings.extend(_numeric_findings(values, column, rel))
    return findings


def _numeric_findings(values: pl.Series, column: importformat.Column, rel: str) -> list[Finding]:
    findings: list[Finding] = []
    too_many = int((_integer_part_digits(values) > column.integer_digits).sum())
    if too_many:
        findings.append(Finding(rel, f"more than {column.integer_digits} integer digits", column.name, too_many))
    if column.scale is not None:
        decimals = int((_fraction_digits(values) > column.scale).sum())
        if decimals:
            findings.append(Finding(rel, f"more than {column.scale} fractional digits", column.name, decimals))
    numbers = values.cast(pl.Float64, strict=False)
    outside = pl.Series([False] * numbers.len())
    if column.min_value is not None:
        outside = outside | (numbers < column.min_value)
    if column.max_value is not None:
        outside = outside | (numbers > column.max_value)
    if column.greater_than is not None:
        outside = outside | (numbers <= column.greater_than)
    n_outside = int(outside.fill_null(False).sum())
    if n_outside:
        findings.append(Finding(rel, f"values outside {column.bounds_label}", column.name, n_outside))
    return findings


def _text(frame: pl.DataFrame, name: str) -> pl.Series | None:
    """The column as text with empty cells as null, or None when the file leaves it out."""
    if name not in frame.columns:
        return None
    series = frame[name]
    return pl.Series(name, [None if v == "" else v for v in series.to_list()], dtype=pl.Utf8)


def _as_dates(series: pl.Series) -> pl.Series:
    return series.str.to_date("%Y-%m-%d", strict=False)


def _as_numbers(series: pl.Series) -> pl.Series:
    return series.cast(pl.Float64, strict=False)


def _row_rule_violations(frame: pl.DataFrame, rule: importformat.Rule) -> int:
    """Rows breaking one row rule; rules whose columns the file leaves out are skipped."""
    columns = [_text(frame, name) for name in rule.columns]
    if rule.code == "country_required":
        country, observe = columns
        if country is None:
            return 0
        observing = pl.Series([True] * frame.height) if observe is None else (observe.fill_null("true") == "true")
        return int((observing & country.is_null()).sum())
    if any(c is None for c in columns):
        return 0
    if rule.code == "must_differ":
        first, second = columns
        return int((first.is_not_null() & second.is_not_null() & (first == second)).fill_null(False).sum())
    if rule.code == "end_before_start":
        start, end = (_as_dates(c) for c in columns)
        return int((end < start).fill_null(False).sum())
    if rule.code == "holiday_too_long":
        start, end = (_as_dates(c) for c in columns)
        return int(((end - start).dt.total_days() >= MAX_HOLIDAY_DAYS).fill_null(False).sum())
    if rule.code == "p90_below_p50":
        p50, p90 = (_as_numbers(c) for c in columns)
        return int((p90 < p50).fill_null(False).sum())
    if rule.code == "scope_exactly_one":
        first, second = columns
        return int((first.is_not_null() == second.is_not_null()).sum())
    if rule.code == "freight_mismatch":
        basis, cost, currency = columns
        none = basis.fill_null("none") == "none"
        has_cost = cost.is_not_null()
        has_currency = currency.is_not_null()
        bad = (none & (has_cost | has_currency)) | (~none & (~has_cost | ~has_currency))
        return int(bad.sum())
    # date_outside_history_window depends on the database's partitions; the loader creates them.
    return 0


def _row_rule_findings(frame: pl.DataFrame, entity: importformat.Entity, rel: str) -> list[Finding]:
    findings = []
    for rule in entity.row_rules:
        broken = _row_rule_violations(frame, rule)
        if broken:
            findings.append(Finding(rel, f"rule {rule.code}: {_plain(rule.description)}", rule.column, broken))
    return findings


def _plain(description: str) -> str:
    return description.replace("`", "")


def _key_frame(frame: pl.DataFrame, entity: importformat.Entity) -> pl.DataFrame:
    """Natural-key columns; for unordered pairs the first two are sorted so (a, b) equals (b, a)."""
    keys = frame.select([pl.col(k).fill_null("") for k in entity.natural_key])
    if entity.unordered_pair:
        first, second = entity.natural_key[:2]
        in_order = pl.col(first) <= pl.col(second)
        keys = keys.with_columns(
            pl.when(in_order).then(pl.col(first)).otherwise(pl.col(second)).alias(first),
            pl.when(in_order).then(pl.col(second)).otherwise(pl.col(first)).alias(second),
        )
    return keys


def _walk_cycles(edges: dict[str, str]) -> int:
    """Nodes that lie on a cycle of a functional graph (each node has at most one successor)."""
    on_cycle: set[str] = set()
    state: dict[str, int] = {}
    for start in edges:
        path: list[str] = []
        node: str | None = start
        while node is not None and node not in state:
            state[node] = 1
            path.append(node)
            node = edges.get(node)
        if node is not None and state.get(node) == 1:
            on_cycle.update(path[path.index(node) :])
        for visited in path:
            state[visited] = 2
    return len(on_cycle)


def _set_rule_findings(frame: pl.DataFrame, entity: importformat.Entity, rel: str) -> list[Finding]:
    findings = []
    for rule in entity.set_rules:
        broken = 0
        columns = [_text(frame, name) for name in rule.columns]
        if rule.code == "preferred_conflict" and all(c is not None for c in columns):
            item, preferred = columns
            preferred_items = item.filter(preferred == "true")
            broken = preferred_items.len() - preferred_items.n_unique()
        elif rule.code in ("supersession_cycle", "location_cycle") and all(c is not None for c in columns):
            node, successor = columns
            edges = {a: b for a, b in zip(node.to_list(), successor.to_list()) if a is not None and b is not None}
            broken = _walk_cycles(edges)
        elif rule.code == "holiday_overlap" and all(c is not None for c in columns):
            country, calendar, starts, ends = columns
            scopes = [f"country:{c}" if c is not None else f"calendar:{w}" for c, w in zip(country.to_list(), calendar.to_list())]
            ranges = pl.DataFrame({"scope": scopes, "starts_on": _as_dates(starts), "ends_on": _as_dates(ends)})
            broken = _overlaps(ranges.drop_nulls().sort(["scope", "starts_on"]))
        if broken:
            findings.append(Finding(rel, f"rule {rule.code}: {_plain(rule.description)}", rule.column, broken))
    return findings


def _overlaps(ordered: pl.DataFrame) -> int:
    """Ranges that start on or before the latest end of an earlier range of the same scope."""
    count = 0
    latest: dict[str, date] = {}
    for scope, starts_on, ends_on in ordered.iter_rows():
        if scope in latest and starts_on <= latest[scope]:
            count += 1
        latest[scope] = max(latest.get(scope, ends_on), ends_on)
    return count


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
            if entity.required_in_bundle:
                findings.append(Finding(entity.file, "file missing"))
            continue
        key_frames: list[pl.DataFrame] = []
        for path in files:
            rel = path.relative_to(out_dir).as_posix()
            findings.extend(_dialect_findings(path, rel))
            try:
                frame = read_csv_text(path)
            except Exception as exc:  # noqa: BLE001 - report any parse failure as a finding
                findings.append(Finding(rel, f"cannot be parsed: {exc}"))
                continue
            if frame.columns not in entity.accepted_headers:
                findings.append(Finding(rel, f"header {frame.columns} differs from {entity.header}"))
                continue
            findings.extend(_column_findings(frame, entity, rel))
            findings.extend(_row_rule_findings(frame, entity, rel))
            if not entity.monthly_parts:
                findings.extend(_set_rule_findings(frame, entity, rel))
            key_frames.append(_key_frame(frame, entity))
            # References to other files.
            for column in entity.columns:
                if not column.references or column.name not in frame.columns:
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
        if key_frames:
            combined = pl.concat(key_frames)
            duplicates = combined.height - combined.unique().height
            if duplicates:
                findings.append(Finding(entity.file, f"duplicate natural keys ({', '.join(entity.natural_key)})", rows=duplicates))
    return findings
