"""Handoffs serialize with approval changes and preserve one immutable snapshot."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_event_purchase_review_db import purchase, propose, reviewer, SUBMIT, DECIDE, event_cost, event_delivery, event_supplier, event_draft, policy_event, event, planning, saved_forecast, enqueue_policy, worker
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
HANDOFF = 'select public.event_purchase_handoff_create(%s,%s)'


@pytest.fixture
def approved(purchase):
    proposal = propose(purchase)
    with reviewer(purchase) as db:
        db.execute(DECIDE, (purchase[0][1], proposal, uuid4(), 'approved', 'Reviewed'))
    return purchase, proposal


def test_concurrent_creation_has_one_record_and_audit(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as first, session(source) as second:
        assert _race(first, second, HANDOFF, (source[1], proposal), (source[1], proposal)).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_handoffs where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_purchase_handoffs'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('price', 'MQ409'), ('selection', 'MQ409'), ('role', 'MQ403'), ('membership', 'MQ403'), ('source_deleted', 'MQ404'), ('supplier', 'MQ409'), ('receiver', 'MQ409'), ('unit', 'MQ409'), ('identity', 'MQ409'), ('location_access', 'MQ403')])
def test_creation_rechecks_after_wait(approved, change, expected):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        newer = db.execute(SUBMIT, (source[1], purchase[2], uuid4(), 'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.event-purchase-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, HANDOFF, (source[1], proposal))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'price':
            admin.execute('update public.supplier_items set unit_price=2 where organization_id=%s', (source[1],))
        elif change == 'supplier':
            admin.execute('update public.suppliers set is_active=false where organization_id=%s',(source[1],))
        elif change == 'receiver':
            admin.execute('update public.locations set is_active=false where organization_id=%s',(source[1],))
        elif change == 'unit':
            admin.execute("update public.supplier_items set unit_of_measure='SET' where organization_id=%s",(source[1],))
        elif change == 'identity':
            admin.execute('update public.supplier_items set id=%s where organization_id=%s',(uuid4(),source[1]))
        elif change == 'location_access':
            admin.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",(source[1],source[2]))
        elif change == 'selection':
            # The approval RPC shares the lock; this privileged fixture models its committed result.
            admin.execute("update public.event_purchase_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s", (purchase[3][0], uuid4(), newer))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'source_deleted':
            admin.execute('delete from public.event_purchase_proposals where id=%s', (proposal,))
        else:
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_handoffs where organization_id=%s', (source[1],)).fetchone()[0] == 0


def test_replay_preserves_snapshot_after_price_and_selection_changes(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        original = db.execute('select payload from public.event_purchase_handoffs where id=%s', (handoff,)).fetchone()[0]
        newer = db.execute(SUBMIT, (source[1], purchase[2], uuid4(), 'Alternative')).fetchone()[0]
    with reviewer(purchase) as db:
        db.execute(DECIDE, (source[1], newer, uuid4(), 'approved', 'Reviewed'))
    with session(source) as db:
        next_handoff = db.execute(HANDOFF, (source[1], newer)).fetchone()[0]
        assert next_handoff != handoff
    with psycopg.connect(source[0]) as db:
        db.execute('update public.supplier_items set unit_price=2 where organization_id=%s', (source[1],))
    with session(source) as db:
        assert db.execute(HANDOFF, (source[1], proposal)).fetchone()[0] == handoff
        assert db.execute('select payload from public.event_purchase_handoffs where id=%s', (handoff,)).fetchone()[0] == original
        assert db.execute('select selected from public.event_purchase_handoff_list where id=%s', (handoff,)).fetchone()[0] is False
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(HANDOFF, (source[1], proposal))
    assert error.value.sqlstate == 'MQ403'
