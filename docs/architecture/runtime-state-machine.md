# Runtime state machine

Two distinct, already-real state machines exist in the durable execution plane. This document
gives each its actual states and transitions, as implemented (not aspirational) - see
[`durable-execution-plane.md`](durable-execution-plane.md) for the surrounding architecture.

## 1. `RuntimeTaskInstance.status` (per-task executor lifecycle)

`RuntimeTaskInstanceStatus` (`packages/shared-types/src/runtime-handoff.ts`):

```
STARTING
   |
   v
READY  <---------------------------.
   |                                |
   v                                |
RUNNING                             |
   |                                |
   +--> DEGRADED --> RUNNING -------+
   |                                |
   +--> FAILED ---------------------+   (a rebind - performSwap/completeTransfer/resume -
   |                                     always mints a fresh instance at READY or RUNNING,
   v                                     regardless of the prior instance's terminal status)
STOPPED (cancelExecution) ----------+
```

| Transition                | Trigger                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (none) → `READY`          | `performSwap` / `completeTransfer` commit (`setTaskInstanceHandoff`, status `"READY"`)                                                                                                                                                                                                                                                     |
| (none) → `RUNNING`        | `resume` (`setTaskInstanceHandoff`, status `"RUNNING"`)                                                                                                                                                                                                                                                                                    |
| any → `STOPPED`           | `cancelExecution` (idempotent - already-`STOPPED` is a no-op)                                                                                                                                                                                                                                                                              |
| any → `READY` / `RUNNING` | Any subsequent rebind - always mints a **new** `executionId`/`fenceToken`, so this is never a same-execution self-transition                                                                                                                                                                                                               |
| `DEGRADED` / `FAILED`     | Not currently set by any code path in this checkout (reserved for a future health-monitoring integration - the type exists, `resolveHandoff().isRuntimeStale` is the closest current drift signal, computed by comparing `RuntimeTaskInstance.activeHandoffId` against `RuntimeTaskHead.activeHandoffId`, not by transitioning this field) |

**Every transition mints a new `fenceToken`/`executionId`** (see
`durable-execution-plane.md` §9) - this status machine and the fencing mechanism are the same
mutation, not two separate updates that could drift out of sync.

Runtime health is independent of task state: a valid, advancing task head can coexist with a
`FAILED`/`STOPPED` instance (`runtime-handoff-protocol.md`'s own framing, unchanged).

## 2. `RuntimeTransfer.status` (RuntimeHandoff / transfer-of-authority lifecycle)

`RuntimeTransferStatus` (`packages/shared-types/src/runtime-handoff.ts`), enforced in code by
`RuntimeHandoffDomain.transitionTransfer`:

```
PENDING
   |
   v
CHECKPOINTING
   |
   v
CHECKPOINTED
   |
   v
TARGET_ACTIVATING
   |
   v
RESTORING
   |
   v
VERIFYING
   |
   v
COMPLETED

Any nonterminal state (PENDING..VERIFYING) -> FAILED
```

Only the exact next state in this fixed sequence is a valid transition (`transitionTransfer` throws
`HANDOFF_CONFLICT` on anything else); `FAILED` is reachable from any nonterminal state exactly once.
`COMPLETED` and `FAILED` are both terminal - no transition leaves either.

| State               | Meaning                                                                | Durable event (§7 of durable-execution-plane.md)              |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| `PENDING`           | Transfer created, ownership/host validated                             | `HANDOFF_STARTED`                                             |
| `CHECKPOINTING`     | Creating the unpromoted target-bound checkpoint                        | (transitional, no distinct durable event)                     |
| `CHECKPOINTED`      | Checkpoint created; source still canonical                             | `CHECKPOINT_CREATED`                                          |
| `TARGET_ACTIVATING` | Target host being validated/prepared                                   | `BINDING_RESOLUTION_STARTED`                                  |
| `RESTORING`         | Target restoring the exact checkpoint                                  | `EXECUTION_SUSPENDED` (source quiesces while target restores) |
| `VERIFYING`         | Server readiness probes / receipt validation                           | `BINDING_RESOLVED`                                            |
| `COMPLETED`         | Binding, head, and instance committed together; source routing changes | `HANDOFF_COMPLETED` + `RUNTIME_REBOUND`                       |
| `FAILED`            | Any failure; source remains (or reverts to being) canonical            | `HANDOFF_FAILED`                                              |

Terminal-state idempotency: `completeTransfer`/`failTransfer` called again on an already-terminal
transfer returns the existing record rather than re-transitioning (`if (op.status === "COMPLETED" ||
op.status === "FAILED") return op;`).

## 3. Execution fencing state (not a status field - a monotonic counter)

Fencing (`durable-execution-plane.md` §9) is not itself a state machine with named states; it is a
strictly increasing integer (`RuntimeTaskInstance.fenceToken`) that advances by exactly 1 on every
`RuntimeTaskInstance` transition in §1 above. The only two "states" that matter for a commit
attempt:

```
fenceToken presented == task's current fenceToken   -> commit accepted
fenceToken presented != task's current fenceToken   -> commit rejected (STALE_EXECUTION_FENCE),
                                                          EXECUTION_FENCE_REJECTED event recorded
```

## 4. Checkpoint chain (not a state machine - an immutable, append-only DAG)

Checkpoints (`RuntimeHandoff` rows) never transition; a "state change" is always a _new_ row with
`parentHandoffId` pointing at the previous one (or, for a merge, `mergedFromHandoffIds` for
additional ancestors). The only thing that changes over a task's lifetime is which checkpoint
`RuntimeTaskHead.activeHandoffId` currently points at - `rollback` moves this pointer backward in
the chain without erasing or mutating anything; `createCheckpoint`/`performSwap`/`completeTransfer`
move it forward.
