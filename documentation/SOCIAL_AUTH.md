# Social Authentication

The signup and saved-workspace login screens use a shared provider registry in the frontend and the
API provider registry in `services/api/src/cp2/oauth.ts`.

## Implemented Providers

- Google OAuth
- Meta/Facebook OAuth
- LinkedIn OAuth
- Apple OAuth from the "Other social account" modal
- GitHub OAuth from the "Other social account" modal
- Microsoft OAuth from the "Other social account" modal

Implemented providers redirect through:

```text
POST /auth/oauth/start
```

The browser callback returns to:

```text
{WEB_ORIGIN}/auth/oauth/callback
```

The frontend then completes the server exchange through:

```text
POST /auth/oauth/callback
```

## Placeholder Providers

- X OAuth is visible in the UI but intentionally returns `501 oauth_provider_not_implemented`.
  TODO: complete the X OAuth 2.0 callback/profile lookup before enabling redirects.

## Configuration

Required environment variables for the primary providers:

- `OAUTH_GOOGLE_CLIENT_ID`
- `OAUTH_GOOGLE_CLIENT_SECRET`
- `OAUTH_FACEBOOK_CLIENT_ID`
- `OAUTH_FACEBOOK_CLIENT_SECRET`
- `OAUTH_LINKEDIN_CLIENT_ID`
- `OAUTH_LINKEDIN_CLIENT_SECRET`

Other modal providers:

- `OAUTH_APPLE_CLIENT_ID`
- `OAUTH_APPLE_CLIENT_SECRET`
- `OAUTH_GITHUB_CLIENT_ID`
- `OAUTH_GITHUB_CLIENT_SECRET`
- `OAUTH_MICROSOFT_CLIENT_ID`
- `OAUTH_MICROSOFT_CLIENT_SECRET`

Reserved X placeholder variables:

- `OAUTH_X_CLIENT_ID`
- `OAUTH_X_CLIENT_SECRET`

If a provider is missing configuration, the frontend keeps its button clickable and shows:

```text
This social login provider is not configured yet.
```
