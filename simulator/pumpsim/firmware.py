"""Runs the C++ firmware as a child process and speaks the HAL protocol to it."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .protocol import Drug, Event, Response, Status, format_command, format_sensor

REPO_ROOT = Path(__file__).resolve().parents[2]


class FirmwareError(RuntimeError):
    pass


def find_firmware() -> Path:
    """Locate the pump_firmware binary (PUMP_FIRMWARE overrides the search)."""
    env = os.environ.get("PUMP_FIRMWARE")
    if env:
        return Path(env)
    exe = "pump_firmware.exe" if os.name == "nt" else "pump_firmware"
    candidates = [
        REPO_ROOT / "build" / "firmware" / exe,
        REPO_ROOT / "build" / "firmware" / "Release" / exe,
        REPO_ROOT / "build" / "firmware" / "Debug" / exe,
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FirmwareError(
        "pump_firmware not found. Build it with `cmake -S . -B build && cmake --build build` "
        "or set PUMP_FIRMWARE."
    )


@dataclass
class Reply:
    lines: list[str]
    events: list[Event]


class FirmwareProcess:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else find_firmware()
        self._proc = subprocess.Popen(
            [str(self.path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        hello = self._readline()
        if not hello.startswith("HELLO"):
            raise FirmwareError(f"unexpected greeting {hello!r}")
        self.hello = hello

    # -- low level -----------------------------------------------------------
    def _readline(self) -> str:
        assert self._proc.stdout is not None
        line = self._proc.stdout.readline()
        if not line:
            raise FirmwareError("firmware process exited")
        return line.rstrip("\n")

    def _write(self, line: str) -> None:
        assert self._proc.stdin is not None
        try:
            self._proc.stdin.write(line + "\n")
            self._proc.stdin.flush()
        except BrokenPipeError as exc:  # pragma: no cover - only if the child dies
            raise FirmwareError("firmware process exited") from exc

    def _transact(self, line: str, terminal: tuple[str, ...]) -> Reply:
        self._write(line)
        lines: list[str] = []
        events: list[Event] = []
        while True:
            out = self._readline()
            if out.startswith("EVT "):
                events.append(Event.parse(out))
                continue
            lines.append(out)
            if out.startswith(terminal) or out.startswith("ERR"):
                return Reply(lines, events)

    # -- HAL -----------------------------------------------------------------
    def send_sensor(self, t_ms: int, pd: float, pu: float, air_ul: float, reservoir_ml: float, encoder: int) -> None:
        self._write(format_sensor(t_ms, pd, pu, air_ul, reservoir_ml, encoder))

    def tick(self, t_ms: int) -> tuple[Status, list[Event]]:
        reply = self._transact(f"TICK t={t_ms}", ("STATUS",))
        last = reply.lines[-1]
        if last.startswith("ERR"):
            raise FirmwareError(last)
        return Status.parse(last), reply.events

    def command(self, name: str, **args: Any) -> tuple[Response, list[Event]]:
        reply = self._transact(format_command(name, **args), ("RESP",))
        last = reply.lines[-1]
        if last.startswith("ERR"):
            raise FirmwareError(last)
        return Response.parse(last), reply.events

    def status(self) -> tuple[Status, list[Event]]:
        reply = self._transact("CMD STATUS", ("STATUS",))
        return Status.parse(reply.lines[-1]), reply.events

    def library(self) -> tuple[str, list[Drug]]:
        reply = self._transact("CMD LIBRARY", ("RESP",))
        version = ""
        drugs = []
        for line in reply.lines:
            if line.startswith("LIBVER"):
                version = line.split("version=", 1)[1]
            elif line.startswith("DRUG "):
                drugs.append(Drug.parse(line))
        return version, drugs

    def raw(self, line: str) -> list[str]:
        """Send an arbitrary line and return whatever comes back (test helper)."""
        self._write(line)
        return [self._readline()]

    def close(self) -> None:
        if self._proc.poll() is None:
            try:
                self._write("QUIT")
                self._proc.wait(timeout=2)
            except Exception:  # pragma: no cover - defensive cleanup
                self._proc.kill()
        for stream in (self._proc.stdin, self._proc.stdout):
            if stream:
                stream.close()

    def __enter__(self) -> "FirmwareProcess":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
