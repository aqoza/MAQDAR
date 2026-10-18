"""Loopback-only header QA: reuse event evidence and create its real reviewed handoff."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
from urllib.parse import urlsplit
from uuid import uuid4
import psycopg

dsn, organization, editor, approver = sys.argv[1:]
if urlsplit(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise ValueError('Local fixture only')
with psycopg.connect(dsn) as db:
    db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',
               (organization, approver, 'approver'))
sys.argv = [sys.argv[0], dsn, organization, editor]
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    fixture = runpy.run_path(str(Path(__file__).with_name('event-purchase-review.py')))
result = json.loads(captured.getvalue())
with psycopg.connect(dsn) as db:
    # The reused fixture publishes seven daily values; quality also reads this saved option.
    db.execute("update public.planning_runs set options=options||'{\"horizon\":7}'::jsonb where organization_id=%s and id=%s",
               (organization, result['run']))
    db.execute("select set_config('request.jwt.claims',%s,true)",
               (json.dumps(dict(sub=editor, org_id=organization, role='authenticated')),))
    db.execute('set local role authenticated')
    proposal = db.execute('select public.event_purchase_proposal_submit(%s,%s,%s,%s)',
                          (organization, result['estimates'][0], uuid4(), 'Header QA review')).fetchone()[0]
    db.execute("select set_config('request.jwt.claims',%s,true)",
               (json.dumps(dict(sub=approver, org_id=organization, role='authenticated')),))
    db.execute('select public.event_purchase_proposal_decide(%s,%s,%s,%s,%s)',
               (organization, proposal, uuid4(), 'approved', 'Independent header QA review'))
    db.execute("select set_config('request.jwt.claims',%s,true)",
               (json.dumps(dict(sub=editor, org_id=organization, role='authenticated')),))
    handoff = db.execute('select public.event_purchase_handoff_create(%s,%s)',
                         (organization, proposal)).fetchone()[0]
print(json.dumps(dict(result, event=str(fixture['event']), eventPolicy=str(fixture['policy']),
                      eventSupplier=str(fixture['supplier']), eventDelivery=str(fixture['delivery']),
                      eventCost=result['estimates'][0], proposal=str(proposal), handoff=str(handoff))))
