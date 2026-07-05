# CP16 Public Launch

CP16 implements controlled public launch readiness on top of the CP15 closed beta foundation.

## Implemented Surfaces

- Public launch settings with reversible `closed`, `open`, and `paused` states.
- Explicit public onboarding enablement, allowed signup count, launch freeze state, and rollback arming.
- Production readiness checklist for environment config, secrets, backup, monitoring, deploy verification, rollback runbook, and support coverage.
- Launch incident intake with severity, category, status, bounded summaries, and audited lifecycle transitions.
- Launch readiness report that combines CP15 beta status, launch settings, checklist, first-run workflow, support incidents, launch-safe telemetry, sync health, payment reconciliation, and rollback state.
- Public launch notification, business report, knowledge fact, runtime context, and owner UI surface.

## Readiness Rules

Public launch is `ready` only when:

- CP15 beta readiness is `ready`.
- Public onboarding is open, enabled, not frozen, and has a positive allowed signup count.
- Every production checklist item has passed.
- First-run launch proof exists through products, customers, invoices, and payments.
- No critical unresolved launch incident exists, beta support tickets are closed, and support coverage has passed.
- Launch-safe session telemetry exists and the crash-free session rate is at least 95%.
- Sync has no active, failed, or conflict items.
- Payment reconciliation has no mismatch.
- Rollback is armed.

## Safety Boundaries

- Public onboarding state changes are audited as high or critical risk events.
- Incident audit events store severity, status, category, title length, and body-summary length instead of raw incident body text.
- Runtime and model prompts receive bounded launch status, readiness status, and open incident counts only.
- Rollback pauses public onboarding without deleting businesses or mutating prior commerce truth.
- CP17 marketplace work, full TIEL, autonomous background agents, and broad trust-network rollout remain out of scope.

## Rollback

To roll back CP16 behavior, set launch settings to:

```json
{
  "status": "paused",
  "publicOnboardingEnabled": false,
  "rollbackArmed": true,
  "freezeActive": true,
  "allowedSignupCount": 0,
  "pauseReason": "Public launch paused for rollback."
}
```

This preserves CP15 closed beta readiness, existing merchant data, audit events, payment truth, sync queue state, reports, and runtime confirmation gates.
