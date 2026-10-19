from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal

import pytest

from maqdar_engine.policy_simulation import calculate


def task(sales=(4, 4, 4, 4), opening="2", maximum="6", alternative="8", lead=1, review=2):
    return dict(
        kind="simulation", method="periodic-replay-v1", from_date="2026-01-02",
        to_date=str(date(2026, 1, 1) + timedelta(days=len(sales))),
        options=dict(history_confirmed=True, empty_start_confirmed=True,
                     opening_stock=opening, alternative_maximum=alternative),
        policy=dict(cutoff="2026-01-01", horizon=90, lead_time=lead, review_interval=review,
                    maximum=maximum, unit="EA"),
        demand=[dict(date=str(date(2026, 1, 2) + timedelta(days=i)), quantity=str(sold),
                     lost_sales_quantity="1.125") for i, sold in enumerate(sales)],
    )


def test_hand_calculated_backlog_priority_and_pipeline():
    result = calculate(task())
    baseline, alternative = result["variants"]
    assert [row["order_quantity"] for row in baseline["ledger"]] == ["4", "0", "8", "0"]
    assert [row["closing_backlog"] for row in baseline["ledger"]] == ["2", "2", "6", "2"]
    assert [row["immediate_fulfilled"] for row in baseline["ledger"]] == ["2", "2", "0", "2"]
    assert baseline["metrics"] == dict(
        days=4, order_count=2, backlog_days=4, sold_quantity="16", lost_sales_quantity="4.5",
        ordered_quantity="12", received_quantity="12", immediate_fulfilled="6", closing_stock_sum="0",
        average_closing_stock="0", immediate_fill_rate="0.375", ending_stock="0", ending_backlog="2", ending_on_order="0",
    )
    assert alternative["metrics"]["immediate_fulfilled"] == "10"
    assert alternative["metrics"]["ending_backlog"] == "0"


def test_zero_lead_received_before_demand_and_no_lost_sales_added():
    baseline = calculate(task(lead=0))["variants"][0]
    assert [row["receipts"] for row in baseline["ledger"]] == ["4", "0", "8", "0"]
    assert [row["closing_stock"] for row in baseline["ledger"]] == ["2", "0", "2", "0"]
    assert baseline["metrics"]["immediate_fulfilled"] == "12"
    assert baseline["metrics"]["immediate_fill_rate"] == "0.75"
    assert baseline["ledger"][2]["backlog_fulfilled"] == "2"


def test_orders_beyond_window_and_empty_demand_ratio():
    baseline = calculate(task(sales=(0, 0), lead=5, opening="0"))["variants"][0]
    assert baseline["metrics"]["ending_on_order"] == "6"
    assert baseline["metrics"]["received_quantity"] == "0"
    assert baseline["metrics"]["immediate_fill_rate"] is None
    assert baseline["ledger"][0]["order_due"] == "2026-01-07"


def test_exact_decimal_and_large_quantities_do_not_use_binary_float():
    baseline = calculate(task(sales=("0.001", "0.002", "0.003"), opening="999999999999999.999",
                              maximum="0", alternative="0"))["variants"][0]
    assert baseline["metrics"]["ending_stock"] == "999999999999999.993"
    assert baseline["metrics"]["average_closing_stock"] == "999999999999999.995667"
    assert baseline["metrics"]["ordered_quantity"] == "0"


@pytest.mark.parametrize("lead,review", [(0, 1), (0, 7), (1, 1), (3, 4), (89, 1)])
def test_conservation_and_equal_variants(lead, review):
    source = task(sales=["0.125", 4, 0, 7, "2.001"] * 18, lead=lead, review=review, alternative="6")
    original = deepcopy(source)
    output = calculate(source)
    assert source == original
    assert output == calculate(source)
    baseline, alternate = output["variants"]
    assert baseline["ledger"] == alternate["ledger"]
    assert baseline["metrics"] == alternate["metrics"]
    stock, backlog, pipeline = Decimal("2"), Decimal(0), Decimal(0)
    for row in baseline["ledger"]:
        num = lambda key: Decimal(row[key])
        assert num("opening_stock") == stock
        assert num("closing_stock") == stock + num("receipts") - num("backlog_fulfilled") - num("immediate_fulfilled")
        assert num("closing_backlog") == backlog + num("new_backlog") - num("backlog_fulfilled")
        assert num("closing_on_order") == pipeline + num("order_quantity") - num("receipts")
        assert num("demand") == num("immediate_fulfilled") + num("new_backlog")
        assert not (num("closing_stock") and num("closing_backlog"))
        stock, backlog, pipeline = num("closing_stock"), num("closing_backlog"), num("closing_on_order")


@pytest.mark.parametrize("field,value", [("opening_stock", "-1"), ("opening_stock", "NaN"),
    ("alternative_maximum", "1e2"), ("alternative_maximum", "0.0001"), ("opening_stock", 1.5),
    ("history_confirmed", False), ("empty_start_confirmed", False)])
def test_invalid_options(field, value):
    source = task()
    source["options"][field] = value
    with pytest.raises(ValueError):
        calculate(source)


@pytest.mark.parametrize("change", ["method", "dates", "lead", "unit", "missing", "quantity", "horizon"])
def test_invalid_captured_evidence(change):
    source = task()
    if change == "method": source["method"] = "other"
    if change == "dates": source["demand"][1]["date"] = source["demand"][0]["date"]
    if change == "lead": source["policy"]["lead_time"] = True
    if change == "unit": source["policy"]["unit"] = ""
    if change == "missing": del source["policy"]
    if change == "quantity": source["demand"][0]["quantity"] = "9" * 31
    if change == "horizon": source["policy"]["horizon"] = 2
    with pytest.raises(ValueError):
        calculate(source)
