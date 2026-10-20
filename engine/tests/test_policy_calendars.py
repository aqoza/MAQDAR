from copy import deepcopy
from datetime import date, timedelta

import pytest

from maqdar_engine.policy_constraints import calculate as constraints
from maqdar_engine.policy_calendars import calculate, next_day
from test_policy_constraints import task as constraint_task, config


def task(configurations=None, **kwargs):
    source = constraint_task(configurations or [config(lead=0, review=1, pack="2.5")], **kwargs)
    source["output"] = constraints(source)
    start = date.fromisoformat(source["from_date"])
    days = {str(start+timedelta(days=n)): dict(date=str(start+timedelta(days=n)), working=True) for n in range(544)}
    return dict(source, method="periodic-calendars-v1",
                options=dict(source["options"], calendars_confirmed=True),
                source_comparison=dict(id="source", run_id="run", evidence=source),
                calendars=dict(ordering_days=deepcopy(days), receiving_days=deepcopy(days)))


def test_all_working_days_match_saved_constraints_and_keep_source_fixed():
    value = task([config(lead=0, review=1), config(lead=365, review=1)])
    before = deepcopy(value)
    result = calculate(value)
    assert value == before
    assert result["status"] == "available"
    for actual, original in zip(result["variants"], value["source_comparison"]["evidence"]["output"]["variants"][1:], strict=True):
        assert actual["metrics"] == original["metrics"]
        assert [{k:v for k,v in row.items() if k not in ("nominal_reviews", "nominal_receipt", "receipt_search")} for row in actual["ledger"]] == original["ledger"]


def test_deferred_reviews_coalesce_and_recompute_gap_on_actual_day():
    value = task()
    for day in ("2026-01-02", "2026-01-03"):
        value["calendars"]["ordering_days"][day]["working"] = False
    variant = calculate(value)["variants"][0]
    assert [row["order_quantity"] for row in variant["ledger"]] == ["0", "0", "12.5", "5"]
    assert variant["ledger"][2]["nominal_reviews"] == ["2026-01-02", "2026-01-03", "2026-01-04"]
    assert variant["ledger"][2]["order_gap"] == "12"
    assert variant["ledger"][2]["backlog_fulfilled"] == "6"
    assert variant["metrics"]["ending_backlog"] == "0"
    assert variant["metrics"]["lost_sales_quantity"] == "4.5"


def test_zero_lead_receipt_is_delayed_independently_and_pipeline_prevents_duplicate_orders():
    value = task([config(lead=0, review=1, moq="10", pack="4")])
    for day in ("2026-01-02", "2026-01-03"):
        value["calendars"]["receiving_days"][day]["working"] = False
    variant = calculate(value)["variants"][0]
    assert [r["order_quantity"] for r in variant["ledger"]] == ["12", "0", "0", "12"]
    assert variant["ledger"][0]["order_due"] == "2026-01-04"
    assert variant["ledger"][0]["nominal_receipt"] == "2026-01-02"
    assert variant["ledger"][2]["backlog_fulfilled"] == "6"


def test_reviews_outside_window_do_not_order_or_require_future_ordering_coverage():
    value = task()
    for day in value["demand"]:
        value["calendars"]["ordering_days"][day["date"]]["working"] = False
    value["calendars"]["ordering_days"]["2026-01-06"]["working"] = None
    variant = calculate(value)["variants"][0]
    assert variant["metrics"]["ordered_quantity"] == "0"
    assert all(r["status"] == "outside_window" for r in variant["review_schedule"])


def test_receipt_after_window_is_retained_in_pipeline():
    value = task([config(lead=365, review=365)])
    value["calendars"]["receiving_days"]["2027-01-02"]["working"] = False
    variant = calculate(value)["variants"][0]
    assert variant["ledger"][0]["order_due"] == "2027-01-03"
    assert variant["metrics"]["ending_on_order"] == "4"
    assert variant["metrics"]["received_quantity"] == "0"


@pytest.mark.parametrize("stage", ["ordering", "receiving"])
def test_unknown_dates_stop_whole_comparison_and_do_not_publish_partial_metrics(stage):
    value = task()
    value["calendars"][f"{stage}_days"]["2026-01-02"]["working"] = None
    result = calculate(value)
    assert result["status"] == "calendar_unknown"
    assert result["variants"] == []
    assert result["failure"]["stage"] == stage
    assert result["failure"]["checked_through"] == "2026-01-02"


def test_zero_gap_does_not_consult_receiving_calendar():
    value = task([config("0", lead=0)], sales=[0]*4)
    value["calendars"]["receiving_days"] = {}
    assert calculate(value)["status"] == "available"


def test_search_boundary():
    value = task()
    days = value["calendars"]["receiving_days"]
    for n in range(90):
        days[str(date(2026,1,2)+timedelta(days=n))]["working"] = False
    assert next_day(days, date(2026,1,2))["status"] == "search_exhausted"
    days["2026-04-01"]["working"] = True
    assert next_day(days, date(2026,1,2))["date"] == "2026-04-01"


@pytest.mark.parametrize("field", ["policy", "demand", "from_date", "to_date", "opening_stock", "configurations", "confirmation", "source"])
def test_changed_evidence_rejected(field):
    value = deepcopy(task())
    if field in ("policy", "demand", "from_date", "to_date"): value[field] = None
    elif field in ("opening_stock", "configurations"): value["options"][field] = None
    elif field == "confirmation": value["options"]["calendars_confirmed"] = False
    else: value["source_comparison"]["evidence"]["output"] = {}
    with pytest.raises(ValueError):
        calculate(value)
