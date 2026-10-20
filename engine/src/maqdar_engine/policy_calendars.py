"""Calendar replay over captured working-day evidence; never reads live calendars."""
from datetime import date, timedelta
from decimal import Decimal, localcontext

from maqdar_engine.policy_constraints import calculate as constraints_calculate, rounded_order
from maqdar_engine.policy_simulation import exact, quantity, ratio, ZERO

VERSION = "periodic-calendars-v1"
SEARCH_DAYS = 90


def next_day(days: dict, start: date, end: date | None = None) -> dict:
    """An unknown date cannot be skipped to claim an earliest working date."""
    checked = None
    for offset in range(SEARCH_DAYS):
        day = start + timedelta(days=offset)
        if end is not None and day > end:
            return dict(status="outside_window", date=None, checked_through=checked)
        key = str(day)
        fact = days[key]
        if fact["date"] != key or type(fact["working"]) not in (bool, type(None)):
            raise ValueError("Invalid captured calendar day")
        checked = key
        if fact["working"] is None:
            return dict(status="calendar_unknown", date=None, checked_through=checked)
        if fact["working"]:
            return dict(status="resolved", date=key, checked_through=checked)
    return dict(status="search_exhausted", date=None, checked_through=checked)


def review_schedule(task: dict, review: int) -> tuple[list[dict], dict | None]:
    start, end = (date.fromisoformat(task[key]) for key in ("from_date", "to_date"))
    schedule = []
    for index in range(0, len(task["demand"]), review):
        nominal = start + timedelta(days=index)
        search = next_day(task["calendars"]["ordering_days"], nominal, end)
        schedule.append(dict(nominal_date=str(nominal), **search))
        if search["status"] not in ("resolved", "outside_window"):
            return schedule, dict(stage="ordering", nominal_date=str(nominal), **search)
    return schedule, None


def replay(task: dict, config: dict) -> tuple[dict | None, dict | None]:
    schedule, failure = review_schedule(task, config["review_interval"])
    if failure:
        return None, failure
    scheduled = {}
    for entry in schedule:
        if entry["date"]:
            scheduled.setdefault(entry["date"], []).append(entry["nominal_date"])
    stock, backlog = quantity(task["options"]["opening_stock"]), ZERO
    incoming: dict[str, Decimal] = {}
    ledger = []
    maximum, moq, pack = (quantity(config[key]) for key in ("maximum", "moq", "pack"))
    for observation in task["demand"]:
        key = observation["date"]
        day = date.fromisoformat(key)
        opening = stock
        receipts = incoming.pop(key, ZERO)
        stock += receipts
        cleared = min(stock, backlog)
        stock -= cleared
        backlog -= cleared
        nominal_reviews = scheduled.get(key, [])
        gap = max(maximum - (stock + sum(incoming.values(), ZERO) - backlog), ZERO) if nominal_reviews else ZERO
        ordered = rounded_order(gap, moq, pack)
        nominal_receipt, due, search = None, None, None
        if ordered:
            nominal_receipt = str(day + timedelta(days=config["lead_time"]))
            search = next_day(task["calendars"]["receiving_days"], date.fromisoformat(nominal_receipt))
            if search["status"] != "resolved":
                return None, dict(stage="receiving", nominal_date=nominal_receipt, order_date=key, **search)
            due = search["date"]
            if due == key:
                receipts += ordered
                stock += ordered
                extra_cleared = min(stock, backlog)
                stock -= extra_cleared
                backlog -= extra_cleared
                cleared += extra_cleared
            else:
                incoming[due] = incoming.get(due, ZERO) + ordered
        sold, lost = quantity(observation["quantity"]), quantity(observation["lost_sales_quantity"])
        immediate = min(stock, sold)
        stock -= immediate
        shortage = sold - immediate
        backlog += shortage
        ledger.append(dict(
            date=key, review=bool(nominal_reviews), nominal_reviews=nominal_reviews,
            nominal_receipt=nominal_receipt, order_due=due, receipt_search=search,
            **{name: exact(value) for name, value in dict(
                demand=sold, lost_sales=lost, opening_stock=opening, receipts=receipts,
                backlog_fulfilled=cleared, order_gap=gap, order_quantity=ordered,
                rounding_extra=ordered-gap, immediate_fulfilled=immediate, new_backlog=shortage,
                closing_stock=stock, closing_backlog=backlog, closing_on_order=sum(incoming.values(), ZERO),
            ).items()},
        ))
    totals = {name: sum((Decimal(row[name]) for row in ledger), ZERO) for name in (
        "demand", "lost_sales", "order_quantity", "receipts", "immediate_fulfilled", "closing_stock", "rounding_extra",
    )}
    return dict(
        **config, review_schedule=schedule, ledger=ledger,
        metrics=dict(
            days=len(ledger), order_count=sum(Decimal(row["order_quantity"]) > 0 for row in ledger),
            backlog_days=sum(Decimal(row["closing_backlog"]) > 0 for row in ledger),
            sold_quantity=exact(totals["demand"]), lost_sales_quantity=exact(totals["lost_sales"]),
            ordered_quantity=exact(totals["order_quantity"]), received_quantity=exact(totals["receipts"]),
            immediate_fulfilled=exact(totals["immediate_fulfilled"]), closing_stock_sum=exact(totals["closing_stock"]),
            average_closing_stock=ratio(totals["closing_stock"], Decimal(len(ledger))),
            immediate_fill_rate=ratio(totals["immediate_fulfilled"], totals["demand"]),
            rounding_extra_quantity=exact(totals["rounding_extra"]),
            ending_stock=exact(stock), ending_backlog=exact(backlog), ending_on_order=exact(sum(incoming.values(), ZERO)),
        ),
    ), None


def calculate(task: dict) -> dict:
    try:
        source = task["source_comparison"]["evidence"]
        if task["kind"] != "simulation" or task["method"] != VERSION or task["options"]["calendars_confirmed"] is not True:
            raise ValueError("Unconfirmed calendar simulation")
        if source["output"] != constraints_calculate(source):
            raise ValueError("Source comparison does not reproduce")
        if any(task[key] != source[key] for key in ("policy", "demand", "from_date", "to_date")):
            raise ValueError("Captured evidence changed")
        if any(task["options"][key] != source["options"][key] for key in (
            "opening_stock", "history_confirmed", "empty_start_confirmed", "configurations",
        )):
            raise ValueError("Captured settings changed")
        variants = []
        with localcontext() as context:
            context.prec = 80
            for index, config in enumerate(task["options"]["configurations"]):
                variant, failure = replay(task, config)
                if failure:
                    # No partial comparison or misleading metrics when any required date is unknown.
                    return dict(method=VERSION, status=failure["status"], variants=[],
                                failure=dict(variant=index+1, **failure))
                variants.append(dict(name=f"alternative-{index+1}", **variant))
        return dict(method=VERSION, status="available", variants=variants, failure=None)
    except (KeyError, TypeError, AttributeError, OverflowError) as error:
        raise ValueError("Invalid captured calendar evidence") from error
