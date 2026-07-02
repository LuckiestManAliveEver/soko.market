# CP4 Artifact Manifest

Status: active
Date opened: 2026-07-02
Date passed: pending

## Created CP4 Artifacts

| Path                                                 | Purpose                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `documentation/checkpoints/cp4/CP4_BASELINE.md`      | Formal CP4 baseline, scope, exit criteria, and rollback instructions. |
| `documentation/checkpoints/cp4/DECISION_LOG.md`      | Rule parser, confidence, clarification, and boundary decisions.       |
| `documentation/checkpoints/cp4/ARTIFACT_MANIFEST.md` | This manifest.                                                        |

## Planned CP4 Implementation Artifacts

| Path                             | Purpose                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `packages/tool-core/src/*`       | Parser contracts or safe tool-intent types if shared.                 |
| `apps/web/src/*cp4*`             | Rule parser integration behind the CP3 chat shell.                    |
| `tests/ai-eval/*`                | Internal command dataset for parser evaluation.                       |
| `tests/*cp4*.test.ts`            | Parser, confidence, clarification, and non-mutation tests.            |
| `scripts/*` or package utilities | Optional parser evaluation script if plain unit tests are not enough. |

## CP4 Opening Checklist

- [x] CP3 accepted as passed.
- [x] CP3 checkpoint tag exists locally.
- [x] CP3 commit is pushed to `origin/main`.
- [x] CP4 marked `active` in checkpoint log.
- [x] CP4 baseline created.
- [x] CP4 decision log created.
- [x] CP4 scope excludes model integration, full runtime, business CRUD, payments, marketplace, and TIEL.

## CP4 Completion Checklist

- [ ] Rule-based parser implemented.
- [ ] Intent taxonomy implemented.
- [ ] Confidence scoring implemented.
- [ ] Slot extraction implemented.
- [ ] Clarification behavior implemented.
- [ ] Structured fallback behavior implemented.
- [ ] Chat shell integration implemented.
- [ ] Safe command completion implemented.
- [ ] State-changing intents remain drafts only.
- [ ] AI evaluation dataset contains at least 50 commands.
- [ ] Parser tests meet acceptance threshold.
- [ ] Existing CP1, CP2, and CP3 checks pass.
- [ ] `checkpoint/cp4-rule-parser` tag created.

## Verification

- `pnpm run ci`
- `pnpm build`
- parser evaluation threshold check
