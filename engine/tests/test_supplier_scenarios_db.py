"""Independent transactions exercise supplier scenario retry and freshness guarantees."""

import time
from uuid import uuid4

import psycopg
import pytest

from test_replenishment_db import draft, session, preview as draft_preview
from test_tenancy_concurrency import _Call, _race

pytestmark = pytest.mark.db
PREVIEW = "select public.supplier_scenario_preview(%s,%s,'SUP',true)"
SAVE = "select public.supplier_scenario_save(%s,%s,'SUP',true,%s,%s)"


@pytest.fixture
def scenario(draft):
    original = draft_preview(draft)
    with session(draft) as db:
        source = db.execute(
            "select public.replenishment_save(%s,%s,%s,'calculated',null,'4',true,%s)",
            (draft[1], draft[3], uuid4(), original['fingerprint']),
        ).fetchone()[0]
    with psycopg.connect(draft[0]) as db:
        supplier = db.execute(
            """insert into public.suppliers(
                organization_id,code,name_en,country_code,currency,
                lead_time_days_p50,lead_time_days_p90)
               values(%s,'SUP','Supplier','SA','SAR',3,3) returning id""",
            (draft[1],),
        ).fetchone()[0]
        item = db.execute(
            "select item_id from public.inventory_policies where id=%s", (draft[3],)
        ).fetchone()[0]
        db.execute(
            """insert into public.supplier_items(
                organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,
                pack_size,unit_price,currency,unit_of_measure)
               values(%s,%s,%s,3,10,6,1,'SAR','EA')""",
            (draft[1], supplier, item),
        )
    return draft, source


def preview(scenario):
    with session(scenario[0]) as db:
        return db.execute(PREVIEW, (scenario[0][1], scenario[1])).fetchone()[0]


def test_supplier_scenario_parallel_retries(scenario):
    report = preview(scenario)
    source, draft_id = scenario
    args = (source[1], draft_id, uuid4(), report['fingerprint'])
    with session(source) as first, session(source) as second:
        assert _race(first, second, SAVE, args, args).sqlstate is None
    with psycopg.connect(source[0]) as db:
        assert db.execute(
            "select report from public.supplier_scenarios where organization_id=%s",
            (source[1],),
        ).fetchall() == [(report,)]
        assert db.execute(
            """select count(*) from public.audit_log
               where organization_id=%s and table_name='supplier_scenarios'""",
            (source[1],),
        ).fetchone()[0] == 1


@pytest.mark.parametrize('change,expected', [('terms', 'MQ409'), ('role', 'MQ403')])
def test_supplier_scenario_rechecks_after_lock_wait(scenario, change, expected):
    source, draft_id = scenario
    report = preview(scenario)
    with psycopg.connect(source[0]) as admin, session(source) as waiting:
        admin.execute(
            "select pg_advisory_xact_lock(hashtextextended('maqdar.supplier-scenario:'||%s,0))",
            (str(source[1]),),
        )
        call = _Call(waiting, SAVE, (source[1], draft_id, uuid4(), report['fingerprint']))
        call.start()
        time.sleep(1)
        assert not call.finished
        if change == 'terms':
            admin.execute(
                "update public.supplier_items set pack_size=7 where organization_id=%s",
                (source[1],),
            )
        else:
            admin.execute(
                """update public.memberships set role='viewer'
                   where organization_id=%s and user_id=%s""",
                (source[1], source[2]),
            )
        admin.commit()
        call.join(timeout=15)
        assert call.finished and call.sqlstate == expected
    with psycopg.connect(source[0]) as db:
        assert db.execute(
            "select count(*) from public.supplier_scenarios where organization_id=%s",
            (source[1],),
        ).fetchone()[0] == 0
