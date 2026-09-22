# Computer runtime runbook

Operational guide for `ComputerRuntime` (docs/architecture/computer-runtime.md). Read
docs/architecture/computer-runtime-security.md before changing anything here.

## Local development

1. `pnpm install` at the repo root (pulls `playwright` for `services/computer-worker`).
2. Start the worker: `pnpm --filter @soko/computer-worker dev` (listens on `:8091` by default).
   In this repository's sandboxed dev environments without a full Playwright browser download,
   set `PLAYWRIGHT_CHROMIUM_PATH` to a pre-installed Chromium binary; otherwise Playwright resolves
   its own bundled browser normally.
3. Start the API with `COMPUTER_WORKER_URL=http://127.0.0.1:8091` (this is also the code default
   when the env var is unset, so local dev normally needs no explicit setting).
4. `pnpm dev:api` / `pnpm dev:web` as usual. Open a chat, ask the agent to open a session
   (`computer.session.create`), and the live-view card should appear.

## Health checks

- Worker: `GET http://<worker-host>:8091/health` → `{ "status": "ok" }`. Render's blueprint uses
  this same path for the `pserv`'s container health check.
- From the API side, a worker outage surfaces as `503 COMPUTER_WORKER_UNAVAILABLE` (circuit open)
  or `503 COMPUTER_WORKER_OVERLOADED` (bulkhead queue full) on any `computer.*` capability call -
  check `computer_provider_errors_total` and the circuit-breaker metrics
  (`circuit_breaker_state{name="computer_worker"}`) first.

## Common failures

| Symptom                                                                                     | Likely cause                                                                                                  | Fix                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPUTER_WORKER_UNAVAILABLE` persists                                                      | Worker container crashed/OOMed                                                                                | Check the worker's Render logs; headless Chromium with several concurrent sessions is memory-hungry - size up the plan if this recurs, mirroring the OCR worker's own sizing note in `render.yaml`. |
| Every navigate/session-create fails with `COMPUTER_NAVIGATION_BLOCKED`                      | Target URL matches the private-network/SSRF blocklist, or an allow-list is configured and the URL isn't on it | Expected behavior for internal/private addresses. For a legitimate external domain being blocked, check `Cp2StoreOptions.computerNavigationPolicy`.                                                 |
| `COMPUTER_ACTION_BLOCKED` on an ordinary-looking field                                      | `classifyComputerAction` matched a credential-shaped field name/label                                         | Expected - this capability never types into password/OTP/card-number fields. Confirm the field truly isn't a credential field before treating this as a bug.                                        |
| Approval never resolves / UI stuck on "Waiting for your approval"                           | Approval expired (`approvalTtlMs`, default 10 min) before the user acted                                      | Propose the action again; the frontend does not currently auto-detect expiry, so a manual "check the card again" may be needed until observed.                                                      |
| `computer.click`/`type` keeps returning `REJECTED` with "Control changed to the human user" | A human took control mid-action (working as intended) or the frontend/agent raced a stale controlMode read    | Expected under a genuine takeover race; if it recurs without a takeover, check the session's audit trail for `computer.control_taken` immediately preceding.                                        |
| Live view screenshot is blank/gray                                                          | `page.screenshot()` timed out (`captureScreenshot` swallows the error and returns `null`)                     | Check worker logs for the underlying Playwright error; usually a slow-loading page past the 5s screenshot timeout.                                                                                  |
| A session never appears in chat after `computer.session.create` succeeds                    | `createConversationMessage` failed silently, or the frontend registry entry is stale                          | Confirm `apps/web/src/generated-surface-registry.tsx` has the `computer-session` entry and the built bundle includes `ComputerSessionCard`.                                                         |

## Metrics

`computer_sessions_created_total`, `computer_sessions_active`, `computer_actions_total{tool_name,outcome}`,
`computer_actions_failed_total{tool_name,outcome}`, `computer_approvals_requested_total`,
`computer_approvals_approved_total`, `computer_approvals_rejected_total`,
`computer_human_takeovers_total`, `computer_runtime_handoffs_total`, `computer_provider_errors_total`
(`packages/observability/src/index.ts`). Exposed on the main API's `GET /metrics` alongside every
other Soko metric; requires `x-metrics-token` per `services/api`'s existing metrics auth.

## Rotating the worker

The worker is stateless from `services/api`'s point of view except for in-flight sessions: a
restart drops any session whose `BrowserManager` context is in memory. `checkpoint`/`suspend`
before a planned restart preserves state (the encrypted profile/checkpoint lives in Postgres, not
in the worker); an unplanned crash loses only sessions that had no recent checkpoint, matching the
existing "uncertain outcome -> `OUTCOME_UNKNOWN`, never silently retried" behavior for any
in-flight consequential action at the moment of the crash.

## Incident: suspected credential exposure

1. Rotate `AUTH_TOKEN_ENCRYPTION_KEY`/`OAUTH_TOKEN_ENCRYPTION_KEY` immediately (this invalidates
   every encrypted `ComputerProfile.encryptedState` and every OAuth token - users must reconnect).
2. Audit `computer.profile_saved`/`computer.profile_disconnected` events for the affected account
   via the existing audit-event query surface.
3. Confirm no observation text reached a log line: `sanitizeObservationText` runs before any
   persistence, but a bug bypassing it would show up as raw page text in worker/API logs - grep for
   it explicitly, don't assume redaction always ran.
