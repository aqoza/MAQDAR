"""Command-line interface: generate | validate | load | all | format | emit-reference-sql."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from .. import importformat
from .presets import PRESETS, Preset

ENGINE_DIR = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = ENGINE_DIR / "data"


def resolve_preset(args: argparse.Namespace) -> Preset:
    preset = PRESETS[args.preset]
    overrides: dict[str, object] = {}
    if getattr(args, "seed", None) is not None:
        overrides["seed"] = args.seed
    if getattr(args, "months", None) is not None:
        overrides["months"] = args.months
    if getattr(args, "density", None) is not None:
        overrides["density"] = args.density
    if getattr(args, "items", None) is not None:
        overrides["items"] = args.items
    return preset.with_overrides(**overrides) if overrides else preset


def default_out(preset_name: str) -> Path:
    return DEFAULT_DATA_DIR / preset_name


def add_preset_arguments(parser: argparse.ArgumentParser, with_generation: bool) -> None:
    parser.add_argument("--preset", choices=sorted(PRESETS), default="small")
    parser.add_argument("--out", type=Path, help="bundle directory (default engine/data/<preset>)")
    if with_generation:
        parser.add_argument("--seed", type=int, help="override the preset seed")
        parser.add_argument("--months", type=int, help="trim the window to the last N months")
        parser.add_argument("--density", type=float, help="scale demand occurrence (large preset default 0.5)")
        parser.add_argument("--items", type=int, help="override the item count")
        parser.add_argument("--force", action="store_true", help="overwrite an existing bundle")


def add_load_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dsn", default=None, help="local stack DSN (default: the URL `supabase start` prints)")
    parser.add_argument("--replace", action="store_true", help="delete the synthetic organization first")
    parser.add_argument("--member-email", help="grant an existing auth user owner membership of the synthetic organization")
    parser.add_argument("--skip-validate", action="store_true", help="skip bundle validation before loading")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="maqdar-synth", description="MAQDAR synthetic data generator and local loader.")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="write a CSV bundle")
    add_preset_arguments(gen, with_generation=True)

    val = sub.add_parser("validate", help="validate a bundle against the import format")
    val.add_argument("dir", type=Path)
    val.add_argument("--no-sha", action="store_true", help="skip checksum verification")

    load = sub.add_parser("load", help="load a bundle into the local Supabase stack")
    load.add_argument("dir", type=Path, nargs="?", help="bundle directory (default engine/data/<preset>)")
    load.add_argument("--preset", choices=sorted(PRESETS), default="small")
    add_load_arguments(load)

    both = sub.add_parser("all", help="generate, validate and load in one go")
    add_preset_arguments(both, with_generation=True)
    add_load_arguments(both)
    both.add_argument("--no-load", action="store_true", help="generate and validate only")

    fmt = sub.add_parser("format", help="print the import format")
    fmt.add_argument("--markdown", action="store_true", help="print the column tables as Markdown (default)")
    fmt.add_argument("--json", action="store_true", help="print the machine-readable contract as JSON")

    sub.add_parser("emit-reference-sql", help="print the reference-data INSERT block for the migration")
    return parser


def cmd_generate(args: argparse.Namespace) -> int:
    from .generate import generate

    preset = resolve_preset(args)
    out = args.out or default_out(preset.name)
    started = time.perf_counter()
    generate(preset, out, force=args.force, progress=_log)
    _log(f"generated {out} in {time.perf_counter() - started:.1f}s")
    return 0


def cmd_validate(path: Path, check_sha: bool) -> int:
    from .validate import validate_bundle

    findings = validate_bundle(path, check_sha=check_sha)
    if findings:
        for finding in findings:
            print(f"invalid: {finding}", file=sys.stderr)
        print(f"{len(findings)} problem(s) in {path}", file=sys.stderr)
        return 1
    _log(f"valid bundle: {path}")
    return 0


def cmd_load(path: Path, args: argparse.Namespace) -> int:
    from .loader import DEFAULT_DSN, LoaderRefused, load_bundle

    if not args.skip_validate:
        code = cmd_validate(path, check_sha=True)
        if code:
            return code
    started = time.perf_counter()
    try:
        report = load_bundle(path, dsn=args.dsn or DEFAULT_DSN, replace=args.replace, member_email=args.member_email, progress=_log)
    except LoaderRefused as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    total = sum(report.rows.values())
    _log(f"loaded {total:,} rows for organization {report.organization_id} in {time.perf_counter() - started:.1f}s")
    return 0


def _log(message: str) -> None:
    print(message, flush=True)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "generate":
        return cmd_generate(args)
    if args.command == "validate":
        return cmd_validate(args.dir, check_sha=not args.no_sha)
    if args.command == "load":
        return cmd_load(args.dir or default_out(args.preset), args)
    if args.command == "all":
        preset = resolve_preset(args)
        out = args.out or default_out(preset.name)
        code = cmd_generate(args)
        if code:
            return code
        code = cmd_validate(out, check_sha=True)
        if code or args.no_load:
            return code
        args.skip_validate = True
        return cmd_load(out, args)
    if args.command == "format":
        sys.stdout.write(importformat.to_json() if args.json else importformat.to_markdown())
        return 0
    if args.command == "emit-reference-sql":
        from .reference_sql import render_with_marks

        sys.stdout.write(render_with_marks())
        return 0
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
