# CP3 Artifact Manifest

Status: active
Date opened: 2026-07-02
Date passed: pending

## Created CP3 Artifacts

| Path                                                 | Purpose                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `documentation/checkpoints/cp3/CP3_BASELINE.md`      | Formal CP3 baseline, scope, exit criteria, and rollback instructions. |
| `documentation/checkpoints/cp3/DECISION_LOG.md`      | Mobile shell, chat shell, quick action, and placeholder decisions.    |
| `documentation/checkpoints/cp3/ARTIFACT_MANIFEST.md` | This manifest.                                                        |

## Planned CP3 Implementation Artifacts

| Path                                   | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `apps/web/public/manifest.webmanifest` | PWA install metadata.                                          |
| `apps/web/src/main.tsx`                | Authenticated mobile shell, home, chat, and placeholder views. |
| `apps/web/src/styles.css`              | Mobile-first shell styling.                                    |
| `apps/web/src/vite-env.d.ts`           | Web app environment typing if changed by CP3.                  |
| `tests/*cp3*.test.ts`                  | Focused CP3 shell behavior tests where practical.              |

## CP3 Opening Checklist

- [x] CP2 accepted as passed.
- [x] CP2 checkpoint tag exists locally.
- [x] CP2 commit is pushed to `origin/main`.
- [x] CP3 marked `active` in checkpoint log.
- [x] CP3 baseline created.
- [x] CP3 decision log created.
- [x] CP3 scope excludes parser execution, local model integration, business CRUD, payments, marketplace, and TIEL.

## CP3 Completion Checklist

- [ ] PWA manifest implemented.
- [ ] Authenticated mobile shell implemented.
- [ ] Home surface implemented.
- [ ] Chat shell implemented.
- [ ] Quick actions grid implemented.
- [ ] Offline status indicator implemented.
- [ ] Sync status placeholder implemented.
- [ ] Commerce empty states implemented.
- [ ] Small Android viewport layout checked.
- [ ] CP3 tests added or existing tests updated.
- [ ] Existing CP1 and CP2 checks pass.
- [ ] `checkpoint/cp3-mobile-chat-shell` tag created.

## Verification

- `pnpm run ci`
- `pnpm build`
- mobile viewport check for small Android dimensions
