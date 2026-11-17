// SPDX-License-Identifier: MIT
#include "pump/pump_controller.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "pump/config.hpp"

namespace pump {

namespace {
std::string fmt(double v) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%g", v);
  return buf;
}
}  // namespace

PumpController::PumpController(DrugLibrary library) : library_(std::move(library)) {
  log_.add(0, "SYSTEM", "Power on. Drug library " + library_.version());
}

// ---------------------------------------------------------------------------
// Helpers

void PumpController::transition(State next, TimeMs now, const std::string& why) {
  if (next == state_) return;
  log_.add(now, "STATE",
           std::string(to_string(state_)) + " -> " + std::string(to_string(next)) + " (" + why + ")");
  if (is_running(state_) != is_running(next)) flow_.reset();  // new commanded/actual baseline
  state_ = next;
  if (next == State::Paused) paused_since_ = now;
  update_motor_command();  // SRS-012: the motor command follows the state immediately.
}

void PumpController::raise(AlarmId id, bool present, TimeMs now) {
  if (alarms_.set_condition(id, present, now)) {
    log_.add(now, "ALARM",
             std::string(to_string(priority_of(id))) + " " + std::string(to_string(id)) + ": " +
                 std::string(describe(id)));
  }
}

CommandResult PumpController::reject(TimeMs now, const std::string& cmd, std::string why) {
  log_.add(now, "REJECT", cmd + ": " + why);
  return CommandResult::reject(std::move(why));
}

void PumpController::update_motor_command() {
  double rate = active_rate_ml_h();
  motor_.enabled = rate > 0.0;
  motor_.steps_per_s = motor_.enabled ? cfg::ml_h_to_steps_per_s(rate) : 0.0;
}

double PumpController::active_rate_ml_h() const {
  switch (state_) {
    case State::Priming: return cfg::kPrimeRateMlH;
    case State::Infusing: return program_ ? program_->rate_ml_h : 0.0;
    case State::Kvo: return program_ ? std::min(cfg::kKvoRateMlH, program_->rate_ml_h) : 0.0;
    default: return 0.0;
  }
}

void PumpController::enter_alarm_state(TimeMs now) {
  if (state_ == State::Alarm || state_ == State::Fault) return;
  if (state_ == State::Infusing || state_ == State::Kvo) {
    resume_state_ = State::Paused;
  } else if (state_ == State::Priming) {
    resume_state_ = pre_prime_state_;
  } else {
    resume_state_ = state_;
  }
  transition(State::Alarm, now, "high priority alarm");
}

const Drug* PumpController::drug() const {
  return program_ ? library_.find(program_->drug_id) : nullptr;
}

double PumpController::dose() const {
  const Drug* d = drug();
  return d ? dose_rate(*d, program_->rate_ml_h, program_->weight_kg) : 0.0;
}

double PumpController::remaining_ml() const {
  return program_ ? std::max(0.0, program_->vtbi_ml - infused_ml_) : 0.0;
}

std::optional<double> PumpController::time_remaining_s() const {
  if (!program_ || program_->rate_ml_h <= 0.0) return std::nullopt;
  if (state_ != State::Infusing && state_ != State::Paused && state_ != State::Ready) return std::nullopt;
  return remaining_ml() / program_->rate_ml_h * 3600.0;
}

CommandResult PumpController::validate_and_log(const InfusionProgram& p, bool confirm, TimeMs now,
                                               const char* action) {
  const ValidationResult v = library_.validate(p);
  if (!v.accepted(confirm)) {
    if (v.is_soft()) {
      log_.add(now, "REJECT", std::string(action) + ": " + v.message + " (confirmation required)");
      return CommandResult::reject("CONFIRM_REQUIRED: " + v.message);
    }
    return reject(now, action, v.message);
  }
  if (v.is_soft()) {
    log_.add(now, "OVERRIDE", std::string(action) + ": operator confirmed " + v.message);  // SRS-004
  }
  return CommandResult::accept();
}

// ---------------------------------------------------------------------------
// Operator commands

CommandResult PumpController::program(const InfusionProgram& p, bool confirm, TimeMs now) {
  if (state_ != State::Idle && state_ != State::Ready) {
    return reject(now, "PROGRAM", "Not allowed while " + std::string(to_string(state_)));
  }
  CommandResult r = validate_and_log(p, confirm, now, "PROGRAM");
  if (!r.ok) return r;
  program_ = p;
  infused_ml_ = 0.0;
  const Drug* d = library_.find(p.drug_id);
  log_.add(now, "COMMAND",
           "PROGRAM " + d->name + " " + fmt(p.rate_ml_h) + " mL/h, VTBI " + fmt(p.vtbi_ml) + " mL, dose " +
               fmt(dose()) + " " + d->dose_unit);
  transition(State::Ready, now, "program accepted");
  return r;
}

CommandResult PumpController::prime(TimeMs now) {
  if (state_ != State::Idle && state_ != State::Ready) {
    return reject(now, "PRIME", "Not allowed while " + std::string(to_string(state_)));
  }
  pre_prime_state_ = state_;
  prime_ml_ = 0.0;
  primed_ = false;
  flow_.reset();
  log_.add(now, "COMMAND", "PRIME " + fmt(cfg::kPrimeVolumeMl) + " mL");
  transition(State::Priming, now, "operator");
  return CommandResult::accept();
}

CommandResult PumpController::start(TimeMs now) {
  if (state_ != State::Ready && state_ != State::Paused) {
    return reject(now, "START", "Not allowed while " + std::string(to_string(state_)));
  }
  if (!program_) return reject(now, "START", "No program");
  if (!primed_) return reject(now, "START", "Line not primed");  // SRS-010
  if (alarms_.any_displayed_at(Priority::High)) {
    return reject(now, "START", "Acknowledge active alarms first");  // SRS-013
  }
  flow_.reset();
  occlusion_.reset();
  log_.add(now, "COMMAND", "START");
  const bool complete = infused_ml_ >= program_->vtbi_ml;
  transition(complete ? State::Kvo : State::Infusing, now, "operator");
  return CommandResult::accept();
}

CommandResult PumpController::pause(TimeMs now) {
  if (state_ == State::Priming) {
    log_.add(now, "COMMAND", "PAUSE (priming aborted)");
    transition(pre_prime_state_, now, "priming aborted");
    return CommandResult::accept();
  }
  if (state_ != State::Infusing && state_ != State::Kvo) {
    return reject(now, "PAUSE", "Not allowed while " + std::string(to_string(state_)));
  }
  log_.add(now, "COMMAND", "PAUSE");
  transition(State::Paused, now, "operator");
  return CommandResult::accept();
}

CommandResult PumpController::stop(TimeMs now) {
  if (state_ == State::Idle || state_ == State::Fault || state_ == State::Priming) {
    return reject(now, "STOP", "Not allowed while " + std::string(to_string(state_)));
  }
  log_.add(now, "COMMAND", "STOP. Infused " + fmt(std::round(infused_ml_ * 100.0) / 100.0) + " mL");
  program_.reset();
  alarms_.set_condition(AlarmId::InfusionComplete, false, now);
  transition(State::Idle, now, "infusion ended");  // SRS-014
  return CommandResult::accept();
}

CommandResult PumpController::titrate(double rate_ml_h, bool confirm, TimeMs now) {
  if (!program_ || (state_ != State::Infusing && state_ != State::Paused && state_ != State::Ready)) {
    return reject(now, "TITRATE", "Not allowed while " + std::string(to_string(state_)));
  }
  InfusionProgram p = *program_;
  const double old_rate = p.rate_ml_h;
  p.rate_ml_h = rate_ml_h;
  CommandResult r = validate_and_log(p, confirm, now, "TITRATE");  // SRS-006
  if (!r.ok) return r;
  program_ = p;
  log_.add(now, "COMMAND", "TITRATE " + fmt(old_rate) + " -> " + fmt(rate_ml_h) + " mL/h");
  update_motor_command();
  return r;
}

CommandResult PumpController::acknowledge(TimeMs now) {
  const int cleared = alarms_.acknowledge();
  log_.add(now, "COMMAND", "ACKNOWLEDGE (" + std::to_string(cleared) + " cleared)");
  if (state_ == State::Alarm && !alarms_.any_displayed_at(Priority::High)) {
    // SRS-013: never resume delivery automatically.
    transition(resume_state_, now, "alarms acknowledged");
  }
  return CommandResult::accept();
}

CommandResult PumpController::silence(TimeMs now) {
  if (alarms_.highest() == Priority::None) return reject(now, "SILENCE", "No active alarm");
  alarms_.silence(now);
  log_.add(now, "COMMAND", "SILENCE " + std::to_string(cfg::kSilenceMs / 1000) + " s");
  return CommandResult::accept();
}

CommandResult PumpController::set_sensitivity(OcclusionSensitivity s, TimeMs now) {
  occlusion_.set_sensitivity(s);
  log_.add(now, "COMMAND",
           "OCCLUSION SENSITIVITY " + std::string(to_string(s)) + " (" + fmt(occlusion_.threshold_mmhg()) +
               " mmHg)");
  return CommandResult::accept();
}

void PumpController::reset(TimeMs now) {
  const OcclusionSensitivity sens = occlusion_.sensitivity();
  log_.add(now, "SYSTEM", "Restart. Program cleared");
  alarms_.clear_all();
  occlusion_ = OcclusionDetector(sens);
  air_.reset();
  flow_.reset();
  plausibility_.reset();
  program_.reset();
  primed_ = false;
  infused_ml_ = 0.0;
  prime_ml_ = 0.0;
  last_frame_.reset();
  last_frame_rx_ = now;
  last_tick_ = now;
  pending_delivered_steps_ = 0.0;
  state_ = State::Idle;
  update_motor_command();
}

// ---------------------------------------------------------------------------
// HAL interface

void PumpController::on_sensor_frame(const SensorFrame& f) {
  const TimeMs now = f.t_ms;
  const bool running = is_running(state_);

  if (auto why = plausibility_.check(f, running)) {
    if (alarms_.set_condition(AlarmId::SensorFault, true, now)) {
      log_.add(now, "ALARM", "HIGH SENSOR_FAULT: " + *why);
    }
    last_frame_rx_ = now;
    return;  // An implausible frame is never used for control.
  }
  alarms_.set_condition(AlarmId::SensorFault, false, now);

  if (last_frame_) {
    pending_delivered_steps_ += static_cast<double>(f.encoder_steps - last_frame_->encoder_steps);
  }
  last_frame_ = f;
  last_frame_rx_ = now;

  // While stopped by an alarm the condition keeps being evaluated, so an
  // operator cannot acknowledge an occlusion that is still present (SRS-043).
  const bool watch = running || state_ == State::Alarm;
  const auto occ = occlusion_.update(f);
  raise(AlarmId::DownstreamOcclusion, watch && occ.downstream, now);
  raise(AlarmId::UpstreamOcclusion, watch && occ.upstream, now);

  // Air detection is inhibited while priming: purging air is the purpose of priming (SRS-011).
  const bool air = air_.update(f.air_ul, now);
  raise(AlarmId::AirInLine, air && (state_ == State::Infusing || state_ == State::Kvo), now);

  raise(AlarmId::ReservoirEmpty, watch && f.reservoir_ml <= cfg::kReservoirEmptyMl, now);
  raise(AlarmId::ReservoirLow,
        (running || state_ == State::Paused) && f.reservoir_ml < cfg::kReservoirLowMl &&
            f.reservoir_ml > cfg::kReservoirEmptyMl,
        now);
}

MotorCommand PumpController::tick(TimeMs now) {
  if (!last_tick_) {
    last_tick_ = now;
    last_frame_rx_ = now;
  }
  const TimeMs dt = std::max<TimeMs>(0, now - *last_tick_);
  last_tick_ = now;

  // 1. Delivery accounting from encoder feedback (SRS-021).
  const double delivered_steps = pending_delivered_steps_;
  pending_delivered_steps_ = 0.0;
  const double delivered_ml = delivered_steps / cfg::kStepsPerMl;
  if (state_ == State::Priming) {
    prime_ml_ += delivered_ml;
  } else if (program_) {
    infused_ml_ += delivered_ml;
  }

  // 2. Flow monitoring: commanded steps of the cycle that just ended vs encoder.
  const double commanded_steps = motor_.enabled ? motor_.steps_per_s * static_cast<double>(dt) / 1000.0 : 0.0;
  const auto flow = flow_.update(now, commanded_steps, delivered_steps);
  raise(AlarmId::MotorStall, is_running(state_) && flow.stalled, now);
  raise(AlarmId::OverDelivery, flow.over_delivery, now);

  // 3. Watchdog on the sensor stream (SRS-052).
  raise(AlarmId::CommunicationLoss, now - last_frame_rx_ > cfg::kWatchdogMs, now);

  // 4. Progress of the current state.
  if (state_ == State::Priming && prime_ml_ >= cfg::kPrimeVolumeMl) {
    primed_ = true;
    log_.add(now, "SYSTEM", "Priming complete (" + fmt(std::round(prime_ml_ * 100.0) / 100.0) + " mL)");
    transition(pre_prime_state_, now, "priming complete");
  }
  if (state_ == State::Infusing && program_ && infused_ml_ >= program_->vtbi_ml) {
    raise(AlarmId::InfusionComplete, true, now);  // SRS-022
    alarms_.set_condition(AlarmId::InfusionComplete, false, now);  // event alarm: stays latched
    transition(State::Kvo, now, "VTBI reached");
  }
  raise(AlarmId::PausedTooLong, state_ == State::Paused && now - paused_since_ >= cfg::kPausedReminderMs, now);

  // 5. Alarm response.
  if (alarms_.any_system_fault()) {
    if (state_ != State::Fault) {
      transition(State::Fault, now, "system fault");
    }
  } else if (alarms_.any_displayed_at(Priority::High) && state_ != State::Alarm && state_ != State::Fault) {
    if (is_running(state_) || alarms_.condition(AlarmId::OverDelivery)) {
      enter_alarm_state(now);
    }
  }

  update_motor_command();
  return motor_;
}

}  // namespace pump
