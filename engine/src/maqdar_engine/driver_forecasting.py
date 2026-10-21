"""Single-driver comparisons conditional on captured, source-declared availability."""
from datetime import date, timedelta
from decimal import Decimal, localcontext
from numpy.linalg import LinAlgError

from maqdar_engine.expanded_forecasting import MODELS as EXISTING_MODELS, bootstrap_bands, predict, rounded
from maqdar_engine.forecasting import MIN_TRAIN, MODELS as BASELINES, accuracy, daily_series, decimal_text

VERSION = 'driver-v1'
MODELS = (*EXISTING_MODELS, 'driver_weekday')
RIDGE = Decimal('0.01')
MAX_PREDICTION = Decimal('1e30')


class DriverUnavailable(ValueError):
    def __init__(self, reason, day=None, phase=None):
        super().__init__(reason)
        self.detail = dict(reason=reason, date=day, phase=phase)


def driver_values(rows, days, cutoff, phase):
    values = []
    for day in days:
        row = rows.get(str(day))
        if row is None or row.get('value') is None:
            raise DriverUnavailable('driver_missing', str(day), phase)
        if date.fromisoformat(row['available_on']) > cutoff:
            raise DriverUnavailable('driver_late', str(day), phase)
        value = Decimal(row['value'])
        if not value.is_finite() or abs(value) >= Decimal('1e12'):
            raise ValueError('Invalid driver value')
        values.append(value)
    return values


def driver_predict(series, start, horizon, rows):
    """Unpenalized weekday intercepts plus one fixed ridge-penalized driver slope.

    All centering/scaling uses this training prefix. No hyperparameter search, lag
    search, interpolation, future measurement substitution or causal interpretation.
    """
    days = [start + timedelta(days=i) for i in range(len(series))]
    cutoff = days[-1]
    future = [cutoff + timedelta(days=i+1) for i in range(horizon)]
    x = driver_values(rows, days, cutoff, 'training')
    future_x = driver_values(rows, future, cutoff, 'prediction')
    center = sum(x) / len(x)
    scale = max(abs(v-center) for v in x)
    if not scale:
        raise DriverUnavailable('driver_constant')
    z = [(v-center)/scale for v in x]
    groups = [[i for i, day in enumerate(days) if day.weekday() == w] for w in range(7)]
    if any(not group for group in groups):
        raise ValueError('Insufficient weekday evidence')
    mean_y = [sum(series[i] for i in group)/len(group) for group in groups]
    mean_z = [sum(z[i] for i in group)/len(group) for group in groups]
    covariance = sum((z[i]-mean_z[day.weekday()])*(series[i]-mean_y[day.weekday()]) for i, day in enumerate(days))
    variance = sum((z[i]-mean_z[day.weekday()])**2 for i, day in enumerate(days))
    if not variance:
        raise DriverUnavailable('driver_constant')
    slope = covariance / (variance + len(series)*RIDGE)
    values = [max(Decimal(0), mean_y[day.weekday()] + slope*((v-center)/scale-mean_z[day.weekday()])) for day, v in zip(future, future_x, strict=True)]
    if any(not v.is_finite() or v > MAX_PREDICTION for v in values):
        raise ValueError('Driver prediction outside supported scale')
    fit = dict(status='available', penalty=decimal_text(RIDGE), center=decimal_text(center),
               scale=decimal_text(scale), slope=decimal_text(slope/scale),
               weekday_intercepts=[decimal_text(mean_y[w]-slope*(center/scale+mean_z[w])) for w in range(7)],
               training_min=decimal_text(min(x)), training_max=decimal_text(max(x)),
               extrapolated_dates=[str(day) for day, v in zip(future, future_x, strict=True) if v < min(x) or v > max(x)])
    return values, fit


def select(series, start, horizon, rows, *, candidate='driver_weekday', predictor=None):
    predictor = predictor or driver_predict
    scores, residuals, unavailable, checks = [], {}, [], []
    driver_fit = dict(status='unavailable')
    final_driver = None
    for model in (*EXISTING_MODELS, candidate):
        errors, folds = [], []
        try:
            for n in [len(series)-k*horizon for k in (3, 2, 1)]:
                if model == candidate:
                    check = dict(cutoff=str(start+timedelta(days=n-1)), stage='selection')
                    try:
                        predicted, _ = predictor(series[:n], start, horizon, rows)
                    except DriverUnavailable as error:
                        checks.append(dict(check, status='unavailable', **error.detail))
                        raise
                    checks.append(dict(check, status='available'))
                else:
                    predicted = predict(series[:n], horizon, model)
                current = [p-y for p, y in zip(predicted, series[n:n+horizon], strict=True)]
                errors.extend(current)
                folds.append(accuracy(current))
            if model == candidate:
                check = dict(cutoff=str(start+timedelta(days=len(series)-1)), stage='final')
                try:
                    final_driver, driver_fit = predictor(series, start, horizon, rows)
                except DriverUnavailable as error:
                    checks.append(dict(check, status='unavailable', **error.detail))
                    raise
                checks.append(dict(check, status='available'))
        except (ValueError, ArithmeticError, RuntimeError, LinAlgError) as error:
            if model in BASELINES:
                raise
            unavailable.append(dict(model=model, reason=error.detail['reason'] if isinstance(error, DriverUnavailable) else 'fit_failed'))
            continue
        scores.append(dict(model=model, **accuracy(errors), folds=folds))
        residuals[model] = [-error for error in errors]
    while scores:
        winner = min(scores, key=lambda s: Decimal(s['rmse']))
        try:
            predictions = final_driver if winner['model'] == candidate else predict(series, horizon, winner['model'])
            return dict(model=winner['model'], scores=scores, unavailable_models=unavailable,
                        driver_checks=checks, driver_model=driver_fit), predictions, residuals[winner['model']]
        except (ValueError, ArithmeticError, RuntimeError, LinAlgError):
            if winner['model'] in BASELINES:
                raise
            unavailable.append(dict(model=winner['model'], reason='refit_failed'))
            scores.remove(winner)
    raise ValueError('No forecast candidate')


def evaluation(series, start, horizon, rows, seed, *, candidate='driver_weekday', predictor=None):
    if len(series) < MIN_TRAIN + 4*horizon:
        return dict(status='insufficient_history')
    selection, predicted, residuals = select(series[:-horizon], start, horizon, rows, candidate=candidate, predictor=predictor)
    bands = bootstrap_bands(predicted, residuals, seed+':evaluation')
    if bands['status'] != 'available':
        return dict(status='insufficient_residuals', driver_checks=selection['driver_checks'])
    coverage = {f'coverage{level}': decimal_text(Decimal(sum(
        Decimal(b[f'lower{level}']) <= actual <= Decimal(b[f'upper{level}'])
        for b, actual in zip(bands['bands'], series[-horizon:], strict=True)))/horizon) for level in (80, 95)}
    return dict(status='available', model=selection['model'], train_to=str(start+timedelta(days=len(series)-horizon-1)),
                test_from=str(start+timedelta(days=len(series)-horizon)), test_to=str(start+timedelta(days=len(series)-1)),
                count=horizon, calibration=bands['residual_count'], forecast=[rounded(v) for v in predicted],
                bands=bands['bands'], driver_checks=selection['driver_checks'], **coverage)


def forecast_captured(snapshot, *, version=VERSION, candidate='driver_weekday', predictor=None, rows=None):
    horizon = snapshot['options']['horizon']
    if snapshot.get('method') != version or type(horizon) is not int or not 1 <= horizon <= 90 or len(snapshot['items']) != 1:
        raise ValueError('Invalid driver forecast')
    item = snapshot['items'][0]
    start, series = daily_series(item)
    cutoff = date.fromisoformat(snapshot['to_date'])
    if start+timedelta(days=len(series)-1) != cutoff or len(series) < MIN_TRAIN+3*horizon:
        raise ValueError('Invalid captured demand window')
    if rows is None:
        source_rows = snapshot['driver']['report']['input']['rows']
        rows = {r['date']: r for r in source_rows}
        if len(rows) != len(source_rows):
            raise ValueError('Duplicate driver dates')
    with localcontext() as context:
        context.prec = 60
        selection, predictions, residuals = select(series, start, horizon, rows, candidate=candidate, predictor=predictor)
        seed = f'{version}:{item["item_id"]}:{start}:{cutoff}:{horizon}'
        uncertainty = dict(bootstrap_bands(predictions, residuals, seed), driver_uncertainty_included=False)
        future = []
        for i, value in enumerate(predictions):
            day = cutoff+timedelta(days=i+1)
            if item.get('discontinued_on') and day > date.fromisoformat(item['discontinued_on']):
                value = Decimal(0)
                if uncertainty['bands']:
                    uncertainty['bands'][i] = dict.fromkeys(('lower95', 'lower80', 'upper80', 'upper95'), '0.000')
            future.append(dict(date=str(day), quantity=rounded(value)))
        return [dict(item_id=item['item_id'], status='selected', **selection, forecast=future,
                     total=decimal_text(sum(Decimal(p['quantity']) for p in future)),
                     folds=[dict(train_from=str(start), train_to=str(start+timedelta(days=n-1)),
                                 test_from=str(start+timedelta(days=n)), test_to=str(start+timedelta(days=n+horizon-1)))
                            for n in [len(series)-k*horizon for k in (3, 2, 1)]],
                     uncertainty=uncertainty, evaluation=evaluation(series, start, horizon, rows, seed, candidate=candidate, predictor=predictor))]


def forecast(snapshot):
    return forecast_captured(snapshot)
