from unittest.mock import MagicMock

import psycopg
import pytest

from maqdar_engine.worker import main, process_one, validate_dsn


def test_empty_queue_does_no_work():
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = None
    assert process_one(connection) is False
    assert connection.execute.call_count == 1


def test_claim_is_processed_and_no_failure_is_reported():
    connection = MagicMock()
    connection.execute.return_value.fetchone.side_effect = [('run', 'token'), ({'kind':'readiness'},), (True,)]
    assert process_one(connection) is True
    assert connection.execute.call_args.args[1] == ('run', 'token')
    assert 'planning_execute' in connection.execute.call_args.args[0]


def test_processing_error_is_reported_without_payload(capsys):
    connection = MagicMock()
    claim = MagicMock()
    claim.fetchone.return_value = ('run', 'token')
    connection.execute.side_effect = [claim, psycopg.OperationalError('secret payload'), MagicMock()]
    assert process_one(connection) is True
    assert 'planning_fail' in connection.execute.call_args.args[0]
    assert 'secret' not in capsys.readouterr().err


@pytest.mark.parametrize('dsn', ['', 'host=remote.example dbname=postgres', 'host=remote.example sslmode=require'])
def test_worker_rejects_missing_or_unverified_remote_dsn(dsn):
    with pytest.raises(ValueError):
        validate_dsn(dsn)


def test_local_and_verified_remote_dsn():
    validate_dsn('postgresql://postgres:postgres@127.0.0.1:54322/postgres')
    validate_dsn('host=db.example sslmode=verify-full sslrootcert=/cert.pem')


def test_failed_failure_acknowledgement_propagates_for_supervisor_restart():
    connection = MagicMock()
    claim = MagicMock()
    claim.fetchone.return_value = ('run', 'token')
    connection.execute.side_effect = [claim, psycopg.OperationalError('lost connection'), psycopg.OperationalError('still offline')]
    with pytest.raises(psycopg.OperationalError):
        process_one(connection)


def test_canceled_task_does_not_publish():
    connection = MagicMock()
    connection.execute.return_value.fetchone.side_effect = [('run', 'token'), (None,)]
    assert process_one(connection) is True
    assert connection.execute.call_count == 2


def test_unsupported_method_is_failed_without_publishing():
    connection = MagicMock()
    connection.execute.return_value.fetchone.side_effect = [('run', 'token'), ({'kind':'classification','method':'future'},)]
    assert process_one(connection) is True
    assert 'planning_fail' in connection.execute.call_args.args[0]


def test_cli_refuses_invalid_connection_without_leaking_configuration(monkeypatch, capsys):
    monkeypatch.setattr('sys.argv', ['maqdar-worker', '--once'])
    monkeypatch.setenv('MAQDAR_WORKER_DSN', 'postgresql://user:private-password@remote.example/database')
    assert main() == 1
    assert 'private-password' not in capsys.readouterr().err


def test_cli_once_drops_to_capability_role_and_bounds_queries(monkeypatch):
    monkeypatch.setattr('sys.argv', ['maqdar-worker', '--once'])
    monkeypatch.setenv('MAQDAR_WORKER_DSN', 'host=127.0.0.1')
    connection = MagicMock()
    connection.execute.return_value.fetchone.return_value = None
    connector = MagicMock()
    connector.return_value.__enter__.return_value = connection
    monkeypatch.setattr('maqdar_engine.worker.psycopg.connect', connector)
    assert main() == 0
    statements = [call.args[0] for call in connection.execute.call_args_list]
    assert statements[:3] == ['set role maqdar_worker', "set statement_timeout = '90s'", "set lock_timeout = '5s'"]
    assert connector.call_args.kwargs['autocommit'] is True
