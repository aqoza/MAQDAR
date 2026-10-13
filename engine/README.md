# MAQDAR engine

Python 3.12 service managed with [uv](https://docs.astral.sh/uv/). It hosts the synthetic data generator today and will host demand classification, forecasting models, inventory policies and the worker that pulls jobs from Supabase Queues (pgmq).

```bash
uv sync                                   # .venv with the pinned Python and dependencies
uv run pytest                             # fast suite (statistical tests included)
MAQDAR_TEST_DSN=postgresql://postgres:postgres@127.0.0.1:54322/postgres uv run pytest -m db
uv run maqdar-synth all --preset small    # generate, validate and load into the local stack
uv run tools/synth.py --help              # same CLI through the script path
uv run maqdar-synth format --markdown --write  # regenerate the tables in docs/import-format.md (then run prettier on it)
uv run maqdar-synth format --json --write      # docs/import-format.schema.json and its packages/shared copy
uv run maqdar-synth format --sql               # ingest.contract_* seed, pasted into the import wizard migration
```

Layout: `src/maqdar_engine` (package: `importformat.py` is the CSV contract, `synth/` the generator and loader, `synth/data/` the curated reference tables), `tests` (pytest), `tools` (command-line entry points), `data/` (generated bundles, gitignored).

See `docs/synthetic-data.md` for the demand model and presets and `docs/import-format.md` for the CSV contract.
