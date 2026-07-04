# CP12 Artifact Manifest

Status: active
Date opened: 2026-07-04
Date passed: pending

## Created CP12 Artifacts

| Path                                                  | Purpose                                                                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `documentation/checkpoints/cp12/CP12_BASELINE.md`     | Formal CP12 baseline, scope, exit criteria, and rollback rules.              |
| `documentation/checkpoints/cp12/DECISION_LOG.md`      | Reports, notifications, knowledge, provider, and runtime-boundary decisions. |
| `documentation/checkpoints/cp12/ARTIFACT_MANIFEST.md` | This manifest.                                                               |

## Planned CP12 Implementation Artifacts

| Path                                  | Purpose                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/shared-types/src/index.ts`  | Shared report, notification, and knowledge summary contracts.                             |
| `packages/business-core/src/index.ts` | Deterministic report and notification rule helpers if they fit business-core boundaries.  |
| `packages/event-core/src/index.ts`    | Event contracts or helpers needed for report and notification auditability.               |
| `services/api/src/cp2/*`              | Business-scoped report, notification, and knowledge endpoints plus in-memory store state. |
| `packages/tool-core/src/index.ts`     | Runtime read-only knowledge/report tool support if needed.                                |
| `apps/web/src/*`                      | Owner-facing report, notification, and knowledge UI surfaces.                             |
| `tests/*cp12*`                        | Report totals, scoping, role access, notification, and runtime knowledge safety tests.    |
| `documentation/*`                     | Report definitions and notification boundary documentation.                               |

## CP12 Opening Checklist

- [x] CP11 accepted as passed.
- [x] CP11 checkpoint tag exists locally and on GitHub.
- [x] CP11 commits are pushed to `origin/main`.
- [x] CP12 marked `active` in checkpoint log.
- [x] CP12 baseline created.
- [x] CP12 decision log created.
- [x] CP12 scope excludes external notification providers, autonomous actions, analytics warehouse integration, marketplace automation, logistics implementation, and TIEL.

## CP12 Completion Checklist

- [ ] Report shared contracts implemented.
- [ ] Deterministic report builders implemented.
- [ ] Report API endpoints implemented.
- [ ] Owner report UI implemented.
- [ ] Notification shared contracts implemented.
- [ ] In-app notification records and state transitions implemented.
- [ ] Notification API endpoints implemented.
- [ ] Runtime knowledge summaries implemented.
- [ ] Local-model prompt boundaries preserved.
- [ ] CP12 tests implemented.
- [ ] Existing CP1 through CP11 checks pass.
- [ ] `checkpoint/cp12-reports-knowledge` tag created.

## Verification

Opening verification:

- pending
