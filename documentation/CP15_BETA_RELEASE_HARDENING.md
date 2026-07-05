# CP15 Beta Release Hardening

CP15 adds deterministic closed beta readiness workflows for selected merchant usage.

## Implemented Workflows

CP15 includes:

- reversible closed beta access gate with a 10-merchant target
- beta feature flags for closed beta, offline hardening, controlled payments, support intake, and crash telemetry
- 1 GB and 2 GB Android device test records
- offline readiness checks across products, customers, invoices, payments, and logistics
- sync stress readiness based on repeated queued mutation replay
- payment reconciliation checks against CP8 invoice settlement truth
- beta support tickets with severity labels and status updates
- crash, error, and session telemetry records that store hashes and bounded metadata instead of raw payloads
- beta readiness report exposed through API, web UI, deterministic business reports, knowledge facts, and runtime context

## API Surface

- `GET /businesses/:businessId/beta/readiness`
- `PATCH /businesses/:businessId/beta/access`
- `GET /businesses/:businessId/beta/feature-flags`
- `PATCH /businesses/:businessId/beta/feature-flags/:featureFlagKey`
- `POST /businesses/:businessId/beta/device-tests`
- `GET /businesses/:businessId/beta/support-tickets`
- `POST /businesses/:businessId/beta/support-tickets`
- `PATCH /businesses/:businessId/beta/support-tickets/:supportTicketId`
- `POST /businesses/:businessId/beta/telemetry`

## Boundaries

Closed beta state is deterministic application state. Model output does not grant beta access, enable feature flags, create support tickets, mark device tests, or record telemetry.

Runtime and local-model prompts receive bounded CP15 fields:

- beta access status
- beta readiness status
- open support ticket count
- crash-free session rate

They do not receive raw support bodies, telemetry messages, customer details, payment references, export payloads, or account deletion reasons.

Audit events for CP15 store identifiers, statuses, severity labels, counts, hashes, and feature flag state. They do not store raw support body text or telemetry messages.

## Deferred Work

CP15 does not implement public launch rollout, production infrastructure-as-code, broad external KYC/KYB, payment provider certification, SMS/email/WhatsApp/push providers, marketplace trust workflows, autonomous background agents, or full TIEL. Those remain deferred to CP16, CP17, or CP18 according to the checkpoint roadmap.
