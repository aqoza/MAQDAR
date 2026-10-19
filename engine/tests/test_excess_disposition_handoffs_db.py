"""Handoff retries serialize with disposition selection and recheck live authority."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session  # noqa: F401 -- shared loopback fixtures
from test_excess_disposition_db import assessment, review_session, submit, EVIDENCE_CHANGES, DECIDE  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
HANDOFF = "select public.excess_disposition_handoff_create(%s,%s)"


@pytest.fixture
def approved(assessment):
    proposal = submit(assessment)
    with review_session(assessment) as db:
        db.execute(DECIDE, (assessment['draft'][1], proposal, uuid4(), 'approved'))
    return assessment, proposal


def test_parallel_retries_create_one_payload_and_audit(approved):
    source, proposal = approved
    args = source['draft'][1], proposal
    with session(source['draft']) as first, session(source['draft']) as second:
        assert _race(first, second, HANDOFF, args, args).sqlstate is None
    with psycopg.connect(source['draft'][0]) as db:
        payloads = db.execute("select payload from public.excess_disposition_handoffs where organization_id=%s", (args[0],)).fetchall()
        assert len(payloads) == 1
        assert payloads[0][0]['disposition']['quantity'] == '3.333'
        assert payloads[0][0]['disposition']['reference_value'] == '3.749625'
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='excess_disposition_handoffs'", (args[0],)).fetchone()[0] == 1


@pytest.mark.parametrize('change', EVIDENCE_CHANGES)
def test_waiting_first_save_rechecks_source(approved, change):
    source, proposal = approved
    dsn, org, _, _ = source['draft']
    with psycopg.connect(dsn) as admin, session(source['draft']) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||%s,0))", (str(org),))
        call = _Call(waiting, HANDOFF, (org, proposal))
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (org,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'


@pytest.mark.parametrize('replay', [False, True])
@pytest.mark.parametrize('change', [
    "update public.memberships set role='viewer' where organization_id=%s and user_id=%s",
    "delete from public.memberships where organization_id=%s and user_id=%s",
    "update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",
])
def test_waiting_save_and_retry_recheck_authority(approved, replay, change):
    source, proposal = approved
    dsn, org, actor, _ = source['draft']
    if replay:
        with session(source['draft']) as db:
            db.execute(HANDOFF, (org, proposal))
    with psycopg.connect(dsn) as admin, session(source['draft']) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||%s,0))", (str(org),))
        call = _Call(waiting, HANDOFF, (org, proposal))
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (org, actor))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ403'


@pytest.mark.parametrize('handoff_first', [False, True])
def test_creation_serializes_with_replacement_approval(approved, handoff_first):
    source, proposal = approved
    org = source['draft'][1]
    replacement = submit(source)
    with session(source['draft']) as saver, review_session(source) as reviewer:
        if handoff_first:
            saved = saver.execute(HANDOFF, (org, proposal)).fetchone()[0]
            call = _Call(reviewer, DECIDE, (org, replacement, uuid4(), 'approved'))
            call.start()
            time.sleep(1)
            assert not call.finished
            saver.commit()
        else:
            reviewer.execute(DECIDE, (org, replacement, uuid4(), 'approved'))
            call = _Call(saver, HANDOFF, (org, proposal))
            call.start()
            time.sleep(1)
            assert not call.finished
            reviewer.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == (None if handoff_first else 'MQ409')
        if handoff_first:
            reviewer.commit()
    with session(source['draft']) as db:
        rows = db.execute("select id,selected from public.excess_disposition_handoff_list where organization_id=%s", (org,)).fetchall()
        assert rows == ([(saved, False)] if handoff_first else [])
        if handoff_first:
            assert db.execute(HANDOFF, (org, proposal)).fetchone()[0] == saved
