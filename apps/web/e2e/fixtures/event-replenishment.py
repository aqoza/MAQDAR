"""Loopback-only full saved event-policy and stock/inbound evidence."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
from urllib.parse import urlparse
from uuid import uuid4

import psycopg

dsn, org, user = sys.argv[1:4]
if urlparse(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Local fixture only')
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    runpy.run_path(str(Path(__file__).with_name('event-policies.py')))
source = json.loads(captured.getvalue())
with psycopg.connect(dsn) as db:
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'EVENT-PART','Campaign service part','Test','EA',1,'SAR')", (source['item'], org))
    db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',5,2,1,'SAR','EA')", (org, source['item'], source['location']))
    supplier = str(uuid4())
    db.execute("insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values(%s,%s,'EVENT-SUP','Supplier','SA','SAR',2,2)", (supplier, org))
    for code, day, quantity in [('EARLY', '2026-10-09', '1.001'), ('LATE', '2026-10-18', '1.000')]:
        db.execute("insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values(%s,%s,'1',%s,%s,%s,%s,%s,1,'SAR','open','EA')", (org, code, source['item'], source['location'], supplier, day, quantity))
    db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=user, role='authenticated', org_id=org))))
    db.execute('set local role authenticated')
    args = org, source['event'], source['policy'], 'Fixed event comparison'
    report = db.execute('select public.event_policy_preview(%s,%s,%s,%s)', args).fetchone()[0]
    scenario = db.execute('select public.event_policy_save(%s,%s,%s,%s,%s,%s)', (*args, str(uuid4()), report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(source, scenario=str(scenario))))
