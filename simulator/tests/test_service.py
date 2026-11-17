"""Tests for the HTTP/SSE service that the touchscreen UI talks to."""

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from pumpsim.service import Simulation, make_handler

pytestmark = pytest.mark.system


@pytest.fixture
def server(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>ui</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    sim = Simulation(speed=10)
    sim.start()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(sim, tmp_path))
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", sim
    httpd.shutdown()
    sim.stop()


def get(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.status, r.headers, r.read()


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health_library_and_catalog(server):
    base, _ = server
    status, _, body = get(base + "/api/health")
    assert status == 200 and json.loads(body)["firmware"].startswith("HELLO")
    drugs = json.loads(get(base + "/api/library")[2])["drugs"]
    assert {d["id"] for d in drugs} >= {"saline", "heparin", "propofol"}
    catalog = json.loads(get(base + "/api/faults")[2])["catalog"]
    assert any(f["id"] == "air_bubble" for f in catalog)


@pytest.mark.req("SRS-070")
def test_command_round_trip_and_validation(server):
    base, _ = server
    code, body = post(base + "/api/command", {"command": "PROGRAM",
                                              "args": {"drug": "heparin", "rate": 25, "vtbi": 100}})
    assert code == 200 and body["response"]["needs_confirmation"]
    code, body = post(base + "/api/command", {"command": "PROGRAM",
                                              "args": {"drug": "heparin", "rate": 25, "vtbi": 100, "confirm": True}})
    assert body["response"]["ok"] and body["status"]["state"] == "READY"
    assert post(base + "/api/command", {"command": "SELF_DESTRUCT"})[0] == 400
    assert post(base + "/api/command", {"command": "PROGRAM", "args": {"drug": "x rate=1"}})[0] == 400
    assert post(base + "/api/command", {"command": "PROGRAM", "args": {"evil": 1}})[0] == 400
    assert post(base + "/api/nope", {})[0] == 404


def test_fault_injection_and_speed(server):
    base, _ = server
    code, body = post(base + "/api/faults", {"fault": "motor_stall", "action": "inject"})
    assert code == 200 and body["faults"] == ["motor_stall"]
    code, body = post(base + "/api/faults", {"fault": "motor_stall", "action": "clear"})
    assert body["faults"] == []
    assert post(base + "/api/faults", {"fault": "gremlins", "action": "inject"})[0] == 400
    assert post(base + "/api/faults", {"fault": "motor_stall", "action": "explode"})[0] == 400
    assert post(base + "/api/sim", {"speed": 5}) == (200, {"speed": 5})
    assert post(base + "/api/sim", {"speed": 7})[0] == 400


def test_state_snapshot_contains_history(server):
    base, sim = server
    state = json.loads(get(base + "/api/state")[2])
    assert {"status", "plant", "history", "events", "faults", "speed"} <= state.keys()
    assert state["status"]["state"] == "IDLE"
    post(base + "/api/sim", {"action": "restart"})
    assert json.loads(get(base + "/api/state")[2])["t"] < 5_000


def test_event_stream_pushes_snapshots(server):
    base, _ = server
    with urllib.request.urlopen(base + "/api/stream", timeout=5) as r:
        assert r.headers["Content-Type"] == "text/event-stream"
        line = b""
        while not line.startswith(b"data: "):
            line = r.readline()
        snap = json.loads(line[6:])
        assert "status" in snap and "sample" in snap


def test_static_files_and_spa_fallback(server):
    base, _ = server
    status, headers, body = get(base + "/assets/app.js")
    assert status == 200 and "immutable" in headers["Cache-Control"]
    status, _, body = get(base + "/some/client/route")
    assert b"<title>ui</title>" in body
    with pytest.raises(urllib.error.HTTPError) as exc:
        get(base + "/../../etc/passwd")
    assert exc.value.code == 403  # path traversal never escapes the UI root
    with pytest.raises(urllib.error.HTTPError):
        get(base + "/api/unknown")
