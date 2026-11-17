// SPDX-License-Identifier: MIT
// Line-oriented HAL wire protocol between the firmware process and the
// hardware simulator. See docs/03-software-architecture.md, section "HAL protocol".
#pragma once

#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "pump/pump_controller.hpp"

namespace pump::protocol {

struct Message {
  std::string verb;                          ///< SENSOR, TICK, CMD
  std::string name;                          ///< For CMD: the command name.
  std::map<std::string, std::string> args;   ///< key=value pairs.
};

/// Parses one input line. Returns nullopt for malformed input.
std::optional<Message> parse(std::string_view line);

std::optional<double> get_double(const Message& m, const std::string& key);
std::optional<long long> get_int(const Message& m, const std::string& key);

/// Stateful adapter: feeds parsed messages into a PumpController and
/// produces the response lines (SRS-070).
class Session {
 public:
  explicit Session(PumpController& pump) : pump_(pump) {}
  /// Handles one input line and returns the output lines (may be empty).
  std::vector<std::string> handle(std::string_view line);

 private:
  std::vector<std::string> handle_cmd(const Message& m);
  std::string status_line() const;
  void drain_events(std::vector<std::string>& out);

  PumpController& pump_;
  std::uint64_t events_sent_{0};
  TimeMs last_t_{0};
};

std::string format_number(double v);

}  // namespace pump::protocol
