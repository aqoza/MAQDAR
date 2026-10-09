import shutil
from pathlib import Path

import pytest

from maqdar_engine.synth.loader import LoaderRefused, check_dsn, load_bundle, table_counts
from maqdar_engine.synth.presets import PRESETS
from maqdar_engine.synth.writer import read_manifest


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
    expected = {}
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
