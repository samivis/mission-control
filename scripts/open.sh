#!/bin/sh
# Open the Mission Control board. Uses a standalone app-style window when a Chromium
# browser is installed (Chrome, Brave, Arc, Edge), otherwise the default browser.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-$(node -e "import('$REPO/lib/paths.js').then(m=>console.log(m.readConfig().port))" 2>/dev/null || echo 3011)}"
URL="http://localhost:${PORT}"
PROFILE="${MISSION_CONTROL_DIR:-$HOME/.mission-control}/chrome-profile"
for APP in "Google Chrome" "Brave Browser" "Arc" "Microsoft Edge"; do
  if [ -d "/Applications/$APP.app" ]; then
    mkdir -p "$PROFILE"
    exec open -na "$APP" --args "--app=$URL" "--user-data-dir=$PROFILE" --no-first-run --no-default-browser-check
  fi
done
exec open "$URL"
