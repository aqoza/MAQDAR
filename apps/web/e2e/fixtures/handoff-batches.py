"""Local-only browser fixture: build approved handoffs through application RPCs."""
import json
import sys
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

dsn, organization, editor, approver = sys.argv[1:]
if urlsplit(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise ValueError('Local fixture only')


def call(actor, sql, args):
    with psycopg.connect(dsn) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=actor, org_id=organization, role='authenticated')),))
        return db.execute(sql, args).fetchone()[0]


location, supplier, calendar = [uuid4() for _ in range(3)]
with psycopg.connect(dsn) as db:
    db.execute("insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,'ALL','Every day','SA','{}',false)", (calendar,organization))
    db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,work_calendar_id) values(%s,%s,'BATCH','Batch branch','branch','SA','Asia/Riyadh',%s)", (location,organization,calendar))
    db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90,work_calendar_id) values(%s,%s,'SUP','Supplier','SA','SAR',3,5,%s)", (supplier,organization,calendar))

lines=[]
for index, unit, lead in [(1,'EA',3),(2,'KG',5),(3,'EA',3)]:
    item, run, policy = [uuid4() for _ in range(3)]
    code=f'BATCH-{index}'
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,'Item','Test',%s,1,'SAR')", (item,organization,code,unit))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',12,2,1,'SAR',%s)", (organization,item,location,unit))
        db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from) values(%s,%s,%s,%s,10,6,1.005,'SAR',%s,'2026-10-10')", (organization,supplier,item,lead,unit))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run,organization,location,uuid4()))
        evidence=dict(options=dict(lead_time=lead,review_interval=4),forecast=dict(to_date='2026-10-10',method='baseline-v1',source=dict(unit_provenance=dict(method='source-units-v1',status='consistent',unit=unit,rows=1,unknown_rows=0,units=[unit]))))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,%s,%s,'available',%s,%s)", (policy,organization,run,location,uuid4(),item,code,unit,Jsonb({'protection':{'target':'20.000'}}),Jsonb(evidence)))
    report=call(editor,"select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(organization,policy))
    draft=call(editor,"select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(organization,policy,uuid4(),report['fingerprint']))
    report=call(editor,"select public.supplier_scenario_preview(%s,%s,'SUP',true)",(organization,draft))
    scenario=call(editor,"select public.supplier_scenario_save(%s,%s,'SUP',true,%s,%s)",(organization,draft,uuid4(),report['fingerprint']))
    report=call(editor,"select public.delivery_scenario_preview(%s,%s,'2026-10-10',true)",(organization,scenario))
    delivery=call(editor,"select public.delivery_scenario_save(%s,%s,'2026-10-10',true,%s,%s)",(organization,scenario,uuid4(),report['fingerprint']))
    report=call(editor,'select public.purchase_cost_preview(%s,%s,true)',(organization,delivery))
    estimate=call(editor,'select public.purchase_cost_save(%s,%s,true,%s,%s)',(organization,delivery,uuid4(),report['fingerprint']))
    proposal=call(editor,'select public.purchase_proposal_submit(%s,%s,%s,%s)',(organization,estimate,uuid4(),'=1+1'))
    call(approver,'select public.purchase_proposal_decide(%s,%s,%s,%s,%s)',(organization,proposal,uuid4(),'approved','Reviewed'))
    handoff=call(editor,'select public.purchase_handoff_create(%s,%s)',(organization,proposal))
    lines.append(dict(handoff=str(handoff),item=str(item),estimate=str(estimate),proposal=str(proposal)))
print(json.dumps(dict(lines=lines,location=str(location))))
