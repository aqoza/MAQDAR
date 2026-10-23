"""Network freight uses captured quantities/dates and current confirmed lane evidence."""
import json
import time
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session  # noqa: F401
from test_redistribution_db import redistribution  # noqa: F401
from test_network_allocation_db import network, SAVE as ALLOCATION_SAVE, PREVIEW as ALLOCATION_PREVIEW  # noqa: F401
from test_network_dates_db import dates, SAVE as DATE_SAVE, PREVIEW as DATE_PREVIEW  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.network_freight_preview(%s,%s,true)"
SAVE = "select public.network_freight_save(%s,%s,true,%s,%s)"


@pytest.fixture
def freight(dates):
    fixture, inputs, report = dates
    with session(fixture) as db:
        parent = db.execute(DATE_SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(fixture[0]) as db:
        for index, line in enumerate(report['lines']):
            db.execute("""update public.network_links set freight_basis=%s,freight_cost=%s,currency=%s,
                freight_unit='EA',freight_valid_from='2026-10-12' where id=%s""",
                ('per_unit' if index == 0 else 'per_shipment', '1.235' if index == 0 else '8.765',
                 'SAR' if index == 0 else 'KWD', line['lane']['id']))
    with session(fixture) as db:
        result = db.execute(PREVIEW, (inputs[0], parent)).fetchone()[0]
    assert result['status'] == 'available'
    return fixture, (inputs[0], parent), result


def test_exact_line_rounding_and_separate_currency_totals(freight):
    _, _, report = freight
    first, second = report['lines']
    product = Decimal(first['quantity']) * Decimal('1.235')
    assert Decimal(first['exact_product']) == product
    assert Decimal(first['subtotal']) == product.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    assert second['subtotal'] == '8.765' and second['shipment_count'] == 1
    assert first['shipment_count'] is None
    assert report['totals'] == [
        dict(currency='KWD', minor_units=3, subtotal='8.765'),
        dict(currency='SAR', minor_units=2, subtotal=first['subtotal']),
    ]
    assert [x['quantity'] for x in report['lines']] == [x['quantity'] for x in report['source']['lines']]
    assert report['source']['dispatch']['date'] == '2026-10-12'
    assert all(x['receipts']['p90']['timing_review_required'] for x in report['source']['lines'])


def test_sum_rounded_lines_retains_individual_shipment_fees(freight):
    fixture, inputs, _ = freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("""update public.network_links set freight_basis='per_shipment',freight_cost=1.235,
            currency='SAR',freight_unit=null where organization_id=%s""", (inputs[0],))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
        assert [x['subtotal'] for x in report['lines']] == ['1.24', '1.24']
        assert report['totals'] == [dict(currency='SAR', minor_units=2, subtotal='2.48')]
        assert all(x['shipment_count'] == 1 for x in report['lines'])
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))


def test_aggregate_preserves_values_above_the_individual_line_bound(freight):
    fixture, inputs, _ = freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("""update public.network_links set freight_basis='per_shipment',
            freight_cost=999999999999999.999,currency='KWD' where organization_id=%s""", (inputs[0],))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
        assert report['status'] == 'available'
        assert report['totals'] == [dict(currency='KWD', minor_units=3, subtotal='1999999999999999.998')]
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))


@pytest.mark.parametrize("change,expected", [
    ("freight_basis='none',freight_cost=null,currency=null", "freight_unconfigured"),
    ("freight_unit=null", "unit_unknown"),
    ("freight_unit='SET'", "unit_mismatch"),
    ("freight_valid_from=null", "rate_date_unknown"),
    ("freight_valid_from='2026-10-13'", "rate_not_effective"),
    ("freight_cost=999999999999999.999", "amount_out_of_range"),
    ("is_active=false", "lane_unavailable"),
    ("lead_time_days_p90=9", "lane_changed"),
])
def test_one_unavailable_line_blocks_entire_save(freight, change, expected):
    fixture, inputs, previous = freight
    with psycopg.connect(fixture[0]) as db:
        # Changes are fixed test cases, never application input.
        db.execute(f"update public.network_links set {change} where id=%s", (previous['lines'][0]['terms']['id'],))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
        assert report['status'] == 'line_unavailable'
        assert report['lines'][0]['status'] == expected
        assert report['lines'][1]['status'] == 'available'
        assert report['totals'] == []
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), previous['fingerprint']))
    assert error.value.sqlstate == 'MQ409'


@pytest.mark.parametrize("endpoint", ["source", "branch"])
def test_active_endpoints_required(freight, endpoint):
    fixture, inputs, previous = freight
    location = previous['source_location_id'] if endpoint == 'source' else previous['lines'][0]['location_id']
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.locations set is_active=false where id=%s", (location,))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
        assert report['status'] == ('source_location_unavailable' if endpoint == 'source' else 'line_unavailable')
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'


def test_recreated_lane_identity_is_not_a_substitute(freight):
    fixture, inputs, report = freight
    lane = report['lines'][0]['terms']
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.network_links where id=%s", (lane['id'],))
        db.execute("""insert into public.network_links(organization_id,from_location_id,to_location_id,
            lead_time_days_p50,lead_time_days_p90,freight_basis,freight_cost,currency,freight_unit,freight_valid_from)
            values(%s,%s,%s,2,4,'per_unit',1.235,'SAR','EA','2026-10-12')""",
            (inputs[0], lane['from_location_id'], lane['to_location_id']))
    with session(fixture) as db:
        assert db.execute(PREVIEW, inputs).fetchone()[0]['lines'][0]['status'] == 'lane_unavailable'


def test_explicit_zero_rates_still_require_confirmation(freight):
    fixture, inputs, _ = freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set freight_cost=0 where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        report = db.execute(PREVIEW.replace('true', 'false'), inputs).fetchone()[0]
        assert all(x['status'] == 'terms_unconfirmed' for x in report['lines'])
        zero = db.execute(PREVIEW, inputs).fetchone()[0]
        assert zero['status'] == 'available' and all(Decimal(x['subtotal']) == 0 for x in zero['totals'])
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('true', 'false'), (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'


def test_zero_allocations_need_no_freight_but_keep_location_lane_checks(network):
    fixture, inputs, _ = network
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        allocation = db.execute(ALLOCATION_PREVIEW, inputs).fetchone()[0]
        parent = db.execute(ALLOCATION_SAVE, (*inputs, uuid4(), allocation['fingerprint'])).fetchone()[0]
        dates = db.execute(DATE_PREVIEW.replace('true', 'false'), (inputs[0], parent)).fetchone()[0]
        scenario = db.execute(DATE_SAVE.replace('true', 'false'), (inputs[0], parent, uuid4(), dates['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW.replace('true', 'false'), (inputs[0], scenario)).fetchone()[0]
        assert report['status'] == 'no_transfer_needed' and report['totals'] == []
        assert all(x['subtotal'] is None and x['status'] == 'no_transfer_needed' for x in report['lines'])
        db.execute(SAVE.replace('true', 'false'), (inputs[0], scenario, uuid4(), report['fingerprint']))
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set is_active=false where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        assert db.execute(PREVIEW.replace('true', 'false'), (inputs[0], scenario)).fetchone()[0]['status'] == 'line_unavailable'


def test_mixed_zero_branch_needs_no_price_and_does_not_block_complete_total(network):
    fixture, inputs, original = network
    first = original['lines'][0]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.stock_snapshots set quantity=100 where organization_id=%s and location_id=%s",
                   (inputs[0], first['location_id']))
        calendar = db.execute("""insert into public.work_calendars(organization_id,code,name_en,country_code,
            weekend_days,observe_public_holidays) values(%s,'FREIGHT','Freight','SA',array[]::integer[],false)
            returning id""", (inputs[0],)).fetchone()[0]
        db.execute("update public.locations set work_calendar_id=%s where organization_id=%s", (calendar, inputs[0]))
        db.execute("""update public.network_links set freight_basis='per_shipment',freight_cost=5,currency='SAR',
            freight_valid_from='2026-10-10' where organization_id=%s and to_location_id<>%s""",
            (inputs[0], first['location_id']))
    with session(fixture) as db:
        policy = first['evidence']['destination']['policy']['policy_id']
        gap = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (inputs[0], policy)).fetchone()[0]
        zero = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",
                          (inputs[0], policy, uuid4(), gap['fingerprint'])).fetchone()[0]
        drafts = [zero if str(x) == first['draft_id'] else x for x in inputs[1]]
        allocation = db.execute(ALLOCATION_PREVIEW, (inputs[0], drafts, inputs[2])).fetchone()[0]
        parent = db.execute(ALLOCATION_SAVE, (inputs[0], drafts, inputs[2], uuid4(), allocation['fingerprint'])).fetchone()[0]
        date_report = db.execute(DATE_PREVIEW, (inputs[0], parent)).fetchone()[0]
        scenario = db.execute(DATE_SAVE, (inputs[0], parent, uuid4(), date_report['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW, (inputs[0], scenario)).fetchone()[0]
        assert report['status'] == 'available'
        zero_line = next(x for x in report['lines'] if x['location_id'] == first['location_id'])
        assert zero_line['status'] == 'no_transfer_needed' and zero_line['subtotal'] is None
        assert zero_line['terms']['basis'] == 'none'
        assert report['totals'] == [dict(currency='SAR', minor_units=2, subtotal='5.00')]
        db.execute(SAVE, (inputs[0], scenario, uuid4(), report['fingerprint']))


def test_captured_dates_and_stock_are_not_refreshed(freight):
    fixture, inputs, original = freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (inputs[0],))
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (inputs[0],))
        db.execute("delete from public.inventory_policies where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        assert db.execute(PREVIEW, inputs).fetchone()[0] == original


def test_concurrent_retry_immutable_history_and_parent_cascade(freight):
    fixture, inputs, report = freight
    args = (*inputs, uuid4(), report['fingerprint'])
    with session(fixture) as first, session(fixture) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(fixture[0]) as db:
        assert db.execute("select report from public.network_freight_estimates where organization_id=%s", (inputs[0],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='network_freight_estimates'", (inputs[0],)).fetchone()[0] == 1
        db.execute("update public.network_links set freight_cost=5,is_active=false where organization_id=%s", (inputs[0],))
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (inputs[0],)).fetchone()[0] == 0
    with session(fixture) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
        assert db.execute("select report from public.network_freight_estimates where id=%s", (saved,)).fetchone()[0] == report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('true', 'false'), args)
    assert error.value.sqlstate == 'MQ409'
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.network_date_scenarios where id=%s", (inputs[1],))
        assert db.execute("select count(*) from public.network_freight_estimates where id=%s", (saved,)).fetchone()[0] == 0


@pytest.mark.parametrize("change", ["role", "membership", "price"])
def test_advisory_wait_rechecks_authority_and_rates(freight, change):
    fixture, inputs, report = freight
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.network-freight:'||%s,0))", (str(inputs[0]),))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change == 'price':
            admin.execute("update public.network_links set freight_cost=5 where organization_id=%s", (inputs[0],))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        else:
            admin.execute("delete from public.memberships where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ409' if change == 'price' else 'MQ403')


def test_parent_wait_rechecks_editor(freight):
    fixture, inputs, report = freight
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select id from public.network_date_scenarios where id=%s for update", (inputs[1],))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(.3)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ403'


def test_all_location_authority_and_forged_claim(freight):
    fixture, inputs, report = freight
    with session(fixture) as db:
        saved = db.execute(SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    locations = [report['source_location_id']] + [x['location_id'] for x in report['lines']]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        for loc in locations[:-1]:
            db.execute("insert into public.membership_locations values(%s,%s,%s)", (inputs[0], fixture[2], loc))
    with session(fixture) as db:
        assert db.execute("select count(*) from public.network_freight_list").fetchone()[0] == 0
        assert db.execute("select count(*) from public.network_freight_estimates where id=%s", (saved,)).fetchone()[0] == 0
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW, inputs)
    assert error.value.sqlstate == 'MQ404'
    with psycopg.connect(fixture[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)", (inputs[0], fixture[2], locations[-1]))
    with session(fixture) as db:
        assert db.execute(PREVIEW, inputs).fetchone()[0] == report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ403'
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(fixture[2]),org_id=str(uuid4()),role='authenticated')),))
        db.execute(PREVIEW, inputs)
    assert error.value.sqlstate == 'MQ404'
