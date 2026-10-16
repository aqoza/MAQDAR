"""Independent sessions verify draft retries, changed previews and live authority."""
import json
import time
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.replenishment_preview(%s,%s,'calculated',null,'4',true)"
SAVE = "select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)"


@pytest.fixture
def draft(dsn):
    org, user, location, item, run, policy = [uuid4() for _ in range(6)]
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.organizations(id,slug,name) values(%s,%s,'Drafts')", (org, f"draft-{org}"))
        db.execute("insert into auth.users(id,email) values(%s,%s)", (user, f"draft-{user}@test.local"))
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'planner')", (org,user))
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'L','Branch','branch','SA','Asia/Riyadh')", (location,org))
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'ITEM','Item','Test','EA',1,'SAR')", (item,org))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',12,2,1,'SAR','EA')", (org,item,location))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run,org,location,uuid4()))
        evidence={"options":{"lead_time":3,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'ITEM','EA','available',%s,%s)", (policy,org,run,location,uuid4(),item,Jsonb({"protection":{"target":"20.000"}}),Jsonb(evidence)))
    yield dsn,org,user,policy
    with psycopg.connect(dsn) as db:
        db.execute("delete from public.organizations where id=%s", (org,))
        db.execute("delete from auth.users where id=%s", (user,))
        db.execute("delete from public.audit_log where organization_id=%s", (org,))


def session(draft):
    db=psycopg.connect(draft[0])
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(draft[2]),org_id=str(draft[1]),role='authenticated')),))
    return db


def preview(draft):
    with session(draft) as db:
        return db.execute(PREVIEW,(draft[1],draft[3])).fetchone()[0]


def test_parallel_retries_save_one_immutable_record(draft):
    report=preview(draft)
    args=(draft[1],draft[3],uuid4(),report['fingerprint'])
    with session(draft) as first, session(draft) as second:
        assert _race(first,second,SAVE,args,args).sqlstate is None
    with psycopg.connect(draft[0]) as db:
        saved=db.execute("select report from public.replenishment_drafts where organization_id=%s", (draft[1],)).fetchall()
        assert saved==[(report,)]
        assert db.execute("select count(*) from public.audit_log where organization_id=%s and table_name='replenishment_drafts'", (draft[1],)).fetchone()[0]==1


def test_changed_stock_rejects_preview_and_new_preview_saves(draft):
    old=preview(draft)
    with psycopg.connect(draft[0]) as db:
        db.execute("update public.stock_snapshots set quantity=3 where organization_id=%s", (draft[1],))
    with session(draft) as db, pytest.raises(psycopg.Error) as error:
        db.execute(SAVE,(draft[1],draft[3],uuid4(),old['fingerprint']))
    assert error.value.sqlstate=='MQ409'
    fresh=preview(draft)
    assert fresh['gap']=='23.000'
    with session(draft) as db:
        db.execute(SAVE,(draft[1],draft[3],uuid4(),fresh['fingerprint']))


def test_edit_role_is_rechecked_after_waiting_for_save_lock(draft):
    report=preview(draft)
    with psycopg.connect(draft[0]) as admin, session(draft) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.replenishment:'||%s,0))", (str(draft[1]),))
        call=_Call(waiting,SAVE,(draft[1],draft[3],uuid4(),report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (draft[1],draft[2]))
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ403'
    with psycopg.connect(draft[0]) as db:
        assert db.execute("select count(*) from public.replenishment_drafts where organization_id=%s", (draft[1],)).fetchone()[0]==0
