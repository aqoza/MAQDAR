"""Conditional inventory thresholds from immutable forecasts; no ordering side effects."""

from datetime import date, timedelta
from decimal import Decimal, ROUND_CEILING, localcontext
from hashlib import sha256
import random

from maqdar_engine.expanded_forecasting import predict
from maqdar_engine.forecasting import MIN_TRAIN, daily_series, decimal_text
from maqdar_engine.regional_forecasting import calendar_predict

VERSION = "policy-v1"
SAMPLES = 5000
MAX_QUANTITY = Decimal("1e30")


def upward(value: Decimal) -> str:
    return decimal_text(value.quantize(Decimal(".001"), rounding=ROUND_CEILING))


def distribution(points, errors, active, lead, review, probability, seed):
    """Use common paths for both periods, and for different policy parameters."""
    rng = random.Random(seed)
    totals = {days: [] for days in (lead, lead + review)}
    for _ in range(SAMPLES):
        path = [
            max(Decimal(0), p + rng.choice(errors)) if eligible else Decimal(0)
            for p, eligible in zip(points, active, strict=True)
        ]
        for days, values in totals.items():
            values.append(sum(path[:days], Decimal(0)))
    rank = int((probability * SAMPLES).to_integral_value(rounding=ROUND_CEILING)) - 1
    result = {}
    for key, days in (("lead_time", lead), ("protection", lead + review)):
        point = sum(
            (p for p, a in zip(points[:days], active[:days], strict=True) if a),
            Decimal(0),
        )
        quantile = sorted(totals[days])[rank]
        target = Decimal(upward(max(point, quantile)))
        result[key] = dict(
            days=days,
            forecast=upward(point),
            quantile=upward(quantile),
            target=upward(target),
            safety_stock=upward(target - point),
        )
    return result


def active_days(source, future):
    members = source.get("preparation", {}).get("members", [source])
    return [
        any(
            (m.get("introduced_on") is None or m["introduced_on"] <= day["date"])
            and (
                m.get("discontinued_on") is None or m["discontinued_on"] >= day["date"]
            )
            for m in members
        )
        for day in future
    ]


def calculate(task: dict) -> list[dict]:
    with localcontext() as context:
        context.prec = 60
        return [_calculate(task)]


def _calculate(task):
    options, saved = task["options"], task["forecast"]
    lead, review = options["lead_time"], options["review_interval"]
    probability = Decimal(str(options["service_level"]))
    horizon = saved["horizon"]
    if (
        task.get("method") != VERSION
        or saved["method"] not in ("baseline-v1", "expanded-v1", "regional-v1")
        or type(horizon) is not int
        or not 1 <= horizon <= 90
        or type(lead) is not int
        or type(review) is not int
        or not 0 <= lead <= 89
        or not 1 <= review <= 90
        or lead + review > horizon
        or not probability.is_finite()
        or not Decimal(".5") <= probability <= Decimal(".999")
        or saved["output"]["status"] != "selected"
    ):
        raise ValueError("Invalid policy inputs")
    source, output = saved["source"], saved["output"]
    start, series = daily_series(source)
    cutoff = date.fromisoformat(saved["to_date"])
    future = output["forecast"]
    if (
        source["end_day"] != str(cutoff)
        or len(series) < MIN_TRAIN + 3 * horizon
        or len(future) != horizon
        or any(
            d["date"] != str(cutoff + timedelta(days=i + 1))
            for i, d in enumerate(future)
        )
    ):
        raise ValueError("Invalid policy observation window")
    points = [Decimal(d["quantity"]) for d in future]
    if any(not p.is_finite() or p < 0 for p in points):
        raise ValueError("Invalid saved point forecast")
    seed = sha256(f"{VERSION}:{saved['id']}".encode()).hexdigest()
    row = dict(
        status="available",
        lead_time=None,
        protection=None,
        calibration=[],
        residual_count=0,
        positive_days=sum(v > 0 for v in series),
        samples=0,
        seed=seed,
        method="iid-error-paths-v1",
    )
    if max(series + points) > MAX_QUANTITY:
        return dict(row, status="unsupported_scale")
    if not row["positive_days"]:
        return dict(row, status="no_positive_history")
    if 3 * horizon < 20:
        return dict(row, status="insufficient_residuals")
    history = source.get("calendar")
    if saved["method"] == "regional-v1" and (
        not history
        or len(history) != len(series)
        or any(
            d["date"] != str(start + timedelta(days=i)) for i, d in enumerate(history)
        )
    ):
        raise ValueError("Invalid saved calendar")
    errors, evidence = [], []
    try:
        for remaining in (3, 2, 1):
            n = len(series) - remaining * horizon
            if output["model"] == "calendar":
                if saved["method"] != "regional-v1":
                    raise ValueError("Calendar model requires saved calendar")
                predicted = calendar_predict(
                    series[:n], history[:n], history[n : n + horizon]
                )[0]
            else:
                predicted = predict(series[:n], horizon, output["model"])
            for i, (p, actual) in enumerate(
                zip(predicted, series[n : n + horizon], strict=True)
            ):
                if not p.is_finite() or p < 0 or p > MAX_QUANTITY:
                    raise ValueError("Unsupported calibration prediction")
                error = actual - p
                errors.append(error)
                evidence.append(
                    dict(
                        date=str(start + timedelta(days=n + i)),
                        train_to=str(start + timedelta(days=n - 1)),
                        actual=decimal_text(actual),
                        prediction=decimal_text(p),
                        error=decimal_text(error),
                    )
                )
    except (ValueError, ArithmeticError, RuntimeError):
        return dict(row, status="calibration_failed")
    return dict(
        row,
        samples=SAMPLES,
        calibration=evidence,
        residual_count=len(errors),
        **distribution(
            points, errors, active_days(source, future), lead, review, probability, seed
        ),
    )
