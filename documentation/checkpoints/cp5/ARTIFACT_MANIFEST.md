# CP5 Artifact Manifest

Status: passed
Date opened: 2026-07-02
Date passed: 2026-07-02

## Created CP5 Artifacts

| Path                                                 | Purpose                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `documentation/checkpoints/cp5/CP5_BASELINE.md`      | Formal CP5 baseline, scope, exit criteria, and rollback instructions.    |
| `documentation/checkpoints/cp5/DECISION_LOG.md`      | Business record, inventory movement, validation, and boundary decisions. |
| `documentation/checkpoints/cp5/ARTIFACT_MANIFEST.md` | This manifest.                                                           |

## Implemented CP5 Artifacts

| Path                                                    | Purpose                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `infra/db/schema.ts`                                    | Drizzle schema for products, customers, suppliers, and movements.       |
| `infra/db/migrations/002_cp5_business_core_records.sql` | SQL migration for CP5 business core records.                            |
| `packages/shared-types/src/index.ts`                    | Shared product, customer, supplier, and inventory movement contracts.   |
| `packages/business-core/src/index.ts`                   | Deterministic validation, permission, normalization, and event rules.   |
| `services/api/src/cp2/store.ts`                         | In-memory CP5 record store with business-scoped role enforcement.       |
| `services/api/src/cp2/routes.ts`                        | Product, customer, supplier, and stock adjustment API routes.           |
| `apps/web/src/main.tsx`                                 | Owner product/customer workflows and stock adjustment controls.         |
| `apps/web/src/cp3-shell.ts`                             | Shell copy updated for active CP5 product/customer records.             |
| `apps/web/src/styles.css`                               | CP5 record form and list styling.                                       |
| `tests/business-core.test.ts`                           | CP5 validation, permissions, and immutable event coverage.              |
| `tests/cp5-business-records.test.ts`                    | CP5 API coverage for records, stock movements, validation, and auth.    |
| `tests/cp3-shell.test.ts`                               | Updated shell contract for active CP5 records and deterministic writes. |

## CP5 Opening Checklist

- [x] CP4 accepted as passed.
- [x] CP4 checkpoint tag exists locally.
- [x] CP4 commit is pushed to `origin/main`.
- [x] CP5 marked `active` in checkpoint log.
- [x] CP5 baseline created.
- [x] CP5 decision log created.
- [x] CP5 scope excludes invoices, tax, payments, offline sync queue, marketplace, TIEL, and model/runtime ownership.

## CP5 Completion Checklist

- [x] Product create/edit/view implemented.
- [x] Customer create/edit/view implemented.
- [x] Minimal supplier create/edit/view foundation implemented.
- [x] Inventory quantity validation implemented.
- [x] Stock adjustment movement records implemented.
- [x] Business events emitted for CP5 mutations.
- [x] Server-side role checks enforced.
- [x] CP4 parsed drafts remain non-mutating unless passed through CP5 validators.
- [x] Existing CP1, CP2, CP3, and CP4 checks pass.
- [x] `checkpoint/cp5-business-core-records` tag created.

## Verification

- `pnpm run ci`
- `pnpm run build`
- CP5 business-rule tests
- CP5 API mutation and boundary tests
