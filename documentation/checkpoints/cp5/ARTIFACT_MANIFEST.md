# CP5 Artifact Manifest

Status: active
Date opened: 2026-07-02
Date passed: pending

## Created CP5 Artifacts

| Path                                                 | Purpose                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `documentation/checkpoints/cp5/CP5_BASELINE.md`      | Formal CP5 baseline, scope, exit criteria, and rollback instructions.    |
| `documentation/checkpoints/cp5/DECISION_LOG.md`      | Business record, inventory movement, validation, and boundary decisions. |
| `documentation/checkpoints/cp5/ARTIFACT_MANIFEST.md` | This manifest.                                                           |

## Planned CP5 Artifacts

| Path/Area                     | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `infra/db/migrations/`        | Product, customer, supplier, inventory movement, and event schema.      |
| `packages/business-core/src/` | Deterministic business record validation and stock adjustment rules.    |
| `services/api/src/`           | Business-scoped product, customer, supplier, and stock adjustment APIs. |
| `apps/web/src/`               | Owner-facing product and customer workflows in the mobile shell.        |
| `tests/`                      | CP5 unit/API/web behavior tests and regression coverage.                |

## CP5 Opening Checklist

- [x] CP4 accepted as passed.
- [x] CP4 checkpoint tag exists locally.
- [x] CP4 commit is pushed to `origin/main`.
- [x] CP5 marked `active` in checkpoint log.
- [x] CP5 baseline created.
- [x] CP5 decision log created.
- [x] CP5 scope excludes invoices, tax, payments, offline sync queue, marketplace, TIEL, and model/runtime ownership.

## CP5 Completion Checklist

- [ ] Product create/edit/view implemented.
- [ ] Customer create/edit/view implemented.
- [ ] Minimal supplier create/edit/view foundation implemented.
- [ ] Inventory quantity validation implemented.
- [ ] Stock adjustment movement records implemented.
- [ ] Business events emitted for CP5 mutations.
- [ ] Server-side role checks enforced.
- [ ] CP4 parsed drafts remain non-mutating unless passed through CP5 validators.
- [ ] Existing CP1, CP2, CP3, and CP4 checks pass.
- [ ] `checkpoint/cp5-business-core-records` tag created.

## Verification

- `pnpm run ci`
- `pnpm run build`
- CP5 business-rule tests
- CP5 API mutation and boundary tests
