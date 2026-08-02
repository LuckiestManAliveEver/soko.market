# Passkeys

Passkey registration and authentication use `@simplewebauthn` and WebAuthn. The relying-party ID is
configured with `WEBAUTHN_RP_ID`; production origins must be HTTPS and belong to that RP ID.
List every exact browser origin in `WEBAUTHN_EXPECTED_ORIGINS`.

Registration is recommended immediately after passwordless phone signup. It requires an
authenticated, recently verified session and requests a discoverable
credential with user verification. Authentication verifies challenge, origin, RP ID, user presence,
user verification, signature, and signature counter before creating or upgrading a session. Ceremony
records expire after five minutes and are consumed once.

Operators should verify passkeys on the exact production domain after every domain or reverse-proxy
change. Users can list, rename, and remove credentials from account security settings. Do not remove
the final viable authentication/recovery method without adding another first.
