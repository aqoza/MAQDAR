"""Private, payload-free liveness for the container supervisor."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
from time import monotonic


class Heartbeat:
    def __init__(self):
        self.last_poll = monotonic()
        self.port = None

    def touch(self):
        self.last_poll = monotonic()

    def status(self):
        return 200 if monotonic() - self.last_poll < 100 else 503


@contextmanager
def health_server(port: str):
    heartbeat = Heartbeat()
    if not port:
        yield heartbeat
        return

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            status = heartbeat.status() if self.path == '/health' else 404
            body = b'{"status":"ready"}' if status == 200 else b'{"status":"unavailable"}'
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('0.0.0.0', int(port)), Handler)
    heartbeat.port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True, name='simulation-health')
    thread.start()
    try:
        yield heartbeat
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
