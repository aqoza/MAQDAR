from copy import deepcopy

import pytest

from zeespare_engine.policy_simulation import calculate as original_calculate
from zeespare_engine.policy_sensitivity import calculate
from test_policy_simulation import task as original_task


def task(maxima=None, **kwargs):
    original = original_task(**kwargs)
    original['output'] = original_calculate(original)
    return dict(original, method='periodic-sensitivity-v1', options=dict(
        original['options'], reuse_confirmed=True,
        alternative_maxima=maxima if maxima is not None else ['0', '6', '8'],
    ), source_simulation=dict(run_id='source', evidence=original))


def test_reproduces_source_and_equal_maximum_without_mutating_evidence():
    source = task()
    before = deepcopy(source)
    result = calculate(source)
    baseline, zero, same, alternative = result['variants']
    assert source == before
    assert baseline == source['source_simulation']['evidence']['output']['variants'][0]
    assert same['ledger'] == baseline['ledger']
    assert alternative['ledger'] == source['source_simulation']['evidence']['output']['variants'][1]['ledger']
    assert alternative['metrics']['immediate_fill_rate'] == '0.625'
    assert zero['metrics']['immediate_fill_rate'] == '0.125'
    assert [row['name'] for row in result['variants']] == ['baseline', 'alternative-1', 'alternative-2', 'alternative-3']


@pytest.mark.parametrize('lead,review', [(0, 1), (1, 2), (7, 14), (89, 1)])
def test_every_alternative_matches_independent_two_variant_replay(lead, review):
    source = task(maxima=['0', '0.001', '2.999', '999999999999999.999'],
                  sales=['0.001', '3.125', 0, 2] * 22, lead=lead, review=review)
    result = calculate(source)
    for actual in result['variants'][1:]:
        independent = deepcopy(source['source_simulation']['evidence'])
        independent['options']['alternative_maximum'] = actual['maximum']
        expected = original_calculate(independent)['variants'][1]
        assert actual['ledger'] == expected['ledger']
        assert actual['metrics'] == expected['metrics']


def test_ten_alternatives_and_zero_demand_keep_unavailable_ratio():
    result = calculate(task(maxima=[str(n) for n in range(10)], sales=[0, 0]))
    assert len(result['variants']) == 11
    assert all(row['metrics']['immediate_fill_rate'] is None for row in result['variants'])
    assert all(row['metrics']['lost_sales_quantity'] == '2.25' for row in result['variants'])


@pytest.mark.parametrize('maxima', [[], [str(n) for n in range(11)], ['2', '2.0'], ['2', '1'],
    ['01'], ['-1'], ['NaN'], ['1e3'], ['0.0001'], ['1000000000000000'], [1], '1'])
def test_invalid_maxima(maxima):
    with pytest.raises(ValueError):
        calculate(task(maxima=maxima))


@pytest.mark.parametrize('change', ['method', 'reuse', 'opening', 'demand', 'policy', 'output'])
def test_rejects_changed_or_unconfirmed_source(change):
    source = deepcopy(task())
    # Detach copied top-level objects so tampering does not also alter the source.
    source['policy'] = deepcopy(source['policy'])
    source['demand'] = deepcopy(source['demand'])
    if change == 'method': source['method'] = 'other'
    if change == 'reuse': source['options']['reuse_confirmed'] = False
    if change == 'opening': source['options']['opening_stock'] = '3'
    if change == 'demand': source['demand'][0]['quantity'] = '999'
    if change == 'policy': source['policy']['lead_time'] = 0
    if change == 'output': source['source_simulation']['evidence']['output']['variants'][0]['metrics']['days'] = 9
    with pytest.raises(ValueError):
        calculate(source)
