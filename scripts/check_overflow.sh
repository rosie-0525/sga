#!/usr/bin/env bash
# Serve the repo root and run scripts/check_overflow.js against the root viewer
# pages (sga1.html … sga7.html) in headless Chrome.
#
#   scripts/check_overflow.sh [baseline|verify] [vols-csv] [pages-csv]
#
# Examples:
#   scripts/check_overflow.sh baseline
#   scripts/check_overflow.sh baseline sga5
#   scripts/check_overflow.sh verify  sga5 I-1,I-2
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:-baseline}"
VOLS="${2:-}"
PAGES="${3:-}"

if [ ! -f "$ROOT/viewer/vendor/mathjax/tex-svg-full.js" ]; then
  echo "error: $ROOT/viewer/vendor/mathjax/ is missing" >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || { echo "error: node is required" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "error: python3 is required (static file server)" >&2; exit 2; }

# Puppeteer: reuse an existing install from the sga-data check skills when
# present (same Chromium cache), otherwise install locally in scripts/.
PUPPETEER_MODULES=""
for cand in \
  "$SCRIPT_DIR/node_modules" \
  "$ROOT/sga-data/sga1/.claude/skills/sga1-check-errors/node_modules" \
  "$ROOT/sga-data/sga2/.claude/skills/sga2-check-errors/node_modules" \
  "$ROOT/sga-data/sga3/.claude/skills/sga3-check-errors/node_modules"; do
  if [ -d "$cand/puppeteer" ]; then PUPPETEER_MODULES="$cand"; break; fi
done
if [ -z "$PUPPETEER_MODULES" ]; then
  echo "installing puppeteer (one-time, ~150 MB) ..." >&2
  (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund) || { echo "error: npm install failed" >&2; exit 2; }
  PUPPETEER_MODULES="$SCRIPT_DIR/node_modules"
fi

# Ensure the bundled Chrome build is actually present and not partially
# extracted. puppeteer-browsers' installer can silently produce a directory
# missing Contents/Frameworks on macOS+arm64, then claim success. Detect that
# and repair with the system `unzip`, which handles the .app symlinks.
chrome_rev() {
  node -e "console.log(require('$PUPPETEER_MODULES/puppeteer-core/lib/cjs/puppeteer/revisions.js').PUPPETEER_REVISIONS.chrome)"
}
REV="$(chrome_rev)"

(cd "$(dirname "$PUPPETEER_MODULES")" && npx --no-install puppeteer browsers install chrome >/dev/null 2>&1) || true

case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) PLAT='mac_arm'; ZIP_SUFFIX='mac-arm64'; APP_REL="chrome-mac-arm64/Google Chrome for Testing.app" ;;
  Darwin/x86_64) PLAT='mac'; ZIP_SUFFIX='mac-x64'; APP_REL="chrome-mac-x64/Google Chrome for Testing.app" ;;
  Linux/x86_64) PLAT='linux'; ZIP_SUFFIX='linux64'; APP_REL='' ;;
  *) PLAT=''; ZIP_SUFFIX=''; APP_REL='' ;;
esac

if [ -n "$APP_REL" ]; then
  CHROME_DIR="$HOME/.cache/puppeteer/chrome/${PLAT}-${REV}"
  NEEDED="${CHROME_DIR}/${APP_REL}/Contents/Frameworks"
  if [ ! -d "$NEEDED" ]; then
    echo "puppeteer's Chrome install is incomplete — repairing with system unzip ..." >&2
    rm -rf "$CHROME_DIR"
    mkdir -p "$CHROME_DIR"
    TMP_ZIP="$(mktemp -t puppeteer-chrome.XXXXXX.zip)"
    URL="https://storage.googleapis.com/chrome-for-testing-public/${REV}/${ZIP_SUFFIX}/chrome-${ZIP_SUFFIX}.zip"
    curl -fSL "$URL" -o "$TMP_ZIP" || { echo "error: failed to download $URL" >&2; rm -f "$TMP_ZIP"; exit 2; }
    (cd "$CHROME_DIR" && unzip -q "$TMP_ZIP") || { echo "error: unzip failed" >&2; rm -f "$TMP_ZIP"; exit 2; }
    rm -f "$TMP_ZIP"
  fi
fi

# Pick an unused localhost port.
PORT=""
for p in 8765 8766 8767 8768 8769 9123 9456; do
  if ! (echo > "/dev/tcp/127.0.0.1/$p") >/dev/null 2>&1; then
    PORT=$p
    break
  fi
done
PORT="${PORT:-8765}"

(cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  if (echo > "/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

set -- --base "http://localhost:$PORT" --mode "$MODE"
[ -n "$VOLS" ] && set -- "$@" --vols "$VOLS"
[ -n "$PAGES" ] && set -- "$@" --pages "$PAGES"

NODE_PATH="$PUPPETEER_MODULES" node "$SCRIPT_DIR/check_overflow.js" "$@"
rc=$?

exit $rc
