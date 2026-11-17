"""Physical model of the pump hardware and fluid path.

Lumped-parameter model, integrated with explicit Euler at the 100 ms control period:

  container --R_up--> [upstream segment, C_up] --pump--> [downstream segment, C] --R--> patient

Pressures are in mmHg, volumes in mL, time in seconds.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from .faults import FaultInjector


@dataclass
class PlantParams:
    steps_per_ml: float = 2000.0
    compliance_down: float = 0.001        # mL/mmHg, tubing + cannula
    resistance_down: float = 500.0        # mmHg*s/mL, cannula + vein
    venous_pressure: float = 8.0          # mmHg
    head_pressure: float = 40.0           # container ~55 cm above the pump
    compliance_up: float = 0.002
    resistance_up: float = 300.0
    cavitation_pressure: float = -300.0   # below this the mechanism moves gas, not fluid
    max_pressure: float = 1400.0          # mechanism force limit
    partial_occlusion_factor: float = 25.0
    noise_mmhg: float = 0.6
    container_ml: float = 250.0
    runaway_gain: float = 3.0
    runaway_idle_sps: float = 60.0
    rail_reading_mmhg: float = 2047.5


@dataclass
class Frame:
    t_ms: int
    downstream: float
    upstream: float
    air_ul: float
    reservoir_ml: float
    encoder: int


class Plant:
    def __init__(self, params: PlantParams | None = None, seed: int = 7) -> None:
        self.p = params or PlantParams()
        self.rng = random.Random(seed)
        self.t_ms = 0
        self.encoder = 0
        self._step_frac = 0.0
        self.reservoir_ml = self.p.container_ml
        self.p_down = self.p.venous_pressure
        self.p_up = self.p.head_pressure
        self.delivered_to_patient_ml = 0.0   # ground truth, independent of the firmware
        self.air_to_patient_ul = 0.0
        self.flow_ml_h = 0.0
        self._frozen_reading: float | None = None
        self._micro_timer = 0.0

    # ------------------------------------------------------------------
    def step(self, dt_s: float, motor_enabled: bool, steps_per_s: float, faults: FaultInjector) -> Frame | None:
        """Advance the plant by dt_s under the given motor command.

        Returns the sensor frame, or None when the sensor link is down.
        """
        p = self.p
        self.t_ms += int(round(dt_s * 1000))

        # Pulse faults ------------------------------------------------------
        air_ul = 0.0
        for fault_id, params in faults.take_pulses():
            if fault_id == "air_bubble":
                air_ul += float(params.get("volume_ul", 80.0))

        if faults.active("container_dry"):
            remaining = float(faults.params("container_dry").get("remaining_ml", 12.0))
            if not faults.params("container_dry").get("_applied"):
                self.reservoir_ml = min(self.reservoir_ml, remaining)
                faults.params("container_dry")["_applied"] = True

        # Motor ----------------------------------------------------------------
        sps = steps_per_s if motor_enabled else 0.0
        if faults.active("motor_runaway"):
            sps = max(sps * p.runaway_gain, p.runaway_idle_sps)
        if faults.active("motor_stall"):
            sps = 0.0
        self._step_frac += sps * dt_s
        steps = int(math.floor(self._step_frac))
        self._step_frac -= steps
        self.encoder += steps
        displaced_ml = steps / p.steps_per_ml

        # Upstream segment ----------------------------------------------------
        moving_fluid = self.p_up > p.cavitation_pressure
        pumped_ml = displaced_ml if moving_fluid else 0.0
        if faults.active("upstream_occlusion") or self.reservoir_ml <= 0.0:
            q_supply = 0.0
        else:
            q_supply = (p.head_pressure - self.p_up) / p.resistance_up
        supply_ml = q_supply * dt_s
        if supply_ml > 0:
            supply_ml = min(supply_ml, self.reservoir_ml)
            self.reservoir_ml -= supply_ml
        self.p_up += (supply_ml - pumped_ml) / p.compliance_up
        self.p_up = max(self.p_up, p.cavitation_pressure - 100.0)
        if self.reservoir_ml <= 0.0:
            self.reservoir_ml = 0.0
            # Container empty: the mechanism now pumps air.
            air_ul += displaced_ml * 1000.0
            pumped_ml = 0.0
            self.p_up = min(self.p_up, p.head_pressure)

        # Micro-bubbles -----------------------------------------------------
        if faults.active("micro_bubbles") and pumped_ml > 0:
            mb = faults.params("micro_bubbles")
            self._micro_timer += dt_s
            if self._micro_timer >= float(mb.get("interval_s", 2.0)):
                self._micro_timer = 0.0
                air_ul += float(mb.get("volume_ul", 30.0))

        # Downstream segment --------------------------------------------------
        r = p.resistance_down
        if faults.active("downstream_occlusion"):
            severity = faults.params("downstream_occlusion").get("severity", "complete")
            r = math.inf if severity == "complete" else r * p.partial_occlusion_factor
        q_out = 0.0 if math.isinf(r) else max(0.0, (self.p_down - p.venous_pressure) / r)
        out_ml = q_out * dt_s
        in_ml = pumped_ml + air_ul / 1000.0
        self.p_down += (in_ml - out_ml) / p.compliance_down
        self.p_down = min(max(self.p_down, p.venous_pressure - 5.0), p.max_pressure)
        self.delivered_to_patient_ml += out_ml
        self.air_to_patient_ul += air_ul
        self.flow_ml_h = out_ml / dt_s * 3600.0 if dt_s > 0 else 0.0

        # Sensors -------------------------------------------------------------
        pd = round(self.p_down + self.rng.gauss(0.0, p.noise_mmhg), 1)
        pu = round(self.p_up + self.rng.gauss(0.0, p.noise_mmhg), 1)
        if faults.active("pressure_frozen"):
            if self._frozen_reading is None:
                self._frozen_reading = pd
            pd = self._frozen_reading
        else:
            self._frozen_reading = None
        if faults.active("pressure_rail"):
            pd = p.rail_reading_mmhg

        if faults.active("comms_dropout"):
            return None
        return Frame(self.t_ms, pd, pu, round(air_ul, 1), round(self.reservoir_ml, 3), self.encoder)

    def hang_new_container(self, volume_ml: float | None = None) -> None:
        self.reservoir_ml = volume_ml if volume_ml is not None else self.p.container_ml
        self.p_up = self.p.head_pressure
