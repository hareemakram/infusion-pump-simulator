// SPDX-License-Identifier: MIT
#include <gtest/gtest.h>

#include "pump/config.hpp"
#include "pump/pump_controller.hpp"
#include "rig.hpp"

using namespace pump;
using pump::test::Rig;

// --- Programming ----------------------------------------------------------

// @req SRS-001, SRS-015
TEST(Controller, InvalidProgramIsRejectedWithoutStateChange) {
  Rig r;
  r.cycle();
  const auto res = r.program("saline", 1200.0, 100.0);
  EXPECT_FALSE(res.ok);
  EXPECT_NE(res.reason.find("Rate outside"), std::string::npos);
  EXPECT_EQ(r.pump.state(), State::Idle);
  EXPECT_FALSE(r.pump.program().has_value());
}

// @req SRS-003
TEST(Controller, HardLimitRejectedEvenWithConfirmation) {
  Rig r;
  r.cycle();
  EXPECT_FALSE(r.program("heparin", 35.0, 100.0, 0.0, true).ok);
  EXPECT_EQ(r.pump.state(), State::Idle);
  EXPECT_TRUE(r.pump.log().contains("REJECT", "hard limit"));
}

// @req SRS-004, SRS-060
TEST(Controller, SoftLimitNeedsConfirmationAndIsLogged) {
  Rig r;
  r.cycle();
  const auto first = r.program("heparin", 25.0, 100.0);
  EXPECT_FALSE(first.ok);
  EXPECT_EQ(first.reason.rfind("CONFIRM_REQUIRED", 0), 0u);
  EXPECT_EQ(r.pump.state(), State::Idle);

  EXPECT_TRUE(r.program("heparin", 25.0, 100.0, 0.0, true).ok);
  EXPECT_EQ(r.pump.state(), State::Ready);
  EXPECT_TRUE(r.pump.log().contains("OVERRIDE", "soft limit"));
  EXPECT_DOUBLE_EQ(r.pump.dose(), 2500.0);
}

// @req SRS-002, SRS-007
TEST(Controller, WeightBasedProgramComputesDose) {
  Rig r;
  r.cycle();
  ASSERT_TRUE(r.program("propofol", 14.0, 50.0, 70.0).ok);
  EXPECT_DOUBLE_EQ(r.pump.dose(), 2.0);
  ASSERT_NE(r.pump.drug(), nullptr);
  EXPECT_EQ(r.pump.drug()->dose_unit, "mg/kg/h");
}

// @req SRS-006
TEST(Controller, TitrationIsValidatedAgainstLimits) {
  Rig r;
  r.cycle();
  ASSERT_TRUE(r.program("heparin", 10.0, 100.0).ok);
  r.pump.prime(r.t);
  r.run_ms(13'000);
  ASSERT_TRUE(r.pump.start(r.t).ok);
  r.cycle();
  EXPECT_FALSE(r.pump.titrate(40.0, true, r.t).ok);   // hard limit
  EXPECT_FALSE(r.pump.titrate(22.0, false, r.t).ok);  // soft limit, unconfirmed
  EXPECT_DOUBLE_EQ(r.pump.program()->rate_ml_h, 10.0);
  EXPECT_TRUE(r.pump.titrate(15.0, false, r.t).ok);
  EXPECT_DOUBLE_EQ(r.pump.motor().steps_per_s, cfg::ml_h_to_steps_per_s(15.0));
}

// @req SRS-006, SRS-015
TEST(Controller, TitrationRejectedWithoutProgram) {
  Rig r;
  r.cycle();
  EXPECT_FALSE(r.pump.titrate(15.0, false, r.t).ok);
}

// --- State machine --------------------------------------------------------

// @req SRS-010
TEST(Controller, StartRequiresProgramAndPrimedLine) {
  Rig r;
  r.cycle();
  EXPECT_FALSE(r.pump.start(r.t).ok);
  ASSERT_TRUE(r.program("saline", 100.0, 10.0).ok);
  const auto res = r.pump.start(r.t);
  EXPECT_FALSE(res.ok);
  EXPECT_EQ(res.reason, "Line not primed");
  EXPECT_EQ(r.pump.state(), State::Ready);
}

// @req SRS-011
TEST(Controller, PrimingDeliversPrimeVolumeAndDoesNotCountAsInfused) {
  Rig r;
  r.cycle();
  ASSERT_TRUE(r.program("saline", 100.0, 10.0).ok);
  ASSERT_TRUE(r.pump.prime(r.t).ok);
  r.cycle();
  EXPECT_EQ(r.pump.state(), State::Priming);
  EXPECT_DOUBLE_EQ(r.pump.active_rate_ml_h(), cfg::kPrimeRateMlH);
  r.run_ms(13'000);
  EXPECT_EQ(r.pump.state(), State::Ready);
  EXPECT_TRUE(r.pump.primed());
  EXPECT_NEAR(r.pump.prime_ml(), cfg::kPrimeVolumeMl, 0.05);
  EXPECT_DOUBLE_EQ(r.pump.infused_ml(), 0.0);
}

// @req SRS-011
TEST(Controller, AirDuringPrimingDoesNotAlarm) {
  Rig r;
  r.cycle();
  r.pump.prime(r.t);
  r.cycle();
  r.air_next = 500.0;
  r.cycle();
  EXPECT_FALSE(r.pump.alarms().displayed(AlarmId::AirInLine));
  EXPECT_EQ(r.pump.state(), State::Priming);
}

// @req SRS-011
TEST(Controller, PausingPrimingAbortsWithoutPrimedFlag) {
  Rig r;
  r.cycle();
  r.pump.prime(r.t);
  r.run_ms(1000);
  EXPECT_TRUE(r.pump.pause(r.t).ok);
  EXPECT_EQ(r.pump.state(), State::Idle);
  EXPECT_FALSE(r.pump.primed());
}

// @req SRS-012, SRS-020
TEST(Controller, MotorCommandFollowsStateImmediately) {
  Rig r;
  r.infusing(120.0, 50.0);
  EXPECT_EQ(r.pump.state(), State::Infusing);
  EXPECT_TRUE(r.pump.motor().enabled);
  EXPECT_DOUBLE_EQ(r.pump.motor().steps_per_s, 120.0 * 2000.0 / 3600.0);
  ASSERT_TRUE(r.pump.pause(r.t).ok);
  // No tick needed: the command is already disabled when pause() returns.
  EXPECT_FALSE(r.pump.motor().enabled);
  EXPECT_DOUBLE_EQ(r.pump.motor().steps_per_s, 0.0);
}

// @req SRS-014
TEST(Controller, StopEndsInfusionAndClearsProgram) {
  Rig r;
  r.infusing();
  r.run_ms(2000);
  ASSERT_TRUE(r.pump.stop(r.t).ok);
  EXPECT_EQ(r.pump.state(), State::Idle);
  EXPECT_FALSE(r.pump.program().has_value());
  EXPECT_FALSE(r.pump.motor().enabled);
  EXPECT_TRUE(r.pump.log().contains("COMMAND", "STOP"));
}

// @req SRS-015
TEST(Controller, CommandsInvalidForStateAreRejected) {
  Rig r;
  r.cycle();
  EXPECT_FALSE(r.pump.pause(r.t).ok);
  EXPECT_FALSE(r.pump.stop(r.t).ok);
  r.infusing();
  EXPECT_FALSE(r.pump.prime(r.t).ok);
  EXPECT_FALSE(r.program("saline", 50.0, 10.0).ok);
  EXPECT_FALSE(r.pump.start(r.t).ok);
  EXPECT_EQ(r.pump.state(), State::Infusing);
}

// --- Delivery ---------------------------------------------------------------

// @req SRS-021, SRS-023
TEST(Controller, InfusedVolumeComesFromEncoder) {
  Rig r;
  r.infusing(360.0, 100.0);
  r.motor_gain = 0.95;  // mechanism slips by 5 %; stays below the stall/over-delivery limits
  r.run_ms(60'000);
  // Command would be 6 mL; encoder says 5.7 mL.
  EXPECT_NEAR(r.pump.infused_ml(), 5.7, 0.05);
}

// @req SRS-022, SRS-023
TEST(Controller, VtbiCompleteSwitchesToKvoWithMediumAlarm) {
  Rig r;
  r.infusing(600.0, 5.0);
  r.run_ms(31'000);
  EXPECT_EQ(r.pump.state(), State::Kvo);
  EXPECT_NEAR(r.pump.infused_ml(), 5.0, 5.0 * 0.02);
  EXPECT_DOUBLE_EQ(r.pump.active_rate_ml_h(), cfg::kKvoRateMlH);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::InfusionComplete));
  EXPECT_EQ(r.pump.alarms().highest(), Priority::Medium);
  r.pump.acknowledge(r.t);
  EXPECT_FALSE(r.pump.alarms().displayed(AlarmId::InfusionComplete));
  EXPECT_EQ(r.pump.state(), State::Kvo);
}

// @req SRS-022
TEST(Controller, KvoRateNeverExceedsProgrammedRate) {
  Rig r;
  r.infusing(0.5, 0.1);
  r.run_ms(1'000'000);
  EXPECT_EQ(r.pump.state(), State::Kvo);
  EXPECT_DOUBLE_EQ(r.pump.active_rate_ml_h(), 0.5);
}

TEST(Controller, TimeRemainingReflectsRateAndVolume) {
  Rig r;
  r.ready(100.0, 50.0);
  ASSERT_TRUE(r.pump.time_remaining_s().has_value());
  EXPECT_NEAR(*r.pump.time_remaining_s(), 1800.0, 1e-6);
  EXPECT_NEAR(r.pump.remaining_ml(), 50.0, 1e-9);
}

// --- Alarms -------------------------------------------------------------------

// @req SRS-030, SRS-012
TEST(Controller, DownstreamOcclusionStopsMotor) {
  Rig r;
  r.infusing();
  r.downstream = 650.0;
  r.run_ms(200);
  EXPECT_EQ(r.pump.state(), State::Infusing);
  r.run_ms(300);
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_FALSE(r.pump.motor().enabled);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::DownstreamOcclusion));
}

// @req SRS-013, SRS-043
TEST(Controller, NoAutomaticRestartAfterAlarmClears) {
  Rig r;
  r.infusing();
  r.downstream = 650.0;
  r.run_ms(600);
  ASSERT_EQ(r.pump.state(), State::Alarm);

  r.pump.acknowledge(r.t);  // condition still present
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_FALSE(r.pump.start(r.t).ok);

  r.downstream = 20.0;  // occlusion relieved
  r.run_ms(2000);
  EXPECT_EQ(r.pump.state(), State::Alarm);  // still latched, motor still off
  EXPECT_FALSE(r.pump.motor().enabled);

  r.pump.acknowledge(r.t);
  EXPECT_EQ(r.pump.state(), State::Paused);
  EXPECT_FALSE(r.pump.motor().enabled);
  EXPECT_TRUE(r.pump.start(r.t).ok);
  EXPECT_EQ(r.pump.state(), State::Infusing);
}

// @req SRS-032
TEST(Controller, UpstreamOcclusionAlarms) {
  Rig r;
  r.infusing();
  r.upstream = -200.0;
  r.run_ms(1200);
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::UpstreamOcclusion));
}

// @req SRS-033
TEST(Controller, AirBubbleStopsInfusion) {
  Rig r;
  r.infusing();
  r.air_next = 75.0;
  r.cycle();
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::AirInLine));
}

// @req SRS-035
TEST(Controller, ReservoirLowThenEmpty) {
  Rig r;
  r.infusing(600.0, 500.0);
  r.reservoir = 10.4;
  r.run_ms(3000);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::ReservoirLow));
  EXPECT_EQ(r.pump.alarms().highest(), Priority::Low);
  EXPECT_EQ(r.pump.state(), State::Infusing);
  r.run_ms(60'000);
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::ReservoirEmpty));
  EXPECT_FALSE(r.pump.alarms().displayed(AlarmId::ReservoirLow));
}

// @req SRS-036
TEST(Controller, MotorStallRaisesHighAlarm) {
  Rig r;
  r.infusing(100.0, 50.0);
  r.stall = true;
  r.run_ms(1500);
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::MotorStall));
}

// @req SRS-037
TEST(Controller, RunawayMotorRaisesOverDelivery) {
  Rig r;
  r.infusing(100.0, 50.0);
  r.motor_gain = 3.0;
  r.run_ms(1000);
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::OverDelivery));
}

// @req SRS-037
TEST(Controller, UncommandedMotionWhileStoppedRaisesAlarm) {
  Rig r;
  r.ready();
  r.uncommanded_sps = 50.0;
  r.run_ms(1000);
  EXPECT_EQ(r.pump.state(), State::Alarm);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::OverDelivery));
}

// @req SRS-038
TEST(Controller, PausedReminderAfterTwoMinutes) {
  Rig r;
  r.infusing();
  r.pump.pause(r.t);
  r.run_ms(119'000);
  EXPECT_FALSE(r.pump.alarms().displayed(AlarmId::PausedTooLong));
  r.run_ms(2'000);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::PausedTooLong));
  EXPECT_EQ(r.pump.alarms().highest(), Priority::Low);
  r.pump.start(r.t);
  r.cycle();
  EXPECT_FALSE(r.pump.alarms().displayed(AlarmId::PausedTooLong));
}

// @req SRS-042
TEST(Controller, SilenceRequiresAnActiveAlarm) {
  Rig r;
  r.cycle();
  EXPECT_FALSE(r.pump.silence(r.t).ok);
  r.infusing();
  r.air_next = 80.0;
  r.cycle();
  EXPECT_TRUE(r.pump.silence(r.t).ok);
  EXPECT_FALSE(r.pump.alarms().audible(r.t));
}

// --- System integrity ----------------------------------------------------------

// @req SRS-050, SRS-053
TEST(Controller, ImplausibleSensorForcesFaultUntilReset) {
  Rig r;
  r.infusing();
  r.downstream = 4000.0;
  r.cycle();
  EXPECT_EQ(r.pump.state(), State::Fault);
  EXPECT_FALSE(r.pump.motor().enabled);

  r.downstream = 20.0;
  r.run_ms(1000);
  r.pump.acknowledge(r.t);
  EXPECT_EQ(r.pump.state(), State::Fault);
  EXPECT_FALSE(r.pump.start(r.t).ok);
  EXPECT_FALSE(r.program("saline", 10.0, 10.0).ok);

  r.pump.reset(r.t);
  r.cycle();
  EXPECT_EQ(r.pump.state(), State::Idle);
  EXPECT_FALSE(r.pump.primed());
  EXPECT_EQ(r.pump.alarms().highest(), Priority::None);
}

// @req SRS-051
TEST(Controller, FrozenPressureSensorDetected) {
  Rig r;
  r.infusing();
  // Freeze the reading: feed identical frames.
  for (int i = 0; i < 60; ++i) {
    r.t += 100;
    r.encoder += 6;
    r.pump.on_sensor_frame(SensorFrame{r.t, 33.3, 5.0, 0.0, 200.0, r.encoder});
    r.pump.tick(r.t);
  }
  EXPECT_EQ(r.pump.state(), State::Fault);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::SensorFault));
}

// @req SRS-052
TEST(Controller, WatchdogDetectsLostSensorStream) {
  Rig r;
  r.infusing();
  r.send_frames = false;
  r.run_ms(500);
  EXPECT_EQ(r.pump.state(), State::Infusing);
  r.run_ms(200);
  EXPECT_EQ(r.pump.state(), State::Fault);
  EXPECT_TRUE(r.pump.alarms().displayed(AlarmId::CommunicationLoss));
  EXPECT_FALSE(r.pump.motor().enabled);
}

// @req SRS-054
TEST(Controller, EncoderRegressionIsSensorFault) {
  Rig r;
  r.infusing();
  r.encoder -= 100;
  r.cycle();
  EXPECT_EQ(r.pump.state(), State::Fault);
}

// @req SRS-060
TEST(Controller, EventLogRecordsCommandsStatesAndAlarms) {
  Rig r;
  r.infusing();
  r.air_next = 90.0;
  r.cycle();
  const auto& log = r.pump.log();
  EXPECT_TRUE(log.contains("COMMAND", "PROGRAM"));
  EXPECT_TRUE(log.contains("COMMAND", "START"));
  EXPECT_TRUE(log.contains("STATE", "READY -> INFUSING"));
  EXPECT_TRUE(log.contains("ALARM", "AIR_IN_LINE"));
  EXPECT_TRUE(log.contains("STATE", "INFUSING -> ALARM"));
  std::uint64_t prev = 0;
  for (const auto& e : log.entries()) {
    EXPECT_GT(e.seq, prev);
    prev = e.seq;
  }
}

TEST(EventLog, IsBoundedAndSupportsIncrementalReads) {
  EventLog log(3);
  for (int i = 0; i < 5; ++i) log.add(i, "X", std::to_string(i));
  EXPECT_EQ(log.entries().size(), 3u);
  EXPECT_EQ(log.last_seq(), 5u);
  EXPECT_EQ(log.since(3).size(), 2u);
  EXPECT_FALSE(log.contains("X", "0"));
  EXPECT_TRUE(log.contains("X", "4"));
}

TEST(Controller, SensitivityChangeIsLogged) {
  Rig r;
  r.cycle();
  r.pump.set_sensitivity(OcclusionSensitivity::High, r.t);
  EXPECT_DOUBLE_EQ(r.pump.occlusion().threshold_mmhg(), 300.0);
  EXPECT_TRUE(r.pump.log().contains("COMMAND", "300 mmHg"));
}

TEST(Types, StateNames) {
  EXPECT_EQ(to_string(State::Idle), "IDLE");
  EXPECT_EQ(to_string(State::Ready), "READY");
  EXPECT_EQ(to_string(State::Priming), "PRIMING");
  EXPECT_EQ(to_string(State::Infusing), "INFUSING");
  EXPECT_EQ(to_string(State::Paused), "PAUSED");
  EXPECT_EQ(to_string(State::Kvo), "KVO");
  EXPECT_EQ(to_string(State::Alarm), "ALARM");
  EXPECT_EQ(to_string(State::Fault), "FAULT");
}
