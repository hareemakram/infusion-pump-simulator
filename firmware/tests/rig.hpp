// SPDX-License-Identifier: MIT
// Minimal ideal plant used by controller unit tests. The realistic plant
// with fault injection lives in the Python simulator.
#pragma once

#include <cmath>

#include "pump/config.hpp"
#include "pump/pump_controller.hpp"

namespace pump::test {

struct Rig {
  PumpController pump;
  TimeMs t{0};
  std::int64_t encoder{0};
  double fraction{0.0};
  double downstream{20.0};
  double upstream{5.0};
  double reservoir{250.0};
  double air_next{0.0};
  bool stall{false};
  double motor_gain{1.0};
  double uncommanded_sps{0.0};
  bool send_frames{true};
  int n{0};

  /// One 100 ms control cycle: plant moves, HAL sends a frame, controller ticks.
  void cycle() {
    t += 100;
    const MotorCommand m = pump.motor();
    double sps = m.enabled ? m.steps_per_s * motor_gain : uncommanded_sps;
    if (stall) sps = 0.0;
    fraction += sps * 0.1;
    const auto whole = static_cast<std::int64_t>(std::floor(fraction));
    fraction -= static_cast<double>(whole);
    encoder += whole;
    reservoir -= static_cast<double>(whole) / cfg::kStepsPerMl;
    if (send_frames) {
      // Alternating 0.1 mmHg noise keeps the frozen-sensor check quiet.
      const double noise = (n++ % 2) ? 0.1 : 0.0;
      pump.on_sensor_frame(SensorFrame{t, downstream + noise, upstream, air_next, reservoir, encoder});
      air_next = 0.0;
    }
    pump.tick(t);
  }

  void run_ms(TimeMs ms) {
    for (TimeMs i = 0; i < ms; i += 100) cycle();
  }

  CommandResult program(const char* drug, double rate, double vtbi, double weight = 0.0, bool confirm = false) {
    return pump.program(InfusionProgram{drug, rate, vtbi, weight}, confirm, t);
  }

  /// Programs saline, primes and leaves the pump Ready.
  void ready(double rate = 100.0, double vtbi = 50.0) {
    cycle();
    program("saline", rate, vtbi, 0.0, /*confirm=*/true);
    pump.prime(t);
    for (int i = 0; i < 400 && pump.state() == State::Priming; ++i) cycle();
  }

  void infusing(double rate = 100.0, double vtbi = 50.0) {
    ready(rate, vtbi);
    pump.start(t);
    cycle();
  }
};

}  // namespace pump::test
