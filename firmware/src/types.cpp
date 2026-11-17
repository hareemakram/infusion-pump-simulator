// SPDX-License-Identifier: MIT
#include "pump/types.hpp"

#include "pump/config.hpp"

namespace pump {

std::string_view to_string(State s) {
  switch (s) {
    case State::Idle: return "IDLE";
    case State::Ready: return "READY";
    case State::Priming: return "PRIMING";
    case State::Infusing: return "INFUSING";
    case State::Paused: return "PAUSED";
    case State::Kvo: return "KVO";
    case State::Alarm: return "ALARM";
    case State::Fault: return "FAULT";
  }
  return "UNKNOWN";
}

std::string_view to_string(Priority p) {
  switch (p) {
    case Priority::None: return "NONE";
    case Priority::Low: return "LOW";
    case Priority::Medium: return "MEDIUM";
    case Priority::High: return "HIGH";
  }
  return "UNKNOWN";
}

std::string_view to_string(AlarmId id) {
  switch (id) {
    case AlarmId::DownstreamOcclusion: return "DOWNSTREAM_OCCLUSION";
    case AlarmId::UpstreamOcclusion: return "UPSTREAM_OCCLUSION";
    case AlarmId::AirInLine: return "AIR_IN_LINE";
    case AlarmId::ReservoirEmpty: return "RESERVOIR_EMPTY";
    case AlarmId::MotorStall: return "MOTOR_STALL";
    case AlarmId::OverDelivery: return "OVER_DELIVERY";
    case AlarmId::SensorFault: return "SENSOR_FAULT";
    case AlarmId::CommunicationLoss: return "COMMUNICATION_LOSS";
    case AlarmId::InfusionComplete: return "INFUSION_COMPLETE";
    case AlarmId::ReservoirLow: return "RESERVOIR_LOW";
    case AlarmId::PausedTooLong: return "PAUSED_TOO_LONG";
    case AlarmId::Count: break;
  }
  return "UNKNOWN";
}

std::string_view to_string(OcclusionSensitivity s) {
  switch (s) {
    case OcclusionSensitivity::Low: return "LOW";
    case OcclusionSensitivity::Medium: return "MEDIUM";
    case OcclusionSensitivity::High: return "HIGH";
  }
  return "UNKNOWN";
}

std::string_view describe(AlarmId id) {
  switch (id) {
    case AlarmId::DownstreamOcclusion: return "Occlusion downstream. Check line to patient for kinks or closed clamps.";
    case AlarmId::UpstreamOcclusion: return "Occlusion upstream. Check container clamp and spike.";
    case AlarmId::AirInLine: return "Air in line. Remove air before resuming.";
    case AlarmId::ReservoirEmpty: return "Container empty.";
    case AlarmId::MotorStall: return "Pumping mechanism not moving. Remove pump from service.";
    case AlarmId::OverDelivery: return "Delivery exceeds programmed rate. Close clamp, remove pump from service.";
    case AlarmId::SensorFault: return "Sensor failure detected. Restart required.";
    case AlarmId::CommunicationLoss: return "Sensor communication lost. Restart required.";
    case AlarmId::InfusionComplete: return "Infusion complete. Running at KVO rate.";
    case AlarmId::ReservoirLow: return "Container nearly empty.";
    case AlarmId::PausedTooLong: return "Pump paused. Resume or stop the infusion.";
    case AlarmId::Count: break;
  }
  return "";
}

Priority priority_of(AlarmId id) {
  switch (id) {
    case AlarmId::InfusionComplete: return Priority::Medium;
    case AlarmId::ReservoirLow:
    case AlarmId::PausedTooLong: return Priority::Low;
    case AlarmId::Count: return Priority::None;
    default: return Priority::High;
  }
}

bool is_latching(AlarmId id) { return priority_of(id) >= Priority::Medium; }

bool is_system_fault(AlarmId id) {
  return id == AlarmId::SensorFault || id == AlarmId::CommunicationLoss;
}

bool is_running(State s) {
  return s == State::Priming || s == State::Infusing || s == State::Kvo;
}

namespace cfg {
double occlusion_threshold(OcclusionSensitivity s) {
  switch (s) {
    case OcclusionSensitivity::Low: return kOcclusionThresholdLowSens;
    case OcclusionSensitivity::Medium: return kOcclusionThresholdMedSens;
    case OcclusionSensitivity::High: return kOcclusionThresholdHighSens;
  }
  return kOcclusionThresholdHighSens;
}

double ml_h_to_steps_per_s(double ml_h) { return ml_h * kStepsPerMl / 3600.0; }
}  // namespace cfg

}  // namespace pump
