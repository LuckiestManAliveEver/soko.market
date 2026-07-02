# Soko.market Checkpoint Log

This log tracks formal planning and implementation checkpoints. Each checkpoint should become a Git tag once the repository is initialized and Git is operational.

## Status Legend

- `planned`: defined but not started.
- `active`: currently being worked.
- `passed`: exit criteria met and checkpoint captured.
- `blocked`: checkpoint cannot be completed until a listed blocker is resolved.
- `rolled-back`: checkpoint was reverted to a prior stable state.

## Checkpoints

| Checkpoint | Name                                        |  Status | Date Opened | Date Passed | Git Tag                                  | Notes                                                                                                                                          |
| ---------- | ------------------------------------------- | ------: | ----------: | ----------: | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| CP0        | Planning Baseline                           |  passed |  2026-07-01 |  2026-07-01 | `checkpoint/cp0-planning-baseline`       | Formal CP0 packet created. Tag stored in alternate Git directory `.repo.git` because `.git` is a read-only environment mount.                  |
| CP1        | Repository and Engineering Foundation       |  passed |  2026-07-02 |  2026-07-02 | `checkpoint/cp1-engineering-foundation`  | Monorepo foundation, local stack, health check, CI, migration baseline, and runtime boundaries implemented.                                    |
| CP2        | Account, Auth, and Business Creation        |  active |  2026-07-02 |     pending | `checkpoint/cp2-auth-business`           | Opened after CP1 passed and was pushed. Auth, account, business, role, language, and audit scope recorded in `documentation/checkpoints/cp2/`. |
| CP3        | Mobile Shell and Chat Shell                 | planned |     pending |     pending | `checkpoint/cp3-mobile-chat-shell`       | Starts after CP1 or in parallel with CP2 if team capacity allows.                                                                              |
| CP4        | Rule-Based AI Entry Point                   | planned |     pending |     pending | `checkpoint/cp4-rule-parser`             | Starts after CP3 shell exists.                                                                                                                 |
| CP5        | Business Core Records                       | planned |     pending |     pending | `checkpoint/cp5-business-core-records`   | Starts after CP2.                                                                                                                              |
| CP6        | Invoice and Inventory Flow                  | planned |     pending |     pending | `checkpoint/cp6-invoice-inventory`       | Starts after CP5.                                                                                                                              |
| CP7        | Offline Local Data and Sync Queue           | planned |     pending |     pending | `checkpoint/cp7-offline-sync`            | Starts after CP5/CP6 model is stable.                                                                                                          |
| CP8        | Payments and Debt Tracking                  | planned |     pending |     pending | `checkpoint/cp8-payments-debt`           | Starts after CP6.                                                                                                                              |
| CP9        | Document Import                             | planned |     pending |     pending | `checkpoint/cp9-document-import`         | Starts after CP5.                                                                                                                              |
| CP10       | Sokoclaw Runtime Full Adapter               | planned |     pending |     pending | `checkpoint/cp10-sokoclaw-runtime`       | Starts after CP4 and core tools exist.                                                                                                         |
| CP11       | llama.cpp Local Model Adapter               | planned |     pending |     pending | `checkpoint/cp11-local-model-adapter`    | Starts after CP10 adapter contract exists.                                                                                                     |
| CP12       | Reports, Notifications, and Knowledge Layer | planned |     pending |     pending | `checkpoint/cp12-reports-knowledge`      | Starts after event model is stable.                                                                                                            |
| CP13       | Logistics                                   | planned |     pending |     pending | `checkpoint/cp13-logistics`              | Starts after invoices and customers are stable.                                                                                                |
| CP14       | Security, Compliance, and TIEL Preparation  | planned |     pending |     pending | `checkpoint/cp14-security-compliance`    | Starts before broader beta.                                                                                                                    |
| CP15       | Beta Release Hardening                      | planned |     pending |     pending | `checkpoint/cp15-closed-beta`            | Starts after CP14.                                                                                                                             |
| CP16       | Public Launch                               | planned |     pending |     pending | `checkpoint/cp16-public-launch`          | Starts after beta criteria pass.                                                                                                               |
| CP17       | Marketplace Foundation                      | planned |     pending |     pending | `checkpoint/cp17-marketplace-foundation` | Post-launch trigger gated.                                                                                                                     |
| CP18       | Trusted Identity Execution Layer            | planned |     pending |     pending | `checkpoint/cp18-tiel`                   | Post-core-commerce hardening.                                                                                                                  |

## Git Directory Note

The workspace contains a read-only tmpfs mounted at `.git`, so a normal Git repository cannot be written there.

Current workaround:

- Git metadata is stored in `.repo.git`.
- Commands must use:

```bash
git --git-dir=.repo.git --work-tree=. status
```

If the project is moved to a normal checkout later, preserve the CP0 commit and tag.
