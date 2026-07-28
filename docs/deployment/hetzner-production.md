# Hetzner production deployment

This is a staged deployment path. Do not remove Render or Neon until the rollback window has
closed. Vercel continues to host the frontend; Hetzner hosts the API and stateful services.

## Capacity and server creation

Start with an Ubuntu 24.04 LTS x86_64 server with at least 4 vCPU, 16 GB RAM, and 160 GB SSD when
Ollama and OCR share the host. Increase disk before enabling model auto-install. A smaller server
may work with AI/OCR disabled, but that configuration has not been capacity-tested.

Create the server with an SSH key. Attach a Hetzner Cloud Firewall allowing:

- TCP 22 from the operator/CI source ranges only
- TCP 80 and TCP/UDP 443 from the internet
- no public rules for 5432, 6379, 4000, 4002, or 8090

Hetzner Cloud Firewalls use an implicit inbound deny for traffic not allowed by a rule:
[Hetzner firewall overview](https://docs.hetzner.com/cloud/firewalls/overview/).

Create a non-root `soko` deployment user with sudo access, then harden SSH:

```bash
sudo adduser soko
sudo usermod -aG sudo soko
sudo install -d -m 700 -o soko -g soko /home/soko/.ssh
sudoedit /etc/ssh/sshd_config.d/99-soko-hardening.conf
```

Set `PasswordAuthentication no`, `PermitRootLogin no`, and `PubkeyAuthentication yes`; validate
with `sudo sshd -t` before restarting SSH. Keep the current session open until a second SSH-key
login succeeds.

Enable the host firewall and updates:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from OPERATOR_CIDR to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo apt update
sudo apt install -y unattended-upgrades fail2ban curl ca-certificates
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

Install Docker Engine and the Compose plugin from Docker's signed Ubuntu repository, not an
unverified convenience script. Add `soko` to the Docker group only if accepting that group as
root-equivalent; otherwise use sudo for Docker.

## DNS and filesystem

Create an `A` record for `api.soko.market` pointing to the server and an `AAAA` record only when
IPv6 is configured and firewalled. Ports 80/443 must reach Caddy for certificate issuance. Caddy
enables automatic HTTPS and redirects HTTP when given a hostname:
[Caddy automatic HTTPS](https://caddyserver.com/docs/caddyfile/options#auto-https).

Prepare deployment state:

```bash
sudo install -d -m 0750 -o soko -g soko /opt/soko-market/infra/caddy /opt/soko-market/scripts
cd /opt/soko-market
# Copy docker-compose.production.yml, infra/caddy/Caddyfile, and scripts/deploy-hetzner.sh here.
cp .env.production.example .env.production
chmod 600 .env.production
```

Populate `.env.production` with generated secrets. URL-encode database/Redis passwords in their
URLs. `DATABASE_URL` and `DIRECT_DATABASE_URL` should both use the internal `postgres` hostname.
Run `docker compose --env-file .env.production -f docker-compose.production.yml config` before
starting anything.

## First deployment

Authenticate the host to the container registry using a read-only token, set the four image names
and immutable `IMAGE_TAG` in `.env.production`, then:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml pull
docker compose --env-file .env.production -f docker-compose.production.yml \
  up --no-deps --abort-on-container-exit --exit-code-from migrate migrate
docker compose --env-file .env.production -f docker-compose.production.yml up -d
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail https://api.soko.market/health/ready
```

Only Caddy publishes host ports. PostgreSQL and Redis use named volumes and `expose`, which does not
publish them on the host.

Run full diagnostics:

```bash
chmod 750 scripts/production-diagnostics.sh
ENV_FILE=.env.production ./scripts/production-diagnostics.sh
```

The R2 test always deletes its temporary object. Inspect structured logs with:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --since=30m api worker caddy
docker compose --env-file .env.production -f docker-compose.production.yml logs postgres-backup
```

## Vercel

Connect the repository to Vercel with repository root as the project root. `vercel.json` builds the
workspace and serves `apps/web/dist`, including SPA rewrites and production security/cache headers.
Set at minimum:

```text
VITE_API_BASE_URL=https://api.soko.market
VITE_DEPLOYMENT_ENV=production
```

Copy the remaining `VITE_*` values from `.env.production.example`. Update the API's
`FRONTEND_ORIGIN`, `WEB_ORIGINS`, `AUTH_ALLOWED_REDIRECT_ORIGINS`, WebAuthn RP ID, and OAuth
callbacks to the exact production domains. Do not add wildcard credentialed CORS.

Vercel documents the `vercel.json` SPA rewrite pattern here:
[Vite SPA deployments](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas).

## Operations

- Enable disk, CPU, memory, certificate, container-restart, database-connection, and backup-failure
  alerts in the chosen monitoring system.
- Configure Docker log rotation globally as a backstop; Compose also limits per-service JSON logs.
- Apply OS security updates automatically and schedule reviewed application/image updates.
- Check `docker system df`, volume growth, PostgreSQL connections, and R2 backup age regularly.
- Test a restore at least monthly and a full restore into an isolated validation database weekly
  where capacity allows.
- Scale later by moving PostgreSQL to a separate private-network server, enabling TLS between
  hosts, and updating both database URLs. Do not expose PostgreSQL publicly.

## GitHub Actions deployment

`.github/workflows/deploy-hetzner.yml` is manually dispatched. It runs formatting, lint,
type-checking, tests, builds, Compose validation, and four commit-SHA-tagged images before an
optional deployment. Configure:

- repository variable `PRODUCTION_IMAGE_PREFIX`, for example
  `ghcr.io/OWNER/soko-market` (lowercase)
- repository variable `HETZNER_DEPLOY_DIR`, normally `/opt/soko-market`
- environment secrets `HETZNER_HOST`, `HETZNER_USER`, `HETZNER_SSH_PRIVATE_KEY`
- `HETZNER_SSH_KNOWN_HOST` containing the pre-verified host-key line, not output accepted from an
  unauthenticated `ssh-keyscan`

The host `.env.production` image names must be
`$PRODUCTION_IMAGE_PREFIX/api`, `/ai-runtime`, `/receipt-ocr`, and `/postgres-backup`. Give the host
a read-only GHCR pull token. Protect the GitHub `production` environment with required approval.

The deployment script stores the last healthy SHA. If readiness fails, it restores the previous
application images but deliberately does not reverse database migrations.
