"""Independent sessions verify network scheduling, evidence, access and immutable retries."""
import json
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session  # noqa: F401
from test_redistribution_db import redistribution  # noqa: F401
from test_network_allocation_db import network, SAVE as ALLOCATION_SAVE, PREVIEW as ALLOCATION_PREVIEW  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.network_date_preview(%s,%s,'2026-10-10',true)"
SAVE = "select public.network_date_save(%s,%s,'2026-10-10',true,%s,%s)"


@pytest.fixture
def dates(network):
    fixture, inputs, allocation = network
    with session(fixture) as db:
        parent = db.execute(ALLOCATION_SAVE, (*inputs, uuid4(), allocation['fingerprint'])).fetchone()[0]
    with psycopg.connect(fixture[0]) as db:
        source_calendar = db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'WAREHOUSE','Warehouse','SA',array[6,7],false) returning id", (inputs[0],)).fetchone()[0]
        db.execute("update public.locations set work_calendar_id=%s where id=%s", (source_calendar, allocation['source_location_id']))
        for index, line in enumerate(allocation['lines']):
            calendar = db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,'Branch','SA',%s,false) returning id", (inputs[0], f"BRANCH-{index}", [] if index == 0 else [3, 5])).fetchone()[0]
            db.execute("update public.locations set work_calendar_id=%s where id=%s", (calendar, line['location_id']))
    with session(fixture) as db:
        report = db.execute(PREVIEW, (inputs[0], parent)).fetchone()[0]
    assert report['status'] == 'available'
    return fixture, (inputs[0], parent), report


def test_one_dispatch_separate_receipts_preserve_quantities(dates):
    _, _, report = dates
    assert report['dispatch']['date'] == '2026-10-12'
    assert [(x['receipts']['p50']['search']['date'], x['receipts']['p90']['search']['date']) for x in report['lines']] == [
        ('2026-10-14', '2026-10-16'), ('2026-10-15', '2026-10-17')]
    assert [x['quantity'] for x in report['lines']] == [x['quantity'] for x in report['source']['lines']]
    assert all(x['timing_reference_date'] == '2026-10-13' for x in report['lines'])
    assert all(x['receipts']['p90']['timing_review_required'] for x in report['lines'])
    assert report['source']['lines'][0]['evidence']['destination']['orders_confirmed'] is True


@pytest.mark.parametrize("date", ["2026-10-09", "1899-12-31", "2101-01-01", "infinity"])
def test_invalid_dates_rejected(dates, date):
    fixture, inputs, _ = dates
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select public.network_date_preview(%s,%s,%s,true)", (*inputs, date))
    assert error.value.sqlstate == 'MQ422'


@pytest.mark.parametrize("change,expected", [
    ("source_inactive", "source_location_unavailable"),
    ("receiver_inactive", "line_unavailable"),
    ("lane_inactive", "line_unavailable"),
    ("lane_changed", "line_unavailable"),
    ("policy_deleted", "line_unavailable"),
    ("calendar_changed", "available"),
    ("calendar_inactive", "dispatch_unavailable"),
    ("calendar_unknown", "dispatch_unavailable"),
])
def test_changed_evidence_blocks_stale_save(dates, change, expected):
    fixture, inputs, report = dates
    source = report['source_location_id']
    branch = report['lines'][0]['location_id']
    with psycopg.connect(fixture[0]) as db:
        if change == 'source_inactive':
            db.execute("update public.locations set is_active=false where id=%s", (source,))
        elif change == 'receiver_inactive':
            db.execute("update public.locations set is_active=false where id=%s", (branch,))
        elif change == 'lane_inactive':
            db.execute("update public.network_links set is_active=false where organization_id=%s", (inputs[0],))
        elif change == 'lane_changed':
            db.execute("update public.network_links set lead_time_days_p90=8 where organization_id=%s", (inputs[0],))
        elif change == 'policy_deleted':
            db.execute("delete from public.inventory_policies where id=%s", (report['lines'][0]['policy_reference']['id'],))
        elif change == 'calendar_changed':
            db.execute("update public.work_calendars set weekend_days=array[5,6] where organization_id=%s", (inputs[0],))
        elif change == 'calendar_inactive':
            db.execute("update public.work_calendars set is_active=false where organization_id=%s", (inputs[0],))
        else:
            db.execute("update public.work_calendars set observe_public_holidays=true where organization_id=%s", (inputs[0],))
    sql = PREVIEW.replace('2026-10-10', '2099-10-10') if change == 'calendar_unknown' else PREVIEW
    with session(fixture) as db:
        fresh = db.execute(sql, inputs).fetchone()[0]
    assert fresh['status'] == expected
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ409'
    if expected != 'available':
        with session(fixture) as db, pytest.raises(psycopg.Error) as error:
            db.execute(SAVE.replace('2026-10-10', '2099-10-10') if change == 'calendar_unknown' else SAVE,
                       (*inputs, uuid4(), fresh['fingerprint']))
        assert error.value.sqlstate == 'MQ422'


def test_unconfirmed_and_partial_receipts_never_save(dates):
    fixture, inputs, original = dates
    with session(fixture) as db:
        report = db.execute(PREVIEW.replace('true', 'false'), inputs).fetchone()[0]
        assert report['status'] == 'calendars_unconfirmed' and report['dispatch'] is None
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('true', 'false'), (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'
    with psycopg.connect(fixture[0]) as db:
        calendar = db.execute("select work_calendar_id from public.locations where id=%s", (original['lines'][0]['location_id'],)).fetchone()[0]
        db.execute("insert into public.holiday_overrides(organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values(%s,%s,'2026-10-16','2027-10-16','closure','Test closure')", (inputs[0], calendar))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
        assert report['status'] == 'line_unavailable'
        assert report['lines'][0]['receipts']['p50']['search']['date'] == '2026-10-14'
        slow = report['lines'][0]['receipts']['p90']['search']
        assert slow['status'] == 'search_exhausted' and len(slow['days']) == 90
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'


def test_zero_pool_needs_no_calendar_or_policy_dates(network):
    fixture, inputs, _ = network
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        allocation = db.execute(ALLOCATION_PREVIEW, inputs).fetchone()[0]
        parent = db.execute(ALLOCATION_SAVE, (*inputs, uuid4(), allocation['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW.replace('true', 'false'), (inputs[0], parent)).fetchone()[0]
        assert report['status'] == 'no_transfer_needed'
        assert report['dispatch'] is None and report['source_calendar'] is None
        assert all(x['status'] == 'no_transfer_needed' and x['receipts'] == {} for x in report['lines'])
        db.execute(SAVE.replace('true', 'false'), (inputs[0], parent, uuid4(), report['fingerprint']))
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (inputs[0],)).fetchone()[0] == 0


def test_zero_leads_and_mixed_zero_branch_preserve_fixed_allocation(network):
    fixture, inputs, original = network
    first = original['lines'][0]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set lead_time_days_p50=0,lead_time_days_p90=0 where organization_id=%s", (inputs[0],))
        db.execute("update public.stock_snapshots set quantity=100 where organization_id=%s and location_id=%s", (inputs[0], first['location_id']))
        calendar = db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'ZERO','Zero lead','SA',array[]::integer[],false) returning id", (inputs[0],)).fetchone()[0]
        db.execute("update public.locations set work_calendar_id=%s where organization_id=%s", (calendar, inputs[0]))
    with session(fixture) as db:
        policy_id = first['evidence']['destination']['policy']['policy_id']
        gap = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (inputs[0], policy_id)).fetchone()[0]
        zero_draft = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)", (inputs[0], policy_id, uuid4(), gap['fingerprint'])).fetchone()[0]
        drafts = [zero_draft if str(x) == first['draft_id'] else x for x in inputs[1]]
        allocation = db.execute(ALLOCATION_PREVIEW, (inputs[0], drafts, inputs[2])).fetchone()[0]
        parent = db.execute(ALLOCATION_SAVE, (inputs[0], drafts, inputs[2], uuid4(), allocation['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW, (inputs[0], parent)).fetchone()[0]
        assert report['status'] == 'available' and report['dispatch']['date'] == '2026-10-10'
        zero = next(x for x in report['lines'] if x['location_id'] == first['location_id'])
        positive = next(x for x in report['lines'] if x['location_id'] != first['location_id'])
        assert zero['status'] == 'no_transfer_needed' and zero['receipts'] == {}
        for key in ('p50', 'p90'):
            assert positive['receipts'][key]['search']['date'] == '2026-10-10'
            assert positive['receipts'][key]['timing_review_required'] is False


def test_concurrent_retries_are_one_immutable_record(dates):
    fixture, inputs, report = dates
    args = (*inputs, uuid4(), report['fingerprint'])
    with session(fixture) as first, session(fixture) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(fixture[0]) as db:
        assert db.execute("select report from public.network_date_scenarios where organization_id=%s", (inputs[0],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='network_date_scenarios'", (inputs[0],)).fetchone()[0] == 1
        db.execute("delete from public.inventory_policies where organization_id=%s", (inputs[0],))
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
        assert db.execute("select report from public.network_date_scenarios where id=%s", (saved,)).fetchone()[0] == report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('2026-10-10', '2026-10-11'), args)
    assert error.value.sqlstate == 'MQ409'
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.network_allocation_scenarios where id=%s", (inputs[1],))
        assert db.execute("select count(*) from public.network_date_scenarios where id=%s", (saved,)).fetchone()[0] == 0


@pytest.mark.parametrize("change", ["role", "calendar", "scope"])
def test_waiting_save_rechecks_authority_and_evidence(dates, change):
    fixture, inputs, report = dates
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.network-dates:'||%s,0))", (str(inputs[0]),))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change == 'calendar':
            admin.execute("update public.work_calendars set weekend_days=array[5,6] where organization_id=%s", (inputs[0],))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        else:
            admin.execute("delete from public.memberships where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ409' if change == 'calendar' else 'MQ403')


def test_all_location_scope_and_foreign_claim(dates):
    fixture, inputs, report = dates
    args = (*inputs, uuid4(), report['fingerprint'])
    with session(fixture) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    locations = [report['source_location_id']] + [x['location_id'] for x in report['lines']]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        for location in locations[:-1]:
            db.execute("insert into public.membership_locations values(%s,%s,%s)", (inputs[0], fixture[2], location))
    with session(fixture) as db:
        assert db.execute("select count(*) from public.network_date_list").fetchone()[0] == 0
        assert db.execute("select count(*) from public.network_date_scenarios where id=%s", (saved,)).fetchone()[0] == 0
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW, inputs)
    assert error.value.sqlstate == 'MQ404'
    with psycopg.connect(fixture[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)", (inputs[0], fixture[2], locations[-1]))
    with session(fixture) as db:
        assert db.execute(PREVIEW, inputs).fetchone()[0] == report
        assert db.execute("select report from public.network_date_scenarios where id=%s", (saved,)).fetchone()[0] == report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, args)
    assert error.value.sqlstate == 'MQ403'
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(fixture[2]),org_id=str(uuid4()),role='authenticated')),))
        db.execute(PREVIEW, inputs)
    assert error.value.sqlstate == 'MQ404'


def test_parent_lock_wait_also_rechecks_editor(dates):
    fixture, inputs, report = dates
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select id from public.network_allocation_scenarios where id=%s for update", (inputs[1],))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(.3)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ403'
