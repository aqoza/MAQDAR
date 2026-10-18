"""Loopback-only saved event delivery and current supplier price evidence."""
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
    runpy.run_path(str(Path(__file__).with_name('event-deliveries.py')))
source = json.loads(captured.getvalue())
with psycopg.connect(dsn) as db:
    db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=user, role='authenticated', org_id=org))))
    db.execute('set local role authenticated')
    args = org, source['supplier_scenario'], '2026-10-10', True
    report = db.execute('select public.event_delivery_preview(%s,%s,%s,%s)', args).fetchone()[0]
    assert report['status'] == 'available'
    delivery = db.execute('select public.event_delivery_save(%s,%s,%s,%s,%s,%s)', (*args, str(uuid4()), report['fingerprint'])).fetchone()[0]
    db.execute('reset role')
    db.execute('update public.supplier_items set unit_price=1.234 where organization_id=%s', (org,))
print(json.dumps(dict(source, delivery=str(delivery))))
