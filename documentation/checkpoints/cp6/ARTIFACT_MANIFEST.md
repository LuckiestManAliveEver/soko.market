# CP6 Artifact Manifest

Status: active
Date opened: 2026-07-03
Date passed: pending

## Created CP6 Artifacts

| Path                                                 | Purpose                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `documentation/checkpoints/cp6/CP6_BASELINE.md`      | Formal CP6 baseline, scope, exit criteria, and rollback rules.      |
| `documentation/checkpoints/cp6/DECISION_LOG.md`      | Invoice, inventory confirmation, tax placeholder, and boundary log. |
| `documentation/checkpoints/cp6/ARTIFACT_MANIFEST.md` | This manifest.                                                      |

## Planned CP6 Implementation Artifacts

| Path or Area                          | Purpose                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `infra/db/schema.ts`                  | Invoice, invoice item, and invoice numbering schema additions.                   |
| `infra/db/migrations/003_*`           | SQL migration for CP6 invoice and inventory flow records.                        |
| `packages/shared-types/src/index.ts`  | Shared invoice, invoice item, invoice status, and preview contracts.             |
| `packages/business-core/src/index.ts` | Deterministic invoice validation, total calculation, numbering, and event rules. |
| `services/api/src/cp2/store.ts`       | In-memory CP6 invoice store and inventory confirmation behavior.                 |
| `services/api/src/cp2/routes.ts`      | Invoice preview, create/update draft, confirm, and list/view API routes.         |
| `apps/web/src/main.tsx`               | Owner invoice workflow, preview, confirmation, and print-ready view.             |
| `apps/web/src/cp3-shell.ts`           | Shell copy updated for active CP6 invoice workflow.                              |
| `apps/web/src/styles.css`             | CP6 invoice workflow styling.                                                    |
| `tests/business-core.test.ts`         | Invoice math, validation, and event coverage.                                    |
| `tests/cp6-invoice-inventory.test.ts` | CP6 API coverage for invoice lifecycle, inventory effects, auth, and boundaries. |
| `tests/cp4-rule-parser.test.ts`       | Parser coverage for invoice draft commands if chat drafting is extended.         |
| `tests/cp3-shell.test.ts`             | Shell contract updates for active invoice workflow.                              |

## CP6 Opening Checklist

- [x] CP5 accepted as passed.
- [x] CP5 checkpoint tag exists locally.
- [x] CP5 commits are pushed to `origin/main`.
- [x] CP6 marked `active` in checkpoint log.
- [x] CP6 baseline created.
- [x] CP6 decision log created.
- [x] CP6 scope excludes payments, debt tracking, M-Pesa, offline sync queue, document import, marketplace, TIEL, and model/runtime ownership.

## CP6 Completion Checklist

- [ ] Invoice create/preview/confirm/list implemented.
- [ ] Invoice item records implemented.
- [ ] Business-scoped invoice numbering implemented.
- [ ] Deterministic invoice total calculation implemented.
- [ ] Configurable tax placeholder implemented.
- [ ] Inventory availability check implemented.
- [ ] Confirmed invoice stock movements implemented.
- [ ] Business events emitted for CP6 mutations.
- [ ] Server-side role checks enforced.
- [ ] CP4 parsed drafts remain non-mutating unless passed through CP6 validators and confirmation.
- [ ] Existing CP1, CP2, CP3, CP4, and CP5 checks pass.
- [ ] `checkpoint/cp6-invoice-inventory` tag created.

## Verification

- `pnpm run ci`
- `pnpm run build`
- CP6 invoice business-rule tests
- CP6 API mutation, inventory, auth, and boundary tests
