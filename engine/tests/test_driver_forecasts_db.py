"""Real connections cover immutable capture, retries, revocation and fenced publication."""
import json
import time
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from test_external_drivers_db import driver, session  # shared isolated local tenant fixture
from test_driver_forecasting import fixture
from test_tenancy_concurrency import _Call, _race
from maqdar_engine.driver_forecasting import forecast

pytestmark=pytest.mark.db
ENQUEUE='select public.forecast_driver_enqueue(%s,%s,%s,%s,%s)'


@pytest.fixture
def sources(driver):
    task=fixture()
    source=task['items'][0]
    with psycopg.connect(driver[0]) as db:
        item,location=db.execute('select i.id,l.id from public.items i join public.locations l using(organization_id) where i.organization_id=%s',(driver[1],)).fetchone()
        source.update(item_id=str(item), item_code='ITEM',item_name='Item',
                      unit_provenance=dict(method='source-units-v1',status='consistent',unit='EA',rows=140,unknown_rows=0,units=['EA']))
        run=db.execute("insert into public.planning_runs(organization_id,location_id,request_id,from_date,to_date,created_by,kind,options,status,finished_at,result) values(%s,%s,%s,'2026-01-01',%s,%s,'forecast',%s,'succeeded',now(),'{}') returning id",
                       (driver[1],location,uuid4(),task['to_date'],driver[2],Jsonb(dict(method='expanded-v1',horizon=14,history_complete=True)))).fetchone()[0]
        f=db.execute("insert into public.forecast_results(organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence) values(%s,%s,%s,%s,'ITEM','Item','selected','mean',%s,%s) returning id",
                     (driver[1],run,location,item,Jsonb(dict(total='100',scores=[])),Jsonb(dict(source=source,output=dict(forecast=[]))))).fetchone()[0]
    with session(driver) as db:
        data=dict(item_code='ITEM',location_code='L',driver_name='Synthetic signal',unit='C',source='Synthetic source',
                  history_from='2026-01-01',cutoff=task['to_date'],forecast_to='2026-06-03',confirmed=True,rows=task['driver']['report']['input']['rows'])
        report=db.execute('select public.external_driver_preview(%s,%s)',(driver[1],Jsonb(data))).fetchone()[0]
        d=db.execute('select public.external_driver_save(%s,%s,%s,%s)',(driver[1],Jsonb(data),uuid4(),report['fingerprint'])).fetchone()[0]
    return driver,f,d


def args(sources):
    tenant,f,d=sources
    return tenant[1],f,d,uuid4(),True


def captured(sources):
    tenant,_,_=sources
    with session(tenant) as db:
        run=db.execute(ENQUEUE,args(sources)).fetchone()[0]
    with psycopg.connect(tenant[0]) as db:
        task=db.execute('select payload from planning.forecast_inputs where run_id=%s',(run,)).fetchone()[0]
    return run,task


def test_concurrent_identical_enqueue_creates_one_run(sources):
    a=args(sources)
    with session(sources[0]) as one,session(sources[0]) as two:
        assert _race(one,two,ENQUEUE,a,a).sqlstate is None
    with psycopg.connect(sources[0][0]) as db:
        assert db.execute("select count(*) from public.planning_runs where organization_id=%s and options->>'method'='driver-v1'",(a[0],)).fetchone()[0]==1


@pytest.mark.parametrize('retry',[False,True])
def test_editor_revocation_during_wait_applies_to_retry(sources,retry):
    tenant=sources[0]; a=args(sources)
    if retry:
        with session(tenant) as db: db.execute(ENQUEUE,a)
    with psycopg.connect(tenant[0]) as admin,session(tenant) as waiting:
        admin.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||%s,0))",(str(tenant[1]),))
        call=_Call(waiting,ENQUEUE,a); call.start(); time.sleep(1)
        assert not call.finished
        admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s",(tenant[1],tenant[2]))
        admin.commit(); call.join(timeout=15)
        assert call.finished and call.sqlstate=='MQ403'


def test_saved_input_and_retry_survive_source_deletion(sources):
    tenant,f,d=sources; a=args(sources)
    with session(tenant) as db: run=db.execute(ENQUEUE,a).fetchone()[0]
    with psycopg.connect(tenant[0]) as db:
        before=db.execute('select payload from planning.forecast_inputs where run_id=%s',(run,)).fetchone()[0]
        db.execute('delete from public.forecast_results where id=%s',(f,))
        db.execute('delete from public.external_driver_datasets where id=%s',(d,))
        assert db.execute('select payload from planning.forecast_inputs where run_id=%s',(run,)).fetchone()[0]==before
    with session(tenant) as db: assert db.execute(ENQUEUE,a).fetchone()[0]==run


@pytest.mark.parametrize('alteration',[
 "update public.forecast_results set evidence=jsonb_set(evidence,'{source,unit_provenance,status}','\"unknown\"') where id=%s",
 "update public.forecast_results set status='insufficient',model=null where id=%s",
 "update public.forecast_results set evidence=jsonb_set(evidence,'{source,end_day}','\"2026-05-19\"') where id=%s",
])
def test_incompatible_sources_are_rejected_without_queue(sources,alteration):
    tenant,f,_=sources
    with psycopg.connect(tenant[0]) as db: db.execute(alteration,(f,))
    with session(tenant) as db,pytest.raises(psycopg.Error) as error: db.execute(ENQUEUE,args(sources))
    assert error.value.sqlstate=='MQ422'


def test_real_numerical_output_is_validated_and_published_atomically(sources):
    tenant=sources[0]; run,task=captured(sources)
    output=forecast(task)
    with psycopg.connect(tenant[0]) as db:
        assert db.execute('select app.driver_output_valid(%s,%s)',(Jsonb(task),Jsonb(output[0]))).fetchone()[0]
        for change in [dict(total='0'),dict(item_id=str(uuid4())),dict(folds=[]),dict(model='calendar')]:
            assert not db.execute('select app.driver_output_valid(%s,%s)',(Jsonb(task),Jsonb(output[0]|change))).fetchone()[0]
        for key,value in [('driver_checks',[{}]),('driver_model',{'status':'available'}),
                          ('evaluation',{'status':'available'}),('unavailable_models',[{'model':'unknown'}])]:
            assert not db.execute('select app.driver_output_valid(%s,%s)',(Jsonb(task),Jsonb(output[0]|{key:value}))).fetchone()[0]
        for path,value in [(('forecast',0,'quantity'),123),(('scores',0,'folds',0,'rmse'),'-1'),
                           (('evaluation','coverage95'),'1.1'),(('evaluation','bands',0,'lower95'),'NaN')]:
            malformed=deepcopy(output[0]); node=malformed
            for part in path[:-1]: node=node[part]
            node[path[-1]]=value
            assert not db.execute('select app.driver_output_valid(%s,%s)',(Jsonb(task),Jsonb(malformed))).fetchone()[0]
        late=deepcopy(task)
        late['driver']['report']['input']['rows'][100]['available_on']='2026-06-01'
        assert not db.execute('select app.driver_output_valid(%s,%s)',(Jsonb(late),Jsonb(output[0]))).fetchone()[0]
        token=uuid4()
        db.execute("update public.planning_runs set status='running',attempts=1 where id=%s",(run,))
        db.execute("update planning.leases set token=%s,expires_at=now()+interval '15 minutes' where run_id=%s",(token,run))
        db.execute('set local role maqdar_worker')
        assert db.execute('select app.planning_task(%s,%s)',(run,token)).fetchone()[0]==task
        assert not db.execute('select app.forecast_finish(%s,%s,%s)',(run,uuid4(),Jsonb(output))).fetchone()[0]
        assert db.execute('select app.forecast_finish(%s,%s,%s)',(run,token,Jsonb(output))).fetchone()[0]
        assert not db.execute('select app.forecast_finish(%s,%s,%s)',(run,token,Jsonb(output))).fetchone()[0]
    with session(tenant) as db:
        evidence,forecast_id=db.execute('select evidence,id from public.forecast_results where run_id=%s',(run,)).fetchone()
        assert evidence['driver']==task['driver']
        assert evidence['source']==task['items'][0]
        assert evidence['original_forecast']==task['original_forecast']
        assert datetime.fromisoformat(evidence['driver']['imported_at'])<=datetime.now(timezone.utc)
        assert db.execute('select public.planned_event_source(%s,%s)',(tenant[1],forecast_id)).fetchone()[0]['status']=='forecast_unavailable'
        with pytest.raises(psycopg.Error) as error:
            with db.transaction():
                db.execute("select public.planned_event_preview(%s,%s,'campaign','Blocked','Unsupported conditional source','EA','[{\"date\":\"2026-05-21\",\"quantity\":\"1\"}]',true)", (tenant[1],forecast_id))
        assert error.value.sqlstate=='MQ422'
