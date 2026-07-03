# CP9 Artifact Manifest

Status: passed
Date opened: 2026-07-03
Date passed: 2026-07-03

## Created CP9 Artifacts

| Path                                                 | Purpose                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `documentation/checkpoints/cp9/CP9_BASELINE.md`      | Formal CP9 baseline, scope, exit criteria, and rollback rules.      |
| `documentation/checkpoints/cp9/DECISION_LOG.md`      | Document import, preview, confirmation, parser, and boundary rules. |
| `documentation/checkpoints/cp9/ARTIFACT_MANIFEST.md` | This manifest.                                                      |

## Implemented CP9 Artifacts

| Path                                              | Purpose                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/shared-types/src/index.ts`              | Shared import job, source document, mapping, preview row, and result types.   |
| `packages/business-core/src/index.ts`             | Deterministic import validation and import lifecycle event helpers.           |
| `services/api/src/cp2/store.ts`                   | Business-scoped import job storage, preview generation, and confirmation.     |
| `services/api/src/cp2/routes.ts`                  | Import upload/provide, preview, correction, and confirmation routes.          |
| `apps/web/src/cp3-shell.ts`                       | Active CP9 import navigation metadata if a quick action is added.             |
| `apps/web/src/main.tsx`                           | Owner import workflow for upload/provide, mapping, preview, and confirmation. |
| `infra/db/schema.ts`                              | Durable import job/source document schema.                                    |
| `infra/db/migrations/006_cp9_document_import.sql` | CP9 migration for document import jobs and source metadata.                   |
| `tests/business-core.test.ts`                     | Import validation and event tests.                                            |
| `tests/cp9-document-import.test.ts`               | API import preview/confirm/failure tests.                                     |
| `tests/cp3-shell.test.ts`                         | Import shell contract tests if navigation changes.                            |

## CP9 Opening Checklist

- [x] CP8 accepted as passed.
- [x] CP9 marked `active` in checkpoint log.
- [x] CP9 baseline created.
- [x] CP9 decision log created.
- [x] CP9 scope excludes OCR, automatic reconciliation, marketplace ingestion, TIEL, local model, and full runtime ownership.

## CP9 Completion Checklist

- [x] Document import shared contracts implemented.
- [x] Source document/import job storage implemented.
- [x] Supplier CSV import preview implemented.
- [x] Import row correction/mapping implemented.
- [x] Import confirmation implemented through existing validators.
- [x] Import lifecycle events emitted.
- [x] Failed imports leave existing records unchanged.
- [x] Owner import UI implemented.
- [x] Existing CP1 through CP8 checks pass.
- [x] `checkpoint/cp9-document-import` tag created.

## Verification

Passed verification:

- `pnpm test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm format`
- `pnpm build`
- `pnpm vitest run tests/business-core.test.ts tests/cp9-document-import.test.ts tests/cp3-shell.test.ts`
