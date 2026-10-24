from pathlib import Path
from uuid import uuid4
import json
from psycopg.types.json import Jsonb
from replenishment_explainer_fixture import seed_draft

def seed_scenario(db, organization, actor, location):
    draft,run=seed_draft(db,organization,actor,location)
    scenario=uuid4()
    report=json.loads((Path(__file__).parents[2]/'apps/web/e2e/helpers/supplier-explainer-fixture.json').read_text(encoding='utf-8'))
    policy=db.execute('select policy_id from public.replenishment_drafts where id=%s',(draft,)).fetchone()[0]
    report['location_id']=str(location)
    report['source'].update(draft_id=str(draft),policy_id=str(policy))
    db.execute("insert into public.supplier_scenarios(id,organization_id,draft_id,location_id,request_id,submitted_by,report) values(%s,%s,%s,%s,%s,%s,%s)",(scenario,organization,draft,location,uuid4(),actor,Jsonb(report)))
    return scenario,run
