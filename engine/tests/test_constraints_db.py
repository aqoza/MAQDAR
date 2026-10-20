"""Local real-worker, source deletion, concurrency and authorization checks."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import time
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest

from test_planning_db import planning, worker
from test_simulation_db import policy, enqueue as enqueue_original
from maqdar_engine.worker import process_one
from maqdar_engine.policy_constraints import calculate

pytestmark = pytest.mark.db

def config(maximum, lead=1, review=2, moq="0", pack="0.001"):
    return dict(maximum=maximum, lead_time=lead, review_interval=review, moq=moq, pack=pack)



@pytest.fixture
def simulation(planning, policy):
    run = enqueue_original(planning, policy[0])
    with worker(planning[0]) as db:
        assert process_one(db)
    return run


def enqueue(fixture, source, request=None, maxima=None, application_name='constraints-test'):
    with psycopg.connect(fixture[0], application_name=application_name) as db:
        db.execute('set local role authenticated')
        db.execute("select set_config('request.jwt.claims',%s,true)",
                   (json.dumps(dict(sub=str(fixture[2]), org_id=str(fixture[1]), role='authenticated')),))
        return db.execute('select public.simulation_constraints_enqueue(%s,%s,%s,%s,true)',
                          (fixture[1], source, request or uuid4(), Jsonb(maxima if maxima is not None else [config('0',0,1), config('8',3,4), config('10',365,365)]))).fetchone()[0]


def test_exact_results_survive_source_changes_and_deletion(planning, simulation, policy):
    request = uuid4()
    run = enqueue(planning, simulation, request)
    with psycopg.connect(planning[0]) as db:
        captured = db.execute('select payload from planning.simulation_inputs where run_id=%s', (run,)).fetchone()[0]
        source = db.execute('select evidence from public.policy_simulations where run_id=%s', (simulation,)).fetchone()[0]
        assert captured['source_simulation']['evidence'] == source
        db.execute("update public.demand_history set quantity=999,unit_of_measure='KG' where organization_id=%s", (planning[1],))
        db.execute('delete from public.planning_runs where id=any(%s)', ([simulation, policy[1]],))
    with worker(planning[0]) as db:
        assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        evidence = db.execute('select evidence from public.policy_simulations where run_id=%s', (run,)).fetchone()[0]
        assert evidence == dict(captured, output=calculate(captured))
        assert evidence['output']['variants'][0] == dict(source['output']['variants'][0], lead_time=source['policy']['lead_time'], review_interval=source['policy']['review_interval'], moq=None, pack=None)
        assert [{k:v for k,v in row.items() if k not in ('order_gap','rounding_extra')} for row in evidence['output']['variants'][2]['ledger']] == source['output']['variants'][1]['ledger']
        assert db.execute('select count(*) from planning.simulation_inputs where run_id=%s', (run,)).fetchone()[0] == 0
    assert enqueue(planning, simulation, request, [config('10.000',365,365), config('00',0,1), config('08',3,4)]) == run
    with pytest.raises(psycopg.Error) as error:
        enqueue(planning, simulation, request, [config('9')])
    assert error.value.sqlstate == 'MQ409'


def test_concurrent_canonical_retry_and_comparison_cannot_be_a_source(planning, simulation):
    request = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        runs = list(pool.map(lambda maxima: enqueue(planning, simulation, request, maxima), [[config('8',365,365), config('2',0,1)], [config('02.000',0,1), config('08',365,365)]]))
    assert runs[0] == runs[1]
    with worker(planning[0]) as db:
        assert process_one(db)
    with pytest.raises(psycopg.Error) as error:
        enqueue(planning, runs[0])
    assert error.value.sqlstate == 'MQ422'


def test_publication_validates_all_variants_and_fences_stale_leases(planning, simulation):
    run = enqueue(planning, simulation)
    with worker(planning[0]) as db:
        old = db.execute('select * from app.planning_claim()').fetchone()
        captured = db.execute('select app.planning_task(%s,%s)', old).fetchone()[0]
        output = calculate(captured)
        for change in ('baseline', 'ledger', 'name', 'maximum', 'count', 'source_alternative', 'lead', 'review', 'due', 'moq', 'pack', 'gap', 'extra', 'extra_total', 'gap_type', 'extra_type', 'extra_total_type'):
            invalid = deepcopy(output)
            if change == 'baseline': invalid['variants'][0]['metrics']['ending_stock'] = '999'
            if change == 'ledger': invalid['variants'][-1]['ledger'][0]['receipts'] = '999'
            if change == 'name': invalid['variants'][-1]['name'] = 'alternative-1'
            if change == 'maximum': invalid['variants'][-1]['maximum'] = '999'
            if change == 'lead': invalid['variants'][-1]['lead_time'] = 2
            if change == 'review': invalid['variants'][-1]['review_interval'] = 2
            if change == 'moq': invalid['variants'][-1]['moq'] = '999'
            if change == 'pack': invalid['variants'][-1]['pack'] = '1'
            if change == 'gap': invalid['variants'][-1]['ledger'][0]['order_gap'] = '999'
            if change == 'extra': invalid['variants'][-1]['ledger'][0]['rounding_extra'] = '999'
            if change == 'extra_total': invalid['variants'][-1]['metrics']['rounding_extra_quantity'] = '999'
            if change == 'gap_type': invalid['variants'][-1]['ledger'][0]['order_gap'] = int(invalid['variants'][-1]['ledger'][0]['order_gap'])
            if change == 'extra_type': invalid['variants'][-1]['ledger'][0]['rounding_extra'] = 0
            if change == 'extra_total_type': invalid['variants'][-1]['metrics']['rounding_extra_quantity'] = 0
            if change == 'due': invalid['variants'][-1]['ledger'][0]['order_due'] = '2026-01-02'
            if change == 'count': invalid['variants'].pop()
            if change == 'source_alternative': invalid['variants'][2]['ledger'][0]['immediate_fulfilled'] = '999'
            with pytest.raises(psycopg.Error) as error:
                db.execute('select app.simulation_finish(%s,%s,%s)', (*old, Jsonb(invalid)))
            assert error.value.sqlstate == 'MQ422'
        assert db.execute('select app.planning_fail(%s,%s)', old).fetchone()[0]
    with psycopg.connect(planning[0]) as db:
        db.execute("update pgmq.q_planning set vt=clock_timestamp()-interval '1 second' where message->>'run_id'=%s", (str(run),))
    with worker(planning[0]) as db:
        current = db.execute('select * from app.planning_claim()').fetchone()
        assert db.execute('select app.simulation_finish(%s,%s,%s)', (*old, Jsonb(output))).fetchone()[0] is False
    with psycopg.connect(planning[0]) as db:
        db.execute("update planning.leases set expires_at=clock_timestamp()-interval '1 second' where run_id=%s", (run,))
    with worker(planning[0]) as db:
        assert db.execute('select app.simulation_finish(%s,%s,%s)', (*current, Jsonb(output))).fetchone()[0] is False
    with psycopg.connect(planning[0]) as db:
        db.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(dict(sub=str(planning[2]), org_id=str(planning[1]))),))
        db.execute('set local role authenticated')
        db.execute('select public.planning_cancel(%s,%s)', (planning[1], run))
    with worker(planning[0]) as db:
        assert db.execute('select app.simulation_finish(%s,%s,%s)', (*current, Jsonb(output))).fetchone()[0] is False
    with psycopg.connect(planning[0]) as db:
        assert db.execute('select count(*) from public.policy_simulations where run_id=%s', (run,)).fetchone()[0] == 0
        assert db.execute('select count(*) from planning.simulation_inputs where run_id=%s', (run,)).fetchone()[0] == 0


@pytest.mark.parametrize('retry', [False, True])
def test_membership_revocation_during_request_lock_is_rechecked(planning, simulation, retry):
    request = uuid4()
    if retry:
        enqueue(planning, simulation, request)
        with worker(planning[0]) as db:
            assert process_one(db)
    name = f'constraints-authority-{uuid4()}'
    with psycopg.connect(planning[0]) as lock:
        lock.execute("select pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||%s,0))", (str(planning[1]),))
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(enqueue, planning, simulation, request, None, name)
            try:
                with psycopg.connect(planning[0], autocommit=True) as admin:
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        waiting = admin.execute("select exists(select 1 from pg_stat_activity where application_name=%s and wait_event_type='Lock')", (name,)).fetchone()[0]
                        if waiting:
                            break
                        time.sleep(0.02)
                    assert waiting, 'enqueue did not reach the request lock'
                    admin.execute("update public.memberships set role='viewer' where organization_id=%s and user_id=%s", (planning[1], planning[2]))
            finally:
                lock.commit()
            with pytest.raises(psycopg.Error) as error:
                pending.result(timeout=10)
            assert error.value.sqlstate == 'MQ403'


def test_fractional_and_large_constraint_rounding_publication(planning, simulation):
    run=enqueue(planning,simulation,maxima=[config('0',0,3,'10','0.007'),config('6',0,1,'10','2.5'),config('6',1,2,'10','4'),config('999999999999999.999',365,365,'999999999999999.999','0.008')])
    with worker(planning[0]) as db: assert process_one(db)
    with psycopg.connect(planning[0]) as db:
        evidence=db.execute('select evidence from public.policy_simulations where run_id=%s',(run,)).fetchone()[0]
        assert evidence['output']==calculate(evidence)
        assert evidence['output']['variants'][-1]['ledger'][0]['order_quantity']=='1000000000000000'


def test_conserving_but_unrounded_ledger_cannot_publish(planning, simulation):
    from decimal import Decimal, localcontext
    from maqdar_engine.policy_constraints import replay
    run=enqueue(planning,simulation,maxima=[config('6',1,2,'10','4')])
    with worker(planning[0]) as db:
        claim=db.execute('select * from app.planning_claim()').fetchone()
        assert claim[0]==run
        captured=db.execute('select app.planning_task(%s,%s)',claim).fetchone()[0]
        output=calculate(captured)
        with localcontext() as context:
            context.prec=80
            unrounded=replay(captured['demand'],Decimal(captured['options']['opening_stock']),Decimal(6),1,2,Decimal(0),Decimal('0.001'))
        # All flows and aggregate metrics reconcile, but these orders ignore the approved constraints.
        output['variants'][1].update(unrounded)
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.simulation_finish(%s,%s,%s)',(*claim,Jsonb(output)))
        assert error.value.sqlstate=='MQ422'
