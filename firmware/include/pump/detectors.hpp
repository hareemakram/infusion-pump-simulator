// SPDX-License-Identifier: MIT
// Independent, individually testable alarm detectors.
#pragma once

#include <deque>
#include <optional>
#include <string>

#include "pump/types.hpp"

namespace pump {

/// True once `condition` has held continuously for at least `hold_ms`.
class Debouncer {
 public:
  explicit Debouncer(TimeMs hold_ms) : hold_ms_(hold_ms) {}
  bool update(bool condition, TimeMs now);
  void reset();
  [[nodiscard]] bool active() const { return active_; }

 private:
  TimeMs hold_ms_;
  std::optional<TimeMs> since_;
  bool active_{false};
};

/// SRS-030..SRS-032.
class OcclusionDetector {
 public:
  struct Result {
    bool downstream{false};
    bool upstream{false};
  };

  explicit OcclusionDetector(OcclusionSensitivity s = OcclusionSensitivity::Medium);
  Result update(const SensorFrame& f);
  void reset();
  void set_sensitivity(OcclusionSensitivity s) { sensitivity_ = s; }
  [[nodiscard]] OcclusionSensitivity sensitivity() const { return sensitivity_; }
  [[nodiscard]] double threshold_mmhg() const;

 private:
  OcclusionSensitivity sensitivity_;
  Debouncer downstream_;
  Debouncer upstream_;
};

/// SRS-033, SRS-034.
class AirInLineDetector {
 public:
  /// Returns true when the frame's bubble or the cumulative air volume is alarming.
  bool update(double air_ul, TimeMs now);
  void reset();
  [[nodiscard]] double cumulative_ul() const { return cumulative_; }

 private:
  std::deque<std::pair<TimeMs, double>> window_;
  double cumulative_{0.0};
};

/// Compares commanded motor steps with encoder feedback (SRS-036, SRS-037).
class FlowMonitor {
 public:
  struct Result {
    bool stalled{false};
    bool over_delivery{false};
  };

  Result update(TimeMs now, double commanded_steps, double delivered_steps);
  void reset();
  [[nodiscard]] double window_commanded() const { return sum_cmd_; }
  [[nodiscard]] double window_delivered() const { return sum_del_; }

 private:
  struct Sample {
    TimeMs t;
    double cmd;
    double del;
  };
  std::deque<Sample> window_;
  double sum_cmd_{0.0};
  double sum_del_{0.0};
  double since_motion_{0.0};
};

/// SRS-050, SRS-051, SRS-054.
class SensorPlausibility {
 public:
  /// Returns a reason when the frame is implausible.
  std::optional<std::string> check(const SensorFrame& f, bool motor_running);
  void reset();

 private:
  std::optional<SensorFrame> prev_;
  int identical_count_{0};
};

}  // namespace pump
