"""Durable readiness and classification worker. SQL owns the lease, tenant boundary and atomic result."""
from __future__ import annotations

import argparse
import os
import signal
import sys
import threading

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.types.json import Jsonb

from maqdar_engine.classification import VERSION, classify
from maqdar_engine.forecasting import VERSION as FORECAST_VERSION, forecast


def validate_dsn(dsn: str) -> None:
    """No implicit libpq environment fallback; remote hosts require verified TLS."""
    if not dsn:
        raise ValueError('MAQDAR_WORKER_DSN is required')
    options = conninfo_to_dict(dsn)
    host = options.get('host', '')
    if not host or ',' in host or 'hostaddr' in options:
        raise ValueError('Use one explicit database host')
    if host not in {'localhost', '127.0.0.1', '::1'} and options.get('sslmode') != 'verify-full':
        raise ValueError('Remote workers require sslmode=verify-full')


def process_one(connection: psycopg.Connection) -> bool:
    """Each call is its own autocommit transaction; failures cannot erase a claim."""
    claim = connection.execute('select * from app.planning_claim()').fetchone()
    if claim is None:
        return False
    run_id, token = claim
    try:
        task = connection.execute('select app.planning_task(%s,%s)', (run_id, token)).fetchone()[0]
        if task is None:
            return True  # Canceled, expired or replaced while this process was paused.
        if task['kind'] == 'readiness':
            connection.execute('select app.planning_execute(%s,%s)', (run_id, token)).fetchone()
        elif task['kind'] == 'classification' and task.get('method') == VERSION:
            rows = classify(task)
            connection.execute('select app.classification_finish(%s,%s,%s)', (run_id, token, Jsonb(rows))).fetchone()
        elif task['kind'] == 'forecast' and task.get('method') == FORECAST_VERSION:
            rows = forecast(task)
            connection.execute('select app.forecast_finish(%s,%s,%s)', (run_id, token, Jsonb(rows))).fetchone()
        elif task['kind'] == 'forecast' and task.get('method') in ('expanded-v1', 'regional-v1'):
            from maqdar_engine.forecast_process import compute
            rows = compute(task)
            connection.execute('select app.forecast_finish(%s,%s,%s)', (run_id, token, Jsonb(rows))).fetchone()
        elif task['kind'] == 'policy' and task.get('method') == 'policy-v1':
            from maqdar_engine.forecast_process import compute
            rows = compute(task)
            connection.execute('select app.policy_finish(%s,%s,%s)', (run_id, token, Jsonb(rows))).fetchone()
        elif task['kind'] == 'simulation' and task.get('method') == 'periodic-replay-v1':
            from maqdar_engine.policy_simulation import calculate
            result = calculate(task)
            connection.execute('select app.simulation_finish(%s,%s,%s)', (run_id, token, Jsonb(result))).fetchone()
        elif task['kind'] == 'simulation' and task.get('method') == 'periodic-sensitivity-v1':
            from maqdar_engine.policy_sensitivity import calculate
            result = calculate(task)
            connection.execute('select app.simulation_finish(%s,%s,%s)', (run_id, token, Jsonb(result))).fetchone()
        elif task['kind'] == 'simulation' and task.get('method') == 'periodic-configurations-v1':
            from maqdar_engine.policy_configurations import calculate
            result = calculate(task)
            connection.execute('select app.simulation_finish(%s,%s,%s)', (run_id, token, Jsonb(result))).fetchone()
        elif task['kind'] == 'preparation' and task.get('method') == 'preparation-v1':
            from maqdar_engine.preparation import prepare
            rows = prepare(task)
            connection.execute('select app.preparation_finish(%s,%s,%s)', (run_id, token, Jsonb(rows))).fetchone()
        else:
            raise ValueError('Unsupported planning task')
    except (psycopg.Error, ValueError, ArithmeticError):
        # A broken connection may also prevent this acknowledgement. The queue's
        # visibility timeout still recovers it; never log DB text or the DSN.
        connection.execute('select app.planning_fail(%s,%s)', (run_id, token))
        print('Planning attempt failed; retry state recorded.', file=sys.stderr)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description='Process MAQDAR planning runs')
    parser.add_argument('--once', action='store_true', help='Process at most one run and exit')
    args = parser.parse_args()
    stopped = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    dsn = os.environ.get('MAQDAR_WORKER_DSN', '')
    try:
        validate_dsn(dsn)
        with psycopg.connect(dsn, autocommit=True, connect_timeout=10,
                             application_name='maqdar-worker') as connection:
            # The login needs only membership in this capability role. Even a
            # local operator connection drops its ordinary privileges here.
            connection.execute('set role maqdar_worker')
            connection.execute("set statement_timeout = '90s'")
            connection.execute("set lock_timeout = '5s'")
            while not stopped.is_set():
                worked = process_one(connection)
                if args.once:
                    return 0
                if not worked:
                    stopped.wait(5)
        return 0
    except (ValueError, psycopg.Error):
        print('Planning worker stopped: check connection, permissions and migrations.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
