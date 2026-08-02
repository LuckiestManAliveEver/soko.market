# Phone-first authentication architecture

The canonical account key remains `accounts.id` (UUID). Phone and email identities resolve to that
key through `account_identities`; neither contact value is a database primary key. Existing
`accounts.primary_auth_*`, PIN credentials, OAuth identities, sessions, and passkeys remain readable
during migration.

## State machine

`identifier → phone challenge → verified signup transaction → profile/password → session`

`identifier → password → (optional MFA transaction → second factor) → session`

`identifier → generic recovery response → channel verification → optional MFA → password reset → rotated session`

Passkeys use discoverable WebAuthn credentials and resolve directly to the same account UUID.
Access cookies last 15 minutes; HTTP-only refresh cookies last 30 days and rotate on use. Reuse
revokes the session family. Authentication responses are `no-store` and the service worker treats
all authentication and session URLs as network-only.

## Reused components

- `Cp2Store` account, user, audit-event, and session infrastructure
- scrypt credential format and constant-time comparison patterns
- `libphonenumber-js` E.164 normalization
- SimpleWebAuthn registration/authentication validation
- Fastify origin allowlist and credentialed CORS
- Resend-compatible email provider
- Postgres compatibility snapshot adapter and relational migrations

## Compatibility and obsolete integrations

Legacy PIN routes and an explicitly labeled login fallback remain for existing users during the
compatibility release. New signup stores the phone as an unverified identifier and supports an
optional password plus a recommended passkey. Legacy email OTP and OAuth records are retained.
Firebase phone authentication and its client code were previously removed; no phone verification
provider, SMS gateway, or SMS recovery route is present.

The audited login-loop failure mode is an expired 15-minute access cookie being treated as a
terminal logout before the rotating refresh cookie is tried, especially when stale PWA navigation
state is involved. The existing client already sent credentials and coalesced refresh attempts; this
rollout preserves that behavior, retains only non-secret cached session display data, and extends
network-only/no-store handling to every new auth and session route alias.
