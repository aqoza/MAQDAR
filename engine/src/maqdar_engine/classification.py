"""Version 1 daily classification from immutable sufficient statistics (no floats)."""
from collections import defaultdict
from decimal import Decimal, localcontext

VERSION = 'daily-v1'


def decimal(value) -> Decimal:
    result = Decimal(str(value))
    if not result.is_finite() or result < 0:
        raise ValueError('Invalid classification source')
    return result


def text(value: Decimal) -> str:
    return format(value, 'f')


def classify(snapshot: dict) -> list[dict]:
    """Population variance; zeros contribute to XYZ, only positive sizes to CV².

    ABC uses the share before each equal-value group, so the crossing group stays
    in the higher class. Currency groups never mix. Zero value is N.
    """
    with localcontext() as context:
        context.prec = 60
        options = {key: decimal(value) for key, value in snapshot['options'].items()
                   if key in {'adi','cv2','abc_a','abc_b','xyz_x','xyz_y'}}
        results = []
        groups = defaultdict(list)
        for item in snapshot['items']:
            days, positive = int(item['days']), int(item['positive_days'])
            total, squares, cost = (decimal(item[k]) for k in ('quantity','sum_squares','unit_cost'))
            if not 0 <= positive <= days or (positive == 0) != (total == 0):
                raise ValueError('Invalid classification counts')
            row = dict(item_id=item['item_id'], pattern='outside_lifecycle', abc='N', xyz='U',
                       adi=None, cv2=None, daily_cv=None, value=text(total*cost))
            if days:
                row['pattern'] = 'no_sales' if positive == 0 else 'insufficient'
            if positive:
                row['adi'] = text(Decimal(days)/positive)
            if positive >= 2:
                positive_variation = max(Decimal(0), positive*squares-total*total)
                daily_variation = max(Decimal(0), days*squares-total*total)
                row['cv2'] = text(positive_variation/(total*total))
                row['daily_cv'] = text((daily_variation/(total*total)).sqrt())
                intermittent = days >= options['adi']*positive
                variable = positive_variation >= options['cv2']*total*total
                row['pattern'] = ('lumpy' if variable else 'intermittent') if intermittent else ('erratic' if variable else 'smooth')
                row['xyz'] = ('X' if daily_variation <= options['xyz_x']**2*total*total
                              else 'Y' if daily_variation <= options['xyz_y']**2*total*total else 'Z')
            results.append(row)
            groups[item['currency']].append(row)
        for rows in groups.values():
            total_value = sum((Decimal(row['value']) for row in rows), Decimal(0))
            by_value = defaultdict(list)
            for row in rows:
                by_value[Decimal(row['value'])].append(row)
            prior = Decimal(0)
            for value in sorted(by_value, reverse=True):
                if value == 0:
                    continue
                category = 'A' if prior < options['abc_a']*total_value else 'B' if prior < options['abc_b']*total_value else 'C'
                for row in by_value[value]:
                    row['abc'] = category
                prior += value*len(by_value[value])
        return results
