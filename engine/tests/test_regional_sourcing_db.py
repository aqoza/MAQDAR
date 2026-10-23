"""Exact allocations, immutable evidence and independent-session save authority."""
import time
from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from regional_sourcing_fixture import seed_regional_sourcing
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.regional_sourcing_preview(%s,%s)"
SAVE = "select public.regional_sourcing_save(%s,%s,%s,%s)"


@pytest.fixture
def sourcing(dsn):
    org, user = uuid4(), uuid4()
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Regional sourcing')", (org, f"sourcing-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"sourcing-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        inputs, report = seed_regional_sourcing(db, org, user)
    yield (dsn, org, user), inputs, report
    with psycopg.connect(dsn) as db:
        db.execute("delete from public.organizations where id=%s", (org,))
        db.execute("delete from auth.users where id=%s", (user,))
        db.execute("delete from public.audit_log where organization_id=%s", (org,))


def arguments(sourcing):
    fixture, inputs, report = sourcing
    return fixture[1], Jsonb(inputs), uuid4(), report['fingerprint']


def test_exact_proportional_shares_and_canonical_retry(sourcing):
    fixture, inputs, report = sourcing
    assert report['status'] == 'available'
    assert Decimal(report['allocated']) == 14
    assert {line['location_code']: Decimal(line['quantity']) for line in report['lines']} == {'SOURCE-A': Decimal('4.667'), 'SOURCE-B': Decimal('9.333')}
    assert Decimal(report['remaining_gap']) == 0
    for line in report['lines']:
        assert Decimal(line['retained_available']) >= Decimal(line['source_policy']['maximum'])
    args = arguments(sourcing)
    reordered = {**inputs, 'sources': list(reversed(inputs['sources']))}
    with session(fixture) as first, session(fixture) as second:
        assert _race(first, second, SAVE, args, (args[0], Jsonb(reordered), *args[2:])).sqlstate is None
    with psycopg.connect(fixture[0]) as db:
        assert db.execute("select report from public.regional_sourcing_scenarios where organization_id=%s", (fixture[1],)).fetchall() == [(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='regional_sourcing_scenarios' and operation='INSERT'", (fixture[1],)).fetchone()[0] == 1


def test_conflicting_retry_does_not_replace_evidence(sourcing):
    fixture, inputs, _ = sourcing
    args = arguments(sourcing)
    other = deepcopy(inputs)
    other['sources'][0]['backorders'] = '1'
    with session(fixture) as first, session(fixture) as second:
        assert _race(first, second, SAVE, args, (args[0], Jsonb(other), *args[2:])).sqlstate == 'MQ409'


@pytest.mark.parametrize('retry', [False, True])
def test_request_wait_rechecks_editor(sourcing, retry):
    fixture, _, _ = sourcing
    args = arguments(sourcing)
    if retry:
        with session(fixture) as db:
            db.execute(SAVE, args)
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-sourcing:'||%s||':'||%s,0))", (str(fixture[1]), str(args[2])))
        call = _Call(waiting, SAVE, args)
        call.start()
        time.sleep(0.4)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s", (fixture[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ403'


@pytest.mark.parametrize('change,expected', [('stock', 'MQ409'), ('lane', 'MQ409'), ('location', 'MQ409'), ('inactive', 'MQ404'), ('role', 'MQ403'), ('scope', 'MQ404')])
def test_location_wait_rechecks_evidence_and_authority(sourcing, change, expected):
    fixture, inputs, _ = sourcing
    args = arguments(sourcing)
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select id from public.locations where organization_id=%s order by id for update", (fixture[1],))
        call = _Call(waiting, SAVE, args)
        call.start()
        time.sleep(0.4)
        assert not call.finished
        if change == 'stock':
            admin.execute("update public.stock_snapshots set quantity=quantity+1 where location_id=%s", (inputs['sources'][0]['location_id'],))
        elif change == 'lane':
            admin.execute("update public.network_links set lead_time_days_p90=5 where organization_id=%s", (fixture[1],))
        elif change == 'location':
            admin.execute("update public.locations set name_en='Changed' where organization_id=%s", (fixture[1],))
        elif change == 'inactive':
            admin.execute("update public.locations set is_active=false where organization_id=%s", (fixture[1],))
        elif change == 'role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s", (fixture[1],))
        else:
            admin.execute("update public.memberships set role='branch_user' where organization_id=%s", (fixture[1],))
        admin.commit()
        call.join(timeout=15)
        # branch_user also loses editor authority; test location loss separately below.
        assert call.finished and call.sqlstate == ('MQ403' if change == 'scope' else expected)


def test_archive_committed_before_save_prevents_new_record(sourcing):
    fixture, inputs, _ = sourcing
    with session(fixture) as archiving, session(fixture) as waiting:
        archiving.execute("select public.stock_region_archive(%s,%s)", (fixture[1], inputs['region_id']))
        call = _Call(waiting, SAVE, arguments(sourcing))
        call.start()
        time.sleep(0.4)
        assert not call.finished
        archiving.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == 'MQ404'


def test_save_before_archive_retains_history_and_retry(sourcing):
    fixture, inputs, report = sourcing
    args = arguments(sourcing)
    with session(fixture) as saving, session(fixture) as archiving:
        saved = saving.execute(SAVE, args).fetchone()[0]
        call = _Call(archiving, "select public.stock_region_archive(%s,%s)", (fixture[1], inputs['region_id']))
        call.start()
        time.sleep(0.4)
        assert not call.finished
        saving.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate is None
        archiving.commit()
    with session(fixture) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
        assert db.execute("select report from public.regional_sourcing_scenarios where id=%s", (saved,)).fetchone()[0] == report


@pytest.mark.parametrize('change', ['stock', 'region', 'draft', 'policy'])
def test_copied_history_survives_source_deletion(sourcing, change):
    fixture, _, report = sourcing
    args = arguments(sourcing)
    with session(fixture) as db:
        saved = db.execute(SAVE, args).fetchone()[0]
    table = {'stock': 'stock_snapshots', 'region': 'stock_regions', 'draft': 'replenishment_drafts', 'policy': 'inventory_policies'}[change]
    with psycopg.connect(fixture[0]) as db:
        db.execute(f"delete from public.{table} where organization_id=%s", (fixture[1],))
    with session(fixture) as db:
        assert db.execute(SAVE, args).fetchone()[0] == saved
        assert db.execute("select report from public.regional_sourcing_scenarios where id=%s", (saved,)).fetchone()[0] == report


def test_destination_commitments_stay_fixed_after_stock_changes(sourcing):
    fixture, inputs, report = sourcing
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.stock_snapshots set quantity=999 where location_id=%s", (report['destination_location_id'],))
    with session(fixture) as db:
        assert db.execute(PREVIEW, (fixture[1], Jsonb(inputs))).fetchone()[0] == report


@pytest.mark.parametrize('change,status', [
    ('stock_date', 'stock_date_mismatch'), ('stock_unit', 'source_unavailable'),
    ('lane', 'lane_inactive'), ('cutoff', 'cutoff_mismatch'), ('prepared', 'prepared_group'),
])
def test_one_unavailable_source_blocks_the_complete_scenario(sourcing, change, status):
    fixture, inputs, _ = sourcing
    source = inputs['sources'][0]
    with psycopg.connect(fixture[0]) as db:
        if change == 'stock_date':
            db.execute("update public.stock_snapshots set snapshot_date='2026-10-09' where location_id=%s", (source['location_id'],))
        elif change == 'stock_unit':
            db.execute("update public.stock_snapshots set unit_of_measure='SET' where location_id=%s", (source['location_id'],))
        elif change == 'lane':
            db.execute("update public.network_links set is_active=false where from_location_id=%s", (source['location_id'],))
        elif change == 'cutoff':
            db.execute("update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,to_date}','\"2026-10-09\"') where id=%s", (source['policy_id'],))
        else:
            db.execute("update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','\"regional-v1\"') where id=%s", (source['policy_id'],))
    with session(fixture) as db:
        report = db.execute(PREVIEW, (fixture[1], Jsonb(inputs))).fetchone()[0]
        assert report['status'] == 'unavailable' and report['allocated'] is None
        assert next(line for line in report['lines'] if line['location_id'] == source['location_id'])['status'] == status
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE, (fixture[1], Jsonb(inputs), uuid4(), report['fingerprint']))
    assert error.value.sqlstate == 'MQ422'


def test_twenty_members_conserve_budget_and_every_source_cap(sourcing):
    fixture, inputs, report = sourcing
    expanded = deepcopy(inputs)
    with psycopg.connect(fixture[0]) as db:
        item = db.execute("select item_id from public.inventory_policies where id=%s", (inputs['sources'][0]['policy_id'],)).fetchone()[0]
        for n in range(17):
            location, run, policy = [uuid4() for _ in range(3)]
            db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,'Additional source','branch','SA','Asia/Riyadh')", (location, fixture[1], f'R{n:02}'))
            db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run, fixture[1], location, uuid4()))
            db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) select %s,organization_id,%s,%s,%s,item_id,item_code,unit,status,summary,evidence from public.inventory_policies where id=%s", (policy, run, location, uuid4(), inputs['sources'][0]['policy_id']))
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',21,0,1,'SAR','EA')", (fixture[1], item, location))
            db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')", (fixture[1], location, report['destination_location_id']))
            expanded['sources'].append(dict(location_id=str(location), policy_id=str(policy), maximum='calculated', backorders='0'))
    with session(fixture) as db:
        definition = dict(name_en='Twenty members', location_codes=['DEST', 'SOURCE-A', 'SOURCE-B'] + [f'R{n:02}' for n in range(17)], confirmed=True)
        preview = db.execute("select public.stock_region_preview(%s,%s)", (fixture[1], Jsonb(definition))).fetchone()[0]
        region = db.execute("select public.stock_region_save(%s,%s,%s,%s)", (fixture[1], Jsonb(definition), uuid4(), preview['fingerprint'])).fetchone()[0]
        expanded['region_id'] = str(region)
        result = db.execute(PREVIEW, (fixture[1], Jsonb(expanded))).fetchone()[0]
        assert len(result['lines']) == 19 and len(result['locations']) == 20
        assert sum(Decimal(line['quantity']) for line in result['lines']) == Decimal(result['allocated']) == 14
        assert all(Decimal('0') <= Decimal(line['quantity']) <= Decimal(line['surplus']) for line in result['lines'])
        db.execute(SAVE, (fixture[1], Jsonb(expanded), uuid4(), result['fingerprint']))
