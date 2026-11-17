# Risk Management File

| | |
|---|---|
| Document | IPS-RMF-004 |
| Standards | ISO 14971:2019, IEC 62304 clause 7, ISO/TR 24971 |
| Scope | Software contribution to hazardous situations of the IPS-1 infusion pump |

> Portfolio analysis of a simulated device. Severities and probabilities are engineering
> estimates for the demonstration, not clinical data.

## 1. Method

For each hazard: the sequence of events, the hazardous situation and the harm are identified.
Risk is estimated before and after risk controls. Software failures are assumed to happen
(probability of a software failure itself is taken as 1, per IEC 62304), so the probability
scores below are for the harm arising, with the hardware and the clinical context considered.

### 1.1 Scales

| Severity | | Probability | |
|---|---|---|---|
| S5 Catastrophic | Death | P5 Frequent | Expected in most uses |
| S4 Critical | Permanent impairment, life-threatening | P4 Probable | Likely several times per device life |
| S3 Serious | Injury needing intervention | P3 Occasional | Likely once per device life |
| S2 Minor | Temporary injury, no intervention | P2 Remote | Unlikely over the device life |
| S1 Negligible | Discomfort | P1 Improbable | Not expected across the fleet |

### 1.2 Acceptability (risk index = S x P)

| Index | Region | Action |
|---|---|---|
| 1 to 4 | Acceptable | No further action |
| 5 to 9 | Reduce as far as possible | Controls required. Residual risk is reviewed in the benefit-risk analysis |
| 10 to 25 | Unacceptable | Must be reduced |

## 2. Hazard analysis

| ID | Hazard / cause | Hazardous situation -> harm | S | P | Risk | Risk controls (requirement) | P after | Residual |
|---|---|---|---|---|---|---|---|---|
| RISK-H01 | Programming error: wrong rate, decimal slip, wrong concentration assumed | Drug delivered far above the intended dose -> overdose of a high-alert drug | 5 | 4 | 20 | Pump ranges (SRS-001), dose computed by the pump (SRS-002), hard limits (SRS-003, SRS-005), soft limits with logged confirmation (SRS-004), titration validated (SRS-006), keypad refuses malformed input, review screen (SRS-080) | 1 | 5, reduce as far as possible: a soft-limit override is still possible by design |
| RISK-H02 | Pressure stored in the line during a downstream occlusion | Bolus delivered when the occlusion is relieved -> transient overdose | 4 | 3 | 12 | Occlusion detected with debounce and threshold choice (SRS-030, SRS-031). Motor stopped at once (SRS-012). Bolus measured in simulation, about 0.5 mL at 500 mmHg (KA-1) | 2 | 8, reduce as far as possible: pressure back-off planned, disclosed in labeling |
| RISK-H03 | Downstream occlusion not detected | Therapy interrupted unnoticed -> underdose, deterioration | 4 | 3 | 12 | Downstream occlusion alarm (SRS-030), selectable sensitivity (SRS-031), VTBI-complete alarm (SRS-022) | 1 | 4, acceptable |
| RISK-H04 | Upstream clamp closed | No delivery although the pump is running -> underdose | 4 | 3 | 12 | Upstream occlusion alarm (SRS-032) | 1 | 4, acceptable |
| RISK-H05 | Air enters the line: not primed, outgassing, container empty | Air embolism | 5 | 3 | 15 | Single-bubble and cumulative air limits (SRS-033, SRS-034), priming required before start (SRS-010, SRS-011), empty container alarm (SRS-035) | 1 | 5, reduce as far as possible: detector hardware assumed reliable |
| RISK-H06 | Container runs empty | Therapy interrupted; air pumped -> underdose, air | 4 | 4 | 16 | Low and empty container alarms (SRS-035), air detection (SRS-033) | 1 | 4, acceptable |
| RISK-H07 | Motor driver failure: runaway, or movement while disabled | Uncontrolled flow -> overdose | 5 | 2 | 10 | Encoder-based over-delivery and uncommanded-motion detection (SRS-037), infused volume from encoder (SRS-021), immediate stop (SRS-012) | 1 | 5, reduce as far as possible: an independent hardware cut-off would further reduce it |
| RISK-H08 | Mechanism jams | No delivery while the display shows infusing -> underdose | 4 | 2 | 8 | Motor stall detection (SRS-036). Infused volume from the encoder, so the display stays truthful (SRS-021) | 1 | 4, acceptable |
| RISK-H09 | Pressure sensor fails: frozen, saturated, out of range | Occlusion masked -> underdose, or wrong reaction | 4 | 3 | 12 | Plausibility and range checks (SRS-050), frozen-sensor detection (SRS-051), timestamp and encoder checks (SRS-054), fail-safe Fault state needing restart (SRS-053) | 1 | 4, acceptable |
| RISK-H10 | Sensor data stops reaching the controller | Control on stale data -> any of the above | 4 | 2 | 8 | Watchdog of 500 ms (SRS-052), Fault state (SRS-053) | 1 | 4, acceptable |
| RISK-H11 | Pump restarts by itself after an alarm | Unexpected delivery while the line is being handled -> overdose, air | 5 | 2 | 10 | No automatic restart (SRS-013), acknowledge cannot clear present conditions (SRS-043) | 1 | 5, reduce as far as possible |
| RISK-H12 | Alarm not noticed: masked by a lower alarm, silenced, alarm fatigue | Delayed response -> worsened harm from H03 to H08 | 4 | 3 | 12 | IEC 60601-1-8 priorities and ordering (SRS-040), latching (SRS-041), bounded silence cancelled by new alarms (SRS-042), paused reminder (SRS-038), redundant colour, word and symbol coding (SRS-081) | 1 | 4, acceptable |
| RISK-H13 | Operator reads stale or misleading data on the display | Wrong decision, such as believing the pump is delivering | 4 | 3 | 12 | Stale-data overlay (SRS-082), explicit delivering indicator (SRS-083) | 1 | 4, acceptable |
| RISK-H14 | Accidental start: wrong touch, wrong program | Unintended delivery | 4 | 3 | 12 | Start needs a primed line and a program (SRS-010), confirmation screen (SRS-080) | 1 | 4, acceptable |
| RISK-H15 | Wrong drug selected from the library | Wrong drug or concentration -> harm depends on the drug | 5 | 3 | 15 | Drug name and concentration on the review and confirm screens and the status bar (SRS-080) | 2 | 10, **open**: needs barcode or pharmacy order verification outside the scope of the simulator |
| RISK-H16 | Weight entry error for a weight-based drug | Dose scaled wrongly -> over- or underdose | 5 | 3 | 15 | Weight required and range-checked (SRS-007), weight asked first and shown on review (SRS-080), dose computed by the pump (SRS-002) | 1 | 5, reduce as far as possible |
| RISK-H17 | Events not recorded | Incident cannot be investigated | 2 | 3 | 6 | Event log of commands, overrides, states and alarms (SRS-060) | 1 | 2, acceptable |
| RISK-H18 | Corrupted or unexpected input at the HAL or UI boundary | Undefined behaviour in the controller | 4 | 2 | 8 | Strict parsing, ERR without a state change (SRS-070), state-dependent command checks (SRS-015), input allow-list in the service, sanitizer build in CI | 1 | 4, acceptable |

## 3. Verification of risk controls

Every risk control is a requirement, and every requirement is linked to tests in the
[traceability matrix](generated/traceability-matrix.md). The effectiveness of the detection
controls is shown by the closed-loop fault scenarios in the
[fault response report](generated/fault-response-report.md). Each injected fault is detected
and the motor is stopped.

## 4. Overall residual risk

Eleven hazards end in the acceptable region and six in "reduce as far as possible", each
with its controls in place. **RISK-H15 (wrong drug) stays open.** A real product would close
it with barcode medication verification or EMR integration. For this simulator it is recorded
as a known limitation. The benefit of controlled, logged infusion therapy outweighs the
residual risks of the controlled hazards. RISK-H15 is not closed and would block a real release.

## 5. Software items contributing to hazards (IEC 62304 7.1)

| Software item | Hazards it can contribute to |
|---|---|
| DrugLibrary | H01, H16 |
| Detectors | H02 to H10 |
| AlarmManager | H11, H12 |
| PumpController | H01, H07, H10, H11, H14 |
| Protocol | H18 |
| UI (program wizard, confirm, alarm banner) | H01, H12 to H16 |
