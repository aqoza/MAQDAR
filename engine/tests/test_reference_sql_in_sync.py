from maqdar_engine.synth.reference_sql import BEGIN_MARK, END_MARK, emit, extract_generated_block

from conftest import REPO_ROOT

MIGRATION = next((REPO_ROOT / "supabase" / "migrations").glob("*_reference_data.sql"))


def test_reference_data_migration_matches_package_data():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert BEGIN_MARK in sql and END_MARK in sql
    assert extract_generated_block(sql) == emit(), (
        "reference_data migration is stale: run `uv run maqdar-synth emit-reference-sql` and replace the generated block"
    )


def test_emitted_sql_quotes_apostrophes():
    sql = emit()
    assert "Sha''ban" in sql
    assert "\n  ('OM', '2026-01-15', 'Accession Day (observed)'" in sql
