// SPDX-License-Identifier: MIT
// Safety-relevant constants. Each one is traced to a requirement in
// docs/02-software-requirements-specification.md.
#pragma once

#include "pump/types.hpp"

namespace pump::cfg {

// Mechanism ---------------------------------------------------------------
inline constexpr double kStepsPerMl = 2000.0;            // SRS-020

// Programming ranges -------------------------------------------------------
inline constexpr double kMinRateMlH = 0.1;               // SRS-001
inline constexpr double kMaxRateMlH = 999.0;             // SRS-001
inline constexpr double kMinVtbiMl = 0.1;                // SRS-001
inline constexpr double kMaxVtbiMl = 9999.0;             // SRS-001
inline constexpr double kMinWeightKg = 0.5;              // SRS-007
inline constexpr double kMaxWeightKg = 350.0;            // SRS-007

// Delivery -----------------------------------------------------------------
inline constexpr double kKvoRateMlH = 1.0;               // SRS-022
inline constexpr double kPrimeRateMlH = 600.0;           // SRS-011
inline constexpr double kPrimeVolumeMl = 2.0;            // SRS-011

// Occlusion ----------------------------------------------------------------
inline constexpr double kOcclusionThresholdLowSens = 800.0;   // SRS-031
inline constexpr double kOcclusionThresholdMedSens = 500.0;   // SRS-031
inline constexpr double kOcclusionThresholdHighSens = 300.0;  // SRS-031
inline constexpr double kOcclusionClearFraction = 0.8;        // SRS-030 hysteresis
inline constexpr TimeMs kDownstreamDebounceMs = 300;          // SRS-030
inline constexpr double kUpstreamThresholdMmHg = -150.0;      // SRS-032
inline constexpr TimeMs kUpstreamDebounceMs = 1000;           // SRS-032

// Air in line --------------------------------------------------------------
inline constexpr double kAirSingleBubbleUl = 50.0;            // SRS-033
inline constexpr double kAirCumulativeUl = 1000.0;            // SRS-034
inline constexpr TimeMs kAirWindowMs = 15 * 60 * 1000;        // SRS-034

// Container ----------------------------------------------------------------
inline constexpr double kReservoirEmptyMl = 0.5;              // SRS-035
inline constexpr double kReservoirLowMl = 10.0;               // SRS-035

// Flow monitoring ----------------------------------------------------------
inline constexpr double kStallSteps = 40.0;                   // SRS-036
inline constexpr TimeMs kFlowWindowMs = 60 * 1000;            // SRS-037
inline constexpr double kOverDeliveryAbsSteps = 20.0;         // SRS-037
inline constexpr double kOverDeliveryFraction = 0.10;         // SRS-037

// Sensor plausibility ------------------------------------------------------
inline constexpr double kDownstreamMinMmHg = -100.0;          // SRS-050
inline constexpr double kDownstreamMaxMmHg = 1500.0;          // SRS-050
inline constexpr double kUpstreamMinMmHg = -800.0;            // SRS-050
inline constexpr double kUpstreamMaxMmHg = 800.0;             // SRS-050
inline constexpr double kReservoirMaxMl = 5000.0;             // SRS-050
inline constexpr double kAirMaxUl = 10000.0;                  // SRS-050
inline constexpr int kStuckSensorFrames = 50;                 // SRS-051

// Timing -------------------------------------------------------------------
inline constexpr TimeMs kWatchdogMs = 500;                    // SRS-052
inline constexpr TimeMs kPausedReminderMs = 120 * 1000;       // SRS-038
inline constexpr TimeMs kSilenceMs = 120 * 1000;              // SRS-042

double occlusion_threshold(OcclusionSensitivity s);
double ml_h_to_steps_per_s(double ml_h);

}  // namespace pump::cfg
