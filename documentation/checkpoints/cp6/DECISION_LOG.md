# CP6 Decision Log

Status: passed
Date opened: 2026-07-03
Date passed: 2026-07-03

This file records invoice and inventory flow decisions for CP6.

## Accepted Decisions

| ID      | Decision                                                                                        | Rationale                                                                                 | Impact                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| CP6-D01 | Implement invoices and invoice items as business-scoped server resources.                       | CP6 owns the first commerce workflow and must preserve CP2/CP5 business boundaries.       | API and data models must require business ownership context for invoice reads and writes.                          |
| CP6-D02 | Treat invoice preview/draft as non-mutating and invoice confirmation as the inventory mutation. | Owners need to review totals before stock changes; CP5 already established movement logs. | Draft and preview routes must not change product quantity or create inventory movements.                           |
| CP6-D03 | Calculate invoice totals server-side.                                                           | Client-supplied totals are not reliable business truth.                                   | API must derive subtotal, tax placeholder/configurable tax, and total from validated line item inputs.             |
| CP6-D04 | Generate invoice numbers per business.                                                          | Invoice numbers are merchant-facing records and should not collide across a business.     | Store or derive business-scoped numbering state and test sequential/unique behavior.                               |
| CP6-D05 | Emit inventory movement records for confirmed sale line items.                                  | CP5 established inventory movement as the audit trail for quantity changes.               | Confirmation must append movement records with before/after quantities instead of silently decrementing products.  |
| CP6-D06 | Keep payment, debt, and M-Pesa behavior deferred to CP8.                                        | Payment correctness and reconciliation are separate higher-risk workflows.                | CP6 may show unpaid/issued invoice state only if needed, but must not implement payment recording.                 |
| CP6-D07 | Keep production tax compliance deferred to CP14 while adding a deterministic tax placeholder.   | Full jurisdiction rules belong to compliance hardening.                                   | CP6 can support a configurable tax line for total math without claiming compliance.                                |
| CP6-D08 | Keep chat-created invoice flows behind deterministic draft validation and owner confirmation.   | CP4 parser output is not business truth.                                                  | Chat can generate a draft/preview, but persistence and stock mutation require CP6 API validation and confirmation. |

## Deferred Decisions

| Decision                                      | Deferred To | Reason                                                                            |
| --------------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| Payment recording and paid/unpaid settlement  | CP8         | Requires payment trust, reconciliation, and debt rules.                           |
| M-Pesa integration and webhook reconciliation | CP8         | Payment provider behavior belongs to the payments checkpoint.                     |
| Durable offline invoice confirmation queue    | CP7         | Offline conflict behavior should drive queue design.                              |
| Full tax compliance by launch country         | CP14        | Compliance hardening should validate jurisdiction-specific tax behavior.          |
| PDF generation service                        | CP6 later   | Printable browser output may satisfy CP6 unless PDF generation is clearly needed. |
| Document import into invoices                 | CP9         | Import parsing and reconciliation should target stable invoice schemas.           |
| AI/model execution of invoice confirmation    | CP10/CP11   | Parser/model integrations must remain behind deterministic business tools.        |

## CP6 Boundary Checks

CP6 must preserve these checks:

- Invoice records do not import AI runtime implementation.
- CP4 parser output does not persist or confirm invoices directly.
- Invoice and invoice item mutations are business-scoped.
- Invoice mutations enforce server-side roles.
- Invoice preview/draft does not mutate inventory.
- Invoice confirmation creates inventory movement records.
- Invoice totals are server-calculated and deterministic.
- Payment, debt, and M-Pesa behavior remain out of scope.
- Existing CP1, CP2, CP3, CP4, and CP5 tests continue to pass.
