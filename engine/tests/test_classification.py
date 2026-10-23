from decimal import Decimal
import pytest

from zeespare_engine.classification import classify

OPTIONS = dict(adi='1.32', cv2='0.49', abc_a='0.8', abc_b='0.95', xyz_x='0.5', xyz_y='1')

def item(code='P1', days=4, positive=4, quantity='4', squares='4', cost='1', currency='SAR'):
    return dict(item_id=code, item_code=code, days=days, positive_days=positive,
                quantity=quantity, sum_squares=squares, unit_cost=cost, currency=currency)

def run(rows, options=None):
    return classify({'options': options or OPTIONS, 'items': rows})

@pytest.mark.parametrize('row,pattern', [
    (item(), 'smooth'),
    (item(days=8), 'intermittent'),
    (item(quantity='10', squares='82', positive=2, days=2), 'erratic'),
    (item(quantity='10', squares='82', positive=2, days=8), 'lumpy'),
    (item(quantity='0', squares='0', positive=0), 'no_sales'),
    (item(quantity='1', squares='1', positive=1), 'insufficient'),
    (item(quantity='0', squares='0', positive=0, days=0), 'outside_lifecycle'),
])
def test_patterns(row, pattern):
    assert run([row])[0]['pattern'] == pattern

def test_positive_sizes_cv_differs_from_zero_filled_daily_cv():
    result = run([item(days=8)])[0]
    assert Decimal(result['cv2']) == 0
    assert Decimal(result['daily_cv']) == 1
    assert result['xyz'] == 'Y'
    assert Decimal(result['adi']) == 2

def test_equality_and_custom_thresholds():
    result = run([item(days=8)], dict(OPTIONS, adi='2', xyz_x='1', xyz_y='2'))[0]
    assert result['pattern'] == 'intermittent'
    assert result['xyz'] == 'X'


def test_exact_default_boundaries_use_upper_pattern_category():
    # Positive demand sizes 3 and 17 have population CV² exactly 0.49.
    result = run([item(days=2, positive=2, quantity='20', squares='298')])[0]
    assert result['pattern'] == 'erratic'
    assert Decimal(result['cv2']) == Decimal('0.49')
    result = run([item(days=33, positive=25, quantity='25', squares='25')])[0]
    assert result['pattern'] == 'intermittent'
    assert Decimal(result['adi']) == Decimal('1.32')


def test_sufficient_statistics_match_dense_daily_variance():
    from random import Random
    from statistics import pvariance, mean
    random = Random(8)
    for _ in range(100):
        daily = [Decimal(random.randrange(0, 20)) / 1000 for _ in range(31)]
        positive = [v for v in daily if v > 0]
        row = item(days=len(daily), positive=len(positive), quantity=str(sum(daily)),
                   squares=str(sum(v*v for v in daily)))
        result = run([row])[0]
        assert abs(Decimal(result['cv2']) - pvariance(positive)/mean(positive)**2) < Decimal('1e-25')
        assert abs(Decimal(result['daily_cv'])**2 - pvariance(daily)/mean(daily)**2) < Decimal('1e-25')

def test_abc_ranks_each_currency_and_keeps_ties_together():
    rows = [item('A',quantity='80',squares='1600'), item('B',quantity='15',squares='56.25'),
            item('C',quantity='5',squares='6.25'), item('D',currency='KWD'),
            item('E',cost='0')]
    result = {r['item_id']:r for r in run(rows)}
    assert [result[k]['abc'] for k in 'ABCDE'] == ['A','B','C','A','N']
    tied = run([item('A'), item('B')])
    assert [r['abc'] for r in tied] == ['A','A']

def test_decimal_value_is_not_rounded_through_float():
    result = run([item(quantity='9007199254740993.123', squares='81129638414606697682466469103581.292129', positive=1)])[0]
    assert result['value'] == '9007199254740993.123'

def test_result_order_is_stable_and_inputs_are_unchanged():
    rows = [item('B'),item('A')]
    assert [r['item_id'] for r in run(rows)] == ['B','A']
    assert 'abc' not in rows[0]

@pytest.mark.parametrize('field,value', [('quantity','NaN'),('unit_cost','Infinity'),('sum_squares','-1')])
def test_invalid_source_values_fail_without_partial_results(field,value):
    row=item();row[field]=value
    with pytest.raises(ValueError):
        run([row])
