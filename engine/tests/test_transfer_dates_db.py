"""Transfer-date saves serialize retries and recheck evidence and authority after waits."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session  # noqa: F401 -- shared isolated fixture
from test_redistribution_db import redistribution, SAVE as REDISTRIBUTION_SAVE  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.transfer_date_preview(%s,%s,'2026-10-10',true)"
SAVE = "select public.transfer_date_save(%s,%s,'2026-10-10',true,%s,%s)"


@pytest.fixture
def dates(redistribution):
    draft, inputs, report = redistribution
    with session(draft) as db:
        source = db.execute(REDISTRIBUTION_SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        calendar = db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,'DATES','Synthetic dates','SA',array[5,6],false) returning id", (draft[1],)).fetchone()[0]
        db.execute("update public.locations set work_calendar_id=%s where organization_id=%s", (calendar, draft[1]))
    with session(draft) as db:
        preview = db.execute(PREVIEW, (draft[1], source)).fetchone()[0]
        assert preview['status'] == 'available'
    return draft, (draft[1], source), preview


def test_parallel_retries_save_and_audit_once(dates):
    draft, inputs, preview = dates
    args = (*inputs, uuid4(), preview['fingerprint'])
    with session(draft) as first, session(draft) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select report from public.transfer_date_scenarios where organization_id=%s", (draft[1],)).fetchall() == [(preview,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='transfer_date_scenarios'", (draft[1],)).fetchone()[0] == 1


def test_conflicting_parallel_date_is_rejected(dates):
    draft, inputs, preview = dates
    with session(draft) as db:
        other = db.execute(PREVIEW.replace('2026-10-10', '2026-10-12'), inputs).fetchone()[0]
    request = uuid4()
    with session(draft) as first, session(draft) as second:
        call = _Call(second, SAVE.replace('2026-10-10', '2026-10-12'), (*inputs, request, other['fingerprint']))
        first.execute(SAVE, (*inputs, request, preview['fingerprint']))
        call.start()
        time.sleep(0.3)
        first.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'


@pytest.mark.parametrize('change', ['role', 'calendar', 'lane'])
def test_waiting_save_rechecks_authority_and_evidence(dates, change):
    draft, inputs, preview = dates
    with psycopg.connect(draft[0]) as admin, session(draft) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.transfer-dates:'||%s,0))", (str(draft[1]),))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), preview['fingerprint']))
        call.start()
        time.sleep(0.3)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (draft[1], draft[2]))
        elif change == 'calendar':
            admin.execute("update public.work_calendars set weekend_days=array[6,7] where organization_id=%s", (draft[1],))
        else:
            admin.execute("update public.network_links set lead_time_days_p90=5 where organization_id=%s", (draft[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ403' if change == 'role' else 'MQ409')
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select count(*) from public.transfer_date_scenarios where organization_id=%s", (draft[1],)).fetchone()[0] == 0


def test_saved_retry_retains_dates_after_calendar_lane_and_stock_changes(dates):
    draft, inputs, preview = dates
    args = (*inputs, uuid4(), preview['fingerprint'])
    with session(draft) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        db.execute("delete from public.network_links where organization_id=%s", (draft[1],))
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (draft[1],))
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (draft[1],))
    with session(draft) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
        assert db.execute("select report from public.transfer_date_scenarios where id=%s", (saved,)).fetchone()[0] == preview
