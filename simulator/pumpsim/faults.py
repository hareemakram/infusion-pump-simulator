"""Fault catalog and injector for the hardware simulator."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class FaultSpec:
    id: str
    label: str
    group: str
    description: str
    expected_alarm: str
    pulse: bool = False                      # one-shot: clears itself after injection
    params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "label": self.label, "group": self.group, "description": self.description,
            "expected_alarm": self.expected_alarm, "pulse": self.pulse, "params": dict(self.params),
        }


CATALOG: tuple[FaultSpec, ...] = (
    FaultSpec("downstream_occlusion", "Downstream occlusion", "Fluid path",
              "Closed clamp or kinked line between pump and patient. Pressure builds until the alarm.",
              "DOWNSTREAM_OCCLUSION", params={"severity": "complete"}),
    FaultSpec("upstream_occlusion", "Upstream occlusion", "Fluid path",
              "Closed roller clamp above the pump. The mechanism pulls a vacuum.",
              "UPSTREAM_OCCLUSION"),
    FaultSpec("air_bubble", "Air bubble", "Fluid path",
              "A single bubble passes the ultrasonic air detector.",
              "AIR_IN_LINE", pulse=True, params={"volume_ul": 80.0}),
    FaultSpec("micro_bubbles", "Micro-bubbles", "Fluid path",
              "Outgassing: 30 uL bubbles every 2 s. Each is below the single-bubble limit.",
              "AIR_IN_LINE", params={"volume_ul": 30.0, "interval_s": 2.0}),
    FaultSpec("container_dry", "Container runs dry", "Fluid path",
              "Container drops to 12 mL and empties. Clearing hangs a new 250 mL bag.",
              "RESERVOIR_EMPTY", params={"remaining_ml": 12.0}),
    FaultSpec("motor_stall", "Motor stall", "Mechanism",
              "The pumping mechanism jams. The encoder stops counting.", "MOTOR_STALL"),
    FaultSpec("motor_runaway", "Motor runaway", "Mechanism",
              "Driver failure: the motor turns at 3x the command, and keeps turning when disabled.",
              "OVER_DELIVERY"),
    FaultSpec("pressure_frozen", "Pressure sensor frozen", "Sensors",
              "The downstream pressure reading stops updating.", "SENSOR_FAULT"),
    FaultSpec("pressure_rail", "Pressure sensor at rail", "Sensors",
              "The ADC saturates and reports an impossible pressure.", "SENSOR_FAULT"),
    FaultSpec("comms_dropout", "Sensor link dropout", "Communication",
              "Sensor frames stop reaching the controller.", "COMMUNICATION_LOSS"),
)

BY_ID = {f.id: f for f in CATALOG}


class FaultInjector:
    """Holds the set of active faults and their parameters."""

    def __init__(self) -> None:
        self._active: dict[str, dict[str, Any]] = {}
        self._pending_pulses: list[tuple[str, dict[str, Any]]] = []

    def inject(self, fault_id: str, **params: Any) -> FaultSpec:
        spec = BY_ID.get(fault_id)
        if spec is None:
            raise KeyError(f"unknown fault {fault_id!r}")
        merged = {**spec.params, **params}
        if spec.pulse:
            self._pending_pulses.append((fault_id, merged))
        else:
            self._active[fault_id] = merged
        return spec

    def clear(self, fault_id: str) -> None:
        if fault_id not in BY_ID:
            raise KeyError(f"unknown fault {fault_id!r}")
        self._active.pop(fault_id, None)

    def clear_all(self) -> None:
        self._active.clear()
        self._pending_pulses.clear()

    def active(self, fault_id: str) -> bool:
        return fault_id in self._active

    def params(self, fault_id: str) -> dict[str, Any]:
        return self._active.get(fault_id, {})

    def take_pulses(self) -> list[tuple[str, dict[str, Any]]]:
        pulses, self._pending_pulses = self._pending_pulses, []
        return pulses

    @property
    def active_ids(self) -> list[str]:
        return list(self._active)
