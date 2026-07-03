# CP8 Artifact Manifest

Status: passed
Date opened: 2026-07-03
Date passed: 2026-07-03

## Created CP8 Artifacts

| Path                                                 | Purpose                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `documentation/checkpoints/cp8/CP8_BASELINE.md`      | Formal CP8 baseline, scope, exit criteria, and rollback rules.           |
| `documentation/checkpoints/cp8/DECISION_LOG.md`      | Payment, debt, settlement, provider-boundary, and sync replay decisions. |
| `documentation/checkpoints/cp8/ARTIFACT_MANIFEST.md` | This manifest.                                                           |

## Implemented CP8 Artifacts

| Path                                            | Purpose                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/index.ts`            | Shared payment, payment status, invoice balance, and debt contracts.                               |
| `packages/business-core/src/index.ts`           | Deterministic payment validation, balance calculation, roles, and event rules.                     |
| `packages/sync-core/src/index.ts`               | `payment.record` sync mutation whitelist support.                                                  |
| `services/api/src/cp2/store.ts`                 | Business-scoped payment ledger, invoice settlement, debt summaries, and replay behavior.           |
| `services/api/src/cp2/routes.ts`                | Payment, invoice payment, debt, and sync payload route parsing.                                    |
| `apps/web/src/cp3-shell.ts`                     | Active CP8 Payments navigation metadata.                                                           |
| `apps/web/src/main.tsx`                         | Owner payment recording, invoice balance, customer debt, and recent ledger workflow.               |
| `infra/db/schema.ts`                            | Durable payment table schema.                                                                      |
| `infra/db/migrations/005_cp8_payments_debt.sql` | CP8 migration for payment records and settlement lookup indexes.                                   |
| `tests/business-core.test.ts`                   | CP8 payment validation, permissions, settlement, and event tests.                                  |
| `tests/cp8-payments-debt.test.ts`               | CP8 API payment/debt, inventory immutability, overpayment, draft, offline replay, and cache tests. |
| `tests/cp3-shell.test.ts`                       | Active CP8 shell contract tests.                                                                   |

## CP8 Opening Checklist

- [x] CP7 accepted as passed.
- [x] CP7 checkpoint tag exists locally and on GitHub.
- [x] CP7 commits are pushed to `origin/main`.
- [x] CP8 marked `active` in checkpoint log.
- [x] CP8 baseline created.
- [x] CP8 decision log created.
- [x] CP8 scope excludes live M-Pesa callbacks, live card processing, document import, marketplace, TIEL, local model, and full runtime ownership.

## CP8 Completion Checklist

- [x] Payment shared contracts implemented.
- [x] Invoice payment status and balance contracts implemented.
- [x] Payment storage/schema implemented.
- [x] Payment create/list/view routes implemented.
- [x] Business-scoped payment role checks implemented.
- [x] Deterministic payment amount validation implemented.
- [x] Invoice paid total, balance, and payment status implemented.
- [x] Customer debt summaries implemented.
- [x] Payment business events emitted.
- [x] Payment recording leaves inventory unchanged.
- [x] Owner payment/debt UI implemented.
- [x] CP7 replay behavior for payment mutations implemented or explicitly rejected with tests.
- [x] Existing CP1 through CP7 checks pass.
- [x] `checkpoint/cp8-payments-debt` tag created.

## Verification

Passed verification:

- `pnpm run ci`
- `pnpm build`
- `pnpm vitest run tests/business-core.test.ts tests/cp8-payments-debt.test.ts tests/cp3-shell.test.ts tests/cp7-offline-sync.test.ts tests/sync-core.test.ts`
