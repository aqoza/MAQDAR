"""Committed sessions verify event identity and live authorization after a wait."""
import secrets
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_replenishment_db import draft, session
from test_supplier_scenarios_db import scenario
from test_delivery_scenarios_db import delivery
from test_purchase_costs_db import cost
from test_purchase_review_db import purchase
from test_purchase_handoffs_db import approved, HANDOFF
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
ACK = "select public.api_handoff_acknowledge(%s,'purchase-handoffs',%s,%s)"


@pytest.fixture
def acknowledgement(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='owner' where organization_id=%s and user_id=%s", (source[1], source[2]))
    key_hash = secrets.token_bytes(32)
    with session(source) as db:
        key = db.execute("select public.create_api_key(%s,'Acknowledgements',array['purchase_handoffs:acknowledge'],30,%s,'maqdar_sk_test','test')", (source[1], key_hash)).fetchone()[0]
    body = dict(client_event_id=str(uuid4()), external_system='Test ERP', external_reference='00123', status='received')
    return source, handoff, key_hash, key, body


def api_session(dsn):
    db = psycopg.connect(dsn)
    db.execute('set local role service_role')
    return db


@pytest.mark.parametrize('conflict', [False, True])
def test_concurrent_event_identity(acknowledgement, conflict):
    source, handoff, key_hash, key, body = acknowledgement
    second_body = dict(body, status='rejected', reason='Unknown item') if conflict else body
    with api_session(source[0]) as first, api_session(source[0]) as second:
        call = _race(first, second, ACK, (key_hash, handoff, Jsonb(body)), (key_hash, handoff, Jsonb(second_body)))
        assert call.sqlstate == ('MQ409' if conflict else None)
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.purchase_handoff_acknowledgements where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='purchase_handoff_acknowledgements'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change', ['revoked', 'expired', 'role', 'deleted'])
def test_authority_and_parent_rechecked_after_lock_wait(acknowledgement, change):
    source, handoff, key_hash, key, body = acknowledgement
    with psycopg.connect(source[0]) as admin, api_session(source[0]) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.handoff-ack:'||%s||':'||%s,0))", (str(source[1]), body['client_event_id']))
        call = _Call(waiting, ACK, (key_hash, handoff, Jsonb(body)))
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
            admin.execute('delete from public.purchase_handoffs where id=%s', (handoff,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ404' if change == 'deleted' else 'MQ401')
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.purchase_handoff_acknowledgements where organization_id=%s', (source[1],)).fetchone()[0] == 0
