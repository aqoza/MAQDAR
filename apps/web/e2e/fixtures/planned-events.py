"""Loopback-only synthetic saved forecasts for the planned-event browser workflow."""
import json
import sys
from datetime import date, timedelta
from urllib.parse import urlparse
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

dsn, org = sys.argv[1:3]
if urlparse(dsn).hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Local fixture only')
location, other_location, run, forecast, item = [str(uuid4()) for _ in range(5)]
days = [dict(date=str(date(2026, 10, 11) + timedelta(days=n)), quantity='1.001') for n in range(7)]
score = dict(model='mean', rmse='0.125', mae='0.1', bias='-0.025', folds=[])
evidence = dict(
    source=dict(start_day='2026-01-01', end_day='2026-10-10', introduced_on=None, discontinued_on=None,
                demand=[], unit_provenance=dict(method='source-units-v1', status='consistent', unit='EA', rows=1, unknown_rows=0, units=['EA'])),
    output=dict(status='selected', model='mean', total='7.007', scores=[score], folds=[], forecast=days,
                uncertainty=dict(status='available', bands=[dict(lower80='0', upper80='2', lower95='0', upper95='3') for _ in days])),
)
with psycopg.connect(dsn) as db:
    for identifier, code in [(location, 'EVENT-DC'), (other_location, 'OTHER-DC')]:
        db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,%s,'Event location','branch','SA','Asia/Riyadh')", (identifier, org, code))
    db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-01-01','2026-10-10','forecast','succeeded','{\"method\":\"expanded-v1\"}','{}',now())", (run, org, location, str(uuid4())))
    db.execute("insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,%s,'EVENT-PART','Campaign service part','selected','mean',%s,%s)", (forecast, org, run, location, item, Jsonb(dict(total='7.007', scores=[score])), Jsonb(evidence)))
print(json.dumps(dict(location=location, other_location=other_location, run=run, forecast=forecast, item=item)))
