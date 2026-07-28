#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="${COMPOSE_FILE:-docker-compose.production.yml}"
environment_file="${ENV_FILE:-.env.production}"

if [[ ! -f "${environment_file}" ]]; then
  echo "Missing ${environment_file}." >&2
  exit 1
fi

read_environment_value() {
  local name="$1"
  sed -n "s/^${name}=//p" "${environment_file}" | tail -n 1 | tr -d '\r'
}

api_domain="$(read_environment_value API_DOMAIN)"
postgres_user="$(read_environment_value POSTGRES_USER)"
postgres_database="$(read_environment_value POSTGRES_DB)"
if [[ -z "${api_domain}" || -z "${postgres_user}" || -z "${postgres_database}" ]]; then
  echo "API_DOMAIN, POSTGRES_USER, and POSTGRES_DB must be set." >&2
  exit 1
fi

echo "Checking public API readiness"
curl --fail --silent --show-error "https://${api_domain}/health/ready"

echo "Checking PostgreSQL"
docker compose --env-file "${environment_file}" -f "${compose_file}" exec -T postgres \
  pg_isready -U "${postgres_user}" -d "${postgres_database}"

echo "Checking Redis"
docker compose --env-file "${environment_file}" -f "${compose_file}" exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'

echo "Checking AI runtime"
docker compose --env-file "${environment_file}" -f "${compose_file}" exec -T ai-runtime \
  node -e "fetch('http://127.0.0.1:4002/health/live').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))"

echo "Checking R2 write/read/delete"
docker compose --env-file "${environment_file}" -f "${compose_file}" run --rm \
  postgres-backup node r2-diagnostic.mjs

echo "Checking migration state"
docker compose --env-file "${environment_file}" -f "${compose_file}" exec -T postgres \
  psql -U "${postgres_user}" -d "${postgres_database}" -v ON_ERROR_STOP=1 \
  -c "select count(*) as applied_migrations, max(filename) as latest_migration from soko_schema_migrations;"

echo "Checking disk space"
df -h / /var/lib/docker
