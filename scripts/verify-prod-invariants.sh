#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NGINX_CONF="$ROOT_DIR/nginx/conf.d/default.conf"
NGINX_MAIN_CONF="$ROOT_DIR/nginx/nginx.conf"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
PROD_COMPOSE="$ROOT_DIR/docker-compose.prod.yml"
PROD_LOCAL_COMPOSE_EXAMPLE="$ROOT_DIR/docker-compose.prod.local.example.yml"
TLS_VHOST_EXAMPLE="$ROOT_DIR/nginx/conf.d-extra/50-subdomain-tls.conf.example"
MAKEFILE="$ROOT_DIR/Makefile"
GITIGNORE="$ROOT_DIR/.gitignore"
SERVER_DOCKERFILE="$ROOT_DIR/server/Dockerfile"
SERVER_PACKAGE_JSON="$ROOT_DIR/server/package.json"
DEPLOY_SCRIPT="$ROOT_DIR/scripts/deploy.sh"
LINK_CHECK_SCRIPT="$ROOT_DIR/scripts/check-markdown-links.mjs"
CI_WORKFLOW="$ROOT_DIR/.github/workflows/ci.yml"

fail() {
  echo "prod invariant failed: $*" >&2
  exit 1
}

grep -Fq 'server_name _;' "$NGINX_CONF" \
  || fail "nginx must use a generic catch-all server_name"

grep -Fq 'location /api/' "$NGINX_CONF" \
  || fail "nginx must proxy /api/"

grep -Fq 'proxy_pass $api_upstream;' "$NGINX_CONF" \
  || fail "nginx must proxy API traffic to the server service"

grep -Fq 'proxy_pass $icecast_upstream/stream;' "$NGINX_CONF" \
  || fail "nginx must proxy /stream to Icecast"

[ -f "$PROD_LOCAL_COMPOSE_EXAMPLE" ] \
  || fail "missing docker-compose.prod.local.example.yml"

[ -f "$TLS_VHOST_EXAMPLE" ] \
  || fail "missing nginx/conf.d-extra/50-subdomain-tls.conf.example"

[ -f "$PROD_COMPOSE" ] \
  || fail "missing docker-compose.prod.yml override for production"

grep -Fq 'include /etc/nginx/conf.d-extra/*.conf;' "$NGINX_MAIN_CONF" \
  || fail "nginx must load local-only conf.d-extra overrides"

grep -Fq './nginx/conf.d-extra:/etc/nginx/conf.d-extra:ro' "$COMPOSE_FILE" \
  || fail "docker-compose.yml must mount nginx/conf.d-extra for local host overrides"

grep -Fq 'PROD_LOCAL_COMPOSE_FILE := docker-compose.prod.local.yml' "$MAKEFILE" \
  || fail "Makefile must define docker-compose.prod.local.yml as the local production override"

grep -Fq 'PROD_COMPOSE_FILES := -f docker-compose.yml -f docker-compose.prod.yml $(PROD_LOCAL_COMPOSE)' "$MAKEFILE" \
  || fail "make build/deploy must auto-include the local production override when present"

grep -Fq '/docker-compose.prod.local.yml' "$GITIGNORE" \
  || fail ".gitignore must ignore docker-compose.prod.local.yml"

grep -Fq '/nginx/conf.d-extra/*' "$GITIGNORE" \
  || fail ".gitignore must ignore local-only nginx/conf.d-extra contents"

grep -Fq '!/nginx/conf.d-extra/*.example' "$GITIGNORE" \
  || fail ".gitignore must allow tracked nginx conf.d-extra example files"

if grep -Eq 'duckfeed\.cmr\.my|listen 443|ssl_certificate|letsencrypt' "$NGINX_CONF"; then
  fail "nginx public template must not hardcode live domains or TLS cert paths"
fi

if grep -Eq '443:443|/etc/letsencrypt' "$PROD_COMPOSE"; then
  fail "docker-compose.prod.yml must not duplicate TLS-only ports or certificate mounts"
fi

grep -Fq '443:443' "$PROD_LOCAL_COMPOSE_EXAMPLE" \
  || fail "docker-compose.prod.local.example.yml must expose port 443"

grep -Fq '/etc/letsencrypt:/etc/letsencrypt:ro' "$PROD_LOCAL_COMPOSE_EXAMPLE" \
  || fail "docker-compose.prod.local.example.yml must mount letsencrypt certs"

grep -Fq 'server_name api.duckfeed.cmr.my;' "$TLS_VHOST_EXAMPLE" \
  || fail "TLS vhost example must define the API hostname"

grep -Fq 'server_name stream.duckfeed.cmr.my;' "$TLS_VHOST_EXAMPLE" \
  || fail "TLS vhost example must define the stream hostname"

if grep -Fq 'Access-Control-Allow-Origin' "$NGINX_CONF"; then
  fail "nginx must not duplicate CORS headers that Fastify already sets"
fi

grep -Fq 'REMOTE_HOST="${DUCKFEED_REMOTE_HOST:-duck-ts}"' "$DEPLOY_SCRIPT" \
  || fail "deploy script must default to the working duck-ts host alias"

grep -Fq 'docker-compose.prod.local.example.yml' "$DEPLOY_SCRIPT" \
  || fail "deploy script must restore docker-compose.prod.local.yml from the checked-in example"

grep -Fq '50-subdomain-tls.conf.example' "$DEPLOY_SCRIPT" \
  || fail "deploy script must restore the TLS vhost config from the checked-in example"

grep -Eq '^stream-check:.*## ' "$MAKEFILE" \
  || fail "Makefile must expose a stream-check target"

grep -Fq 'check-public-stream.mjs' "$MAKEFILE" \
  || fail "stream-check must invoke the public stream validation script"

grep -Eq '^stream-check-quick:.*## ' "$MAKEFILE" \
  || fail "Makefile must expose a stream-check-quick target"

grep -Eq '^link-check:.*## ' "$MAKEFILE" \
  || fail "Makefile must expose a link-check target"

[ -f "$LINK_CHECK_SCRIPT" ] \
  || fail "missing scripts/check-markdown-links.mjs"

grep -Fq 'check-public-stream.mjs" --quick' "$DEPLOY_SCRIPT" \
  || fail "deploy script must run the quick public stream validation after backend rollout"

grep -Fq 'node scripts/check-markdown-links.mjs' "$CI_WORKFLOW" \
  || fail "CI must run the tracked markdown link checker"

grep -Fq 'COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts' "$SERVER_DOCKERFILE" \
  || fail "production server image must include drizzle.config.ts"

grep -Fq 'COPY --from=build /app/src/db ./src/db' "$SERVER_DOCKERFILE" \
  || fail "production server image must include db sources and migrations"

grep -Fq '"db:migrate": "drizzle-kit migrate --config=drizzle.config.ts"' "$SERVER_PACKAGE_JSON" \
  || fail "server db:migrate must use the checked-in drizzle config"

echo "prod invariants ok"
