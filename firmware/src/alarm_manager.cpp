// SPDX-License-Identifier: MIT
#include "pump/alarm_manager.hpp"

#include <algorithm>

#include "pump/config.hpp"

namespace pump {

AlarmManager::AlarmManager() {
  for (std::size_t i = 0; i < kAlarmCount; ++i) records_[i].id = static_cast<AlarmId>(i);
}

bool AlarmManager::set_condition(AlarmId id, bool present, TimeMs now) {
  AlarmRecord& r = at(id);
  if (!present) {
    r.condition = false;
    return false;
  }
  const bool is_new = !r.displayed();
  r.condition = true;
  if (is_new) {
    r.raised_at = now;
    r.latched = is_latching(id);
    silenced_until_ = -1;  // SRS-042: a new alarm cancels audio silence.
  }
  return is_new;
}

int AlarmManager::acknowledge() {
  int cleared = 0;
  for (auto& r : records_) {
    if (r.latched && !r.condition) {  // SRS-043: a present condition cannot be acknowledged away.
      r.latched = false;
      ++cleared;
    }
  }
  return cleared;
}

void AlarmManager::silence(TimeMs now) { silenced_until_ = now + cfg::kSilenceMs; }

void AlarmManager::clear_all() {
  for (auto& r : records_) {
    r.condition = false;
    r.latched = false;
  }
  silenced_until_ = -1;
}

Priority AlarmManager::highest() const {
  Priority p = Priority::None;
  for (const auto& r : records_) {
    if (r.displayed() && r.priority() > p) p = r.priority();
  }
  return p;
}

bool AlarmManager::any_displayed_at(Priority p) const {
  return std::any_of(records_.begin(), records_.end(),
                     [p](const AlarmRecord& r) { return r.displayed() && r.priority() == p; });
}

bool AlarmManager::any_system_fault() const {
  return std::any_of(records_.begin(), records_.end(),
                     [](const AlarmRecord& r) { return r.displayed() && is_system_fault(r.id); });
}

TimeMs AlarmManager::silence_remaining(TimeMs now) const {
  return silenced(now) ? silenced_until_ - now : 0;
}

bool AlarmManager::audible(TimeMs now) const {
  return highest() != Priority::None && !silenced(now);
}

std::vector<AlarmRecord> AlarmManager::active_list() const {
  std::vector<AlarmRecord> out;
  for (const auto& r : records_) {
    if (r.displayed()) out.push_back(r);
  }
  std::stable_sort(out.begin(), out.end(), [](const AlarmRecord& a, const AlarmRecord& b) {
    if (a.priority() != b.priority()) return a.priority() > b.priority();
    return a.raised_at > b.raised_at;
  });
  return out;
}

}  // namespace pump
