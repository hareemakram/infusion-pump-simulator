// SPDX-License-Identifier: MIT
// Core vocabulary types shared by every firmware unit.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>

namespace pump {

/// Monotonic time in milliseconds, supplied by the host/HAL. The core never
/// reads a wall clock, which keeps every unit deterministic and testable.
using TimeMs = std::int64_t;

enum class State : std::uint8_t {
  Idle,      ///< No accepted program.
  Ready,     ///< Program accepted, motor stopped.
  Priming,   ///< Purging the line before connection to the patient.
  Infusing,  ///< Delivering at the programmed rate.
  Paused,    ///< Stopped by the operator or after an acknowledged alarm.
  Kvo,       ///< VTBI reached, delivering keep-vein-open rate.
  Alarm,     ///< Stopped because of a high-priority alarm.
  Fault,     ///< System integrity failure. Only a reset (power cycle) exits.
};

/// Alarm priorities as defined by IEC 60601-1-8.
enum class Priority : std::uint8_t { None = 0, Low = 1, Medium = 2, High = 3 };

enum class AlarmId : std::uint8_t {
  DownstreamOcclusion,
  UpstreamOcclusion,
  AirInLine,
  ReservoirEmpty,
  MotorStall,
  OverDelivery,
  SensorFault,
  CommunicationLoss,
  InfusionComplete,
  ReservoirLow,
  PausedTooLong,
  Count
};
inline constexpr std::size_t kAlarmCount = static_cast<std::size_t>(AlarmId::Count);

/// Occlusion sensitivity. "High" sensitivity means the lowest pressure threshold.
enum class OcclusionSensitivity : std::uint8_t { Low, Medium, High };

/// One sample of every sensor, delivered by the HAL once per control cycle.
struct SensorFrame {
  TimeMs t_ms{0};
  double downstream_mmhg{0.0};   ///< Pressure between pump and patient.
  double upstream_mmhg{0.0};     ///< Pressure between container and pump.
  double air_ul{0.0};            ///< Air volume seen by the ultrasonic detector this cycle.
  double reservoir_ml{0.0};      ///< Container level sensor.
  std::int64_t encoder_steps{0}; ///< Cumulative motor encoder count.
};

struct MotorCommand {
  bool enabled{false};
  double steps_per_s{0.0};
};

std::string_view to_string(State s);
std::string_view to_string(Priority p);
std::string_view to_string(AlarmId id);
std::string_view to_string(OcclusionSensitivity s);
std::string_view describe(AlarmId id);

Priority priority_of(AlarmId id);
/// Latching alarms stay displayed after their condition clears until acknowledged.
bool is_latching(AlarmId id);
/// System faults force the Fault state.
bool is_system_fault(AlarmId id);
bool is_running(State s);

}  // namespace pump
