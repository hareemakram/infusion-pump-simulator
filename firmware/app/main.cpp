// SPDX-License-Identifier: MIT
// pump_firmware: runs the pump control software as a process and exposes the
// HAL wire protocol on stdin/stdout, so the hardware simulator can stand in
// for the real sensors and motor driver.
#include <iostream>
#include <string>

#include "pump/protocol.hpp"

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--version") {
      std::cout << "pump_firmware 1.0.0\n";
      return 0;
    }
    if (arg == "--help") {
      std::cout << "Usage: pump_firmware\n"
                   "Reads HAL protocol lines (SENSOR, TICK, CMD) on stdin and writes\n"
                   "EVT, STATUS, RESP, DRUG and ERR lines on stdout.\n";
      return 0;
    }
  }
  std::ios::sync_with_stdio(false);
  pump::PumpController controller;
  pump::protocol::Session session(controller);
  std::cout << "HELLO firmware=1.0.0 protocol=1" << std::endl;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line == "QUIT") break;
    const auto out = session.handle(line);
    for (const auto& l : out) std::cout << l << '\n';
    if (!out.empty()) std::cout.flush();
  }
  return 0;
}
