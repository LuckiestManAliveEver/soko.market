# CP8 Decision Log

Status: passed
Date opened: 2026-07-03
Date passed: 2026-07-03

This file records payment and debt tracking decisions for CP8.

## Accepted Decisions

| ID      | Decision                                                                                     | Rationale                                                                                  | Impact                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| CP8-D01 | Treat payment records as business-scoped invoice settlement records.                         | CP6 invoices are the stable source for amount due and ownership boundaries.                | Payment routes and storage must require business ID and invoice ID context.                                  |
| CP8-D02 | Calculate paid totals, balances, and payment status server-side.                             | Client-supplied settlement state is not reliable business truth.                           | API must derive invoice payment status from stored invoice totals and stored payment records.                |
| CP8-D03 | Keep inventory immutable during payment recording.                                           | CP6 already mutates inventory at invoice confirmation; payment settlement is separate.     | Payment recording must not create sale movements or adjust product quantities.                               |
| CP8-D04 | Prefer append-only correction through reversal or void records instead of destructive edits. | Payment history is an audit-sensitive workflow.                                            | If corrections are implemented, they should preserve original payment records and emit explicit events.      |
| CP8-D05 | Support manual payment references before live provider integrations.                         | Cash, bank, and mobile-money manual receipts are useful before webhook reconciliation.     | CP8 may record method/reference metadata without claiming provider-verified settlement.                      |
| CP8-D06 | Keep live M-Pesa/card/bank webhook reconciliation deferred.                                  | Provider integration requires credential, callback, idempotency, and settlement hardening. | CP8 should not implement live payment provider callbacks unless a later hardening checkpoint is also scoped. |
| CP8-D07 | Route safe offline payment recording through CP7 replay semantics if supported.              | Offline reliability should reuse the CP7 mutation queue and idempotency model.             | Any queued payment mutation must replay through the same server validators and avoid duplicate settlement.   |

## Deferred Decisions

| Decision                                          | Deferred To | Reason                                                            |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| M-Pesa STK push and webhook reconciliation        | CP14/CP15   | Requires provider credential, callback, and production hardening. |
| Card processor integration                        | CP14/CP15   | Requires external provider and settlement risk controls.          |
| Formal accounting export/general ledger mapping   | CP12/CP14   | Reporting and compliance layers should consume stable records.    |
| Refunds, disputes, chargebacks, and provider fees | CP14/CP15   | Requires broader financial risk and compliance treatment.         |
| Document import into payment records              | CP9         | Import parsing should target stable CP8 payment schemas.          |

## CP8 Boundary Checks

CP8 must preserve these checks:

- Payment records are business-scoped.
- Payment records reference same-business invoices.
- Payment recording enforces server-side role checks.
- Payment totals and balances are server-calculated.
- Payment recording does not mutate inventory.
- Draft invoices cannot be accidentally settled.
- Customer debt summaries do not leak across businesses.
- Live provider callbacks remain out of scope.
- Sync queue replay does not duplicate payment settlement.
- Existing CP1 through CP7 tests continue to pass.
