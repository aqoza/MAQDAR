"""Redistribution retries, preview freshness and authority use independent sessions."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session  # noqa: F401 -- shared isolated fixture
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.redistribution_preview(%s,%s,%s,'calculated',null,'4.125',true,true)"
SAVE = "select public.redistribution_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)"


@pytest.fixture
def redistribution(draft):
    dsn, org, user, destination_policy = draft
    location, run, policy = [uuid4() for _ in range(3)]
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'SOURCE','Source','central','SA','Asia/Riyadh')", (location, org))
        destination, item = db.execute("select location_id,item_id from public.inventory_policies where id=%s", (destination_policy,)).fetchone()
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',35.125,2.250,1,'SAR','EA')", (org, item, location))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run, org, location, uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) select %s,organization_id,%s,%s,%s,item_id,item_code,unit,status,summary,evidence from public.inventory_policies where id=%s", (policy, run, location, uuid4(), destination_policy))
        db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')", (org, location, destination))
    with session(draft) as db:
        report = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (org, destination_policy)).fetchone()[0]
        destination_draft = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)", (org, destination_policy, uuid4(), report['fingerprint'])).fetchone()[0]
        preview = db.execute(PREVIEW, (org, destination_draft, policy)).fetchone()[0]
        assert preview['status'] == 'available'
    return draft, (org, destination_draft, policy), preview


def test_parallel_retries_save_and_audit_once(redistribution):
    draft, inputs, preview = redistribution
    args = (*inputs, uuid4(), preview['fingerprint'])
    with session(draft) as first, session(draft) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select report from public.redistribution_drafts where organization_id=%s", (draft[1],)).fetchall() == [(preview,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='redistribution_drafts'", (draft[1],)).fetchone()[0] == 1


def test_conflicting_parallel_request_is_rejected(redistribution):
    draft, inputs, preview = redistribution
    with session(draft) as db:
        other = db.execute(PREVIEW.replace("'4.125'", "'0'"), inputs).fetchone()[0]
    request = uuid4()
    with session(draft) as first, session(draft) as second:
        call = _Call(second, SAVE.replace("'4.125'", "'0'"), (*inputs, request, other['fingerprint']))
        first.execute(SAVE, (*inputs, request, preview['fingerprint']))
        call.start()
        time.sleep(0.3)
        first.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'


@pytest.mark.parametrize('change', ['stock', 'lane'])
def test_changed_source_evidence_requires_refresh(redistribution, change):
    draft, inputs, preview = redistribution
    with psycopg.connect(draft[0]) as db:
        if change == 'stock':
            db.execute("update public.stock_snapshots set quantity=40 where organization_id=%s and location_id=(select location_id from public.inventory_policies where id=%s)", (draft[1], inputs[2]))
        else:
            db.execute("update public.network_links set lead_time_days_p90=5 where organization_id=%s", (draft[1],))
    with session(draft) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), preview['fingerprint']))
    assert error.value.sqlstate == 'MQ409'
    with session(draft) as db:
        fresh = db.execute(PREVIEW, inputs).fetchone()[0]
        db.execute(SAVE, (*inputs, uuid4(), fresh['fingerprint']))


@pytest.mark.parametrize('change', ['role', 'lane'])
def test_waiting_save_rechecks_authority_and_evidence(redistribution, change):
    draft, inputs, preview = redistribution
    with psycopg.connect(draft[0]) as admin, session(draft) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.redistribution:'||%s,0))", (str(draft[1]),))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), preview['fingerprint']))
        call.start()
        time.sleep(0.3)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (draft[1], draft[2]))
        else:
            admin.execute("update public.network_links set is_active=false where organization_id=%s", (draft[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ403' if change == 'role' else 'MQ409')
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select count(*) from public.redistribution_drafts where organization_id=%s", (draft[1],)).fetchone()[0] == 0


def test_saved_retry_survives_lane_deletion_and_stock_change(redistribution):
    draft, inputs, preview = redistribution
    args = (*inputs, uuid4(), preview['fingerprint'])
    with session(draft) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        db.execute("delete from public.network_links where organization_id=%s", (draft[1],))
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (draft[1],))
    with session(draft) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
        assert db.execute("select report from public.redistribution_drafts where id=%s", (saved,)).fetchone()[0] == preview
