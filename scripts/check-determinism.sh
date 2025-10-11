#!/usr/bin/env bash
set -euo pipefail

echo "[determinism] First build pass" >&2
npm run build >/dev/null 2>&1

SNAP1_FILE=".determinism-snapshot-1.txt"
SNAP2_FILE=".determinism-snapshot-2.txt"

find dist -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum > "$SNAP1_FILE" || true

echo "[determinism] Second build pass" >&2
npm run build >/dev/null 2>&1
find dist -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum > "$SNAP2_FILE" || true

if diff -u "$SNAP1_FILE" "$SNAP2_FILE" > .determinism-diff.txt; then
  echo "Determinism check: PASS"
  rm -f "$SNAP1_FILE" "$SNAP2_FILE"
  exit 0
else
  echo "Determinism check: FAIL (see .determinism-diff.txt)" >&2
  exit 1
fi
