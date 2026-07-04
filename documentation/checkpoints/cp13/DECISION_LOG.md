# CP13 Decision Log

Status: active
Date opened: 2026-07-04
Date passed: pending

This file records logistics decisions for CP13.

## Accepted Decisions

| ID       | Decision                                                                 | Rationale                                                                                        | Impact                                                                                                      |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| CP13-D01 | Build logistics as deterministic fulfillment records linked to invoices. | Confirmed invoices already define sale truth and customer context.                               | Logistics records must reference scoped invoice data and must not replace invoice, payment, or stock truth. |
| CP13-D02 | Keep CP13 delivery and pickup tracking in-app only.                      | External couriers, maps, messaging, and routing need provider, consent, cost, and retry choices. | Carrier, geocoding, SMS, WhatsApp, email, push, and route optimization integrations remain deferred.        |
| CP13-D03 | Treat logistics status as an explicit lifecycle.                         | Fulfillment state must be auditable and predictable for owners and runtime context.              | Status transitions need deterministic validation and audit events.                                          |
| CP13-D04 | Keep logistics updates separate from payments and inventory.             | CP6 and CP8 already own sale stock movement, invoice totals, payments, and debt.                 | Logistics status changes cannot mutate invoice totals, product stock, payment records, or customer debt.    |
| CP13-D05 | Scope all logistics data by business and role.                           | Fulfillment records can reveal customer and operational information.                             | API, UI, and runtime context must enforce active business membership and role access.                       |
| CP13-D06 | Prefer bounded summaries over raw logistics records for model context.   | CP11 and CP12 established prompt safety boundaries.                                              | Local-model prompts can receive counts and statuses, not broad customer or route dumps.                     |
| CP13-D07 | Avoid autonomous dispatch in this checkpoint.                            | Dispatch automation needs stronger operational controls and accountability.                      | Runtime can summarize or draft actions, but writes still route through deterministic tools.                 |

## Deferred Decisions

| Decision                                        | Deferred To | Reason                                                                            |
| ----------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| Courier, carrier, map, or geocoding APIs        | CP15+       | Requires provider, privacy, retry, cost, and operational failure decisions.       |
| SMS, email, WhatsApp, or push logistics notices | CP14/CP15   | Requires consent, security, privacy, delivery monitoring, and provider choices.   |
| Route optimization and driver assignment        | CP15+       | Requires real-world operational constraints and stronger safety controls.         |
| Driver marketplace or courier marketplace       | CP17+       | Marketplace workflows belong after public launch and marketplace foundation work. |
| Security and compliance hardening               | CP14        | The next checkpoint focuses on broader hardening and TIEL preparation.            |
| Trusted Identity Execution Layer                | CP18        | TIEL belongs after core-commerce and runtime boundaries are hardened.             |

## CP13 Boundary Checks

CP13 must preserve these checks:

- Logistics records are business-scoped and role-gated.
- Logistics lifecycle transitions are deterministic and auditable.
- Logistics updates do not mutate invoice totals, inventory, payments, or debt directly.
- Offline replay remains idempotent and conflict-aware for logistics mutations.
- Runtime logistics summaries are bounded and read-only.
- Local-model prompts avoid broad raw customer, route, or logistics-record dumps.
- Tool execution still routes through deterministic validators.
- High and critical risk tools still require confirmation.
- CP4 deterministic parser behavior remains available.
- CP10 runtime verification, CP11 local-model fallback, and CP12 report/notification boundaries remain intact.
- Existing CP1 through CP12 tests continue to pass.
