"""Local-only fixture: three independent items through the real transfer RPC chain."""
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


location, source, calendar = [uuid4() for _ in range(3)]
with psycopg.connect(dsn) as db:
    db.execute("insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,'ALL','Every day','SA','{}',false)", (calendar,organization))
    for identity, code in [(location,'DESTINATION'), (source,'SOURCE')]:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,work_calendar_id) values(%s,%s,%s,%s,'branch','SA','Asia/Riyadh',%s)", (identity,organization,code,code,calendar))
    db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis,freight_cost,currency,freight_valid_from) values(%s,%s,%s,2,4,'per_shipment',1.005,'SAR','2026-10-10')", (organization,source,location))

lines=[]
for index, unit in [(1,'EA'),(2,'KG'),(3,'EA')]:
    item=uuid4()
    policies=[]
    code=f'BATCH-{index}'
    with psycopg.connect(dsn) as db:
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,'Item','Test',%s,1,'SAR')", (item,organization,code,unit))
        for endpoint,quantity in [(location,12),(source,35.125)]:
            run,policy=uuid4(),uuid4()
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,2,1,'SAR',%s)", (organization,item,endpoint,quantity,unit))
            db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run,organization,endpoint,uuid4()))
            evidence=dict(options=dict(lead_time=10,review_interval=4),forecast=dict(to_date='2026-10-10',method='baseline-v1',source=dict(unit_provenance=dict(method='source-units-v1',status='consistent',unit=unit,rows=1,unknown_rows=0,units=[unit]))))
            db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,%s,%s,'available',%s,%s)", (policy,organization,run,endpoint,uuid4(),item,code,unit,Jsonb({'protection':{'target':'20.000'}}),Jsonb(evidence)))
            policies.append(policy)
    report=call(editor,"select public.replenishment_preview(%s,%s,'calculated',null,'4',true)",(organization,policies[0]))
    draft=call(editor,"select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",(organization,policies[0],uuid4(),report['fingerprint']))
    report=call(editor,"select public.redistribution_preview(%s,%s,%s,'calculated',null,'4.125',true,true)",(organization,draft,policies[1]))
    redistribution=call(editor,"select public.redistribution_save(%s,%s,%s,'calculated',null,'4.125',true,true,%s,%s)",(organization,draft,policies[1],uuid4(),report['fingerprint']))
    report=call(editor,"select public.transfer_date_preview(%s,%s,'2026-10-10',true)",(organization,redistribution))
    dates=call(editor,"select public.transfer_date_save(%s,%s,'2026-10-10',true,%s,%s)",(organization,redistribution,uuid4(),report['fingerprint']))
    report=call(editor,'select public.transfer_freight_preview(%s,%s,true)',(organization,dates))
    estimate=call(editor,'select public.transfer_freight_save(%s,%s,true,%s,%s)',(organization,dates,uuid4(),report['fingerprint']))
    proposal=call(editor,'select public.transfer_proposal_submit(%s,%s,%s,%s)',(organization,estimate,uuid4(),'=1+1'))
    call(approver,'select public.transfer_proposal_decide(%s,%s,%s,%s,%s)',(organization,proposal,uuid4(),'approved','Reviewed'))
    handoff=call(editor,'select public.transfer_handoff_create(%s,%s)',(organization,proposal))
    lines.append(dict(handoff=str(handoff),item=str(item),estimate=str(estimate),proposal=str(proposal),scenario=str(dates)))
print(json.dumps(dict(lines=lines,location=str(location),source=str(source))))
