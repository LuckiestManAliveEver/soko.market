# CP15 Artifact Manifest

Status: active
Date opened: 2026-07-05
Date passed: pending

## Created CP15 Artifacts

| Path                                                  | Purpose                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `documentation/checkpoints/cp15/CP15_BASELINE.md`     | Formal CP15 baseline, scope, exit criteria, and rollback rules.         |
| `documentation/checkpoints/cp15/DECISION_LOG.md`      | Beta gating, telemetry, sync, payment, support, and rollback decisions. |
| `documentation/checkpoints/cp15/ARTIFACT_MANIFEST.md` | This manifest.                                                          |
| `documentation/CP15_BETA_RELEASE_HARDENING.md`        | Planned implementation documentation for CP15 beta readiness workflows. |

## CP15 Opening Checklist

- [x] CP14 accepted as passed.
- [x] CP14 checkpoint tag exists locally and on GitHub.
- [x] CP14 commits are pushed to `origin/main`.
- [x] CP15 marked `active` in checkpoint log.
- [x] CP15 baseline created.
- [x] CP15 decision log created.
- [x] CP15 scope excludes public launch, marketplace foundation, full TIEL, broad provider certification, and autonomous background agents.

## CP15 Completion Checklist

- [ ] Closed beta onboarding gate implemented.
- [ ] Beta feature flags and release gates implemented.
- [ ] Low-end Android usability targets tested or simulated.
- [ ] Offline beta-critical workflows hardened.
- [ ] Sync stress testing implemented.
- [ ] Payment testing and reconciliation checks implemented.
- [ ] UX refinements for beta-critical workflows implemented.
- [ ] Support process and rollback communication rules documented.
- [ ] Crash and error telemetry contracts implemented.
- [ ] Beta readiness summary documented and surfaced.
- [ ] CP15 tests implemented.
- [ ] Existing CP1 through CP14 checks pass.
- [ ] `checkpoint/cp15-closed-beta` tag created.

## Verification

Opening verification:

- [x] `pnpm run ci`

Passed verification:

- pending
