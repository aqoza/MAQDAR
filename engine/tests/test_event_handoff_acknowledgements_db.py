"""Committed sessions verify event identity and live authorization after a wait."""
import secrets
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_replenishment_db import session
from test_event_purchase_handoffs_db import (
    approved, purchase, propose, reviewer, event_cost, event_delivery, event_supplier,
    event_draft, policy_event, event, planning, saved_forecast, enqueue_policy, worker, HANDOFF,
)
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
ACK = "select public.api_event_purchase_handoff_acknowledge(%s,%s,%s,%s)"


@pytest.fixture(params=["event-purchase-handoffs", "event-purchase-handoff-batches"])
def acknowledgement(approved, request):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        if request.param == "event-purchase-handoff-batches":
            handoff = db.execute("select public.event_purchase_handoff_batch_create(%s,%s)", (source[1], [handoff])).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='owner' where organization_id=%s and user_id=%s", (source[1], source[2]))
    key_hash = secrets.token_bytes(32)
    with session(source) as db:
        key = db.execute("select public.create_api_key(%s,'Acknowledgements',array['event_purchase_handoffs:acknowledge'],30,%s,'zeespare_sk_test','test')", (source[1], key_hash)).fetchone()[0]
    body = dict(client_event_id=str(uuid4()), external_system='Test ERP', external_reference='00123', status='received')
    return source, handoff, key_hash, key, body, request.param


def api_session(dsn):
    db = psycopg.connect(dsn)
    db.execute('set local role service_role')
    return db


@pytest.mark.parametrize('conflict', [False, True])
@pytest.mark.parametrize('rotated', [False, True])
def test_concurrent_event_identity(acknowledgement, conflict, rotated):
    source, handoff, key_hash, key, body, resource = acknowledgement
    second_hash = key_hash
    if rotated:
        second_hash = secrets.token_bytes(32)
        with session(source) as db:
            db.execute("select public.create_api_key(%s,'Rotated acknowledgement key',array['event_purchase_handoffs:acknowledge'],30,%s,'zeespare_sk_test','test')", (source[1], second_hash))
    second_body = dict(body, status='rejected', reason='Unknown item') if conflict else body
    with api_session(source[0]) as first, api_session(source[0]) as second:
        call = _race(first, second, ACK, (key_hash, resource, handoff, Jsonb(body)), (second_hash, resource, handoff, Jsonb(second_body)))
        assert call.sqlstate == ('MQ409' if conflict else None)
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_handoff_acknowledgements where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_purchase_handoff_acknowledgements'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change', ['revoked', 'expired', 'role', 'deleted'])
def test_authority_and_parent_rechecked_after_lock_wait(acknowledgement, change):
    source, handoff, key_hash, key, body, resource = acknowledgement
    with psycopg.connect(source[0]) as admin, api_session(source[0]) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-handoff-ack:'||%s||':'||%s,0))", (str(source[1]), body['client_event_id']))
        call = _Call(waiting, ACK, (key_hash, resource, handoff, Jsonb(body)))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'revoked':
            admin.execute('update public.api_keys set revoked_at=now() where id=%s', (key,))
        elif change == 'expired':
            admin.execute("update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=%s", (key,))
        elif change == 'role':
            admin.execute("update public.memberships set role='planner' where organization_id=%s and user_id=%s", (source[1], source[2]))
        else:
            if resource == 'event-purchase-handoff-batches':
                admin.execute('delete from public.event_purchase_handoff_batches where id=%s', (handoff,))
            else:
                admin.execute('delete from public.event_purchase_handoffs where id=%s', (handoff,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ404' if change == 'deleted' else 'MQ401')
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_handoff_acknowledgements where organization_id=%s', (source[1],)).fetchone()[0] == 0
