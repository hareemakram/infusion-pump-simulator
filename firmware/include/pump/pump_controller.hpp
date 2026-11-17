// SPDX-License-Identifier: MIT
#pragma once

#include <optional>
#include <string>

#include "pump/alarm_manager.hpp"
#include "pump/detectors.hpp"
#include "pump/drug_library.hpp"
#include "pump/event_log.hpp"
#include "pump/types.hpp"

namespace pump {

struct CommandResult {
  bool ok{false};
  std::string reason;

  static CommandResult accept() { return {true, {}}; }
  static CommandResult reject(std::string why) { return {false, std::move(why)}; }
};

/// The pump's control software: state machine, delivery accounting and
/// alarm response. It is driven entirely by the HAL:
///   on_sensor_frame() once per control cycle, then tick(), which returns
///   the motor command for the next cycle.
class PumpController {
 public:
  explicit PumpController(DrugLibrary library = DrugLibrary::standard());

  // Operator commands -----------------------------------------------------
  CommandResult program(const InfusionProgram& p, bool confirm_soft_limit, TimeMs now);
  CommandResult prime(TimeMs now);
  CommandResult start(TimeMs now);
  CommandResult pause(TimeMs now);
  CommandResult stop(TimeMs now);
  CommandResult titrate(double rate_ml_h, bool confirm_soft_limit, TimeMs now);
  CommandResult acknowledge(TimeMs now);
  CommandResult silence(TimeMs now);
  CommandResult set_sensitivity(OcclusionSensitivity s, TimeMs now);
  /// Simulated power cycle. The only way out of State::Fault (SRS-053).
  void reset(TimeMs now);

  // HAL interface ---------------------------------------------------------
  void on_sensor_frame(const SensorFrame& f);
  MotorCommand tick(TimeMs now);

  // Observers -------------------------------------------------------------
  [[nodiscard]] State state() const { return state_; }
  [[nodiscard]] bool primed() const { return primed_; }
  [[nodiscard]] const std::optional<InfusionProgram>& program() const { return program_; }
  [[nodiscard]] const Drug* drug() const;
  [[nodiscard]] double dose() const;
  [[nodiscard]] double infused_ml() const { return infused_ml_; }
  [[nodiscard]] double prime_ml() const { return prime_ml_; }
  [[nodiscard]] double remaining_ml() const;
  /// Seconds until VTBI is reached at the programmed rate, if infusing.
  [[nodiscard]] std::optional<double> time_remaining_s() const;
  [[nodiscard]] double active_rate_ml_h() const;
  [[nodiscard]] MotorCommand motor() const { return motor_; }
  [[nodiscard]] const AlarmManager& alarms() const { return alarms_; }
  [[nodiscard]] const EventLog& log() const { return log_; }
  [[nodiscard]] const DrugLibrary& library() const { return library_; }
  [[nodiscard]] const OcclusionDetector& occlusion() const { return occlusion_; }
  [[nodiscard]] const std::optional<SensorFrame>& last_frame() const { return last_frame_; }
  [[nodiscard]] double air_cumulative_ul() const { return air_.cumulative_ul(); }
  [[nodiscard]] TimeMs now() const { return last_tick_.value_or(0); }

 private:
  void transition(State next, TimeMs now, const std::string& why);
  void raise(AlarmId id, bool present, TimeMs now);
  void enter_alarm_state(TimeMs now);
  void update_motor_command();
  CommandResult validate_and_log(const InfusionProgram& p, bool confirm, TimeMs now,
                                 const char* action);
  CommandResult reject(TimeMs now, const std::string& cmd, std::string why);

  DrugLibrary library_;
  AlarmManager alarms_;
  EventLog log_;
  OcclusionDetector occlusion_;
  AirInLineDetector air_;
  FlowMonitor flow_;
  SensorPlausibility plausibility_;

  State state_{State::Idle};
  State resume_state_{State::Idle};    // where to go after an acknowledged alarm
  State pre_prime_state_{State::Idle};
  std::optional<InfusionProgram> program_;
  bool primed_{false};
  double infused_ml_{0.0};
  double prime_ml_{0.0};
  MotorCommand motor_{};

  std::optional<SensorFrame> last_frame_;
  std::optional<TimeMs> last_tick_;
  TimeMs last_frame_rx_{0};
  TimeMs paused_since_{0};
  double pending_delivered_steps_{0.0};
};

}  // namespace pump
