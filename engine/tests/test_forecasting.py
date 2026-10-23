from datetime import date, timedelta
from decimal import Decimal

import pytest

from zeespare_engine.forecasting import MODELS, baseline, forecast


def task(values, horizon=7, **item_changes):
    start = date(2026, 1, 1)
    item = dict(item_id='part', start_day=str(start), end_day=str(start+timedelta(days=len(values)-1)),
                demand=[[str(start+timedelta(days=i)), str(v), '0'] for i, v in enumerate(values) if v],
                discontinued_on=None)
    item.update(item_changes)
    return dict(method='baseline-v1', to_date=item['end_day'], options={'horizon':horizon}, items=[item])


@pytest.mark.parametrize('model', MODELS)
def test_all_zero_history_is_finite(model):
    assert baseline([Decimal(0)]*56, 7, model) == [Decimal(0)]*7


def test_hand_calculated_baselines():
    series = list(map(Decimal, [2, 0, 4, 0]))
    assert baseline(series, 2, 'mean') == [Decimal('1.5')]*2
    assert baseline(series, 2, 'naive') == [0, 0]
    assert baseline(series, 2, 'ses') == [Decimal('1.818')]*2
    assert baseline(series, 2, 'croston')[0] == Decimal('2.2')/Decimal('1.1')
    assert baseline(series, 2, 'sba')[0] == Decimal('1.9')
    assert baseline(series, 2, 'tsb')[0] == Decimal('2.2')*Decimal('0.819')
    assert baseline(list(map(Decimal, range(1, 15))), 9, 'seasonal_naive') == list(map(Decimal, [8,9,10,11,12,13,14,8,9]))


def test_weekly_pattern_selects_seasonal_naive_and_persists_fold_dates():
    result = forecast(task([1,2,3,4,5,6,7]*20))[0]
    assert result['model'] == 'seasonal_naive'
    assert result['status'] == 'selected'
    assert result['scores'][2]['rmse'] == '0'
    assert [p['quantity'] for p in result['forecast']] == ['1.000','2.000','3.000','4.000','5.000','6.000','7.000']
    folds = result['folds']
    assert len(folds) == 3
    assert all(date.fromisoformat(f['train_to']) < date.fromisoformat(f['test_from']) for f in folds)
    assert folds[-1]['test_to'] == task([1]*140)['to_date']


def test_selection_has_no_held_out_data_leakage():
    # A spike confined to the last test fold cannot change the first two scores.
    before = forecast(task([1]*140))[0]
    after = forecast(task([1]*139+[1000]))[0]
    for a, b in zip(before['scores'], after['scores'], strict=True):
        assert a['folds'][:2] == b['folds'][:2]
    assert Decimal(after['scores'][0]['bias']) < 0  # forecast minus actual


def test_short_history_has_no_selected_model_or_fabricated_scores():
    result = forecast(task([1]*76))[0]  # 56 training + 3*7 test days needed
    assert result['status'] == 'insufficient'
    assert result['model'] is None and result['scores'] == [] and result['forecast'] == []


def test_complete_zero_history_and_ties_have_stable_winner():
    result = forecast(task([0]*77))[0]
    assert result['model'] == 'mean' and result['status'] == 'selected'
    assert all(p['quantity'] == '0.000' for p in result['forecast'])


def test_lifecycle_ended_before_cutoff_is_not_forecast():
    data = task([1]*140, discontinued_on='2026-04-01')
    assert forecast(data)[0]['status'] == 'outside_lifecycle'


def test_sparse_days_are_zero_and_lost_sales_do_not_change_forecasts():
    data = task(([0]*6+[7])*20)
    first = forecast(data)
    data['items'][0]['demand'][0][2] = '99999'
    assert forecast(data) == first


@pytest.mark.parametrize('value', ['NaN', '-1', 'Infinity'])
def test_invalid_source_is_rejected(value):
    data = task([1]*77)
    data['items'][0]['demand'][0][1] = value
    with pytest.raises(ValueError):
        forecast(data)


def test_duplicate_day_is_rejected():
    data = task([1]*77)
    data['items'][0]['demand'].append(data['items'][0]['demand'][0])
    with pytest.raises(ValueError):
        forecast(data)


def test_output_is_reproducible_and_preserves_decimal_input():
    data = task(['900719925474099.123']*77)
    assert forecast(data) == forecast(data)
    assert forecast(data)[0]['forecast'][0]['quantity'] == '900719925474099.123'


def test_leading_and_trailing_zeros_have_defined_intermittent_initialization():
    series = list(map(Decimal, [0,0,6,0,0]))
    assert baseline(series, 1, 'croston') == [Decimal(2)]
    assert baseline(series, 1, 'sba') == [Decimal('1.9')]
    assert abs(baseline(series, 1, 'tsb')[0] - Decimal('1.62')) < Decimal('1e-25')


def test_known_future_discontinuation_zeros_days_after_its_inclusive_end():
    data = task([1]*77)
    end = date.fromisoformat(data['to_date'])
    data['items'][0]['discontinued_on'] = str(end+timedelta(days=2))
    result = forecast(data)[0]
    assert result['total'] == '2.000'
    assert [p['quantity'] for p in result['forecast']] == ['1.000']*2+['0.000']*5


def test_introduction_after_cutoff_has_no_forecast():
    data = task([1]*77)
    data['items'][0].update(start_day='2027-01-01', demand=[])
    assert forecast(data)[0]['status'] == 'outside_lifecycle'


@pytest.mark.parametrize('change', [{'method':'future'}, {'options':{'horizon':0}}, {'options':{'horizon':91}}, {'items':[]}])
def test_invalid_task_is_rejected(change):
    data=task([1]*77)
    data.update(change)
    with pytest.raises(ValueError):
        forecast(data)


def test_history_bound_and_baseline_contracts():
    with pytest.raises(ValueError):
        forecast(task([1]*1097))
    for series, model in [([], 'mean'), ([Decimal(1)], 'unknown'), ([Decimal(1)], 'seasonal_naive')]:
        with pytest.raises(ValueError):
            baseline(series,7,model)


@pytest.mark.parametrize('horizon', [1,90])
def test_exact_history_boundary_for_horizon(horizon):
    result=forecast(task([1]*(56+3*horizon),horizon))[0]
    assert result['status']=='selected' and len(result['forecast'])==horizon
