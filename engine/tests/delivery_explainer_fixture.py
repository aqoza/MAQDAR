from pathlib import Path
from uuid import uuid4
import json
from psycopg.types.json import Jsonb
from supplier_explainer_fixture import seed_scenario as seed_supplier

def seed_scenario(db, organization, actor, location):
    supplier,run=seed_supplier(db,organization,actor,location)
    scenario=uuid4()
    report=json.loads((Path(__file__).parents[2]/'apps/web/e2e/helpers/delivery-explainer-fixture.json').read_text(encoding='utf-8'))
    draft=db.execute('select draft_id from public.supplier_scenarios where id=%s',(supplier,)).fetchone()[0]
    report['location_id']=str(location)
    report['source'].update(scenario_id=str(supplier),draft_id=str(draft))
    db.execute("insert into public.delivery_scenarios(id,organization_id,supplier_scenario_id,location_id,request_id,submitted_by,report) values(%s,%s,%s,%s,%s,%s,%s)",(scenario,organization,supplier,location,uuid4(),actor,Jsonb(report)))
    return scenario,run
