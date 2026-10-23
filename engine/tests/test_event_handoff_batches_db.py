"""Batch creation uses set identity and rechecks live evidence after lock waits."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_event_purchase_handoffs_db import approved, HANDOFF, purchase, propose, reviewer, SUBMIT, DECIDE, event_cost, event_delivery, event_supplier, event_draft, policy_event, event, planning, saved_forecast, enqueue_policy, worker
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
CREATE = 'select public.event_purchase_handoff_batch_create(%s,%s::uuid[])'


def test_concurrent_creation_has_one_batch_and_audit(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
    with session(source) as first, session(source) as second:
        args = (source[1], [handoff])
        assert _race(first, second, CREATE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_handoff_batches where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='event_purchase_handoff_batches'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('price', 'MQ409'), ('selection', 'MQ409'), ('role', 'MQ403'), ('membership', 'MQ403'), ('source_deleted', 'MQ404'), ('supplier', 'MQ409'), ('receiver', 'MQ409'), ('unit', 'MQ409'), ('identity', 'MQ409')])
def test_batch_rechecks_after_lock_wait(approved, change, expected):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        newer = db.execute(SUBMIT, (source[1], purchase[2], uuid4(), 'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, CREATE, (source[1], [handoff]))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'price':
            admin.execute('update public.supplier_items set unit_price=2 where organization_id=%s', (source[1],))
        elif change == 'supplier':
            admin.execute('update public.suppliers set is_active=false where organization_id=%s', (source[1],))
        elif change == 'receiver':
            admin.execute('update public.locations set is_active=false where organization_id=%s', (source[1],))
        elif change == 'unit':
            admin.execute("update public.supplier_items set unit_of_measure='SET' where organization_id=%s", (source[1],))
        elif change == 'identity':
            admin.execute('update public.supplier_items set id=%s where organization_id=%s', (uuid4(),source[1]))
        elif change == 'selection':
            admin.execute("update public.event_purchase_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s", (purchase[3][0], uuid4(), newer))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'source_deleted':
            admin.execute('delete from public.event_purchase_handoffs where id=%s', (handoff,))
        else:
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.event_purchase_handoff_batches where organization_id=%s', (source[1],)).fetchone()[0] == 0


def test_replay_retains_saved_content_but_requires_live_authority(approved):
    purchase, proposal = approved
    source = purchase[0]
    with session(source) as db:
        handoff = db.execute(HANDOFF, (source[1], proposal)).fetchone()[0]
        batch = db.execute(CREATE, (source[1], [handoff])).fetchone()[0]
        original = db.execute('select payload from public.event_purchase_handoff_batches where id=%s', (batch,)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute('update public.supplier_items set unit_price=2 where organization_id=%s', (source[1],))
    with session(source) as db:
        assert db.execute(CREATE, (source[1], [handoff])).fetchone()[0] == batch
        assert db.execute('select payload from public.event_purchase_handoff_batches where id=%s', (batch,)).fetchone()[0] == original
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], [handoff]))
    assert error.value.sqlstate == 'MQ403'
