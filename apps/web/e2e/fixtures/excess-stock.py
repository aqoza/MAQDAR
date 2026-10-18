"""Loopback-only independent stock/policy fixtures for the excess assessment UI."""
import json
import sys
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

dsn, org, owner, viewer, branch = sys.argv[1:]
if urlparse(dsn).hostname not in {"localhost", "127.0.0.1", "::1"}:
    raise ValueError("Loopback fixtures only")
location = uuid4()
lines = []
with psycopg.connect(dsn) as db:
    for user, role in [(viewer, "viewer"), (branch, "branch_user")]:
        db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)", (org, user, role))
        db.execute("insert into public.user_settings(user_id,active_organization_id) values(%s,%s)", (user, org))
    db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'EXCESS-DC','Excess DC','branch','SA','Asia/Riyadh')", (location, org))
    for n in range(1, 4):
        item, run, policy = uuid4(), uuid4(), uuid4()
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,'Part','Test','SET',999,'SAR')", (item, org, f"EXCESS-{n}"))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',30.001,2,1.125,%s,%s)", (org, item, location, 'SAR' if n == 2 else 'KWD', None if n == 3 else 'EA'))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run, org, location, uuid4()))
        evidence = {"options": {"lead_time": 3, "review_interval": 4}, "forecast": {"to_date": "2026-10-10", "method": "baseline-v1", "source": {"unit_provenance": {"method": "source-units-v1", "status": "consistent", "unit": "EA", "rows": 1, "unknown_rows": 0, "units": ["EA"]}}}}
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,%s,'EA','available',%s,%s)", (policy, org, run, location, uuid4(), item, f"EXCESS-{n}", Jsonb({"protection": {"target": "10.001"}}), Jsonb(evidence)))
        lines.append(dict(item=str(item), policy=str(policy)))
    override = uuid4()
    db.execute("insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id) values(%s,%s,%s,%s,1,%s,%s,1,12.001,'Seasonal maximum','approved',%s,now(),'Reviewed',%s)", (override, org, lines[0]['policy'], location, uuid4(), viewer, owner, uuid4()))
print(json.dumps(dict(location=str(location), lines=lines, override=str(override))))
