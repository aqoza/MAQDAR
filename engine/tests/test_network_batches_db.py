"""Real multi-item network packages, all-location authority and immutable lifecycle."""
import time
from decimal import Decimal
from uuid import uuid4

import psycopg
import pytest

from test_network_handoffs_db import (
    base_draft, draft, redistribution, base_network, network, dates, freight, transfer,
    propose, reviewer, approve, DECIDE, SUBMIT, CREATE as HANDOFF,
)
from test_replenishment_db import session
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.network_handoff_batch_preview(%s,%s)"
CREATE = "select public.network_handoff_batch_create(%s,%s)"


def make_item_handoff(transfer, template, code="SECOND", branch_limit=None, requested="2026-10-10"):
    """Clone synthetic inputs, then use the full real planning/review/export chain."""
    source = transfer[0]
    allocation = template["estimate"]["source"]["source"]
    item, source_policy = uuid4(), None
    branches = []
    with psycopg.connect(source[0]) as db:
        db.execute("""insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
            values(%s,%s,%s,'Batch item','Test','EA',1,'SAR')""", (item, source[1], code))
        db.execute("""insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
            select organization_id,%s,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure
            from public.stock_snapshots where organization_id=%s and item_id=%s""", (item, source[1], allocation["item_id"]))
        for old, location in db.execute("select id,location_id from public.inventory_policies where organization_id=%s and item_id=%s order by location_id",
                                       (source[1], allocation["item_id"])).fetchall():
            run, policy = uuid4(), uuid4()
            db.execute("""insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at)
                values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',clock_timestamp())""",
                (run,source[1],location,uuid4()))
            db.execute("""insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
                select %s,organization_id,%s,location_id,%s,%s,%s,unit,status,summary,evidence
                from public.inventory_policies where id=%s""", (policy,run,uuid4(),item,code,old))
            if str(location) == allocation["source_location_id"]:
                source_policy = policy
            else:
                branches.append(policy)
    with session(source) as db:
        drafts = []
        for policy in branches[:branch_limit]:
            report = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (source[1],policy)).fetchone()[0]
            drafts.append(db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",
                                    (source[1],policy,uuid4(),report["fingerprint"])).fetchone()[0])
        args = source[1], drafts, source_policy
        a = db.execute("select public.network_allocation_preview(%s,%s,%s,'calculated',null,'4.125',true,true)", args).fetchone()[0]
        parent = db.execute("select public.network_allocation_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)",
                            (*args,uuid4(),a["fingerprint"])).fetchone()[0]
        d = db.execute("select public.network_date_preview(%s,%s,%s,true)", (source[1],parent,requested)).fetchone()[0]
        schedule = db.execute("select public.network_date_save(%s,%s,%s,true,%s,%s)",
                              (source[1],parent,requested,uuid4(),d["fingerprint"])).fetchone()[0]
        f = db.execute("select public.network_freight_preview(%s,%s,true)", (source[1],schedule)).fetchone()[0]
        estimate = db.execute("select public.network_freight_save(%s,%s,true,%s,%s)",
                              (source[1],schedule,uuid4(),f["fingerprint"])).fetchone()[0]
        proposal = db.execute(SUBMIT,(source[1],estimate,uuid4(),"Batch comparison")).fetchone()[0]
    with reviewer(transfer) as db:
        db.execute(DECIDE,(source[1],proposal,uuid4(),"approved","Every branch reviewed"))
    with session(source) as db:
        return db.execute(HANDOFF,(source[1],proposal)).fetchone()[0]


@pytest.fixture
def package(transfer):
    source = transfer[0]
    proposal = approve(transfer)
    with session(source) as db:
        first = db.execute(HANDOFF,(source[1],proposal)).fetchone()[0]
        template = db.execute("select payload from public.network_transfer_handoffs where id=%s",(first,)).fetchone()[0]
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
        assert expected["KWD"] == Decimal("17.530")  # Both original shipment fees remain.
        assert preview["summary"]["handoff_count"] == 2 and preview["summary"]["branch_row_count"] == 4
        batch = db.execute(CREATE,(source[1],ids)).fetchone()[0]
        assert db.execute(CREATE,(source[1],ids[::-1])).fetchone()[0] == batch
        subset = db.execute(CREATE,(source[1],ids[:1])).fetchone()[0]
        assert db.execute("select overlap_count from public.network_handoff_batch_list where id=%s",(batch,)).fetchone()[0] == 1
        assert db.execute("select batch_count from public.network_handoff_batch_candidates where id=%s",(ids[0],)).fetchone()[0] == 2
        saved = db.execute("select payload from public.network_handoff_batches where id=%s",(batch,)).fetchone()[0]
        assert template in saved["lines"] and saved["summary"] == preview["summary"]
    with psycopg.connect(source[0]) as db:
        assert db.execute("select count(*) from public.audit_log where record_id=%s",(batch,)).fetchone()[0] == 1
        assert db.execute("select count(*) from public.open_orders where organization_id=%s",(source[1],)).fetchone()[0] == 0


def test_different_branch_sets_keep_whole_approvals(package, transfer):
    source, ids, template = package
    third = make_item_handoff(transfer,template,"SUBSET",branch_limit=1)
    with session(source) as db:
        report = db.execute(PREVIEW,(source[1],[ids[0],third])).fetchone()[0]
        assert report["summary"]["branch_row_count"] == 3
        assert sorted(len(h["estimate"]["lines"]) for h in report["lines"]) == [1,2]
        assert len(report["required_location_ids"]) == 3
        db.execute(CREATE,(source[1],[ids[0],third]))


@pytest.mark.parametrize("case",["empty","null","duplicate","too_many","unknown","foreign_org"])
def test_selection_rejected_without_partial_records(package, case):
    source, ids, _ = package
    selection = {"empty":[],"null":[None],"duplicate":[ids[0],ids[0]],"too_many":[uuid4() for _ in range(51)],
                 "unknown":[ids[0],uuid4()],"foreign_org":ids}[case]
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(uuid4() if case=="foreign_org" else source[1],selection))
    assert error.value.sqlstate == ("MQ404" if case=="unknown" else "MQ403" if case=="foreign_org" else "MQ422")
    with session(source) as db:
        assert db.execute("select count(*) from public.network_handoff_batches").fetchone()[0] == 0


@pytest.mark.parametrize("path,value_key", [
    ("{estimate,source,source,source_policy,item_code}","code"),
    ("{estimate,source,source,item_id}","id"),
])
def test_repeated_items_and_codes_are_rejected(package, path, value_key):
    source, ids, template = package
    allocation = template["estimate"]["source"]["source"]
    value = allocation["item_id"] if value_key=="id" else allocation["source_policy"]["item_code"]
    with psycopg.connect(source[0]) as db:
        db.execute("update public.network_transfer_handoffs set payload=jsonb_set(payload,%s,to_jsonb(%s::text)) where id=%s",
                   (path,value,ids[1]))
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.diag.message_hint == "batch_duplicate_item"


@pytest.mark.parametrize("change",["freight","lane","lead","location","timing","missing_timing","historical"])
def test_stale_source_blocks_entire_new_batch_but_not_original_download(package, transfer, change):
    source, ids, template = package
    with session(source) as db:
        original = db.execute(CREATE,(source[1],ids[:1])).fetchone()[0]
        saved = db.execute("select payload from public.network_handoff_batches where id=%s",(original,)).fetchone()[0]
    if change == "historical":
        approve(transfer)
    else:
        with psycopg.connect(source[0]) as db:
            statements = {
                "freight":"update public.network_links set freight_cost=2 where organization_id=%s",
                "lane":"update public.network_links set is_active=false where organization_id=%s",
                "lead":"update public.network_links set lead_time_days_p90=9 where organization_id=%s",
                "location":"update public.locations set is_active=false where organization_id=%s",
                "timing":"update public.network_transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,lines,0,receipts,p50,timing_review_required}','true') where organization_id=%s",
                "missing_timing":"update public.network_transfer_handoffs set payload=jsonb_set(payload,'{estimate,source,lines,0,receipts,p90,search,date}','null') where organization_id=%s",
            }
            db.execute(statements[change],(source[1],))
    with session(source) as db, pytest.raises(psycopg.Error):
        db.execute(CREATE,(source[1],ids))
    with session(source) as db:
        assert db.execute(CREATE,(source[1],ids[:1])).fetchone()[0] == original
        assert db.execute("select payload from public.network_handoff_batches where id=%s",(original,)).fetchone()[0] == saved
        assert db.execute("select count(*) from public.network_handoff_batches").fetchone()[0] == 1


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
        saved = db.execute("select payload from public.network_handoff_batches where id=%s",(batch,)).fetchone()[0]
    with psycopg.connect(source[0]) as db:
        db.execute("delete from public.network_transfer_handoffs where id=%s",(ids[0],))
    with session(source) as db:
        assert db.execute("select payload from public.network_handoff_batches where id=%s",(batch,)).fetchone()[0] == saved
        assert db.execute("select selection from public.network_handoff_batch_list where id=%s",(batch,)).fetchone()[0] == "unavailable"
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.sqlstate == "MQ404"


@pytest.mark.parametrize("network",["zero"],indirect=True)
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
        for table in ["network_handoff_batches","network_handoff_batch_list"]:
            assert db.execute(f"select count(*) from public.{table}").fetchone()[0] == 0
    with psycopg.connect(source[0]) as db:
        db.execute("insert into public.membership_locations values(%s,%s,%s)",(source[1],source[2],zero["location_id"]))
    with session(source) as db:
        payload = db.execute("select payload from public.network_handoff_batches where id=%s",(batch,)).fetchone()[0]
        assert any(b["status"]=="no_transfer_needed" for h in payload["lines"] for b in h["estimate"]["lines"])
    with session(source) as db, pytest.raises(psycopg.Error) as error:
        db.execute(CREATE,(source[1],ids))
    assert error.value.sqlstate == "MQ403"


def test_parallel_set_retry_creates_one_record(package):
    source,ids,_ = package
    with session(source) as first, session(source) as second:
        assert _race(first,second,CREATE,(source[1],ids),(source[1],ids[::-1])).sqlstate is None
    with session(source) as db:
        assert db.execute("select count(*) from public.network_handoff_batches").fetchone()[0] == 1


@pytest.mark.parametrize("lock",["advisory","parent","location"])
@pytest.mark.parametrize("change,expected",[("role","MQ403"),("membership","MQ403"),("freight","MQ409")])
def test_waits_recheck_authority_and_evidence(package, lock, change, expected):
    source,ids,template = package
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        if lock == "advisory":
            admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.network-review:'||%s,0))",(str(source[1]),))
        elif lock == "parent":
            admin.execute("select id from public.network_transfer_handoffs where id=%s for update",(ids[0],))
        else:
            admin.execute("select id from public.locations where id=%s for update",(template["estimate"]["source_location_id"],))
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
        db.execute("delete from public.network_transfer_handoffs where id=any(%s)",(ids,))
        # Remove this synthetic organization's operational references before deleting a location.
        db.execute("delete from public.stock_snapshots where organization_id=%s",(source[1],))
        db.execute("delete from public.network_links where organization_id=%s",(source[1],))
        db.execute("delete from public.planning_runs where organization_id=%s",(source[1],))
        db.execute("delete from public.locations where id=%s",(template["estimate"]["lines"][0]["location_id"],))
        assert db.execute("select count(*) from public.network_handoff_batches where id=%s",(batch,)).fetchone()[0] == 0
        assert db.execute("select count(*) from public.audit_log where record_id=%s",(batch,)).fetchone()[0] == 2


def test_missing_source_after_row_wait_cannot_create_batch(package):
    source,ids,_ = package
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute("select id from public.network_transfer_handoffs where id=%s for update",(ids[0],))
        call = _Call(waiting,CREATE,(source[1],ids))
        call.start()
        time.sleep(.3)
        assert not call.finished
        admin.execute("delete from public.network_transfer_handoffs where id=%s",(ids[0],))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == "MQ404"
