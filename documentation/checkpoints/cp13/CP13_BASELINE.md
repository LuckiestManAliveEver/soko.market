# CP13: Logistics

Status: active
Date opened: 2026-07-04
Date passed: pending
Target tag: `checkpoint/cp13-logistics`
Actual tag: pending

## Purpose

CP13 introduces logistics primitives on top of the stable account, commerce, invoice, payment, import, sync, runtime, local-model, report, notification, and knowledge foundations from CP1 through CP12.

The goal is to let a business track fulfillment work for confirmed sales without weakening deterministic inventory, invoice, payment, sync, runtime, or notification boundaries.

CP13 is a logistics checkpoint. It is not a compliance hardening checkpoint, production carrier integration checkpoint, autonomous dispatch checkpoint, marketplace automation checkpoint, TIEL checkpoint, or public-launch checkpoint.

## Formal Entry From CP12

CP12 is accepted as passed.

CP13 starts from:

- CP2 authenticated session, active business, membership, role, and audit event contracts
- CP5 product, customer, supplier, inventory quantity, and inventory movement foundations
- CP6 invoice totals, invoice status, sale stock movement, and print workflow
- CP7 offline cache, sync queue, replay, and conflict surfacing
- CP8 payment records, invoice settlement, and customer debt summaries
- CP9 supplier import source metadata, preview, correction, confirmation, and import lifecycle events
- CP10 runtime sessions, turns, planning, verification, confirmation gates, telemetry, and rate limits
- CP11 optional local model adapter with deterministic fallback and bounded output parsing
- CP12 deterministic reports, in-app notifications, bounded knowledge summaries, and owner report UI
- shared-types, business-core, event-core, sync-core, tool-core, API, AI runtime, and web package boundaries
- existing CI, lint, typecheck, tests, and boundary checks

## CP13 Scope

In scope:

- shared logistics contracts for delivery or pickup fulfillment records
- deterministic fulfillment status lifecycle for confirmed invoices
- business-scoped logistics API endpoints with role-gated access
- audit events for logistics creation and status changes
- owner web UI for viewing and updating fulfillment work
- report, notification, or knowledge summaries that expose bounded logistics state where useful
- runtime-readable logistics context that remains read-only unless routed through deterministic tools
- tests for business scoping, role access, invoice linkage, status transitions, audit events, offline/sync boundaries, and runtime safety
- documentation for logistics lifecycle and operational boundaries

Out of scope:

- external carrier, courier, mapping, geocoding, SMS, email, WhatsApp, or push integrations
- automated dispatch, route optimization, or autonomous fulfillment actions
- production driver or courier marketplace workflows
- payment collection changes beyond existing CP8 payment records
- broad compliance retention, privacy, and red-team hardening
- public marketplace automation
- TIEL
- replacing existing CP5 through CP12 deterministic validators or runtime verification gates

## Target Flow

```text
Confirmed invoice exists
  -> owner creates or reviews fulfillment work
  -> deterministic logistics lifecycle tracks pickup or delivery status
  -> audit events record creation and status changes
  -> reports, notifications, and runtime context can summarize bounded logistics state
  -> runtime can answer with read-only summaries or draft actions
  -> mutations still require deterministic validators and confirmation gates
```

## Business Rules

- Logistics records must be scoped to the active business and authorized user role.
- Logistics records must link to existing business records, such as invoices and customers, without changing invoice totals.
- Logistics status changes must be deterministic, auditable, and reject invalid transitions.
- Logistics updates must not mutate inventory, payments, or customer debt directly.
- Offline replay must remain idempotent and conflict-aware for logistics mutations that enter the sync queue.
- Runtime-accessible logistics context must be bounded, inspectable, and read-only.
- Model output must not become logistics truth or mutate fulfillment state directly.
- CP13 must preserve CP4 parser behavior, CP10 runtime verification, CP11 local-model fallback behavior, and CP12 report/notification boundaries.
- CP1 through CP12 checks must continue to pass.

## CP13 Exit Criteria

CP13 can be marked passed when:

- [ ] Logistics shared contracts exist for fulfillment records, methods, statuses, and summaries.
- [ ] Deterministic logistics builders or validators enforce invoice linkage and status transitions.
- [ ] Logistics API endpoints enforce business membership and role access.
- [ ] Owner web UI exposes logistics workflows without regressing CP3 shell behavior.
- [ ] Logistics audit events are emitted for creation and status changes.
- [ ] Logistics records remain business-scoped and do not leak across businesses.
- [ ] Logistics updates do not mutate invoice totals, inventory, payments, or debt directly.
- [ ] Runtime knowledge summaries expose bounded read-only logistics context.
- [ ] Local-model prompts continue to avoid raw sensitive business records unless explicitly needed and bounded.
- [ ] Tests prove logistics lifecycle, scoping, role access, audit events, sync boundaries, and runtime safety.
- [ ] Existing CP1 through CP12 checks still pass.
- [ ] Checkpoint tag `checkpoint/cp13-logistics` is created.

## Rollback Instructions

Rollback target:

- Return to CP12 reports, notifications, and knowledge behavior.
- Preserve CP2 auth/business/session behavior.
- Preserve CP3 shell behavior.
- Preserve CP4 deterministic parser behavior.
- Preserve CP5 through CP9 deterministic business workflows.
- Preserve CP10 runtime verification behavior.
- Preserve CP11 local-model fallback behavior.
- Preserve CP12 report, notification, and knowledge behavior.
- Disable CP13 logistics endpoints or hide CP13 UI surfaces.

Rollback trigger examples:

- logistics records leak across businesses
- unauthorized roles can read or mutate logistics records
- status transitions become non-deterministic or unaudited
- logistics updates mutate invoice totals, inventory, payments, or debt unexpectedly
- offline replay creates duplicate fulfillment records
- runtime knowledge exposes sensitive raw logistics records unexpectedly
- model output directly mutates logistics state
- CP4 parser behavior regresses
- CP10 runtime verification behavior regresses
- CP11 local-model fallback behavior regresses
- CP12 report or notification behavior regresses
- CP1 through CP12 checks regress

## Next Checkpoint

Next checkpoint:

- CP14: Security, Compliance, and TIEL Preparation

CP14 should harden security, compliance, and identity-execution preparation after CP13 establishes stable logistics surfaces.
