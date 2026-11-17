"""Scripted fault scenarios. Each one starts an infusion, injects a fault and
measures how the firmware responds. Used by the CLI and to generate
docs/generated/fault-response-report.md."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .bench import TestBench


@dataclass
class ScenarioResult:
    name: str
    fault: str
    rate_ml_h: float
    expected_alarm: str
    detected: bool
    detect_s: float | None
    final_state: str
    motor_stopped: bool
    note: str = ""

    @property
    def passed(self) -> bool:
        return self.detected and self.motor_stopped


@dataclass
class Scenario:
    name: str
    fault: str
    expected_alarm: str
    rate_ml_h: float = 100.0
    timeout_s: float = 300.0
    setup: Callable[[TestBench], None] | None = None
    params: dict | None = None


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("Downstream occlusion, 25 mL/h", "downstream_occlusion", "DOWNSTREAM_OCCLUSION", 25.0),
    Scenario("Downstream occlusion, 100 mL/h", "downstream_occlusion", "DOWNSTREAM_OCCLUSION", 100.0),
    Scenario("Downstream occlusion, 100 mL/h, high sensitivity", "downstream_occlusion", "DOWNSTREAM_OCCLUSION",
             100.0, setup=lambda b: b.command("SENS", level="HIGH")),
    Scenario("Partial downstream occlusion, 250 mL/h", "downstream_occlusion", "DOWNSTREAM_OCCLUSION", 250.0,
             params={"severity": "partial"}),
    Scenario("Upstream occlusion, 100 mL/h", "upstream_occlusion", "UPSTREAM_OCCLUSION", 100.0),
    Scenario("Single 80 uL air bubble", "air_bubble", "AIR_IN_LINE", 100.0),
    Scenario("Micro-bubbles (30 uL every 2 s)", "micro_bubbles", "AIR_IN_LINE", 100.0, timeout_s=600.0),
    Scenario("Container runs dry, 400 mL/h", "container_dry", "RESERVOIR_EMPTY", 400.0),
    Scenario("Motor stall, 100 mL/h", "motor_stall", "MOTOR_STALL", 100.0),
    Scenario("Motor runaway, 5 mL/h", "motor_runaway", "OVER_DELIVERY", 5.0),
    Scenario("Pressure sensor frozen", "pressure_frozen", "SENSOR_FAULT", 100.0),
    Scenario("Pressure sensor at rail", "pressure_rail", "SENSOR_FAULT", 100.0),
    Scenario("Sensor link dropout", "comms_dropout", "COMMUNICATION_LOSS", 100.0),
)


def run_scenario(sc: Scenario, firmware: str | Path | None = None) -> ScenarioResult:
    with TestBench(firmware) as bench:
        if sc.setup:
            sc.setup(bench)
        bench.start_infusion("saline", sc.rate_ml_h, 500.0, confirm=True)
        bench.run(5.0)  # settle
        bench.inject(sc.fault, **(sc.params or {}))
        elapsed = bench.run_until(lambda s: s.has_alarm(sc.expected_alarm), sc.timeout_s)
        bench.step()  # one more cycle so the motor command reflects the alarm
        note = ""
        if sc.fault == "container_dry":
            note = f"air reaching patient line: {bench.plant.air_to_patient_ul:.0f} uL"
        return ScenarioResult(
            name=sc.name, fault=sc.fault, rate_ml_h=sc.rate_ml_h, expected_alarm=sc.expected_alarm,
            detected=elapsed is not None, detect_s=elapsed, final_state=bench.status.state,
            motor_stopped=not bench.status.motor_enabled, note=note,
        )


def run_all(firmware: str | Path | None = None) -> list[ScenarioResult]:
    return [run_scenario(sc, firmware) for sc in SCENARIOS]


def to_markdown(results: list[ScenarioResult]) -> str:
    lines = [
        "| Scenario | Expected alarm | Detected after | Final state | Motor stopped | Result |",
        "|---|---|---:|---|---|---|",
    ]
    for r in results:
        t = f"{r.detect_s:.1f} s" if r.detect_s is not None else "not detected"
        lines.append(
            f"| {r.name} | `{r.expected_alarm}` | {t} | {r.final_state} | {'yes' if r.motor_stopped else 'NO'} "
            f"| {'PASS' if r.passed else 'FAIL'} |"
        )
    return "\n".join(lines)
