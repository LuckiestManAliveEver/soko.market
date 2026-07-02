# CP1: Repository and Engineering Foundation

Status: active
Date opened: 2026-07-02
Target tag: `checkpoint/cp1-engineering-foundation`

## Purpose

CP1 establishes the engineering foundation for Soko.market before product feature work begins.

The goal is to create a stable, testable repository skeleton with clear runtime boundaries:

- mobile web application shell
- API service
- sync service
- AI runtime service boundary
- shared business, event, sync, tool, and UI packages
- local development services
- lint, type check, test, and CI conventions

## Formal Entry From CP0

CP0 is accepted as the planning baseline.

Accepted CP0 controls remain active:

- Master Control Document is the highest authority.
- MVP begins with a rule-based parser, not a full local LLM.
- AI infrastructure remains replaceable and cannot own business records.
- Business Runtime validates state-changing actions.
- Tool Executor is the only business mutation path.
- Event records are immutable.
- Marketplace and full TIEL remain outside MVP.

## CP1 Scope

In scope:

- monorepo workspace setup
- application and package skeletons
- local development stack definition
- health check route
- formatting, linting, type checking, and test runner setup
- CI skeleton
- environment variable conventions
- initial migration structure
- feature flag policy stub

Out of scope:

- account/auth implementation
- merchant business setup flow
- production payment integration
- invoice, stock, customer, supplier, or report feature logic
- full Sokoclaw runtime implementation
- llama.cpp integration
- marketplace or TIEL implementation

## Target Repository Shape

```text
apps/web
services/api
services/sync
services/ai-runtime
packages/business-core
packages/shared-types
packages/event-core
packages/sync-core
packages/tool-core
packages/ui
infra
tests
```

## CP1 Exit Criteria

CP1 can be marked passed when:

- Workspace package manager installs from a fresh clone.
- Expected monorepo directories exist.
- Local development stack is documented and can boot.
- PostgreSQL and Redis are available through local Docker Compose or an equivalent documented path.
- API health check endpoint works.
- Formatting, linting, type checking, and unit test commands exist.
- CI skeleton runs lint, type check, and tests.
- Initial migration structure exists as `000_initial` or equivalent.
- Environment variable conventions are documented.
- No business feature code depends on AI infrastructure.
- Checkpoint tag `checkpoint/cp1-engineering-foundation` is created.

## Rollback Instructions

Rollback target:

- Return to the CP1 skeleton and initial migration structure.
- Preserve CP0 planning documents and source artifacts.

Rollback trigger examples:

- foundation tooling cannot boot from a fresh clone
- application code depends directly on agent or model infrastructure
- local stack cannot provide repeatable PostgreSQL and Redis services
- CI cannot run deterministic baseline checks

## Next Checkpoint

Next checkpoint:

- CP2: Account, Auth, and Business Creation

CP2 should not start until CP1 exit criteria are passed and tagged.
