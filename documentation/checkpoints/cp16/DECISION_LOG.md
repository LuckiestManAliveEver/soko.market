# CP16 Decision Log

Status: passed
Date opened: 2026-07-05
Date passed: 2026-07-05

This file records public launch decisions for CP16.

## Accepted Decisions

| ID       | Decision                                                               | Rationale                                                                                   | Impact                                                                                                  |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| CP16-D01 | Treat public launch as a reversible product state.                     | Launch must be pausable without deleting businesses or rewriting commerce records.          | Public onboarding needs explicit gates, audit events, and rollback controls.                            |
| CP16-D02 | Gate launch readiness on CP15 beta health plus production readiness.   | Closed beta success is necessary but not sufficient for public access.                      | Launch reports must combine beta status, support load, telemetry health, sync health, and config state. |
| CP16-D03 | Keep launch telemetry bounded and aggregate-first.                     | Public usage increases sensitive data exposure risk.                                        | Telemetry, support, runtime, and model contexts must use counts, states, rates, and summaries.          |
| CP16-D04 | Preserve deterministic commerce truth during public onboarding.        | Launch should not change invoice, payment, sync, logistics, compliance, or audit semantics. | Public launch work must layer gates and launch surfaces around existing validators and audit events.    |
| CP16-D05 | Defer marketplace and full TIEL work until after launch stabilization. | Marketplace and full identity execution add new trust, operations, and provider risk.       | CP16 remains focused on launch readiness, public onboarding, support, telemetry, and rollback.          |

## Deferred Decisions

| Decision                                                | Deferred To  | Reason                                                                                               |
| ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| Marketplace buyer, courier, seller, and trust workflows | CP17         | Marketplace foundation starts after controlled public launch is stable.                              |
| Full Trusted Identity Execution Layer                   | CP18         | Full TIEL remains a dedicated post-core hardening checkpoint.                                        |
| Broad external provider certification                   | CP16+        | CP16 may document readiness and placeholders, but provider certification can continue in later work. |
| Autonomous background agents                            | CP18+        | Requires mature observability, permissions, rollback tooling, and production controls.               |
| Paid marketing launch operations                        | Outside repo | Business, legal, and marketing execution are not repository deliverables for this checkpoint.        |

## CP16 Boundary Checks

CP16 must preserve these checks:

- Public launch access is explicit, reversible, and auditable.
- Public onboarding remains authenticated, business-scoped, and role-aware.
- Launch readiness does not bypass CP15 beta gates or CP14 security/compliance boundaries.
- Launch telemetry and support summaries avoid sensitive payloads.
- Rollback pauses onboarding without deleting businesses or mutating commerce truth.
- Offline write replay remains deterministic and idempotent.
- Payment reconciliation preserves CP8 invoice settlement truth.
- Support workflows preserve role and business boundaries.
- Tool execution still routes through deterministic validators.
- High and critical risk tools still require confirmation.
- CP4 deterministic parser behavior remains available.
- CP10 runtime verification, CP11 local-model fallback, CP12 report/notification boundaries, CP13 logistics boundaries, CP14 compliance boundaries, and CP15 beta boundaries remain intact.
- Existing CP1 through CP15 tests continue to pass.
