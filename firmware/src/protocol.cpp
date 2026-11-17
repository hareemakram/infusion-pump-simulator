// SPDX-License-Identifier: MIT
#include "pump/protocol.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <sstream>

#include "pump/config.hpp"

namespace pump::protocol {

std::string format_number(double v) {
  if (!std::isfinite(v)) return "0";
  char buf[48];
  std::snprintf(buf, sizeof buf, "%.4f", v);
  std::string s(buf);
  // Trim trailing zeros for compact output.
  while (!s.empty() && s.back() == '0') s.pop_back();
  if (!s.empty() && s.back() == '.') s.pop_back();
  if (s == "-0") s = "0";
  return s;
}

std::optional<Message> parse(std::string_view line) {
  while (!line.empty() && (line.back() == '\r' || line.back() == '\n' || line.back() == ' ')) {
    line.remove_suffix(1);
  }
  std::istringstream in{std::string(line)};
  Message m;
  if (!(in >> m.verb)) return std::nullopt;
  if (m.verb != "SENSOR" && m.verb != "TICK" && m.verb != "CMD") return std::nullopt;
  if (m.verb == "CMD" && !(in >> m.name)) return std::nullopt;
  std::string tok;
  while (in >> tok) {
    const auto eq = tok.find('=');
    if (eq == std::string::npos || eq == 0) return std::nullopt;
    m.args[tok.substr(0, eq)] = tok.substr(eq + 1);
  }
  return m;
}

std::optional<double> get_double(const Message& m, const std::string& key) {
  const auto it = m.args.find(key);
  if (it == m.args.end() || it->second.empty()) return std::nullopt;
  char* end = nullptr;
  const double v = std::strtod(it->second.c_str(), &end);
  if (end == nullptr || *end != '\0' || !std::isfinite(v)) return std::nullopt;
  return v;
}

std::optional<long long> get_int(const Message& m, const std::string& key) {
  const auto it = m.args.find(key);
  if (it == m.args.end() || it->second.empty()) return std::nullopt;
  char* end = nullptr;
  const long long v = std::strtoll(it->second.c_str(), &end, 10);
  if (end == nullptr || *end != '\0') return std::nullopt;
  return v;
}

namespace {
std::string resp(const std::string& cmd, const CommandResult& r) {
  std::string s = "RESP cmd=" + cmd + " ok=" + (r.ok ? "1" : "0");
  if (!r.reason.empty()) s += " reason=" + r.reason;
  return s;
}
std::string err(const std::string& msg) { return "ERR msg=" + msg; }
}  // namespace

void Session::drain_events(std::vector<std::string>& out) {
  for (const auto& e : pump_.log().since(events_sent_)) {
    out.push_back("EVT seq=" + std::to_string(e.seq) + " t=" + std::to_string(e.t_ms) + " kind=" + e.kind +
                  " msg=" + e.message);
    events_sent_ = e.seq;
  }
}

std::string Session::status_line() const {
  const auto& p = pump_.program();
  const Drug* d = pump_.drug();
  const auto& f = pump_.last_frame();
  const auto now = pump_.now();
  std::ostringstream s;
  s << "STATUS t=" << now << " state=" << to_string(pump_.state()) << " primed=" << (pump_.primed() ? 1 : 0)
    << " motor=" << (pump_.motor().enabled ? 1 : 0) << " sps=" << format_number(pump_.motor().steps_per_s)
    << " active_rate=" << format_number(pump_.active_rate_ml_h())
    << " rate=" << format_number(p ? p->rate_ml_h : 0.0) << " vtbi=" << format_number(p ? p->vtbi_ml : 0.0)
    << " weight=" << format_number(p ? p->weight_kg : 0.0)
    << " infused=" << format_number(pump_.infused_ml()) << " prime=" << format_number(pump_.prime_ml())
    << " remaining=" << format_number(pump_.remaining_ml());
  const auto tr = pump_.time_remaining_s();
  s << " t_remaining=" << (tr ? format_number(*tr) : std::string("-"));
  s << " drug=" << (d ? d->id : std::string("-")) << " dose=" << format_number(pump_.dose())
    << " dose_unit=" << (d ? d->dose_unit : std::string("-"));
  s << " pd=" << format_number(f ? f->downstream_mmhg : 0.0) << " pu=" << format_number(f ? f->upstream_mmhg : 0.0)
    << " res=" << format_number(f ? f->reservoir_ml : 0.0)
    << " air_cum=" << format_number(pump_.air_cumulative_ul())
    << " threshold=" << format_number(pump_.occlusion().threshold_mmhg())
    << " sens=" << to_string(pump_.occlusion().sensitivity());
  const auto& a = pump_.alarms();
  s << " highest=" << to_string(a.highest()) << " audible=" << (a.audible(now) ? 1 : 0)
    << " silence_ms=" << a.silence_remaining(now);
  s << " alarms=";
  const auto list = a.active_list();
  if (list.empty()) {
    s << "-";
  } else {
    for (std::size_t i = 0; i < list.size(); ++i) {
      if (i) s << ",";
      s << to_string(list[i].id) << ":" << to_string(list[i].priority()).substr(0, 1) << ":"
        << (list[i].condition ? 1 : 0) << ":" << list[i].raised_at;
    }
  }
  return s.str();
}

std::vector<std::string> Session::handle(std::string_view line) {
  std::vector<std::string> out;
  const auto msg = parse(line);
  if (!msg) {
    out.push_back(err("malformed line"));
    return out;
  }
  if (msg->verb == "SENSOR") {
    const auto t = get_int(*msg, "t");
    const auto pd = get_double(*msg, "pd");
    const auto pu = get_double(*msg, "pu");
    const auto air = get_double(*msg, "air");
    const auto res = get_double(*msg, "res");
    const auto enc = get_int(*msg, "enc");
    if (!t || !pd || !pu || !air || !res || !enc) {
      out.push_back(err("SENSOR requires t pd pu air res enc"));
      return out;
    }
    last_t_ = *t;
    pump_.on_sensor_frame(SensorFrame{*t, *pd, *pu, *air, *res, *enc});
    return out;  // events are flushed with the next STATUS/RESP
  }
  if (msg->verb == "TICK") {
    const auto t = get_int(*msg, "t");
    if (!t) {
      out.push_back(err("TICK requires t"));
      return out;
    }
    last_t_ = *t;
    const MotorCommand m = pump_.tick(*t);
    drain_events(out);
    (void)m;
    out.push_back(status_line());
    return out;
  }
  out = handle_cmd(*msg);
  return out;
}

std::vector<std::string> Session::handle_cmd(const Message& m) {
  std::vector<std::string> out;
  const TimeMs now = get_int(m, "t").value_or(last_t_);
  const bool confirm = get_int(m, "confirm").value_or(0) != 0;
  CommandResult r;

  if (m.name == "PROGRAM") {
    InfusionProgram p;
    const auto it = m.args.find("drug");
    const auto rate = get_double(m, "rate");
    const auto vtbi = get_double(m, "vtbi");
    if (it == m.args.end() || !rate || !vtbi) {
      out.push_back(err("PROGRAM requires drug rate vtbi"));
      return out;
    }
    p.drug_id = it->second;
    p.rate_ml_h = *rate;
    p.vtbi_ml = *vtbi;
    p.weight_kg = get_double(m, "weight").value_or(0.0);
    r = pump_.program(p, confirm, now);
  } else if (m.name == "PRIME") {
    r = pump_.prime(now);
  } else if (m.name == "START") {
    r = pump_.start(now);
  } else if (m.name == "PAUSE") {
    r = pump_.pause(now);
  } else if (m.name == "STOP") {
    r = pump_.stop(now);
  } else if (m.name == "TITRATE") {
    const auto rate = get_double(m, "rate");
    if (!rate) {
      out.push_back(err("TITRATE requires rate"));
      return out;
    }
    r = pump_.titrate(*rate, confirm, now);
  } else if (m.name == "ACK") {
    r = pump_.acknowledge(now);
  } else if (m.name == "SILENCE") {
    r = pump_.silence(now);
  } else if (m.name == "SENS") {
    const auto it = m.args.find("level");
    const std::string lvl = it == m.args.end() ? "" : it->second;
    if (lvl == "LOW") {
      r = pump_.set_sensitivity(OcclusionSensitivity::Low, now);
    } else if (lvl == "MEDIUM") {
      r = pump_.set_sensitivity(OcclusionSensitivity::Medium, now);
    } else if (lvl == "HIGH") {
      r = pump_.set_sensitivity(OcclusionSensitivity::High, now);
    } else {
      out.push_back(err("SENS level must be LOW, MEDIUM or HIGH"));
      return out;
    }
  } else if (m.name == "RESET") {
    pump_.reset(now);
    r = CommandResult::accept();
  } else if (m.name == "LIBRARY") {
    out.push_back("LIBVER version=" + pump_.library().version());
    for (const auto& d : pump_.library().drugs()) {
      out.push_back("DRUG id=" + d.id + " conc=" + format_number(d.concentration) + " amount_unit=" + d.amount_unit +
                    " dose_unit=" + d.dose_unit + " wb=" + (d.weight_based ? "1" : "0") +
                    " smin=" + format_number(d.soft_min) + " smax=" + format_number(d.soft_max) +
                    " hmin=" + format_number(d.hard_min) + " hmax=" + format_number(d.hard_max) +
                    " maxrate=" + format_number(d.max_rate_ml_h) + " name=" + d.name);
    }
    r = CommandResult::accept();
  } else if (m.name == "STATUS") {
    drain_events(out);
    out.push_back(status_line());
    return out;
  } else {
    out.push_back(err("unknown command " + m.name));
    return out;
  }
  drain_events(out);
  out.push_back(resp(m.name, r));
  return out;
}

}  // namespace pump::protocol
