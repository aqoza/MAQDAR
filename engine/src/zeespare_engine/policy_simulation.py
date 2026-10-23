"""Recorded-sales replay of two fixed periodic-review policies; no live inventory writes."""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
import re

VERSION = "periodic-replay-v1"
ZERO = Decimal(0)
MAX_INPUT = Decimal("1e30")
METRIC_PRECISION = Decimal("0.000001")


def quantity(value: object) -> Decimal:
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,31}(\.\d{1,3})?", value):
        raise ValueError("Invalid replay quantity")
    result = Decimal(value)
    if result > MAX_INPUT:
        raise ValueError("Unsupported replay quantity")
    return result


def exact(value: Decimal) -> str:
    rendered = format(value, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def ratio(numerator: Decimal, denominator: Decimal) -> str | None:
    if not denominator:
        return None
    return exact((numerator / denominator).quantize(METRIC_PRECISION, rounding=ROUND_HALF_UP))


def replay(demand: list[dict], opening: Decimal, maximum: Decimal, lead: int, review: int) -> dict:
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
        ordered = max(maximum - position, ZERO) if reviewing else ZERO
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
                receipts=receipts, backlog_fulfilled=backlog_fulfilled,
                order_quantity=ordered, immediate_fulfilled=immediate,
                new_backlog=shortage, closing_stock=stock, closing_backlog=backlog,
                closing_on_order=sum(incoming.values(), ZERO),
            ).items()},
        ))
    totals = {
        key: sum((Decimal(row[key]) for row in ledger), ZERO)
        for key in ("demand", "lost_sales", "order_quantity", "receipts", "immediate_fulfilled", "closing_stock")
    }
    return dict(
        maximum=exact(maximum), ledger=ledger,
        metrics=dict(
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
    """Validate bounded captured inputs and return a deterministic pair of ledgers."""
    try:
        if task["kind"] != "simulation" or task["method"] != VERSION:
            raise ValueError("Unsupported replay method")
        options, policy, demand = task["options"], task["policy"], task["demand"]
        if options["history_confirmed"] is not True or options["empty_start_confirmed"] is not True:
            raise ValueError("Replay assumptions must be confirmed")
        start, end = date.fromisoformat(task["from_date"]), date.fromisoformat(task["to_date"])
        cutoff = date.fromisoformat(policy["cutoff"])
        lead, review, horizon = policy["lead_time"], policy["review_interval"], policy["horizon"]
        if (type(lead) is not int or type(review) is not int or type(horizon) is not int
            or not 0 <= lead <= 89 or not 1 <= review <= 90 or not lead + review <= horizon <= 90
            or not isinstance(policy["unit"], str) or not policy["unit"].strip()
            or start != cutoff + timedelta(days=1) or end > cutoff + timedelta(days=horizon)
            or not 1 <= len(demand) <= 90 or len(demand) != (end - start).days + 1):
            raise ValueError("Invalid replay window or policy")
        if any(row["date"] != str(start + timedelta(days=index)) for index, row in enumerate(demand)):
            raise ValueError("Replay dates must be consecutive")
        # Large policy targets and sums remain exact; only displayed ratios are rounded.
        with localcontext() as context:
            context.prec = 80
            opening = quantity(options["opening_stock"])
            maxima = (quantity(policy["maximum"]), quantity(options["alternative_maximum"]))
            variants = [dict(name=name, **replay(demand, opening, maximum, lead, review))
                        for name, maximum in zip(("baseline", "alternative"), maxima, strict=True)]
            return dict(method=VERSION, variants=variants)
    except (KeyError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("Invalid replay input") from error
