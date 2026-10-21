from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, localcontext

import numpy as np
import pytest

from maqdar_engine import driver_forecasting as single
from maqdar_engine import multi_driver_forecasting as joint
from maqdar_engine.expanded_forecasting import predict as original_predict
from test_driver_forecasting import fixture as single_fixture


def fixture(count=2, days=140, horizon=14):
    task = single_fixture(days, horizon)
    first = task.pop('driver')
    task['method'] = joint.VERSION
    task['drivers'] = []
    for k in range(count):
        source = deepcopy(first)
        source['id'] = f'10000000-0000-4000-8000-{k+1:012d}'
        for i, row in enumerate(source['report']['input']['rows']):
            row['value'] = str((i * (17 + 2*k)) % (31 + 6*k) + 1)
        task['drivers'].append(source)
    for i, row in enumerate(task['items'][0]['demand']):
        row[1] = str(7 + date.fromisoformat(row[0]).weekday() + sum(
            (k+2) * int(source['report']['input']['rows'][i]['value']) for k, source in enumerate(task['drivers'])))
    return task


@pytest.fixture(autouse=True)
def bounded_models(monkeypatch):
    def predict(series, horizon, model):
        if model.startswith('auto_'):
            raise ValueError('Synthetic unavailable candidate')
        return original_predict(series, horizon, model)
    monkeypatch.setattr(single, 'predict', predict)


@pytest.mark.parametrize('count', [2, 5])
def test_joint_model_wins_with_all_coefficients_and_stable_order(count):
    task = fixture(count)
    before = deepcopy(task)
    output = joint.forecast(task)[0]
    assert output['model'] == joint.MODEL
    assert len(output['scores']) == 8
    assert len(output['driver_model']['predictors']) == count
    assert output['uncertainty']['status'] == 'available'
    assert output['uncertainty']['driver_uncertainty_included'] is False
    assert output['evaluation']['status'] == 'available'
    assert task == before
    task['drivers'].reverse()
    assert joint.forecast(task)[0] == output
    for k, evidence in enumerate(output['driver_model']['predictors']):
        assert abs(Decimal(evidence['slope']) - (k+2)) < Decimal('0.3')


@pytest.mark.parametrize('index,change,reason,phase', [
    (0, {'available_on': '2026-05-20'}, 'driver_late', 'training'),
    (98, {'available_on': '2026-04-09'}, 'driver_late', 'prediction'),
    (140, {'available_on': '2026-05-21'}, 'driver_late', 'prediction'),
    (4, {'value': None}, 'driver_missing', 'training'),
    (140, {'value': None}, 'driver_missing', 'prediction'),
])
def test_one_unavailable_driver_excludes_joint_without_dropping_it(index, change, reason, phase):
    task = fixture()
    task['drivers'][1]['report']['input']['rows'][index].update(change)
    output = joint.forecast(task)[0]
    assert dict(model=joint.MODEL, reason=reason) in output['unavailable_models']
    assert len(output['scores']) == 7
    assert output['driver_checks'][-1]['dataset_id'] == task['drivers'][1]['id']
    assert output['driver_checks'][-1]['phase'] == phase
    assert len(output['forecast']) == 14


@pytest.mark.parametrize('weekday_only', [False, True])
def test_constant_or_weekday_only_input_excludes_whole_joint_candidate(weekday_only):
    task = fixture()
    for row in task['drivers'][1]['report']['input']['rows']:
        row['value'] = str(date.fromisoformat(row['date']).weekday()) if weekday_only else '0.123456'
    output = joint.forecast(task)[0]
    assert dict(model=joint.MODEL, reason='driver_constant') in output['unavailable_models']
    assert output['driver_checks'][-1]['dataset_id'] == task['drivers'][1]['id']


def test_correlated_drivers_remain_explicit_and_regularized():
    task = fixture()
    task['drivers'][1]['report'] = deepcopy(task['drivers'][0]['report'])
    output = joint.forecast(task)[0]
    predictors = output['driver_model']['predictors']
    assert len(predictors) == 2
    assert predictors[0]['dataset_id'] != predictors[1]['dataset_id']
    assert abs(Decimal(predictors[0]['slope']) - Decimal(predictors[1]['slope'])) < Decimal('1e-50')


def test_decimal_solver_matches_independent_linear_algebra_oracle():
    matrix = [[Decimal('9.1'), Decimal('4'), Decimal('2')],
              [Decimal('4'), Decimal('7.1'), Decimal('1')],
              [Decimal('2'), Decimal('1'), Decimal('3.1')]]
    vector = [Decimal('7'), Decimal('-3'), Decimal('2')]
    with localcontext() as context:
        context.prec = 60
        result = joint.solve(matrix, vector)
    expected = np.linalg.solve(np.array(matrix, dtype=float), np.array(vector, dtype=float))
    assert np.allclose(np.array(result, dtype=float), expected, rtol=1e-13, atol=1e-13)
    with localcontext() as context:
        context.prec = 60
        for row, value in zip(matrix, vector, strict=True):
            assert abs(sum(a*b for a, b in zip(row, result, strict=True)) - value) < Decimal('1e-55')


def test_training_only_scaling_and_coefficients_reconstruct_forecast():
    task = fixture()
    start, series = single.daily_series(task['items'][0])
    rows = {s['id']: {r['date']: r for r in s['report']['input']['rows']} for s in task['drivers']}
    future = str(date.fromisoformat(task['to_date']) + timedelta(days=1))
    with localcontext() as context:
        context.prec = 60
        _, before = joint.predict(series, start, 14, rows)
        rows[task['drivers'][1]['id']][future]['value'] = '10000'
        values, after = joint.predict(series, start, 14, rows)
        assert before['weekday_intercepts'] == after['weekday_intercepts']
        for a, b in zip(before['predictors'], after['predictors'], strict=True):
            for key in ('center', 'scale', 'slope'):
                assert a[key] == b[key]
        expected = Decimal(after['weekday_intercepts'][date.fromisoformat(future).weekday()]) + sum(
            Decimal(p['slope']) * Decimal(rows[p['dataset_id']][future]['value']) for p in after['predictors'])
        assert abs(values[0] - expected) < Decimal('1e-50')
    assert future in after['predictors'][1]['extrapolated_dates']


def test_heldout_outcomes_cannot_change_evaluation_fit_or_bands():
    task = fixture()
    first = joint.forecast(task)[0]['evaluation']
    for row in task['items'][0]['demand'][-14:]:
        row[1] = '100000'
    second = joint.forecast(task)[0]['evaluation']
    for key in ('model', 'forecast', 'bands', 'driver_checks', 'calibration'):
        assert first[key] == second[key]
    assert first['coverage95'] != second['coverage95']


def test_invalid_capture_and_duplicate_sources_are_rejected():
    for count in (0, 1, 6):
        with pytest.raises(ValueError):
            joint.forecast(fixture(count))
    task = fixture()
    task['drivers'][1]['id'] = task['drivers'][0]['id']
    with pytest.raises(ValueError, match='Duplicate driver dataset'):
        joint.forecast(task)
    task = fixture()
    task['drivers'][1]['report']['input']['rows'].append(task['drivers'][1]['report']['input']['rows'][0])
    with pytest.raises(ValueError, match='Duplicate driver dates'):
        joint.forecast(task)


def test_single_driver_public_method_retains_its_versioned_output():
    task = single_fixture()
    result = single.forecast(task)[0]
    assert result['model'] == 'driver_weekday'
    assert 'predictors' not in result['driver_model']
    assert all('dataset_id' not in check for check in result['driver_checks'])
