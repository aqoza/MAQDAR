"""Local-only regional schedule fixture shared by database and browser tests."""
from uuid import uuid4
from psycopg.types.json import Jsonb
from regional_sourcing_fixture import seed_regional_sourcing


def seed_regional_dates(db, org, user, **options):
    inputs, sourcing = seed_regional_sourcing(db, org, user, **options)
    db.execute("set local role authenticated")
    parent = db.execute("select public.regional_sourcing_save(%s,%s,%s,%s)",
                        (org, Jsonb(inputs), uuid4(), sourcing['fingerprint'])).fetchone()[0]
    db.execute("reset role")
    for code, weekend in [('SOURCE-A', [6, 7]), ('SOURCE-B', [5, 6]), ('DEST', [3, 5])]:
        calendar = db.execute("insert into public.work_calendars(organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values(%s,%s,%s,'SA',%s,false) returning id",
                              (org, code, code, weekend)).fetchone()[0]
        db.execute("update public.locations set work_calendar_id=%s where organization_id=%s and code=%s", (calendar, org, code))
    db.execute("set local role authenticated")
    report = db.execute("select public.regional_date_preview(%s,%s,'2026-10-10',true)", (org, parent)).fetchone()[0]
    db.execute("reset role")
    return parent, report
