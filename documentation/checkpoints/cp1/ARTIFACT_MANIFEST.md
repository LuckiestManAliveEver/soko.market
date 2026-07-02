# CP1 Artifact Manifest

Status: active
Date opened: 2026-07-02

## Created CP1 Artifacts

| Path | Purpose |
|---|---|
| `documentation/checkpoints/cp1/CP1_BASELINE.md` | Formal CP1 baseline, scope, exit criteria, and rollback instructions. |
| `documentation/checkpoints/cp1/DECISION_LOG.md` | Engineering foundation decisions needed to start CP1. |
| `documentation/checkpoints/cp1/ARTIFACT_MANIFEST.md` | This manifest. |

## CP1 Opening Checklist

- [x] CP0 accepted as passed.
- [x] Stale CP0 status headers corrected.
- [x] CP1 marked `active` in checkpoint log.
- [x] CP1 baseline created.
- [x] CP1 decision log created.
- [x] CP0 decisions required before CP1 resolved or explicitly deferred.

## CP1 Completion Checklist

- [ ] Monorepo directories created.
- [ ] Workspace package manager configured.
- [ ] Local development stack documented.
- [ ] PostgreSQL and Redis local services configured.
- [ ] API health check implemented.
- [ ] Formatting command configured.
- [ ] Lint command configured.
- [ ] Type check command configured.
- [ ] Unit test command configured.
- [ ] CI skeleton created.
- [ ] Initial migration structure created.
- [ ] Environment variable conventions documented.
- [ ] Business runtime packages remain independent from AI runtime implementation.
- [ ] `checkpoint/cp1-engineering-foundation` tag created.
