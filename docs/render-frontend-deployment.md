# Render unified application deployment

The Vite frontend in `apps/web` and Fastify API in `services/api` ship together in the production
Render service `soko-market`.

`pnpm build:production` builds packages, the Vercel inference package, the web bundle, and the API.
The API process then serves `apps/web/dist`; browser navigations fall back to `index.html`, while
unknown API requests retain JSON 404 responses. Hashed `/assets/*` files are immutable, and HTML,
the service worker, manifest, and icons revalidate on every request.

Production uses `VITE_API_BASE_URL=https://soko.market`, so browser requests and session cookies
are same-origin. The branch-specific `soko-market-web-staging` static service remains independent
and must be given its own API URL.

For dashboard setup, secret transfer, DNS cutover, verification, and rollback, use
[`../deployment.md`](../deployment.md).
