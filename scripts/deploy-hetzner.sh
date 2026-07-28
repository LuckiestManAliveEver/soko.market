#!/usr/bin/env bash
set -Eeuo pipefail

release_tag="${1:-${IMAGE_TAG:-}}"
deploy_directory="${DEPLOY_DIR:-/opt/soko-market}"
environment_file="${ENV_FILE:-${deploy_directory}/.env.production}"
compose_file="${COMPOSE_FILE:-${deploy_directory}/docker-compose.production.yml}"
tag_file="${deploy_directory}/.deployed-image-tag"

if [[ ! "${release_tag}" =~ ^[a-f0-9]{7,64}$ ]]; then
  echo "An immutable hexadecimal commit SHA image tag is required." >&2
  exit 1
fi
if [[ ! "${deploy_directory}" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
  echo "DEPLOY_DIR must be a simple absolute path." >&2
  exit 1
fi
if [[ ! -f "${environment_file}" || ! -f "${compose_file}" ]]; then
  echo "Production environment or Compose configuration is missing." >&2
  exit 1
fi

previous_tag=""
if [[ -f "${tag_file}" ]]; then
  previous_tag="$(tr -d '[:space:]' < "${tag_file}")"
fi

export IMAGE_TAG="${release_tag}"
compose=(docker compose --env-file "${environment_file}" -f "${compose_file}")

"${compose[@]}" config >/dev/null
"${compose[@]}" pull
"${compose[@]}" up --no-deps --abort-on-container-exit --exit-code-from migrate migrate
"${compose[@]}" up -d --remove-orphans

api_domain="$(sed -n 's/^API_DOMAIN=//p' "${environment_file}" | tail -n 1 | tr -d '\r')"
if [[ -z "${api_domain}" ]]; then
  echo "API_DOMAIN is missing from ${environment_file}." >&2
  exit 1
fi

healthy=false
for _ in $(seq 1 24); do
  if curl --fail --silent --show-error "https://${api_domain}/health/ready" >/dev/null; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "${healthy}" == "true" ]]; then
  printf '%s\n' "${release_tag}" > "${tag_file}"
  echo "Deployment ${release_tag} is ready."
  exit 0
fi

echo "Deployment health check failed." >&2
if [[ "${previous_tag}" =~ ^[a-f0-9]{7,64}$ ]]; then
  echo "Rolling application containers back to ${previous_tag}; database migrations are unchanged." >&2
  export IMAGE_TAG="${previous_tag}"
  "${compose[@]}" up -d --no-deps api worker ai-runtime receipt-ocr postgres-backup
fi
exit 1
