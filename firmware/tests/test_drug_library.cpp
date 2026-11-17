// SPDX-License-Identifier: MIT
#include <gtest/gtest.h>

#include <cmath>
#include <limits>

#include "pump/drug_library.hpp"

using namespace pump;

namespace {
const DrugLibrary lib = DrugLibrary::standard();
ValidationResult check(const char* drug, double rate, double vtbi = 100.0, double weight = 0.0) {
  return lib.validate(InfusionProgram{drug, rate, vtbi, weight});
}
}  // namespace

// @req SRS-001
TEST(DrugLibrary, RejectsRateOutsidePumpRange) {
  EXPECT_EQ(check("saline", 0.05).check, LimitCheck::Invalid);
  EXPECT_EQ(check("saline", 1000.0).check, LimitCheck::Invalid);
  EXPECT_EQ(check("saline", 0.1).check, LimitCheck::SoftLow);
  EXPECT_EQ(check("saline", 999.0).check, LimitCheck::SoftHigh);
}

// @req SRS-001
TEST(DrugLibrary, RejectsVtbiOutsideRange) {
  EXPECT_EQ(check("saline", 100.0, 0.0).check, LimitCheck::Invalid);
  EXPECT_EQ(check("saline", 100.0, 10000.0).check, LimitCheck::Invalid);
  EXPECT_EQ(check("saline", 100.0, 9999.0).check, LimitCheck::Ok);
}

// @req SRS-001
TEST(DrugLibrary, RejectsNonFiniteInput) {
  EXPECT_EQ(check("saline", std::nan("")).check, LimitCheck::Invalid);
  EXPECT_EQ(check("saline", 100.0, std::numeric_limits<double>::infinity()).check, LimitCheck::Invalid);
}

// @req SRS-001
TEST(DrugLibrary, RejectsUnknownDrug) {
  const auto r = check("unobtainium", 10.0);
  EXPECT_EQ(r.check, LimitCheck::Invalid);
  EXPECT_FALSE(r.accepted(true));
}

// @req SRS-002
TEST(DrugLibrary, ComputesDoseRateFromConcentration) {
  const Drug* heparin = lib.find("heparin");
  ASSERT_NE(heparin, nullptr);
  EXPECT_DOUBLE_EQ(dose_rate(*heparin, 10.0, 0.0), 1000.0);  // 10 mL/h x 100 units/mL
}

// @req SRS-002, SRS-007
TEST(DrugLibrary, ComputesWeightBasedDose) {
  const Drug* propofol = lib.find("propofol");
  ASSERT_NE(propofol, nullptr);
  EXPECT_DOUBLE_EQ(dose_rate(*propofol, 14.0, 70.0), 2.0);  // 14 mL/h x 10 mg/mL / 70 kg
  EXPECT_DOUBLE_EQ(dose_rate(*propofol, 14.0, 0.0), 0.0);
}

// @req SRS-003
TEST(DrugLibrary, HardLimitCannotBeOverridden) {
  const auto r = check("heparin", 31.0);  // 3100 units/h > hard max 3000
  EXPECT_EQ(r.check, LimitCheck::HardHigh);
  EXPECT_FALSE(r.accepted(false));
  EXPECT_FALSE(r.accepted(true));
}

// @req SRS-003
TEST(DrugLibrary, HardLowLimit) {
  const Drug custom{"x", "X", 1.0, "mg", "mg/h", false, 2.0, 5.0, 1.0, 10.0, 999.0};
  const DrugLibrary l("t", {custom});
  EXPECT_EQ(l.validate({"x", 0.5, 10.0, 0.0}).check, LimitCheck::HardLow);
}

// @req SRS-004
TEST(DrugLibrary, SoftLimitRequiresConfirmation) {
  const auto high = check("heparin", 25.0);  // 2500 units/h > soft max 2000
  EXPECT_EQ(high.check, LimitCheck::SoftHigh);
  EXPECT_FALSE(high.accepted(false));
  EXPECT_TRUE(high.accepted(true));

  const auto low = check("heparin", 1.0);  // 100 units/h < soft min 200
  EXPECT_EQ(low.check, LimitCheck::SoftLow);
  EXPECT_TRUE(low.accepted(true));
}

// @req SRS-004
TEST(DrugLibrary, WithinLimitsIsAcceptedWithoutConfirmation) {
  const auto r = check("heparin", 10.0);
  EXPECT_EQ(r.check, LimitCheck::Ok);
  EXPECT_TRUE(r.accepted(false));
  EXPECT_NE(r.message.find("within limits"), std::string::npos);
}

// @req SRS-005
TEST(DrugLibrary, DrugMaximumRateIsHardLimit) {
  const auto r = check("insulin", 40.0);  // max 30 mL/h
  EXPECT_EQ(r.check, LimitCheck::HardHigh);
  EXPECT_FALSE(r.accepted(true));
}

// @req SRS-007
TEST(DrugLibrary, WeightBasedDrugRequiresPlausibleWeight) {
  EXPECT_EQ(check("propofol", 14.0, 100.0, 0.0).check, LimitCheck::Invalid);
  EXPECT_EQ(check("propofol", 14.0, 100.0, 400.0).check, LimitCheck::Invalid);
  EXPECT_EQ(check("propofol", 14.0, 100.0, 70.0).check, LimitCheck::Ok);
}

TEST(DrugLibrary, LimitCheckNames) {
  EXPECT_EQ(to_string(LimitCheck::Ok), "OK");
  EXPECT_EQ(to_string(LimitCheck::SoftLow), "SOFT_LOW");
  EXPECT_EQ(to_string(LimitCheck::SoftHigh), "SOFT_HIGH");
  EXPECT_EQ(to_string(LimitCheck::HardLow), "HARD_LOW");
  EXPECT_EQ(to_string(LimitCheck::HardHigh), "HARD_HIGH");
  EXPECT_EQ(to_string(LimitCheck::Invalid), "INVALID");
}
