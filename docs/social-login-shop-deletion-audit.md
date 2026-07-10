# Social login and shop deletion audit

## Provider status

| Provider                 | Runtime status                                                                                  | Required server variables                                                                                  | Callback path          |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| Google                   | Implemented when configured                                                                     | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or `OAUTH_GOOGLE_CLIENT_ID`/`OAUTH_GOOGLE_CLIENT_SECRET`         | `/auth/oauth/callback` |
| Meta/Facebook            | Implemented when configured                                                                     | `META_CLIENT_ID`/`META_CLIENT_SECRET` or `OAUTH_FACEBOOK_CLIENT_ID`/`OAUTH_FACEBOOK_CLIENT_SECRET`         | `/auth/oauth/callback` |
| X                        | Implemented when configured                                                                     | `X_CLIENT_ID`/`X_CLIENT_SECRET` or `OAUTH_X_CLIENT_ID`/`OAUTH_X_CLIENT_SECRET`                             | `/auth/oauth/callback` |
| LinkedIn                 | Implemented when configured                                                                     | `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` or `OAUTH_LINKEDIN_CLIENT_ID`/`OAUTH_LINKEDIN_CLIENT_SECRET` | `/auth/oauth/callback` |
| Apple, GitHub, Microsoft | Supported by the shared provider registry and shown under “another account” when used by the UI | `OAUTH_*` variables                                                                                        | `/auth/oauth/callback` |

No provider is treated as available from the frontend alone. The frontend loads `/auth/oauth/providers` and starts login through `/auth/oauth/start`. If a provider is not configured, the UI displays “This social login provider is not configured yet.”

## Secrets and tokens

Client secrets and token exchange stay on the API server. The browser receives only provider metadata, OAuth `state`, CSRF token, and the authorization redirect URL. Access, refresh, and ID tokens are not written to browser storage or frontend bundles.

Provider emails are used for account matching only when the provider marks the email verified. Unverified emails do not merge accounts.

## Callback URLs

Configure each provider with the deployed web callback URL:

```text
https://<web-origin>/auth/oauth/callback
```

For local development:

```text
http://127.0.0.1:5173/auth/oauth/callback
```

## Connected social accounts

The API exposes connected user identities for the active shop owner:

- `GET /businesses/:businessId/social-accounts`
- `DELETE /businesses/:businessId/social-accounts/:identityId`

Disconnecting the last social identity is blocked unless the account has another verified login method such as a PIN-backed phone/email account.

## Shop deletion lifecycle

Shop deletion is separate from user-account deletion.

The strict shop-deletion flow uses:

- `GET /businesses/:businessId/shop-deletion/preview`
- `POST /businesses/:businessId/shop-deletion/request`
- `POST /businesses/:businessId/shop-deletion/:requestId/finalize`

Step 1 requires the exact Soko shop ID. Step 2 requires:

- current owner session
- owner PIN re-authentication
- OTP sent after Step 1
- permanent-action acknowledgement

The deletion request moves through lifecycle states such as `PENDING_VERIFICATION`, `VERIFIED`, `RUNNING`, `COMPLETED`, and `PARTIALLY_FAILED`. The deletion job is idempotent and tenant-scoped.

The active shop and its removable shop-owned data are deleted without deleting other shops owned by the same Soko user. Audit records and legally required financial/security retention data may remain restricted according to retention rules and backup expiry.
