# CP15 Decision Log

Status: passed
Date opened: 2026-07-05
Date passed: 2026-07-05

This file records beta release hardening decisions for CP15.

## Accepted Decisions

| ID       | Decision                                                            | Rationale                                                                                                   | Impact                                                                                                   |
| -------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CP15-D01 | Treat closed beta access as explicit, reversible application state. | Selected merchant usage must be controllable without code changes or account deletion.                      | Beta onboarding and pause flows need deterministic gates, auditability, and conservative defaults.       |
| CP15-D02 | Keep beta hardening focused on existing core workflows.             | CP1 through CP14 already define the MVP commerce surface for daily merchant use.                            | CP15 should harden products, customers, invoices, payments, imports, logistics, reports, and compliance. |
| CP15-D03 | Use bounded operational telemetry only.                             | Beta telemetry is useful, but raw customer, payment, identity, export, deletion, and tax data is sensitive. | Crash, error, support, runtime, and model contexts must use counts, states, identifiers, and summaries.  |
| CP15-D04 | Preserve deterministic sync and payment truth during hardening.     | Closed beta reliability depends on replayable offline writes and trustworthy balances.                      | Sync stress tests and payment reconciliation checks must not let model output or UI state rewrite truth. |
| CP15-D05 | Make beta rollback an operator workflow, not a database rescue.     | Operators need fast, reversible controls during selected merchant usage.                                    | Feature flags, onboarding pause rules, support labels, and rollback communication must be documented.    |

## Deferred Decisions

| Decision                                             | Deferred To | Reason                                                                                  |
| ---------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| Public launch rollout, marketing, and launch signoff | CP16        | Public release depends on beta metrics, support learnings, and operational readiness.   |
| Production infrastructure-as-code                    | CP16        | CP15 can document readiness gaps, but launch infrastructure belongs to public launch.   |
| Full external KYC/KYB provider integration           | CP16+       | Provider choice, credentials, cost, retry, and legal review remain outside CP15 core.   |
| Broad payment provider certification                 | CP16+       | CP15 validates controlled payment testing and reconciliation, not full provider launch. |
| Marketplace trust and courier network workflows      | CP17+       | Marketplace scope starts after public launch foundation.                                |
| Full Trusted Identity Execution Layer                | CP18        | Full TIEL remains a dedicated post-core hardening checkpoint.                           |
| Autonomous background agents                         | CP18+       | Requires mature observability, permissions, rollback tooling, and production controls.  |

## CP15 Boundary Checks

CP15 must preserve these checks:

- Beta access is business-scoped, explicit, and reversible.
- Feature flags default to conservative behavior.
- Offline write replay remains deterministic and idempotent.
- Sync stress handling exposes failures instead of hiding them.
- Payment reconciliation preserves CP8 invoice settlement truth.
- Support workflows preserve role and business boundaries.
- Telemetry, crash, support, runtime, and model contexts avoid sensitive payloads.
- Compliance, export, deletion, verification, tax, and device trust boundaries from CP14 remain intact.
- Tool execution still routes through deterministic validators.
- High and critical risk tools still require confirmation.
- CP4 deterministic parser behavior remains available.
- CP10 runtime verification, CP11 local-model fallback, CP12 report/notification boundaries, and CP13 logistics boundaries remain intact.
- Existing CP1 through CP14 tests continue to pass.
