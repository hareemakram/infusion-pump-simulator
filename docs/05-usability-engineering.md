# Usability Engineering Summary

| | |
|---|---|
| Document | IPS-UEF-005 |
| Standard | IEC 62366-1:2015+A1:2020 (short form) |
| User interface | React touchscreen, 800 x 500 logical px, `ui/` |

## 1. Use specification

| | |
|---|---|
| Intended users | Registered nurses and anaesthesia staff trained on the pump. Possibly tired, interrupted, gloved |
| Use environment | Ward and ICU bedside, variable light, alarm noise from other devices, often viewed from 1 to 2 m |
| Patient population | Adults, weight-based dosing for sedation and vasoactive drugs |
| Operating principle | Touch: drug from library, then rate and volume on an on-screen keypad, then review, then confirm start |

## 2. Primary operating functions

1. Program a new infusion (drug, weight, rate, VTBI)
2. Prime the line
3. Start, pause, resume and end an infusion
4. Change the rate during an infusion
5. Recognise, understand and respond to an alarm
6. Read the current status from a distance

## 3. Known use errors and UI risk controls

| ID | Use error or problem | Possible harm | UI design response | Requirement / risk |
|---|---|---|---|---|
| UE-01 | Decimal slip: types 25 instead of 2.5, or a doubled point | Tenfold overdose | Keypad accepts one decimal point and limited digits. Dose is recalculated live, and a limit scale shows where it falls against the soft and hard limits | SRS-001..004, RISK-H01 |
| UE-02 | Accepts a dose outside the usual range without noticing | Overdose | Review is blocked until the operator ticks a sentence that restates the dose and the limit. Hard limits disable Review entirely | SRS-003, SRS-004 |
| UE-03 | Starts the wrong program, or starts by accident | Unintended delivery | Start opens a confirmation screen with drug, concentration, rate, dose, VTBI and duration. The start button names the rate ("Start 22.0 mL/h") | SRS-080, RISK-H14 |
| UE-04 | Misses or misreads an alarm | Delayed response | Banner priority is shown by colour, a priority word and a symbol (!!!, !!, !). Text gives the problem and then the action. High priority flashes at about 2 Hz, medium at about 0.6 Hz, low is steady. The housing light bar repeats the colour. Text is announced through ARIA live regions | SRS-040, SRS-081 |
| UE-05 | Acknowledges an occlusion that is still there | Repeated alarm, or a false belief that it is fixed | Acknowledge stays disabled while the condition is present, and its tooltip says "Fix the cause first". "Condition cleared" appears when it may be acknowledged | SRS-043 |
| UE-06 | Expects the pump to resume after an alarm | Therapy gap | After acknowledgement the pump is Paused, Resume is shown as the primary action, and a paused reminder alarms after 2 min | SRS-013, SRS-038 |
| UE-07 | Believes the pump is delivering when it is not | Underdose | A "Delivering" or "Not delivering" flag next to the rate. When stopped, the rate turns grey | SRS-083 |
| UE-08 | Acts on frozen data after a connection loss | Wrong decision | After 1.5 s without data, values are greyed out and covered by "No data from the pump" | SRS-082 |
| UE-09 | Forgets the patient weight for a weight-based drug | Wrong dose | Weight is the first field for those drugs, and the dose readout shows the per-kg unit | SRS-007 |
| UE-10 | Taps a control that the current state does not allow | Confusion, delay | Only state-valid controls are shown. A disabled Start explains why ("Prime the line first") | SRS-015 |

## 4. User interface specification highlights

- **Touch targets:** at least 48 px high, with keypad keys at 62 px. Primary actions are on the
  right, where the right hand ends.
- **Typography:** IBM Plex Sans and Plex Mono with tabular figures, so numbers do not shift as
  they change. The rate is shown at 88 px for reading from a distance.
- **Colour:** the display is dark and high-contrast. Green means delivering. Red, amber and cyan
  are reserved for alarms (IEC 60601-1-8) and are never used for decoration.
- **Wording:** alarm text says what happened, then what to do, in the user's terms ("Occlusion:
  patient side. Check the line to the patient for kinks or a closed clamp.").
- **Motion:** flashing honours `prefers-reduced-motion`. Priority is still shown by colour,
  word and symbol.

## 5. Formative evaluation

Formative checks were done as scripted walkthroughs. They are automated as Playwright scenarios,
so they repeat on every change:

| Scenario | Checks | Test |
|---|---|---|
| Program heparin, prime, confirm, start | Start blocked before priming, then confirmation, then delivering flag | `e2e/pump.spec.ts` "program, prime, confirm and start" (desktop and touch viewport) |
| Cancel at the confirmation screen | Nothing starts | "cancelling the start confirmation" |
| Enter a dose over the hard limit, then the soft limit | Review blocked, then override required and logged | "hard dose limit cannot be passed" |
| Occlusion during an infusion | High banner, not delivering, acknowledge blocked until fixed, then paused | "occlusion raises a high-priority alarm" |
| Medium, low and high alarm in sequence | Distinct priority presentation and ARIA role | "alarm priorities are distinct" |
| Sensor failure | Fault screen offers only a restart | "sensor fault forces a restart" |

## 6. Summative evaluation (plan)

A real product would need a summative test with 15 or more representative users per user
group (FDA HE75 guidance), run in a simulated ward with the critical tasks UE-01 to UE-06.
Acceptance criterion: no use error on a critical task that could lead to serious harm.
This was not run for the portfolio project.
