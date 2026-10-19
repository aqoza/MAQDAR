"""Compare explicit maxima against a previously captured recorded-sales replay."""
from decimal import localcontext
import re

from maqdar_engine.policy_simulation import calculate as calculate_original, exact, quantity, replay

VERSION = "periodic-sensitivity-v1"


def calculate(task: dict) -> dict:
    try:
        options = task["options"]
        original = task["source_simulation"]["evidence"]
        maxima = options["alternative_maxima"]
        if (task["kind"] != "simulation" or task["method"] != VERSION
            or options["reuse_confirmed"] is not True
            or not isinstance(maxima, list) or not 1 <= len(maxima) <= 10
            or any(not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,15}(\.[0-9]{1,3})?", value) for value in maxima)):
            raise ValueError("Invalid sensitivity inputs")
        normalized = sorted({quantity(value) for value in maxima})
        if len(normalized) != len(maxima) or maxima != [exact(value) for value in normalized]:
            raise ValueError("Alternatives must be distinct and canonical")
        if any(task[key] != original[key] for key in ("from_date", "to_date", "policy", "demand")):
            raise ValueError("Captured evidence must remain fixed")
        if any(options[key] != original["options"][key] for key in (
            "opening_stock", "history_confirmed", "empty_start_confirmed",
        )):
            raise ValueError("Starting assumptions must remain fixed")
        previous = calculate_original(original)
        if previous != original["output"]:
            raise ValueError("Source replay does not reproduce saved results")
        with localcontext() as context:
            context.prec = 80
            policy = task["policy"]
            variants = [previous["variants"][0]] + [
                dict(name=f"alternative-{index + 1}", **replay(
                    task["demand"], quantity(options["opening_stock"]), maximum,
                    policy["lead_time"], policy["review_interval"],
                )) for index, maximum in enumerate(normalized)
            ]
        return dict(method=VERSION, variants=variants)
    except (KeyError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("Invalid sensitivity evidence") from error
