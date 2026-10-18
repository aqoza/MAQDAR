"""Loopback-only header QA: reuse the established purchase handoff RPC fixture."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
from urllib.parse import urlsplit
import psycopg

dsn, organization, editor, approver = sys.argv[1:]
if urlsplit(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise ValueError('Local fixture only')
with psycopg.connect(dsn) as db:
    db.execute('insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)',
               (organization, approver, 'approver'))
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    fixture = runpy.run_path(str(Path(__file__).with_name('handoff-batches.py')))
result = json.loads(captured.getvalue())
print(json.dumps(dict(result, draft=str(fixture['draft']), supplier=str(fixture['scenario']),
                      delivery=str(fixture['delivery']), estimate=str(fixture['estimate']))))
