"""Plazo real de Gemini: servidor local, sin API, credenciales ni cuota externas."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import weekly_report  # noqa: E402


@pytest.fixture
def gemini_server(monkeypatch):
    state = {"status": 200, "body": b'{"ok":true}', "mode": "normal", "requests": []}
    stop = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            state["requests"].append({
                "path": self.path,
                "key": self.headers.get("x-goog-api-key"),
                "body": json.loads(self.rfile.read(int(self.headers["Content-Length"]))),
            })
            if state["mode"] == "headers" and stop.wait(2):
                return
            body = state["body"]
            try:
                self.send_response(state["status"])
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if state["mode"] == "drip":
                    # Cada fragmento llega antes del timeout de socket, pero el
                    # conjunto supera ampliamente el plazo total de 250 ms.
                    for byte in body:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        if stop.wait(0.08):
                            return
                else:
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # El cliente debe cerrar la conexion al vencer el plazo.

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    monkeypatch.setattr(weekly_report, "GEMINI_BASE", f"http://127.0.0.1:{server.server_port}")
    thread.start()
    try:
        yield state
    finally:
        stop.set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize("status", [200, 503])
@pytest.mark.parametrize("mode", ["headers", "drip"])
def test_total_deadline_stops_slow_headers_and_bodies(gemini_server, status, mode):
    gemini_server.update(status=status, mode=mode, body=b'{"message":"respuesta lenta del proveedor"}')
    started = time.monotonic()
    with pytest.raises(weekly_report.WeeklyReportError) as error:
        weekly_report._generate_content("test", "dummy", "hola", grounded=False, json_output=False, timeout=0.25)
    elapsed = time.monotonic() - started
    assert elapsed < 1.0, f"El plazo de 0,25 s tardo {elapsed:.3f} s"
    assert weekly_report._is_transient_failure(error.value)
    assert gemini_server["requests"]


def test_successful_request_preserves_gemini_contract(gemini_server):
    result = weekly_report._generate_content("test", "dummy", "análisis", grounded=True, json_output=True, timeout=2)
    assert result == {"ok": True}
    request = gemini_server["requests"][0]
    assert request["path"] == "/models/test:generateContent"
    assert request["key"] == "dummy"
    assert request["body"]["contents"] == [{"parts": [{"text": "análisis"}]}]
    assert request["body"]["tools"] == [{"google_search": {}}]
    assert request["body"]["generationConfig"]["responseMimeType"] == "application/json"


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429, 500, 503])
def test_http_status_preserves_fallback_classification(gemini_server, status):
    gemini_server.update(status=status, body=b'{"error":"fallo de prueba"}')
    with pytest.raises(weekly_report.WeeklyReportError, match=f"HTTP {status}.*fallo de prueba") as error:
        weekly_report._generate_content("test", "dummy", "hola", grounded=False, json_output=False, timeout=2)
    assert error.value.status_code == status
    assert weekly_report._is_transient_failure(error.value) == (status in weekly_report.TRANSIENT_STATUS_CODES)


def test_malformed_json_is_not_retried_as_a_network_failure(gemini_server):
    gemini_server["body"] = b"no es JSON"
    with pytest.raises(weekly_report.WeeklyReportError) as error:
        weekly_report._generate_content("test", "dummy", "hola", grounded=False, json_output=False, timeout=2)
    assert not weekly_report._is_transient_failure(error.value)
