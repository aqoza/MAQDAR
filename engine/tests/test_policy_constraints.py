from copy import deepcopy

import pytest

from maqdar_engine.policy_simulation import calculate as original_calculate
from maqdar_engine.policy_constraints import calculate
from test_policy_simulation import task as original_task


def config(maximum='6', lead=1, review=2, moq='0', pack='0.001'):
    return dict(maximum=maximum, lead_time=lead, review_interval=review, moq=moq, pack=pack)


def task(configurations=None, **kwargs):
    original = original_task(**kwargs)
    original['output'] = original_calculate(original)
    return dict(original, method='periodic-constraints-v1', options=dict(
        original['options'], reuse_confirmed=True,
        configurations=configurations if configurations is not None else [config(lead=0, review=1), config(), config(lead=365, review=365)],
    ), source_simulation=dict(run_id='source', evidence=original))


def test_hand_calculated_short_and_long_leads_preserve_source():
    source = task()
    before = deepcopy(source)
    baseline, immediate, same, deferred = calculate(source)['variants']
    assert source == before
    assert {k: v for k, v in baseline.items() if k not in ('lead_time', 'review_interval', 'moq', 'pack')} == source['source_simulation']['evidence']['output']['variants'][0]
    assert strip_rounding(same['ledger']) == baseline['ledger']
    assert immediate['metrics']['immediate_fill_rate'] == '1'
    assert immediate['metrics']['average_closing_stock'] == '2'
    assert immediate['metrics']['ordered_quantity'] == '16'
    assert immediate['metrics']['ending_on_order'] == '0'
    assert deferred['metrics']['immediate_fill_rate'] == '0.125'
    assert deferred['metrics']['order_count'] == 1
    assert deferred['metrics']['received_quantity'] == '0'
    assert deferred['metrics']['ending_on_order'] == '4'
    assert deferred['metrics']['ending_backlog'] == '14'
    assert deferred['ledger'][0]['order_due'] == '2027-01-02'
    assert len(deferred['ledger']) == 4


def test_reviews_start_first_day_then_at_configured_interval_and_receipts_clear_backlog():
    result = calculate(task([config(lead=3, review=1), config(lead=3, review=3)]))
    daily = result['variants'][1]
    assert daily['metrics']['ending_backlog'] == '10'
    assert daily['metrics']['ending_on_order'] == '12'
    assert daily['metrics']['ordered_quantity'] == '16'
    assert daily['ledger'][3]['backlog_fulfilled'] == '4'
    assert [row['review'] for row in result['variants'][2]['ledger']] == [True, False, False, True]


@pytest.mark.parametrize('lead,review', [(0, 1), (1, 2), (7, 14), (89, 1)])
def test_matches_original_replay_when_settings_fit_original_constraints(lead, review):
    source = task([config('0.001', lead, review), config('999999999999999.999', lead, review)],
                  sales=['0.001', '3.125', 0, 2] * 22)
    for actual in calculate(source)['variants'][1:]:
        independent = deepcopy(source['source_simulation']['evidence'])
        independent['options']['alternative_maximum'] = actual['maximum']
        independent['policy'].update(lead_time=lead, review_interval=review)
        expected = original_calculate(independent)['variants'][1]
        assert strip_rounding(actual['ledger']) == expected['ledger']
        assert {k:v for k,v in actual['metrics'].items() if k != 'rounding_extra_quantity'} == expected['metrics']


def test_ten_configurations_and_zero_demand():
    result = calculate(task([config(str(n), 365, 365) for n in range(10)], sales=[0, 0]))
    assert len(result['variants']) == 11
    assert all(row['metrics']['immediate_fill_rate'] is None for row in result['variants'])
    assert all(row['metrics']['lost_sales_quantity'] == '2.25' for row in result['variants'])


@pytest.mark.parametrize('configs', [[], [config()] * 11, [config(), config()],
    [config('2'), config('1')], [config('01')], [config('-1')], [config('1e3')],
    [config('0.0001')], [config('1000000000000000')], [config(1)], [config(lead=-1)],
    [config(lead=366)], [config(lead=True)], [config(lead=1.5)], [config(review=0)],
    [config(review=366)], [config(review='1')], [dict(config(), extra=1)], '1'])
def test_invalid_configurations(configs):
    with pytest.raises(ValueError):
        calculate(task(configs))


@pytest.mark.parametrize('change', ['method', 'reuse', 'opening', 'demand', 'policy', 'output', 'source_method'])
def test_rejects_changed_or_unconfirmed_source(change):
    source = deepcopy(task())
    source['policy'] = deepcopy(source['policy'])
    source['demand'] = deepcopy(source['demand'])
    if change == 'method': source['method'] = 'other'
    if change == 'reuse': source['options']['reuse_confirmed'] = False
    if change == 'opening': source['options']['opening_stock'] = '3'
    if change == 'demand': source['demand'][0]['quantity'] = '999'
    if change == 'policy': source['policy']['lead_time'] = 0
    if change == 'output': source['source_simulation']['evidence']['output']['variants'][0]['metrics']['days'] = 9
    if change == 'source_method': source['source_simulation']['evidence']['method'] = 'periodic-sensitivity-v1'
    with pytest.raises(ValueError):
        calculate(source)


def strip_rounding(ledger):
    return [{k:v for k,v in row.items() if k not in ('order_gap','rounding_extra')} for row in ledger]


def test_hand_calculated_moq_and_fractional_pack_effects():
    result = calculate(task([config(lead=0, review=1, pack='2.5'), config(moq='10', pack='4')]))
    fractional, minimum = result['variants'][1:]
    assert [row['order_quantity'] for row in fractional['ledger']] == ['5','5','2.5','5']
    assert [row['order_gap'] for row in fractional['ledger']] == ['4','3','2','3.5']
    assert fractional['metrics']['ordered_quantity'] == '17.5'
    assert fractional['metrics']['rounding_extra_quantity'] == '5'
    assert fractional['metrics']['average_closing_stock'] == '3.25'
    assert fractional['metrics']['immediate_fill_rate'] == '1'
    assert [row['order_quantity'] for row in minimum['ledger']] == ['12','0','0','0']
    assert minimum['metrics']['rounding_extra_quantity'] == '8'
    assert minimum['metrics']['average_closing_stock'] == '2'
    assert minimum['metrics']['immediate_fill_rate'] == '0.75'
    assert minimum['metrics']['ending_backlog'] == '2'


def test_zero_gap_never_orders_for_moq_and_non_review_gap_is_zero():
    result=calculate(task([config('1',moq='999',pack='100')],sales=[0]*4))
    assert result['variants'][1]['metrics']['ordered_quantity']=='0'
    assert all(row['order_gap']=='0' and row['rounding_extra']=='0' for row in result['variants'][1]['ledger'])


@pytest.mark.parametrize('key,value', [(k,v) for k in ('moq','pack') for v in ('-1','NaN','1e3','0.0001','1000000000000000',None,True,1,'01','1.0')]+[('pack','0')])
def test_constraints_reject_invalid_or_noncanonical_quantities(key,value):
    c=config(); c[key]=value
    with pytest.raises(ValueError): calculate(task([c]))


def test_exact_small_pack_with_large_quantity_and_large_moq():
    from decimal import Decimal, localcontext
    from maqdar_engine.policy_constraints import rounded_order
    with localcontext() as context:
        context.prec=80
        assert rounded_order(Decimal('999999999999999.998'),Decimal(0),Decimal('0.007'))==Decimal('999999999999999.999')
        assert rounded_order(Decimal('0.001'),Decimal('999999999999999.998'),Decimal('0.007'))==Decimal('999999999999999.999')
        assert rounded_order(Decimal('999999999999999.999'),Decimal(0),Decimal('0.008'))==Decimal('1000000000000000')
