import json
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning,worker
from maqdar_engine.worker import process_one
from maqdar_engine.preparation import prepare

pytestmark=pytest.mark.db


def enqueue_preparation(fixture):
    dsn,org,user=fixture
    successor=uuid4()
    with psycopg.connect(dsn) as db:
        predecessor=db.execute('select id from public.items where organization_id=%s',(org,)).fetchone()[0]
        db.execute("insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency) values(%s,%s,'NEW','Successor','Test','EA',1,'SAR')",(successor,org))
        db.execute("insert into public.item_supersessions(organization_id,predecessor_item_id,successor_item_id,effective_on,quantity_factor) values(%s,%s,%s,'2026-10-01',2)",(org,predecessor,successor))
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(user),'org_id':str(org),'role':'authenticated'}),))
        run=db.execute("select public.preparation_enqueue(%s,'TEST','2026-07-01','2026-10-01',%s,true,array['NEW'])",(org,uuid4())).fetchone()[0]
    return run


def test_worker_includes_unselected_predecessor_once_and_saves_calendar(planning):
    run=enqueue_preparation(planning)
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        status,result=db.execute('select status,result from public.planning_runs where id=%s',(run,)).fetchone()
        assert status=='succeeded' and result['source_count']==2 and result['group_count']==1
        summary,evidence=db.execute('select summary,evidence from public.demand_preparations where run_id=%s',(run,)).fetchone()
        assert summary['target_code']=='NEW' and summary['sold']=='2.246000'
        assert len(evidence['source']['items'])==2
        assert evidence['output']['daily'][-1]['holiday'] is None
        assert db.execute('select count(*) from planning.preparation_inputs where run_id=%s',(run,)).fetchone()[0]==0


def test_snapshot_survives_graph_calendar_and_demand_changes_and_tokens_fence_publication(planning):
    run=enqueue_preparation(planning)
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        snapshot=db.execute('select app.planning_task(%s,%s)',lease).fetchone()[0]
        assert db.execute('select app.planning_fail(%s,%s)',lease).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute('update public.item_supersessions set quantity_factor=99 where organization_id=%s',(planning[1],))
        db.execute('update public.demand_history set quantity=99 where organization_id=%s',(planning[1],))
        db.execute("insert into public.holiday_overrides(organization_id,country_code,starts_on,ends_on,kind,name_en) values(%s,'SA','2026-10-01','2026-10-01','closure','Changed')",(planning[1],))
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s",(str(run),))
    with worker(planning[0]) as db:
        replacement=db.execute('select * from app.planning_claim()').fetchone()
        assert db.execute('select app.planning_task(%s,%s)',replacement).fetchone()[0]==snapshot
        rows=prepare(snapshot)
        bad=[dict(rows[0],source_ids=[str(uuid4())])]
        with pytest.raises(psycopg.Error):
            db.execute('select app.preparation_finish(%s,%s,%s)',(*replacement,Jsonb(bad)))
        assert db.execute('select app.preparation_finish(%s,%s,%s)',(*lease,Jsonb(rows))).fetchone()[0] is False
        assert db.execute('select app.preparation_finish(%s,%s,%s)',(*replacement,Jsonb(rows))).fetchone()[0] is True


def test_cancel_removes_snapshot_and_rejects_late_worker(planning):
    run=enqueue_preparation(planning)
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        snapshot=db.execute('select app.planning_task(%s,%s)',lease).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(planning[2]),'org_id':str(planning[1]),'role':'authenticated'}),))
        db.execute('select public.planning_cancel(%s,%s)',(planning[1],run))
        assert db.execute('select count(*) from planning.preparation_inputs where run_id=%s',(run,)).fetchone()[0]==0
    with worker(planning[0]) as db:
        assert db.execute('select app.preparation_finish(%s,%s,%s)',(*lease,Jsonb(prepare(snapshot)))).fetchone()[0] is False


def test_connected_source_limit_fails_without_truncating_or_saving_partial_input(planning):
    run=enqueue_preparation(planning)
    with psycopg.connect(planning[0]) as db:
        # The selected NEW code now connects to 101 sources in total.
        db.execute("""
            with added as (
              insert into public.items(organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
              select %s,'EXTRA-'||n,'Extra','Test','EA',1,'SAR' from generate_series(1,99) n returning id
            )
            insert into public.item_supersessions(organization_id,predecessor_item_id,successor_item_id,effective_on,quantity_factor)
            select %s,added.id,i.id,'2026-10-01',1 from added cross join public.items i
            where i.organization_id=%s and i.code='NEW'
        """,(planning[1],planning[1],planning[1]))
    with worker(planning[0]) as db:
        lease=db.execute('select * from app.planning_claim()').fetchone()
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.planning_task(%s,%s)',lease)
        assert error.value.sqlstate=='MQ422'
    with psycopg.connect(planning[0]) as db:
        assert db.execute('select count(*) from planning.preparation_inputs where run_id=%s',(run,)).fetchone()[0]==0
        assert db.execute('select count(*) from public.demand_preparations where run_id=%s',(run,)).fetchone()[0]==0
