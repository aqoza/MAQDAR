import csv
import shutil
from pathlib import Path

import pytest

from zeespare_engine import importformat
from zeespare_engine.synth.loader import LoaderRefused, check_dsn, load_bundle, table_counts
from zeespare_engine.synth.presets import PRESETS
from zeespare_engine.synth.validate import validate_bundle
from zeespare_engine.synth.writer import read_manifest

from optional_bundle import CALENDAR, add_optional_entities, copy_bundle


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
        "postgresql://postgres.abc:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
        "postgresql://postgres:postgres@10.0.0.5:54322/postgres",
        "postgresql://postgres:postgres@devbox.local:54322/postgres",
        "postgresql:///postgres",
        "service=hosted",
        "host=127.0.0.1,db.example.com dbname=postgres",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres?hostaddr=10.1.1.1",
    ],
)
def test_check_dsn_refuses_non_local_targets(dsn: str):
    with pytest.raises(LoaderRefused):
        check_dsn(dsn)


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "postgresql://postgres:postgres@localhost:54322/postgres",
        "postgresql://postgres:postgres@[::1]:54322/postgres",
        "host=localhost port=54322 user=postgres password=postgres dbname=postgres",
    ],
)
def test_check_dsn_accepts_loopback(dsn: str):
    assert check_dsn(dsn)["host"] in {"127.0.0.1", "localhost", "::1"}


@pytest.mark.db
def test_load_tiny_bundle_into_local_stack(tiny_bundle: Path, dsn: str):
    manifest = read_manifest(tiny_bundle)
    # The generator writes no optional entities: their tables stay empty.
    expected = {entity.name: 0 for entity in importformat.ENTITIES}
    for entry in manifest["files"]:
        name = entry["path"].split("/")[0].removesuffix(".csv")
        expected[name] = expected.get(name, 0) + entry["rows"]

    report = load_bundle(tiny_bundle, dsn=dsn, replace=True, progress=lambda m: None)
    assert report.organization_id == PRESETS["tiny"].organization_id
    assert report.rows == expected
    assert table_counts(dsn, report.organization_id) == expected

    # Reloading with --replace is idempotent.
    again = load_bundle(tiny_bundle, dsn=dsn, replace=True, progress=lambda m: None)
    assert again.rows == expected
    assert table_counts(dsn, report.organization_id) == expected

    # Without --replace the loader refuses to duplicate the organization.
    with pytest.raises(LoaderRefused):
        load_bundle(tiny_bundle, dsn=dsn, replace=False, progress=lambda m: None)

    # Unknown member email fails cleanly and leaves the data in place.
    with pytest.raises(LoaderRefused):
        load_bundle(tiny_bundle, dsn=dsn, replace=True, member_email="nobody@test.invalid", progress=lambda m: None)
    assert table_counts(dsn, report.organization_id) == expected


@pytest.mark.db
def test_loaded_rows_are_consistent(tiny_bundle: Path, dsn: str):
    import psycopg

    org = PRESETS["tiny"].organization_id
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            select count(*) filter (where i.id is null or l.id is null), count(*)
            from public.demand_history d
            left join public.items i on (i.organization_id, i.id) = (d.organization_id, d.item_id)
            left join public.locations l on (l.organization_id, l.id) = (d.organization_id, d.location_id)
            where d.organization_id = %s
            """,
            (org,),
        )
        orphans, total = cur.fetchone()
        assert orphans == 0 and total > 0
        cur.execute("select count(*) from public.locations where organization_id = %s and parent_location_id is null", (org,))
        assert cur.fetchone()[0] == 1
        cur.execute("select count(*) from public.supplier_items where organization_id = %s and is_preferred", (org,))
        preferred = cur.fetchone()[0]
        cur.execute("select count(*) from public.items where organization_id = %s", (org,))
        assert preferred == cur.fetchone()[0]
        cur.execute("select unit_cost::text from public.items where organization_id = %s and code = 'P-000001'", (org,))
        assert cur.fetchone()[0].count(".") == 1
        cur.execute("select count(*) from public.items where organization_id = %s and name_ar is not null", (org,))
        assert cur.fetchone()[0] > 0
        brand_rows = sum(e["rows"] for e in read_manifest(tiny_bundle)["files"] if e["path"] == "brands.csv")
        cur.execute("select count(*) from public.brands where organization_id = %s", (org,))
        assert cur.fetchone()[0] == brand_rows > 0
        cur.execute("select count(*) from public.items where organization_id = %s and brand_id is null", (org,))
        assert cur.fetchone()[0] == 0
        # The generator leaves out the optional trailing work_calendar_code: the loader writes NULL.
        cur.execute(
            "select (select count(*) from public.locations where organization_id = %(org)s and work_calendar_id is not null)"
            " + (select count(*) from public.suppliers where organization_id = %(org)s and work_calendar_id is not null)",
            {"org": org},
        )
        assert cur.fetchone()[0] == 0
        # The brand id resolves to the brand the bundle names for the item.
        with (tiny_bundle / "items.csv").open(encoding="utf-8", newline="") as handle:
            first_item = next(csv.DictReader(handle))
        cur.execute(
            """
            select b.code from public.items i
            join public.brands b on (b.organization_id, b.id) = (i.organization_id, i.brand_id)
            where i.organization_id = %s and i.code = %s
            """,
            (org, first_item["item_code"]),
        )
        assert cur.fetchone()[0] == first_item["brand_code"]


@pytest.mark.db
def test_unknown_reference_is_refused_before_commit(tiny_bundle: Path, dsn: str, tmp_path: Path):
    """A demand row whose item code is not in items.csv rolls the whole load back."""
    bundle = tmp_path / "bad"
    shutil.copytree(tiny_bundle, bundle)
    location_code = (bundle / "locations.csv").read_text(encoding="utf-8").splitlines()[1].split(",")[0]
    part = sorted((bundle / "demand_history").glob("*.csv"))[-1]
    with part.open("a", encoding="utf-8", newline="") as handle:
        handle.write(f"NOT-A-PART,{location_code},2026-09-15,1,0\n")

    organization_id = PRESETS["tiny"].organization_id
    before = table_counts(dsn, organization_id)
    with pytest.raises(LoaderRefused, match="do not exist in items"):
        load_bundle(bundle, dsn=dsn, replace=True, progress=lambda m: None)
    assert table_counts(dsn, organization_id) == before


@pytest.mark.db
def test_load_bundle_with_optional_entities(tiny_bundle: Path, dsn: str, tmp_path: Path):
    """Optional files and the trailing work_calendar_code load through the same contract."""
    import psycopg

    bundle = copy_bundle(tiny_bundle, tmp_path / "optional")
    optional = add_optional_entities(bundle)
    assert validate_bundle(bundle) == []
    org = PRESETS["tiny"].organization_id
    try:
        report = load_bundle(bundle, dsn=dsn, replace=True, progress=lambda m: None)
        for name, rows in optional.items():
            assert report.rows[name] == rows, name
        counts = table_counts(dsn, org)
        assert {name: counts[name] for name in optional} == optional

        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "select code, weekend_days::text, country_code, observe_public_holidays from public.work_calendars"
                " where organization_id = %s order by code",
                (org,),
            )
            assert cur.fetchall() == [
                (CALENDAR, "{5,6}", "SA", True),
                ("NONSTOP", "{}", None, False),
                ("UAE-STD", "{6,7}", "AE", True),
            ]
            cur.execute(
                "select h.scope_key, h.starts_on::text, h.kind, h.note, c.code from public.holiday_overrides h"
                " left join public.work_calendars c on (c.organization_id, c.id) = (h.organization_id, h.work_calendar_id)"
                " where h.organization_id = %s order by h.starts_on",
                (org,),
            )
            rows = cur.fetchall()
            assert [(r[0].split(":")[0], r[1], r[2], r[4]) for r in rows] == [
                ("country", "2026-03-18", "closure", None),
                ("country", "2026-04-01", "closure", None),
                ("calendar", "2026-09-23", "working_day", CALENDAR),
            ]
            assert rows[2][3] == "Shift, with overtime"
            # The first location and supplier carry the calendar; the rest follow their country.
            for table in ("locations", "suppliers"):
                cur.execute(
                    f"select count(*) filter (where c.code = %s), count(*) filter (where t.work_calendar_id is null), count(*)"
                    f" from public.{table} t left join public.work_calendars c on (c.organization_id, c.id) = (t.organization_id, t.work_calendar_id)"
                    " where t.organization_id = %s",
                    (CALENDAR, org),
                )
                with_calendar, without, total = cur.fetchone()
                assert (with_calendar, without) == (1, total - 1), table
            cur.execute(
                "select f.code, t.code, n.freight_basis, n.freight_cost::text, n.currency from public.network_links n"
                " join public.locations f on (f.organization_id, f.id) = (n.organization_id, n.from_location_id)"
                " join public.locations t on (t.organization_id, t.id) = (n.organization_id, n.to_location_id)"
                " where n.organization_id = %s order by n.freight_basis",
                (org,),
            )
            lanes = cur.fetchall()
            assert [lane[2:] for lane in lanes] == [("none", None, None), ("per_unit", "1.250", "SAR")]
            cur.execute(
                "select a.code, b.code, x.direction, x.priority from public.item_interchanges x"
                " join public.items a on (a.organization_id, a.id) = (x.organization_id, x.item_id)"
                " join public.items b on (b.organization_id, b.id) = (x.organization_id, x.alternate_item_id)"
                " where x.organization_id = %s order by x.priority",
                (org,),
            )
            assert [row[2:] for row in cur.fetchall()] == [("two_way", 1), ("one_way", 2)]
            cur.execute(
                "select from_currency, to_currency, valid_from::text, rate::text from public.fx_rates"
                " where organization_id = %s order by valid_from, from_currency",
                (org,),
            )
            assert cur.fetchall() == [
                ("SAR", "AED", "2026-01-01", "0.9793000000"),
                ("USD", "SAR", "2026-01-01", "3.7500000000"),
                ("USD", "SAR", "2026-07-01", "3.7512345678"),
            ]
    finally:
        # Leave the standard tiny organization behind for the other database tests.
        again = load_bundle(tiny_bundle, dsn=dsn, replace=True, progress=lambda m: None)
    assert all(again.rows[name] == 0 for name in optional)
    assert all(table_counts(dsn, org)[name] == 0 for name in optional)
