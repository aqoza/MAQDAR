"""Whole-regional reports: real evidence chains, concurrent retries and live authority."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_regional_handoff_api_db import (  # noqa: F401
    package, transfer, reader, api, key, session, approve, SINGLE, BATCHES, OLD_SCOPES,
)
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
ACK = "select public.api_regional_handoff_acknowledge(%s,%s,%s,%s)"
HISTORY = "select public.api_regional_handoff_acknowledgements(%s,%s,%s)"
SCOPE = "regional_handoffs:acknowledge"


@pytest.fixture(params=[SINGLE, BATCHES])
def report(reader, request):
    source, ids, batch, saved, _ = reader
    digest = key(source, [SCOPE, "regional_handoffs:read"])
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
        assert db.execute("select count(*) from public.regional_handoff_acknowledgements where organization_id=%s", (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='regional_handoff_acknowledgements' and operation='INSERT'", (source[1],)).fetchone()[0] == 1


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
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-handoff-ack:'||%s||':'||%s,0))", (str(source[1]), body['client_event_id']))
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
                allocation = next(line['proposal']['sourcing_id'] for line in saved['lines'] if line['handoff_id'] == str(record))
            else:
                allocation = saved['lines'][0]['proposal']['sourcing_id']
            admin.execute("delete from public.regional_sourcing_scenarios where id=%s", (allocation,))
        else:
            table = "regional_transfer_handoffs" if resource == SINGLE else "regional_handoff_batches"
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
    table = 'regional_transfer_handoffs' if resource == SINGLE else 'regional_handoff_batches'
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
    old = key(source, [*OLD_SCOPES, 'regional_handoffs:read'])
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


@pytest.mark.parametrize("transfer", [{"source_a_quantity": "22"}], indirect=True)
def test_historical_packages_overlaps_and_all_location_history(reader, transfer):
    source, ids, batch, saved, _ = reader
    digest = key(source, [SCOPE, 'regional_handoffs:read'])
    approve(transfer)
    with session(source) as db:
        # A copied batch with one unchanged item is independent from the original package.
        overlap = db.execute('select public.regional_handoff_batch_create(%s,%s)', (source[1], [ids[1]])).fetchone()[0]
    with api(source) as db:
        for resource, record in [(SINGLE, ids[0]), (BATCHES, batch)]:
            body = dict(client_event_id=str(uuid4()), external_system='ERP', external_reference='01', status='received')
            db.execute(ACK, (digest, resource, record, Jsonb(body)))
        assert db.execute(HISTORY, (digest, BATCHES, overlap)).fetchone()[0]['data'] == []
        assert db.execute(HISTORY, (digest, SINGLE, ids[1])).fetchone()[0]['data'] == []
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (source[1], source[2]))
        locations = db.execute('select required_location_ids from public.regional_handoff_batches where id=%s', (batch,)).fetchone()[0]
        zero = db.execute("select id from public.locations where organization_id=%s and code='SOURCE-A'", (source[1],)).fetchone()[0]
        for location in [x for x in locations if x != zero]:
            db.execute('insert into public.membership_locations values(%s,%s,%s) on conflict do nothing', (source[1], source[2], location))
    with session(source) as db:
        assert db.execute('select count(*) from public.regional_handoff_acknowledgements').fetchone()[0] == 0
    with psycopg.connect(source[0]) as db:
        db.execute('insert into public.membership_locations values(%s,%s,%s) on conflict do nothing', (source[1], source[2], zero))
    with session(source) as db:
        assert db.execute('select count(*) from public.regional_handoff_acknowledgements').fetchone()[0] == 2
        assert db.execute('select payload from public.regional_handoff_batches where id=%s', (batch,)).fetchone()[0] == saved
