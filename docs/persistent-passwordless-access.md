# Persistent passwordless access

## User lifecycle

1. A new user supplies a phone identifier, accepts the terms, and creates an account. The phone is
   stored as unverified and a password fallback is optional.
2. The signup completion creates HTTP-only access and refresh cookies, then recommends a passkey.
   The user may defer it only when the account has a password fallback.
3. On a later browser or installed-PWA launch, the frontend displays a restoring state while it calls
   `/auth/bootstrap`. A 401 triggers one silent `POST /auth/session/refresh` and retries the original
   request.
4. After explicit logout, return access is passkey-first. The password fallback is available only
   when the account has one. A verified passkey can authorize a legacy phone-PIN reset; no separate
   phone PIN recovery code is issued or accepted.

Offline startup may show the previously cached non-secret account view as
`offline-authenticated`. It does not treat cached UI data as proof of authentication and does not
erase that view merely because the network is unavailable. Tokens remain only in HTTP-only cookies;
local storage contains no access or refresh credential.

## Session limits and rotation

- Access lifetime: `SESSION_ACCESS_TTL_SECONDS`, default 900 seconds.
- Sliding inactivity lifetime: `SESSION_INACTIVITY_TTL_DAYS`, default 30 days.
- Absolute family lifetime: `SESSION_ABSOLUTE_TTL_DAYS`, default 180 days.

Refresh rotates the credential on every successful use and stores the prior session as revoked with
`rotated_from_session_id` on its replacement. The inactivity deadline slides but is capped by the
original family's absolute deadline. Reuse of any rotated credential revokes the family. Suspended,
disabled, or deleted accounts cannot restore or refresh sessions. A silent refresh preserves the
original `authenticated_at`; it therefore cannot satisfy the 15-minute recent-authentication check
for logout-all, passkey registration, or other high-risk operations.

These limits provide persistent access, not indefinite login. Cookie deletion, private browsing,
browser storage cleanup, inactivity, the absolute deadline, account status changes, explicit logout,
administrator revocation, or refresh-token reuse all require authentication again.

## Verification boundaries

Automated tests cover API cookies, passwordless account creation, generic method discovery, access
expiry plus silent refresh, inactivity/absolute expiry, rotation/reuse, account suspension, migration
shape, no-store headers, and mocked WebAuthn ceremonies. A production release still requires a real
browser and installed Android PWA check on the final HTTPS domains, a hardware-backed passkey test,
and an email delivery test. Fastify-injected requests are test doubles, not proof of email delivery
or OS-level PWA persistence. The release must also confirm that retired phone-verification routes
and the retired phone PIN recovery-code route return 404.
