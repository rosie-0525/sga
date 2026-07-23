#!/usr/bin/env bash
# Sync per-volume viewer JSON from sga-data/<vol>/02-converted_html/data/ into data/<vol>/.
# Mirrors the source: files deleted or changed in sga-data are deleted/updated in data/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VOLUMES=(sga1 sga2 sga3 sga4 sga4.5 sga5 sga6 sga7)

for v in "${VOLUMES[@]}"; do
  src="$ROOT/sga-data/$v/02-converted_html/data/"
  dst="$ROOT/data/$v/"
  if [[ ! -d "$src" ]]; then
    echo "WARN: missing $src — skipped" >&2
    continue
  fi
  mkdir -p "$dst"
  rsync -a --delete "$src" "$dst"
  echo "$v: $(find "$dst" -type f | wc -l | tr -d ' ') files"
done
