from copy import deepcopy
from decimal import Decimal

import pytest

from zeespare_engine.expanded_forecasting import forecast, bootstrap_bands, predict
from test_forecasting import task


def expanded(values, horizon=7):
    data = task(values, horizon)
    data['method'] = 'expanded-v1'
    return data


def test_expanded_compares_nine_models_and_is_reproducible():
    data = expanded([1, 2, 3, 4, 5, 6, 7]*16)
    first = forecast(data)[0]
    assert first == forecast(data)[0]
    assert len(first['scores']) == 9
    assert first['model'] == 'seasonal_naive'
    assert first['uncertainty']['status'] == 'available'
    assert first['evaluation']['status'] == 'available'
    assert first['evaluation']['coverage80'] == '1'
    assert first['evaluation']['test_to'] == data['to_date']


def test_holdout_never_selects_or_calibrates_its_own_forecast():
    before = expanded([2]*112)
    after = deepcopy(before)
    for row in after['items'][0]['demand'][-7:]:
        row[1] = '1000'
    a, b = forecast(before)[0], forecast(after)[0]
    assert a['evaluation']['model'] == b['evaluation']['model']
    assert a['evaluation']['forecast'] == b['evaluation']['forecast']
    assert a['evaluation']['bands'] == b['evaluation']['bands']
    assert a['evaluation']['coverage95'] != b['evaluation']['coverage95']


def test_short_calibration_and_holdout_are_explicit():
    result = forecast(expanded([1]*77))[0]
    assert result['status'] == 'selected'
    assert result['evaluation']['status'] == 'insufficient_history'
    assert forecast(expanded([1]*60, 1))[0]['uncertainty']['status'] == 'insufficient_residuals'
    assert forecast(expanded([1]*60, 1))[0]['evaluation']['status'] == 'insufficient_residuals'


def test_bootstrap_is_nonnegative_nested_and_reproducible():
    values = [Decimal(1)]*7
    residuals = list(map(Decimal, range(-10, 11)))
    a = bootstrap_bands(values, residuals, 'seed')
    assert a == bootstrap_bands(values, residuals, 'seed')
    for band in a['bands']:
        assert 0 <= Decimal(band['lower95']) <= Decimal(band['lower80']) <= Decimal(band['upper80']) <= Decimal(band['upper95'])


@pytest.mark.parametrize('model', ['auto_ets', 'auto_arima'])
def test_automatic_models_fit_trend_and_return_finite_nonnegative_values(model):
    values = predict(list(map(Decimal, range(1, 80))), 7, model)
    assert len(values) == 7
    assert all(v.is_finite() and v >= 0 for v in values)
    assert values[-1] > 70


def test_failed_automatic_candidate_is_reported_without_losing_baselines(monkeypatch):
    from zeespare_engine import expanded_forecasting as module
    original = module.predict
    def fail(series, horizon, model):
        if model == 'auto_arima':
            raise ValueError('sensitive library failure')
        return original(series, horizon, model)
    monkeypatch.setattr(module, 'predict', fail)
    result = forecast(expanded([1]*112))[0]
    assert result['status'] == 'selected'
    assert result['unavailable_models'] == [{'model': 'auto_arima', 'reason': 'fit_failed'}]
    assert 'sensitive' not in str(result)


def test_expansion_limits_and_legacy_method_rejected():
    data = expanded([1]*112)
    data['items'] *= 11
    with pytest.raises(ValueError):
        forecast(data)
    with pytest.raises(ValueError):
        forecast(task([1]*112))


def test_short_or_ended_lifecycle_has_no_forecast_and_future_end_zeros_bands():
    assert forecast(expanded([1]*76))[0]['status'] == 'insufficient'
    data = expanded([1]*112)
    data['items'][0]['discontinued_on'] = data['to_date']
    assert forecast(data)[0]['status'] == 'outside_lifecycle'
    from datetime import date, timedelta
    data['items'][0]['discontinued_on'] = str(date.fromisoformat(data['to_date'])+timedelta(days=1))
    row = forecast(data)[0]
    assert row['total'] == '1.000'
    assert all(set(b.values()) == {'0.000'} for b in row['uncertainty']['bands'][1:])


def test_refit_failure_excludes_the_candidate_and_reselects(monkeypatch):
    from zeespare_engine import expanded_forecasting as module
    original = module.predict
    def fail_refit(series, horizon, model):
        if model == 'auto_arima':
            if len(series) == 112:
                raise ValueError('refit failed')
            # Perfect trend prediction ensures this candidate wins the backtests.
            return [series[-1]+i for i in range(1,horizon+1)]
        if model == 'auto_ets':
            raise ValueError('fit failed')
        return original(series,horizon,model)
    monkeypatch.setattr(module, 'predict', fail_refit)
    result = forecast(expanded(list(range(1,113))))[0]
    assert result['model'] in ('mean','naive','seasonal_naive','ses','croston','sba','tsb')
    assert {'model':'auto_arima','reason':'refit_failed'} in result['unavailable_models']


def test_nonfinite_automatic_predictions_are_rejected(monkeypatch):
    from zeespare_engine import expanded_forecasting as module
    import numpy as np
    monkeypatch.setattr(module.AutoETS, 'forecast', lambda *args, **kwargs: {'mean':np.array([np.nan]*7)})
    with pytest.raises(ValueError):
        predict([Decimal(1)]*70,7,'auto_ets')
    with pytest.raises(ValueError):
        predict([Decimal(1)]*70,7,'unknown')


def test_baseline_programming_errors_are_not_mislabeled_as_model_unavailability(monkeypatch):
    from zeespare_engine import expanded_forecasting as module
    monkeypatch.setattr(module, 'predict', lambda *args: (_ for _ in ()).throw(ValueError('bad baseline')))
    with pytest.raises(ValueError,match='bad baseline'):
        forecast(expanded([1]*112))


def test_compute_process_timeout_terminates_child():
    from zeespare_engine.forecast_process import compute
    with pytest.raises(ValueError,match='timed out'):
        compute(expanded([1]*112),timeout=0)


def test_compute_process_invalid_task_returns_generic_failure():
    from zeespare_engine.forecast_process import compute
    with pytest.raises(ValueError,match='computation failed'):
        compute({'secret':'do not expose'})


def test_baseline_refit_error_fails_attempt(monkeypatch):
    from zeespare_engine import expanded_forecasting as module
    original = module.predict
    def fail(series, horizon, model):
        if len(series)==112 and model=='mean':
            raise ValueError('baseline refit failed')
        return original(series,horizon,model)
    monkeypatch.setattr(module, 'predict', fail)
    with pytest.raises(ValueError,match='baseline refit failed'):
        forecast(expanded([1]*112))


def test_child_transport_sends_results_or_generic_failure_and_closes():
    from unittest.mock import MagicMock
    from zeespare_engine.forecast_process import _run
    sender=MagicMock()
    _run(sender,expanded([1]*10))
    assert sender.send.call_args.args[0][0]['status']=='insufficient'
    sender.close.assert_called_once()
    sender.reset_mock()
    _run(sender,{'secret':'hidden'})
    sender.send.assert_called_once_with(None)
    sender.close.assert_called_once()


def test_parent_reads_results_and_handles_child_crash(monkeypatch):
    from unittest.mock import MagicMock
    from zeespare_engine import forecast_process
    context=MagicMock()
    receiver,sender=MagicMock(),MagicMock()
    context.Pipe.return_value=receiver,sender
    context.Process.return_value.is_alive.return_value=False
    monkeypatch.setattr(forecast_process.multiprocessing,'get_context',lambda _: context)
    receiver.recv.return_value=[{'result':'ok'}]
    assert forecast_process.compute({})==[{'result':'ok'}]
    receiver.recv.side_effect=EOFError
    with pytest.raises(ValueError,match='process exited'):
        forecast_process.compute({})
