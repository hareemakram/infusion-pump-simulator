# Software Development Plan

| | |
|---|---|
| Document | IPS-SDP-001 |
| Product | IPS-1 infusion pump simulator 1.0.0 |
| Standard | IEC 62304:2006+A1:2015, clause 5.1 |

> Portfolio project. It shows how IEC 62304 activities map onto a small, real codebase. It is
> not a certified process and the software is not a medical device.

## 1. Purpose and scope

The plan covers three software items:

| Item | Language | Role | IEC 62304 status |
|---|---|---|---|
| `firmware/` pump control software | C++17 | State machine, delivery accounting, alarm detection and response | Software system under development |
| `ui/` touchscreen interface | TypeScript, React | Operator programming, status and alarm presentation | Software system under development |
| `simulator/` hardware model and service | Python 3 | Plays the hardware and injects faults. Bridges the UI to the firmware | Test and support tool, not part of the device |

## 2. Lifecycle

An iterative V-model. Each increment goes through the clauses below. The repository is the
single record: documents, code, tests and generated evidence are versioned together.

| IEC 62304 clause | Activity | Output in this repository |
|---|---|---|
| 5.1 | Development planning | This document |
| 5.2 | Requirements analysis | [SRS](02-software-requirements-specification.md) |
| 5.3 | Architectural design | [Architecture and design](03-software-architecture.md) |
| 5.4 | Detailed design | Section 4 of the architecture document, header comments in `firmware/include/pump/` |
| 5.5 | Unit implementation and verification | Source code, GoogleTest and Jest suites, code review, compiler warnings as errors |
| 5.6 | Integration and integration testing | Protocol tests (`test_protocol.cpp`), closed-loop tests (`simulator/tests/test_system.py`) |
| 5.7 | Software system testing | pytest system tests, Playwright end-to-end tests, [fault response report](generated/fault-response-report.md) |
| 5.8 | Release | Tagged commit after a green CI run. [Test report](generated/test-report.md) and [traceability matrix](generated/traceability-matrix.md) |
| 7 | Risk management | [Risk management file](04-risk-management-file.md) (ISO 14971) |
| 8 | Configuration management | Git, pinned tool and dependency versions, `package-lock.json` |
| 9 | Problem resolution | GitHub issues. Section 7 below |
| IEC 62366-1 | Usability engineering | [Usability engineering summary](05-usability-engineering.md) |

## 3. Software safety classification

**Class C.** An infusion pump that over-delivers a high-alert drug such as heparin, insulin
or an opioid can cause death or serious injury (RISK-H01, RISK-H07). Hardware risk controls
outside the software, such as a mechanical anti-free-flow clamp, would reduce severity, but
this design does not take credit for any. All software items are therefore treated as Class C.
Every unit gets unit verification, and every requirement needs at least one passing test.

## 4. Standards and conventions

- C++17, built with `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror`.
- No dynamic polymorphism, exceptions or threads in the control software. All timing comes
  from the HAL, so the controller is deterministic and testable faster than real time.
- Safety-related constants are in one header (`config.hpp`) and each one cites its requirement.
- TypeScript in `strict` mode. UI logic that affects safety (limit classification, keypad,
  state-to-action mapping) lives in pure functions under `ui/src/domain/` and is unit tested.
- Python: standard library only at runtime, type hints, pytest.

## 5. Verification strategy

| Level | Tooling | What it proves |
|---|---|---|
| Unit | GoogleTest, Jest | Each detector, the alarm manager, the drug library, the controller, protocol parsing, UI domain logic and components |
| Integration | GoogleTest protocol tests, pytest | The firmware process and the simulator agree on the HAL protocol |
| System | pytest closed-loop tests | The compiled firmware detects every injected hardware fault and stops the motor in time |
| End-to-end | Playwright (desktop and touch viewport) | Operator workflows through the real UI, service and firmware |
| Static | Compiler warnings as errors, `tsc --strict` | Type and conversion defects |
| Dynamic | AddressSanitizer + UBSan build in CI | Memory and undefined-behaviour defects in the firmware |

Tests link to requirements in their source: `// @req SRS-xxx` (C++), `@pytest.mark.req`
(Python), or the requirement ID in the test title (Jest, Playwright). `tools/trace.py --strict`
fails CI if any requirement has no passing test.

Coverage is measured in CI: gcovr for the firmware, pytest-cov for the simulator and Jest for
the UI. Measured on 2026-11-17: firmware 98 % of lines, simulator 94 %, UI 80 % of statements
in Jest. The rest of the UI, mainly the canvas chart and app shell, is exercised by Playwright.

## 6. SOUP (software of unknown provenance)

| SOUP | Version | Used by | Runtime? | Risk |
|---|---|---|---|---|
| C++ standard library (libstdc++) | GCC 13 | Firmware | Yes | Containers and string formatting only. No allocation inside the control loop beyond bounded deques |
| React, React DOM | 18.3.1 | UI | Yes | Rendering. Safety decisions are made in the firmware, not in React state |
| IBM Plex fonts | 5.1.0 | UI | Yes | None |
| GoogleTest | 1.14+ | Tests | No | Test tool |
| pytest, pytest-cov | 8.x | Tests | No | Test tool |
| Jest, Testing Library, Playwright | pinned in `ui/package.json` | Tests | No | Test tool |
| Vite, TypeScript | pinned | Build | No | Build tool |

## 7. Problem resolution

Defects are tracked as GitHub issues labelled `bug` with a safety impact field (none, low,
high). A fix with safety impact must reference the affected requirement and risk, add a
failing test first, and update the risk management file if the analysis changes.

## 8. Known anomalies (release 1.0.0)

| ID | Description | Assessment |
|---|---|---|
| KA-1 | After a downstream occlusion is relieved, the pressure stored in the compliant line is released to the patient as a bolus. In simulation this is about 0.5 mL at the 500 mmHg threshold. | Residual risk, see RISK-H02. A pressure back-off (brief motor reversal after an occlusion alarm) is the planned mitigation. |
| KA-2 | Time to detect an occlusion grows at low rates: about 71 s at 25 mL/h and medium sensitivity (see the fault response report). | Inherent to pressure-based detection. The operator can choose high sensitivity. Disclosed in labeling. |
| KA-3 | The simulator's drug library values are illustrative. | Not for clinical use. |
