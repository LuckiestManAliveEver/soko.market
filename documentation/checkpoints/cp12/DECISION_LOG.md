# CP12 Decision Log

Status: active
Date opened: 2026-07-04
Date passed: pending

This file records reports, notifications, and knowledge-layer decisions for CP12.

## Accepted Decisions

| ID       | Decision                                                                 | Rationale                                                                                      | Impact                                                                                                   |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CP12-D01 | Build reports from deterministic business records and events.            | Reports become operational truth, so totals must be reproducible and auditable.                | Report builders must use existing invoices, payments, inventory, imports, sync queue, and event records. |
| CP12-D02 | Keep CP12 notifications in-app only.                                     | External delivery requires provider, consent, retry, cost, and compliance decisions.           | SMS, email, WhatsApp, and push integrations remain deferred.                                             |
| CP12-D03 | Treat knowledge summaries as read-only runtime context.                  | Knowledge should help owners understand the business without creating hidden mutation paths.   | Runtime can summarize reports and notifications, but writes still route through deterministic tools.     |
| CP12-D04 | Scope all report, notification, and knowledge data by business and role. | Reports and alerts can reveal sensitive business state.                                        | API, UI, and runtime context must enforce active business membership and role access.                    |
| CP12-D05 | Prefer bounded summaries over raw records for model context.             | CP11 established prompt safety boundaries and should remain the default.                       | Local-model prompts can receive counts, totals, statuses, and selected bounded facts, not broad dumps.   |
| CP12-D06 | Avoid scheduled automation in this checkpoint.                           | Scheduling and background jobs require operational controls and failure handling.              | Notification records can be generated synchronously from deterministic events; delivery jobs are later.  |
| CP12-D07 | Keep analytics warehouse and provider integrations out of CP12.          | CP12 should prove product behavior before infrastructure-heavy analytics or messaging choices. | CP12 stays inside existing monorepo, API, runtime, and web boundaries.                                   |

## Deferred Decisions

| Decision                                | Deferred To | Reason                                                                               |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| SMS, email, WhatsApp, or push providers | CP14/CP15   | Requires security, privacy, consent, cost, retry, and delivery monitoring decisions. |
| Scheduled report delivery               | CP14/CP15   | Needs background jobs, persistence policy, and operational failure handling.         |
| Analytics warehouse integration         | CP15+       | Requires production data model and retention/compliance choices.                     |
| Model-assisted business recommendations | CP15+       | Requires stronger evaluation, permissions, and guardrails around suggested actions.  |
| Logistics workflows                     | CP13        | Logistics is the next checkpoint after reports and notifications.                    |
| Marketplace automation through tools    | CP17        | Marketplace workflows belong to the post-launch marketplace checkpoint.              |
| Trusted Identity Execution Layer        | CP18        | TIEL belongs after core-commerce and runtime boundaries are hardened.                |

## CP12 Boundary Checks

CP12 must preserve these checks:

- Reports are business-scoped and role-gated.
- Report totals derive from deterministic records and events.
- Notification records are business-scoped and auditable.
- Notification state changes do not mutate unrelated business records.
- Runtime knowledge summaries are bounded and read-only.
- Local-model prompts avoid broad raw business-record dumps.
- Tool execution still routes through deterministic validators.
- High and critical risk tools still require confirmation.
- CP4 deterministic parser behavior remains available.
- CP10 runtime verification and CP11 local-model fallback remain intact.
- Existing CP1 through CP11 tests continue to pass.
