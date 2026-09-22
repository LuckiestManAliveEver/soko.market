# Computer Runtime

Computer use is a Soko runtime capability family, not a separate agent architecture.

```text
Soko Chat -> Agent Runtime -> Capability Router -> computer.* -> ComputerRuntime -> Provider
```

The permanent contract is `ComputerRuntime` in `packages/shared-types/src/computer-runtime.ts`. It exposes provider-neutral sessions, observations, actions, control mode, profiles, approvals, and action results. It does not expose Playwright, Stagehand, Browserbase, Browser Use, or CDP types.

`packages/tool-core/src/domains/computer.ts` registers:

- `computer.session.create`
- `computer.session.resume`
- `computer.navigate`
- `computer.observe`
- `computer.click`
- `computer.type`
- `computer.scroll`
- `computer.upload`
- `computer.control.take`
- `computer.control.release`
- `computer.checkpoint`
- `computer.suspend`
- `computer.close`

`packages/tool-core/src/computer-policy.ts` classifies actions as `READ`, `MUTATE`, or `CONSEQUENTIAL` and creates a stable hash over the exact proposed action. This hash is the approval binding primitive.

The capability dispatcher calls `ComputerRuntimeDomain`, which authorizes account/business scope,
evaluates policy, creates approvals, records audit events, and calls `ComputerWorkerClient`.
`HttpComputerWorkerClient` talks to the independently deployed `services/computer-runtime` worker
over a bearer-authenticated private endpoint.

## RuntimeHandoff

Computer state checkpoints through the existing immutable `RuntimeHandoff` protocol. Session id,
control mode, action hash, approval id, current URL, and observation reference live in action
metadata, context references, and artifacts. `RuntimeTaskHead` remains the only mutable active
checkpoint pointer. Migration 087 persists encrypted profiles, approvals, and audits without
creating a second task state machine.

## Provider Boundary

The initial provider uses Playwright Chromium. Provider types remain inside
`services/computer-runtime`; shared contracts and API domain code contain no Playwright types.
The chat card polls authenticated JPEG frames through the API proxy, so external sites are never
iframe embedded. Human input is accepted only in `HUMAN_CONTROLLED`; release captures a fresh
observation, persists encrypted profile state, checkpoints RuntimeHandoff, and restores agent input.
