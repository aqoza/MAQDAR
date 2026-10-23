"""Independent sessions check event-date retry identity and post-wait evidence."""

import time
from datetime import date, timedelta
from uuid import uuid4

import psycopg
import pytest

from test_event_suppliers_db import (
    event_supplier, event_draft, policy_event, event, planning,
    saved_forecast, enqueue_policy, worker,
)
from test_event_suppliers_db import test_real_worker_chain_through_supplier as build_real_supplier_chain
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.event_delivery_preview(%s,%s,'2026-10-10',true)"
SAVE = "select public.event_delivery_save(%s,%s,'2026-10-10',true,%s,%s)"


@pytest.fixture
def event_delivery(event_supplier):
    source, draft, report = event_supplier
    with session(source) as db:
        scenario = db.execute(
            "select public.event_supplier_save(%s,%s,'SUP',true,%s,%s)",
            (source[1], draft, uuid4(), report['fingerprint']),
        ).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        calendar = db.execute("""insert into public.work_calendars
            (organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
            values(%s,'TEST','Synthetic calendar','SA','{}',false) returning id""",
            (source[1],),
        ).fetchone()[0]
        db.execute('update public.suppliers set work_calendar_id=%s where organization_id=%s', (calendar, source[1]))
        db.execute('update public.locations set work_calendar_id=%s where organization_id=%s', (calendar, source[1]))
    with session(source) as db:
        preview = db.execute(PREVIEW, (source[1], scenario)).fetchone()[0]
        assert preview['status'] == 'available'
        assert preview['source'] == report
    return source, scenario, preview


def test_event_delivery_parallel_retries(event_delivery):
    source, scenario, report = event_delivery
    args = (source[1], scenario, uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select report from public.event_delivery_scenarios where organization_id=%s', (source[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_delivery_scenarios'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [
    ('role', 'MQ403'), ('membership', 'MQ403'), ('calendar', 'MQ409'),
    ('supplier', 'MQ409'), ('receiver', 'MQ409'), ('source', 'MQ409'), ('deleted', 'MQ404'),
])
def test_event_delivery_rechecks_after_wait(event_delivery, change, expected):
    source, scenario, report = event_delivery
    request = uuid4()
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-delivery:'||%s||':'||%s,0))", (str(source[1]), str(request)))
        call = _Call(waiting, SAVE, (source[1], scenario, request, report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'membership':
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        elif change == 'calendar':
            admin.execute('update public.work_calendars set weekend_days=array[5,6]::smallint[] where organization_id=%s', (source[1],))
        elif change == 'supplier':
            admin.execute('update public.suppliers set is_active=false where organization_id=%s', (source[1],))
        elif change == 'receiver':
            admin.execute('update public.locations set is_active=false where organization_id=%s', (source[1],))
        elif change == 'source':
            admin.execute("update public.event_supplier_scenarios set report=report||'{\"changed\":true}'::jsonb where id=%s", (scenario,))
        else:
            admin.execute('delete from public.event_supplier_scenarios where id=%s', (scenario,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_delivery_scenarios where organization_id=%s', (source[1],)).fetchone()[0] == 0


def test_real_worker_chain_through_delivery(planning):
    build_real_supplier_chain(planning)
    with psycopg.connect(planning[0]) as db:
        scenario, source = db.execute(
            'select id,report from public.event_supplier_scenarios where organization_id=%s',
            (planning[1],),
        ).fetchone()
        calendar = db.execute("""insert into public.work_calendars
            (organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
            values(%s,'WORKER','Synthetic calendar','SA','{}',false) returning id""",
            (planning[1],),
        ).fetchone()[0]
        db.execute('update public.suppliers set work_calendar_id=%s where organization_id=%s', (calendar, planning[1]))
        db.execute('update public.locations set work_calendar_id=%s where organization_id=%s', (calendar, planning[1]))
    cutoff = source['draft']['scenario']['event']['source']['cutoff']
    expected_receipt = date.fromisoformat(cutoff) + timedelta(days=source['terms']['lead_time'])
    with session(planning) as db:
        args = (planning[1], scenario, cutoff, True)
        report = db.execute('select public.event_delivery_preview(%s,%s,%s,%s)', args).fetchone()[0]
        assert report['status'] == 'available'
        assert report['source'] == source
        assert report['order_date'] == cutoff
        assert report['receipt_date'] == expected_receipt.isoformat()
        assert report['policy_recalculation_required'] is False
        assert db.execute('select public.event_delivery_save(%s,%s,%s,%s,%s,%s)', (*args, uuid4(), report['fingerprint'])).fetchone()[0]
