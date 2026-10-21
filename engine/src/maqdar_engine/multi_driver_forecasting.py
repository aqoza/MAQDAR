"""A bounded joint ridge candidate using only captured, declared-available drivers."""
from datetime import timedelta
from decimal import Decimal
from uuid import UUID

from maqdar_engine.driver_forecasting import (
    DriverUnavailable, MAX_PREDICTION, RIDGE, driver_values, forecast_captured,
)
from maqdar_engine.forecasting import decimal_text

VERSION = 'multi-driver-v1'
MODEL = 'multi_driver_weekday'
MAX_DRIVERS = 5


def solve(matrix, vector):
    """Deterministic partial-pivot elimination on at most five ridge coefficients."""
    size = len(vector)
    augmented = [list(row) + [value] for row, value in zip(matrix, vector, strict=True)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda i: abs(augmented[i][column]))
        if not augmented[pivot][column]:
            raise ValueError('Singular regularized fit')
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [v / divisor for v in augmented[column]]
        for row in range(column + 1, size):
            factor = augmented[row][column]
            augmented[row] = [v - factor * p for v, p in zip(augmented[row], augmented[column], strict=True)]
    coefficients = [Decimal(0)] * size
    for row in reversed(range(size)):
        coefficients[row] = augmented[row][-1] - sum(augmented[row][j] * coefficients[j] for j in range(row + 1, size))
    return coefficients


def predict(series, start, horizon, rows):
    days = [start + timedelta(days=i) for i in range(len(series))]
    cutoff = days[-1]
    future = [cutoff + timedelta(days=i + 1) for i in range(horizon)]
    groups = [[i for i, day in enumerate(days) if day.weekday() == w] for w in range(7)]
    if any(not group for group in groups):
        raise ValueError('Insufficient weekday evidence')
    mean_y = [sum(series[i] for i in group) / len(group) for group in groups]
    residual_y = [value - mean_y[day.weekday()] for value, day in zip(series, days, strict=True)]
    predictors = []
    for dataset_id, source in sorted(rows.items()):
        try:
            values = driver_values(source, days, cutoff, 'training')
            future_values = driver_values(source, future, cutoff, 'prediction')
            center = sum(values) / len(values)
            scale = max(abs(v - center) for v in values)
            if not scale or all(len({values[i] for i in group}) == 1 for group in groups):
                raise DriverUnavailable('driver_constant')
            scaled = [(v - center) / scale for v in values]
            weekday_means = [sum(scaled[i] for i in group) / len(group) for group in groups]
            residual_x = [v - weekday_means[day.weekday()] for v, day in zip(scaled, days, strict=True)]
            if not sum(v * v for v in residual_x):
                raise DriverUnavailable('driver_constant')
        except DriverUnavailable as error:
            error.detail = dict(error.detail, dataset_id=dataset_id)
            raise
        predictors.append(dict(dataset_id=dataset_id, values=values, future=future_values,
                               center=center, scale=scale, weekday_means=weekday_means, residual=residual_x))
    matrix = [[sum(a * b for a, b in zip(left['residual'], right['residual'], strict=True))
               + (len(series) * RIDGE if i == j else Decimal(0))
               for j, right in enumerate(predictors)] for i, left in enumerate(predictors)]
    vector = [sum(a * b for a, b in zip(p['residual'], residual_y, strict=True)) for p in predictors]
    slopes = solve(matrix, vector)
    intercepts = [mean_y[w] - sum(s * (p['center'] / p['scale'] + p['weekday_means'][w])
                                  for s, p in zip(slopes, predictors, strict=True)) for w in range(7)]
    predicted = [max(Decimal(0), intercepts[day.weekday()] + sum(
        s / p['scale'] * p['future'][i] for s, p in zip(slopes, predictors, strict=True)))
        for i, day in enumerate(future)]
    if any(not value.is_finite() or value > MAX_PREDICTION for value in predicted):
        raise ValueError('Joint prediction outside supported scale')
    evidence = [dict(dataset_id=p['dataset_id'], center=decimal_text(p['center']), scale=decimal_text(p['scale']),
                     slope=decimal_text(s / p['scale']), training_min=decimal_text(min(p['values'])),
                     training_max=decimal_text(max(p['values'])),
                     extrapolated_dates=[str(day) for day, v in zip(future, p['future'], strict=True)
                                         if v < min(p['values']) or v > max(p['values'])])
                for s, p in zip(slopes, predictors, strict=True)]
    return predicted, dict(status='available', penalty=decimal_text(RIDGE),
                           weekday_intercepts=[decimal_text(v) for v in intercepts], predictors=evidence)


def forecast(snapshot):
    captures = snapshot.get('drivers')
    if not isinstance(captures, list) or not 2 <= len(captures) <= MAX_DRIVERS:
        raise ValueError('Choose two to five drivers')
    rows = {}
    for capture in captures:
        dataset_id = str(UUID(capture['id']))
        if dataset_id in rows:
            raise ValueError('Duplicate driver dataset')
        source = capture['report']['input']['rows']
        rows[dataset_id] = {r['date']: r for r in source}
        if len(rows[dataset_id]) != len(source):
            raise ValueError('Duplicate driver dates')
    return forecast_captured(snapshot, version=VERSION, candidate=MODEL, predictor=predict, rows=rows)
