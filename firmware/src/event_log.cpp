// SPDX-License-Identifier: MIT
#include "pump/event_log.hpp"

#include <algorithm>

namespace pump {

void EventLog::add(TimeMs t, std::string kind, std::string message) {
  entries_.push_back(Event{next_seq_++, t, std::move(kind), std::move(message)});
  while (entries_.size() > capacity_) entries_.pop_front();
}

std::vector<Event> EventLog::since(std::uint64_t seq) const {
  std::vector<Event> out;
  for (const auto& e : entries_) {
    if (e.seq > seq) out.push_back(e);
  }
  return out;
}

bool EventLog::contains(std::string_view kind, std::string_view text) const {
  return std::any_of(entries_.begin(), entries_.end(), [&](const Event& e) {
    return e.kind == kind && e.message.find(text) != std::string::npos;
  });
}

}  // namespace pump
