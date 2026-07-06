# CP1 Local Development

## Fresh Clone Boot Path

```bash
pnpm install
pnpm dev:stack
pnpm dev
pnpm health:api
```

The root `pnpm dev` command runs the API watcher and the Vite frontend dev
server together. Frontend edits under `apps/web/src` hot-reload at:

```text
http://127.0.0.1:5173
```

If you only need one side of the app, use:

```bash
pnpm dev:web
pnpm dev:api
```

## Baseline Checks

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm check:boundaries
```

The combined CI command is:

```bash
pnpm run ci
```

## Local Services

Docker Compose provides:

- PostgreSQL on port `5432`
- Redis on port `6379`

The API health endpoint is:

```text
GET http://127.0.0.1:4000/health
```

The web frontend uses `VITE_API_URL` and defaults to:

```text
http://127.0.0.1:4000
```
