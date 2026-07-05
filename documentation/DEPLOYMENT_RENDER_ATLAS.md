# Soko Market Render and Atlas Test Deployment

This repo is ready for a free-tier test deployment with GitHub, Render, and MongoDB Atlas.

## Current Shape

- `soko-market-web`: Render static site for the Vite app.
- `soko-market-api`: Render free web service for the Fastify API.
- `soko.market` and `www.soko.market`: custom domains for the web app.
- `api.soko.market`: custom domain for the API service.
- Atlas M0: optional test database secret for future persistence work.

The CP16 app state is still in-memory in `services/api/src/cp2/store.ts`. Adding `MONGODB_URI` now makes the Render environment ready for Atlas, but app state will not persist in Atlas until a Mongo-backed store adapter is implemented.

## GitHub

1. Push `main` and tags to GitHub.
2. Confirm GitHub Actions passes on `main`.
3. In Render, connect the GitHub repository `LuckiestManAliveEver/soko.market`.

## MongoDB Atlas Free Cluster

1. Create an Atlas free `M0` cluster.
2. Create a database user with a generated password.
3. Add a Network Access rule for Render testing.
   - For quick free-tier testing, Atlas allows broad IP access, but restrict this before any real launch.
   - Render free services do not provide a stable outbound IP.
4. Copy the Atlas connection string.
5. Set Render secret `MONGODB_URI` to the Atlas connection string.

## Render Blueprint

Use the root `render.yaml` blueprint.

1. In Render, create a new Blueprint from the GitHub repo.
2. Deploy both services.
3. Set `MONGODB_URI` on `soko-market-api` to the Atlas connection string when Render prompts for unsynced secrets.
4. Update `VITE_API_URL` on `soko-market-web` if the API custom domain is different.
5. If Render custom-domain limits make `api.soko.market` unsuitable on the free/Hobby allowance, remove the API `domains` entry, use the API service's `onrender.com` URL for `VITE_API_URL`, and keep `soko.market` on the static site.

## DNS

Configure DNS with the domain provider after adding domains in Render.

- `soko.market`: point the root/apex record to the value Render provides.
- `www.soko.market`: Render automatically adds the `www` redirect when the root domain is added.
- `api.soko.market`: CNAME to the API service `onrender.com` hostname Render provides.

Remove any conflicting `AAAA` records while configuring Render custom domains.

## Free-Tier Notes

- Render free web services spin down after idle time and can take about a minute to wake.
- Render free web services have monthly free instance-hour limits.
- Static sites support custom domains and are a good fit for the Vite app.
- Atlas M0 is suitable for test data only.

## Smoke Test

After DNS verifies:

```sh
curl https://api.soko.market/health
```

Then open:

```text
https://soko.market
```
