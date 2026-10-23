"""Fixed-group comparisons with a bounded, inspectable calendar candidate."""

from datetime import date, timedelta
from decimal import Decimal, localcontext

from zeespare_engine.expanded_forecasting import (
    MODELS as EXISTING_MODELS,
    bootstrap_bands,
    predict,
    rounded,
)
from zeespare_engine.forecasting import (
    MIN_TRAIN,
    MODELS as BASELINES,
    accuracy,
    daily_series,
    decimal_text,
)
from zeespare_engine.preparation import calendar_day

VERSION = "regional-v1"
MODELS = (*EXISTING_MODELS, "calendar")
SHRINK_DAYS = Decimal(14)
MAX_QUANTITY = Decimal("1e30")


def category(day: dict) -> str:
    if day.get("calendar_verified") is not True:
        return "unknown"
    if day["holiday"] is True:
        return "holiday"
    if day["holiday"] is False and day["ramadan"] is not None:
        return "ramadan" if day["ramadan"] else "ordinary"
    return "unknown"


def calendar_predict(
    series: list[Decimal], history: list[dict], future: list[dict]
) -> tuple[list[Decimal], dict]:
    weekdays = [
        [
            value
            for value, day in zip(series, history, strict=True)
            if date.fromisoformat(day["date"]).weekday() == weekday
        ]
        for weekday in range(7)
    ]
    if any(not values for values in weekdays):
        raise ValueError("Calendar candidate needs every weekday")
    means = [sum(values) / len(values) for values in weekdays]
    residuals = {key: [] for key in ("ordinary", "holiday", "ramadan", "unknown")}
    for value, day in zip(series, history, strict=True):
        residuals[category(day)].append(
            value - means[date.fromisoformat(day["date"]).weekday()]
        )
    ordinary = residuals["ordinary"]
    effects = []
    for event in ("holiday", "ramadan"):
        samples = residuals[event]
        available = len(samples) >= 2 and len(ordinary) >= 28
        delta = Decimal(0)
        if available:
            difference = sum(samples) / len(samples) - sum(ordinary) / len(ordinary)
            delta = (
                max(-max(series), min(max(series), difference))
                * len(samples)
                / (len(samples) + SHRINK_DAYS)
            )
        effects.append(
            dict(
                event=event,
                days=len(samples),
                ordinary_days=len(ordinary),
                status="available" if available else "insufficient_support",
                adjustment=decimal_text(delta),
            )
        )
    adjustments = {effect["event"]: Decimal(effect["adjustment"]) for effect in effects}
    predictions = [
        max(
            Decimal(0),
            means[date.fromisoformat(day["date"]).weekday()]
            + adjustments.get(category(day), Decimal(0)),
        )
        for day in future
    ]
    evidence = dict(
        method="weekday-event-shrinkage-v1",
        shrink_days=14,
        effects=effects,
        weekdays=[
            dict(day=i + 1, days=len(values), mean=decimal_text(means[i]))
            for i, values in enumerate(weekdays)
        ],
        unknown_training_days=len(residuals["unknown"]),
        unknown_future_days=sum(category(day) == "unknown" for day in future),
    )
    return predictions, evidence


def candidate(series, history, future, model):
    if model == "calendar":
        return calendar_predict(series, history, future)[0]
    return predict(series, len(future), model)


def select(
    series: list[Decimal], history: list[dict], future: list[dict], horizon: int
):
    scores, residuals, unavailable = [], {}, []
    for model in MODELS:
        errors, folds = [], []
        try:
            for remaining in (3, 2, 1):
                n = len(series) - remaining * horizon
                predictions = candidate(
                    series[:n], history[:n], history[n : n + horizon], model
                )
                current = [
                    p - y
                    for p, y in zip(predictions, series[n : n + horizon], strict=True)
                ]
                errors.extend(current)
                folds.append(accuracy(current))
        except (ValueError, ArithmeticError, RuntimeError):
            if model in BASELINES:
                raise
            unavailable.append(dict(model=model, reason="fit_failed"))
            continue
        scores.append(dict(model=model, **accuracy(errors), folds=folds))
        residuals[model] = [-e for e in errors]
    while scores:
        winner = min(scores, key=lambda score: Decimal(score["rmse"]))
        try:
            predictions = candidate(series, history, future, winner["model"])
            return (
                dict(
                    model=winner["model"], scores=scores, unavailable_models=unavailable
                ),
                predictions,
                residuals[winner["model"]],
            )
        except (ValueError, ArithmeticError, RuntimeError):
            if winner["model"] in BASELINES:
                raise
            unavailable.append(dict(model=winner["model"], reason="refit_failed"))
            scores.remove(winner)
    raise ValueError("No forecast candidate available")


def evaluate(series, history, horizon, seed):
    if len(series) < MIN_TRAIN + 4 * horizon:
        return dict(status="insufficient_history")
    selection, predictions, residuals = select(
        series[:-horizon], history[:-horizon], history[-horizon:], horizon
    )
    uncertainty = bootstrap_bands(predictions, residuals, seed + ":evaluation")
    if uncertainty["status"] != "available":
        return dict(status="insufficient_residuals")
    bands = uncertainty["bands"]
    coverage = {
        f"coverage{level}": decimal_text(
            Decimal(
                sum(
                    Decimal(b[f"lower{level}"]) <= y <= Decimal(b[f"upper{level}"])
                    for b, y in zip(bands, series[-horizon:], strict=True)
                )
            )
            / horizon
        )
        for level in (80, 95)
    }
    return dict(
        status="available",
        model=selection["model"],
        train_to=history[-horizon - 1]["date"],
        test_from=history[-horizon]["date"],
        test_to=history[-1]["date"],
        count=horizon,
        forecast=[rounded(p) for p in predictions],
        bands=bands,
        calibration=len(residuals),
        **coverage,
    )


def forecast(snapshot: dict) -> list[dict]:
    horizon = snapshot["options"]["horizon"]
    if (
        snapshot.get("method") != VERSION
        or type(horizon) is not int
        or not 1 <= horizon <= 90
        or len(snapshot["items"]) != 1
    ):
        raise ValueError("Invalid prepared forecast bounds")
    with localcontext() as context:
        context.prec = 60
        item = snapshot["items"][0]
        if (
            item["preparation"]["comparison"] != "fixed-group-v1"
            or not 1 <= len(item["preparation"]["members"]) <= 100
        ):
            raise ValueError("Invalid prepared group")
        cutoff = date.fromisoformat(snapshot["to_date"])
        if item["end_day"] != str(cutoff):
            raise ValueError("Prepared history must end at the cutoff")
        start, series = daily_series(item)
        history = item["calendar"]
        if len(series) != len(history) or any(
            day["date"] != str(start + timedelta(days=i))
            for i, day in enumerate(history)
        ):
            raise ValueError("Calendar and demand do not align")
        row = dict(
            item_id=item["item_id"],
            status="insufficient",
            model=None,
            scores=[],
            folds=[],
            forecast=[],
            total=None,
            unavailable_models=[],
            uncertainty=dict(status="unavailable", bands=[]),
            evaluation=dict(status="unavailable"),
            comparison="fixed-group-v1",
            calendar_model=None,
            future_calendar=[],
        )
        if start > cutoff:
            return [dict(row, status="outside_lifecycle")]
        if any(value > MAX_QUANTITY for value in series):
            return [dict(row, status="unsupported_scale")]
        if len(series) < MIN_TRAIN + 3 * horizon:
            return [row]
        future = [
            dict(
                date=str(cutoff + timedelta(days=i + 1)),
                **calendar_day(
                    snapshot["calendar_future"], cutoff + timedelta(days=i + 1)
                ),
            )
            for i in range(horizon)
        ]
        selection, predictions, residuals = select(series, history, future, horizon)
        seed = f"{VERSION}:{item['item_id']}:{start}:{cutoff}:{horizon}"
        uncertainty = bootstrap_bands(predictions, residuals, seed)
        daily = []
        for i, (day, value) in enumerate(zip(future, predictions, strict=True)):
            active = any(
                (
                    member["introduced_on"] is None
                    or member["introduced_on"] <= day["date"]
                )
                and (
                    member["discontinued_on"] is None
                    or member["discontinued_on"] >= day["date"]
                )
                for member in item["preparation"]["members"]
            )
            if not active:
                value = Decimal(0)
                if uncertainty["bands"]:
                    uncertainty["bands"][i] = dict.fromkeys(
                        ("lower95", "lower80", "upper80", "upper95"), "0.000"
                    )
            daily.append(dict(date=day["date"], quantity=rounded(value)))
        folds = [
            dict(
                train_from=str(start),
                train_to=history[-k * horizon - 1]["date"],
                test_from=history[-k * horizon]["date"],
                test_to=history[len(series) - (k - 1) * horizon - 1]["date"],
            )
            for k in (3, 2, 1)
        ]
        return [
            dict(
                row,
                **selection,
                status="selected",
                forecast=daily,
                folds=folds,
                total=decimal_text(sum(Decimal(day["quantity"]) for day in daily)),
                uncertainty=uncertainty,
                evaluation=evaluate(series, history, horizon, seed),
                calendar_model=calendar_predict(series, history, future)[1],
                future_calendar=future,
            )
        ]
