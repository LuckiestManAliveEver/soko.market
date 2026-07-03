# CP7 Artifact Manifest

Status: active
Date opened: 2026-07-03
Date passed: pending

## Created CP7 Artifacts

| Path                                                 | Purpose                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `documentation/checkpoints/cp7/CP7_BASELINE.md`      | Formal CP7 baseline, scope, exit criteria, and rollback rules.            |
| `documentation/checkpoints/cp7/DECISION_LOG.md`      | Offline local data, sync queue, replay, conflict, and boundary decisions. |
| `documentation/checkpoints/cp7/ARTIFACT_MANIFEST.md` | This manifest.                                                            |

## Planned CP7 Implementation Artifacts

| Path                        | Purpose                                                                      |
| --------------------------- | ---------------------------------------------------------------------------- |
| `packages/shared-types/src` | Shared sync queue, cache, mutation envelope, and conflict contracts.         |
| `packages/sync-core/src`    | Deterministic queue state, replay planning, idempotency, and conflict rules. |
| `services/api/src`          | API integration for sync replay and business-scoped queue operations.        |
| `apps/web/src`              | Offline status, queued work, retry, and conflict shell integration.          |
| `infra/db/schema.ts`        | Durable sync queue/cache schema additions if needed.                         |
| `infra/db/migrations`       | CP7 migration for durable sync queue/cache tables if needed.                 |
| `tests`                     | CP7 sync queue, offline read, replay, idempotency, and conflict tests.       |

## CP7 Opening Checklist

- [x] CP6 accepted as passed.
- [x] CP6 checkpoint tag exists locally and on GitHub.
- [x] CP6 commits are pushed to `origin/main`.
- [x] CP7 marked `active` in checkpoint log.
- [x] CP7 baseline created.
- [x] CP7 decision log created.
- [x] CP7 scope excludes payments, debt tracking, M-Pesa, document import, marketplace, TIEL, local model, and full runtime ownership.

## CP7 Completion Checklist

- [ ] Local cache contracts implemented.
- [ ] Durable sync queue model implemented.
- [ ] Mutation envelope metadata implemented.
- [ ] Queue replay through existing business/API validation implemented.
- [ ] Queue idempotency implemented and tested.
- [ ] Queue conflict states implemented and surfaced.
- [ ] Offline status and queued work UI implemented.
- [ ] Manual retry behavior implemented.
- [ ] CP5 inventory conflict tests implemented.
- [ ] CP6 invoice confirmation conflict tests implemented.
- [ ] Existing CP1 through CP6 checks pass.
- [ ] `checkpoint/cp7-offline-sync` tag created.

## Verification

Planned verification:

- `pnpm run ci`
- `pnpm build`
- CP7 sync-core unit tests
- CP7 API replay, idempotency, and business-boundary tests
- CP7 web shell offline/queue state tests
