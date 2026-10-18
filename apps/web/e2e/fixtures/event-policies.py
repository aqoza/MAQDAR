"""Loopback-only event and calculated policy for the browser comparison workflow."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

dsn, org, user = sys.argv[1:4]
if urlparse(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Local fixture only')
sys.argv = [sys.argv[0], dsn, org]
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    runpy.run_path(str(Path(__file__).with_name('planned-events.py')))
source = json.loads(captured.getvalue())
policy, run = str(uuid4()), str(uuid4())
with psycopg.connect(dsn) as db:
    evidence = db.execute('select evidence from public.forecast_results where id=%s', (source['forecast'],)).fetchone()[0]
    options = dict(method='policy-v1', forecast_id=source['forecast'], lead_time=2, review_interval=3, service_level='0.95')
    output = dict(status='available', lead_time=dict(days=2, forecast='2.002', quantile='3.002', target='3.002', safety_stock='1.000'), protection=dict(days=5, forecast='5.005', quantile='6.005', target='6.005', safety_stock='1.000'), residual_count=21, positive_days=30, samples=5000, seed='synthetic-seed', calibration=[])
    payload = dict(method='policy-v1', options=options, forecast=dict(id=source['forecast'], run_id=source['run'], item_id=source['item'], unit='EA', method='expanded-v1', to_date='2026-10-10', horizon=7, source=evidence['source'], output=evidence['output']), output=output)
    db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-10','policy','succeeded',%s,'{}',now())", (run, org, source['location'], str(uuid4()), Jsonb(options)))
    db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'EVENT-PART','EA','available',%s,%s)", (policy, org, run, source['location'], source['forecast'], source['item'], Jsonb({k: v for k, v in output.items() if k != 'calibration'}), Jsonb(payload)))
    db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=user, role='authenticated', org_id=org))))
    db.execute('set local role authenticated')
    additions = Jsonb([dict(date='2026-10-11', quantity='0.009'), dict(date='2026-10-13', quantity='2.250'), dict(date='2026-10-17', quantity='4')])
    args = org, source['forecast'], 'campaign', 'Autumn service campaign', 'Fixed incremental demand', 'EA', additions, True
    report = db.execute('select public.planned_event_preview(%s,%s,%s,%s,%s,%s,%s,%s)', args).fetchone()[0]
    event_id = db.execute('select public.planned_event_save(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)', (*args, str(uuid4()), report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(source, policy=policy, policy_run=run, event=str(event_id))))
