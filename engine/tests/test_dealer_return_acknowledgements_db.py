"""Whole-return reports: real evidence chains, concurrent retries and live authority."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_dealer_return_handoff_api_db import (  # noqa: F401
    returns, review, reader, api, key, session, SINGLE, BATCHES, OLD_SCOPES,
)
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
ACK = "select public.api_dealer_return_handoff_acknowledge(%s,%s,%s,%s)"
HISTORY = "select public.api_dealer_return_handoff_acknowledgements(%s,%s,%s)"
SCOPE = "dealer_return_handoffs:acknowledge"


@pytest.fixture(params=[SINGLE, BATCHES])
def report(reader, request):
    source, ids, batch, saved, _ = reader
    digest = key(source, [SCOPE, "dealer_return_handoffs:read"])
    body = dict(client_event_id=str(uuid4()), external_system="ERP", external_reference="00123", status="received")
    return source, ids[0] if request.param == SINGLE else batch, digest, body, request.param, saved


@pytest.mark.parametrize("conflict", [False, True])
@pytest.mark.parametrize("rotated", [False, True])
def test_concurrent_identity_and_key_rotation(report, conflict, rotated):
    source, record, digest, body, resource, _ = report
    second = key(source, [SCOPE]) if rotated else digest
    changed = dict(body, status="rejected", reason="Unknown branch") if conflict else body
    with api(source) as first_db, api(source) as second_db:
        call = _race(first_db, second_db, ACK, (digest, resource, record, Jsonb(body)), (second, resource, record, Jsonb(changed)))
        assert call.sqlstate == ("MQ409" if conflict else None)
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.dealer_return_handoff_acknowledgements where organization_id=%s", (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='dealer_return_handoff_acknowledgements' and operation='INSERT'", (source[1],)).fetchone()[0] == 1


def wait_for_lock(admin, waiting, call):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        locks = admin.execute("select cardinality(pg_blocking_pids(%s))", (waiting.info.backend_pid,)).fetchone()[0]
        if locks:
            assert not call.finished
            return
        time.sleep(0.02)
    raise AssertionError("Request did not wait on the expected lock")


@pytest.mark.parametrize("change", ["revoked", "expired", "demoted", "removed", "deleted", "source_deleted"])
@pytest.mark.parametrize("replay", [False, True])
def test_live_authority_after_event_wait(report, change, replay):
    source, record, digest, body, resource, saved = report
    if replay:
        with api(source) as db:
            db.execute(ACK, (digest, resource, record, Jsonb(body)))
    with psycopg.connect(source[0]) as admin, api(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.dealer-return-handoff-ack:'||%s||':'||%s,0))", (str(source[1]), body['client_event_id']))
        call = _Call(waiting, ACK, (digest, resource, record, Jsonb(body)))
        call.start()
        wait_for_lock(admin, waiting, call)
        if change == "revoked":
            admin.execute("update public.api_keys set revoked_at=clock_timestamp() where key_hash=%s", (digest,))
        elif change == "expired":
            admin.execute("update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where key_hash=%s", (digest,))
        elif change == "demoted":
            admin.execute("update public.memberships set role='planner' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == "removed":
            admin.execute("delete from public.memberships where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == "source_deleted":
            if resource == SINGLE:
                request_id = next(line['request']['id'] for line in saved['lines'] if line['handoff_id'] == str(record))
            else:
                request_id = saved['lines'][0]['request']['id']
            admin.execute("delete from public.dealer_return_requests where id=%s", (request_id,))
        else:
            table = "dealer_return_handoffs" if resource == SINGLE else "dealer_return_batches"
            admin.execute(f"delete from public.{table} where id=%s", (record,))
        admin.commit()
        call.join(timeout=15)
        expected = (None if resource == BATCHES else 'MQ404') if change == 'source_deleted' else ('MQ404' if change == 'deleted' else 'MQ401')
        assert call.finished and call.sqlstate == expected
        if expected is None:
            waiting.commit()


@pytest.mark.parametrize("replay", [False, True])
def test_authority_rechecked_after_parent_lock(report, replay):
    source, record, digest, body, resource, _ = report
    if replay:
        with api(source) as db:
            db.execute(ACK, (digest, resource, record, Jsonb(body)))
    table = 'dealer_return_handoffs' if resource == SINGLE else 'dealer_return_batches'
    with psycopg.connect(source[0]) as admin, api(source) as waiting:
        admin.execute(f"select id from public.{table} where id=%s for update", (record,))
        call = _Call(waiting, ACK, (digest, resource, record, Jsonb(body)))
        call.start()
        wait_for_lock(admin, waiting, call)
        admin.execute("update public.api_keys set revoked_at=clock_timestamp() where key_hash=%s", (digest,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ401'


def test_all_prior_scopes_and_non_admin_roles_denied(reader):
    source, ids, batch, _, _ = reader
    old = key(source, [*OLD_SCOPES, 'dealer_return_handoffs:read'])
    body = dict(client_event_id=str(uuid4()), external_system='ERP', external_reference='001', status='received')
    for resource, record in [(SINGLE, ids[0]), (BATCHES, batch)]:
        with api(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(ACK, (old, resource, record, Jsonb(body)))
        assert error.value.sqlstate == 'MQ403'
    for role in ['planner', 'approver', 'viewer', 'branch_user']:
        with psycopg.connect(source[0]) as db:
            db.execute('update public.memberships set role=%s where organization_id=%s and user_id=%s', (role, source[1], source[2]))
        with pytest.raises(psycopg.Error) as error:
            key(source, [SCOPE])
        assert error.value.sqlstate == 'MQ403'




def test_reports_keep_overlap_and_original_evidence_independent(reader):
    source, ids, batch, saved, _ = reader
    digest = key(source, [SCOPE, "dealer_return_handoffs:read"])
    with session(source) as db:
        overlap = db.execute("select public.dealer_return_batch_create(%s,%s::uuid[])", (source[1], [str(ids[0])])).fetchone()[0]
    with api(source) as db:
        for system in ["ERP", "erp", " ERP "]:
            value = dict(client_event_id=str(uuid4()), external_system=system, external_reference="00001", status="received")
            result = db.execute(ACK, (digest, BATCHES, batch, Jsonb(value))).fetchone()[0]
            assert result["data"]["external_system"] == system
        assert db.execute(HISTORY, (digest, SINGLE, ids[0])).fetchone()[0]["data"] == []
        assert db.execute(HISTORY, (digest, BATCHES, overlap)).fetchone()[0]["data"] == []
    with psycopg.connect(source[0]) as db:
        assert db.execute("select payload from public.dealer_return_batches where id=%s", (batch,)).fetchone()[0] == saved
        for table in ["stock_snapshots", "open_orders", "receipts"]:
            assert db.execute(f"select count(*) from public.{table} where organization_id=%s", (source[1],)).fetchone()[0] == 0
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (source[1], source[2]))
        locations = db.execute("select source_location_id,location_id from public.dealer_return_batches where id=%s", (batch,)).fetchone()
        db.execute("insert into public.membership_locations values(%s,%s,%s)", (source[1],source[2],locations[1]))
    with session(source) as db:
        assert db.execute("select count(*) from public.dealer_return_handoff_acknowledgements").fetchone()[0] == 0
    with psycopg.connect(source[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)", (source[1],source[2],locations[0]))
    with session(source) as db:
        assert db.execute("select count(*) from public.dealer_return_handoff_acknowledgements").fetchone()[0] == 3


def test_tied_history_pages_and_key_deletion_attribution(reader):
    source, ids, batch, _, _ = reader
    digest = key(source, [SCOPE,"dealer_return_handoffs:read"])
    created = []
    with api(source) as db:
        for _ in range(3):
            value = dict(client_event_id=str(uuid4()),external_system="ERP",external_reference="00001",status="received")
            created.append(db.execute(ACK,(digest,BATCHES,batch,Jsonb(value))).fetchone()[0]["data"])
    with psycopg.connect(source[0]) as db:
        db.execute("update public.dealer_return_handoff_acknowledgements set recorded_at='2026-01-01T00:00:00Z' where organization_id=%s",(source[1],))
        db.execute("delete from public.api_keys where key_hash=%s",(digest,))
    rotated=key(source,["dealer_return_handoffs:read"])
    seen=[]; cursor=None
    with api(source) as db:
        for _ in range(3):
            page=db.execute("select public.api_dealer_return_handoff_acknowledgements(%s,%s,%s,null,%s,1)",(rotated,BATCHES,batch,cursor)).fetchone()[0]
            assert len(page['data']) == 1
            seen.append(page['data'][0]['id'])
            assert page['data'][0]['api_key_id'] == created[0]['api_key_id']
            cursor=page['next_cursor']
        assert cursor is None
    assert seen == sorted(row['id'] for row in created)
