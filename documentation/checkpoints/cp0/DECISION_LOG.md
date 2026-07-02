# CP0 Decision Log

Status: passed
Date opened: 2026-07-01
Date passed: 2026-07-01

This file records planning decisions accepted at CP0. Future changes should append new decisions rather than rewriting history.

## Accepted Decisions

| ID | Decision | Rationale | Impact |
|---|---|---|---|
| CP0-D01 | The Master Control Document is the highest authority. | It explicitly supersedes conflicting content in Docs 1 to 3. | All roadmap conflicts are resolved through the control document first. |
| CP0-D02 | `documentation/README.md` is the clean entry point for humans. | The source folder contains PDFs, DOCX duplicates, screenshots, and one broken placeholder. | Readers can start from one harmonized file. |
| CP0-D03 | The broken `Soko doc 4 June .pdf` is excluded from authority. | It contains only `Soko.markeyl`. | The real Document 4 is `Soko doc 4 June  (1).pdf`. |
| CP0-D04 | MVP starts with a rule-based parser, not full local LLM. | The Master Control Document requires AI entry in Sprint 1 as a thin command parser. | Product proves chat-first behavior before adopting heavier model infrastructure. |
| CP0-D05 | Pi/OpenClaw-style harness is treated as an adapter candidate for Sokoclaw, not as the whole app. | Agent harnesses are useful for orchestration but should not own business truth. | Keeps business logic deterministic and auditable. |
| CP0-D06 | llama.cpp is treated as a model provider, not as a runtime owner. | llama.cpp is suitable for local inference, but business state must remain outside it. | Keeps local model implementation replaceable. |
| CP0-D07 | General host tools must not be exposed to merchant-facing agents. | Shell/filesystem/browser tools are too risky for payments, stock, invoices, and customer data. | Only Soko-owned tools are exposed to business workflows. |
| CP0-D08 | UI follows the PNG operational style while preserving chat-first navigation. | The PNGs match M-Pesa familiarity and low-end Android usability. | Support screens use cards, large tap targets, and green confirmation actions. |
| CP0-D09 | Marketplace is post-launch, not MVP. | The Master Control Document defers marketplace until adoption and sync stability triggers are met. | MVP avoids premature platform complexity. |
| CP0-D10 | TIEL is planned after core commerce stability. | Cryptographic identity is valuable but too heavy for initial commerce proof. | MVP can proceed with standard auth and trust-level placeholders. |
| CP0-D11 | Rollback points are feature and checkpoint based. | Database rollback is dangerous for payments, invoices, tax, and inventory. | Prefer feature flags and prior deployment artifacts before destructive rollback. |

## Open Decisions

| ID | Decision Needed | Options | Required Before |
|---|---|---|---|
| CP0-O01 | Monorepo tooling | pnpm workspace, npm workspace, Turborepo, Nx | CP1 |
| CP0-O02 | Frontend framework | React, Preact, Solid | CP1 |
| CP0-O03 | Local database wrapper | raw IndexedDB, Dexie, SQLite through native shell later | CP3/CP7 |
| CP0-O04 | API runtime | Node/Fastify, NestJS, Hono, another stack | CP1 |
| CP0-O05 | Database migration tool | Prisma, Drizzle, Knex, node-pg-migrate, SQL files | CP1 |
| CP0-O06 | Pi/OpenClaw integration timing | defer, sidecar, embedded adapter | CP10 |
| CP0-O07 | llama.cpp first path | defer, server adapter, native wrapper | CP11 |
| CP0-O08 | First launch country tax profile | Kenya only, Kenya plus regional placeholders | CP6/CP14 |
| CP0-O09 | SMS provider | provider to be selected | CP16 |
| CP0-O10 | M-Pesa provider path | direct Daraja, payment aggregator, staged manual-first | CP8 |
| CP0-O11 | Git repository setup | initialize here, move docs to another repo, repair current `.git` | CP1 |

## CP1 Transition Notes

On 2026-07-02, CP1 was formally opened. Decisions required before CP1 are resolved in `documentation/checkpoints/cp1/DECISION_LOG.md`.

## Decision Change Procedure

To change a CP0 decision:

1. Add a new decision row.
2. Reference the decision being superseded.
3. Explain the technical or product reason.
4. Update `documentation/README.md` if the roadmap changes.
5. Update checkpoint rollback instructions if risk changes.
