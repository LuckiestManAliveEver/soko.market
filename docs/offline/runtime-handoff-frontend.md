# Runtime handoff in the business header

The business settings header exposes `Go offline`, `Edit`, and `Sign out`, in that order.
The subtitle reports Hosted, Preparing offline, or Offline · This device. The main application
notice also reports local execution, and the existing chat composer routes local agent turns
through the saved handoff without creating another conversation.

## Current availability

The frontend controller and backend RuntimeHandoff protocol are connected, but **this build
does not ship a compatible LocalHandoffHost implementation**. The header is visible and disabled
with an explanation until one is registered. `VITE_OFFLINE_RUNTIME_ENABLED=true` and Web Locks
support are also required. Installing business data or the standalone pinned WebLLM assistant
does not make an arbitrary hosted agent portable. No model substitution is performed.

The backend protocol was brought forward from the existing runtime-handoff protocol work, with
the migration 083 index correction. Deployment requires applying migration 083 with the usual
database migration workflow. No deployed database is changed by the frontend build.
Retry results are authorized before cache lookup and idempotency keys are scoped to the account
and task, preventing a key reused by another conversation from exposing a cached checkpoint.

## Host integration contract

Trusted application code registers an executable host using `registerLocalHandoffHost` in
`apps/web/src/runtime-handoff.ts`. The host's `executionHostId` must already be an authorized,
compatible host in the native runtime graph. A removable drive is storage, not an execution host.

`LocalHandoffHost` in `runtime-handoff-controller.ts` requires:

- `supports`: verify the exact current agent/model and complete harness can execute locally,
  including permissions, durable context, and conversation/event export and import.
- `prepare`: transfer and verify the harness, model artifacts and authorized protected context;
  confirm the checkpoint can resume with local business data. Protected context stays under
  the host's protection and authorization rules, never in the handoff row. Downloading model
  weights alone is insufficient. Missing context must fail preparation.
- `resume`: restore the checkpoint in the local executable and acknowledge its exact ID,
  agent and model, with all required resources ready. This also runs before local turns after
  a page reload. It must require no network when resuming offline.
- `turn`: run the same agent, use the supplied local tool dispatcher, persist harness state,
  and return a reply plus a new immutable RuntimeHandoff whose parent is the previous handoff.
  Agent permissions and tool confirmation policy must still be enforced by the harness.
- `syncMessages`: idempotently import the pending messages with their existing IDs into the
  same authorized backend conversation, preserving user/assistant roles, and acknowledge only
  durably stored IDs. Assistant replies must not be re-executed as prompts. This is a required
  host capability; the current standalone WebLLM adapter has no such implementation.

The controller stores checkpoints and text conversation events separately in the existing
account/store/device local database. Local replies use the main chat UI. Attachments and human
or external-channel delivery currently return an explicit online requirement and retain the
draft. Catalogue/customer/invoice tools use the existing LocalProvider; unsupported tools fail
with OPERATION_UNAVAILABLE and never fall through to a cloud provider.

## Transition and recovery

Going offline resolves the current handoff, checkpoints it, prepares the business snapshot and
application shell, and awaits the local host's preparation receipt. Only then does it request a
host swap through `/v1/runtime/:conversationId/swaps/host`. The frontend changes its routing grant
only after the destination acknowledges the resulting checkpoint. Agent and model IDs remain
unchanged. There is no online-runtime termination call.

The saved `prepared` session allows Go online to recover a host swap whose response was lost.
Partial preparation leaves online routing intact. Web Locks coordinate handoffs and chat turns
across tabs. Availability is checked again on activation, and account scope is rechecked after
preparation. The same account's other offline shop must return online first.

Returning online synchronizes business operations, checks unresolved conflicts, acknowledges
conversation events, and syncs offline checkpoints through the existing causal checkpoint API.
It then creates a hosted swap/checkpoint and calls resume. A stale task head or an unconfirmed
resume retains local state and displays an error. The protocol's existing merge API resolves
divergent execution checkpoints; automatic task-state conflict resolution and a visual handoff
merge editor are not implemented. Business conflicts remain reviewable in offline settings.

The server's resume response represents the protocol runtime instance state, not an independent
inference-process health probe. A production host integration must provide actual executable
readiness as part of its runtime implementation; a registry record alone is insufficient.

After a successful return, local checkpoints and the transcript are retained. The controller does
not delete local state. Legacy data-only sessions are labelled accordingly and can be synced in
offline settings. Storage preparation no longer activates an unrelated runtime.

## Verification

`tests/runtime-handoff-frontend.test.ts` exercises the controller with a local executable test
adapter and a real IndexedDB-backed LocalProvider. It covers identity, preparation receipts,
main-conversation continuity, local catalogue lookup, network-tool failure, conflicts, partial
event acknowledgement, activation failure, account changes, and hosted resume failure.
The protocol's domain, REST/MCP and migration suites cover the server boundary. This is not a
live offline inference certification for a shipping host; no such host is registered yet.
