from pathlib import Path
from uuid import uuid4
import json
from psycopg.types.json import Jsonb

def seed_draft(db, organization, actor, location):
    run, policy, draft, item = [uuid4() for _ in range(4)]
    db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-01','policy','succeeded','{}','{}',now())",(run,organization,location,uuid4()))
    db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'AI-PART','EA','available','{}','{}')",(policy,organization,run,location,uuid4(),item))
    report=json.loads((Path(__file__).parents[2]/'apps/web/e2e/helpers/replenishment-explainer-fixture.json').read_text(encoding='utf-8'))
    report['location_id']=str(location)
    report['policy'].update(policy_id=str(policy),run_id=str(run))
    db.execute("insert into public.replenishment_drafts(id,organization_id,policy_id,location_id,request_id,submitted_by,report) values(%s,%s,%s,%s,%s,%s,%s)",(draft,organization,policy,location,uuid4(),actor,Jsonb(report)))
    return draft,run
