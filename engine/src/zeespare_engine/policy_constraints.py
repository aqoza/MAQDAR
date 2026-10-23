"""Versioned MOQ/pack what-if replay; original replay remains unchanged."""
from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING, localcontext
import re

from zeespare_engine.policy_simulation import calculate as calculate_original, exact, quantity, ratio, ZERO

VERSION = "periodic-constraints-v1"


def constraint_quantity(value: object) -> Decimal:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,15}(\.[0-9]{1,3})?", value):
        raise ValueError("Invalid constraint quantity")
    result = quantity(value)
    if exact(result) != value:
        raise ValueError("Constraint must be canonical")
    return result


def rounded_order(gap: Decimal, moq: Decimal, pack: Decimal) -> Decimal:
    # Never trigger an order merely to satisfy an MOQ when the gap is zero.
    return (max(gap, moq) / pack).to_integral_value(rounding=ROUND_CEILING) * pack if gap else ZERO


def replay(demand: list[dict], opening: Decimal, maximum: Decimal, lead: int, review: int, moq: Decimal, pack: Decimal) -> dict:
    stock, backlog = opening, ZERO
    incoming: dict[date, Decimal] = {}
    ledger = []
    for index, observation in enumerate(demand):
        day = date.fromisoformat(observation["date"])
        sold = quantity(observation["quantity"])
        lost = quantity(observation["lost_sales_quantity"])
        opening_stock = stock
        receipts = incoming.pop(day, ZERO)
        stock += receipts
        backlog_fulfilled = min(stock, backlog)
        stock -= backlog_fulfilled
        backlog -= backlog_fulfilled
        reviewing = index % review == 0
        position = stock + sum(incoming.values(), ZERO) - backlog
        gap = max(maximum - position, ZERO) if reviewing else ZERO
        ordered = rounded_order(gap, moq, pack)
        due = day + timedelta(days=lead) if ordered else None
        if ordered:
            if lead:
                incoming[due] = incoming.get(due, ZERO) + ordered
            else:
                # Zero lead arrives during this review, before today's demand.
                receipts += ordered
                stock += ordered
                cleared = min(stock, backlog)
                stock -= cleared
                backlog -= cleared
                backlog_fulfilled += cleared
        immediate = min(stock, sold)
        stock -= immediate
        shortage = sold - immediate
        backlog += shortage
        ledger.append(dict(
            date=str(day), review=reviewing, order_due=str(due) if due else None,
            **{key: exact(value) for key, value in dict(
                demand=sold, lost_sales=lost, opening_stock=opening_stock,
                order_gap=gap, rounding_extra=ordered-gap,
                receipts=receipts, backlog_fulfilled=backlog_fulfilled,
                order_quantity=ordered, immediate_fulfilled=immediate,
                new_backlog=shortage, closing_stock=stock, closing_backlog=backlog,
                closing_on_order=sum(incoming.values(), ZERO),
            ).items()},
        ))
    totals = {
        key: sum((Decimal(row[key]) for row in ledger), ZERO)
        for key in ("demand", "lost_sales", "order_quantity", "receipts", "immediate_fulfilled", "closing_stock", "rounding_extra")
    }
    return dict(
        maximum=exact(maximum), ledger=ledger,
        metrics=dict(
            rounding_extra_quantity=exact(totals["rounding_extra"]),
            days=len(ledger), order_count=sum(Decimal(row["order_quantity"]) > 0 for row in ledger),
            backlog_days=sum(Decimal(row["closing_backlog"]) > 0 for row in ledger),
            sold_quantity=exact(totals["demand"]), lost_sales_quantity=exact(totals["lost_sales"]),
            ordered_quantity=exact(totals["order_quantity"]), received_quantity=exact(totals["receipts"]),
            immediate_fulfilled=exact(totals["immediate_fulfilled"]),
            closing_stock_sum=exact(totals["closing_stock"]),
            average_closing_stock=ratio(totals["closing_stock"], Decimal(len(ledger))),
            immediate_fill_rate=ratio(totals["immediate_fulfilled"], totals["demand"]),
            ending_stock=exact(stock), ending_backlog=exact(backlog),
            ending_on_order=exact(sum(incoming.values(), ZERO)),
        ),
    )


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
            if (not isinstance(config, dict) or set(config) != {"maximum", "lead_time", "review_interval", "moq", "pack"}
                or not isinstance(config["maximum"], str)
                or not re.fullmatch(r"[0-9]{1,15}(\.[0-9]{1,3})?", config["maximum"])
                or type(config["lead_time"]) is not int or not 0 <= config["lead_time"] <= 365
                or type(config["review_interval"]) is not int or not 1 <= config["review_interval"] <= 365):
                raise ValueError("Invalid configuration")
            maximum = quantity(config["maximum"])
            if exact(maximum) != config["maximum"]:
                raise ValueError("Maximum must be canonical")
            moq, pack = (constraint_quantity(config[key]) for key in ("moq", "pack"))
            if not pack:
                raise ValueError("Pack must be positive")
            keys.append((maximum, config["lead_time"], config["review_interval"], moq, pack))
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
                             review_interval=policy["review_interval"], moq=None, pack=None)] + [
                dict(name=f"alternative-{index + 1}", lead_time=lead, review_interval=review, moq=exact(moq), pack=exact(pack),
                     **replay(task["demand"], quantity(options["opening_stock"]), maximum, lead, review, moq, pack))
                for index, (maximum, lead, review, moq, pack) in enumerate(keys)
            ]
        return dict(method=VERSION, variants=variants)
    except (KeyError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("Invalid configuration evidence") from error
