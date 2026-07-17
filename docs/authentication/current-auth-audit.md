# Current authentication audit

Date: 2026-07-11

## Framework decision

The repository does not currently use Better Auth, Auth.js/NextAuth, Passport, Supabase Auth, Clerk, or Prisma. It uses Firebase Auth only for phone OTP transport, while CP2 still owns sessions, accounts, and business permissions.

Current auth is a custom Node/Fastify CP2 auth implementation:

- API routes: `services/api/src/cp2/routes.ts`
- Auth/session store: `services/api/src/cp2/store.ts`
- OAuth provider/token logic: `services/api/src/cp2/oauth.ts`
- OTP provider adapter: `services/api/src/cp2/otp-provider.ts`
- Postgres/Drizzle migration execution: `services/api/scripts/migrate-db.mjs`
- Frontend auth UI: `apps/web/src/main.tsx`

Because this stack already has OTP, OAuth state/CSRF, encrypted OAuth token persistence, session cookies, and Drizzle/Postgres migrations, the safe path is to extend the existing implementation instead of adding an overlapping auth framework.

## Existing auth capabilities

- Email and Firebase phone signup verification, plus email/phone recovery request and verify.
- WebAuthn passkey registration, login, listing, and revocation.
- Session cookie creation and logout.
- OAuth start/callback flow with server-side token exchange.
- OAuth token encryption using AES-256-GCM.
- Account/user/session relational tables.
- User identity and OAuth session relational tables.
- PIN setup/login/recovery.
- Connected social account display and disconnect flow.

## Implemented social-login additions

- Primary frontend choices now include:
  - Continue with phone
  - Continue with email
- TikTok OAuth provider metadata is now supported.
- `/api/auth/...` aliases were added for provider discovery, OAuth start/callback, OTP request/verify, session, logout, logout-all, and login account list/link/disconnect.
- Session-scoped login accounts are now separate from business/customer channels in the settings UI.
- New relational social-auth tables were added in migration `015_social_auth_accounts_channels.sql`.

## Security notes

- OAuth token exchange remains server-side.
- OAuth tokens are encrypted before persistence.
- Existing OAuth state and CSRF validation remains in place.
- Normal login uses a passkey, PIN, or connected social identity.
- Firebase SMS supports phone signup and lost-account recovery. Only signup challenges may create
  an account; recovery challenges still require an existing account.
- Provider secrets stay in server environment variables and are not exposed to Vite.

## Known follow-up work

- Configure production provider apps in Google, Facebook, and TikTok dashboards.
- Configure Firebase phone auth and the API project ID before enabling phone signup or recovery in
  production.
- Add stricter OTP rate-limit backing storage if API instances scale horizontally.
- Move business channel connect/disconnect UX into a dedicated channel management screen when provider APIs are fully configured.
