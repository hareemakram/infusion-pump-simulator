"""Test bench: closes the loop between the plant model and the firmware process."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .faults import BY_ID, CATALOG, FaultInjector
from .firmware import FirmwareProcess
from .plant import Plant, PlantParams
from .protocol import Drug, Event, Response, Status

CYCLE_MS = 100
HISTORY_SECONDS = 180


@dataclass
class Sample:
    t: int
    downstream: float
    upstream: float
    flow_ml_h: float

    def to_list(self) -> list[float]:
        return [self.t, round(self.downstream, 1), round(self.upstream, 1), round(self.flow_ml_h, 2)]


class TestBench:
    __test__ = False  # not a pytest class

    def __init__(self, firmware: str | Path | None = None, seed: int = 7, params: PlantParams | None = None):
        self._firmware_path = firmware
        self._seed = seed
        self._params = params
        self.faults = FaultInjector()
        self.plant = Plant(params, seed)
        self.fw = FirmwareProcess(firmware)
        self.library_version, self.library = self.fw.library()
        self.status, initial = self.fw.status()
        self.events: deque[dict[str, Any]] = deque(maxlen=500)
        self._event_id = 0
        self._add_events(initial)
        self.history: deque[Sample] = deque(maxlen=HISTORY_SECONDS * 1000 // CYCLE_MS)
        self.cycles = 0

    # -- simulation ----------------------------------------------------------
    @property
    def t_ms(self) -> int:
        return self.plant.t_ms

    def step(self) -> Status:
        frame = self.plant.step(
            CYCLE_MS / 1000.0, self.status.motor_enabled, self.status.steps_per_s, self.faults
        )
        if frame is not None:
            self.fw.send_sensor(frame.t_ms, frame.downstream, frame.upstream, frame.air_ul,
                                frame.reservoir_ml, frame.encoder)
        self.status, events = self.fw.tick(self.plant.t_ms)
        self._add_events(events)
        self.history.append(Sample(self.plant.t_ms, self.plant.p_down, self.plant.p_up, self.plant.flow_ml_h))
        self.cycles += 1
        return self.status

    def run(self, seconds: float) -> Status:
        for _ in range(int(round(seconds * 1000 / CYCLE_MS))):
            self.step()
        return self.status

    def run_until(self, predicate: Callable[[Status], bool], timeout_s: float) -> float | None:
        """Steps until predicate(status) holds. Returns elapsed simulated seconds, or None on timeout."""
        start = self.t_ms
        for _ in range(int(round(timeout_s * 1000 / CYCLE_MS))):
            if predicate(self.step()):
                return (self.t_ms - start) / 1000.0
        return None

    # -- operator ------------------------------------------------------------
    def command(self, name: str, **args: Any) -> Response:
        resp, events = self.fw.command(name, **args)
        self._add_events(events)
        self.status, more = self.fw.status()
        self._add_events(more)
        return resp

    def program(self, drug: str, rate: float, vtbi: float, weight: float | None = None,
                confirm: bool = False) -> Response:
        return self.command("PROGRAM", drug=drug, rate=rate, vtbi=vtbi, weight=weight, confirm=confirm)

    def prime(self, timeout_s: float = 30.0) -> bool:
        if not self.command("PRIME").ok:
            return False
        return self.run_until(lambda s: s.state != "PRIMING", timeout_s) is not None and self.status.primed

    def start_infusion(self, drug: str = "saline", rate: float = 100.0, vtbi: float = 50.0,
                       weight: float | None = None, confirm: bool = False) -> None:
        """Program, prime and start: the happy path used by most scenarios."""
        r = self.program(drug, rate, vtbi, weight, confirm)
        if not r.ok:
            raise RuntimeError(f"program rejected: {r.reason}")
        if not self.prime():
            raise RuntimeError("priming failed")
        r = self.command("START")
        if not r.ok:
            raise RuntimeError(f"start rejected: {r.reason}")
        self.step()

    # -- faults --------------------------------------------------------------
    def inject(self, fault_id: str, **params: Any) -> None:
        spec = self.faults.inject(fault_id, **params)
        self._add_events([Event(0, self.t_ms, "BENCH", f"Fault injected: {spec.label}")])

    def clear(self, fault_id: str) -> None:
        was_active = self.faults.active(fault_id)
        self.faults.clear(fault_id)
        if fault_id == "container_dry" and was_active:
            self.plant.hang_new_container()
        if was_active:
            self._add_events([Event(0, self.t_ms, "BENCH", f"Fault cleared: {BY_ID[fault_id].label}")])

    def _add_events(self, events: list[Event]) -> None:
        for e in events:
            self._event_id += 1
            self.events.append({"id": self._event_id, **e.to_dict()})

    def events_since(self, event_id: int) -> list[dict[str, Any]]:
        return [e for e in self.events if e["id"] > event_id]

    def has_event(self, kind: str, text: str) -> bool:
        return any(e["kind"] == kind and text in e["message"] for e in self.events)

    # -- views ---------------------------------------------------------------
    def drug(self, drug_id: str | None) -> Drug | None:
        return next((d for d in self.library if d.id == drug_id), None)

    def snapshot(self, history: bool = False, events_after: int = 0) -> dict[str, Any]:
        snap: dict[str, Any] = {
            "t": self.t_ms,
            "status": self.status.to_dict(),
            "plant": {
                "line_outflow_ml": round(self.plant.delivered_to_patient_ml, 4),
                "air_to_patient_ul": round(self.plant.air_to_patient_ul, 1),
                "downstream_true": round(self.plant.p_down, 1),
                "upstream_true": round(self.plant.p_up, 1),
                "reservoir_ml": round(self.plant.reservoir_ml, 2),
                "flow_ml_h": round(self.plant.flow_ml_h, 2),
            },
            "faults": self.faults.active_ids,
            "sample": self.history[-1].to_list() if self.history else None,
            "events": self.events_since(events_after),
            "last_event_id": self._event_id,
        }
        if history:
            snap["history"] = [s.to_list() for s in self.history]
        return snap

    def catalog(self) -> list[dict[str, Any]]:
        return [f.to_dict() for f in CATALOG]

    def close(self) -> None:
        self.fw.close()

    def __enter__(self) -> "TestBench":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
