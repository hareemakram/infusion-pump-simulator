# Documentation

IEC 62304 style documentation for the IPS-1 infusion pump simulator.

| # | Document | Standard |
|---|---|---|
| 01 | [Software development plan](01-software-development-plan.md): lifecycle, safety class, SOUP, known anomalies | IEC 62304 5.1 |
| 02 | [Software requirements specification](02-software-requirements-specification.md): 41 numbered requirements | IEC 62304 5.2 |
| 03 | [Architecture and design](03-software-architecture.md): items, state machine, HAL protocol, plant model | IEC 62304 5.3, 5.4 |
| 04 | [Risk management file](04-risk-management-file.md): 18 hazards with controls traced to requirements | ISO 14971, IEC 62304 7 |
| 05 | [Usability engineering summary](05-usability-engineering.md): use errors and UI controls | IEC 62366-1 |

Generated evidence (rebuilt by CI on every push):

- [Traceability matrix](generated/traceability-matrix.md): requirement to test to result
- [Test report](generated/test-report.md): totals per suite
- [Fault response report](generated/fault-response-report.md): time to detect each injected fault
