# MAQDAR engine

Python 3.12 service managed with [uv](https://docs.astral.sh/uv/). It hosts the synthetic data generator and a durable readiness, classification and forecast worker on pgmq. See [forecast-baselines.md](../docs/forecast-baselines.md) for models and evaluation. See [forecast-expansion.md](../docs/forecast-expansion.md) for bounded automatic ETS/ARIMA, bootstrap bands, separate historical coverage, and process limits. Later steps add regional effects and inventory policies. See [demand-classification.md](../docs/demand-classification.md) for the versioned daily method. See [planning-runs.md](../docs/planning-runs.md) for worker setup, retries and the owner-run rollout.

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
