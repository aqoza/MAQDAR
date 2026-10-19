"""Materialize the owner-supplied project CA and exec the restricted consumer."""
import os
from pathlib import Path
import ssl
import sys
import tempfile

import psycopg
from psycopg.conninfo import make_conninfo
from maqdar_engine.worker import validate_dsn


def main():
    try:
        dsn = os.environ.get('MAQDAR_WORKER_DSN', '')
        validate_dsn(dsn)
        certificate = os.environ.pop('MAQDAR_DATABASE_CA', '')
        if not certificate:
            raise ValueError('Database CA required')
        with tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False) as handle:
            handle.write(certificate)
            ca_file = handle.name
        Path(ca_file).chmod(0o600)
        ssl.create_default_context(cafile=ca_file)
        os.environ['MAQDAR_WORKER_DSN'] = make_conninfo(dsn, sslrootcert=ca_file)
        os.environ['MAQDAR_WORKER_HEALTH_PORT'] = '8080'
        os.execv(sys.executable, [sys.executable, '-m', 'maqdar_engine.scoped_worker'])
    except (ValueError, OSError, psycopg.Error):
        print('Simulation bootstrap failed: check verified connection and CA.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
