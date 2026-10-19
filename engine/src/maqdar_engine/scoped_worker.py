"""Simulation-only consumer. PostgreSQL binds session_user to one tenant."""
from __future__ import annotations

import argparse
import os
import signal
import sys
import threading
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from maqdar_engine.worker import validate_dsn
from maqdar_engine.worker_health import health_server


def process_one(connection: psycopg.Connection) -> bool:
    claim = connection.execute('select * from app.scoped_simulation_claim()').fetchone()
    if claim is None:
        return False
    try:
        task = connection.execute('select app.scoped_simulation_task(%s,%s)', claim).fetchone()[0]
        if task is None:
            return True
        if task.get('kind') != 'simulation':
            raise ValueError('Unsupported task')
        if task.get('method') == 'periodic-replay-v1':
            from maqdar_engine.policy_simulation import calculate
        elif task.get('method') == 'periodic-sensitivity-v1':
            from maqdar_engine.policy_sensitivity import calculate
        else:
            raise ValueError('Unsupported method')
        result = calculate(task)
        published = connection.execute('select app.scoped_simulation_finish(%s,%s,%s)', (*claim, Jsonb(result))).fetchone()[0]
        print('Simulation completed.' if published else 'Simulation lease no longer current.')
    except (psycopg.Error, ValueError, ArithmeticError):
        connection.execute('select app.scoped_simulation_fail(%s,%s)', claim)
        print('Simulation attempt failed; retry state recorded.', file=sys.stderr)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description='Process simulations for a database-bound tenant')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--once', action='store_true')
    mode.add_argument('--check', action='store_true', help='Verify identity/connection without claiming')
    args = parser.parse_args()
    stopped = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopped.set())
    try:
        dsn = os.environ.get('MAQDAR_WORKER_DSN', '')
        validate_dsn(dsn)
        expected = UUID(os.environ.get('MAQDAR_EXPECTED_ORGANIZATION', ''))
        with psycopg.connect(dsn, autocommit=True, connect_timeout=10,
                             application_name='maqdar-simulation-worker') as connection:
            connection.execute('set role maqdar_simulation_worker')
            connection.execute("set statement_timeout = '90s'")
            connection.execute("set lock_timeout = '5s'")
            actual = connection.execute('select app.scoped_simulation_identity()').fetchone()[0]
            if UUID(str(actual)) != expected:
                raise ValueError('Unexpected scope')
            if args.check:
                print('Simulation runtime identity verified; no message claimed.')
                return 0
            with health_server(os.environ.get('MAQDAR_WORKER_HEALTH_PORT', '')) as health:
                while not stopped.is_set():
                    health.touch()
                    worked = process_one(connection)
                    health.touch()
                    if args.once:
                        return 0
                    if not worked:
                        stopped.wait(5)
        return 0
    except (ValueError, psycopg.Error):
        print('Simulation worker stopped: check connection, scope and migrations.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
