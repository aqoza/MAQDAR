# MAQDAR engine

Python 3.12 service managed with [uv](https://docs.astral.sh/uv/). It will host demand classification, forecasting models, inventory policies and the worker that pulls jobs from Supabase Queues (pgmq).

```bash
uv sync            # creates .venv with the pinned Python and dev dependencies
uv run pytest
uv run maqdar-engine
```

Layout: `src/maqdar_engine` (package), `tests` (pytest), `tools` (command-line utilities such as the synthetic data generator added in Step 2).
