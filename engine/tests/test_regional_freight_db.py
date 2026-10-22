"""Per-source freight, exact totals and post-wait authority checks."""
import json
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb
from regional_freight_fixture import seed_regional_freight
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.regional_freight_preview(%s,%s,true)"
SAVE = "select public.regional_freight_save(%s,%s,true,%s,%s)"


@pytest.fixture
def freight(dsn):
    org, user = uuid4(), uuid4()
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Regional freight')", (org, f"regional-freight-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"regional-freight-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org, user))
        parent, report = seed_regional_freight(db, org, user)
    assert report['status'] == 'available'
    yield (dsn, org, user), (org, parent), report
    with psycopg.connect(dsn) as db:
        db.execute("delete from public.organizations where id=%s", (org,))
        db.execute("delete from auth.users where id=%s", (user,))
        db.execute("delete from public.audit_log where organization_id=%s", (org,))



def test_exact_costs_per_source_dates_and_currency_totals(freight):
    fixture, inputs, report = freight
    from decimal import Decimal
    lines = {x['location_code']: x for x in report['lines']}
    assert lines['SOURCE-A']['dispatch_date'] == '2026-10-12'
    assert lines['SOURCE-B']['dispatch_date'] == '2026-10-11'
    assert Decimal(lines['SOURCE-A']['exact_product']) == Decimal('4.667')*Decimal('1.235')
    assert lines['SOURCE-A']['subtotal'] == '5.76'
    assert lines['SOURCE-B']['subtotal'] == '2.345'
    assert lines['SOURCE-B']['shipment_count'] == 1
    assert report['totals'] == [dict(currency='KWD',minor_units=3,subtotal='2.345'),dict(currency='SAR',minor_units=2,subtotal='5.76')]
    assert report['source']['lines'][0]['receipts']  # retained, including timing warnings
    with session(fixture) as db:
        db.execute(SAVE,(*inputs,uuid4(),report['fingerprint']))
        assert db.execute("select count(*) from public.open_orders where organization_id=%s", (inputs[0],)).fetchone()[0] == 0


@pytest.mark.parametrize('currency,rate,expected', [('SAR','1.005','2.02'),('KWD','1.005','2.010'),('JPY','1.500','4')])
def test_round_each_shipment_before_summing(freight,currency,rate,expected):
    fixture, inputs, _ = freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set freight_basis='per_shipment',currency=%s,freight_cost=%s where organization_id=%s", (currency,rate,inputs[0]))
    with session(fixture) as db:
        report=db.execute(PREVIEW,inputs).fetchone()[0]
        assert report['totals'][0]['subtotal']==expected
        assert len(report['totals'])==1


@pytest.mark.parametrize('change,status', [
    ("freight_basis='none',freight_cost=null,currency=null",'freight_unconfigured'),
    ("freight_unit=null",'unit_unknown'),("freight_unit='SET'",'unit_mismatch'),
    ("freight_cost='NaN'",'rate_invalid'),("freight_valid_from=null",'rate_date_unknown'),
    ("freight_valid_from='2026-10-13'",'rate_not_effective'),
    ("freight_cost=999999999999999.999",'amount_out_of_range'),
    ("is_active=false",'lane_unavailable'),("lead_time_days_p90=9",'lane_changed'),
])
def test_unavailable_line_never_produces_partial_totals(freight,change,status):
    fixture,inputs,original=freight
    lane=next(x for x in original['lines'] if x['location_code']=='SOURCE-A')['terms']['id']
    with psycopg.connect(fixture[0]) as db:
        db.execute(f"update public.network_links set {change} where id=%s",(lane,))
    with session(fixture) as db:
        report=db.execute(PREVIEW,inputs).fetchone()[0]
        assert report['status']=='line_unavailable' and report['totals']==[]
        assert next(x for x in report['lines'] if x['location_code']=='SOURCE-A')['status']==status
    with session(fixture) as db,pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(*inputs,uuid4(),original['fingerprint']))
    assert error.value.sqlstate=='MQ409'
    with session(fixture) as db,pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(*inputs,uuid4(),report['fingerprint']))
    assert error.value.sqlstate=='MQ422'


def test_effectivity_uses_each_source_dispatch(freight):
    fixture,inputs,_=freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set freight_valid_from='2026-10-12' where organization_id=%s",(inputs[0],))
    with session(fixture) as db:
        report=db.execute(PREVIEW,inputs).fetchone()[0]
        assert {x['location_code']:x['status'] for x in report['lines']}=={'SOURCE-A':'available','SOURCE-B':'rate_not_effective'}


def test_explicit_zero_rates_and_confirmation(freight):
    fixture,inputs,_=freight
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set freight_cost=0 where organization_id=%s",(inputs[0],))
    with session(fixture) as db:
        report=db.execute(PREVIEW,inputs).fetchone()[0]
        assert report['status']=='available' and all(float(x['subtotal'])==0 for x in report['totals'])
        pending=db.execute(PREVIEW.replace('true','false'),inputs).fetchone()[0]
        assert all(x['status']=='terms_unconfirmed' for x in pending['lines'])
    with session(fixture) as db,pytest.raises(psycopg.Error) as error:
        db.execute(SAVE.replace('true','false'),(*inputs,uuid4(),pending['fingerprint']))
    assert error.value.sqlstate=='MQ422'


@pytest.mark.parametrize('all_zero',[False,True])
def test_zero_lines_need_no_freight_but_keep_lane_and_member_checks(freight,all_zero):
    fixture,inputs,report=freight
    dates=report['source']
    for line in dates['lines'] if all_zero else dates['lines'][:1]:
        line.update(quantity='0',status='no_transfer_needed',dispatch=None,receipts={})
    if all_zero: dates['status']='no_transfer_needed'
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.regional_date_scenarios set report=%s where id=%s",(Jsonb(dates),inputs[1]))
        db.execute("update public.network_links set freight_basis='none',freight_cost=null,currency=null,freight_valid_from=null where from_location_id=%s",(dates['lines'][0]['location_id'],))
    with session(fixture) as db:
        report=db.execute(PREVIEW.replace('true','false') if all_zero else PREVIEW,inputs).fetchone()[0]
        assert report['status']==('no_transfer_needed' if all_zero else 'available')
        assert report['lines'][0]['subtotal'] is None and report['lines'][0]['dispatch_date'] is None
        db.execute(SAVE.replace('true','false') if all_zero else SAVE,(*inputs,uuid4(),report['fingerprint']))
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.network_links set is_active=false where from_location_id=%s",(dates['lines'][0]['location_id'],))
    with session(fixture) as db:
        assert db.execute(PREVIEW,inputs).fetchone()[0]['status']=='line_unavailable'


def test_fixed_commitments_calendars_and_immutable_concurrent_retry(freight):
    fixture,inputs,report=freight
    args=(*inputs,uuid4(),report['fingerprint'])
    with session(fixture) as first,session(fixture) as second:
        assert _race(first,second,SAVE,args,args).sqlstate is None
    with psycopg.connect(fixture[0]) as db:
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='regional_freight_estimates' and operation='INSERT'",(inputs[0],)).fetchone()[0]==1
        db.execute("update public.stock_snapshots set quantity=999 where organization_id=%s",(inputs[0],))
        db.execute("update public.work_calendars set weekend_days=array[]::integer[] where organization_id=%s",(inputs[0],))
    with session(fixture) as db:
        assert db.execute(PREVIEW,inputs).fetchone()[0]==report
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.stock_regions where organization_id=%s",(inputs[0],))
        db.execute("update public.network_links set freight_cost=9 where organization_id=%s",(inputs[0],))
    with session(fixture) as db:
        saved=db.execute(SAVE,args).fetchone()[0]
        assert db.execute("select report from public.regional_freight_estimates where id=%s",(saved,)).fetchone()[0]==report
    with session(fixture) as db,pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(*inputs,args[2],'f'*64))
    assert error.value.sqlstate=='MQ409'
    with psycopg.connect(fixture[0]) as db:
        db.execute("delete from public.regional_date_scenarios where id=%s",(inputs[1],))
        assert db.execute("select count(*) from public.regional_freight_estimates where id=%s",(saved,)).fetchone()[0]==0

@pytest.mark.parametrize('retry', [False, True])
@pytest.mark.parametrize('change', ['role','membership'])
def test_request_wait_rechecks_authority(freight, retry, change):
    fixture, inputs, report = freight
    args = (*inputs, uuid4(), report['fingerprint'])
    if retry:
        with session(fixture) as db:
            db.execute(SAVE,args)
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.regional-freight:'||%s||':'||%s,0))", (str(inputs[0]),str(args[2])))
        call = _Call(waiting,SAVE,args); call.start(); time.sleep(.3)
        assert not call.finished
        if change=='role':
            admin.execute("update public.memberships set role='viewer' where organization_id=%s", (inputs[0],))
        else:
            admin.execute("delete from public.memberships where organization_id=%s", (inputs[0],))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ403'


@pytest.mark.parametrize('lock,change,expected', [
    ('locations','rate','MQ409'),('locations','role','MQ403'),
    ('region','archive','MQ404'),('parent','role','MQ403'),
])
def test_row_wait_rechecks_evidence_and_permissions(freight, lock, change, expected):
    fixture, inputs, report = freight
    with psycopg.connect(fixture[0]) as admin, session(fixture) as waiting:
        if lock=='locations':
            admin.execute("select id from public.locations where organization_id=%s order by id for update", (inputs[0],))
        elif lock=='region':
            admin.execute("select id from public.stock_regions where organization_id=%s for update", (inputs[0],))
        else:
            admin.execute("select id from public.regional_date_scenarios where id=%s for update", (inputs[1],))
        call=_Call(waiting,SAVE,(*inputs,uuid4(),report['fingerprint'])); call.start(); time.sleep(.3)
        assert not call.finished
        if change=='rate':
            admin.execute("update public.network_links set freight_cost=9 where organization_id=%s", (inputs[0],))
        elif change=='archive':
            admin.execute("update public.stock_regions set archived_at=now(),archived_by=%s where organization_id=%s", (fixture[2],inputs[0]))
        else:
            admin.execute("update public.memberships set role='viewer' where organization_id=%s", (inputs[0],))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate==expected


def test_save_then_archive_retains_retry(freight):
    fixture, inputs, report = freight
    args=(*inputs,uuid4(),report['fingerprint'])
    with session(fixture) as saving, session(fixture) as archiving:
        saved=saving.execute(SAVE,args).fetchone()[0]
        call=_Call(archiving,"select public.stock_region_archive(%s,%s)",(inputs[0],report['source']['source']['region']['id']))
        call.start(); time.sleep(.3); assert not call.finished
        saving.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate is None
        archiving.commit()
    with session(fixture) as db:
        assert db.execute(SAVE,args).fetchone()[0]==saved
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(*inputs,uuid4(),report['fingerprint']))
    assert error.value.sqlstate=='MQ404'


def test_complete_location_access_and_foreign_claim(freight):
    fixture, inputs, report = freight
    with session(fixture) as db:
        saved=db.execute(SAVE,(*inputs,uuid4(),report['fingerprint'])).fetchone()[0]
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s", (inputs[0],))
        db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and id<>%s", (fixture[2],inputs[0],report['lines'][0]['location_id']))
    with session(fixture) as db:
        assert db.execute("select count(*) from public.regional_freight_list").fetchone()[0]==0
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute(PREVIEW,inputs)
    assert error.value.sqlstate=='MQ404'
    with psycopg.connect(fixture[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)",(inputs[0],fixture[2],report['lines'][0]['location_id']))
    with session(fixture) as db:
        assert db.execute("select report from public.regional_freight_estimates where id=%s",(saved,)).fetchone()[0]==report
    with session(fixture) as db, pytest.raises(psycopg.Error) as error:
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=str(fixture[2]),org_id=str(uuid4()),role='authenticated')),))
        db.execute(PREVIEW,inputs)
    assert error.value.sqlstate=='MQ404'


@pytest.mark.parametrize('who', ['source','destination'])
def test_inactive_locations_prevent_new_estimates(freight,who):
    fixture,inputs,report=freight
    location=report['receiver']['id'] if who=='destination' else report['lines'][0]['location_id']
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.locations set is_active=false where id=%s",(location,))
    with session(fixture) as db:
        fresh=db.execute(PREVIEW,inputs).fetchone()[0]
        assert fresh['status']==('destination_location_unavailable' if who=='destination' else 'line_unavailable')
    with session(fixture) as db,pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(*inputs,uuid4(),report['fingerprint']))
    assert error.value.sqlstate=='MQ409'


def test_currency_precision_changes_fingerprint(freight):
    fixture,inputs,report=freight
    # Transaction-local global reference mutation; rollback before returning to the shared stack.
    with psycopg.connect(fixture[0]) as db:
        db.execute("update public.currencies set minor_units=3 where code='SAR'")
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps(dict(sub=str(fixture[2]),org_id=str(inputs[0]),role='authenticated')),))
        db.execute('set local role authenticated')
        fresh=db.execute(PREVIEW,inputs).fetchone()[0]
        assert fresh['fingerprint']!=report['fingerprint']
        assert next(x for x in fresh['totals'] if x['currency']=='SAR')['subtotal']=='5.764'
        db.rollback()


def test_retry_is_bound_to_original_author(freight):
    fixture,inputs,report=freight
    args=(*inputs,uuid4(),report['fingerprint']);other=uuid4()
    with session(fixture) as db: db.execute(SAVE,args)
    with psycopg.connect(fixture[0]) as db:
        db.execute("insert into auth.users(id,email) values(%s,%s)",(other,f'freight-{other}@test.local'))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'admin')",(inputs[0],other))
    try:
        with session((fixture[0],inputs[0],other)) as db,pytest.raises(psycopg.Error) as error:
            db.execute(SAVE,args)
        assert error.value.sqlstate=='MQ409'
    finally:
        with psycopg.connect(fixture[0]) as db: db.execute('delete from auth.users where id=%s',(other,))
