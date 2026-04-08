#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NGINX_CONF="$ROOT_DIR/nginx/conf.d/default.conf"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
PROD_COMPOSE="$ROOT_DIR/docker-compose.prod.yml"
SERVER_DOCKERFILE="$ROOT_DIR/server/Dockerfile"
SERVER_PACKAGE_JSON="$ROOT_DIR/server/package.json"

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

[ -f "$PROD_COMPOSE" ] \
  || fail "missing docker-compose.prod.yml override for production"

if grep -Eq 'duckfeed\.cmr\.my|listen 443|ssl_certificate|letsencrypt' "$NGINX_CONF"; then
  fail "nginx public template must not hardcode live domains or TLS cert paths"
fi

if grep -Eq '443:443|/etc/letsencrypt' "$COMPOSE_FILE" "$PROD_COMPOSE"; then
  fail "compose files must not hardcode TLS-only ports or certificate mounts"
fi

if grep -Fq 'Access-Control-Allow-Origin' "$NGINX_CONF"; then
  fail "nginx must not duplicate CORS headers that Fastify already sets"
fi

grep -Fq 'COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts' "$SERVER_DOCKERFILE" \
  || fail "production server image must include drizzle.config.ts"

grep -Fq 'COPY --from=build /app/src/db ./src/db' "$SERVER_DOCKERFILE" \
  || fail "production server image must include db sources and migrations"

grep -Fq '"db:migrate": "drizzle-kit migrate --config=drizzle.config.ts"' "$SERVER_PACKAGE_JSON" \
  || fail "server db:migrate must use the checked-in drizzle config"

echo "prod invariants ok"
