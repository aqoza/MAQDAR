"""Real transaction races for disposition package evidence, selection and authority."""
import time
from uuid import uuid4

import psycopg
import pytest
from test_replenishment_db import draft, session  # noqa: F401
from test_excess_disposition_db import assessment, review_session, submit, EVIDENCE_CHANGES, DECIDE  # noqa: F401
from test_excess_disposition_handoffs_db import approved, HANDOFF  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
BATCH = 'select public.excess_disposition_handoff_batch_create(%s,%s)'


@pytest.fixture
def handoff(approved):
    source, proposal = approved
    with session(source['draft']) as db:
        saved = db.execute(HANDOFF, (source['draft'][1], proposal)).fetchone()[0]
    return source, proposal, saved


def test_parallel_set_retries_create_one_original_and_audit(handoff):
    source, _, saved = handoff
    args = source['draft'][1], [saved]
    with session(source['draft']) as first, session(source['draft']) as second:
        assert _race(first, second, BATCH, args, args).sqlstate is None
    with psycopg.connect(source['draft'][0]) as db:
        rows = db.execute('select payload from public.excess_disposition_handoff_batches where organization_id=%s', (args[0],)).fetchall()
        assert len(rows) == 1
        assert rows[0][0]['summary']['reference_value'] == '3.749625'
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='excess_disposition_handoff_batches'", (args[0],)).fetchone()[0] == 1


@pytest.mark.parametrize('change', EVIDENCE_CHANGES)
def test_waiting_new_set_rechecks_evidence(handoff, change):
    source, _, saved = handoff
    dsn, org, _, _ = source['draft']
    with psycopg.connect(dsn) as blocker, session(source['draft']) as waiter:
        blocker.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||%s,0))", (str(org),))
        call = _Call(waiter, BATCH, (org, [saved]))
        call.start()
        time.sleep(1)
        assert not call.finished
        blocker.execute(change, (org,))
        blocker.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'


@pytest.mark.parametrize('replay', [False, True])
@pytest.mark.parametrize('change', [
    "update public.memberships set role='viewer' where organization_id=%s and user_id=%s",
    "delete from public.memberships where organization_id=%s and user_id=%s",
    "update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",
])
def test_waiting_create_and_replay_require_live_authority(handoff, replay, change):
    source, _, saved = handoff
    dsn, org, actor, _ = source['draft']
    if replay:
        with session(source['draft']) as db:
            db.execute(BATCH, (org, [saved]))
    with psycopg.connect(dsn) as blocker, session(source['draft']) as waiter:
        blocker.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||%s,0))", (str(org),))
        call = _Call(waiter, BATCH, (org, [saved]))
        call.start()
        time.sleep(1)
        assert not call.finished
        blocker.execute(change, (org, actor))
        blocker.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ403'


@pytest.mark.parametrize('batch_first', [True, False])
def test_batch_and_replacement_approval_serialize(handoff, batch_first):
    source, _, saved = handoff
    org = source['draft'][1]
    replacement = submit(source)
    with session(source['draft']) as saver, review_session(source) as reviewer:
        if batch_first:
            batch = saver.execute(BATCH, (org, [saved])).fetchone()[0]
            call = _Call(reviewer, DECIDE, (org, replacement, uuid4(), 'approved'))
            call.start()
            time.sleep(1)
            assert not call.finished
            saver.commit()
        else:
            reviewer.execute(DECIDE, (org, replacement, uuid4(), 'approved'))
            call = _Call(saver, BATCH, (org, [saved]))
            call.start()
            time.sleep(1)
            assert not call.finished
            reviewer.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == (None if batch_first else 'MQ409')
        if batch_first:
            reviewer.commit()
    with session(source['draft']) as db:
        rows = db.execute('select id,selection from public.excess_disposition_handoff_batch_list where organization_id=%s', (org,)).fetchall()
        assert rows == ([(batch, 'historical')] if batch_first else [])
        if batch_first:
            assert db.execute(BATCH, (org, [saved])).fetchone()[0] == batch
