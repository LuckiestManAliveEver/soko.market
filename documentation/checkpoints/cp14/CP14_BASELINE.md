# CP14: Security, Compliance, and TIEL Preparation

Status: passed
Date opened: 2026-07-05
Date passed: 2026-07-05
Target tag: `checkpoint/cp14-security-compliance`
Actual tag: `checkpoint/cp14-security-compliance`

## Purpose

CP14 hardens the system before broader beta release by reviewing security-sensitive behavior, adding compliance-oriented account data controls, and preparing the product architecture for later TIEL work.

The goal is to make high-risk actions more inspectable and accountable without blocking MVP progress on full marketplace automation, production payment provider integrations, or the later Trusted Identity Execution Layer.

CP14 is a security, compliance, and TIEL-preparation checkpoint. It is not a closed beta launch checkpoint, public launch checkpoint, marketplace checkpoint, external identity network checkpoint, production payment-provider certification checkpoint, or full TIEL implementation checkpoint.

## Formal Entry From CP13

CP13 is accepted as passed.

CP14 starts from:

- CP2 authenticated session, active business, membership, role, and audit event contracts
- CP5 product, customer, supplier, inventory quantity, and inventory movement foundations
- CP6 invoice totals, invoice status, sale stock movement, and print workflow
- CP7 offline cache, sync queue, replay, and conflict surfacing
- CP8 payment records, invoice settlement, and customer debt summaries
- CP9 supplier import source metadata, preview, correction, confirmation, and import lifecycle events
- CP10 runtime sessions, turns, planning, verification, confirmation gates, telemetry, and rate limits
- CP11 optional local model adapter with deterministic fallback and bounded output parsing
- CP12 deterministic reports, in-app notifications, bounded knowledge summaries, and owner report UI
- CP13 deterministic logistics records, lifecycle validation, bounded runtime/report context, and sync replay behavior
- shared-types, business-core, event-core, sync-core, tool-core, API, AI runtime, and web package boundaries
- existing CI, lint, typecheck, tests, and boundary checks

## CP14 Scope

In scope:

- RBAC enforcement review for high-risk API and UI flows
- audit log review for sensitive commerce, account, runtime, import, logistics, and compliance actions
- sensitive data logging scan and redaction rules for application logs and runtime context
- owner account and business data export workflow
- account deletion workflow that deactivates immediately and schedules anonymization
- anonymized compliance retention rules for business records that cannot be deleted immediately
- verification tier contracts and placeholders for future identity and trust workflows
- country tax configuration contracts and first supported configuration path
- device trust level placeholder if TIEL remains deferred
- TIEL design alignment notes that prepare future integration without implementing CP18
- tests proving access control, audit, export, deletion/anonymization, retention, and prompt/log safety boundaries
- documentation for compliance workflows and rollback rules

Out of scope:

- full TIEL implementation
- biometric identity verification
- external KYC, KYB, tax, payment, SMS, email, WhatsApp, push, carrier, map, or courier provider integrations
- production payment processor certification or provider webhook reconciliation beyond existing CP8 boundaries
- closed beta onboarding and release operations
- public launch readiness
- marketplace identity, courier, merchant, or buyer trust network workflows
- autonomous account deletion, data export, tax, or verification decisions from model output
- replacing existing deterministic validators or runtime confirmation gates

## Target Flow

```text
Owner or authorized actor requests sensitive action
  -> deterministic RBAC and confirmation gates validate access
  -> audit event records the action and actor
  -> export, deletion, retention, tax, or verification workflow runs through explicit service rules
  -> logs and runtime context expose bounded non-sensitive summaries
  -> future TIEL hooks can attach without reshaping core account and business records
```

## Business Rules

- High-risk actions must be role-gated, confirmed where appropriate, and audited.
- Account deletion must deactivate access immediately before any delayed anonymization step.
- Business records needed for compliance must remain available in anonymized or minimized form.
- Data export must be scoped to the authenticated owner and active business context.
- Sensitive fields must not be written to logs, prompts, telemetry, or model context unless explicitly bounded and required.
- Verification tiers and device trust levels must be deterministic application state, not model-generated truth.
- Country tax configuration must be explicit and inspectable.
- TIEL preparation must preserve existing deterministic validators, audit events, sync replay, and runtime confirmation gates.
- CP1 through CP13 checks must continue to pass.

## CP14 Exit Criteria

CP14 can be marked passed when:

- [x] RBAC enforcement review is completed and gaps are fixed or documented.
- [x] High-risk account, business, commerce, runtime, import, logistics, export, deletion, and compliance actions are audited.
- [x] Sensitive data logging and prompt-context scan is completed with redaction or bounded-summary rules.
- [x] Owner account and business data export workflow exists and is access-controlled.
- [x] Account deletion deactivates access immediately and schedules anonymization.
- [x] Compliance-required business records are retained in anonymized or minimized form.
- [x] Verification tier contracts and deterministic update rules exist.
- [x] Country tax configuration contracts and first supported configuration path exist.
- [x] Device trust placeholder exists if full TIEL remains deferred.
- [x] TIEL design alignment is documented without implementing CP18.
- [x] Tests prove access control, audit, export, deletion/anonymization, retention, tax config, verification, and runtime/log safety.
- [x] Existing CP1 through CP13 checks still pass.
- [x] Checkpoint tag `checkpoint/cp14-security-compliance` is created.

## Rollback Instructions

Rollback target:

- Return to CP13 logistics behavior.
- Preserve CP2 auth/business/session behavior.
- Preserve CP3 shell behavior.
- Preserve CP4 deterministic parser behavior.
- Preserve CP5 through CP9 deterministic business workflows.
- Preserve CP10 runtime verification behavior.
- Preserve CP11 local-model fallback behavior.
- Preserve CP12 report, notification, and knowledge behavior.
- Preserve CP13 logistics behavior.
- Disable CP14 export, deletion, anonymization, verification, tax configuration, and device trust surfaces if they regress safety.

Rollback trigger examples:

- unauthorized users can export, delete, anonymize, or alter compliance state
- deletion fails to deactivate access immediately
- anonymization removes records that must be retained for compliance or leaves direct identifiers where they should be removed
- export leaks cross-business data
- sensitive data appears in logs, prompts, telemetry, or runtime context unexpectedly
- verification tiers or device trust states can be mutated by model output directly
- tax configuration changes invoice or payment truth without explicit deterministic rules
- audit events are missing for high-risk actions
- CP10 runtime confirmation gates regress
- CP11 local-model fallback or bounded output behavior regresses
- CP12 report/notification boundaries regress
- CP13 logistics boundaries regress
- CP1 through CP13 checks regress

## Next Checkpoint

Next checkpoint:

- CP15: Beta Release Hardening

CP15 should prepare selected merchant usage after CP14 completes security, compliance, and TIEL-preparation hardening.
