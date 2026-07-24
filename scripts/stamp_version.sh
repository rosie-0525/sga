#!/usr/bin/env bash
# Stamp a content-hash cache-busting version (?v=XXXXXXXX) onto the viewer asset
# references (viewer.css, viewer-bootstrap.js, viewer.js, comments.js) in the
# volume pages and paper.template.html.
#
# Why: GitHub Pages serves everything with cache-control: max-age=600 and gives
# no header control, so a changed-but-same-URL viewer.js/css can be served stale
# (or mixed old/new) by returning browsers. A content-derived query string gives
# every viewer change a fresh URL; the stamp is also propagated to the runtime
# config/manifest/chapter JSON fetches (see viewer-bootstrap.js / fetchJSON).
#
# Idempotent: the stamp is a hash of the four assets, so re-running rewrites the
# pages only when an asset actually changed. Run after any viewer/*.js|css edit —
# or let the pre-commit hook do it (recreate on a fresh clone):
#
#   cat > .git/hooks/pre-commit <<'EOF'
#   #!/bin/sh
#   if git diff --cached --name-only | grep -qE '^viewer/(viewer|viewer-bootstrap|comments)\.(js|css)$'; then
#     scripts/stamp_version.sh || exit 1
#     git add sga1.html sga2.html sga3.html sga4.html sga4.5.html sga5.html sga6.html sga7.html viewer/paper.template.html
#   fi
#   EOF
#   chmod +x .git/hooks/pre-commit
set -euo pipefail
cd "$(dirname "$0")/.."

ASSETS=(viewer/viewer.css viewer/viewer-bootstrap.js viewer/viewer.js viewer/comments.js)
PAGES=(sga1.html sga2.html sga3.html sga4.html sga4.5.html sga5.html sga6.html sga7.html
       viewer/paper.template.html)

STAMP=$(cat "${ASSETS[@]}" | shasum | cut -c1-8)

changed=0
for p in "${PAGES[@]}"; do
  before=$(shasum "$p")
  # Match the asset filename anchored to the closing attribute quote (any mount
  # prefix — root pages use viewer/, the template translation-viewer/), adding
  # or replacing a ?v=... stamp.
  sed -i '' -E \
    "s~(viewer-bootstrap\.js|viewer\.js|viewer\.css|comments\.js)(\?v=[0-9a-f]+)?\"~\1?v=${STAMP}\"~g" \
    "$p"
  if [ "$before" != "$(shasum "$p")" ]; then
    echo "stamped $p (v=$STAMP)"
    changed=1
  fi
done
[ "$changed" -eq 0 ] && echo "already up to date (v=$STAMP)"
exit 0
