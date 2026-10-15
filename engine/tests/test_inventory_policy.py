from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal

import pytest

from maqdar_engine.inventory_policy import calculate, distribution


def task(horizon=7, days=100):
    start = date(2026, 1, 1)
    return dict(
        kind="policy",
        method="policy-v1",
        options=dict(lead_time=3, review_interval=4, service_level="0.95"),
        forecast=dict(
            id="saved-forecast",
            method="baseline-v1",
            horizon=horizon,
            to_date=str(start + timedelta(days=days - 1)),
            source=dict(
                start_day=str(start),
                end_day=str(start + timedelta(days=days - 1)),
                introduced_on=None,
                discontinued_on=None,
                demand=[
                    [str(start + timedelta(days=i)), "2", "99"] for i in range(days)
                ],
            ),
            output=dict(
                status="selected",
                model="mean",
                forecast=[
                    dict(date=str(start + timedelta(days=days + i)), quantity="2.000")
                    for i in range(horizon)
                ],
            ),
        ),
    )


def test_constant_demand_has_exact_targets_and_no_safety_stock():
    data = task()
    original = deepcopy(data)
    row = calculate(data)[0]
    assert row["status"] == "available"
    assert row["lead_time"] == dict(
        days=3, forecast="6.000", quantile="6.000", target="6.000", safety_stock="0.000"
    )
    assert row["protection"]["target"] == "14.000"
    assert len(row["calibration"]) == 21
    assert all(e["error"] == "0" for e in row["calibration"])
    assert data == original


def test_distribution_sums_paths_and_preserves_monotonic_service_and_periods():
    points = [Decimal(3)] * 14
    errors = [Decimal(-3), Decimal(3)] * 20
    low = distribution(points, errors, [True] * 14, 5, 7, Decimal(".5"), "seed")
    high = distribution(points, errors, [True] * 14, 5, 7, Decimal(".99"), "seed")
    assert low == distribution(points, errors, [True] * 14, 5, 7, Decimal(".5"), "seed")
    assert Decimal(high["lead_time"]["target"]) >= Decimal(low["lead_time"]["target"])
    assert Decimal(high["protection"]["target"]) >= Decimal(high["lead_time"]["target"])
    # The aggregate quantile is not the sum of daily upper bounds (12 * 6).
    assert Decimal(high["protection"]["quantile"]) < 72


def test_zero_lead_and_lifecycle_are_zero_even_with_positive_errors():
    row = distribution(
        [Decimal(2)] * 7, [Decimal(100)] * 21, [False] * 7, 0, 7, Decimal(".95"), "s"
    )
    assert row["lead_time"]["target"] == row["protection"]["target"] == "0.000"


@pytest.mark.parametrize(
    "case,status",
    [
        ("short", "insufficient_residuals"),
        ("zero", "no_positive_history"),
        ("scale", "unsupported_scale"),
    ],
)
def test_unavailable_evidence_never_invents_values(case, status):
    data = task(6) if case == "short" else task()
    if case == "short":
        data["options"].update(lead_time=2, review_interval=4)
    if case in ("zero", "scale"):
        for d in data["forecast"]["source"]["demand"]:
            d[1] = "0" if case == "zero" else "1e31"
    row = calculate(data)[0]
    assert row["status"] == status
    assert row["samples"] == 0
    assert row["lead_time"] is None and row["protection"] is None


def test_calibration_uses_training_prefix_and_reports_fit_failure(monkeypatch):
    import maqdar_engine.inventory_policy as module

    seen = []

    def prediction(series, horizon, model):
        seen.append(len(series))
        return [Decimal(2)] * horizon

    monkeypatch.setattr(module, "predict", prediction)
    calculate(task())
    assert seen == [79, 86, 93]

    def broken(*args):
        raise ValueError("private details")

    monkeypatch.setattr(module, "predict", broken)
    result = calculate(task())[0]
    assert result["status"] == "calibration_failed"
    assert "private" not in str(result)


@pytest.mark.parametrize(
    "field,value",
    [
        ("lead_time", -1),
        ("review_interval", 0),
        ("service_level", "NaN"),
        ("service_level", "1"),
        ("lead_time", 7),
    ],
)
def test_invalid_policy_parameters_are_rejected(field, value):
    data = task()
    data["options"][field] = value
    with pytest.raises(ValueError):
        calculate(data)


def test_fractional_threshold_rounds_up_and_safety_stock_reconciles():
    row = distribution(
        [Decimal("1.000")], [Decimal(".0001")], [True], 0, 1, Decimal(".95"), "s"
    )
    assert row["protection"] == dict(
        days=1, forecast="1.000", quantile="1.001", target="1.001", safety_stock="0.001"
    )


def test_prepared_calendar_model_and_lifecycle_are_saved_and_prefix_only(monkeypatch):
    import maqdar_engine.inventory_policy as module

    data = task()
    saved = data["forecast"]
    saved["method"] = "regional-v1"
    saved["output"]["model"] = "calendar"
    saved["source"]["calendar"] = [
        dict(date=d[0], calendar_verified=False, holiday=None, ramadan=None)
        for d in saved["source"]["demand"]
    ]
    saved["source"]["preparation"] = dict(
        members=[dict(introduced_on=None, discontinued_on=saved["to_date"])]
    )
    observed = []
    original = module.calendar_predict

    def recording(series, history, future):
        observed.append((history[-1]["date"], future[0]["date"]))
        return original(series, history, future)

    monkeypatch.setattr(module, "calendar_predict", recording)
    result = calculate(data)[0]
    assert result["status"] == "available"
    assert all(end < begin for end, begin in observed) and len(observed) == 3
    assert result["protection"]["target"] == "0.000"


@pytest.mark.parametrize(
    "case",
    [
        "method",
        "horizon",
        "status",
        "end",
        "future",
        "negative",
        "infinite",
        "calendar",
    ],
)
def test_invalid_saved_forecast_is_rejected(case):
    data = task()
    saved = data["forecast"]
    if case == "method":
        data["method"] = "unknown"
    elif case == "horizon":
        saved["horizon"] = 0
    elif case == "status":
        saved["output"]["status"] = "insufficient"
    elif case == "end":
        saved["source"]["end_day"] = "2026-04-09"
    elif case == "future":
        saved["output"]["forecast"][0]["date"] = "2026-01-01"
    elif case in ("negative", "infinite"):
        saved["output"]["forecast"][0]["quantity"] = (
            "-1" if case == "negative" else "Infinity"
        )
    else:
        saved["method"] = "regional-v1"
    with pytest.raises(ValueError):
        calculate(data)


def test_ineligible_calendar_model_and_nonfinite_calibration_are_unavailable(
    monkeypatch,
):
    import maqdar_engine.inventory_policy as module

    data = task()
    data["forecast"]["output"]["model"] = "calendar"
    assert calculate(data)[0]["status"] == "calibration_failed"
    monkeypatch.setattr(module, "predict", lambda *args: [Decimal("NaN")] * 7)
    assert calculate(task())[0]["status"] == "calibration_failed"


def test_automatic_model_calibration_and_isolated_process():
    from maqdar_engine.forecast_process import compute

    data = task()
    data["forecast"]["method"] = "expanded-v1"
    data["forecast"]["output"]["model"] = "auto_ets"
    result = compute(data)[0]
    assert result["status"] == "available"
    assert Decimal(result["protection"]["target"]) >= 14
