// SPDX-License-Identifier: MIT
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace pump {

/// One drug library entry. Limits are expressed in `dose_unit`.
/// The values in DrugLibrary::standard() are illustrative only.
struct Drug {
  std::string id;
  std::string name;
  double concentration{1.0};   ///< Amount per mL.
  std::string amount_unit;     ///< e.g. "units", "mg", "mL"
  std::string dose_unit;       ///< e.g. "units/h", "mg/kg/h", "mL/h"
  bool weight_based{false};
  double soft_min{0.0};
  double soft_max{0.0};
  double hard_min{0.0};
  double hard_max{0.0};
  double max_rate_ml_h{999.0};
};

struct InfusionProgram {
  std::string drug_id;
  double rate_ml_h{0.0};
  double vtbi_ml{0.0};
  double weight_kg{0.0};
};

enum class LimitCheck { Ok, SoftLow, SoftHigh, HardLow, HardHigh, Invalid };

struct ValidationResult {
  LimitCheck check{LimitCheck::Invalid};
  double dose{0.0};
  std::string message;

  [[nodiscard]] bool is_soft() const {
    return check == LimitCheck::SoftLow || check == LimitCheck::SoftHigh;
  }
  /// SRS-003/SRS-004: hard limits can never be overridden, soft limits only with confirmation.
  [[nodiscard]] bool accepted(bool confirmed) const {
    return check == LimitCheck::Ok || (is_soft() && confirmed);
  }
};

std::string_view to_string(LimitCheck c);

/// SRS-002: dose rate = rate x concentration [/ weight].
double dose_rate(const Drug& drug, double rate_ml_h, double weight_kg);

class DrugLibrary {
 public:
  DrugLibrary(std::string version, std::vector<Drug> drugs);
  static DrugLibrary standard();

  [[nodiscard]] const Drug* find(std::string_view id) const;
  [[nodiscard]] const std::vector<Drug>& drugs() const { return drugs_; }
  [[nodiscard]] const std::string& version() const { return version_; }
  [[nodiscard]] ValidationResult validate(const InfusionProgram& program) const;

 private:
  std::string version_;
  std::vector<Drug> drugs_;
};

}  // namespace pump
