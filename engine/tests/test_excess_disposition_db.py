"""Real transaction races for line-scoped disposition evidence and independent review."""
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_replenishment_db import draft, session  # noqa: F401 -- shared loopback fixture
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
SUBMIT = "select public.excess_disposition_submit(%s,%s,%s,'scrap','3.333',%s,'Disposition')"
DECIDE = "select public.excess_disposition_decide(%s,%s,%s,%s,'Reviewed')"


@pytest.fixture
def assessment(draft):
    reviewer, override = uuid4(), uuid4()
    with psycopg.connect(draft[0]) as db:
        item, location = db.execute("select item_id,location_id from public.inventory_policies where id=%s", (draft[3],)).fetchone()
        db.execute("update public.stock_snapshots set quantity=40,unit_cost=1.125 where organization_id=%s", (draft[1],))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (reviewer, f"disposition-{reviewer}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')", (draft[1], reviewer))
        db.execute("""insert into public.policy_overrides(organization_id,id,policy_id,location_id,revision,request_id,submitted_by,
          reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
          values(%s,%s,%s,%s,1,%s,%s,1,20,'Source maximum','approved',%s,now(),'Reviewed',%s)""",
          (draft[1], override, draft[3], location, uuid4(), draft[2], reviewer, uuid4()))
    selections = Jsonb([dict(policy_id=str(draft[3]), maximum=str(override))])
    with session(draft) as db:
        report = db.execute("select public.excess_stock_preview(%s,%s)", (draft[1], selections)).fetchone()[0]
        saved = db.execute("select public.excess_stock_save(%s,%s,'Assessment',true,%s,%s)", (draft[1], selections, uuid4(), report['fingerprint'])).fetchone()[0]
    yield dict(draft=draft, reviewer=reviewer, assessment=saved, item=item, location=location)
    with psycopg.connect(draft[0]) as db:
        db.execute("delete from auth.users where id=%s", (reviewer,))


def review_session(source):
    dsn, org, _, policy = source['draft']
    return session((dsn, org, source['reviewer'], policy))


def submit_args(source, request=None):
    return source['draft'][1], source['assessment'], source['item'], request or uuid4()


def submit(source):
    with session(source['draft']) as db:
        return db.execute(SUBMIT, submit_args(source)).fetchone()[0]


@pytest.mark.parametrize('identical', [True, False])
def test_parallel_submissions_keep_one_pending_and_one_audit(assessment, identical):
    args = submit_args(assessment)
    with session(assessment['draft']) as first, session(assessment['draft']) as second:
        assert _race(first, second, SUBMIT, args, args if identical else submit_args(assessment)).sqlstate == (None if identical else 'MQ409')
    with psycopg.connect(assessment['draft'][0]) as db:
        assert db.execute("select count(*) from public.excess_disposition_proposals where assessment_id=%s", (assessment['assessment'],)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='excess_disposition_proposals'", (assessment['draft'][1],)).fetchone()[0] == 1


@pytest.mark.parametrize('identical', [True, False])
def test_parallel_decisions_keep_one_transition(assessment, identical):
    proposal = submit(assessment)
    args = (assessment['draft'][1], proposal, uuid4(), 'approved')
    other = args if identical else (args[0], proposal, uuid4(), 'rejected')
    with review_session(assessment) as first, review_session(assessment) as second:
        assert _race(first, second, DECIDE, args, other).sqlstate == (None if identical else 'MQ409')
    with psycopg.connect(assessment['draft'][0]) as db:
        assert db.execute("select status,quantity::text,reference_value::text from public.excess_disposition_proposals where id=%s", (proposal,)).fetchone() == ('approved', '3.333', '3.749625')
        assert db.execute("select quantity::text,allocated_quantity::text from public.stock_snapshots where organization_id=%s", (args[0],)).fetchone() == ('40.000', '2.000')
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='excess_disposition_proposals'", (args[0],)).fetchone()[0] == 2


EVIDENCE_CHANGES = [
    "update public.stock_snapshots set quantity=41 where organization_id=%s",
    "update public.stock_snapshots set allocated_quantity=3 where organization_id=%s",
    "update public.stock_snapshots set unit_cost=1.126 where organization_id=%s",
    "update public.stock_snapshots set unit_of_measure='KG' where organization_id=%s",
    "update public.stock_snapshots set snapshot_date='2026-10-02' where organization_id=%s",
    "delete from public.stock_snapshots where organization_id=%s",
    "update public.inventory_policies set summary='{\"protection\":{\"target\":\"21\"}}' where organization_id=%s",
    "update public.policy_overrides set order_up_to=21 where organization_id=%s",
    "update public.policy_overrides set decision_reason='Corrected' where organization_id=%s",
    "delete from public.planning_runs where organization_id=%s",
]


@pytest.mark.parametrize('operation', ['submit', 'approve'])
@pytest.mark.parametrize('change', EVIDENCE_CHANGES)
def test_waiting_operation_rechecks_selected_line_evidence(assessment, operation, change):
    dsn, org, _, _ = assessment['draft']
    proposal = submit(assessment) if operation == 'approve' else None
    with psycopg.connect(dsn) as admin, (review_session(assessment) if proposal else session(assessment['draft'])) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||%s,0))", (str(org),))
        args = (org, proposal, uuid4(), 'approved') if proposal else submit_args(assessment)
        call = _Call(waiting, DECIDE if proposal else SUBMIT, args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (org,))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'
    with psycopg.connect(dsn) as db:
        assert db.execute("select count(*) from public.excess_disposition_proposals where organization_id=%s and status='approved'", (org,)).fetchone()[0] == 0


@pytest.mark.parametrize('operation,change,code', [
    ('submit', "update public.memberships set role='viewer' where organization_id=%s and user_id=%s", 'MQ403'),
    ('approve', "update public.memberships set role='viewer' where organization_id=%s and user_id=%s", 'MQ403'),
    ('approve', "delete from public.memberships where organization_id=%s and user_id=%s", 'MQ403'),
    ('withdraw', "update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", 'MQ404'),
])
def test_lock_wait_rechecks_live_authority(assessment, operation, change, code):
    dsn, org, author, _ = assessment['draft']
    proposal = submit(assessment) if operation != 'submit' else None
    actor = assessment['reviewer'] if operation == 'approve' else author
    with psycopg.connect(dsn) as admin, (review_session(assessment) if operation == 'approve' else session(assessment['draft'])) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||%s,0))", (str(org),))
        args = (org, proposal, uuid4(), 'approved' if operation == 'approve' else 'withdrawn') if proposal else submit_args(assessment)
        call = _Call(waiting, DECIDE if proposal else SUBMIT, args)
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute(change, (org, actor))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == code
