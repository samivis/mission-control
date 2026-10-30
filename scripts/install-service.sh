#!/bin/sh
# Keep Mission Control always running on this Mac (launchd), and put the board on screen at login.
#   npm run install-service      install + start both agents
#   npm run uninstall-service    stop + remove both agents
# Server agent:  ai.mission-control.server  (RunAtLoad + KeepAlive; restarts if it dies)
# Window agent:  ai.mission-control.window  (RunAtLoad; waits for the server, then opens the board once)
# Both run with HOME as their working directory: launchd jobs are not always allowed into ~/Desktop or ~/Documents.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
MC_DIR="${MISSION_CONTROL_DIR:-$HOME/.mission-control}"
AGENTS="$HOME/Library/LaunchAgents"
SERVER_LABEL="ai.mission-control.server"
WINDOW_LABEL="ai.mission-control.window"
SERVER_PLIST="$AGENTS/$SERVER_LABEL.plist"
WINDOW_PLIST="$AGENTS/$WINDOW_LABEL.plist"
UID_NUM="$(id -u)"
PORT="${PORT:-3011}"

unload() {
  launchctl bootout "gui/$UID_NUM/$1" >/dev/null 2>&1 || launchctl unload "$AGENTS/$1.plist" >/dev/null 2>&1 || true
}

if [ "$1" = "--uninstall" ]; then
  unload "$SERVER_LABEL"; unload "$WINDOW_LABEL"
  rm -f "$SERVER_PLIST" "$WINDOW_PLIST"
  echo "Removed $SERVER_LABEL and $WINDOW_LABEL. Mission Control will no longer start on login."
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || { echo "launchd setup is macOS-only."; exit 1; }
[ -n "$NODE" ] || { echo "node not found on PATH"; exit 1; }
mkdir -p "$AGENTS" "$MC_DIR"
# launchd jobs are often denied access to ~/Desktop and ~/Documents (macOS privacy protection),
# so the window agent runs a copy of open.sh from the data dir instead of the repo.
cp "$REPO/scripts/open.sh" "$MC_DIR/open.sh" && chmod +x "$MC_DIR/open.sh"

# A plain `npm start` from a terminal would fight the agent for the port. Stop it first.
for PID in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do kill "$PID" 2>/dev/null || true; done
unload "$SERVER_LABEL"; unload "$WINDOW_LABEL"

cat > "$SERVER_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$SERVER_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$REPO/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$MC_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$MC_DIR/server.log</string>
</dict></plist>
PLIST

cat > "$WINDOW_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$WINDOW_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>for i in \$(seq 1 60); do curl -sf http://localhost:$PORT/api/board >/dev/null &amp;&amp; break; sleep 1; done; exec sh "$MC_DIR/open.sh"</string>
  </array>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$MC_DIR/window.log</string>
  <key>StandardErrorPath</key><string>$MC_DIR/window.log</string>
</dict></plist>
PLIST

launchctl bootstrap "gui/$UID_NUM" "$SERVER_PLIST" 2>/dev/null || launchctl load "$SERVER_PLIST"
# Loading the window agent now also opens the board once (RunAtLoad). Skip with MC_NO_OPEN=1.
if [ -z "$MC_NO_OPEN" ]; then
  launchctl bootstrap "gui/$UID_NUM" "$WINDOW_PLIST" 2>/dev/null || launchctl load "$WINDOW_PLIST"
else
  echo "(window agent written; it will load at next login)"
fi

for i in $(seq 1 20); do curl -sf "http://localhost:$PORT/api/board" >/dev/null && break; sleep 0.5; done
if curl -sf "http://localhost:$PORT/api/board" >/dev/null; then
  echo "Mission Control is running at http://localhost:$PORT and will start on every login."
else
  echo "Service installed but the server is not answering yet. Check $MC_DIR/server.log"; exit 1
fi
