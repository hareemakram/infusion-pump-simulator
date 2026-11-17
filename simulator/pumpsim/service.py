"""Python service between the touchscreen UI and the C++ firmware.

Standard library only. Runs the test bench in real time (or faster) on a
background thread and exposes:

  GET  /api/health            liveness and firmware identity
  GET  /api/library           drug library, as reported by the firmware
  GET  /api/faults            fault catalog
  GET  /api/state             full snapshot including trend history
  GET  /api/stream            Server-Sent Events, one snapshot per 100 ms
  POST /api/command           {"command": "START", "args": {...}}
  POST /api/faults            {"fault": "air_bubble", "action": "inject"|"clear", "params": {...}}
  POST /api/sim               {"speed": 1|2|5|10} or {"action": "restart"}

Everything else is served from ui/dist (the built React app).
"""

from __future__ import annotations

import json
import mimetypes
import queue
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .bench import CYCLE_MS, TestBench
from .faults import BY_ID
from .firmware import REPO_ROOT, FirmwareError

ALLOWED_COMMANDS = {"PROGRAM", "PRIME", "START", "PAUSE", "STOP", "TITRATE", "ACK", "SILENCE", "SENS", "RESET"}
ALLOWED_SPEEDS = (1, 2, 5, 10, 20)
UI_DIST = REPO_ROOT / "ui" / "dist"


class Simulation:
    """Owns the bench and the real-time loop. All bench access goes through the lock."""

    def __init__(self, firmware: str | Path | None = None, speed: int = 1, seed: int = 7):
        self._firmware = firmware
        self._seed = seed
        self.lock = threading.RLock()
        self.bench = TestBench(firmware, seed=seed)
        self.speed = speed
        self.running = False
        self._subscribers: list[queue.Queue[str]] = []
        self._thread: threading.Thread | None = None

    # -- loop --------------------------------------------------------------
    def start(self) -> None:
        self.running = True
        self._thread = threading.Thread(target=self._loop, name="sim-loop", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        if self._thread:
            self._thread.join(timeout=2)
        with self.lock:
            self.bench.close()

    def _loop(self) -> None:
        period = CYCLE_MS / 1000.0
        next_t = time.monotonic()
        last_event = 0
        while self.running:
            with self.lock:
                try:
                    for _ in range(self.speed):
                        self.bench.step()
                    snap = self.bench.snapshot(events_after=last_event)
                    last_event = snap["last_event_id"]
                except FirmwareError as exc:  # pragma: no cover - firmware crash
                    snap = {"error": str(exc)}
                    self.running = False
                snap["speed"] = self.speed
            self._publish(json.dumps(snap))
            next_t += period
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_t = time.monotonic()

    # -- pub/sub -----------------------------------------------------------
    def subscribe(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue(maxsize=50)
        with self.lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue[str]) -> None:
        with self.lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _publish(self, payload: str) -> None:
        with self.lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass  # slow client: drop frames rather than block the control loop

    # -- API operations ----------------------------------------------------
    def state(self) -> dict[str, Any]:
        with self.lock:
            snap = self.bench.snapshot(history=True, events_after=0)
            snap["speed"] = self.speed
            return snap

    def command(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        name = name.upper()
        if name not in ALLOWED_COMMANDS:
            raise ValueError(f"unknown command {name}")
        clean: dict[str, Any] = {}
        for k, v in args.items():
            if k not in {"drug", "rate", "vtbi", "weight", "confirm", "level"}:
                raise ValueError(f"unexpected argument {k}")
            if isinstance(v, bool):
                clean[k] = int(v)
            elif isinstance(v, (int, float)):
                clean[k] = v
            elif isinstance(v, str) and v.replace("_", "").isalnum():
                clean[k] = v
            elif v is None:
                continue
            else:
                raise ValueError(f"invalid value for {k}")
        with self.lock:
            resp = self.bench.command(name, **clean)
            return {"response": resp.to_dict(), "status": self.bench.status.to_dict()}

    def fault(self, fault_id: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
        if fault_id not in BY_ID:
            raise ValueError(f"unknown fault {fault_id}")
        with self.lock:
            if action == "inject":
                self.bench.inject(fault_id, **params)
            elif action == "clear":
                self.bench.clear(fault_id)
            else:
                raise ValueError("action must be inject or clear")
            return {"faults": self.bench.faults.active_ids}

    def set_speed(self, speed: int) -> None:
        if speed not in ALLOWED_SPEEDS:
            raise ValueError(f"speed must be one of {ALLOWED_SPEEDS}")
        with self.lock:
            self.speed = speed

    def restart(self) -> None:
        with self.lock:
            self.bench.close()
            self.bench = TestBench(self._firmware, seed=self._seed)


def make_handler(sim: Simulation, static_dir: Path = UI_DIST) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "pumpsim/1.0"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:  # quiet by default
            pass

        # -- helpers ------------------------------------------------------
        def _json(self, obj: Any, status: int = 200) -> None:
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 64 * 1024:
                raise ValueError("request too large")
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw or b"{}")
            if not isinstance(data, dict):
                raise ValueError("expected a JSON object")
            return data

        # -- routes -------------------------------------------------------
        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/api/health":
                with sim.lock:
                    self._json({"ok": True, "firmware": sim.bench.fw.hello, "library": sim.bench.library_version})
            elif path == "/api/library":
                with sim.lock:
                    self._json({"version": sim.bench.library_version,
                                "drugs": [d.to_dict() for d in sim.bench.library]})
            elif path == "/api/faults":
                with sim.lock:
                    self._json({"catalog": sim.bench.catalog(), "active": sim.bench.faults.active_ids})
            elif path == "/api/state":
                self._json(sim.state())
            elif path == "/api/stream":
                self._stream()
            elif path.startswith("/api/"):
                self._json({"error": "not found"}, 404)
            else:
                self._static(path)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            try:
                body = self._body()
                if path == "/api/command":
                    self._json(sim.command(str(body.get("command", "")), dict(body.get("args") or {})))
                elif path == "/api/faults":
                    self._json(sim.fault(str(body.get("fault", "")), str(body.get("action", "")),
                                         dict(body.get("params") or {})))
                elif path == "/api/sim":
                    if body.get("action") == "restart":
                        sim.restart()
                    if "speed" in body:
                        sim.set_speed(int(body["speed"]))
                    self._json({"speed": sim.speed})
                else:
                    self._json({"error": "not found"}, 404)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                self._json({"error": str(exc)}, 400)

        def _stream(self) -> None:
            q = sim.subscribe()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                while sim.running:
                    try:
                        payload = q.get(timeout=1.0)
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        continue
                    self.wfile.write(b"data: " + payload.encode() + b"\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                sim.unsubscribe(q)
                self.close_connection = True

        def _static(self, path: str) -> None:
            if not static_dir.exists():
                msg = (b"UI not built. Run `npm ci && npm run build` in ui/, "
                       b"or use the dev server (npm run dev).")
                self.send_response(HTTPStatus.SERVICE_UNAVAILABLE)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
                return
            root = static_dir.resolve()
            target = (root / path.lstrip("/")).resolve()
            if root not in target.parents and target != root:
                self._json({"error": "forbidden"}, 403)
                return
            if not target.is_file():
                target = root / "index.html"  # SPA fallback
            data = target.read_bytes()
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            if "/assets/" in path:
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(data)

    return Handler


def serve(host: str = "127.0.0.1", port: int = 8000, firmware: str | None = None, speed: int = 1) -> None:
    sim = Simulation(firmware, speed=speed)
    sim.start()
    server = ThreadingHTTPServer((host, port), make_handler(sim))
    server.daemon_threads = True
    print(f"Infusion pump simulator running at http://{host}:{port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        sim.stop()
