"""Real runtime LOGIN and interleaved tenant queues. Loopback databases only."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from secrets import token_hex
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.types.json import Jsonb
import pytest

from zeespare_engine.policy_simulation import calculate
from zeespare_engine.scoped_worker import process_one
from test_policy_simulation import task

pytestmark = pytest.mark.db


@pytest.fixture
def scoped(dsn):
    assert conninfo_to_dict(dsn).get('host') in {'127.0.0.1', 'localhost', '::1'}
    org, foreign, location, other_location = [uuid4() for _ in range(4)]
    role, password = 'qa_sim_' + uuid4().hex, token_hex(24)
    with psycopg.connect(dsn, autocommit=True) as db:
        for organization, loc in ((org, location), (foreign, other_location)):
            db.execute('insert into public.organizations(id,slug,name) values(%s,%s,%s)',
                       (organization, 'scope-' + str(organization), 'Synthetic worker scope'))
            db.execute("insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'TEST','Test','branch','SA','Asia/Riyadh')", (loc, organization))
        db.execute(sql.SQL('create role {} login password {} nosuperuser nocreatedb nocreaterole noinherit nobypassrls').format(sql.Identifier(role), sql.Literal(password)))
        db.execute(sql.SQL('grant zeespare_simulation_worker to {}').format(sql.Identifier(role)))
        db.execute('insert into planning.simulation_worker_scopes(login_oid,login_name,organization_id) select oid,rolname,%s from pg_roles where rolname=%s', (org, role))
    runtime = make_conninfo(dsn, user=role, password=password)
    yield dict(dsn=dsn, runtime=runtime, org=org, foreign=foreign, location=location, other_location=other_location, role=role)
    with psycopg.connect(dsn, autocommit=True) as db:
        db.execute("update public.planning_runs set status='canceled',finished_at=now() where organization_id=any(%s) and status in ('queued','running')", ([org, foreign],))
        db.execute('delete from planning.simulation_worker_scopes where organization_id=%s', (org,))
        for table in ('q_planning', 'a_planning'):
            db.execute(sql.SQL("delete from pgmq.{} where message->>'run_id' in (select id::text from public.planning_runs where organization_id=any(%s))").format(sql.Identifier(table)), ([org, foreign],))
        db.execute('delete from public.organizations where id=any(%s)', ([org, foreign],))
        db.execute('delete from public.audit_log where organization_id=any(%s)', ([org, foreign],))
        db.execute(sql.SQL('drop role {}').format(sql.Identifier(role)))


@contextmanager
def runtime(fixture):
    with psycopg.connect(fixture['runtime'], autocommit=True) as db:
        db.execute('set role zeespare_simulation_worker')
        yield db


def queued(fixture, *, foreign=False, kind='simulation', status='queued', attempts=0):
    organization = fixture['foreign'] if foreign else fixture['org']
    loc = fixture['other_location'] if foreign else fixture['location']
    run = uuid4()
    payload = task()
    payload['policy'].update(id=str(uuid4()), item_id=str(uuid4()), item_code='SYN-SCOPE', evidence={})
    with psycopg.connect(fixture['dsn']) as db:
        # Terminal decoys can coexist with the one-active-per-organization invariant.
        db.execute("insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,attempts,options,finished_at) values(%s,%s,%s,%s,'2026-01-02','2026-01-05',%s,%s,%s,'{}',case when %s in ('failed','canceled') then now() end)",
                   (run, organization, loc, uuid4(), kind, status, attempts, status))
        message = db.execute("select pgmq.send('planning',jsonb_build_object('run_id',%s::text))", (str(run),)).fetchone()[0]
        db.execute('insert into planning.leases(run_id,message_id) values(%s,%s)', (run, message))
        if kind == 'simulation':
            db.execute('insert into planning.simulation_inputs(run_id,payload) values(%s,%s)', (run, Jsonb(payload)))
    return run


def transport(fixture, organization):
    with psycopg.connect(fixture['dsn']) as db:
        return db.execute("""select r.id,to_jsonb(r),to_jsonb(l),to_jsonb(q),to_jsonb(a)
            from public.planning_runs r left join planning.leases l on l.run_id=r.id
            left join pgmq.q_planning q on q.message->>'run_id'=r.id::text
            left join pgmq.a_planning a on a.message->>'run_id'=r.id::text
            where r.organization_id=%s order by r.id""", (organization,)).fetchall()


def test_foreign_stale_and_exhausted_messages_are_untouched(scoped):
    queued(scoped, foreign=True, status='canceled')
    queued(scoped, foreign=True, status='failed')
    queued(scoped, foreign=True, attempts=3)
    target = queued(scoped)
    before = transport(scoped, scoped['foreign'])
    with runtime(scoped) as db:
        lease = db.execute('select * from app.scoped_simulation_claim()').fetchone()
        assert lease[0] == target
        payload = db.execute('select app.scoped_simulation_task(%s,%s)', lease).fetchone()[0]
        assert db.execute('select app.scoped_simulation_finish(%s,%s,%s)', (*lease, Jsonb(calculate(payload)))).fetchone()[0]
        assert db.execute('select * from app.scoped_simulation_claim()').fetchone() is None
    assert transport(scoped, scoped['foreign']) == before


def test_shared_worker_cannot_claim_scoped_simulations(scoped):
    target = queued(scoped)
    foreign = queued(scoped, foreign=True, kind='readiness')
    before = transport(scoped, scoped['org'])
    with psycopg.connect(scoped['dsn'], autocommit=True) as db:
        db.execute('set role zeespare_worker')
        assert db.execute('select * from app.planning_claim()').fetchone()[0] == foreign
        assert db.execute('select * from app.planning_claim()').fetchone() is None
    assert transport(scoped, scoped['org']) == before
    with runtime(scoped) as db:
        assert db.execute('select * from app.scoped_simulation_claim()').fetchone()[0] == target


def test_scoped_login_has_no_global_or_raw_access(scoped):
    with runtime(scoped) as db:
        assert str(db.execute('select app.scoped_simulation_identity()').fetchone()[0]) == str(scoped['org'])
        for statement in ('select * from app.planning_claim()', 'select * from public.planning_runs',
                          'select * from planning.leases', 'select * from pgmq.q_planning',
                          'select * from planning.simulation_worker_scopes', 'set role zeespare_worker'):
            with pytest.raises(psycopg.Error) as error:
                db.execute(statement)
            assert error.value.sqlstate == '42501'
        db.execute("select set_config('request.jwt.claims',%s,false)", ('{"org_id":"' + str(scoped['foreign']) + '"}',))
        assert db.execute('select app.scoped_simulation_identity()').fetchone()[0] == scoped['org']


def test_cross_tenant_and_wrong_kind_tokens_cannot_read_fail_or_finish(scoped):
    other = queued(scoped, foreign=True)
    with psycopg.connect(scoped['dsn'], autocommit=True) as admin:
        admin.execute('set role zeespare_worker')
        lease = admin.execute('select * from app.planning_claim()').fetchone()
    assert lease[0] == other
    before = transport(scoped, scoped['foreign'])
    with runtime(scoped) as db:
        assert db.execute('select app.scoped_simulation_task(%s,%s)', lease).fetchone()[0] is None
        assert db.execute('select app.scoped_simulation_fail(%s,%s)', lease).fetchone()[0] is False
        assert db.execute('select app.scoped_simulation_finish(%s,%s,%s)', (*lease, Jsonb({}))).fetchone()[0] is False
    assert transport(scoped, scoped['foreign']) == before
    queued(scoped, kind='readiness')
    before = transport(scoped, scoped['org'])
    with runtime(scoped) as db:
        assert db.execute('select * from app.scoped_simulation_claim()').fetchone() is None
    assert transport(scoped, scoped['org']) == before


def test_concurrent_claims_and_expired_retry_fencing(scoped):
    target = queued(scoped)
    def claim(_):
        with runtime(scoped) as db:
            return db.execute('select * from app.scoped_simulation_claim()').fetchone()
    with ThreadPoolExecutor(max_workers=2) as pool:
        leases = [v for v in pool.map(claim, range(2)) if v]
    assert len(leases) == 1 and leases[0][0] == target
    with psycopg.connect(scoped['dsn']) as db:
        db.execute("update pgmq.q_planning set vt=now()-interval '1 second' where message->>'run_id'=%s", (str(target),))
        db.execute("update planning.leases set expires_at=now()-interval '1 second' where run_id=%s", (target,))
    with runtime(scoped) as db:
        replacement = db.execute('select * from app.scoped_simulation_claim()').fetchone()
        assert replacement[1] != leases[0][1]
        assert db.execute('select app.scoped_simulation_fail(%s,%s)', leases[0]).fetchone()[0] is False
        assert db.execute('select app.scoped_simulation_fail(%s,%s)', replacement).fetchone()[0] is True


def test_disabled_scope_never_falls_back_to_global(scoped):
    queued(scoped)
    with psycopg.connect(scoped['dsn']) as db:
        db.execute('update planning.simulation_worker_scopes set enabled=false where organization_id=%s', (scoped['org'],))
    before = transport(scoped, scoped['org'])
    with runtime(scoped) as db:
        assert db.execute('select app.scoped_simulation_identity()').fetchone()[0] == scoped['org']
        with pytest.raises(psycopg.Error) as error:
            db.execute('select * from app.scoped_simulation_claim()')
        assert error.value.sqlstate == '42501'
    # Disabled runtime remains routed away from the global consumer: pause is fail-closed.
    with psycopg.connect(scoped['dsn'], autocommit=True) as db:
        db.execute('set role zeespare_worker')
        assert db.execute('select * from app.planning_claim()').fetchone() is None
    assert transport(scoped, scoped['org']) == before


def test_real_scoped_python_worker_publishes_one_immutable_result(scoped):
    target = queued(scoped)
    with runtime(scoped) as db:
        assert process_one(db) is True
        assert process_one(db) is False
    with psycopg.connect(scoped['dsn']) as db:
        assert db.execute('select status,attempts from public.planning_runs where id=%s', (target,)).fetchone() == ('succeeded', 1)
        assert db.execute('select count(*) from public.policy_simulations where run_id=%s', (target,)).fetchone()[0] == 1
        assert db.execute('select count(*) from planning.simulation_inputs where run_id=%s', (target,)).fetchone()[0] == 0
        assert db.execute('select count(*) from planning.leases where run_id=%s', (target,)).fetchone()[0] == 0


@pytest.mark.parametrize('method', ['periodic-sensitivity-v1', 'periodic-configurations-v1',
                                    'periodic-constraints-v1', 'periodic-calendars-v1'])
def test_scoped_comparisons_use_same_identity_and_publication(scoped, method):
    if method == 'periodic-sensitivity-v1':
        from test_policy_sensitivity import task as comparison_task
    elif method == 'periodic-configurations-v1':
        from test_policy_configurations import task as comparison_task
    elif method == 'periodic-constraints-v1':
        from test_policy_constraints import task as comparison_task
    else:
        from test_policy_calendars import task as comparison_task
    target = queued(scoped)
    with psycopg.connect(scoped['dsn']) as db:
        replay = db.execute('select payload from planning.simulation_inputs where run_id=%s', (target,)).fetchone()[0]
        payload = comparison_task()
        payload['policy'] = replay['policy']
        payload['source_simulation']['evidence']['policy'] = replay['policy']
        if 'source_comparison' in payload:
            payload['source_comparison']['evidence']['policy'] = replay['policy']
        db.execute('update planning.simulation_inputs set payload=%s where run_id=%s', (Jsonb(payload), target))
    with runtime(scoped) as db:
        assert process_one(db) is True
    with psycopg.connect(scoped['dsn']) as db:
        assert db.execute('select result->>\'method\' from public.planning_runs where id=%s', (target,)).fetchone()[0] == method


def test_cancellation_and_invalid_output_cannot_publish(scoped):
    target = queued(scoped)
    with runtime(scoped) as db:
        lease = db.execute('select * from app.scoped_simulation_claim()').fetchone()
        payload = db.execute('select app.scoped_simulation_task(%s,%s)', lease).fetchone()[0]
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.scoped_simulation_finish(%s,%s,%s)', (*lease, Jsonb({})))
        assert error.value.sqlstate == 'MQ422'
    with psycopg.connect(scoped['dsn']) as db:
        db.execute("update public.planning_runs set status='canceled',finished_at=now() where id=%s", (target,))
    with runtime(scoped) as db:
        assert db.execute('select app.scoped_simulation_task(%s,%s)', lease).fetchone()[0] is None
        assert db.execute('select app.scoped_simulation_finish(%s,%s,%s)', (*lease, Jsonb(calculate(payload)))).fetchone()[0] is False
        assert db.execute('select app.scoped_simulation_fail(%s,%s)', lease).fetchone()[0] is False


def test_only_scoped_exhaustion_is_drained(scoped):
    queued(scoped, foreign=True, attempts=3)
    target = queued(scoped, attempts=3)
    before = transport(scoped, scoped['foreign'])
    with runtime(scoped) as db:
        assert db.execute('select * from app.scoped_simulation_claim()').fetchone() is None
    assert transport(scoped, scoped['foreign']) == before
    with psycopg.connect(scoped['dsn']) as db:
        assert db.execute('select status,error_code from public.planning_runs where id=%s', (target,)).fetchone() == ('failed', 'attempts_exhausted')


def test_scope_revocation_during_compute_blocks_publication(scoped):
    target = queued(scoped)
    with runtime(scoped) as db:
        lease = db.execute('select * from app.scoped_simulation_claim()').fetchone()
        payload = db.execute('select app.scoped_simulation_task(%s,%s)', lease).fetchone()[0]
    with psycopg.connect(scoped['dsn']) as db:
        db.execute('update planning.simulation_worker_scopes set enabled=false where organization_id=%s', (scoped['org'],))
    before = transport(scoped, scoped['org'])
    with runtime(scoped) as db:
        for statement, args in (
            ('select app.scoped_simulation_task(%s,%s)', lease),
            ('select app.scoped_simulation_fail(%s,%s)', lease),
            ('select app.scoped_simulation_finish(%s,%s,%s)', (*lease, Jsonb(calculate(payload)))),
        ):
            with pytest.raises(psycopg.Error) as error:
                db.execute(statement, args)
            assert error.value.sqlstate == '42501'
    assert transport(scoped, scoped['org']) == before


def test_routing_cutover_refuses_active_simulation(scoped):
    queued(scoped)
    with psycopg.connect(scoped['dsn'], autocommit=True) as db:
        with pytest.raises(psycopg.Error) as error:
            db.execute('delete from planning.simulation_worker_scopes where organization_id=%s', (scoped['org'],))
        assert error.value.sqlstate == 'MQ409'


def test_capability_membership_revocation_fails_closed(scoped):
    queued(scoped)
    with runtime(scoped) as db:
        with psycopg.connect(scoped['dsn'], autocommit=True) as admin:
            admin.execute(sql.SQL('revoke zeespare_simulation_worker from {}').format(sql.Identifier(scoped['role'])))
        with pytest.raises(psycopg.Error) as error:
            db.execute('select * from app.scoped_simulation_claim()')
        assert error.value.sqlstate == '42501'


def test_added_browser_membership_invalidates_runtime_scope(scoped):
    with psycopg.connect(scoped['dsn'], autocommit=True) as admin:
        admin.execute(sql.SQL('grant authenticated to {}').format(sql.Identifier(scoped['role'])))
    with runtime(scoped) as db:
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.scoped_simulation_identity()')
        assert error.value.sqlstate == '42501'


def test_dropped_recreated_login_does_not_inherit_old_scope(scoped):
    password = conninfo_to_dict(scoped['runtime'])['password']
    with psycopg.connect(scoped['dsn'], autocommit=True) as admin:
        admin.execute(sql.SQL('drop role {}').format(sql.Identifier(scoped['role'])))
        admin.execute(sql.SQL('create role {} login noinherit password {}').format(sql.Identifier(scoped['role']), sql.Literal(password)))
        admin.execute(sql.SQL('grant zeespare_simulation_worker to {}').format(sql.Identifier(scoped['role'])))
    with runtime(scoped) as db:
        with pytest.raises(psycopg.Error) as error:
            db.execute('select app.scoped_simulation_identity()')
        assert error.value.sqlstate == '42501'
