"""The scoped entry point must never fall back to the global worker RPCs."""
from unittest.mock import MagicMock

import psycopg
import pytest

from zeespare_engine.scoped_worker import main, process_one, failure_category
from test_policy_simulation import task


@pytest.mark.parametrize('method,module', [
    ('periodic-constraints-v1', 'policy_constraints'),
    ('periodic-calendars-v1', 'policy_calendars'),
])
def test_newly_merged_methods_keep_scoped_publication(monkeypatch, method, module):
    calculator = MagicMock(return_value={'synthetic': True})
    monkeypatch.setattr(f'zeespare_engine.{module}.calculate', calculator)
    payload = {'kind': 'simulation', 'method': method}
    db = MagicMock()
    db.execute.return_value.fetchone.side_effect = [('run', 'token'), (payload,), (True,)]
    assert process_one(db) is True
    calculator.assert_called_once_with(payload)
    assert db.execute.call_args.args[0] == 'select app.scoped_simulation_finish(%s,%s,%s)'


def test_empty_scoped_queue():
    db = MagicMock()
    db.execute.return_value.fetchone.return_value = None
    assert process_one(db) is False
    assert db.execute.call_args.args == ('select * from app.scoped_simulation_claim()',)


def test_scoped_replay_uses_only_scoped_rpc():
    db = MagicMock()
    db.execute.return_value.fetchone.side_effect = [('run', 'token'), (task(),), (True,)]
    assert process_one(db) is True
    assert [c.args[0] for c in db.execute.call_args_list] == [
        'select * from app.scoped_simulation_claim()',
        'select app.scoped_simulation_task(%s,%s)',
        'select app.scoped_simulation_finish(%s,%s,%s)',
    ]


def test_unsupported_kind_fails_with_scoped_rpc_and_redacted_log(capsys):
    db = MagicMock()
    db.execute.return_value.fetchone.side_effect = [('run', 'token'), ({'kind': 'forecast'},)]
    assert process_one(db) is True
    assert db.execute.call_args.args[0] == 'select app.scoped_simulation_fail(%s,%s)'
    assert 'forecast' not in capsys.readouterr().err


def test_cancelled_task_never_publishes():
    db = MagicMock()
    db.execute.return_value.fetchone.side_effect = [('run', 'token'), (None,)]
    assert process_one(db) is True
    assert db.execute.call_count == 2


def test_lost_database_connection_exits_for_restart():
    db = MagicMock()
    db.execute.side_effect = psycopg.OperationalError('private database message')
    with pytest.raises(psycopg.Error):
        process_one(db)


def test_connection_only_check_never_claims(monkeypatch):
    monkeypatch.setattr('sys.argv', ['zeespare-simulation-worker', '--check'])
    monkeypatch.setenv('ZEESPARE_WORKER_DSN', 'host=127.0.0.1')
    monkeypatch.setenv('ZEESPARE_EXPECTED_ORGANIZATION', '00000000-0000-4000-8000-000000000001')
    connector = MagicMock()
    db = connector.return_value.__enter__.return_value
    db.execute.return_value.fetchone.return_value = ('00000000-0000-4000-8000-000000000001',)
    monkeypatch.setattr('zeespare_engine.scoped_worker.psycopg.connect', connector)
    assert main() == 0
    statements = [c.args[0] for c in db.execute.call_args_list]
    assert statements[0] == 'set role zeespare_simulation_worker'
    assert not any('claim' in s for s in statements)


def test_expected_organization_mismatch_fails_closed(monkeypatch):
    monkeypatch.setattr('sys.argv', ['zeespare-simulation-worker', '--once'])
    monkeypatch.setenv('ZEESPARE_WORKER_DSN', 'host=127.0.0.1')
    monkeypatch.setenv('ZEESPARE_EXPECTED_ORGANIZATION', '00000000-0000-4000-8000-000000000001')
    connector = MagicMock()
    db = connector.return_value.__enter__.return_value
    db.execute.return_value.fetchone.return_value = ('00000000-0000-4000-8000-000000000002',)
    monkeypatch.setattr('zeespare_engine.scoped_worker.psycopg.connect', connector)
    assert main() == 1
    assert not any('claim' in c.args[0] for c in db.execute.call_args_list)


def test_supervised_probe_exposes_health_but_never_claims(monkeypatch):
    monkeypatch.setattr('sys.argv', ['zeespare-simulation-worker', '--probe'])
    monkeypatch.setenv('ZEESPARE_WORKER_DSN', 'host=127.0.0.1')
    monkeypatch.setenv('ZEESPARE_EXPECTED_ORGANIZATION', '00000000-0000-4000-8000-000000000001')
    connector = MagicMock()
    db = connector.return_value.__enter__.return_value
    db.execute.return_value.fetchone.return_value = ('00000000-0000-4000-8000-000000000001',)
    monkeypatch.setattr('zeespare_engine.scoped_worker.psycopg.connect', connector)
    stopped = MagicMock()
    stopped.is_set.side_effect = [False, True]
    monkeypatch.setattr('zeespare_engine.scoped_worker.threading.Event', lambda: stopped)
    assert main() == 0
    assert not any('claim' in c.args[0] for c in db.execute.call_args_list)


@pytest.mark.parametrize('error,expected', [
    (psycopg.errors.InsufficientPrivilege('private credential'), 'SQLSTATE 42501'),
    (psycopg.OperationalError('SSL connection has been closed unexpectedly: private'), 'connection closed'),
    (psycopg.OperationalError('prepared statement does not exist: private'), 'prepared statement'),
    (psycopg.OperationalError('private credential'), 'database transport'),
    (ValueError('private credential'), 'configuration or identity'),
])
def test_failure_diagnostics_never_include_provider_text(error, expected):
    assert failure_category(error) == expected
