"""MAQDAR planning engine.

The pgmq readiness worker lives in worker.py; later steps add models and policies.
"""

__version__ = "0.1.0"


def main() -> None:
    """Entry point for the `maqdar-engine` console script."""
    print(f"maqdar-engine {__version__}")
