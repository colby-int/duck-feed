#!/bin/sh
# Substitute env vars into icecast.xml at container start.
# Icecast does not support env var interpolation natively, so we template here.

set -eu

: "${ICECAST_SOURCE_PASSWORD:?ICECAST_SOURCE_PASSWORD is required}"
: "${ICECAST_ADMIN_PASSWORD:?ICECAST_ADMIN_PASSWORD is required}"
ICECAST_HOSTNAME="${ICECAST_HOSTNAME:-localhost}"

TEMPLATE=/etc/icecast/icecast.xml.template
OUTPUT=/etc/icecast/icecast.xml

sed \
  -e "s|\${ICECAST_SOURCE_PASSWORD}|${ICECAST_SOURCE_PASSWORD}|g" \
  -e "s|\${ICECAST_ADMIN_PASSWORD}|${ICECAST_ADMIN_PASSWORD}|g" \
  -e "s|\${ICECAST_HOSTNAME}|${ICECAST_HOSTNAME}|g" \
  "$TEMPLATE" > "$OUTPUT"

chown icecast:icecast "$OUTPUT"

exec su icecast -s /bin/sh -c "icecast -c \"$OUTPUT\""
