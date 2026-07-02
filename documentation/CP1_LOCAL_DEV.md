# CP1 Local Development

## Fresh Clone Boot Path

```bash
pnpm install
pnpm dev:stack
pnpm --filter @soko/api start
pnpm health:api
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
