"""Entry point for the synthetic data generator (see docs/synthetic-data.md).

Run from the engine directory: ``uv run tools/synth.py --help`` (equivalent to ``uv run maqdar-synth``).
"""

from maqdar_engine.synth.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
