"""Replay captured sales under explicit what-if policy configurations."""
from decimal import localcontext
import re

from zeespare_engine.policy_simulation import calculate as calculate_original, exact, quantity, replay

VERSION = "periodic-configurations-v1"


def calculate(task: dict) -> dict:
    try:
        options = task["options"]
        original = task["source_simulation"]["evidence"]
        configurations = options["configurations"]
        if (task["kind"] != "simulation" or task["method"] != VERSION
            or options["reuse_confirmed"] is not True
            or not isinstance(configurations, list) or not 1 <= len(configurations) <= 10):
            raise ValueError("Invalid configuration inputs")
        keys = []
        for config in configurations:
            if (not isinstance(config, dict) or set(config) != {"maximum", "lead_time", "review_interval"}
                or not isinstance(config["maximum"], str)
                or not re.fullmatch(r"[0-9]{1,15}(\.[0-9]{1,3})?", config["maximum"])
                or type(config["lead_time"]) is not int or not 0 <= config["lead_time"] <= 365
                or type(config["review_interval"]) is not int or not 1 <= config["review_interval"] <= 365):
                raise ValueError("Invalid configuration")
            maximum = quantity(config["maximum"])
            if exact(maximum) != config["maximum"]:
                raise ValueError("Maximum must be canonical")
            keys.append((maximum, config["lead_time"], config["review_interval"]))
        if keys != sorted(set(keys)):
            raise ValueError("Configurations must be distinct and canonical")
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
            policy = original["policy"]
            variants = [dict(previous["variants"][0], lead_time=policy["lead_time"],
                             review_interval=policy["review_interval"])] + [
                dict(name=f"alternative-{index + 1}", lead_time=lead, review_interval=review,
                     **replay(task["demand"], quantity(options["opening_stock"]), maximum, lead, review))
                for index, (maximum, lead, review) in enumerate(keys)
            ]
        return dict(method=VERSION, variants=variants)
    except (KeyError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("Invalid configuration evidence") from error
