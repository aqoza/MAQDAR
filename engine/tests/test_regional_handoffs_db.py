"""Regional exports share review serialization and preserve as-of evidence."""
import time
from uuid import uuid4

import psycopg
import pytest

from test_regional_review_db import transfer, propose, reviewer, DECIDE  # noqa: F401
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
CREATE = "select public.regional_handoff_create(%s,%s)"


def approve(transfer):
    proposal = propose(transfer)
    with reviewer(transfer) as db:
        db.execute(DECIDE, (transfer[0][1], proposal, uuid4(), 'approved', 'Whole region approved'))
    return proposal


def test_parallel_retries_preserve_one_exact_snapshot_and_audit(transfer):
    source = transfer[0]
    proposal = approve(transfer)
    with session(source) as first, session(source) as second:
        assert _race(first, second, CREATE, (source[1], proposal), (source[1], proposal)).sqlstate is None
    with session(source) as db:
        rows = db.execute("select id,payload from public.regional_transfer_handoffs").fetchall()
        assert len(rows) == 1
        handoff, payload = rows[0]
        original = db.execute("select report from public.regional_freight_estimates where id=%s", (transfer[1],)).fetchone()[0]
        assert payload['estimate'] == original
        assert payload['proposal']['id'] == str(proposal)
        assert payload['proposal']['approved_by'] == str(transfer[3][0])
        assert payload['schema_version'] == 'regional-transfer-handoff-v1'
        assert db.execute(CREATE, (source[1], proposal)).fetchone()[0] == handoff
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.audit_log where record_id=%s", (handoff,)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (source[1],)).fetchone()[0] == 0


@pytest.mark.parametrize('status', ['pending', 'rejected', 'withdrawn', 'historical'])
def test_only_selected_approval_can_create_first_handoff(transfer, status):
    source = transfer[0]
    proposal = propose(transfer)
    if status != 'pending':
        decision = 'approved' if status == 'historical' else status
        with (session(source) if status == 'withdrawn' else reviewer(transfer)) as db:
            db.execute(DECIDE, (source[1], proposal, uuid4(), decision, 'Decision'))
    if status == 'historical':
        approve(transfer)
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], proposal))
    assert error.value.sqlstate == 'MQ409'
    assert error.value.diag.message_hint == 'regional_selection_changed'


@pytest.mark.parametrize('change', [
    "update public.network_links set freight_cost=2 where organization_id=%s",
    "update public.network_links set is_active=false where organization_id=%s",
    "update public.network_links set lead_time_days_p90=8 where organization_id=%s",
    "update public.locations set is_active=false where organization_id=%s",
])
def test_first_save_requires_current_evidence_but_existing_retry_is_immutable(transfer, change):
    source = transfer[0]
    old = approve(transfer)
    with session(source) as db:
        handoff = db.execute(CREATE, (source[1], old)).fetchone()[0]
        payload = db.execute("select payload from public.regional_transfer_handoffs where id=%s", (handoff,)).fetchone()[0]
    new = approve(transfer)
    with psycopg.connect(source[0]) as db:
        db.execute(change, (source[1],))
    with session(source) as db:
        assert db.execute(CREATE, (source[1], old)).fetchone()[0] == handoff
        assert db.execute("select payload from public.regional_transfer_handoffs where id=%s", (handoff,)).fetchone()[0] == payload
        assert db.execute("select selected from public.regional_handoff_list where id=%s", (handoff,)).fetchone()[0] is False
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], new))
    assert error.value.sqlstate == 'MQ409'
    assert error.value.diag.message_hint == 'regional_freight_changed'


@pytest.mark.parametrize('path,value', [
    ('{source,lines,0,receipts,p50,timing_review_required}', 'true'),
    ('{source,lines,1,receipts,p90,timing_review_required}', 'null'),
    ('{source,lines,1,receipts,p90,search,date}', 'null'),
    ('{lines}', '[]'),
])
def test_positive_timing_and_complete_estimate_fail_closed(transfer, path, value):
    source = transfer[0]
    proposal = approve(transfer)
    with psycopg.connect(source[0]) as db:
        db.execute("update public.regional_freight_estimates set report=jsonb_set(report,%s,%s::jsonb) where id=%s", (path, value, transfer[1]))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], proposal))
    assert error.value.sqlstate == 'MQ422'


@pytest.mark.parametrize('transfer', [{'source_a_quantity': '22'}], indirect=True)
def test_zero_source_context_is_retained_and_still_requires_access(transfer):
    source = transfer[0]
    proposal = approve(transfer)
    with session(source) as db:
        handoff = db.execute(CREATE, (source[1], proposal)).fetchone()[0]
        payload = db.execute("select payload from public.regional_transfer_handoffs where id=%s", (handoff,)).fetchone()[0]
        zero = next(x for x in payload['estimate']['lines'] if x['status'] == 'no_transfer_needed')
        dates = next(x for x in payload['estimate']['source']['lines'] if x['location_id'] == zero['location_id'])
        assert dates['receipts'] == {}
        assert zero['subtotal'] is None and zero['shipment_count'] is None
        # Recorded lane terms remain context; no freight is calculated for zero.
        assert zero['terms']['id'] == dates['lane']['id']
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (source[1], source[2]))
        db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and id<>%s", (source[2], source[1], zero['location_id']))
    with session(source) as db:
        assert db.execute("select count(*) from public.regional_transfer_handoffs").fetchone()[0] == 0
        assert db.execute("select count(*) from public.regional_handoff_list").fetchone()[0] == 0
    with psycopg.connect(source[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)", (source[1], source[2], zero['location_id']))
    with session(source) as db:
        assert db.execute("select payload from public.regional_transfer_handoffs where id=%s", (handoff,)).fetchone()[0] == payload
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], proposal))
    assert error.value.sqlstate == 'MQ403'


@pytest.mark.parametrize('lock', ['advisory', 'parent'])
@pytest.mark.parametrize('change,expected', [('role','MQ403'), ('membership','MQ403'), ('freight','MQ409')])
def test_waits_recheck_authority_and_evidence(transfer, lock, change, expected):
    source = transfer[0]
    proposal = approve(transfer)
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        if lock == 'advisory':
            admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.regional-review:'||%s,0))", (str(source[1]),))
        else:
            # Evidence mutations take lane locks before saved-parent locks, as review does.
            if change == 'freight':
                admin.execute('select id from public.network_links where organization_id=%s order by id for update', (source[1],))
            admin.execute("select id from public.regional_transfer_proposals where id=%s for update", (proposal,))
        call = _Call(waiting, CREATE, (source[1], proposal))
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
        elif change == 'membership':
            admin.execute("delete from public.memberships where organization_id=%s and user_id=%s", (source[1], source[2]))
        else:
            admin.execute("update public.network_links set freight_cost=2 where organization_id=%s", (source[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


def test_new_approval_wins_before_waiting_export_and_retry_checks_live_role(transfer):
    source = transfer[0]
    old = approve(transfer)
    new = propose(transfer)
    with reviewer(transfer) as first, session(source) as second:
        first.execute(DECIDE, (source[1], new, uuid4(), 'approved', 'Replacement'))
        call = _Call(second, CREATE, (source[1], old))
        call.start()
        time.sleep(.3)
        assert not call.finished
        first.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ409'
    with session(source) as db:
        db.execute(CREATE, (source[1], new))
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (source[1], source[2]))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], new))
    assert error.value.sqlstate == 'MQ403'


def test_export_keeps_as_of_commitments_and_parent_deletion_audit(transfer):
    source = transfer[0]
    proposal = approve(transfer)
    with psycopg.connect(source[0]) as db:
        db.execute("update public.stock_snapshots set quantity=0 where organization_id=%s", (source[1],))
        db.execute("update public.work_calendars set is_active=false where organization_id=%s", (source[1],))
    with session(source) as db:
        handoff = db.execute(CREATE, (source[1], proposal)).fetchone()[0]
        saved = db.execute("select payload->'estimate' from public.regional_transfer_handoffs where id=%s", (handoff,)).fetchone()[0]
        assert saved == db.execute("select report from public.regional_freight_estimates where id=%s", (transfer[1],)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.regional_freight_estimates where id=%s", (transfer[1],))
        assert db.execute("select count(*) from public.regional_transfer_handoffs where id=%s", (handoff,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.audit_log where record_id=%s", (handoff,)).fetchone()[0] == 2


@pytest.mark.parametrize('change', ['archive', 'delete_region'])
def test_new_export_requires_region_but_saved_retry_and_files_survive(transfer, change):
    source = transfer[0]
    old = approve(transfer)
    with session(source) as db:
        saved = db.execute(CREATE, (source[1], old)).fetchone()[0]
        payload = db.execute(
            'select payload from public.regional_transfer_handoffs where id=%s', (saved,)
        ).fetchone()[0]
    new = approve(transfer)
    with psycopg.connect(source[0]) as db:
        if change == 'archive':
            db.execute(
                'update public.stock_regions set archived_at=now(),archived_by=submitted_by where organization_id=%s',
                (source[1],),
            )
        else:
            db.execute('delete from public.stock_regions where organization_id=%s', (source[1],))
    with session(source) as db:
        assert db.execute(CREATE, (source[1], old)).fetchone()[0] == saved
        assert db.execute(
            'select payload from public.regional_transfer_handoffs where id=%s', (saved,)
        ).fetchone()[0] == payload
        assert db.execute(
            'select selected from public.regional_handoff_list where id=%s', (saved,)
        ).fetchone()[0] is False
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE, (source[1], new))
    assert error.value.sqlstate == 'MQ404'


@pytest.mark.parametrize('lock', ['region', 'lane', 'location'])
def test_first_save_rechecks_updates_held_before_export(transfer, lock):
    source = transfer[0]
    proposal = approve(transfer)
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        table = {'region': 'stock_regions', 'lane': 'network_links', 'location': 'locations'}[lock]
        admin.execute(
            f'select id from public.{table} where organization_id=%s order by id for update',
            (source[1],),
        )
        call = _Call(waiting, CREATE, (source[1], proposal))
        call.start()
        time.sleep(.3)
        assert not call.finished
        if lock == 'region':
            admin.execute(
                'update public.stock_regions set archived_at=now(),archived_by=submitted_by where organization_id=%s',
                (source[1],),
            )
        else:
            admin.execute(f'update public.{table} set is_active=false where organization_id=%s', (source[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ404' if lock == 'region' else 'MQ409')


@pytest.mark.parametrize('role', ['owner', 'admin', 'planner', 'approver', 'viewer', 'branch_user'])
def test_create_and_retry_use_current_editor_role(transfer, role):
    source = transfer[0]
    proposal = approve(transfer)
    with session(source) as db:
        saved = db.execute(CREATE, (source[1], proposal)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute(
            'update public.memberships set role=%s where organization_id=%s and user_id=%s',
            (role, source[1], source[2]),
        )
        if role == 'branch_user':
            db.execute(
                'insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s',
                (source[2], source[1]),
            )
    if role in ['owner', 'admin', 'planner']:
        with session(source) as db:
            assert db.execute(CREATE, (source[1], proposal)).fetchone()[0] == saved
    else:
        with session(source) as db, pytest.raises(psycopg.Error) as error:
            db.execute(CREATE, (source[1], proposal))
        assert error.value.sqlstate == 'MQ403'
