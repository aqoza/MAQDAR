"""Independent transactions verify delivery evidence freshness and authority."""

import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session
from test_supplier_scenarios_db import scenario, preview as supplier_preview, SAVE as SUPPLIER_SAVE
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.delivery_scenario_preview(%s,%s,'2026-10-10',true)"
SAVE = "select public.delivery_scenario_save(%s,%s,'2026-10-10',true,%s,%s)"


@pytest.fixture
def delivery(scenario):
    source, draft_id = scenario
    report = supplier_preview(scenario)
    with session(source) as db:
        supplier_id = db.execute(SUPPLIER_SAVE, (source[1], draft_id, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        calendar = db.execute("""insert into public.work_calendars
            (organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
            values(%s,'ALL','Every day','SA','{}',false) returning id""", (source[1],)).fetchone()[0]
        db.execute('update public.suppliers set work_calendar_id=%s where organization_id=%s', (calendar, source[1]))
        db.execute('update public.locations set work_calendar_id=%s where organization_id=%s', (calendar, source[1]))
    return source, supplier_id


def preview(delivery):
    with session(delivery[0]) as db:
        report = db.execute(PREVIEW, (delivery[0][1], delivery[1])).fetchone()[0]
        assert report['status'] == 'available'
        return report


def test_delivery_parallel_retries(delivery):
    source, supplier_id = delivery
    report = preview(delivery)
    args = (source[1], supplier_id, uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select report from public.delivery_scenarios where organization_id=%s', (source[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='delivery_scenarios'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('calendar', 'MQ409'), ('role', 'MQ403')])
def test_delivery_rechecks_after_lock_wait(delivery, change, expected):
    source, supplier_id = delivery
    report = preview(delivery)
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.delivery-scenario:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, SAVE, (source[1], supplier_id, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'calendar':
            admin.execute("update public.work_calendars set weekend_days=array[6,7]::smallint[] where organization_id=%s", (source[1],))
        else:
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.delivery_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 0
