# CP5 Decision Log

Status: active
Date opened: 2026-07-02
Date passed: pending

This file records business core records decisions for CP5.

## Accepted Decisions

| ID      | Decision                                                                                       | Rationale                                                                         | Impact                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CP5-D01 | Implement product, customer, and minimal supplier records as business-scoped server resources. | CP5 owns deterministic core records and must preserve CP2 business boundaries.    | API and data models must require business ownership context for record reads and writes.                   |
| CP5-D02 | Store product inventory quantity with the product foundation and track changes as movements.   | The roadmap requires quantity visibility before invoice and inventory flows.      | Stock adjustment code must create inventory movement records instead of silently replacing quantity.       |
| CP5-D03 | Treat stock adjustment as the only CP5 inventory mutation.                                     | CP6 owns invoice-driven inventory movement and richer stock rules.                | CP5 can validate manual adjustments without pulling invoice, tax, or payment workflows forward.            |
| CP5-D04 | Use explicit server-side role checks for all CP5 mutations.                                    | CP2 established memberships and role values; CP5 introduces real business writes. | Client state may guide UI, but the API must enforce mutation permissions.                                  |
| CP5-D05 | Emit events for product, customer, supplier, and stock mutations.                              | CP0 requires auditable state-changing business behavior.                          | CP5 mutations must append immutable event records that later sync, reporting, and audit flows can consume. |
| CP5-D06 | Keep CP4 parsed drafts non-mutating until routed through CP5 validators.                       | Parser output is not business truth and may be incomplete or low confidence.      | Chat can prefill draft data later, but persistence must pass CP5 APIs and validation.                      |
| CP5-D07 | Defer invoice, tax, payment, debt, and M-Pesa behavior to later checkpoints.                   | These workflows have separate roadmap checkpoints and higher correctness risk.    | CP5 APIs and UI must avoid partial invoice/payment abstractions.                                           |
| CP5-D08 | Keep offline durable storage and sync queue selection deferred to CP7.                         | CP7 owns conflict rules and durable local mutation handling.                      | CP5 may use online server-backed records without committing to IndexedDB, Dexie, or native SQLite.         |

## Deferred Decisions

| Decision                            | Deferred To | Reason                                                                     |
| ----------------------------------- | ----------- | -------------------------------------------------------------------------- |
| Invoice creation and invoice totals | CP6         | Requires deterministic invoice, tax, and inventory rules.                  |
| Tax rules for first launch country  | CP6/CP14    | Tax behavior belongs with invoices and compliance hardening.               |
| Payment, debt, and M-Pesa execution | CP8         | Payment trust, reconciliation, and webhooks belong to payments checkpoint. |
| Durable offline mutation queue      | CP7         | Offline conflict behavior should drive storage and queue design.           |
| Document import for records         | CP9         | Import parsing and reconciliation should target stable CP5 schemas.        |
| Full staff invitations and role UI  | CP5 later   | CP5 needs role enforcement, but can defer richer staff administration UX.  |
| AI/model execution of record writes | CP10/CP11   | Parser/model integrations must remain behind deterministic business tools. |

## CP5 Boundary Checks

CP5 must preserve these checks:

- Business records do not import AI runtime implementation.
- CP4 parser output does not persist records directly.
- Product, customer, supplier, and stock mutations are business-scoped.
- Product, customer, supplier, and stock mutations enforce server-side roles.
- Stock adjustment creates inventory movement records.
- State-changing business operations emit events.
- Existing CP1, CP2, CP3, and CP4 tests continue to pass.
