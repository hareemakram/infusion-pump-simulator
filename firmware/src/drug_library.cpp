// SPDX-License-Identifier: MIT
#include "pump/drug_library.hpp"

#include <cmath>
#include <cstdio>

#include "pump/config.hpp"

namespace pump {

namespace {
std::string fmt(double v) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%g", v);
  return buf;
}
}  // namespace

std::string_view to_string(LimitCheck c) {
  switch (c) {
    case LimitCheck::Ok: return "OK";
    case LimitCheck::SoftLow: return "SOFT_LOW";
    case LimitCheck::SoftHigh: return "SOFT_HIGH";
    case LimitCheck::HardLow: return "HARD_LOW";
    case LimitCheck::HardHigh: return "HARD_HIGH";
    case LimitCheck::Invalid: return "INVALID";
  }
  return "INVALID";
}

double dose_rate(const Drug& drug, double rate_ml_h, double weight_kg) {
  const double amount_per_h = rate_ml_h * drug.concentration;
  if (drug.weight_based) {
    return weight_kg > 0.0 ? amount_per_h / weight_kg : 0.0;
  }
  return amount_per_h;
}

DrugLibrary::DrugLibrary(std::string version, std::vector<Drug> drugs)
    : version_(std::move(version)), drugs_(std::move(drugs)) {}

DrugLibrary DrugLibrary::standard() {
  // Illustrative values for a simulator. NOT clinical guidance.
  return DrugLibrary(
      "DL-2026.11-demo",
      {
          {"saline", "Sodium chloride 0.9%", 1.0, "mL", "mL/h", false, 1.0, 500.0, 0.1, 999.0, 999.0},
          {"heparin", "Heparin", 100.0, "units", "units/h", false, 200.0, 2000.0, 0.0, 3000.0, 50.0},
          {"insulin", "Insulin (regular)", 1.0, "units", "units/h", false, 0.5, 15.0, 0.0, 25.0, 30.0},
          {"morphine", "Morphine", 1.0, "mg", "mg/h", false, 0.5, 10.0, 0.0, 15.0, 20.0},
          {"propofol", "Propofol", 10.0, "mg", "mg/kg/h", true, 0.3, 4.0, 0.0, 6.0, 100.0},
          {"norepinephrine", "Norepinephrine", 0.064, "mg", "mg/kg/h", true, 0.0006, 0.06, 0.0, 0.12, 50.0},
      });
}

const Drug* DrugLibrary::find(std::string_view id) const {
  for (const auto& d : drugs_) {
    if (d.id == id) return &d;
  }
  return nullptr;
}

ValidationResult DrugLibrary::validate(const InfusionProgram& p) const {
  ValidationResult r;
  const Drug* drug = find(p.drug_id);
  if (drug == nullptr) {
    r.message = "Unknown drug '" + p.drug_id + "'";
    return r;
  }
  if (!std::isfinite(p.rate_ml_h) || p.rate_ml_h < cfg::kMinRateMlH || p.rate_ml_h > cfg::kMaxRateMlH) {
    r.message = "Rate outside pump range " + fmt(cfg::kMinRateMlH) + "-" + fmt(cfg::kMaxRateMlH) + " mL/h";
    return r;
  }
  if (!std::isfinite(p.vtbi_ml) || p.vtbi_ml < cfg::kMinVtbiMl || p.vtbi_ml > cfg::kMaxVtbiMl) {
    r.message = "VTBI outside range " + fmt(cfg::kMinVtbiMl) + "-" + fmt(cfg::kMaxVtbiMl) + " mL";
    return r;
  }
  if (drug->weight_based &&
      (!std::isfinite(p.weight_kg) || p.weight_kg < cfg::kMinWeightKg || p.weight_kg > cfg::kMaxWeightKg)) {
    r.message = "Patient weight required (" + fmt(cfg::kMinWeightKg) + "-" + fmt(cfg::kMaxWeightKg) + " kg)";
    return r;
  }

  r.dose = dose_rate(*drug, p.rate_ml_h, p.weight_kg);
  const std::string dose = fmt(r.dose) + " " + drug->dose_unit;

  if (p.rate_ml_h > drug->max_rate_ml_h) {
    r.check = LimitCheck::HardHigh;
    r.message = "Rate exceeds " + drug->name + " maximum of " + fmt(drug->max_rate_ml_h) + " mL/h";
  } else if (r.dose > drug->hard_max) {
    r.check = LimitCheck::HardHigh;
    r.message = "Dose " + dose + " above hard limit " + fmt(drug->hard_max);
  } else if (r.dose < drug->hard_min) {
    r.check = LimitCheck::HardLow;
    r.message = "Dose " + dose + " below hard limit " + fmt(drug->hard_min);
  } else if (r.dose > drug->soft_max) {
    r.check = LimitCheck::SoftHigh;
    r.message = "Dose " + dose + " above soft limit " + fmt(drug->soft_max);
  } else if (r.dose < drug->soft_min) {
    r.check = LimitCheck::SoftLow;
    r.message = "Dose " + dose + " below soft limit " + fmt(drug->soft_min);
  } else {
    r.check = LimitCheck::Ok;
    r.message = "Dose " + dose + " within limits";
  }
  return r;
}

}  // namespace pump
