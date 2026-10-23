from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal

import pytest

from zeespare_engine.regional_forecasting import calendar_predict, forecast, select


def calendar(days=196):
    start = date(2026, 1, 1)
    return [
        dict(
            date=str(start + timedelta(days=i)),
            holiday=i % 28 < 4,
            ramadan=False,
            calendar_verified=True,
        )
        for i in range(days)
    ]


def task(days=196, horizon=7):
    flags = calendar(days)
    end = flags[-1]["date"]
    item = dict(
        item_id="group",
        item_code="NEW",
        start_day=flags[0]["date"],
        end_day=end,
        introduced_on=None,
        discontinued_on=None,
        demand=[[d["date"], "20" if d["holiday"] else "10", "2"] for d in flags],
        calendar=flags,
        preparation=dict(
            comparison="fixed-group-v1",
            members=[dict(introduced_on=None, discontinued_on=None)],
        ),
    )
    return dict(
        method="regional-v1",
        to_date=end,
        options=dict(horizon=horizon),
        items=[item],
        calendar_future=dict(
            coverage_from=None,
            coverage_to=None,
            holidays=[],
            windows=[],
            weekend_days=[5, 6],
            active=True,
            observe_public_holidays=True,
            overrides=[],
        ),
    )


def test_calendar_learns_events_but_unknown_dates_have_no_event_adjustment():
    flags = calendar()
    series = [Decimal(20 if d["holiday"] else 10) for d in flags]
    future = [
        dict(flags[0], holiday=True),
        dict(flags[0], holiday=None, ramadan=None),
        dict(flags[0], holiday=False, ramadan=False),
    ]
    predictions, evidence = calendar_predict(series, flags, future)
    assert predictions[0] > predictions[1] == predictions[2]
    assert Decimal(evidence["effects"][0]["adjustment"]) > 0
    assert evidence["effects"][0]["days"] == 28
    assert evidence["unknown_future_days"] == 1


def test_ramadan_and_holiday_are_mutually_exclusive_and_sparse_effect_is_disabled():
    flags = calendar(56)
    for d in flags:
        d.update(holiday=False, ramadan=False)
    flags[0].update(holiday=True, ramadan=True)
    flags[1]["ramadan"] = flags[2]["ramadan"] = True
    _, evidence = calendar_predict(
        [Decimal(i + 1) for i in range(56)], flags, flags[:3]
    )
    holiday, ramadan = evidence["effects"]
    assert holiday["days"] == 1 and holiday["status"] == "insufficient_support"
    assert holiday["adjustment"] == "0"
    assert ramadan["days"] == 2 and ramadan["status"] == "available"


def test_weekdays_learn_without_any_verified_event_coverage():
    flags = calendar(70)
    for d in flags:
        d.update(holiday=None, ramadan=None, calendar_verified=False)
    series = [Decimal(date.fromisoformat(d["date"]).isoweekday()) for d in flags]
    predictions, evidence = calendar_predict(series, flags, flags[:7])
    assert predictions == series[:7]
    assert evidence["unknown_training_days"] == 70
    assert all(e["adjustment"] == "0" for e in evidence["effects"])


def test_rolling_fits_never_receive_test_demand(monkeypatch):
    seen = []
    from zeespare_engine import regional_forecasting as module

    original = module.calendar_predict

    def recording(series, history, future):
        seen.append((len(series), history[-1]["date"], future[0]["date"]))
        return original(series, history, future)

    monkeypatch.setattr(module, "calendar_predict", recording)
    monkeypatch.setattr(module, "MODELS", ("calendar",))
    flags = calendar(100)
    select([Decimal(10)] * 98, flags[:98], flags[98:], 7)
    assert [n for n, _, _ in seen] == [77, 84, 91, 98]
    assert all(train < prediction for _, train, prediction in seen)


def test_historical_coverage_does_not_learn_from_held_out_values(monkeypatch):
    from zeespare_engine import regional_forecasting as module

    monkeypatch.setattr(module, "MODELS", ("mean", "calendar"))
    # Each comparison window spans the complete event cycle.
    data = task(196, 28)
    first = forecast(data)[0]
    assert first["model"] == "calendar"
    other = deepcopy(data)
    for d in other["items"][0]["demand"][-28:]:
        d[1] = "999"
    second = forecast(other)[0]
    for field in ("forecast", "bands", "model", "calibration"):
        assert first["evaluation"][field] == second["evaluation"][field]
    assert first["evaluation"]["coverage95"] != second["evaluation"]["coverage95"]
    assert first["comparison"] == "fixed-group-v1"


def test_real_models_produce_nested_reproducible_bands_and_preserve_input():
    data = task()
    original = deepcopy(data)
    first = forecast(data)[0]
    assert first == forecast(data)[0] and data == original
    assert first["status"] == "selected"
    assert len(first["scores"]) >= 8 and len(first["forecast"]) == 7
    assert all(d["holiday"] is None for d in first["future_calendar"])
    for p, b in zip(first["forecast"], first["uncertainty"]["bands"], strict=True):
        assert (
            0
            <= Decimal(b["lower95"])
            <= Decimal(b["lower80"])
            <= Decimal(b["upper80"])
            <= Decimal(b["upper95"])
        )
        assert Decimal(p["quantity"]) >= 0


@pytest.mark.parametrize("case", ["short", "outside", "scale"])
def test_ineligible_group_reports_reason_without_forecasts(case):
    data = task(60 if case == "short" else 196)
    if case == "outside":
        data["items"][0]["start_day"] = "2027-01-01"
        data["items"][0]["demand"] = []
        data["items"][0]["calendar"] = []
    if case == "scale":
        data["items"][0]["demand"][0][1] = "1" + "0" * 31
    row = forecast(data)[0]
    assert (
        row["status"]
        == {
            "short": "insufficient",
            "outside": "outside_lifecycle",
            "scale": "unsupported_scale",
        }[case]
    )
    assert row["forecast"] == [] and row["scores"] == []


def test_future_without_active_sources_has_zero_points_and_bands(monkeypatch):
    from zeespare_engine import regional_forecasting as module

    monkeypatch.setattr(module, "MODELS", ("mean", "calendar"))
    data = task()
    data["items"][0]["preparation"]["members"][0]["discontinued_on"] = data["to_date"]
    row = forecast(data)[0]
    assert all(d["quantity"] == "0.000" for d in row["forecast"])
    assert all(set(b.values()) == {"0.000"} for b in row["uncertainty"]["bands"])


@pytest.mark.parametrize(
    "case",
    [
        "method",
        "horizon",
        "multiple",
        "calendar",
        "negative",
        "comparison",
        "members",
        "cutoff",
    ],
)
def test_invalid_input_is_rejected(case):
    data = task()
    if case == "method":
        data["method"] = "unknown"
    if case == "horizon":
        data["options"]["horizon"] = 91
    if case == "multiple":
        data["items"] *= 2
    if case == "calendar":
        data["items"][0]["calendar"][0]["date"] = "2020-01-01"
    if case == "negative":
        data["items"][0]["demand"][0][1] = "-1"
    if case == "comparison":
        data["items"][0]["preparation"]["comparison"] = "unknown"
    if case == "members":
        data["items"][0]["preparation"]["members"] = []
    if case == "cutoff":
        data["items"][0]["end_day"] = "2020-01-01"
    with pytest.raises(ValueError):
        forecast(data)


def test_candidate_failure_is_reported_and_baseline_failure_is_not_hidden(monkeypatch):
    from zeespare_engine import regional_forecasting as module

    original = module.candidate

    def broken(series, history, future, model):
        if model == "auto_ets":
            raise ValueError("fit failed")
        return original(series, history, future, model)

    monkeypatch.setattr(module, "candidate", broken)
    monkeypatch.setattr(module, "MODELS", ("mean", "auto_ets"))
    flags = calendar(100)
    selected, _, _ = select([Decimal(2)] * 98, flags[:98], flags[98:], 7)
    assert selected["model"] == "mean"
    assert selected["unavailable_models"] == [
        dict(model="auto_ets", reason="fit_failed")
    ]
    monkeypatch.setattr(module, "BASELINES", ("mean", "auto_ets"))
    with pytest.raises(ValueError):
        select([Decimal(2)] * 98, flags[:98], flags[98:], 7)


def test_failed_refit_falls_back_to_next_candidate(monkeypatch):
    from zeespare_engine import regional_forecasting as module

    def broken(series, history, future, model):
        if model == "calendar" and len(series) == 98:
            raise ValueError("refit failed")
        return [Decimal(2 if model == "calendar" else 3)] * len(future)

    monkeypatch.setattr(module, "candidate", broken)
    monkeypatch.setattr(module, "MODELS", ("mean", "calendar"))
    flags = calendar(100)
    selected, _, _ = select([Decimal(2)] * 98, flags[:98], flags[98:], 7)
    assert selected["model"] == "mean"
    assert selected["unavailable_models"] == [
        dict(model="calendar", reason="refit_failed")
    ]
    monkeypatch.setattr(module, "BASELINES", ("mean", "calendar"))
    with pytest.raises(ValueError):
        select([Decimal(2)] * 98, flags[:98], flags[98:], 7)
    monkeypatch.setattr(module, "MODELS", ())
    with pytest.raises(ValueError):
        select([Decimal(2)] * 98, flags[:98], flags[98:], 7)


def test_event_effect_is_bounded_and_nonnegative_forecast_for_depressed_events():
    flags = calendar()
    series = [Decimal(0 if day["holiday"] else 100) for day in flags]
    predictions, model = calendar_predict(series, flags, flags)
    assert all(value >= 0 for value in predictions)
    assert -100 <= Decimal(model["effects"][0]["adjustment"]) < 0
    with pytest.raises(ValueError):
        calendar_predict(series[:1], flags[:1], flags[:1])


def test_uncertainty_requires_enough_residuals_and_independent_history(monkeypatch):
    from zeespare_engine import regional_forecasting as module

    monkeypatch.setattr(module, "MODELS", ("mean", "calendar"))
    assert forecast(task(80, 7))[0]["evaluation"]["status"] == "insufficient_history"
    row = forecast(task(70, 1))[0]
    assert row["uncertainty"]["status"] == "insufficient_residuals"
    assert row["evaluation"]["status"] == "insufficient_residuals"


def test_child_process_dispatches_prepared_method():
    from zeespare_engine.forecast_process import compute

    assert compute(task(60))[0]["status"] == "insufficient"
