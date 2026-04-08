#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/duckfeed_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "Backing up database to ${BACKUP_FILE}..."
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-duckfeed}" \
  -d "${POSTGRES_DB:-duckfeed}" \
  --format=custom \
  > "$BACKUP_FILE"

echo "Backup complete: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

# Clean up backups older than 30 days
find "$BACKUP_DIR" -name "duckfeed_*.dump" -mtime +30 -delete 2>/dev/null || true
echo "Cleaned up backups older than 30 days."
