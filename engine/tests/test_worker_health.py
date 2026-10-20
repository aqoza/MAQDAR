from urllib.request import urlopen

from maqdar_engine.worker_health import Heartbeat, health_server


def test_stale_worker_health_is_unavailable():
    health = Heartbeat()
    assert health.status() == 200
    health.last_poll -= 101
    assert health.status() == 503
    health.touch()
    assert health.status() == 200


def test_health_server_exposes_no_payload_or_configuration():
    with health_server('0') as health:
        with urlopen(f'http://127.0.0.1:{health.port}/health') as response:
            assert response.status == 200
            assert response.read() == b'{"status":"ready"}'


def test_disabled_health_server_still_tracks_liveness():
    with health_server('') as health:
        health.touch()
        assert health.port is None and health.status() == 200


def test_health_listener_does_not_require_container_hostname_dns(monkeypatch):
    # The private listener needs a bind address, not reverse DNS. Native runtime
    # hostnames may exceed DNS label limits even though TCP is fully usable.
    def unavailable_dns(*_):
        raise UnicodeError('encoding with idna codec failed: label too long')
    monkeypatch.setattr('socket.getfqdn', unavailable_dns)
    with health_server('0') as health:
        with urlopen(f'http://127.0.0.1:{health.port}/health') as response:
            assert response.status == 200
