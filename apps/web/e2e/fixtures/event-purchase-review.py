"""Loopback-only event review chain with clear and flagged delivery evidence."""
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
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    runpy.run_path(str(Path(__file__).with_name('event-deliveries.py')))
source = json.loads(captured.getvalue())
with psycopg.connect(dsn) as db:
    db.execute("update public.work_calendars set weekend_days='{}' where organization_id=%s", (org,))
    db.execute('delete from public.holiday_overrides where organization_id=%s', (org,))
    db.execute("update public.supplier_items set unit_price=1.234,valid_from='2026-10-10' where organization_id=%s", (org,))
    db.execute('select set_config(%s,%s,true)', ('request.jwt.claims', json.dumps(dict(sub=user, role='authenticated', org_id=org))))
    db.execute('set local role authenticated')
    additions=Jsonb([dict(date='2026-10-12',quantity='0.009'),dict(date='2026-10-13',quantity='2.250'),dict(date='2026-10-17',quantity='4')])
    args=(org,source['forecast'],'campaign','Autumn service campaign','Additional demand','EA',additions,True)
    report=db.execute('select public.planned_event_preview(%s,%s,%s,%s,%s,%s,%s,%s)',args).fetchone()[0]
    event=db.execute('select public.planned_event_save(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
    args=(org,event,source['policy'],'Review comparison')
    report=db.execute('select public.event_policy_preview(%s,%s,%s,%s)',args).fetchone()[0]
    policy=db.execute('select public.event_policy_save(%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
    args=(org,policy,'0.002',True,True)
    report=db.execute('select public.event_replenishment_preview(%s,%s,%s,%s,%s)',args).fetchone()[0]
    draft=db.execute('select public.event_replenishment_save(%s,%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
    args=(org,draft,'EVENT-SUP',True)
    report=db.execute('select public.event_supplier_preview(%s,%s,%s,%s)',args).fetchone()[0]
    supplier=db.execute('select public.event_supplier_save(%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
    estimates=[]
    for day in ['2026-10-10','2026-10-12']:
        args=(org,supplier,day,True)
        report=db.execute('select public.event_delivery_preview(%s,%s,%s,%s)',args).fetchone()[0]
        assert report['status']=='available'
        if day=='2026-10-10':
            assert report['policy_recalculation_required'] is False and report['event_before_receipt']==[]
        else:
            assert report['policy_recalculation_required'] is True and report['event_before_receipt']
        delivery=db.execute('select public.event_delivery_save(%s,%s,%s,%s,%s,%s)',(*args,str(uuid4()),report['fingerprint'])).fetchone()[0]
        report=db.execute('select public.event_purchase_cost_preview(%s,%s,true)',(org,delivery)).fetchone()[0]
        estimate=db.execute('select public.event_purchase_cost_save(%s,%s,true,%s,%s)',(org,delivery,str(uuid4()),report['fingerprint'])).fetchone()[0]
        estimates.append(str(estimate))
print(json.dumps(dict(source,estimates=estimates,draft=str(draft))))
