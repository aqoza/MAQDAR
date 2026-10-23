from pathlib import Path

import pytest

from zeespare_engine import importformat
from zeespare_engine.synth import cli
from zeespare_engine.synth.cli import main
from zeespare_engine.synth.reference_sql import BEGIN_MARK


def test_format_sql_prints_the_marked_seed(capsys):
    assert main(["format", "--sql"]) == 0
    assert capsys.readouterr().out == importformat.to_sql_with_marks()
    assert main(["format", "--sql", "--write"]) == 2


def test_format_json_prints_the_contract(capsys):
    assert main(["format", "--json"]) == 0
    assert capsys.readouterr().out == importformat.to_json()


def test_format_write_updates_the_files(tmp_path: Path, monkeypatch):
    doc = tmp_path / "docs" / "import-format.md"
    doc.parent.mkdir()
    doc.write_text(f"# Title\n\n{cli.DOC_BEGIN}\nstale\n{cli.DOC_END}\n\n## After\n", encoding="utf-8")
    schemas = (tmp_path / "docs" / "import-format.schema.json", tmp_path / "shared" / "src" / "import-format.schema.json")
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(cli, "FORMAT_DOC", doc)
    monkeypatch.setattr(cli, "SCHEMA_FILES", schemas)

    assert main(["format", "--json", "--write"]) == 0
    for path in schemas:
        assert path.read_bytes() == importformat.to_json().encode("utf-8")

    assert main(["format", "--markdown", "--write"]) == 0
    text = doc.read_bytes().decode("utf-8")
    assert "\r" not in text and "stale" not in text
    assert text == f"# Title\n\n{cli.DOC_BEGIN}\n\n{importformat.to_markdown()}\n{cli.DOC_END}\n\n## After\n"


def test_format_options_are_exclusive(capsys):
    with pytest.raises(SystemExit):
        main(["format", "--json", "--sql"])


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
