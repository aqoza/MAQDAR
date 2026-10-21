from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
import pytest

from maqdar_engine import driver_forecasting as driver
from maqdar_engine.expanded_forecasting import predict as original_predict


def fixture(days=140, horizon=14):
    start=date(2026,1,1)
    values=[Decimal((i*17)%31+1) for i in range(days+horizon)]
    rows=[dict(date=str(start+timedelta(days=i)),value=str(v),kind='planned',available_on='2025-12-01') for i,v in enumerate(values)]
    item=dict(item_id='c3cc3da5-8273-48bb-9aa8-6da63c4c06ad',item_code='P',item_name='Part',start_day=str(start),
              end_day=str(start+timedelta(days=days-1)), introduced_on=None,discontinued_on=None,
              unit_provenance=dict(status='consistent',unit='EA'),
              demand=[[str(start+timedelta(days=i)),str(3*v+7+(start+timedelta(days=i)).weekday()),'2'] for i,v in enumerate(values[:days])])
    return dict(method='driver-v1',options=dict(horizon=horizon),to_date=item['end_day'],items=[item],driver=dict(report=dict(input=dict(rows=rows))))


@pytest.fixture(autouse=True)
def bounded_models(monkeypatch):
    def predict(series,horizon,model):
        if model.startswith('auto_'): raise ValueError('Synthetic unavailable candidate')
        return original_predict(series,horizon,model)
    monkeypatch.setattr(driver,'predict',predict)


def test_predictive_driver_wins_and_retains_conditional_bands():
    task=fixture()
    result=driver.forecast(task)[0]
    assert result['model']=='driver_weekday'
    assert len(result['scores'])==8
    assert len(result['driver_checks'])==4
    assert result['uncertainty']['driver_uncertainty_included'] is False
    assert result['uncertainty']['status']=='available'
    assert result['evaluation']['status']=='available'
    assert result==driver.forecast(task)[0]
    assert task['items'][0]['demand'][0][2]=='2'
    for band in result['uncertainty']['bands']:
        assert Decimal(0)<=Decimal(band['lower95'])<=Decimal(band['lower80'])<=Decimal(band['upper80'])<=Decimal(band['upper95'])


@pytest.mark.parametrize('index,change,reason,phase',[
 (0,{'available_on':'2026-05-20'},'driver_late','training'),
 (98,{'available_on':'2026-04-09'},'driver_late','prediction'),
 (140,{'available_on':'2026-05-21'},'driver_late','prediction'),
 (4,{'value':None},'driver_missing','training'),
 (140,{'value':None},'driver_missing','prediction'),
])
def test_missing_and_late_values_exclude_only_driver(index,change,reason,phase):
    task=fixture()
    task['driver']['report']['input']['rows'][index].update(change)
    output=driver.forecast(task)[0]
    assert output['model']!='driver_weekday'
    assert dict(model='driver_weekday',reason=reason) in output['unavailable_models']
    assert output['driver_checks'][-1]['phase']==phase
    assert len(output['forecast'])==14


def test_same_day_declaration_and_observed_kind_not_relabelled():
    task=fixture()
    task['driver']['report']['input']['rows'][0].update(kind='observed',available_on='2026-01-01')
    output=driver.forecast(task)[0]
    assert output['model']=='driver_weekday'
    assert task['driver']['report']['input']['rows'][0]['kind']=='observed'


def test_constant_driver_is_excluded():
    task=fixture()
    for row in task['driver']['report']['input']['rows']: row['value']='-0.123456'
    assert dict(model='driver_weekday',reason='driver_constant') in driver.forecast(task)[0]['unavailable_models']


def test_automatic_numerical_failure_excludes_only_affected_candidates(monkeypatch):
    def predict(series,horizon,model):
        if model.startswith('auto_'): raise driver.LinAlgError('Synthetic singular fit')
        return original_predict(series,horizon,model)
    monkeypatch.setattr(driver,'predict',predict)
    output=driver.forecast(fixture())[0]
    assert output['model']=='driver_weekday'
    for model in ('auto_ets','auto_arima'):
        assert dict(model=model,reason='fit_failed') in output['unavailable_models']


def test_final_holdout_outcomes_cannot_change_evaluation_predictions_or_bands():
    task=fixture()
    first=driver.forecast(task)[0]['evaluation']
    changed=deepcopy(task)
    for row in changed['items'][0]['demand'][-14:]: row[1]='100000'
    second=driver.forecast(changed)[0]['evaluation']
    for key in ('model','train_to','forecast','bands','driver_checks','calibration'): assert first[key]==second[key]
    assert first['coverage95']!=second['coverage95']


def test_train_only_scaling_and_inspectable_coefficients():
    task=fixture()
    start,series=driver.daily_series(task['items'][0])
    rows={r['date']:r for r in task['driver']['report']['input']['rows']}
    _,before=driver.driver_predict(series,start,14,rows)
    rows[str(date.fromisoformat(task['to_date'])+timedelta(days=1))]['value']='10000'
    values,after=driver.driver_predict(series,start,14,rows)
    for key in ('center','scale','slope','weekday_intercepts'): assert before[key]==after[key]
    day=date.fromisoformat(task['to_date'])+timedelta(days=1)
    expected=Decimal(after['weekday_intercepts'][day.weekday()])+Decimal(after['slope'])*10000
    assert abs(values[0]-expected)<Decimal('1e-20')
    assert str(day) in after['extrapolated_dates']


def test_small_horizon_explicitly_lacks_bands_and_short_history_lacks_holdout():
    output=driver.forecast(fixture(60,1))[0]
    assert output['uncertainty']['status']=='insufficient_residuals'
    output=driver.forecast(fixture(98,14))[0]
    assert output['evaluation']['status']=='insufficient_history'


def test_lifecycle_end_zeros_points_and_bands():
    task=fixture()
    task['items'][0]['discontinued_on']=str(date.fromisoformat(task['to_date'])+timedelta(days=1))
    output=driver.forecast(task)[0]
    assert all(Decimal(d['quantity'])==0 for d in output['forecast'][1:])
    assert all(all(Decimal(v)==0 for v in b.values()) for b in output['uncertainty']['bands'][1:])


def test_invalid_snapshot_is_rejected():
    for change in [dict(method='other'),dict(options={'horizon':False}),dict(items=[])]:
        with pytest.raises(ValueError): driver.forecast(fixture()|change)
    task=fixture()
    task['driver']['report']['input']['rows'].append(task['driver']['report']['input']['rows'][0])
    with pytest.raises(ValueError,match='Duplicate'): driver.forecast(task)
