"""ZeeSpare planning engine.

The pgmq readiness worker lives in worker.py; later steps add models and policies.
"""

__version__ = "0.1.0"


def main() -> None:
    """Entry point for the `zeespare-engine` console script."""
    print(f"zeespare-engine {__version__}")
