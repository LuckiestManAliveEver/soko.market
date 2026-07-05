# CP14 Security, Compliance, and TIEL Preparation

CP14 adds deterministic security and compliance workflows before beta hardening.

## Implemented Workflows

CP14 includes:

- owner-scoped account and business data export
- account deletion request that deactivates active sessions immediately and schedules anonymization
- compliance retention summaries for invoices, payments, logistics, imports, and audit events
- verification tier contracts with deterministic updates
- Kenya tax configuration with explicit default tax rate and KRA PIN label
- device trust level placeholder for future TIEL work
- security review summary for RBAC, audit coverage, sensitive data exposure, and TIEL readiness
- bounded compliance report, knowledge, runtime context, and local-model prompt fields

## API Surface

- `GET /businesses/:businessId/compliance/security-review`
- `POST /businesses/:businessId/compliance/export`
- `POST /businesses/:businessId/compliance/account-deletion`
- `GET /businesses/:businessId/compliance/verification`
- `PATCH /businesses/:businessId/compliance/verification`
- `GET /businesses/:businessId/compliance/tax-config`
- `PATCH /businesses/:businessId/compliance/tax-config`
- `GET /businesses/:businessId/compliance/device-trust`
- `PATCH /businesses/:businessId/compliance/device-trust`

## Boundaries

Only deterministic service methods can create exports, schedule deletion, update verification, update tax config, or update device trust. Model output does not mutate compliance state directly.

Audit events for high-risk CP14 workflows store identifiers, counts, statuses, checksums, and retention summaries. They do not store raw export payloads, deletion reasons, customer addresses, or broad identity dumps.

Runtime and local-model prompts receive bounded compliance fields:

- export count
- scheduled deletion count
- verification tier
- device trust level
- knowledge fact count

They do not receive raw customer, export, account deletion, tax id, or device reason records.

## Deferred Work

CP14 does not implement full TIEL, biometric identity verification, external KYC/KYB providers, payment provider certification, public launch signoff, or marketplace trust workflows. Those remain deferred to CP15, CP16, CP17, or CP18 according to the checkpoint roadmap.
