// SPDX-License-Identifier: MIT
#pragma once

#include <cstdint>
#include <deque>
#include <string>
#include <vector>

#include "pump/types.hpp"

namespace pump {

struct Event {
  std::uint64_t seq{0};
  TimeMs t_ms{0};
  std::string kind;     ///< COMMAND, STATE, ALARM, OVERRIDE, REJECT, SYSTEM
  std::string message;
};

/// Bounded audit trail of everything safety relevant (SRS-060).
class EventLog {
 public:
  explicit EventLog(std::size_t capacity = 1000) : capacity_(capacity) {}

  void add(TimeMs t, std::string kind, std::string message);
  [[nodiscard]] std::vector<Event> since(std::uint64_t seq) const;
  [[nodiscard]] const std::deque<Event>& entries() const { return entries_; }
  [[nodiscard]] std::uint64_t last_seq() const { return next_seq_ - 1; }
  [[nodiscard]] bool contains(std::string_view kind, std::string_view text) const;

 private:
  std::size_t capacity_;
  std::uint64_t next_seq_{1};
  std::deque<Event> entries_;
};

}  // namespace pump
