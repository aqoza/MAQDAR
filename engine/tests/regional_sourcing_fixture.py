"""Shared local-only database/browser scenario; callers own organization/user cleanup."""
import json
from uuid import uuid4
from psycopg.types.json import Jsonb


def seed_regional_sourcing(db, org, user, *, policy_lead=3, source_a_quantity="32", source_b_quantity="42"):
    item = uuid4()
    db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'REG-P','Regional part','Test','EA',1,'SAR')", (item, org))
    locations, policies = [], []
    evidence = {"options": {"lead_time": policy_lead, "review_interval": 4}, "forecast": {"to_date": "2026-10-10", "method": "baseline-v1", "source": {"unit_provenance": {"method": "source-units-v1", "status": "consistent", "unit": "EA", "rows": 1, "unknown_rows": 0, "units": ["EA"]}}}}
    for code, quantity in [("DEST", "12"), ("SOURCE-A", source_a_quantity), ("SOURCE-B", source_b_quantity)]:
        location, run, policy = [uuid4() for _ in range(3)]
        locations.append(location)
        policies.append(policy)
        db.execute("insert into public.locations(id,organization_id,code,name_en,name_ar,location_type,country_code,timezone) values(%s,%s,%s,%s,'موقع إقليمي','branch','SA','Asia/Riyadh')", (location, org, code, code))
        db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,'2026-10-10',%s,2,1,'SAR','EA')", (org, item, location, quantity))
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-10','policy','succeeded','{}','{}',now())", (run, org, location, uuid4()))
        db.execute("insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'REG-P','EA','available',%s,%s)", (policy, org, run, location, uuid4(), item, Jsonb({"protection": {"target": "20.000"}}), Jsonb(evidence)))
        if code != "DEST":
            db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,2,4,'none')", (org, location, locations[0]))
    db.execute("set local role authenticated")
    db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(user), org_id=str(org), role="authenticated")),))
    report = db.execute("select public.replenishment_preview(%s,%s,'calculated',null,'4',true)", (org, policies[0])).fetchone()[0]
    draft = db.execute("select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)", (org, policies[0], uuid4(), report['fingerprint'])).fetchone()[0]
    definition = dict(name_en="Northern sourcing region", name_ar="منطقة التوريد الشمالية", location_codes=["DEST", "SOURCE-A", "SOURCE-B"], confirmed=True)
    region_report = db.execute("select public.stock_region_preview(%s,%s)", (org, Jsonb(definition))).fetchone()[0]
    region = db.execute("select public.stock_region_save(%s,%s,%s,%s)", (org, Jsonb(definition), uuid4(), region_report['fingerprint'])).fetchone()[0]
    inputs = dict(region_id=str(region), draft_id=str(draft), sources=[dict(location_id=str(locations[n]), policy_id=str(policies[n]), maximum="calculated", backorders="0") for n in [1, 2]], commitments_confirmed=True, lanes_confirmed=True)
    preview = db.execute("select public.regional_sourcing_preview(%s,%s)", (org, Jsonb(inputs))).fetchone()[0]
    db.execute("reset role")
    return inputs, preview
