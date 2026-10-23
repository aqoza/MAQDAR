"""Per-source calendars, immutable allocations and post-wait authority checks."""
import json
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from regional_dates_fixture import seed_regional_dates
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.regional_date_preview(%s,%s,'2026-10-10',true)"
SAVE = "select public.regional_date_save(%s,%s,'2026-10-10',true,%s,%s)"


@pytest.fixture
def dates(dsn):
    org, user = uuid4(), uuid4()
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Regional dates')", (org, f"regional-dates-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"regional-dates-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        parent, report = seed_regional_dates(db, org, user)
    assert report['status'] == 'available'
    yield (dsn, org, user), (org, parent), report
    with psycopg.connect(dsn) as db:
        db.execute("delete from public.organizations where id=%s", (org,))
        db.execute("delete from auth.users where id=%s", (user,))
        db.execute("delete from public.audit_log where organization_id=%s", (org,))


def test_independent_dispatches_and_receipts_keep_quantities(dates):
    fixture, inputs, report = dates
    lines = {line['location_code']: line for line in report['lines']}
    assert lines['SOURCE-A']['dispatch']['date'] == '2026-10-12'
    assert lines['SOURCE-B']['dispatch']['date'] == '2026-10-11'
    assert [(lines[code]['receipts']['p50']['search']['date'], lines[code]['receipts']['p90']['search']['date']) for code in ['SOURCE-A','SOURCE-B']] == [('2026-10-15','2026-10-17'),('2026-10-13','2026-10-15')]
    assert [line['quantity'] for line in report['lines']] == [line['quantity'] for line in report['source']['lines']]
    assert report['timing_reference_date'] == '2026-10-13'
    assert lines['SOURCE-B']['receipts']['p50']['timing_review_required'] is False
    assert lines['SOURCE-A']['receipts']['p50']['timing_review_required'] is True
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.stock_snapshots set quantity=999 where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        assert db.execute(PREVIEW, inputs).fetchone()[0] == report
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (inputs[0],)).fetchone()[0] == 0


@pytest.mark.parametrize('date', ['2026-10-09','1899-12-31','2101-01-01','infinity'])
def test_date_bounds(dates, date):
    fixture, inputs, _ = dates
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select public.regional_date_preview(%s,%s,%s,true)", (*inputs, date))
    assert error.value.sqlstate == 'MQ422'


@pytest.mark.parametrize('change,status', [
    ('sender','line_unavailable'),('receiver','destination_location_unavailable'),
    ('lane','line_unavailable'),('leads','line_unavailable'),('calendar','available'),
    ('inactive_calendar','line_unavailable'),('policy','destination_policy_unavailable'),
])
def test_changed_evidence_rejects_old_preview(dates, change, status):
    fixture, inputs, report = dates
    with psycopg.connect(fixture[0]) as db:
        if change in ('sender','receiver'):
            location = report['lines'][0]['location_id'] if change == 'sender' else report['receiver']['id']
            db.execute("update public.locations set is_active=false where id=%s", (location,))
        elif change == 'lane':
            db.execute("update public.network_links set is_active=false where organization_id=%s", (inputs[0],))
        elif change == 'leads':
            db.execute("update public.network_links set lead_time_days_p90=8 where organization_id=%s", (inputs[0],))
        elif change == 'calendar':
            db.execute("update public.work_calendars set weekend_days=array[]::integer[] where organization_id=%s", (inputs[0],))
        elif change == 'inactive_calendar':
            db.execute("update public.work_calendars set is_active=false where organization_id=%s", (inputs[0],))
        else:
            db.execute("delete from public.inventory_policies where id=%s", (report['policy_reference']['id'],))
    with session(fixture) as db:
        fresh = db.execute(PREVIEW, inputs).fetchone()[0]
    assert fresh['status'] == status
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ409'
    if status != 'available':
        with session(fixture) as db, pytest.raises(psycopg.Error) as error:
            db.execute(SAVE, (*inputs, uuid4(), fresh['fingerprint']))
        assert error.value.sqlstate == 'MQ422'


def test_missing_confirmation_unknown_days_and_bounded_partial_receipts(dates):
    fixture, inputs, original = dates
    with session(fixture) as db:
        report = db.execute(PREVIEW.replace('true','false'), inputs).fetchone()[0]
        assert report['status'] == 'calendars_unconfirmed'
        assert all(line['dispatch'] is None for line in report['lines'])
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('true','false'), (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.work_calendars set observe_public_holidays=true where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        report = db.execute(PREVIEW.replace('2026-10-10','2099-10-10'), inputs).fetchone()[0]
        assert report['status'] == 'line_unavailable'
        assert all(line['dispatch']['status'] == 'calendar_unknown' for line in report['lines'])
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.work_calendars set observe_public_holidays=false where organization_id=%s", (inputs[0],))
        calendar = db.execute("select work_calendar_id from public.locations where id=%s", (original['receiver']['id'],)).fetchone()[0]
        db.execute("insert into public.holiday_overrides(organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values(%s,%s,'2026-10-16','2027-10-16','closure','Test closure')", (inputs[0], calendar))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
    line = next(line for line in report['lines'] if line['location_code']=='SOURCE-A')
    assert report['status'] == 'line_unavailable'
    assert line['receipts']['p50']['search']['date'] == '2026-10-15'
    assert line['receipts']['p90']['search']['status'] == 'search_exhausted'
    assert len(line['receipts']['p90']['search']['days']) == 90
    assert line['receipts']['p90']['timing_review_required'] is None
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'


@pytest.mark.parametrize('all_zero', [False, True])
def test_zero_sources_need_no_dates_but_keep_location_and_lane_checks(dates, all_zero):
    fixture, inputs, original = dates
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set lead_time_days_p50=0,lead_time_days_p90=0 where organization_id=%s", (inputs[0],))
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s and (location_id=%s or %s)", (inputs[0], original['lines'][0]['location_id'], all_zero))
    with session(fixture) as db:
        selection = original['source']['input']
        sourcing = db.execute("select public.regional_sourcing_preview(%s,%s)", (inputs[0], Jsonb(selection))).fetchone()[0]
        parent = db.execute("select public.regional_sourcing_save(%s,%s,%s,%s)", (inputs[0], Jsonb(selection), uuid4(), sourcing['fingerprint'])).fetchone()[0]
        report = db.execute(PREVIEW.replace('true','false') if all_zero else PREVIEW, (inputs[0],parent)).fetchone()[0]
        assert report['status'] == ('no_transfer_needed' if all_zero else 'available')
        for line in report['lines']:
            if line['quantity']=='0.000':
                assert line['dispatch'] is None and line['source_calendar'] is None and line['receipts']=={}
            else:
                assert line['receipts']['p50']['search']['date'] == line['dispatch']['date']
                assert line['receipts']['p90']['timing_review_required'] is False
        db.execute(SAVE.replace('true','false') if all_zero else SAVE, (inputs[0],parent,uuid4(),report['fingerprint']))
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set is_active=false where from_location_id=%s", (original['lines'][0]['location_id'],))
    with session(fixture) as db:
        assert db.execute(PREVIEW,(inputs[0],parent)).fetchone()[0]['status']=='line_unavailable'


def test_concurrent_retries_and_copied_history_after_source_deletion(dates):
    fixture, inputs, report = dates
    args = (*inputs, uuid4(), report['fingerprint'])
    with session(fixture) as first, session(fixture) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(fixture[0]) as db:
        assert db.execute("select report from public.regional_date_scenarios where organization_id=%s", (inputs[0],)).fetchall()==[(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='regional_date_scenarios' and operation='INSERT'", (inputs[0],)).fetchone()[0]==1
        db.execute("delete from public.stock_regions where organization_id=%s", (inputs[0],))
        db.execute("delete from public.inventory_policies where organization_id=%s", (inputs[0],))
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        saved = db.execute(SAVE,args).fetchone()[0]
        assert db.execute("select report from public.regional_date_scenarios where id=%s", (saved,)).fetchone()[0]==report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('2026-10-10','2026-10-11'),args)
    assert error.value.sqlstate=='MQ409'
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.regional_sourcing_scenarios where id=%s", (inputs[1],))
        assert db.execute("select count(*) from public.regional_date_scenarios where id=%s", (saved,)).fetchone()[0]==0


@pytest.mark.parametrize('retry', [False, True])
@pytest.mark.parametrize('change', ['role','membership'])
def test_request_wait_rechecks_authority(dates, retry, change):
    fixture, inputs, report = dates
    args = (*inputs, uuid4(), report['fingerprint'])
    if retry:
        with session(fixture) as db:
            db.execute(SAVE,args)
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-dates:'||%s||':'||%s,0))", (str(inputs[0]),str(args[2])))
        call = _Call(waiting,SAVE,args); call.start(); time.sleep(.3)
        assert not call.finished
        if change=='role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s", (inputs[0],))
        else:
            admin.execute("delete from public.memberships where organization_id=%s", (inputs[0],))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ403'


@pytest.mark.parametrize('lock,change,expected', [
    ('locations','calendar','MQ409'),('locations','role','MQ403'),
    ('region','archive','MQ404'),('parent','role','MQ403'),
])
def test_row_wait_rechecks_evidence_and_permissions(dates, lock, change, expected):
    fixture, inputs, report = dates
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        if lock=='locations':
            admin.execute("select id from public.locations where organization_id=%s order by id for update", (inputs[0],))
        elif lock=='region':
            admin.execute("select id from public.stock_regions where organization_id=%s for update", (inputs[0],))
        else:
            admin.execute("select id from public.regional_sourcing_scenarios where id=%s for update", (inputs[1],))
        call=_Call(waiting,SAVE,(*inputs,uuid4(),report['fingerprint'])); call.start(); time.sleep(.3)
        assert not call.finished
        if change=='calendar':
            admin.execute("update public.work_calendars set weekend_days=array[]::integer[] where organization_id=%s", (inputs[0],))
        elif change=='archive':
            admin.execute("update public.stock_regions set archived_at=now(),archived_by=%s where organization_id=%s", (fixture[2],inputs[0]))
        else:
            admin.execute("update public.memberships set role='viewer' where organization_id=%s", (inputs[0],))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate==expected


def test_save_then_archive_retains_retry(dates):
    fixture, inputs, report = dates
    args=(*inputs,uuid4(),report['fingerprint'])
    with session(fixture) as saving, session(fixture) as archiving:
        saved=saving.execute(SAVE,args).fetchone()[0]
        call=_Call(archiving,"select public.stock_region_archive(%s,%s)",(inputs[0],report['source']['region']['id']))
        call.start(); time.sleep(.3); assert not call.finished
        saving.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate is None
        archiving.commit()
    with session(fixture) as db:
        assert db.execute(SAVE,args).fetchone()[0]==saved
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(*inputs,uuid4(),report['fingerprint']))
    assert error.value.sqlstate=='MQ404'


def test_complete_location_access_and_foreign_claim(dates):
    fixture, inputs, report = dates
    with session(fixture) as db:
        saved=db.execute(SAVE,(*inputs,uuid4(),report['fingerprint'])).fetchone()[0]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s", (inputs[0],))
        db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and id<>%s", (fixture[2],inputs[0],report['lines'][0]['location_id']))
    with session(fixture) as db:
        assert db.execute("select count(*) from public.regional_date_list").fetchone()[0]==0
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW,inputs)
    assert error.value.sqlstate=='MQ404'
    with psycopg.connect(fixture[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)",(inputs[0],fixture[2],report['lines'][0]['location_id']))
    with session(fixture) as db:
        assert db.execute("select report from public.regional_date_scenarios where id=%s",(saved,)).fetchone()[0]==report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=str(fixture[2]),org_id=str(uuid4()),role='authenticated')),))
        db.execute(PREVIEW,inputs)
    assert error.value.sqlstate=='MQ404'
