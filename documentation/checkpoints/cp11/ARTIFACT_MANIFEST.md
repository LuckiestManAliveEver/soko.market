# CP11 Artifact Manifest

Status: active
Date opened: 2026-07-04
Date passed: pending

## Created CP11 Artifacts

| Path                                                  | Purpose                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `documentation/checkpoints/cp11/CP11_BASELINE.md`     | Formal CP11 baseline, scope, exit criteria, and rollback rules.          |
| `documentation/checkpoints/cp11/DECISION_LOG.md`      | Local model adapter, fallback, telemetry, and safety-boundary decisions. |
| `documentation/checkpoints/cp11/ARTIFACT_MANIFEST.md` | This manifest.                                                           |

## Planned CP11 Implementation Artifacts

| Path                                 | Purpose                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `services/ai-runtime/src/*`          | Local model provider interface and llama.cpp-compatible adapter.        |
| `services/api/src/cp2/*`             | Runtime integration with local model-backed planning and fallback.      |
| `packages/shared-types/src/index.ts` | Shared model adapter state, telemetry, and response contract types.     |
| `packages/tool-core/src/index.ts`    | Bounded model output parsing support for draft plans or clarifications. |
| `apps/web/src/*`                     | Runtime UI behavior for local-model-backed responses if needed.         |
| `tests/*cp11*`                       | Adapter success, fallback, timeout, malformed output, and safety tests. |
| `documentation/*`                    | Local development setup and configuration notes for llama.cpp adapter.  |

## CP11 Opening Checklist

- [x] CP10 accepted as passed.
- [x] CP10 checkpoint tag exists locally and on GitHub.
- [x] CP10 commits are pushed to `origin/main`.
- [x] CP11 marked `active` in checkpoint log.
- [x] CP11 baseline created.
- [x] CP11 decision log created.
- [x] CP11 scope excludes model download automation, quantization, production provider selection, autonomous writes, marketplace automation, and TIEL.

## CP11 Completion Checklist

- [ ] Local model provider interface implemented.
- [ ] llama.cpp-compatible local adapter implemented.
- [ ] Local adapter configuration documented.
- [ ] Prompt assembly uses least-necessary business-scoped context.
- [ ] Model output parsed into bounded runtime shapes.
- [ ] Adapter failures, timeouts, and malformed output fall back deterministically.
- [ ] Verification gates remain enforced for model-derived plans.
- [ ] High and critical risk confirmation tests still pass.
- [ ] Runtime telemetry records adapter state without sensitive plaintext.
- [ ] CP11 adapter tests implemented.
- [ ] Existing CP1 through CP10 checks pass.
- [ ] `checkpoint/cp11-local-model-adapter` tag created.

## Verification

Opening verification:

- pending
