"""Opt-in real Linux image probe/consume/restart against a loopback-only fixture."""
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4

import psycopg
from psycopg.conninfo import make_conninfo
import pytest

from test_scoped_worker_db import scoped, queued, runtime, transport

pytestmark = pytest.mark.db


def test_container_probe_consume_and_crash_recovery(scoped, tmp_path):
    image = os.environ.get('MAQDAR_CONTAINER_IMAGE')
    database_container = os.environ.get('MAQDAR_TEST_DB_CONTAINER')
    if not image or not database_container:
        pytest.skip('opt in with MAQDAR_CONTAINER_IMAGE and MAQDAR_TEST_DB_CONTAINER for local Docker smoke')
    name = 'qa-scoped-simulation-' + uuid4().hex
    env_file = Path(tmp_path) / '.env.local'
    env_file.write_text('MAQDAR_WORKER_DSN=' + make_conninfo(scoped['runtime'], host='127.0.0.1', port=5432)
                        + '\nMAQDAR_EXPECTED_ORGANIZATION=' + str(scoped['org']) + '\n')
    env_file.chmod(0o600)

    def docker(*args, **kwargs):
        return subprocess.run(['docker', *args], check=True, capture_output=True, text=True, timeout=60, **kwargs).stdout

    def start(mode):
        docker('run', '-d', '--rm', '--name', name, '--network', 'container:' + database_container,
               '--env-file', str(env_file), '-e', 'MAQDAR_DATABASE_CA', '-e', 'MAQDAR_WORKER_MODE=' + mode,
               image, env={**os.environ, 'MAQDAR_DATABASE_CA': certificate})

    def wait_for_run(run):
        for _ in range(30):
            with psycopg.connect(scoped['dsn']) as db:
                status = db.execute('select status from public.planning_runs where id=%s', (run,)).fetchone()[0]
            if status == 'succeeded':
                return
            if status in {'failed', 'canceled'}:
                pytest.fail('local container canary did not succeed')
            time.sleep(1)
        pytest.fail('local container canary timed out')

    try:
        certificate = docker('run', '--rm', '--network', 'none', '--entrypoint', 'cat', image,
                             '/etc/ssl/certs/ca-certificates.crt')
        certificate = certificate.split('-----END CERTIFICATE-----', 1)[0] + '-----END CERTIFICATE-----\n'
        queued(scoped, foreign=True, status='canceled')
        target = queued(scoped)
        with psycopg.connect(scoped['dsn']) as db:
            db.execute('update planning.simulation_worker_scopes set enabled=false where organization_id=%s', (scoped['org'],))
        before, foreign = transport(scoped, scoped['org']), transport(scoped, scoped['foreign'])
        start('probe')
        for attempt in range(20):
            try:
                docker('exec', name, '/app/engine/.venv/bin/python', '-c',
                       "import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).status==200")
                break
            except subprocess.CalledProcessError:
                if attempt == 19:
                    raise
                time.sleep(1)
        assert transport(scoped, scoped['org']) == before
        assert transport(scoped, scoped['foreign']) == foreign
        assert docker('exec', name, 'id', '-u').strip() == '10001'
        docker('stop', '--time', '10', name)
        with psycopg.connect(scoped['dsn']) as db:
            db.execute('update planning.simulation_worker_scopes set enabled=true where organization_id=%s', (scoped['org'],))
        start('consume')
        wait_for_run(target)
        docker('stop', '--time', '10', name)

        # Simulate a consumer dying after claim: expire only the owned synthetic lease.
        replacement_run = queued(scoped)
        with runtime(scoped) as db:
            old = db.execute('select * from app.scoped_simulation_claim()').fetchone()
        with psycopg.connect(scoped['dsn']) as db:
            db.execute("update pgmq.q_planning set vt=now()-interval '1 second' where message->>'run_id'=%s", (str(replacement_run),))
            db.execute("update planning.leases set expires_at=now()-interval '1 second' where run_id=%s", (replacement_run,))
        start('consume')
        wait_for_run(replacement_run)
        with runtime(scoped) as db:
            assert db.execute('select app.scoped_simulation_fail(%s,%s)', old).fetchone()[0] is False
        with psycopg.connect(scoped['dsn']) as db:
            assert db.execute('select attempts from public.planning_runs where id=%s', (replacement_run,)).fetchone()[0] == 2
            assert db.execute('select count(*) from public.policy_simulations where run_id=any(%s)', ([target, replacement_run],)).fetchone()[0] == 2
            assert db.execute('select count(*) from planning.leases where run_id=any(%s)', ([target, replacement_run],)).fetchone()[0] == 0
        assert transport(scoped, scoped['foreign']) == foreign
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, capture_output=True, timeout=30)
        env_file.unlink(missing_ok=True)
