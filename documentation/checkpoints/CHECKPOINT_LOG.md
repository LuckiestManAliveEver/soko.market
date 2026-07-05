# Soko.market Checkpoint Log

This log tracks formal planning and implementation checkpoints. Each checkpoint should become a Git tag once the repository is initialized and Git is operational.

## Status Legend

- `planned`: defined but not started.
- `active`: currently being worked.
- `passed`: exit criteria met and checkpoint captured.
- `blocked`: checkpoint cannot be completed until a listed blocker is resolved.
- `rolled-back`: checkpoint was reverted to a prior stable state.

## Checkpoints

| Checkpoint | Name                                        |  Status | Date Opened | Date Passed | Git Tag                                  | Notes                                                                                                                                                  |
| ---------- | ------------------------------------------- | ------: | ----------: | ----------: | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CP0        | Planning Baseline                           |  passed |  2026-07-01 |  2026-07-01 | `checkpoint/cp0-planning-baseline`       | Formal CP0 packet created. Tag stored in alternate Git directory `.repo.git` because `.git` is a read-only environment mount.                          |
| CP1        | Repository and Engineering Foundation       |  passed |  2026-07-02 |  2026-07-02 | `checkpoint/cp1-engineering-foundation`  | Monorepo foundation, local stack, health check, CI, migration baseline, and runtime boundaries implemented.                                            |
| CP2        | Account, Auth, and Business Creation        |  passed |  2026-07-02 |  2026-07-02 | `checkpoint/cp2-auth-business`           | Passwordless OTP, sessions, first business creation, language preference, owner membership, role checks, and audit events implemented.                 |
| CP3        | Mobile Shell and Chat Shell                 |  passed |  2026-07-02 |  2026-07-02 | `checkpoint/cp3-mobile-chat-shell`       | Installable mobile shell, chat shell, quick actions, offline/sync placeholders, and commerce empty states implemented.                                 |
| CP4        | Rule-Based AI Entry Point                   |  passed |  2026-07-02 |  2026-07-02 | `checkpoint/cp4-rule-parser`             | Deterministic parser, intent taxonomy, confidence scoring, clarification, chat integration, and eval dataset implemented.                              |
| CP5        | Business Core Records                       |  passed |  2026-07-02 |  2026-07-02 | `checkpoint/cp5-business-core-records`   | Product, customer, supplier, inventory quantity, stock movement events, validation, role checks, and owner web workflows implemented.                  |
| CP6        | Invoice and Inventory Flow                  |  passed |  2026-07-03 |  2026-07-03 | `checkpoint/cp6-invoice-inventory`       | Invoice drafts, previews, confirmation, invoice items, deterministic totals, sale stock movements, print view, and tests implemented.                  |
| CP7        | Offline Local Data and Sync Queue           |  passed |  2026-07-03 |  2026-07-03 | `checkpoint/cp7-offline-sync`            | Offline cache snapshot, mutation queue, idempotent replay, conflict surfacing, sync UI, schema, and tests implemented.                                 |
| CP8        | Payments and Debt Tracking                  |  passed |  2026-07-03 |  2026-07-03 | `checkpoint/cp8-payments-debt`           | Payment records, invoice settlement balances, customer debt summaries, payment UI, CP7 replay support, schema, and tests implemented.                  |
| CP9        | Document Import                             |  passed |  2026-07-03 |  2026-07-03 | `checkpoint/cp9-document-import`         | Supplier CSV import, preview, row correction, confirmation through CP5 validators, source metadata, import events, schema, and tests implemented.      |
| CP10       | Sokoclaw Runtime Full Adapter               |  passed |  2026-07-03 |  2026-07-03 | `checkpoint/cp10-sokoclaw-runtime`       | Runtime sessions, turns, planning, confirmation gates, deterministic tool execution, telemetry, rate limits, web chat, and eval tests implemented.     |
| CP11       | llama.cpp Local Model Adapter               |  passed |  2026-07-04 |  2026-07-04 | `checkpoint/cp11-local-model-adapter`    | Local llama.cpp-compatible adapter, bounded model output parsing, deterministic fallback, telemetry, docs, and tests implemented.                      |
| CP12       | Reports, Notifications, and Knowledge Layer |  passed |  2026-07-04 |  2026-07-04 | `checkpoint/cp12-reports-knowledge`      | Deterministic reports, in-app notifications, bounded knowledge summaries, API, owner UI, runtime context, docs, and tests implemented.                 |
| CP13       | Logistics                                   |  passed |  2026-07-04 |  2026-07-04 | `checkpoint/cp13-logistics`              | Deterministic in-app logistics records, lifecycle validation, API, owner UI, sync replay, bounded runtime/report context, docs, and tests implemented. |
| CP14       | Security, Compliance, and TIEL Preparation  |  passed |  2026-07-05 |  2026-07-05 | `checkpoint/cp14-security-compliance`    | Data export, deletion scheduling, retention summaries, verification tiers, tax config, device trust placeholder, security review, UI, and tests.       |
| CP15       | Beta Release Hardening                      |  passed |  2026-07-05 |  2026-07-05 | `checkpoint/cp15-closed-beta`            | Closed beta gates, feature flags, device tests, support process, telemetry, readiness reports, UI, runtime context, and tests implemented.             |
| CP16       | Public Launch                               |  active |  2026-07-05 |     pending | `checkpoint/cp16-public-launch`          | Public launch readiness opened after CP15 closed beta hardening passed.                                                                                |
| CP17       | Marketplace Foundation                      | planned |     pending |     pending | `checkpoint/cp17-marketplace-foundation` | Post-launch trigger gated.                                                                                                                             |
| CP18       | Trusted Identity Execution Layer            | planned |     pending |     pending | `checkpoint/cp18-tiel`                   | Post-core-commerce hardening.                                                                                                                          |

## Git Directory Note

The workspace contains a read-only tmpfs mounted at `.git`, so a normal Git repository cannot be written there.

Current workaround:

- Git metadata is stored in `.repo.git`.
- Commands must use:

```bash
git --git-dir=.repo.git --work-tree=. status
```

If the project is moved to a normal checkout later, preserve the CP0 commit and tag.
