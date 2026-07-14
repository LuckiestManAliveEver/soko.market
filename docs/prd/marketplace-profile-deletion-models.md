# Marketplace onboarding, shop lifecycle, and AI model selection

## Product outcome

Soko.market opens in buyer Marketplace mode without forcing account creation. A visitor can browse
and chat immediately. Identity verification is delayed until the first attempt to register a shop:
the Sell button starts Firebase phone verification, owner PIN setup, and then shop details.
Returning owners authenticate with phone and PIN. OTP is reserved for first-shop registration and
explicit PIN recovery.

The first Marketplace card is an onboarding item directly after the welcome message. Completing it
removes it from the normal conversation timeline and adds a Marketplace shortcut beside Sell. The
completion marker is stored locally for anonymous continuity and in the API once a session exists.

Agent names in chat are interactive and open the owning shop/agent profile. AI model choices come
from the server registry. Activating a model is an authenticated, audited business setting and the
runtime enforces the stored selection rather than trusting an arbitrary model identifier from the
browser.

## Shop deletion state machine

`PENDING_VERIFICATION -> VERIFIED -> RUNNING -> QUARANTINED -> RESTORED | PURGED`

A deletion request requires owner membership, the exact global shop ID, acknowledgement, and the
owner PIN in a current authenticated session. It does not send another OTP. Quarantine immediately
hides the shop from account shop lists and blocks business endpoints. The owner can restore within
30 days. A daily idempotent purge job permanently removes tenant-owned data after the deadline.

Audit/retention records remain subject to the existing compliance retention rules. Purge failures
must leave the request retryable and visible to operations.

## Acceptance criteria

- A fresh visitor lands in Marketplace with no OTP prompt.
- Sell is the only normal path that starts first-shop Firebase phone verification.
- Phone and PIN unlock an existing owner account without OTP.
- The Marketplace intro renders once, is keyboard operable, and completion survives reload.
- The Marketplace header shortcut appears only after onboarding completion.
- Clicking an agent name opens the agent/shop profile when a shop exists.
- The model dropdown is populated by `GET /v1/ai-models`; unavailable models cannot activate.
- The runtime uses the business's stored active model.
- Shop deletion uses PIN reauthentication, quarantines for 30 days, supports restore, and purges
  expired quarantines without affecting another tenant.

## Security and accessibility

Firebase API keys are public client configuration, but service credentials and provider secrets
remain server-only. Production responses never expose development OTPs. All state-changing routes
enforce session, tenant membership, and appropriate permissions. Controls use native buttons,
labels, live status text, focusable names, and disabled states that communicate unavailable actions.
