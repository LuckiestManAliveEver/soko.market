# Environment Conventions

CP1 uses explicit environment variables with safe local defaults documented in `.env.example`.

## Local Services

- PostgreSQL: `postgres://soko:soko_dev_password@127.0.0.1:5432/soko_market`
- Redis: `redis://127.0.0.1:6379`
- API: `http://127.0.0.1:4000`
- Web frontend: `http://127.0.0.1:5173`

Start local infrastructure with:

```bash
pnpm dev:stack
```

Start the API watcher and Vite frontend dev server with:

```bash
pnpm dev
```

Run only the Vite frontend with:

```bash
pnpm dev:web
```

Stop local infrastructure with:

```bash
pnpm dev:stack:down
```

## Variable Rules

- Never commit `.env` files with secrets.
- Keep `.env.example` complete enough for a fresh clone.
- Services must validate required variables at startup.
- Business-changing feature switches must be explicit and auditable.
- AI or model provider configuration must remain outside business-core packages.

## Social OAuth

The frontend reads provider status from `GET /auth/oauth/providers` and starts real redirects
through `POST /auth/oauth/start`.

- Implemented redirect/code-exchange providers: Google, Meta/Facebook, LinkedIn, Apple, GitHub,
  Microsoft.
- Placeholder provider: X. The API returns an explicit `501 oauth_provider_not_implemented` until
  the X callback/profile flow is completed.
- Missing client IDs or secrets are not treated as success. The UI shows
  `This social login provider is not configured yet.`

Required variables:

- `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`
- `OAUTH_FACEBOOK_CLIENT_ID`, `OAUTH_FACEBOOK_CLIENT_SECRET`
- `OAUTH_LINKEDIN_CLIENT_ID`, `OAUTH_LINKEDIN_CLIENT_SECRET`
- Optional other-provider modal entries: `OAUTH_APPLE_CLIENT_ID`, `OAUTH_APPLE_CLIENT_SECRET`,
  `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`, `OAUTH_MICROSOFT_CLIENT_ID`,
  `OAUTH_MICROSOFT_CLIENT_SECRET`
- Reserved for the X placeholder: `OAUTH_X_CLIENT_ID`, `OAUTH_X_CLIENT_SECRET`
- `OAUTH_TOKEN_ENCRYPTION_KEY` for encrypted stored OAuth tokens.

Redirect URI format:

```text
{WEB_ORIGIN}/auth/oauth/callback
```

For local development, use:

```text
http://127.0.0.1:5173/auth/oauth/callback
```
