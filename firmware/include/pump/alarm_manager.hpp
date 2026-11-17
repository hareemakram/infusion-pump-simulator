// SPDX-License-Identifier: MIT
#pragma once

#include <array>
#include <vector>

#include "pump/types.hpp"

namespace pump {

struct AlarmRecord {
  AlarmId id{AlarmId::Count};
  bool condition{false};  ///< The alarm condition is currently present.
  bool latched{false};    ///< Still displayed until acknowledged.
  TimeMs raised_at{0};

  [[nodiscard]] bool displayed() const { return condition || latched; }
  [[nodiscard]] Priority priority() const { return priority_of(id); }
};

/// Implements the alarm system behaviour of SRS-040..SRS-043.
class AlarmManager {
 public:
  AlarmManager();

  /// Updates an alarm condition. Returns true when this starts a new annunciation.
  bool set_condition(AlarmId id, bool present, TimeMs now);
  /// Clears latches of alarms whose condition has gone. Returns number cleared.
  int acknowledge();
  void silence(TimeMs now);
  void clear_all();

  [[nodiscard]] bool displayed(AlarmId id) const { return at(id).displayed(); }
  [[nodiscard]] bool condition(AlarmId id) const { return at(id).condition; }
  [[nodiscard]] Priority highest() const;
  [[nodiscard]] bool any_displayed_at(Priority p) const;
  [[nodiscard]] bool any_system_fault() const;
  [[nodiscard]] bool silenced(TimeMs now) const { return silenced_until_ > now; }
  [[nodiscard]] TimeMs silence_remaining(TimeMs now) const;
  [[nodiscard]] bool audible(TimeMs now) const;
  /// Displayed alarms ordered by priority (high first), then most recent first.
  [[nodiscard]] std::vector<AlarmRecord> active_list() const;

 private:
  [[nodiscard]] const AlarmRecord& at(AlarmId id) const { return records_[static_cast<std::size_t>(id)]; }
  AlarmRecord& at(AlarmId id) { return records_[static_cast<std::size_t>(id)]; }

  std::array<AlarmRecord, kAlarmCount> records_{};
  TimeMs silenced_until_{-1};
};

}  // namespace pump
