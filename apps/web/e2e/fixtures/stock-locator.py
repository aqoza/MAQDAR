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
    elif action == "alternatives":
        db.execute("update public.items set unit_of_measure='EA' where organization_id=%s and code='PART/1'", (org,))
        seed = db.execute("select id from public.items where organization_id=%s and code='PART/1'", (org,)).fetchone()[0]
        items = {code: uuid4() for code in ["ALT-B", "ALT-C", "ONE-WAY", "KG-BRIDGE", "BEHIND-KG"]}
        for code, item in items.items():
            unit = "KG" if code == "KG-BRIDGE" else "EA"
            status = "phase_out" if code == "ALT-B" else "discontinued" if code == "ALT-C" else "active"
            db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency,status) values(%s,%s,%s,%s,'Test',%s,1,'SAR',%s)", (item, org, code, "Alternative filter " + code, unit, status))
        for origin, alternate, direction in [(seed, items["ALT-B"], "two_way"), (items["ALT-C"], items["ALT-B"], "two_way"), (seed, items["ONE-WAY"], "one_way"), (seed, items["KG-BRIDGE"], "two_way"), (items["KG-BRIDGE"], items["BEHIND-KG"], "two_way")]:
            db.execute("insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction) values(%s,%s,%s,%s)", (org, origin, alternate, direction))
        for code, location, day, quantity, unit in [("ALT-B", "NEAR", "2026-10-17", "900719925474099.001", "EA"), ("ALT-B", "FAR", "2026-10-10", "5.125", "EA"), ("ALT-C", "NO-GEO", "2026-10-17", "2", "EA"), ("ALT-C", "NEAR", "2026-10-17", "20", "KG"), ("ALT-C", "STALE", "2026-10-09", "20", "EA"), ("ONE-WAY", "NEAR", "2026-10-17", "900", "EA"), ("BEHIND-KG", "NEAR", "2026-10-17", "900", "EA")]:
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,unit_cost,currency,unit_of_measure) select %s,%s,id,%s,%s,1,'SAR',%s from public.locations where organization_id=%s and code=%s", (org, items[code], day, quantity, unit, org, location))
    elif action == "substitutes":
        db.execute("update public.items set unit_of_measure='EA' where organization_id=%s and code='PART/1'", (org,))
        seed = db.execute("select id from public.items where organization_id=%s and code='PART/1'", (org,)).fetchone()[0]
        items = {code: uuid4() for code in ["SUB-B", "SUB-C", "CHAIN", "INCOMING", "TWO-WAY", "BRIDGED", "KG"]}
        for code, item in items.items():
            unit = "KG" if code == "KG" else "EA"
            status = "phase_out" if code == "SUB-B" else "discontinued" if code == "SUB-C" else "active"
            db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency,status) values(%s,%s,%s,%s,'Test',%s,1,'SAR',%s)", (item, org, code, "Substitute filter " + code, unit, status))
        for origin, alternate, direction, priority, note in [(seed, items["SUB-B"], "one_way", 99, "Check application <b>before issue</b>."), (seed, items["SUB-C"], "one_way", 1, None), (items["SUB-B"], items["CHAIN"], "one_way", 1, None), (items["INCOMING"], seed, "one_way", 1, None), (seed, items["TWO-WAY"], "two_way", 1, None), (items["TWO-WAY"], items["BRIDGED"], "one_way", 1, None), (seed, items["KG"], "one_way", 1, None)]:
            db.execute("insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction,priority,note) values(%s,%s,%s,%s,%s,%s)", (org, origin, alternate, direction, priority, note))
        observations = [("SUB-B", "NEAR", "2026-10-17", "900719925474099.001", "EA"), ("SUB-B", "FAR", "2026-10-10", "5.125", "EA"), ("SUB-C", "NO-GEO", "2026-10-17", "2", "EA"), ("SUB-C", "NEAR", "2026-10-17", "20", "KG"), ("SUB-C", "STALE", "2026-10-09", "20", "EA")]
        observations += [(code, "NEAR", "2026-10-17", "900", "EA") for code in ["CHAIN", "INCOMING", "TWO-WAY", "BRIDGED", "KG"]]
        for code, location, day, quantity, unit in observations:
            db.execute("insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,unit_cost,currency,unit_of_measure) select %s,%s,id,%s,%s,1,'SAR',%s from public.locations where organization_id=%s and code=%s", (org, items[code], day, quantity, unit, org, location))
    elif action in ("oversize", "substitute-oversize"):
        seed = db.execute("select id from public.items where organization_id=%s and code='PART/1'", (org,)).fetchone()[0]
        for index in range(100):
            item = uuid4()
            db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,%s,'Limit item','Test','EA',1,'SAR')", (item, org, f"LIMIT-{index}"))
            db.execute("insert into public.item_interchanges(organization_id,item_id,alternate_item_id,direction) values(%s,%s,%s,%s)", (org, seed, item, "one_way" if action == "substitute-oversize" else "two_way"))
    else:
        raise SystemExit("Unknown fixture action")
