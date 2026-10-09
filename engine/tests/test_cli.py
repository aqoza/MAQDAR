from pathlib import Path

import pytest

from maqdar_engine.synth.cli import main
from maqdar_engine.synth.reference_sql import BEGIN_MARK


@pytest.mark.parametrize("args", [["--help"], ["generate", "--help"], ["validate", "--help"], ["load", "--help"], ["all", "--help"]])
def test_help_exits_zero(args: list[str], capsys):
    with pytest.raises(SystemExit) as excinfo:
        main(args)
    assert excinfo.value.code == 0


def test_generate_then_validate(tmp_path: Path):
    out = tmp_path / "bundle"
    assert main(["generate", "--preset", "tiny", "--out", str(out)]) == 0
    assert main(["validate", str(out)]) == 0
    with pytest.raises(FileExistsError):
        main(["generate", "--preset", "tiny", "--out", str(out)])
    assert main(["generate", "--preset", "tiny", "--out", str(out), "--force"]) == 0


def test_validate_reports_problems(tmp_path: Path, capsys):
    out = tmp_path / "bundle"
    assert main(["generate", "--preset", "tiny", "--out", str(out)]) == 0
    suppliers = out / "suppliers.csv"
    text = suppliers.read_text(encoding="utf-8").replace("true", "maybe", 1)
    suppliers.write_text(text, encoding="utf-8")
    assert main(["validate", str(out), "--no-sha"]) == 1
    captured = capsys.readouterr()
    assert "is_active" in captured.err


def test_format_and_reference_sql(capsys):
    assert main(["format", "--markdown"]) == 0
    assert "`items.csv`" in capsys.readouterr().out
    assert main(["emit-reference-sql"]) == 0
    assert BEGIN_MARK in capsys.readouterr().out


def test_load_refuses_remote_dsn(tmp_path: Path, capsys):
    out = tmp_path / "bundle"
    assert main(["generate", "--preset", "tiny", "--out", str(out)]) == 0
    code = main(["load", str(out), "--dsn", "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", "--skip-validate"])
    assert code == 2
    assert "refused" in capsys.readouterr().err
