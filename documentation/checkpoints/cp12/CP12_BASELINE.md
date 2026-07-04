# CP12: Reports, Notifications, and Knowledge Layer

Status: passed
Date opened: 2026-07-04
Date passed: 2026-07-04
Target tag: `checkpoint/cp12-reports-knowledge`
Actual tag: `checkpoint/cp12-reports-knowledge`

## Purpose

CP12 introduces owner-facing reports, notification primitives, and a business knowledge layer on top of the stable commerce, event, sync, runtime, and local-model foundations from CP1 through CP11.

The goal is to turn existing business records and events into useful operating summaries without weakening deterministic mutation boundaries or introducing autonomous actions.

CP12 is a reporting, notification, and knowledge checkpoint. It is not a compliance hardening checkpoint, production messaging-provider checkpoint, autonomous agent checkpoint, marketplace automation checkpoint, logistics checkpoint, or TIEL checkpoint.

## Formal Entry From CP11

CP11 is accepted as passed.

CP12 starts from:

- CP2 authenticated session, active business, membership, role, and audit event contracts
- CP5 product, customer, supplier, inventory quantity, and inventory movement foundations
- CP6 invoice totals, invoice status, stock movement, and print workflow
- CP7 offline cache, sync queue, replay, and conflict surfacing
- CP8 payment records, invoice settlement, and customer debt summaries
- CP9 supplier import source metadata, preview, correction, confirmation, and import lifecycle events
- CP10 runtime sessions, turns, planning, verification, confirmation gates, telemetry, and rate limits
- CP11 optional local model adapter with deterministic fallback and bounded output parsing
- shared-types, business-core, event-core, sync-core, tool-core, API, AI runtime, and web package boundaries
- existing CI, lint, typecheck, tests, and boundary checks

## CP12 Scope

In scope:

- business report contracts for sales, inventory, payments, debt, imports, and sync health
- deterministic report builders over existing records and business events
- notification preference and notification event primitives
- in-app notification inbox or summary surface for owner workflows
- runtime-accessible knowledge summaries for reports, open debts, low stock, imports, and sync conflicts
- local-model-safe report and knowledge context that avoids raw sensitive plaintext where possible
- API endpoints for reading reports, knowledge summaries, and notifications
- owner web UI for report and notification views
- tests for business scoping, role access, deterministic totals, notification state transitions, and runtime knowledge safety
- documentation for report definitions and notification boundaries

Out of scope:

- SMS, email, WhatsApp, push, or third-party notification provider integration
- automated scheduled delivery outside in-app notification records
- autonomous agent actions based on reports or notifications
- broad compliance retention, privacy, and red-team hardening
- production analytics warehouse integration
- marketplace automation
- logistics routing or fulfillment workflows
- TIEL
- replacing existing CP5 through CP11 deterministic validators or runtime verification gates

## Target Flow

```text
Business records and events change
  -> deterministic report builders aggregate scoped records
  -> notification rules create in-app notification records for important states
  -> knowledge summaries expose bounded facts to owner UI and runtime context
  -> owner views reports, notifications, or asks runtime for summaries
  -> runtime can answer with read-only summaries or draft actions
  -> mutations still require existing deterministic validators and confirmation gates
```

## Business Rules

- Reports must be scoped to the active business and authorized user role.
- Report totals must be deterministic and derive from existing business records.
- Notification records must be auditable and business-scoped.
- Notification delivery in CP12 must remain in-app only unless explicitly deferred to a later provider checkpoint.
- Knowledge summaries must not leak data across businesses.
- Runtime-accessible knowledge must be bounded, inspectable, and read-only.
- Model output must not become report truth or mutate notification state directly.
- CP12 must preserve CP4 parser behavior, CP10 runtime verification, and CP11 local-model fallback behavior.
- CP1 through CP11 checks must continue to pass.

## CP12 Exit Criteria

CP12 can be marked passed when:

- [x] Report shared contracts exist for sales, inventory, payments, debt, imports, and sync health.
- [x] Deterministic report builders aggregate existing scoped business records.
- [x] Report API endpoints enforce business membership and role access.
- [x] Owner web UI exposes report views without regressing CP3 shell behavior.
- [x] Notification shared contracts and in-app records exist.
- [x] Notification API endpoints support listing and state changes such as read/archive.
- [x] Important business states can create deterministic in-app notification records.
- [x] Runtime knowledge summaries expose bounded read-only report and notification context.
- [x] Local-model prompts continue to avoid raw sensitive business records unless explicitly needed and bounded.
- [x] Tests prove report totals, business scoping, role access, notification state transitions, and runtime knowledge safety.
- [x] Existing CP1 through CP11 checks still pass.
- [x] Checkpoint tag `checkpoint/cp12-reports-knowledge` is created.

## Rollback Instructions

Rollback target:

- Return to CP11 local model adapter behavior.
- Preserve CP2 auth/business/session behavior.
- Preserve CP3 shell behavior.
- Preserve CP4 deterministic parser behavior.
- Preserve CP5 through CP9 deterministic business workflows.
- Preserve CP10 runtime verification behavior.
- Preserve CP11 local-model fallback behavior.
- Disable CP12 report, notification, and knowledge endpoints or hide CP12 UI surfaces.

Rollback trigger examples:

- report totals disagree with deterministic source records
- report or notification data leaks across businesses
- unauthorized roles can read restricted reports
- notification state changes mutate unrelated business data
- runtime knowledge exposes sensitive raw records unexpectedly
- model output directly mutates report or notification state
- CP4 parser behavior regresses
- CP10 runtime verification behavior regresses
- CP11 local-model fallback behavior regresses
- CP1 through CP11 checks regress

## Next Checkpoint

Next checkpoint:

- CP13: Logistics

CP13 should build logistics workflows after CP12 establishes stable reporting, notification, and knowledge surfaces.
