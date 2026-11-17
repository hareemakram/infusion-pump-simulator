// SPDX-License-Identifier: MIT
#include <gtest/gtest.h>

#include "pump/alarm_manager.hpp"
#include "pump/config.hpp"

using namespace pump;

// @req SRS-040
TEST(AlarmManager, PrioritiesFollowIec60601_1_8Classification) {
  EXPECT_EQ(priority_of(AlarmId::DownstreamOcclusion), Priority::High);
  EXPECT_EQ(priority_of(AlarmId::AirInLine), Priority::High);
  EXPECT_EQ(priority_of(AlarmId::OverDelivery), Priority::High);
  EXPECT_EQ(priority_of(AlarmId::InfusionComplete), Priority::Medium);
  EXPECT_EQ(priority_of(AlarmId::ReservoirLow), Priority::Low);
  EXPECT_EQ(priority_of(AlarmId::PausedTooLong), Priority::Low);
}

// @req SRS-040
TEST(AlarmManager, ListsHighestPriorityFirstThenNewest) {
  AlarmManager m;
  m.set_condition(AlarmId::ReservoirLow, true, 100);
  m.set_condition(AlarmId::AirInLine, true, 200);
  m.set_condition(AlarmId::DownstreamOcclusion, true, 300);
  m.set_condition(AlarmId::InfusionComplete, true, 400);
  const auto list = m.active_list();
  ASSERT_EQ(list.size(), 4u);
  EXPECT_EQ(list[0].id, AlarmId::DownstreamOcclusion);
  EXPECT_EQ(list[1].id, AlarmId::AirInLine);
  EXPECT_EQ(list[2].id, AlarmId::InfusionComplete);
  EXPECT_EQ(list[3].id, AlarmId::ReservoirLow);
  EXPECT_EQ(m.highest(), Priority::High);
}

// @req SRS-041
TEST(AlarmManager, HighAlarmLatchesUntilAcknowledged) {
  AlarmManager m;
  EXPECT_TRUE(m.set_condition(AlarmId::AirInLine, true, 0));
  m.set_condition(AlarmId::AirInLine, false, 100);
  EXPECT_TRUE(m.displayed(AlarmId::AirInLine));
  EXPECT_EQ(m.acknowledge(), 1);
  EXPECT_FALSE(m.displayed(AlarmId::AirInLine));
}

// @req SRS-041
TEST(AlarmManager, LowAlarmDoesNotLatch) {
  AlarmManager m;
  m.set_condition(AlarmId::ReservoirLow, true, 0);
  m.set_condition(AlarmId::ReservoirLow, false, 100);
  EXPECT_FALSE(m.displayed(AlarmId::ReservoirLow));
  EXPECT_EQ(m.highest(), Priority::None);
}

// @req SRS-043
TEST(AlarmManager, AcknowledgeDoesNotClearPresentCondition) {
  AlarmManager m;
  m.set_condition(AlarmId::DownstreamOcclusion, true, 0);
  EXPECT_EQ(m.acknowledge(), 0);
  EXPECT_TRUE(m.displayed(AlarmId::DownstreamOcclusion));
}

// @req SRS-042
TEST(AlarmManager, SilencePausesAudioFor120Seconds) {
  AlarmManager m;
  m.set_condition(AlarmId::DownstreamOcclusion, true, 0);
  EXPECT_TRUE(m.audible(0));
  m.silence(1000);
  EXPECT_FALSE(m.audible(1000));
  EXPECT_EQ(m.silence_remaining(1000), cfg::kSilenceMs);
  EXPECT_FALSE(m.audible(1000 + cfg::kSilenceMs - 1));
  EXPECT_TRUE(m.audible(1000 + cfg::kSilenceMs));
  EXPECT_EQ(m.silence_remaining(1000 + cfg::kSilenceMs), 0);
}

// @req SRS-042
TEST(AlarmManager, NewAlarmCancelsSilence) {
  AlarmManager m;
  m.set_condition(AlarmId::ReservoirLow, true, 0);
  m.silence(0);
  EXPECT_FALSE(m.audible(10));
  m.set_condition(AlarmId::AirInLine, true, 20);
  EXPECT_TRUE(m.audible(30));
}

// @req SRS-042
TEST(AlarmManager, RepeatedConditionIsNotANewAnnunciation) {
  AlarmManager m;
  EXPECT_TRUE(m.set_condition(AlarmId::DownstreamOcclusion, true, 0));
  m.silence(0);
  EXPECT_FALSE(m.set_condition(AlarmId::DownstreamOcclusion, true, 100));
  EXPECT_FALSE(m.audible(200));
}

TEST(AlarmManager, ClearAllResetsEverything) {
  AlarmManager m;
  m.set_condition(AlarmId::SensorFault, true, 0);
  EXPECT_TRUE(m.any_system_fault());
  m.clear_all();
  EXPECT_FALSE(m.any_system_fault());
  EXPECT_EQ(m.highest(), Priority::None);
  EXPECT_FALSE(m.audible(0));
}

TEST(AlarmManager, NamesAndDescriptionsExistForEveryAlarm) {
  for (std::size_t i = 0; i < kAlarmCount; ++i) {
    const auto id = static_cast<AlarmId>(i);
    EXPECT_NE(to_string(id), "UNKNOWN");
    EXPECT_FALSE(describe(id).empty());
  }
  EXPECT_EQ(to_string(AlarmId::Count), "UNKNOWN");
  EXPECT_EQ(priority_of(AlarmId::Count), Priority::None);
  EXPECT_EQ(to_string(Priority::None), "NONE");
  EXPECT_EQ(to_string(Priority::Low), "LOW");
  EXPECT_EQ(to_string(Priority::Medium), "MEDIUM");
  EXPECT_EQ(to_string(Priority::High), "HIGH");
}
