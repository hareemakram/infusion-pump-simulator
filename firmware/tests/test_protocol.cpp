// SPDX-License-Identifier: MIT
#include <gtest/gtest.h>

#include <cmath>

#include "pump/protocol.hpp"

using namespace pump;
using namespace pump::protocol;

namespace {
bool starts_with(const std::string& s, const char* p) { return s.rfind(p, 0) == 0; }

std::string last(const std::vector<std::string>& v) { return v.empty() ? std::string() : v.back(); }

struct Wire {
  PumpController pump;
  Session session{pump};
  long long t{0};
  long long enc{0};

  std::vector<std::string> cycle(double pd = 20.0) {
    t += 100;
    enc += pump.motor().enabled ? static_cast<long long>(pump.motor().steps_per_s / 10.0) : 0;
    session.handle("SENSOR t=" + std::to_string(t) + " pd=" + format_number(pd + (t % 200 ? 0.1 : 0.0)) +
                   " pu=5 air=0 res=200 enc=" + std::to_string(enc));
    return session.handle("TICK t=" + std::to_string(t));
  }
};
}  // namespace

// @req SRS-070
TEST(Protocol, ParsesKeyValueMessages) {
  const auto m = parse("CMD PROGRAM drug=heparin rate=12.5 vtbi=250\r\n");
  ASSERT_TRUE(m);
  EXPECT_EQ(m->verb, "CMD");
  EXPECT_EQ(m->name, "PROGRAM");
  EXPECT_EQ(m->args.at("drug"), "heparin");
  EXPECT_DOUBLE_EQ(*get_double(*m, "rate"), 12.5);
  EXPECT_FALSE(get_double(*m, "weight").has_value());
}

// @req SRS-070
TEST(Protocol, RejectsMalformedLines) {
  EXPECT_FALSE(parse(""));
  EXPECT_FALSE(parse("HELLO world"));
  EXPECT_FALSE(parse("CMD"));
  EXPECT_FALSE(parse("SENSOR t=1 garbage"));
  EXPECT_FALSE(parse("SENSOR =5"));
  const auto m = parse("TICK t=abc");
  ASSERT_TRUE(m);
  EXPECT_FALSE(get_int(*m, "t"));
  EXPECT_FALSE(get_double(*m, "t"));
}

// @req SRS-070, SRS-015
TEST(Protocol, MalformedInputProducesErrorWithoutStateChange) {
  Wire w;
  w.cycle();
  EXPECT_TRUE(starts_with(last(w.session.handle("NONSENSE")), "ERR"));
  EXPECT_TRUE(starts_with(last(w.session.handle("SENSOR t=5 pd=1")), "ERR"));
  EXPECT_TRUE(starts_with(last(w.session.handle("TICK")), "ERR"));
  EXPECT_TRUE(starts_with(last(w.session.handle("CMD PROGRAM drug=saline")), "ERR"));
  EXPECT_TRUE(starts_with(last(w.session.handle("CMD TITRATE")), "ERR"));
  EXPECT_TRUE(starts_with(last(w.session.handle("CMD SENS level=MAX")), "ERR"));
  EXPECT_TRUE(starts_with(last(w.session.handle("CMD SELF_DESTRUCT")), "ERR"));
  EXPECT_EQ(w.pump.state(), State::Idle);
}

// @req SRS-070
TEST(Protocol, TickReturnsStatusLine) {
  Wire w;
  const auto out = w.cycle();
  const std::string s = last(out);
  EXPECT_TRUE(starts_with(s, "STATUS t=100 state=IDLE"));
  EXPECT_NE(s.find("alarms=-"), std::string::npos);
  EXPECT_NE(s.find("threshold=500"), std::string::npos);
}

// @req SRS-070, SRS-060
TEST(Protocol, FullInfusionOverTheWire) {
  Wire w;
  w.cycle();
  auto out = w.session.handle("CMD PROGRAM drug=saline rate=480 vtbi=1");
  EXPECT_EQ(last(out), "RESP cmd=PROGRAM ok=1");
  EXPECT_TRUE(starts_with(out.front(), "EVT"));
  EXPECT_EQ(last(w.session.handle("CMD START")), "RESP cmd=START ok=0 reason=Line not primed");
  EXPECT_EQ(last(w.session.handle("CMD PRIME")), "RESP cmd=PRIME ok=1");
  for (int i = 0; i < 130; ++i) w.cycle();
  EXPECT_EQ(w.pump.state(), State::Ready);
  EXPECT_EQ(last(w.session.handle("CMD START")), "RESP cmd=START ok=1");
  std::string status;
  for (int i = 0; i < 100; ++i) status = last(w.cycle());
  EXPECT_NE(status.find("state=KVO"), std::string::npos);
  EXPECT_NE(status.find("INFUSION_COMPLETE:M:0"), std::string::npos);
  EXPECT_EQ(last(w.session.handle("CMD ACK")), "RESP cmd=ACK ok=1");
  EXPECT_EQ(last(w.session.handle("CMD PAUSE")), "RESP cmd=PAUSE ok=1");
  EXPECT_EQ(last(w.session.handle("CMD STOP")), "RESP cmd=STOP ok=1");
  EXPECT_TRUE(starts_with(last(w.session.handle("CMD STATUS")), "STATUS"));
}

// @req SRS-070, SRS-004
TEST(Protocol, SoftLimitConfirmationOverTheWire) {
  Wire w;
  w.cycle();
  const auto r1 = last(w.session.handle("CMD PROGRAM drug=heparin rate=25 vtbi=100"));
  EXPECT_TRUE(starts_with(r1, "RESP cmd=PROGRAM ok=0 reason=CONFIRM_REQUIRED"));
  EXPECT_EQ(last(w.session.handle("CMD PROGRAM drug=heparin rate=25 vtbi=100 confirm=1")),
            "RESP cmd=PROGRAM ok=1");
  EXPECT_TRUE(starts_with(last(w.session.handle("CMD TITRATE rate=40")), "RESP cmd=TITRATE ok=0"));
}

// @req SRS-070
TEST(Protocol, LibraryListsEveryDrug) {
  Wire w;
  const auto out = w.session.handle("CMD LIBRARY");
  ASSERT_GE(out.size(), 3u);
  EXPECT_TRUE(starts_with(out.front(), "LIBVER version="));
  int drugs = 0;
  for (const auto& l : out) drugs += starts_with(l, "DRUG ") ? 1 : 0;
  EXPECT_EQ(drugs, static_cast<int>(w.pump.library().drugs().size()));
  EXPECT_NE(out[1].find("name=Sodium chloride 0.9%"), std::string::npos);
  EXPECT_EQ(last(out), "RESP cmd=LIBRARY ok=1");
}

// @req SRS-070, SRS-031, SRS-042, SRS-053
TEST(Protocol, SensitivitySilenceAndReset) {
  Wire w;
  w.cycle();
  EXPECT_EQ(last(w.session.handle("CMD SENS level=HIGH")), "RESP cmd=SENS ok=1");
  EXPECT_NE(last(w.cycle()).find("threshold=300"), std::string::npos);
  EXPECT_EQ(last(w.session.handle("CMD SENS level=LOW")), "RESP cmd=SENS ok=1");
  EXPECT_EQ(last(w.session.handle("CMD SENS level=MEDIUM")), "RESP cmd=SENS ok=1");
  EXPECT_EQ(last(w.session.handle("CMD SILENCE")), "RESP cmd=SILENCE ok=0 reason=No active alarm");
  w.session.handle("SENSOR t=1000 pd=5000 pu=0 air=0 res=100 enc=0");
  const auto st = last(w.session.handle("TICK t=1000"));
  EXPECT_NE(st.find("state=FAULT"), std::string::npos);
  EXPECT_NE(st.find("SENSOR_FAULT:H:1"), std::string::npos);
  EXPECT_EQ(last(w.session.handle("CMD SILENCE")), "RESP cmd=SILENCE ok=1");
  EXPECT_NE(last(w.session.handle("CMD STATUS")).find("audible=0"), std::string::npos);
  EXPECT_EQ(last(w.session.handle("CMD RESET")), "RESP cmd=RESET ok=1");
  EXPECT_EQ(w.pump.state(), State::Idle);
}

TEST(Protocol, FormatNumberIsCompact) {
  EXPECT_EQ(format_number(1.5), "1.5");
  EXPECT_EQ(format_number(2.0), "2");
  EXPECT_EQ(format_number(-0.00001), "0");
  EXPECT_EQ(format_number(std::nan("")), "0");
  EXPECT_EQ(format_number(0.12345), "0.1235");
}
