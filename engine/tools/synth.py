"""Entry point for the synthetic data generator (see docs/synthetic-data.md).

Run from the engine directory: ``uv run tools/synth.py --help`` (equivalent to ``uv run zeespare-synth``).
"""

from zeespare_engine.synth.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
