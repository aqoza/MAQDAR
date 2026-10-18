"""Loopback-only distinct saved worker outputs, followed by real event and approval RPCs."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

dsn, org, user, approver = sys.argv[1:5]
line_count = int(sys.argv[5]) if len(sys.argv) > 5 else 30
if not 1 <= line_count <= 50:
    raise SystemExit('Fixture line count must be 1 to 50')
if urlparse(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Local fixture only')
sys.argv = [sys.argv[0], dsn, org, user]
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    runpy.run_path(str(Path(__file__).with_name('event-purchase-review.py')))
source = json.loads(captured.getvalue())

with psycopg.connect(dsn) as db:
    def row(table, identifier):
        return db.execute(sql.SQL('select to_jsonb(t) from public.{} t where id=%s').format(sql.Identifier(table)), (identifier,)).fetchone()[0]

    def insert(table, value):
        name = sql.Identifier('public', table)
        db.execute(sql.SQL('insert into {} select * from jsonb_populate_record(null::{},%s)').format(name, name), (Jsonb(value),))

    def login(actor):
        db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=actor, role='authenticated', org_id=org))))

    supplier_id = db.execute("select id from public.suppliers where organization_id=%s and code='EVENT-SUP'", (org,)).fetchone()[0]
    lines = []
    for n in range(1, line_count + 1):
        unit = 'KG' if n == 2 else 'EA'
        db.execute('reset role')
        item, forecast, policy, forecast_run, policy_run = [str(uuid4()) for _ in range(5)]
        code = f'EVENT-BATCH-{n:03d}'
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,'Synthetic event batch part','Test',%s,1,'SAR')", (item,org,code,unit))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',5,2,1,'SAR',%s)", (org,item,source['location'],unit))
        db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from) values(%s,%s,%s,2,2,1.5,1.234,'SAR',%s,'2026-10-10')", (org,supplier_id,item,unit))
        fr = row('planning_runs', source['run'])
        fr.update(id=forecast_run, request_id=str(uuid4()))
        insert('planning_runs', fr)
        f = row('forecast_results', source['forecast'])
        f.update(id=forecast, run_id=forecast_run, item_id=item, item_code=code)
        f['evidence'] = json.loads(json.dumps(f['evidence']).replace('"EA"', json.dumps(unit)))
        insert('forecast_results', f)
        pr = row('planning_runs', source['policy_run'])
        pr.update(id=policy_run, request_id=str(uuid4()))
        pr['options']['forecast_id'] = forecast
        insert('planning_runs', pr)
        p = row('inventory_policies', source['policy'])
        p.update(id=policy, run_id=policy_run, forecast_id=forecast, item_id=item, item_code=code, unit=unit)
        p['evidence'] = json.loads(json.dumps(p['evidence']).replace('"EA"', json.dumps(unit)))
        p['evidence']['options']['forecast_id'] = forecast
        p['evidence']['forecast'].update(id=forecast, run_id=forecast_run, item_id=item, unit=unit, source=f['evidence']['source'], output=f['evidence']['output'])
        insert('inventory_policies', p)
        login(user)
        db.execute('set local role authenticated')
        additions = Jsonb([dict(date='2026-10-12', quantity='0.009'), dict(date='2026-10-13', quantity='2.250'), dict(date='2026-10-17', quantity='4')])
        args = org,forecast,'campaign',f'Campaign {n}','Additional demand',unit,additions,True
        report = db.execute('select public.planned_event_preview(%s,%s,%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
        event = db.execute('select public.planned_event_save(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
        args = org,event,policy,'Fixed comparison'
        report = db.execute('select public.event_policy_preview(%s,%s,%s,%s)',args).fetchone()[0]
        scenario = db.execute('select public.event_policy_save(%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
        args = org,scenario,'0.002',True,True
        report = db.execute('select public.event_replenishment_preview(%s,%s,%s,%s,%s)',args).fetchone()[0]
        draft = db.execute('select public.event_replenishment_save(%s,%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
        args = org,draft,'EVENT-SUP',True
        report = db.execute('select public.event_supplier_preview(%s,%s,%s,%s)',args).fetchone()[0]
        supplied = db.execute('select public.event_supplier_save(%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
        args = org,supplied,'2026-10-10',True
        report = db.execute('select public.event_delivery_preview(%s,%s,%s,%s)',args).fetchone()[0]
        assert report['policy_recalculation_required'] is False and report['event_before_receipt']==[]
        delivery = db.execute('select public.event_delivery_save(%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
        report = db.execute('select public.event_purchase_cost_preview(%s,%s,true)',(org,delivery)).fetchone()[0]
        estimate = db.execute('select public.event_purchase_cost_save(%s,%s,true,%s,%s)',(org,delivery,str(uuid4()),report['fingerprint'])).fetchone()[0]
        proposal = db.execute('select public.event_purchase_proposal_submit(%s,%s,%s,%s)',(org,estimate,str(uuid4()),'=1+1')).fetchone()[0]
        login(approver)
        db.execute('select public.event_purchase_proposal_decide(%s,%s,%s,%s,%s)',(org,proposal,str(uuid4()),'approved','Independent review'))
        login(user)
        handoff = db.execute('select public.event_purchase_handoff_create(%s,%s)',(org,proposal)).fetchone()[0]
        lines.append(dict(handoff=str(handoff),item=item,estimate=str(estimate),proposal=str(proposal)))
print(json.dumps(dict(lines=lines, location=source['location'])))
