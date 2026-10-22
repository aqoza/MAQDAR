"""Local-only regional freight fixture, shared by database and browser tests."""
from uuid import uuid4
from regional_dates_fixture import seed_regional_dates


def seed_regional_freight(db, org, user):
    parent, dates = seed_regional_dates(db, org, user)
    db.execute("set local role authenticated")
    scenario = db.execute("select public.regional_date_save(%s,%s,'2026-10-10',true,%s,%s)",
                          (org, parent, uuid4(), dates['fingerprint'])).fetchone()[0]
    db.execute("reset role")
    for line in dates['lines']:
        a = line['location_code'] == 'SOURCE-A'
        db.execute("update public.network_links set freight_basis=%s,freight_cost=%s,currency=%s,freight_unit='EA',freight_valid_from=%s where id=%s",
                   ('per_unit' if a else 'per_shipment', '1.235' if a else '2.345', 'SAR' if a else 'KWD', line['dispatch']['date'], line['lane']['id']))
    db.execute("set local role authenticated")
    report = db.execute("select public.regional_freight_preview(%s,%s,true)", (org, scenario)).fetchone()[0]
    db.execute("reset role")
    return scenario, report
