# Software Requirements Specification (SRS)

| | |
|---|---|
| Document | IPS-SRS-002 |
| Product | IPS-1 infusion pump simulator, software version 1.0.0 |
| Standard | IEC 62304:2006+A1:2015, clause 5.2 |
| Software safety class | C (see [Software Development Plan](01-software-development-plan.md#3-software-safety-classification)) |

> This is a portfolio project. The pump is simulated and the drug library values are illustrative.
> Nothing here is clinical guidance.

## 1. Scope

The SRS covers the control software of a volumetric infusion pump (C++ firmware) and the
operator interface (React touchscreen). The Python hardware simulator is test equipment. It
is outside the scope of the requirements, but it verifies them.

Each requirement has a unique ID, gives its rationale or the risk control it implements
(the `RISK-Hxx` IDs are in the [risk management file](04-risk-management-file.md)), and has a
verification method:

- **U**: unit test (GoogleTest, Jest)
- **S**: closed-loop system test against the compiled firmware (pytest)
- **E**: end-to-end UI test (Playwright)

Requirement-to-test links are generated from the test sources by `tools/trace.py` into the
[traceability matrix](generated/traceability-matrix.md). CI fails when any requirement has no
passing test.

## 2. Definitions

| Term | Meaning |
|---|---|
| VTBI | Volume to be infused |
| KVO | Keep vein open: minimal flow after VTBI is reached |
| Soft limit | Drug library limit the operator may override after explicit confirmation |
| Hard limit | Drug library limit that cannot be overridden |
| HAL | Hardware abstraction layer: the sensor/motor boundary of the firmware |
| Control cycle | 100 ms. One sensor frame, one controller tick, one motor command |

## 3. Requirements

### 3.1 Programming and dose limits

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-001 | The pump shall reject a program with a rate outside 0.1 to 999 mL/h, a VTBI outside 0.1 to 9999 mL, an unknown drug, or a non-finite value. | RISK-H01 | U, S |
| SRS-002 | The pump shall compute the dose rate as rate x concentration, divided by patient weight for weight-based drugs. | RISK-H01, RISK-H16 | U |
| SRS-003 | A program whose dose rate is outside a drug's hard limits shall be rejected, even if the operator confirms. | RISK-H01 | U, S, E |
| SRS-004 | A program outside a drug's soft limits shall be accepted only with explicit operator confirmation, and the override shall be logged. | RISK-H01 | U, S, E |
| SRS-005 | A rate above the drug's maximum rate shall be treated as a hard-limit violation. | RISK-H01 | U |
| SRS-006 | A rate change during an infusion (titration) shall be validated against the same limits as a new program. | RISK-H01 | U, S |
| SRS-007 | A weight-based drug shall require a patient weight between 0.5 and 350 kg. | RISK-H16 | U |

### 3.2 Operating states

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-010 | The pump shall not start an infusion unless a program has been accepted and the line has been primed. | RISK-H05, RISK-H14 | U, S, E |
| SRS-011 | Priming shall deliver 2.0 mL at 600 mL/h. Priming volume shall not count as infused volume. Air-in-line detection shall be inhibited while priming. | RISK-H05 | U, S |
| SRS-012 | Pause and every alarm stop shall set the motor command to zero within the same control cycle. | RISK-H07 | U, S |
| SRS-013 | After a high-priority alarm the pump shall not resume delivery automatically. Delivery restarts only after the alarm is acknowledged and the operator presses Start. | RISK-H11 | U, S, E |
| SRS-014 | Stop shall end the infusion, clear the program and record the infused volume. | Workflow | U |
| SRS-015 | A command that is not valid in the current state shall be rejected with a reason and shall not change the state. | RISK-H18 | U |

### 3.3 Delivery

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-020 | The motor command shall be rate x 2000 steps/mL / 3600 steps per second. | Mechanism definition | U |
| SRS-021 | Infused volume shall be computed from motor encoder feedback, not from the motor command. | RISK-H07, RISK-H08 | U, S |
| SRS-022 | When the infused volume reaches the VTBI, the pump shall switch to KVO at the lower of 1.0 mL/h and the programmed rate, and raise a medium-priority "Infusion complete" alarm. | RISK-H03 | U, S |
| SRS-023 | Delivered volume shall be within +/-2 % of the VTBI under nominal conditions. | Accuracy | U, S |

### 3.4 Alarm conditions

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-030 | Downstream pressure above the occlusion threshold for at least 300 ms shall raise a high-priority downstream occlusion alarm and stop the motor. The condition clears below 80 % of the threshold. | RISK-H02, RISK-H03 | U, S |
| SRS-031 | The occlusion threshold shall be selectable: 300 mmHg (high sensitivity), 500 mmHg (medium, default), 800 mmHg (low). | RISK-H03 | U, S |
| SRS-032 | Upstream pressure below -150 mmHg for at least 1 s shall raise a high-priority upstream occlusion alarm. | RISK-H04 | U, S |
| SRS-033 | A single air bubble of 50 uL or more shall raise a high-priority air-in-line alarm. | RISK-H05 | U, S |
| SRS-034 | A cumulative 1000 uL of air within any 15 min window shall raise a high-priority air-in-line alarm. | RISK-H05 | U, S |
| SRS-035 | Container level of 0.5 mL or less while delivering shall raise a high-priority alarm. A level below 10 mL shall raise a low-priority alarm. | RISK-H06 | U, S |
| SRS-036 | If 40 commanded motor steps pass without encoder motion while delivering, the pump shall raise a high-priority motor stall alarm. | RISK-H08 | U, S |
| SRS-037 | If encoder motion exceeds commanded motion by more than max(20 steps, 10 %) over a 60 s window, including any motion while the motor is disabled, the pump shall raise a high-priority over-delivery alarm and stop. | RISK-H07 | U, S |
| SRS-038 | A pump left paused for 120 s shall raise a low-priority reminder. | RISK-H12 | U |

### 3.5 Alarm system

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-040 | Alarms shall have high, medium or low priority per IEC 60601-1-8. The highest priority is presented first, and the newest first within a priority. | RISK-H12 | U, S, E |
| SRS-041 | High and medium alarms shall latch. They stay displayed after the condition clears until acknowledged. Low alarms do not latch. | RISK-H12 | U |
| SRS-042 | Silence shall pause the audible signal for 120 s. A new alarm cancels the silence. | RISK-H12 | U, S |
| SRS-043 | Acknowledge shall not clear an alarm whose condition is still present. | RISK-H11 | U, S, E |

### 3.6 System integrity

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-050 | A sensor reading outside its plausible range shall raise a sensor fault, put the pump in the Fault state and disable the motor. Implausible frames shall not be used for control. | RISK-H09 | U, S |
| SRS-051 | A downstream pressure reading identical for 50 consecutive frames while the motor runs shall be treated as a frozen sensor (sensor fault). | RISK-H09 | U, S |
| SRS-052 | If no sensor frame arrives for more than 500 ms, the pump shall raise a communication-loss alarm and enter the Fault state. | RISK-H10 | U, S, E |
| SRS-053 | The Fault state shall only be left by a restart. A restart clears the program and the primed flag. | RISK-H09, RISK-H10 | U, S, E |
| SRS-054 | A decreasing encoder count or a non-increasing sensor timestamp shall be treated as a sensor fault. | RISK-H09 | U |

### 3.7 Records and interfaces

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-060 | Every command, rejection, override, state change and alarm shall be recorded in an event log with a timestamp and sequence number. | RISK-H17 | U, S |
| SRS-070 | The firmware shall implement the HAL line protocol (SENSOR, TICK, CMD in; EVT, STATUS, RESP, ERR out). Malformed input shall produce ERR without changing state. | RISK-H18 | U, S |

### 3.8 Operator interface

| ID | Requirement | Rationale / risk control | Verification |
|---|---|---|---|
| SRS-080 | Starting or resuming delivery shall need a second, explicit confirmation on a screen that summarises drug, concentration, rate, dose, VTBI and duration. | RISK-H14, RISK-H15 | U, E |
| SRS-081 | Alarm priority shall be conveyed by colour, a priority word and a symbol (!!!, !!, !), never by colour alone. High-priority alarms shall be announced assertively to assistive technology. | RISK-H12 | U, E |
| SRS-082 | If no data has arrived from the pump for 1.5 s, the UI shall mark the displayed values as out of date. | RISK-H13 | U |
| SRS-083 | The main screen shall show whether the pump is delivering or not delivering, independent of the programmed rate. | RISK-H13 | U, E |
