# CP9 Decision Log

Status: passed
Date opened: 2026-07-03
Date passed: 2026-07-03

This file records document import decisions for CP9.

## Accepted Decisions

| ID      | Decision                                                           | Rationale                                                                                | Impact                                                                                      |
| ------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| CP9-D01 | Treat imported data as preview-only until explicit confirmation.   | Parser output can be wrong and must not become business truth automatically.             | Import jobs need a preview state and confirmation endpoint before writing business records. |
| CP9-D02 | Start with supplier CSV as the first confirmed write path.         | Supplier import is useful, lower risk than invoice/payment import, and targets CP5 data. | CP9 can prove the import pipeline before expanding to higher-risk documents.                |
| CP9-D03 | Route confirmed rows through existing business validators.         | CP5, CP6, and CP8 already own domain validation and ownership rules.                     | Import confirmation must reuse store/business-core behavior instead of duplicating rules.   |
| CP9-D04 | Preserve source metadata and import lifecycle events.              | Import workflows need traceability without trusting parser output.                       | API/store should emit import uploaded, parsed, previewed, confirmed, and failed events.     |
| CP9-D05 | Keep OCR and model-based extraction out of the opening scope.      | Image and model extraction need separate accuracy, privacy, and cost controls.           | CP9 may support structured files first and defer vision/model import to later hardening.    |
| CP9-D06 | Do not change CP8 invoice settlement rules during document import. | Payment correctness must remain stable while import support is added.                    | Payment/debt imports, if added, must create drafts/previews or use existing payment rules.  |
| CP9-D07 | Avoid plaintext logging of source document content.                | Imported documents can contain sensitive business and customer data.                     | Logs should use IDs, counts, status, and error codes rather than raw source rows.           |

## Deferred Decisions

| Decision                                      | Deferred To | Reason                                                                    |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| OCR for scanned receipts and handwritten docs | CP14/CP15   | Requires privacy, accuracy, cost, and retention hardening.                |
| Model-assisted extraction                     | CP10/CP14   | Runtime and verification boundaries should exist before model extraction. |
| Automated payment/provider reconciliation     | CP14/CP15   | Financial reconciliation requires provider and compliance hardening.      |
| Accounting/general ledger import/export       | CP12/CP14   | Reporting and compliance layers should consume stable imported records.   |
| Marketplace catalog import                    | CP17        | Marketplace ingestion belongs to post-launch marketplace foundation.      |

## CP9 Boundary Checks

CP9 must preserve these checks:

- Import jobs are business-scoped.
- Extracted rows do not become business records before confirmation.
- Confirmed rows route through existing validators.
- Import confirmation enforces server-side role checks.
- Failed imports do not corrupt existing records.
- Source data does not leak across businesses.
- Sensitive document content is not logged in plaintext.
- CP8 payment/debt settlement rules remain unchanged.
- Existing CP1 through CP8 tests continue to pass.
