"""Loopback-only saved event supplier comparison with explicit calendar closures."""
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
    runpy.run_path(str(Path(__file__).with_name('event-suppliers.py')))
source = json.loads(captured.getvalue())
with psycopg.connect(dsn) as db:
    db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=user, role='authenticated', org_id=org))))
    db.execute('set local role authenticated')
    args = org, source['draft'], 'EVENT-SUP', True
    report = db.execute('select public.event_supplier_preview(%s,%s,%s,%s)', args).fetchone()[0]
    scenario = db.execute('select public.event_supplier_save(%s,%s,%s,%s,%s,%s)', (*args, str(uuid4()), report['fingerprint'])).fetchone()[0]
    db.execute('reset role')
    supplier_cal, receiver_cal = str(uuid4()), str(uuid4())
    for identifier, code, weekend in [(supplier_cal, 'SUP-CAL', [5,6]), (receiver_cal, 'REC-CAL', [])]:
        db.execute("insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,%s,'Synthetic calendar','SA',%s,false)", (identifier, org, code, weekend))
    db.execute("update public.suppliers set work_calendar_id=%s where organization_id=%s and code='EVENT-SUP'", (supplier_cal, org))
    db.execute('update public.locations set work_calendar_id=%s where id=%s', (receiver_cal, source['location']))
    db.execute("insert into public.holiday_overrides(organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values(%s,%s,'2026-10-13','2026-10-13','closure','Receiving closure')", (org, receiver_cal))
print(json.dumps(dict(source, supplier_scenario=str(scenario))))
