#!/usr/bin/env bash
set -euo pipefail

################################################################################
# Duck Feed — Deploy Script
#
# Deploys from your local machine:
#   1. Syncs local ↔ origin/main
#   2. SSHs to prod, pulls, builds images, swaps containers
#   3. Runs DB migrations
#   4. Deploys frontend to Cloudflare Pages
#
# Usage:
#   bash scripts/deploy.sh            # full deploy (backend + frontend)
#   bash scripts/deploy.sh --backend  # backend only
#   bash scripts/deploy.sh --frontend # frontend only
#   bash scripts/deploy.sh --dry-run  # preflight checks only
################################################################################

REMOTE_HOST="${DUCKFEED_REMOTE_HOST:-duck-ts}"
REMOTE_DIR="/opt/duckfeed"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step()  { echo -e "\n${GREEN}▶ $1${NC}"; }
info()  { echo -e "  ${CYAN}$1${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail()  { echo -e "\n${RED}✗ $1${NC}" >&2; exit 1; }
ok()    { echo -e "  ${GREEN}✓ $1${NC}"; }

# --- Parse args ---
DEPLOY_BACKEND=true
DEPLOY_FRONTEND=true
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --backend)  DEPLOY_FRONTEND=false ;;
    --frontend) DEPLOY_BACKEND=false ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)
      echo "Usage: scripts/deploy.sh [--backend|--frontend|--dry-run]"
      exit 0
      ;;
    *) fail "Unknown argument: $arg" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

################################################################################
# Step 1: Sync git
################################################################################
step "Syncing git..."

HAS_LOCAL_CHANGES=false
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
  HAS_LOCAL_CHANGES=true
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  fail "Not on main (currently on '$BRANCH'). Switch to main before deploying."
fi

git fetch origin main --quiet

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  MERGE_BASE=$(git merge-base HEAD origin/main)

  if [ "$MERGE_BASE" = "$LOCAL_HEAD" ]; then
    # Local is behind — need to pull
    if $HAS_LOCAL_CHANGES; then
      warn "Local is behind origin/main but you have uncommitted changes."
      warn "Stash or commit first, or the deploy will use what's already on origin/main."
      info "Deploying origin/main as-is (your uncommitted changes will NOT be included)."
    else
      info "Local is behind origin/main — pulling..."
      git pull --ff-only origin main
    fi
  elif [ "$MERGE_BASE" = "$REMOTE_HEAD" ]; then
    # Local is ahead — push
    if $HAS_LOCAL_CHANGES; then
      warn "You have uncommitted changes that won't be deployed."
    fi
    info "Local is ahead of origin/main — pushing..."
    git push origin main
  else
    fail "Local and origin/main have diverged. Resolve manually before deploying."
  fi
else
  if $HAS_LOCAL_CHANGES; then
    warn "You have uncommitted changes that won't be deployed."
  fi
  ok "Local and origin/main are in sync"
fi

DEPLOY_SHA=$(git rev-parse --short origin/main)
info "Deploying commit: $DEPLOY_SHA ($(git log -1 --format='%s' origin/main))"

################################################################################
# Step 2: Preflight checks on prod
################################################################################
step "Running preflight checks on prod..."

ssh -o ConnectTimeout=10 "$REMOTE_HOST" bash <<'PREFLIGHT'
set -euo pipefail

# Docker running?
if ! docker info >/dev/null 2>&1; then
  echo "FAIL: Docker is not running" >&2
  exit 1
fi
echo "  ✓ Docker OK"

# Disk space (fail if <500MB free on /opt)
avail_kb=$(df --output=avail /opt | tail -1 | tr -d ' ')
avail_mb=$((avail_kb / 1024))
if [ "$avail_mb" -lt 500 ]; then
  echo "FAIL: Only ${avail_mb}MB free on /opt (need 500MB minimum)" >&2
  exit 1
fi
echo "  ✓ Disk space OK (${avail_mb}MB free)"

# SSL certs exist and are readable by root (which is how nginx reads them)
for domain in api.duckfeed.cmr.my stream.duckfeed.cmr.my; do
  cert="/etc/letsencrypt/live/$domain/fullchain.pem"
  key="/etc/letsencrypt/live/$domain/privkey.pem"
  if ! sudo test -f "$cert"; then
    echo "FAIL: Certificate not found: $cert" >&2
    exit 1
  fi
  if ! sudo test -f "$key"; then
    echo "FAIL: Private key not found: $key" >&2
    exit 1
  fi
done
echo "  ✓ SSL certificates present"

# Restore the local production compose override when it has not been created yet.
if [ ! -f /opt/duckfeed/docker-compose.prod.local.yml ]; then
  if [ -f /opt/duckfeed/docker-compose.prod.local.example.yml ]; then
    cp /opt/duckfeed/docker-compose.prod.local.example.yml /opt/duckfeed/docker-compose.prod.local.yml
    echo "  ✓ Restored docker-compose.prod.local.yml from example"
  else
    echo "FAIL: docker-compose.prod.local.yml missing on prod and no example is available" >&2
    exit 1
  fi
else
  echo "  ✓ docker-compose.prod.local.yml present"
fi

# Restore the split-origin TLS vhost config when it has not been created yet.
if [ ! -f /opt/duckfeed/nginx/conf.d-extra/50-subdomain-tls.conf ]; then
  if [ -f /opt/duckfeed/nginx/conf.d-extra/50-subdomain-tls.conf.example ]; then
    cp /opt/duckfeed/nginx/conf.d-extra/50-subdomain-tls.conf.example /opt/duckfeed/nginx/conf.d-extra/50-subdomain-tls.conf
    echo "  ✓ Restored nginx/conf.d-extra/50-subdomain-tls.conf from example"
  else
    echo "FAIL: nginx/conf.d-extra/50-subdomain-tls.conf missing on prod and no example is available" >&2
    exit 1
  fi
else
  echo "  ✓ TLS nginx config present"
fi
echo "  ✓ Preflight complete"
PREFLIGHT

if $DRY_RUN; then
  step "Dry run complete — no changes made on prod."
  exit 0
fi

################################################################################
# Step 3: Pull code on prod
################################################################################
if $DEPLOY_BACKEND; then

step "Pulling code on prod..."
ssh "$REMOTE_HOST" bash <<PULL
set -euo pipefail
cd $REMOTE_DIR
git fetch origin main
git reset --hard origin/main
echo "  ✓ Prod at \$(git rev-parse --short HEAD)"
PULL

################################################################################
# Step 4: Build images (without stopping running containers)
################################################################################
step "Building Docker images on prod (this may take a minute)..."
ssh "$REMOTE_HOST" bash <<'BUILD'
set -euo pipefail
cd /opt/duckfeed

# Assemble compose file flags
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
if [ -f docker-compose.prod.local.yml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.local.yml"
fi

# Build all images. Old containers keep running during the build.
docker compose $COMPOSE_FILES build 2>&1 | tail -5
echo "  ✓ Images built"
BUILD

################################################################################
# Step 5: Deploy containers (stream-safe)
################################################################################
step "Deploying containers on prod..."
ssh "$REMOTE_HOST" bash <<'DEPLOY'
set -euo pipefail
cd /opt/duckfeed

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
if [ -f docker-compose.prod.local.yml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.local.yml"
fi

# Snapshot which services are currently running
RUNNING_BEFORE=$(docker compose $COMPOSE_FILES ps --format '{{.Service}} {{.State}}' 2>/dev/null || true)

# Bring up the stack. Docker Compose only recreates containers whose
# image or config actually changed. This means liquidsoap and icecast
# will keep running unless their Dockerfile or compose config changed.
docker compose $COMPOSE_FILES up -d 2>&1

echo ""
echo "Waiting for services to stabilise..."
sleep 8

# Show service status
docker compose $COMPOSE_FILES ps

echo ""

# Verify API is healthy
attempts=0
api_ok=false
while [ $attempts -lt 6 ]; do
  if docker compose $COMPOSE_FILES exec -T server wget --spider -q http://localhost:3000/api/health 2>/dev/null; then
    api_ok=true
    break
  fi
  attempts=$((attempts + 1))
  sleep 3
done

if $api_ok; then
  echo "  ✓ API healthy"
else
  echo "  ⚠ API health check failed after 18s — check: docker compose logs server"
fi

# Verify stream services
if docker compose $COMPOSE_FILES ps liquidsoap 2>/dev/null | grep -qi "running\|up"; then
  echo "  ✓ Liquidsoap running"
else
  echo "  ⚠ Liquidsoap is not running — check logs"
fi

if docker compose $COMPOSE_FILES ps icecast 2>/dev/null | grep -qi "running\|up"; then
  echo "  ✓ Icecast running"
else
  echo "  ⚠ Icecast is not running — check logs"
fi

# Verify nginx started (cert mount is the common failure point)
if docker compose $COMPOSE_FILES ps nginx 2>/dev/null | grep -qi "running\|up"; then
  echo "  ✓ Nginx running (SSL certs mounted OK)"
else
  echo "  ✗ Nginx failed to start — likely SSL cert mount issue"
  echo "    Debug: docker compose $COMPOSE_FILES logs nginx --tail=20"
fi
DEPLOY

################################################################################
# Step 6: Run DB migrations
################################################################################
step "Running database migrations..."
ssh "$REMOTE_HOST" bash <<'MIGRATE'
set -euo pipefail
cd /opt/duckfeed

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
if [ -f docker-compose.prod.local.yml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.local.yml"
fi

docker compose $COMPOSE_FILES exec -T server npx drizzle-kit migrate --config=drizzle.config.ts 2>&1
echo "  ✓ Migrations applied"
MIGRATE

################################################################################
# Step 7: Clean up old images
################################################################################
step "Cleaning up old Docker images..."
ssh "$REMOTE_HOST" "docker image prune -f 2>/dev/null | tail -1"

step "Validating the public stream..."
node "$REPO_ROOT/scripts/check-public-stream.mjs" --quick

fi # end DEPLOY_BACKEND

################################################################################
# Step 8: Deploy frontend
################################################################################
if $DEPLOY_FRONTEND; then

step "Deploying frontend to Cloudflare Pages..."
cd "$REPO_ROOT"
bash .private/front.sh

fi

################################################################################
# Done
################################################################################
echo ""
step "Deploy complete! ($DEPLOY_SHA)"
echo ""
echo "  Verify:"
if $DEPLOY_BACKEND; then
  echo "    API:    https://api.duckfeed.cmr.my/api/health"
  echo "    Stream: https://stream.duckfeed.cmr.my/stream"
fi
if $DEPLOY_FRONTEND; then
  echo "    Web:    https://duckfeed.cmr.my"
fi
echo ""
