# CP10 Artifact Manifest

Status: active
Date opened: 2026-07-03
Date passed: pending

## Created CP10 Artifacts

| Path                                                  | Purpose                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `documentation/checkpoints/cp10/CP10_BASELINE.md`     | Formal CP10 baseline, scope, exit criteria, and rollback rules.         |
| `documentation/checkpoints/cp10/DECISION_LOG.md`      | Runtime adapter, verification, telemetry, and model-boundary decisions. |
| `documentation/checkpoints/cp10/ARTIFACT_MANIFEST.md` | This manifest.                                                          |

## Planned CP10 Implementation Artifacts

| Path                                    | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `packages/shared-types/src/index.ts`    | Shared runtime session, turn, plan, verification, and telemetry types.  |
| `packages/tool-core/src/index.ts`       | Runtime tool registry, tool risk metadata, and executor adapter helpers. |
| `services/ai-runtime/src/app.ts`        | Sokoclaw Runtime API endpoints for sessions, turns, and health.         |
| `services/api/src/cp2/store.ts`         | Business-scoped runtime persistence if API-owned storage remains local.  |
| `services/api/src/cp2/routes.ts`        | Runtime bridge routes if web/API integration needs authenticated proxying. |
| `apps/web/src/cp3-shell.ts`             | Runtime chat shell metadata while preserving CP3 shell contracts.        |
| `apps/web/src/main.tsx`                 | Owner-facing runtime chat/confirmation flow if UI scope is included.    |
| `tests/business-core.test.ts`           | Runtime risk and business validator boundary tests if core rules expand. |
| `tests/cp3-shell.test.ts`               | Shell contract tests if runtime chat navigation changes.                |
| `tests/cp10-sokoclaw-runtime.test.ts`   | Runtime API, planning, verification, confirmation, and telemetry tests. |
| `tests/ai-eval/cp10-runtime-commands.ts` | Runtime evaluation dataset and task-completion gate fixtures.           |

## CP10 Opening Checklist

- [x] CP9 accepted as passed.
- [x] CP9 checkpoint tag exists locally and on GitHub.
- [x] CP9 commits are pushed to `origin/main`.
- [x] CP10 marked `active` in checkpoint log.
- [x] CP10 baseline created.
- [x] CP10 decision log created.
- [x] CP10 scope excludes llama.cpp integration, production provider choice, autonomous writes, marketplace automation, and TIEL.

## CP10 Completion Checklist

- [ ] Runtime shared contracts implemented.
- [ ] Runtime API session and turn endpoints implemented.
- [ ] Conversation manager implemented.
- [ ] Context builder implemented.
- [ ] Intent router implemented while preserving CP4 fallback.
- [ ] Planner emits draft actions, clarifications, or safe read actions.
- [ ] Tool executor adapter routes through deterministic validators.
- [ ] Verification engine enforces role, risk, input, and confirmation gates.
- [ ] High and critical risk tool confirmation tests pass.
- [ ] Runtime telemetry records state transitions without sensitive plaintext.
- [ ] Agent action rate limits implemented.
- [ ] AI evaluation dataset expanded for CP10.
- [ ] Owner runtime chat/confirmation UI implemented if included in final CP10 scope.
- [ ] Existing CP1 through CP9 checks pass.
- [ ] `checkpoint/cp10-sokoclaw-runtime` tag created.

## Verification

Opening verification:

- pending
