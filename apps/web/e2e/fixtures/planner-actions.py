"""Loopback-only Action Centre fixture using the real purchase/transfer approval chains."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

dsn, organization, editor, approver, branch, mode = sys.argv[1:]
if urlsplit(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise ValueError('Local fixture only')
with psycopg.connect(dsn) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'approver')", (organization, approver))
sys.argv = [sys.argv[0], dsn, organization, editor, approver]
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    chain = runpy.run_path(str(Path(__file__).with_name('transfer-batches.py' if mode == 'transfer' else 'handoff-batches.py')))
result = json.loads(captured.getvalue())
call = chain['call']
lines = result['lines']
pending = call(editor, f"select public.{'transfer' if mode == 'transfer' else 'purchase'}_proposal_submit(%s,%s,%s,%s)", (organization, lines[0]['estimate'], uuid4(), 'Planner Action Centre pending review'))
if mode == 'purchase':
    approved = call(editor, 'select public.purchase_proposal_submit(%s,%s,%s,%s)', (organization, lines[1]['estimate'], uuid4(), 'New selected approval'))
    call(approver, 'select public.purchase_proposal_decide(%s,%s,%s,%s,%s)', (organization, approved, uuid4(), 'approved', 'Independent review complete'))
    with psycopg.connect(dsn) as db:
        # No fabricated risk calculation: an actual missing snapshot drives the existing RPC.
        db.execute('delete from public.stock_snapshots where organization_id=%s and item_id=%s', (organization, lines[0]['item']))
        private = uuid4()
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'RESTRICTED','Restricted branch','branch','SA','Asia/Riyadh')", (private, organization))
        foreign, foreign_location = uuid4(), uuid4()
        db.execute("insert into public.organizations(id,slug,name,home_country,base_currency) values(%s,%s,'Other tenant','SA','SAR')", (foreign, f'actions-foreign-{foreign}'))
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'FOREIGN','Foreign branch','branch','SA','Asia/Riyadh')", (foreign_location, foreign))
        for org, location, code in [(organization, result['location'], 'FILTER-001'), (organization, result['location'], 'PUMP-002'), (organization, private, 'RESTRICTED-SECRET'), (foreign, foreign_location, 'FOREIGN-SECRET')]:
            run = uuid4()
            db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-10','forecast','succeeded',%s,'{}',now())", (run,org,location,uuid4(),Jsonb(dict(method='baseline-v1',horizon=30))))
            source = dict(start_day='2026-01-01',end_day='2026-10-10',introduced_on=None,discontinued_on=None,demand=[])
            output = dict(status='selected',model='mean',total='30',scores=[],forecast=[],folds=[],evaluation=dict(status='unavailable'))
            db.execute("insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,%s,'Service part','selected','mean',%s,%s)", (org,run,location,uuid4(),code,Jsonb(dict(total='30',scores=[])),Jsonb(dict(source=source,output=output))))
with psycopg.connect(dsn) as db:
    db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,'branch_user')", (organization,branch))
    db.execute('insert into public.membership_locations(organization_id,user_id,location_id) values(%s,%s,%s)', (organization,branch,result['location']))
    db.execute('insert into public.user_settings(user_id,active_organization_id) values(%s,%s)', (branch,organization))
print(json.dumps(dict(pending=str(pending), location=result['location'], source=result.get('source'), approved=str(approved) if mode=='purchase' else None)))
