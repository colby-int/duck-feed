#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <backup-file>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "WARNING: This will replace the current database with the backup."
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo "Stopping API and worker..."
docker compose stop server ingest-worker

echo "Restoring from ${BACKUP_FILE}..."
docker compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER:-duckfeed}" \
  -d "${POSTGRES_DB:-duckfeed}" \
  --clean --if-exists \
  < "$BACKUP_FILE"

echo "Starting API and worker..."
docker compose start server ingest-worker

echo "Restore complete. Verify at /api/health"
