"""Freight saves serialize retries and recheck current rate and authority after waits."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_transfer_dates_db import dates, draft, redistribution, session, SAVE as DATE_SAVE  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.transfer_freight_preview(%s,%s,true)"
SAVE = "select public.transfer_freight_save(%s,%s,true,%s,%s)"


@pytest.fixture
def freight(dates):
    draft, inputs, report = dates
    with session(draft) as db:
        source = db.execute(DATE_SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        db.execute("update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-10' where organization_id=%s", (draft[1],))
    with session(draft) as db:
        preview = db.execute(PREVIEW, (draft[1], source)).fetchone()[0]
        assert preview['status'] == 'available'
    return draft, (draft[1], source), preview


def test_parallel_retries_save_and_audit_once(freight):
    draft, inputs, preview = freight
    args = (*inputs, uuid4(), preview['fingerprint'])
    with session(draft) as first, session(draft) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(draft[0]) as db:
        assert db.execute('select report from public.transfer_freight_estimates where organization_id=%s', (draft[1],)).fetchall() == [(preview,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='transfer_freight_estimates'", (draft[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change', ['role', 'rate', 'date', 'lane', 'location'])
def test_waiting_save_rechecks_authority_and_evidence(freight, change):
    draft, inputs, preview = freight
    with psycopg.connect(draft[0]) as admin, session(draft) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.transfer-freight:'||%s,0))", (str(draft[1]),))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), preview['fingerprint']))
        call.start()
        time.sleep(0.3)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (draft[1], draft[2]))
        elif change == 'rate':
            admin.execute('update public.network_links set freight_cost=9 where organization_id=%s', (draft[1],))
        elif change == 'date':
            admin.execute("update public.network_links set freight_valid_from='2026-10-12' where organization_id=%s", (draft[1],))
        elif change == 'location':
            admin.execute('update public.locations set is_active=false where organization_id=%s', (draft[1],))
        else:
            admin.execute('update public.network_links set lead_time_days_p90=5 where organization_id=%s', (draft[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ403' if change == 'role' else 'MQ409')
    with psycopg.connect(draft[0]) as db:
        assert db.execute('select count(*) from public.transfer_freight_estimates where organization_id=%s', (draft[1],)).fetchone()[0] == 0


def test_saved_retry_retains_freight_after_later_changes(freight):
    draft, inputs, preview = freight
    args = (*inputs, uuid4(), preview['fingerprint'])
    with session(draft) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        db.execute('delete from public.network_links where organization_id=%s', (draft[1],))
        db.execute('update public.work_calendars set is_active=false where organization_id=%s', (draft[1],))
    with session(draft) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
        assert db.execute('select report from public.transfer_freight_estimates where id=%s', (saved,)).fetchone()[0] == preview
