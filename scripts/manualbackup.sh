#!/usr/bin/env bash
set -euo pipefail

TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINATION="$ROOT/backups/$TIMESTAMP-manual"

mkdir -p "$DESTINATION"

cp "$ROOT/config/config.yaml" "$DESTINATION/"
cp "$ROOT/db/sync.db" "$DESTINATION/"

(cd "$DESTINATION" && zip -r -q "$DESTINATION.zip" .)
rm -rf "$DESTINATION"

echo "Backup completed. Files saved to: $DESTINATION"
