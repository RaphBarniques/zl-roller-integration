#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

git -C "$ROOT" -c "safe.directory=$ROOT" pull --ff-only

echo "Update completed. Repository is up to date."
