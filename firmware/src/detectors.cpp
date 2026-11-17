// SPDX-License-Identifier: MIT
#include "pump/detectors.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "pump/config.hpp"

namespace pump {

// Debouncer -------------------------------------------------------------------

bool Debouncer::update(bool condition, TimeMs now) {
  if (!condition) {
    since_.reset();
    active_ = false;
    return false;
  }
  if (!since_) since_ = now;
  active_ = (now - *since_) >= hold_ms_;
  return active_;
}

void Debouncer::reset() {
  since_.reset();
  active_ = false;
}

// OcclusionDetector -----------------------------------------------------------

OcclusionDetector::OcclusionDetector(OcclusionSensitivity s)
    : sensitivity_(s), downstream_(cfg::kDownstreamDebounceMs), upstream_(cfg::kUpstreamDebounceMs) {}

double OcclusionDetector::threshold_mmhg() const { return cfg::occlusion_threshold(sensitivity_); }

OcclusionDetector::Result OcclusionDetector::update(const SensorFrame& f) {
  const double thr = threshold_mmhg();
  // Hysteresis: once active, the condition only clears below 80 % of threshold.
  const bool down_cond = downstream_.active() ? f.downstream_mmhg > thr * cfg::kOcclusionClearFraction
                                              : f.downstream_mmhg > thr;
  Result r;
  if (downstream_.active() && down_cond) {
    r.downstream = true;  // stay active without re-debouncing
  } else {
    r.downstream = downstream_.update(down_cond, f.t_ms);
  }
  r.upstream = upstream_.update(f.upstream_mmhg < cfg::kUpstreamThresholdMmHg, f.t_ms);
  return r;
}

void OcclusionDetector::reset() {
  downstream_.reset();
  upstream_.reset();
}

// AirInLineDetector -----------------------------------------------------------

bool AirInLineDetector::update(double air_ul, TimeMs now) {
  if (air_ul > 0.0) {
    window_.emplace_back(now, air_ul);
    cumulative_ += air_ul;
  }
  while (!window_.empty() && now - window_.front().first > cfg::kAirWindowMs) {
    cumulative_ -= window_.front().second;
    window_.pop_front();
  }
  if (window_.empty()) cumulative_ = 0.0;  // avoid floating point drift
  return air_ul >= cfg::kAirSingleBubbleUl || cumulative_ >= cfg::kAirCumulativeUl;
}

void AirInLineDetector::reset() {
  window_.clear();
  cumulative_ = 0.0;
}

// FlowMonitor -----------------------------------------------------------------

FlowMonitor::Result FlowMonitor::update(TimeMs now, double commanded_steps, double delivered_steps) {
  window_.push_back({now, commanded_steps, delivered_steps});
  sum_cmd_ += commanded_steps;
  sum_del_ += delivered_steps;
  while (!window_.empty() && now - window_.front().t > cfg::kFlowWindowMs) {
    sum_cmd_ -= window_.front().cmd;
    sum_del_ -= window_.front().del;
    window_.pop_front();
  }

  if (delivered_steps > 0.0) {
    since_motion_ = 0.0;
  } else {
    since_motion_ += commanded_steps;
  }

  Result r;
  r.stalled = since_motion_ >= cfg::kStallSteps;
  const double allowed = std::max(cfg::kOverDeliveryAbsSteps, cfg::kOverDeliveryFraction * sum_cmd_);
  r.over_delivery = (sum_del_ - sum_cmd_) > allowed;
  return r;
}

void FlowMonitor::reset() {
  window_.clear();
  sum_cmd_ = 0.0;
  sum_del_ = 0.0;
  since_motion_ = 0.0;
}

// SensorPlausibility ----------------------------------------------------------

namespace {
std::string range_msg(const char* what, double v) {
  char buf[96];
  std::snprintf(buf, sizeof buf, "%s reading %.1f out of plausible range", what, v);
  return buf;
}
bool outside(double v, double lo, double hi) { return !std::isfinite(v) || v < lo || v > hi; }
}  // namespace

std::optional<std::string> SensorPlausibility::check(const SensorFrame& f, bool motor_running) {
  std::optional<std::string> reason;
  if (outside(f.downstream_mmhg, cfg::kDownstreamMinMmHg, cfg::kDownstreamMaxMmHg)) {
    reason = range_msg("Downstream pressure", f.downstream_mmhg);
  } else if (outside(f.upstream_mmhg, cfg::kUpstreamMinMmHg, cfg::kUpstreamMaxMmHg)) {
    reason = range_msg("Upstream pressure", f.upstream_mmhg);
  } else if (outside(f.reservoir_ml, -1.0, cfg::kReservoirMaxMl)) {
    reason = range_msg("Container level", f.reservoir_ml);
  } else if (outside(f.air_ul, 0.0, cfg::kAirMaxUl)) {
    reason = range_msg("Air detector", f.air_ul);
  } else if (prev_ && f.encoder_steps < prev_->encoder_steps) {
    reason = std::string("Motor encoder count decreased");
  } else if (prev_ && f.t_ms <= prev_->t_ms) {
    reason = std::string("Sensor timestamp not increasing");
  }

  if (!reason && prev_ && motor_running && f.downstream_mmhg == prev_->downstream_mmhg) {
    if (++identical_count_ >= cfg::kStuckSensorFrames) {
      reason = std::string("Downstream pressure sensor frozen");
    }
  } else {
    identical_count_ = 0;
  }

  prev_ = f;
  return reason;
}

void SensorPlausibility::reset() {
  prev_.reset();
  identical_count_ = 0;
}

}  // namespace pump
