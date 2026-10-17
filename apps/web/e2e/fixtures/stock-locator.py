"""Synthetic loopback-only observations and access changes for the stock locator browser test."""

import json
import sys
from urllib.parse import urlparse
from uuid import uuid4

import psycopg

dsn, org, viewer, branch, action = sys.argv[1:6]
if urlparse(dsn).hostname not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit("Local fixture only")

with psycopg.connect(dsn) as db:
    if action == "scope":
        db.execute("delete from public.membership_locations where organization_id=%s and user_id=%s", (org, branch))
        for code in json.loads(sys.argv[6]):
            db.execute("insert into public.membership_locations(organization_id,user_id,location_id) select %s,%s,id from public.locations where organization_id=%s and code=%s", (org, branch, org, code))
    elif action == "seed":
        for actor, role in [(viewer, "viewer"), (branch, "branch_user")]:
            db.execute("insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)", (org, actor, role))
        item = uuid4()
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'PART/1','Air filter','Test','SET',1,'SAR')", (item, org))
        codes = ["RECEIVER", "NEAR", "FAR", "NO-GEO", "STALE", "UNIT-KG", "UNIT-UNKNOWN", "ZERO", "NEGATIVE", "MISSING", "FUTURE", "INACTIVE"]
        locations = {code: uuid4() for code in codes + [f"PAGE-{i:02}" for i in range(30)]}
        for code, location in locations.items():
            latitude = None if code == "NO-GEO" else 26 if code == "FAR" else 25.1 if code == "NEAR" else 25
            name = "Nearest distribution centre " + "with detailed source context " * 5 if code == "NEAR" else code
            db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone,latitude,longitude,is_active) values(%s,%s,%s,%s,'branch','SA','Asia/Riyadh',%s,%s,%s)", (location, org, code, name, latitude, None if code == "NO-GEO" else 55, code != "INACTIVE"))
            if code == "MISSING" or code.startswith("PAGE-"):
                continue
            day = "2026-10-09" if code == "STALE" else "2026-10-18" if code == "FUTURE" else "2026-10-10" if code == "FAR" else "2026-10-17"
            quantity = "900719925474099.125" if code == "NEAR" else "0" if code in {"ZERO", "NEGATIVE"} else "12.250"
            allocated = "0.124" if code == "NEAR" else "2.125" if code == "NEGATIVE" else "0"
            unit = None if code == "UNIT-UNKNOWN" else "KG" if code == "UNIT-KG" else "EA"
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values(%s,%s,%s,%s,%s,%s,1,'SAR',%s)", (org, item, location, day, quantity, allocated, unit))
        db.execute("insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis) values(%s,%s,%s,0,3,'none')", (org, locations["NEAR"], locations["RECEIVER"]))
    else:
        raise SystemExit("Unknown fixture action")
