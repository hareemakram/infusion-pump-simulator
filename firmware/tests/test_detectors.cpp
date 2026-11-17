// SPDX-License-Identifier: MIT
#include <gtest/gtest.h>

#include <cmath>

#include "pump/config.hpp"
#include "pump/detectors.hpp"

using namespace pump;

namespace {
SensorFrame frame(TimeMs t, double pd, double pu = 0.0) {
  SensorFrame f;
  f.t_ms = t;
  f.downstream_mmhg = pd;
  f.upstream_mmhg = pu;
  f.reservoir_ml = 100.0;
  return f;
}
}  // namespace

TEST(Debouncer, RequiresContinuousCondition) {
  Debouncer d(300);
  EXPECT_FALSE(d.update(true, 0));
  EXPECT_FALSE(d.update(true, 200));
  EXPECT_FALSE(d.update(false, 250));  // interruption restarts the timer
  EXPECT_FALSE(d.update(true, 300));
  EXPECT_TRUE(d.update(true, 600));
  d.reset();
  EXPECT_FALSE(d.active());
}

// @req SRS-030
TEST(OcclusionDetector, DownstreamAlarmAfter300msAboveThreshold) {
  OcclusionDetector det(OcclusionSensitivity::Medium);
  EXPECT_FALSE(det.update(frame(0, 501)).downstream);
  EXPECT_FALSE(det.update(frame(200, 520)).downstream);
  EXPECT_TRUE(det.update(frame(300, 530)).downstream);
}

// @req SRS-030
TEST(OcclusionDetector, SingleSpikeDoesNotAlarm) {
  OcclusionDetector det(OcclusionSensitivity::Medium);
  det.update(frame(0, 900));
  det.update(frame(100, 40));
  det.update(frame(200, 40));
  EXPECT_FALSE(det.update(frame(300, 40)).downstream);
}

// @req SRS-030
TEST(OcclusionDetector, HysteresisHoldsUntil80PercentOfThreshold) {
  OcclusionDetector det(OcclusionSensitivity::Medium);
  det.update(frame(0, 600));
  ASSERT_TRUE(det.update(frame(300, 600)).downstream);
  EXPECT_TRUE(det.update(frame(400, 450)).downstream);   // below 500 but above 400
  EXPECT_FALSE(det.update(frame(500, 390)).downstream);  // below 400
}

// @req SRS-031
TEST(OcclusionDetector, SensitivitySelectsThreshold) {
  OcclusionDetector det;
  EXPECT_DOUBLE_EQ(det.threshold_mmhg(), 500.0);
  det.set_sensitivity(OcclusionSensitivity::High);
  EXPECT_DOUBLE_EQ(det.threshold_mmhg(), 300.0);
  det.set_sensitivity(OcclusionSensitivity::Low);
  EXPECT_DOUBLE_EQ(det.threshold_mmhg(), 800.0);
  EXPECT_EQ(to_string(det.sensitivity()), "LOW");
  EXPECT_EQ(to_string(OcclusionSensitivity::Medium), "MEDIUM");
  EXPECT_EQ(to_string(OcclusionSensitivity::High), "HIGH");
}

// @req SRS-031
TEST(OcclusionDetector, HighSensitivityAlarmsAtLowerPressure) {
  OcclusionDetector det(OcclusionSensitivity::High);
  det.update(frame(0, 350));
  EXPECT_TRUE(det.update(frame(300, 350)).downstream);
}

// @req SRS-032
TEST(OcclusionDetector, UpstreamAlarmAfterOneSecondOfVacuum) {
  OcclusionDetector det;
  EXPECT_FALSE(det.update(frame(0, 20, -160)).upstream);
  EXPECT_FALSE(det.update(frame(900, 20, -170)).upstream);
  EXPECT_TRUE(det.update(frame(1000, 20, -170)).upstream);
  det.reset();
  EXPECT_FALSE(det.update(frame(1100, 20, -170)).upstream);
}

// @req SRS-033
TEST(AirInLineDetector, SingleBubbleAtThreshold) {
  AirInLineDetector det;
  EXPECT_FALSE(det.update(49.9, 0));
  EXPECT_TRUE(det.update(50.0, 100));
}

// @req SRS-034
TEST(AirInLineDetector, CumulativeAirWithinFifteenMinutes) {
  AirInLineDetector det;
  TimeMs t = 0;
  for (int i = 0; i < 24; ++i) {
    EXPECT_FALSE(det.update(40.0, t));
    t += 30'000;
  }
  EXPECT_DOUBLE_EQ(det.cumulative_ul(), 960.0);
  EXPECT_TRUE(det.update(40.0, t));  // 1000 uL within window
}

// @req SRS-034
TEST(AirInLineDetector, OldAirLeavesTheWindow) {
  AirInLineDetector det;
  det.update(45.0, 0);
  det.update(0.0, cfg::kAirWindowMs + 1);
  EXPECT_DOUBLE_EQ(det.cumulative_ul(), 0.0);
  det.update(45.0, cfg::kAirWindowMs + 2);
  det.reset();
  EXPECT_DOUBLE_EQ(det.cumulative_ul(), 0.0);
}

// @req SRS-036
TEST(FlowMonitor, DetectsStallAfterCommandedStepsWithoutMotion) {
  FlowMonitor fm;
  TimeMs t = 0;
  for (int i = 0; i < 7; ++i) EXPECT_FALSE(fm.update(t += 100, 5.5, 0.0).stalled);
  EXPECT_TRUE(fm.update(t += 100, 5.5, 0.0).stalled);  // 44 steps
  EXPECT_FALSE(fm.update(t += 100, 5.5, 5.0).stalled);  // motion resets
}

// @req SRS-036
TEST(FlowMonitor, LowRatesDoNotFalselyStall) {
  FlowMonitor fm;
  TimeMs t = 0;
  // 0.1 mL/h = 0.0556 steps/s: one step every ~18 s.
  double frac = 0.0;
  for (int i = 0; i < 6000; ++i) {
    frac += 0.00556;
    double moved = 0.0;
    if (frac >= 1.0) {
      frac -= 1.0;
      moved = 1.0;
    }
    ASSERT_FALSE(fm.update(t += 100, 0.00556, moved).stalled);
  }
}

// @req SRS-037
TEST(FlowMonitor, DetectsRunawayMotor) {
  FlowMonitor fm;
  TimeMs t = 0;
  bool alarm = false;
  for (int i = 0; i < 10 && !alarm; ++i) alarm = fm.update(t += 100, 55.5, 166.5).over_delivery;
  EXPECT_TRUE(alarm);
}

// @req SRS-037
TEST(FlowMonitor, DetectsUncommandedMotion) {
  FlowMonitor fm;
  TimeMs t = 0;
  EXPECT_FALSE(fm.update(t += 100, 0.0, 15.0).over_delivery);
  EXPECT_TRUE(fm.update(t += 100, 0.0, 15.0).over_delivery);
}

// @req SRS-037
TEST(FlowMonitor, NominalDeliveryIsQuiet) {
  FlowMonitor fm;
  TimeMs t = 0;
  for (int i = 0; i < 2000; ++i) {
    const auto r = fm.update(t += 100, 55.5, i % 2 ? 56.0 : 55.0);
    ASSERT_FALSE(r.over_delivery);
    ASSERT_FALSE(r.stalled);
  }
  EXPECT_NEAR(fm.window_commanded(), 55.5 * 601, 1e-6);
  EXPECT_NEAR(fm.window_delivered(), 55.5 * 601, 1.0);
}

// @req SRS-050
TEST(SensorPlausibility, RejectsOutOfRangeValues) {
  SensorPlausibility p;
  auto f = frame(100, 2000.0);
  EXPECT_TRUE(p.check(f, false).has_value());
  f = frame(200, 20.0, -900.0);
  EXPECT_TRUE(p.check(f, false).has_value());
  f = frame(300, 20.0);
  f.reservoir_ml = -5.0;
  EXPECT_TRUE(p.check(f, false).has_value());
  f = frame(400, 20.0);
  f.air_ul = -1.0;
  EXPECT_TRUE(p.check(f, false).has_value());
  f = frame(500, std::nan(""));
  EXPECT_TRUE(p.check(f, false).has_value());
  EXPECT_FALSE(p.check(frame(600, 20.0), false).has_value());
}

// @req SRS-051
TEST(SensorPlausibility, DetectsFrozenPressureWhileRunning) {
  SensorPlausibility p;
  TimeMs t = 0;
  std::optional<std::string> r;
  for (int i = 0; i <= cfg::kStuckSensorFrames && !r; ++i) r = p.check(frame(t += 100, 42.0), true);
  ASSERT_TRUE(r.has_value());
  EXPECT_NE(r->find("frozen"), std::string::npos);
}

// @req SRS-051
TEST(SensorPlausibility, ConstantPressureWhileStoppedIsAllowed) {
  SensorPlausibility p;
  TimeMs t = 0;
  for (int i = 0; i < 200; ++i) ASSERT_FALSE(p.check(frame(t += 100, 42.0), false).has_value());
}

// @req SRS-054
TEST(SensorPlausibility, DetectsEncoderAndClockRegression) {
  SensorPlausibility p;
  auto f = frame(100, 20.0);
  f.encoder_steps = 500;
  EXPECT_FALSE(p.check(f, false));
  f.t_ms = 200;
  f.encoder_steps = 400;
  EXPECT_TRUE(p.check(f, false).has_value());
  p.reset();
  f = frame(300, 20.0);
  EXPECT_FALSE(p.check(f, false));
  f = frame(300, 20.0);
  EXPECT_TRUE(p.check(f, false).has_value());
}
