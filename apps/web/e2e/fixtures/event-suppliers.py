"""Loopback-only event draft and supplied MOQ/pack evidence."""
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
    runpy.run_path(str(Path(__file__).with_name('event-replenishment.py')))
source = json.loads(captured.getvalue())
with psycopg.connect(dsn) as db:
    supplier = db.execute("select id from public.suppliers where organization_id=%s and code='EVENT-SUP'", (org,)).fetchone()[0]
    db.execute("insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure) values(%s,%s,%s,2,2,1.5,1,'SAR','EA')", (org, supplier, source['item']))
    db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=user, role='authenticated', org_id=org))))
    db.execute('set local role authenticated')
    args = org, source['scenario'], '0.002', True, True
    report = db.execute('select public.event_replenishment_preview(%s,%s,%s,%s,%s)', args).fetchone()[0]
    draft = db.execute('select public.event_replenishment_save(%s,%s,%s,%s,%s,%s,%s)', (*args, str(uuid4()), report['fingerprint'])).fetchone()[0]
print(json.dumps(dict(source, draft=str(draft))))
