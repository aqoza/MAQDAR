"""Reproducible daily sold-demand baselines; all calculations use Decimal."""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext

VERSION = 'baseline-v1'
MODELS = ('mean', 'naive', 'seasonal_naive', 'ses', 'croston', 'sba', 'tsb')
ALPHA = Decimal('0.1')
MIN_TRAIN = 56


def baseline(series: list[Decimal], horizon: int, model: str) -> list[Decimal]:
    """Fixed parameters/initialization are part of baseline-v1, never fitted on test data."""
    if not series or model not in MODELS:
        raise ValueError('Invalid baseline request')
    if model == 'mean':
        level = sum(series) / len(series)
    elif model == 'naive':
        level = series[-1]
    elif model == 'seasonal_naive':
        if len(series) < 7:
            raise ValueError('Weekly baseline needs seven days')
        return [series[-7 + i % 7] for i in range(horizon)]
    elif model == 'ses':
        level = series[0]
        for value in series[1:]:
            level += ALPHA * (value - level)
    else:
        first = next((i for i, value in enumerate(series) if value > 0), None)
        if first is None:
            return [Decimal(0)] * horizon
        size, interval = series[first], Decimal(first + 1)
        probability = Decimal(1) / interval
        last = first
        for i in range(first + 1, len(series)):
            value = series[i]
            probability += ALPHA * (Decimal(value > 0) - probability)
            if value > 0:
                size += ALPHA * (value - size)
                interval += ALPHA * (Decimal(i - last) - interval)
                last = i
        level = size * probability if model == 'tsb' else size / interval
        if model == 'sba':
            level *= 1 - ALPHA / 2
    return [level] * horizon


def decimal_text(value: Decimal) -> str:
    return format(value, 'f')


def accuracy(errors: list[Decimal]) -> dict:
    count = len(errors)
    return dict(rmse=decimal_text((sum(e * e for e in errors) / count).sqrt()),
                mae=decimal_text(sum(abs(e) for e in errors) / count),
                bias=decimal_text(sum(errors) / count))


def daily_series(item: dict) -> tuple[date, list[Decimal]]:
    start, end = date.fromisoformat(item['start_day']), date.fromisoformat(item['end_day'])
    days = max(0, (end - start).days + 1)
    if days > 1096:
        raise ValueError('History limit exceeded')
    values = [Decimal(0)] * days
    seen = set()
    for day, quantity, _lost in item['demand']:
        offset = (date.fromisoformat(day) - start).days
        value = Decimal(quantity)
        if offset in seen or not 0 <= offset < days or not value.is_finite() or value < 0:
            raise ValueError('Invalid forecast source')
        seen.add(offset)
        values[offset] = value
    return start, values


def forecast_item(item: dict, cutoff: date, horizon: int) -> dict:
    start, series = daily_series(item)
    row = dict(item_id=item['item_id'], status='insufficient', model=None,
               scores=[], folds=[], forecast=[], total=None)
    discontinued = item.get('discontinued_on')
    # Never extrapolate beyond a recorded lifecycle end, or from a future introduction.
    if start > cutoff or (discontinued and date.fromisoformat(discontinued) <= cutoff):
        return dict(row, status='outside_lifecycle')
    if len(series) < MIN_TRAIN + 3 * horizon:
        return row
    cutoffs = [len(series) - remaining * horizon for remaining in (3, 2, 1)]
    row['folds'] = [dict(train_from=str(start), train_to=str(start + timedelta(days=n-1)),
                         test_from=str(start + timedelta(days=n)),
                         test_to=str(start + timedelta(days=n+horizon-1))) for n in cutoffs]
    for model in MODELS:
        all_errors, folds = [], []
        for n in cutoffs:
            predictions = baseline(series[:n], horizon, model)
            errors = [predicted - actual for predicted, actual in
                      zip(predictions, series[n:n+horizon], strict=True)]
            all_errors.extend(errors)
            folds.append(accuracy(errors))
        row['scores'].append(dict(model=model, **accuracy(all_errors), folds=folds))
    winner = min(row['scores'], key=lambda score: Decimal(score['rmse']))
    predictions = baseline(series, horizon, winner['model'])
    # A future recorded discontinuation is a known boundary, not inferred obsolescence.
    future = []
    for i, value in enumerate(predictions, 1):
        day = cutoff + timedelta(days=i)
        if discontinued and day > date.fromisoformat(discontinued):
            value = Decimal(0)
        future.append(dict(date=str(day), quantity=decimal_text(value.quantize(Decimal('.001'), rounding=ROUND_HALF_UP))))
    return dict(row, status='selected', model=winner['model'], forecast=future,
                total=decimal_text(sum(Decimal(p['quantity']) for p in future)))


def forecast(snapshot: dict) -> list[dict]:
    if snapshot.get('method') != VERSION:
        raise ValueError('Unsupported forecast method')
    horizon = snapshot['options']['horizon']
    if type(horizon) is not int or not 1 <= horizon <= 90 or not 1 <= len(snapshot['items']) <= 100:
        raise ValueError('Invalid forecast bounds')
    cutoff = date.fromisoformat(snapshot['to_date'])
    with localcontext() as context:
        context.prec = 60
        return [forecast_item(item, cutoff, horizon) for item in snapshot['items']]
