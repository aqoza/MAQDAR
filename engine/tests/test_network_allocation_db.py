"""Network scenarios: exact allocation, all-location authority, retries and copied evidence."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session  # noqa: F401
from test_redistribution_db import redistribution  # noqa: F401
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.network_allocation_preview(%s,%s,%s,'calculated',null,'4.125',true,true)"
SAVE = "select public.network_allocation_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)"


@pytest.fixture
def network(redistribution):
    fixture, (org, first, policy), _ = redistribution
    location, run, branch_policy = [uuid4() for _ in range(3)]
    with psycopg.connect(fixture[0]) as db:
        source, item = db.execute("select location_id,item_id from public.inventory_policies where id=%s", (policy,)).fetchone()
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'BRANCH-2','Second branch','branch','SA','Asia/Riyadh')", (location, org))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',14,2,1,'SAR','EA')", (org, item, location))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run, org, location, uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) select %s,organization_id,%s,%s,%s,item_id,item_code,unit,status,summary,evidence from public.inventory_policies where id=%s", (branch_policy, run, location, uuid4(), policy))
        db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')", (org, source, location))
    with session(fixture) as db:
        report = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (org, branch_policy)).fetchone()[0]
        second = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)", (org, branch_policy, uuid4(), report['fingerprint'])).fetchone()[0]
        inputs = org, [first, second], policy
        preview = db.execute(PREVIEW, inputs).fetchone()[0]
    assert preview['status'] == 'available'
    return fixture, inputs, preview


def test_proportional_pool_is_exact_and_order_independent(network):
    fixture, inputs, report = network
    assert Decimal(report['source_surplus']) == Decimal('8.750')
    assert Decimal(report['total_gap']) == 26
    assert Decimal(report['allocated']) == Decimal('8.750')
    assert Decimal(report['retained_available']) == 20
    quantities = {Decimal(line['gap']): Decimal(line['quantity']) for line in report['lines']}
    assert quantities == {Decimal(14): Decimal('4.712'), Decimal(12): Decimal('4.038')}
    for line in report['lines']:
        assert Decimal(line['remaining_gap']) == Decimal(line['gap']) - Decimal(line['quantity'])
    with session(fixture) as db:
        assert db.execute(PREVIEW, (inputs[0], list(reversed(inputs[1])), inputs[2])).fetchone()[0] == report


def test_parallel_retries_and_canonical_order(network):
    fixture, inputs, report = network
    args = (*inputs, uuid4(), report['fingerprint'])
    with session(fixture) as first, session(fixture) as second:
        other = (inputs[0], list(reversed(inputs[1])), inputs[2], args[-2], args[-1])
        assert _race(first, second, SAVE, args, other).sqlstate is None
    with psycopg.connect(fixture[0]) as db:
        assert db.execute("select report from public.network_allocation_scenarios where organization_id=%s", (inputs[0],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='network_allocation_scenarios'", (inputs[0],)).fetchone()[0] == 1


def test_conflicting_reuse_and_wrong_organization_claim(network):
    fixture, inputs, report = network
    request = uuid4()
    with session(fixture) as db:
        db.execute(SAVE, (*inputs, request, report['fingerprint']))
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (inputs[0], inputs[1][:1], inputs[2], request, report['fingerprint']))
    assert error.value.sqlstate == 'MQ409'
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select set_config('request.jwt.claims',%s,true)", ('{"sub":"'+str(fixture[2])+'","org_id":"'+str(uuid4())+'","role":"authenticated"}',))
        db.execute(PREVIEW, inputs)
    assert error.value.sqlstate == 'MQ404'


def test_zero_surplus_is_valid_without_orders(network):
    fixture, inputs, _ = network
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.stock_snapshots set quantity=0 where location_id=(select location_id from public.inventory_policies where id=%s)", (inputs[2],))
    with session(fixture) as db:
        report = db.execute(PREVIEW, inputs).fetchone()[0]
        assert report['status'] == 'available'
        assert Decimal(report['allocated']) == 0
        assert all(Decimal(line['quantity']) == 0 for line in report['lines'])
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (inputs[0],)).fetchone()[0] == 0


@pytest.mark.parametrize("change", ["stock", "lane", "source_active", "branch_active", "source_type"])
def test_stale_evidence_never_saves(network, change):
    fixture, inputs, report = network
    source = report['source_location_id']
    with psycopg.connect(fixture[0]) as db:
        if change == 'stock':
            db.execute("update public.stock_snapshots set quantity=quantity+1 where organization_id=%s and location_id=%s", (inputs[0], source))
        elif change == 'lane':
            db.execute("update public.network_links set lead_time_days_p90=5 where organization_id=%s", (inputs[0],))
        elif change == 'source_type':
            db.execute("update public.locations set location_type='branch' where id=%s", (source,))
        else:
            db.execute("update public.locations set is_active=false where id=%s", (source if change == 'source_active' else report['lines'][0]['location_id'],))
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ409'


@pytest.mark.parametrize("change", ["role", "lane"])
def test_lock_wait_rechecks_authority_and_evidence(network, change):
    fixture, inputs, report = network
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.network-allocation:'||%s,0))", (str(inputs[0]),))
        call = _Call(waiting, SAVE, (*inputs, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        else:
            admin.execute("update public.network_links set is_active=false where organization_id=%s", (inputs[0],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == ('MQ403' if change == 'role' else 'MQ409')


def test_all_locations_required_and_read_only(network):
    fixture, inputs, report = network
    with session(fixture) as db:
        saved = db.execute(SAVE, (*inputs, uuid4(), report['fingerprint'])).fetchone()[0]
    locations = [report['source_location_id']] + [x['location_id'] for x in report['lines']]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s", (inputs[0], fixture[2]))
        for location in locations[:-1]:
            db.execute("insert into public.membership_locations values(%s,%s,%s)", (inputs[0], fixture[2], location))
    with session(fixture) as db:
        assert db.execute("select count(*) from public.network_allocation_scenarios where id=%s", (saved,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.network_allocation_list").fetchone()[0] == 0
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW, inputs)
    assert error.value.sqlstate == 'MQ404'
    with psycopg.connect(fixture[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)", (inputs[0], fixture[2], locations[-1]))
    with session(fixture) as db:
        assert db.execute("select report from public.network_allocation_scenarios where id=%s", (saved,)).fetchone()[0] == report
        assert db.execute(PREVIEW, inputs).fetchone()[0] == report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (*inputs, uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ403'


def test_saved_copy_retry_and_location_deletion(network):
    fixture, inputs, report = network
    args = (*inputs, uuid4(), report['fingerprint'])
    with session(fixture) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.replenishment_drafts where organization_id=%s", (inputs[0],))
        db.execute("delete from public.inventory_policies where id=%s", (inputs[2],))
        db.execute("delete from public.network_links where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
        assert db.execute("select report from public.network_allocation_scenarios where id=%s", (saved,)).fetchone()[0] == report
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.stock_snapshots where organization_id=%s", (inputs[0],))
        db.execute("delete from public.planning_runs where organization_id=%s", (inputs[0],))
        db.execute("delete from public.locations where id=%s", (report['lines'][0]['location_id'],))
        assert db.execute("select count(*) from public.network_allocation_scenarios where id=%s", (saved,)).fetchone()[0] == 0


@pytest.mark.parametrize("ids", ["empty", "duplicate", "null", "too_many", "foreign"])
def test_invalid_draft_sets_fail_without_saving(network, ids):
    fixture, inputs, report = network
    invalid = {"empty": [], "duplicate": [inputs[1][0]] * 2, "null": [None],
               "too_many": [uuid4() for _ in range(21)], "foreign": [uuid4()]}[ids]
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (inputs[0], invalid, inputs[2], uuid4(), report['fingerprint']))
    assert error.value.sqlstate == ('MQ404' if ids == 'foreign' else 'MQ422')


def test_two_drafts_for_same_branch_rejected(network):
    fixture, inputs, _ = network
    with session(fixture) as db:
        preview = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (inputs[0], fixture[3])).fetchone()[0]
        another = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)", (inputs[0], fixture[3], uuid4(), preview['fingerprint'])).fetchone()[0]
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW, (inputs[0], [inputs[1][0], another], inputs[2]))
    assert error.value.sqlstate == 'MQ422'


@pytest.mark.parametrize("change,status", [
    ("unit", "unit_mismatch"), ("stock_date", "stock_date_mismatch"),
    ("lane", "lane_inactive"), ("confirmation", "commitments_unconfirmed"),
])
def test_unavailable_evidence_keeps_quantities_unknown(network, change, status):
    fixture, inputs, _ = network
    with psycopg.connect(fixture[0]) as db:
        if change == 'unit':
            db.execute("update public.inventory_policies set unit='KG' where id=%s", (inputs[2],))
        elif change == 'stock_date':
            db.execute("update public.stock_snapshots set snapshot_date='2026-10-09' where location_id=(select location_id from public.inventory_policies where id=%s)", (inputs[2],))
        elif change == 'lane':
            db.execute("update public.network_links set is_active=false where organization_id=%s", (inputs[0],))
    with session(fixture) as db:
        report = db.execute(PREVIEW.replace("true,true", "false,true") if change == 'confirmation' else PREVIEW, inputs).fetchone()[0]
    assert report['status'] == 'line_unavailable'
    # Unit provenance may reject before the cross-location comparison.
    assert all(line['evidence']['status'] in (status, 'source_unavailable') for line in report['lines'])
    assert report['allocated'] is None
    assert all(line['quantity'] is None for line in report['lines'])
