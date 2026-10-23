"""Handoffs serialize with approval changes and preserve one immutable snapshot."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import session
from test_transfer_review_db import (
    base_draft, draft, redistribution, dates, freight, transfer, propose, reviewer, SUBMIT, DECIDE,
)
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
HANDOFF = 'select public.transfer_handoff_batch_create(%s,%s)'


@pytest.fixture
def approved(transfer):
    proposal = propose(transfer)
    with reviewer(transfer) as db:
        db.execute(DECIDE, (transfer[0][1], proposal, uuid4(), 'approved', 'Reviewed'))
    with session(transfer[0]) as db:
        handoff = db.execute('select public.transfer_handoff_create(%s,%s)', (transfer[0][1], proposal)).fetchone()[0]
    return transfer, proposal, handoff


def test_concurrent_creation_has_one_record_and_audit(approved):
    transfer, proposal, handoff = approved
    source = transfer[0]
    with session(source) as first, session(source) as second:
        assert _race(first, second, HANDOFF, (source[1], [handoff]), (source[1], [handoff])).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.transfer_handoff_batches where organization_id=%s', (source[1],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='transfer_handoff_batches'", (source[1],)).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('freight', 'MQ409'), ('lane', 'MQ409'), ('lead', 'MQ409'), ('location', 'MQ409'), ('selection', 'MQ409'), ('role', 'MQ403'), ('membership', 'MQ403'), ('source_deleted', 'MQ404')])
def test_creation_rechecks_after_wait(approved, change, expected):
    transfer, proposal, handoff = approved
    source = transfer[0]
    with session(source) as db:
        newer = db.execute(SUBMIT, (source[1], transfer[2], uuid4(), 'Alternative')).fetchone()[0]
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.transfer-review:'||%s,0))", (str(source[1]),))
        call = _Call(waiting, HANDOFF, (source[1], [handoff]))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'freight':
            admin.execute('update public.network_links set freight_cost=2 where organization_id=%s', (source[1],))
        elif change == 'lane':
            admin.execute('update public.network_links set is_active=false where organization_id=%s', (source[1],))
        elif change == 'lead':
            admin.execute('update public.network_links set lead_time_days_p90=20 where organization_id=%s', (source[1],))
        elif change == 'location':
            admin.execute('update public.locations set is_active=false where organization_id=%s', (source[1],))
        elif change == 'selection':
            # The approval RPC shares the lock; this privileged fixture models its committed result.
            admin.execute("update public.transfer_proposals set status='approved',decided_by=%s,decided_at=now(),decision_reason='Reviewed',decision_request_id=%s where id=%s", (transfer[3][0], uuid4(), newer))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'source_deleted':
            admin.execute('delete from public.transfer_proposals where id=%s', (proposal,))
        else:
            admin.execute('delete from public.memberships where organization_id=%s and user_id=%s', (source[1], source[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute('select count(*) from public.transfer_handoff_batches where organization_id=%s', (source[1],)).fetchone()[0] == 0
