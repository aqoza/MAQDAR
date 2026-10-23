"""Real multi-item regional packages, all-location authority and immutable lifecycle."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest

from test_regional_handoffs_db import transfer, propose, reviewer, approve, DECIDE, CREATE as HANDOFF
from test_regional_review_db import SUBMIT
from psycopg.types.json import Jsonb
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.regional_handoff_batch_preview(%s,%s)"
CREATE = "select public.regional_handoff_batch_create(%s,%s)"


def make_item_handoff(transfer, template, code="SECOND", requested="2026-10-10", same_item=False):
    """Clone only synthetic catalog inputs, then exercise real planning/review/export RPCs."""
    source = transfer[0]
    allocation = template["estimate"]["source"]["source"]
    policies = {}
    with psycopg.connect(source[0]) as db:
        old_item = db.execute("select item_id from public.inventory_policies where id=%s",
                              (allocation['destination']['policy']['policy_id'],)).fetchone()[0]
        item = old_item if same_item else uuid4()
        if not same_item:
            db.execute("""insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
                values(%s,%s,%s,'Batch item','Test','EA',1,'SAR')""", (item,source[1],code))
            db.execute("""insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
                select organization_id,%s,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure
                from public.stock_snapshots where organization_id=%s and item_id=%s""",(item,source[1],old_item))
        old_policies = db.execute("select id,location_id,item_code from public.inventory_policies where organization_id=%s and item_id=%s order by location_id",
                                  (source[1],old_item)).fetchall()
        for old,location,saved_code in old_policies:
            run,policy=uuid4(),uuid4()
            db.execute("""insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at)
                values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',clock_timestamp())""",(run,source[1],location,uuid4()))
            db.execute("""insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
                select %s,organization_id,%s,location_id,%s,%s,%s,unit,status,summary,evidence from public.inventory_policies where id=%s""",
                (policy,run,uuid4(),item,saved_code if same_item else code,old))
            policies[str(location)]=str(policy)
    with session(source) as db:
        policy=policies[allocation['destination_location_id']]
        r=db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(source[1],policy)).fetchone()[0]
        draft=db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(source[1],policy,uuid4(),r['fingerprint'])).fetchone()[0]
        inputs=dict(allocation['input'],draft_id=str(draft),sources=[dict(s,policy_id=policies[s['location_id']]) for s in allocation['input']['sources']])
        r=db.execute("select public.regional_sourcing_preview(%s,%s)",(source[1],Jsonb(inputs))).fetchone()[0]
        parent=db.execute("select public.regional_sourcing_save(%s,%s,%s,%s)",(source[1],Jsonb(inputs),uuid4(),r['fingerprint'])).fetchone()[0]
        r=db.execute("select public.regional_date_preview(%s,%s,%s,true)",(source[1],parent,requested)).fetchone()[0]
        dates=db.execute("select public.regional_date_save(%s,%s,%s,true,%s,%s)",(source[1],parent,requested,uuid4(),r['fingerprint'])).fetchone()[0]
        r=db.execute("select public.regional_freight_preview(%s,%s,true)",(source[1],dates)).fetchone()[0]
        estimate=db.execute("select public.regional_freight_save(%s,%s,true,%s,%s)",(source[1],dates,uuid4(),r['fingerprint'])).fetchone()[0]
        proposal=db.execute(SUBMIT,(source[1],estimate,uuid4(),"Whole regional batch")).fetchone()[0]
    with reviewer(transfer) as db:
        db.execute(DECIDE,(source[1],proposal,uuid4(),"approved","All sources reviewed"))
    with session(source) as db:
        return db.execute(HANDOFF,(source[1],proposal)).fetchone()[0]


@pytest.fixture
def package(transfer):
    source = transfer[0]
    proposal = approve(transfer)
    with session(source) as db:
        first = db.execute(HANDOFF,(source[1],proposal)).fetchone()[0]
        template = db.execute("select payload from public.regional_transfer_handoffs where id=%s",(first,)).fetchone()[0]
    second = make_item_handoff(transfer, template)
    return source, [first,second], template


def test_real_multi_item_totals_canonical_retries_and_visible_overlap(package):
    source, ids, template = package
    with session(source) as db:
        preview = db.execute(PREVIEW,(source[1],ids)).fetchone()[0]
        expected = {}
        for h in preview["lines"]:
            for branch in h["estimate"]["lines"]:
                if branch["status"] == "available":
                    currency = branch["terms"]["currency"]
                    expected[currency] = expected.get(currency,Decimal(0)) + Decimal(branch["subtotal"])
        assert {t["currency"]:Decimal(t["subtotal"]) for t in preview["summary"]["totals"]} == expected
        assert expected["KWD"] == Decimal("4.690")  # Both original shipment fees remain.
        assert preview["summary"]["handoff_count"] == 2 and preview["summary"]["source_row_count"] == 4
        batch = db.execute(CREATE,(source[1],ids)).fetchone()[0]
        assert db.execute(CREATE,(source[1],ids[::-1])).fetchone()[0] == batch
        subset = db.execute(CREATE,(source[1],ids[:1])).fetchone()[0]
        assert db.execute("select overlap_count from public.regional_handoff_batch_list where id=%s",(batch,)).fetchone()[0] == 1
        assert db.execute("select batch_count from public.regional_handoff_batch_candidates where id=%s",(ids[0],)).fetchone()[0] == 2
        saved = db.execute("select payload from public.regional_handoff_batches where id=%s",(batch,)).fetchone()[0]
        assert template in saved["lines"] and saved["summary"] == preview["summary"]
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.audit_log where record_id=%s",(batch,)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.open_orders where organization_id=%s",(source[1],)).fetchone()[0] == 0


@pytest.mark.parametrize("case",["empty","null","duplicate","too_many","unknown","foreign_org"])
def test_selection_rejected_without_partial_records(package, case):
    source, ids, _ = package
    selection = {"empty":[],"null":[None],"duplicate":[ids[0],ids[0]],"too_many":[uuid4() for _ in range(51)],
                 "unknown":[ids[0],uuid4()],"foreign_org":ids}[case]
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(uuid4() if case=="foreign_org" else source[1],selection))
    assert error.value.sqlstate == ("MQ404" if case=="unknown" else "MQ403" if case=="foreign_org" else "MQ422")
    with session(source) as db:
        assert db.execute("select count(*) from public.regional_handoff_batches").fetchone()[0] == 0


def test_repeated_original_item_is_rejected_after_rename(package, transfer):
    source,ids,template=package
    same=make_item_handoff(transfer,template,same_item=True)
    with psycopg.connect(source[0]) as db:
        db.execute("update public.items set code='RENAMED' where organization_id=%s and code='REG-P'",(source[1],))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],[ids[0],same]))
    assert error.value.diag.message_hint == 'batch_duplicate_item'


@pytest.mark.parametrize('missing',['draft','policy','item'])
def test_original_identity_must_remain_verifiable(package, missing):
    source,ids,template=package
    with psycopg.connect(source[0]) as db:
        policy=template['estimate']['source']['source']['destination']['policy']['policy_id']
        if missing=='draft':
            db.execute('delete from public.replenishment_drafts where policy_id=%s',(policy,))
        elif missing=='policy':
            db.execute('delete from public.inventory_policies where id=%s',(policy,))
        else:
            db.execute('update public.inventory_policies set item_id=%s where id=%s',(uuid4(),policy))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.diag.message_hint == 'batch_identity_unavailable'


@pytest.mark.parametrize("change",["freight","lane","lead","location","timing","missing_timing","historical","archive"])
def test_stale_source_blocks_entire_new_batch_but_not_original_download(package, transfer, change):
    source, ids, template = package
    with session(source) as db:
        original = db.execute(CREATE,(source[1],ids[:1])).fetchone()[0]
        saved = db.execute("select payload from public.regional_handoff_batches where id=%s",(original,)).fetchone()[0]
    if change == "historical":
        approve(transfer)
    else:
        with psycopg.connect(source[0]) as db:
            statements = {
                "archive":"update public.stock_regions set archived_at=clock_timestamp(),archived_by=submitted_by where organization_id=%s",
                "freight":"update public.network_links set freight_cost=2 where organization_id=%s",
                "lane":"update public.network_links set is_active=false where organization_id=%s",
                "lead":"update public.network_links set lead_time_days_p90=9 where organization_id=%s",
                "location":"update public.locations set is_active=false where organization_id=%s",
                "timing":"update public.regional_transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,lines,0,receipts,p50,timing_review_required}','true') where organization_id=%s",
                "missing_timing":"update public.regional_transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,lines,0,receipts,p90,search,date}','null') where organization_id=%s",
            }
            db.execute(statements[change],(source[1],))
    with session(source) as db, pytest.raises(psycopg.Error):
        db.execute(CREATE,(source[1],ids))
    with session(source) as db:
        assert db.execute(CREATE,(source[1],ids[:1])).fetchone()[0] == original
        assert db.execute("select payload from public.regional_handoff_batches where id=%s",(original,)).fetchone()[0] == saved
        assert db.execute("select count(*) from public.regional_handoff_batches").fetchone()[0] == 1


def test_different_dispatch_rejected(package, transfer):
    source, ids, template = package
    other = make_item_handoff(transfer,template,"LATER",requested="2026-10-13")
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],[ids[0],other]))
    assert error.value.diag.message_hint == "batch_group_mismatch"


def test_copied_batch_survives_source_deletion_and_keeps_live_context_separate(package):
    source, ids, _ = package
    with session(source) as db:
        batch = db.execute(CREATE,(source[1],ids)).fetchone()[0]
        saved = db.execute("select payload from public.regional_handoff_batches where id=%s",(batch,)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.regional_transfer_handoffs where id=%s",(ids[0],))
    with session(source) as db:
        assert db.execute("select payload from public.regional_handoff_batches where id=%s",(batch,)).fetchone()[0] == saved
        assert db.execute("select selection from public.regional_handoff_batch_list where id=%s",(batch,)).fetchone()[0] == "unavailable"
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.sqlstate == "MQ404"


@pytest.mark.parametrize("transfer",[{"source_a_quantity":"22"}],indirect=True)
def test_zero_branches_are_copied_and_remain_in_read_scope(package):
    source, ids, template = package
    zero = next(x for x in template["estimate"]["lines"] if x["status"]=="no_transfer_needed")
    with session(source) as db:
        batch = db.execute(CREATE,(source[1],ids)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.memberships set role='branch_user' where organization_id=%s and user_id=%s",(source[1],source[2]))
        db.execute("insert into public.membership_locations select organization_id,%s,id from public.locations where organization_id=%s and id<>%s",
                   (source[2],source[1],zero["location_id"]))
    with session(source) as db:
        for table in ["regional_handoff_batches","regional_handoff_batch_list"]:
            assert db.execute(f"select count(*) from public.{table}").fetchone()[0] == 0
    with psycopg.connect(source[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)",(source[1],source[2],zero["location_id"]))
    with session(source) as db:
        payload = db.execute("select payload from public.regional_handoff_batches where id=%s",(batch,)).fetchone()[0]
        assert any(b["status"]=="no_transfer_needed" for h in payload["lines"] for b in h["estimate"]["lines"])
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.sqlstate == "MQ403"


def test_parallel_set_retry_creates_one_record(package):
    source,ids,_ = package
    with session(source) as first, session(source) as second:
        assert _race(first,second,CREATE,(source[1],ids),(source[1],ids[::-1])).sqlstate is None
    with session(source) as db:
        assert db.execute("select count(*) from public.regional_handoff_batches").fetchone()[0] == 1


@pytest.mark.parametrize("lock",["advisory","parent","location"])
@pytest.mark.parametrize("change,expected",[("role","MQ403"),("membership","MQ403"),("freight","MQ409")])
def test_waits_recheck_authority_and_evidence(package, lock, change, expected):
    source,ids,template = package
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        if lock == "parent" and change == "freight":
            admin.execute("select id from public.network_links where organization_id=%s order by id for update",(source[1],))
        if lock == "advisory":
            admin.execute("select pg_advisory_xact_lock(hashtextextended('zeespare.regional-review:'||%s,0))",(str(source[1]),))
        elif lock == "parent":
            admin.execute("select id from public.regional_transfer_handoffs where id=%s for update",(ids[0],))
        else:
            admin.execute("select id from public.locations where id=%s for update",(template["estimate"]["source"]["source"]["destination_location_id"],))
        call = _Call(waiting,CREATE,(source[1],ids))
        call.start()
        time.sleep(.3)
        assert not call.finished
        if change == "role":
            admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(source[1],source[2]))
        elif change == "membership":
            admin.execute("delete from public.memberships where organization_id=%s and user_id=%s",(source[1],source[2]))
        else:
            admin.execute("update public.network_links set freight_cost=2 where organization_id=%s",(source[1],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected


def test_later_approval_wins_before_waiting_batch(package, transfer):
    source,ids,_ = package
    proposal = propose(transfer)
    with reviewer(transfer) as first, session(source) as waiting:
        first.execute(DECIDE,(source[1],proposal,uuid4(),"approved","Replacement"))
        call = _Call(waiting,CREATE,(source[1],ids))
        call.start()
        time.sleep(.3)
        assert not call.finished
        first.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ409"


def test_participating_branch_deletion_cascades_copied_batch_and_audits(package):
    source,ids,template = package
    with session(source) as db:
        batch = db.execute(CREATE,(source[1],ids)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.regional_transfer_handoffs where id=any(%s)",(ids,))
        # Remove this synthetic organization's operational references before deleting a location.
        db.execute("delete from public.stock_snapshots where organization_id=%s",(source[1],))
        db.execute("delete from public.network_links where organization_id=%s",(source[1],))
        db.execute("delete from public.planning_runs where organization_id=%s",(source[1],))
        db.execute("delete from public.locations where id=%s",(template["estimate"]["lines"][0]["location_id"],))
        assert db.execute("select count(*) from public.regional_handoff_batches where id=%s",(batch,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.audit_log where record_id=%s",(batch,)).fetchone()[0] == 2


def test_missing_source_after_row_wait_cannot_create_batch(package):
    source,ids,_ = package
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select id from public.regional_transfer_handoffs where id=%s for update",(ids[0],))
        call = _Call(waiting,CREATE,(source[1],ids))
        call.start()
        time.sleep(.3)
        assert not call.finished
        admin.execute("delete from public.regional_transfer_handoffs where id=%s",(ids[0],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ404"


def test_duplicate_saved_code_after_catalog_reuse_is_rejected(package, transfer):
    source,ids,template=package
    with psycopg.connect(source[0]) as db:
        db.execute("update public.items set code='ORIGINAL-RENAMED' where organization_id=%s and code='REG-P'",(source[1],))
    duplicate=make_item_handoff(transfer,template,code='REG-P')
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],[ids[0],duplicate]))
    assert error.value.diag.message_hint == 'batch_duplicate_item'


@pytest.mark.parametrize('path',['{estimate,source,source,region,id}','{estimate,source,source,destination_location_id}'])
def test_mixed_saved_region_or_receiver_is_rejected(package,path):
    source,ids,_=package
    with psycopg.connect(source[0]) as db:
        db.execute('update public.regional_transfer_handoffs set payload=jsonb_set(payload,%s,to_jsonb(%s::text)) where id=%s',(path,str(uuid4()),sorted(ids)[1]))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.diag.message_hint == 'batch_group_mismatch'


def test_original_identity_copied_and_per_source_dispatches_preserved(package):
    source,ids,_=package
    with session(source) as db:
        preview=db.execute(PREVIEW,(source[1],ids)).fetchone()[0]
        assert len({x['item_id'] for x in preview['item_identities']})==2
        assert {x['handoff_id'] for x in preview['item_identities']}==set(map(str,ids))
        for h in preview['lines']:
            assert len({x['dispatch']['date'] for x in h['estimate']['source']['lines']})==2
        batch=db.execute(CREATE,(source[1],ids)).fetchone()[0]
        saved=db.execute('select payload from public.regional_handoff_batches where id=%s',(batch,)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute('delete from public.stock_regions where organization_id=%s',(source[1],))
        db.execute('delete from public.replenishment_drafts where organization_id=%s',(source[1],))
    with session(source) as db:
        assert db.execute(CREATE,(source[1],ids[::-1])).fetchone()[0]==batch
        assert db.execute('select payload from public.regional_handoff_batches where id=%s',(batch,)).fetchone()[0]==saved


@pytest.mark.parametrize('lock',['region','lane','item'])
def test_first_save_waits_for_archive_rate_or_identity_delete(package,lock):
    source,ids,template=package
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        if lock=='region':
            admin.execute('select id from public.stock_regions where organization_id=%s for update',(source[1],))
        elif lock=='lane':
            admin.execute('select id from public.network_links where organization_id=%s order by id for update',(source[1],))
        else:
            admin.execute('select id from public.inventory_policies where organization_id=%s order by id for update',(source[1],))
        call=_Call(waiting,CREATE,(source[1],ids));call.start();time.sleep(.3)
        assert not call.finished
        if lock=='region':
            admin.execute('update public.stock_regions set archived_at=clock_timestamp(),archived_by=submitted_by where organization_id=%s',(source[1],))
        elif lock=='lane':
            admin.execute('update public.network_links set freight_cost=9 where organization_id=%s',(source[1],))
        else:
            admin.execute('update public.inventory_policies set item_id=%s where organization_id=%s',(uuid4(),source[1]))
        admin.commit();call.join(timeout=15)
        assert call.finished and call.sqlstate==({'item':'MQ422','region':'MQ404','lane':'MQ409'}[lock])


def test_foreign_tenant_cannot_discover_saved_batches(package):
    source,ids,_=package
    with session(source) as db:
        db.execute(CREATE,(source[1],ids))
    with psycopg.connect(source[0]) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",('{"sub":"'+str(uuid4())+'","role":"authenticated"}',))
        for table in ['regional_handoff_batches','regional_handoff_batch_list','regional_handoff_batch_candidates']:
            assert db.execute(f'select count(*) from public.{table}').fetchone()[0]==0
