# ZeeSpare engine

Python 3.12 service managed with [uv](https://docs.astral.sh/uv/). It hosts the synthetic data generator and a durable readiness, classification, forecast and demand-preparation worker on pgmq. See [forecast-baselines.md](../docs/forecast-baselines.md) for models and evaluation. See [forecast-expansion.md](../docs/forecast-expansion.md) for bounded automatic ETS/ARIMA, bootstrap bands, separate historical coverage, and process limits. See [demand-preparation.md](../docs/demand-preparation.md) for cutoff-based part grouping, exact source contributions and calendar evidence. See [prepared-forecasts.md](../docs/prepared-forecasts.md) for saved-group forecasts, learned weekday/regional effects and fixed-group comparisons. Inventory policies follow in a later step. See [demand-classification.md](../docs/demand-classification.md) for the versioned daily method. See [planning-runs.md](../docs/planning-runs.md) for worker setup, retries and the owner-run rollout.

```bash
uv sync                                   # .venv with the pinned Python and dependencies
uv run pytest                             # fast suite (statistical tests included)
ZEESPARE_TEST_DSN=postgresql://postgres:postgres@127.0.0.1:54322/postgres uv run pytest -m db
uv run zeespare-synth all --preset small    # generate, validate and load into the local stack
uv run tools/synth.py --help              # same CLI through the script path
uv run zeespare-synth format --markdown --write  # regenerate the tables in docs/import-format.md (then run prettier on it)
uv run zeespare-synth format --json --write      # docs/import-format.schema.json and its packages/shared copy
uv run zeespare-synth format --sql               # ingest.contract_* seed, pasted into the import wizard migration
```

Layout: `src/zeespare_engine` (package: `importformat.py` is the CSV contract, `synth/` the generator and loader, `synth/data/` the curated reference tables), `tests` (pytest), `tools` (command-line entry points), `data/` (generated bundles, gitignored).

See `docs/synthetic-data.md` for the demand model and presets and `docs/import-format.md` for the CSV contract.

Step 11 adds `policy-v1` recommendations from one saved forecast. The worker replays the selected model on its saved rolling windows, samples total demand over lead time and the review protection period, and publishes immutable evidence through `policy_finish`. See [inventory policies](../docs/inventory-policies.md). Upgrade the local/hosted schema before starting the new worker; hosted rollout remains owner-run.
