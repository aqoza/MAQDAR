"""Versioned bounded automatic models and empirical daily residual bootstrap bands."""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from hashlib import sha256
import random
import warnings

import numpy as np
from statsforecast.models import AutoARIMA, AutoETS

from maqdar_engine.forecasting import MODELS as BASELINES, MIN_TRAIN, accuracy, baseline, daily_series, decimal_text

VERSION = 'expanded-v1'
MODELS = (*BASELINES, 'auto_ets', 'auto_arima')
MIN_RESIDUALS = 20
BOOTSTRAP_SAMPLES = 2000


def rounded(value: Decimal) -> str:
    return decimal_text(value.quantize(Decimal('.001'), rounding=ROUND_HALF_UP))


def predict(series: list[Decimal], horizon: int, model: str) -> list[Decimal]:
    if model in BASELINES:
        return baseline(series, horizon, model)
    if model == 'auto_ets':
        # Additive errors permit confirmed zero days; trend/seasonality are automatic.
        estimator = AutoETS(season_length=7, model='AZZ')
    elif model == 'auto_arima':
        estimator = AutoARIMA(season_length=7, max_p=2, max_q=2, max_P=1, max_Q=1,
                              max_d=1, max_D=1, start_p=1, start_q=1,
                              nmodels=20, approximation=False)
    else:
        raise ValueError('Unsupported candidate')
    # Scale for numerical stability; original source and baseline arithmetic stay Decimal.
    scale = max(max(series), Decimal(1))
    values = np.asarray([float(v / scale) for v in series], dtype=np.float64)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')  # Failure details must never enter persisted evidence.
        result = estimator.forecast(y=values, h=horizon)['mean']
    if len(result) != horizon or not np.isfinite(result).all():
        raise ValueError('Nonfinite model output')
    return [max(Decimal(0), Decimal(str(float(v))) * scale) for v in result]


def select(series: list[Decimal], horizon: int) -> tuple[dict, list[Decimal], list[Decimal]]:
    scores, residuals, unavailable = [], {}, []
    cutoffs = [len(series) - remaining*horizon for remaining in (3, 2, 1)]
    for model in MODELS:
        errors, folds = [], []
        try:
            for n in cutoffs:
                predicted = predict(series[:n], horizon, model)
                current = [p-y for p, y in zip(predicted, series[n:n+horizon], strict=True)]
                errors.extend(current)
                folds.append(accuracy(current))
        except (ValueError, ArithmeticError, RuntimeError, np.linalg.LinAlgError):
            if model in BASELINES:
                raise
            unavailable.append(dict(model=model, reason='fit_failed'))
            continue
        scores.append(dict(model=model, **accuracy(errors), folds=folds))
        residuals[model] = [-error for error in errors]
    # A refit failure removes that candidate; it cannot silently inherit another model's scores.
    while True:  # Baselines always remain eligible; a baseline failure raises immediately.
        winner = min(scores, key=lambda score: Decimal(score['rmse']))
        try:
            predictions = predict(series, horizon, winner['model'])
            return dict(model=winner['model'], scores=scores, unavailable_models=unavailable), predictions, residuals[winner['model']]
        except (ValueError, ArithmeticError, RuntimeError, np.linalg.LinAlgError):
            if winner['model'] in BASELINES:
                raise
            unavailable.append(dict(model=winner['model'], reason='refit_failed'))
            scores.remove(winner)


def bootstrap_bands(predictions: list[Decimal], residuals: list[Decimal], seed: str) -> dict:
    metadata = dict(method='iid-residual-bootstrap-v1', samples=BOOTSTRAP_SAMPLES,
                    residual_count=len(residuals), seed=sha256(seed.encode()).hexdigest())
    if len(residuals) < MIN_RESIDUALS:
        return dict(metadata, status='insufficient_residuals', bands=[])
    rng = random.Random(metadata['seed'])
    bands = []
    for prediction in predictions:
        draws = sorted(rng.choices(residuals, k=BOOTSTRAP_SAMPLES))
        quantiles = [draws[int((BOOTSTRAP_SAMPLES-1)*p)] for p in (.025, .1, .9, .975)]
        bounds = [rounded(max(Decimal(0), prediction+q)) for q in quantiles]
        bands.append(dict(zip(('lower95','lower80','upper80','upper95'), bounds, strict=True)))
    return dict(metadata, status='available', bands=bands)


def evaluation(series: list[Decimal], horizon: int, start: date, seed: str) -> dict:
    if len(series) < MIN_TRAIN + 4*horizon:
        return dict(status='insufficient_history')
    # This historical exercise ends before the final held-out window. Selection and
    # residual calibration use only the preceding three folds; nothing is tuned on coverage.
    selection, predictions, residuals = select(series[:-horizon], horizon)
    bands = bootstrap_bands(predictions, residuals, seed + ':evaluation')
    if bands['status'] != 'available':
        return dict(status='insufficient_residuals')
    actuals = series[-horizon:]
    coverage = {f'coverage{level}': decimal_text(Decimal(sum(
        Decimal(band[f'lower{level}']) <= actual <= Decimal(band[f'upper{level}'])
        for band, actual in zip(bands['bands'], actuals, strict=True))) / horizon)
        for level in (80,95)}
    return dict(status='available', model=selection['model'],
                train_to=str(start+timedelta(days=len(series)-horizon-1)),
                test_from=str(start+timedelta(days=len(series)-horizon)),
                test_to=str(start+timedelta(days=len(series)-1)), count=horizon,
                forecast=[rounded(v) for v in predictions], bands=bands['bands'],
                calibration=bands['residual_count'], **coverage)


def forecast_item(item: dict, cutoff: date, horizon: int) -> dict:
    start, series = daily_series(item)
    row = dict(item_id=item['item_id'], status='insufficient', model=None, scores=[], folds=[],
               forecast=[], total=None, unavailable_models=[],
               uncertainty={'status':'unavailable','bands':[]}, evaluation={'status':'unavailable'})
    if item.get('unit_provenance', {}).get('status') == 'conflicting':
        return dict(row, status='incompatible_units')
    discontinued = item.get('discontinued_on')
    if start > cutoff or (discontinued and date.fromisoformat(discontinued) <= cutoff):
        return dict(row, status='outside_lifecycle')
    if len(series) < MIN_TRAIN+3*horizon:
        return row
    selection, predictions, residuals = select(series, horizon)
    # Seed depends on the immutable item identity and observation window, not holdout outcomes.
    seed = f'{VERSION}:{item["item_id"]}:{start}:{cutoff}:{horizon}'
    uncertainty = bootstrap_bands(predictions, residuals, seed)
    future = []
    for i, value in enumerate(predictions):
        day = cutoff+timedelta(days=i+1)
        if discontinued and day > date.fromisoformat(discontinued):
            value = Decimal(0)
            if uncertainty['bands']:
                uncertainty['bands'][i] = dict.fromkeys(('lower95','lower80','upper80','upper95'), '0.000')
        future.append(dict(date=str(day), quantity=rounded(value)))
    folds = [dict(train_from=str(start), train_to=str(start+timedelta(days=n-1)),
                  test_from=str(start+timedelta(days=n)), test_to=str(start+timedelta(days=n+horizon-1)))
             for n in [len(series)-k*horizon for k in (3,2,1)]]
    return dict(row, **selection, status='selected', forecast=future, folds=folds,
                total=decimal_text(sum(Decimal(p['quantity']) for p in future)),
                uncertainty=uncertainty, evaluation=evaluation(series,horizon,start,seed))


def forecast(snapshot: dict) -> list[dict]:
    horizon = snapshot['options']['horizon']
    if snapshot.get('method') != VERSION or type(horizon) is not int or not 1 <= horizon <= 90 or not 1 <= len(snapshot['items']) <= 10:
        raise ValueError('Invalid expanded forecast bounds')
    with localcontext() as context:
        context.prec = 60
        return [forecast_item(item, date.fromisoformat(snapshot['to_date']), horizon) for item in snapshot['items']]
