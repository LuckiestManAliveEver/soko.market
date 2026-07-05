# CP14 Decision Log

Status: active
Date opened: 2026-07-05
Date passed: pending

This file records security, compliance, and TIEL-preparation decisions for CP14.

## Accepted Decisions

| ID       | Decision                                                               | Rationale                                                                                       | Impact                                                                                                   |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| CP14-D01 | Treat data export and account deletion as deterministic service flows. | These workflows affect account access, privacy, and compliance retention.                       | Export, deletion, deactivation, and anonymization must not be driven directly by model output.           |
| CP14-D02 | Deactivate accounts immediately before delayed anonymization.          | Immediate access removal reduces risk while preserving retention checks and recovery auditing.  | Deletion workflow must separate access deactivation from anonymization scheduling.                       |
| CP14-D03 | Retain compliance-required business records only in minimized form.    | Commerce records can be needed for tax, audit, and dispute handling after account deletion.     | Retention rules must avoid unnecessary direct identifiers while preserving required business evidence.   |
| CP14-D04 | Prefer bounded security and compliance summaries for runtime context.  | CP10 through CP13 already restrict model context to inspectable, bounded summaries.             | Prompts and telemetry can receive status counts or flags, not raw identity, export, or deletion dumps.   |
| CP14-D05 | Keep verification tiers deterministic and application-owned.           | Trust and verification state must be auditable and cannot depend on unverified model claims.    | Verification tier updates require explicit validators, audit events, and role-gated service paths.       |
| CP14-D06 | Add device trust as a placeholder, not a full TIEL implementation.     | Full TIEL belongs later, but account and runtime boundaries should leave a stable attachment.   | CP14 may model device trust level state without external identity execution, attestation, or biometrics. |
| CP14-D07 | Keep first tax configuration explicit and country-scoped.              | Tax handling must be inspectable before launch and should not be inferred from model output.    | Tax configuration must use deterministic contracts and avoid changing prior invoice/payment truth.       |
| CP14-D08 | Audit high-risk actions before beta readiness work.                    | Beta users need accountable records for sensitive account, commerce, runtime, and data actions. | CP15 must start from audited high-risk CP14 workflows.                                                   |

## Deferred Decisions

| Decision                                          | Deferred To | Reason                                                                                  |
| ------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| Full Trusted Identity Execution Layer             | CP18        | TIEL needs a dedicated post-core hardening checkpoint and external trust architecture.  |
| Biometric identity verification                   | CP18+       | Requires consent, threat modeling, storage, retention, and vendor or device decisions.  |
| External KYC/KYB provider integration             | CP15+       | Provider choice, credential handling, cost, retry, and legal review are not CP14 scope. |
| Production payment provider certification         | CP15+       | Certification and settlement reconciliation belong closer to beta or launch hardening.  |
| SMS, email, WhatsApp, or push compliance notices  | CP15+       | Provider selection, consent, deliverability, and monitoring decisions remain open.      |
| Marketplace trust, courier trust, and buyer trust | CP17+       | Marketplace identity and trust workflows belong after public launch foundation work.    |
| Public launch regulatory signoff                  | CP16        | Launch signoff depends on beta feedback and operational readiness after CP15.           |

## CP14 Boundary Checks

CP14 must preserve these checks:

- Account, business, role, and session state remains business-scoped.
- Data export is owner-scoped and cannot leak cross-business records.
- Account deletion deactivates access immediately before anonymization.
- Retained compliance records avoid unnecessary direct identifiers.
- High-risk account, commerce, runtime, import, logistics, export, deletion, verification, and tax actions are audited.
- Sensitive fields do not appear in logs, prompts, telemetry, or runtime context unless explicitly bounded and required.
- Verification tiers and device trust levels are deterministic application state.
- Tax configuration is country-scoped and explicit.
- Tool execution still routes through deterministic validators.
- High and critical risk tools still require confirmation.
- CP4 deterministic parser behavior remains available.
- CP10 runtime verification, CP11 local-model fallback, CP12 report/notification boundaries, and CP13 logistics boundaries remain intact.
- Existing CP1 through CP13 tests continue to pass.
