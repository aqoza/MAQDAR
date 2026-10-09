from pathlib import Path

from maqdar_engine import importformat
from maqdar_engine.synth.network import countries, currencies

from conftest import REPO_ROOT

DOC = REPO_ROOT / "docs" / "import-format.md"
SCHEMA = REPO_ROOT / "docs" / "import-format.schema.json"
BEGIN = "<!-- import-format:begin -->"
END = "<!-- import-format:end -->"


def test_every_money_column_has_a_currency_sibling():
    for entity in importformat.ENTITIES:
        kinds = {c.kind for c in entity.columns}
        if "money" in kinds:
            assert "currency" in kinds, entity.name


def test_references_resolve():
    for entity, column in importformat.iter_references():
        ref_entity, ref_column = column.references.split(".")
        if ref_entity == "currencies":
            assert ref_column == "code" and currencies()
        elif ref_entity == "countries":
            assert ref_column == "code" and countries()
        else:
            target = importformat.ENTITY_BY_NAME[ref_entity]
            assert ref_column in target.header, (entity.name, column.name)


def test_lookup_columns_name_their_target():
    for entity in importformat.ENTITIES:
        for column in entity.columns:
            if column.lookup:
                assert column.db_column and column.db_column.endswith("_id"), (entity.name, column.name)
                assert column.lookup in importformat.ENTITY_BY_NAME


def test_natural_keys_are_first_columns():
    for entity in importformat.ENTITIES:
        assert entity.natural_key[0] == entity.columns[0].name


def test_markdown_lists_every_file():
    text = importformat.to_markdown()
    for entity in importformat.ENTITIES:
        assert f"`{entity.file}`" in text
        for column in entity.columns:
            assert f"`{column.name}`" in text


def test_schema_json_is_current():
    assert SCHEMA.read_text(encoding="utf-8") == importformat.to_json(), (
        "docs/import-format.schema.json is stale: run `uv run maqdar-synth format --json > ../docs/import-format.schema.json`"
    )


def test_docs_import_format_is_current():
    """docs/import-format.md embeds the generated column tables between markers; prettier may realign them."""
    text = DOC.read_text(encoding="utf-8")
    assert BEGIN in text and END in text, "markers missing from docs/import-format.md"
    embedded = text[text.index(BEGIN) + len(BEGIN) : text.index(END)]
    assert importformat.normalise_markdown(embedded) == importformat.normalise_markdown(importformat.to_markdown()), (
        "docs/import-format.md is stale: run `uv run maqdar-synth format --markdown` and paste between the markers"
    )
