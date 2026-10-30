#!/bin/sh
# Mission Control hook. Claude Code pipes the hook payload (JSON) on stdin.
# Appends one JSON line to ~/.mission-control/events.jsonl and exits 0 immediately.
# FAIL-OPEN: nothing here may ever block or fail a Claude Code session.
EVENT="$1"
DIR="${MISSION_CONTROL_DIR:-$HOME/.mission-control}"
mkdir -p "$DIR" 2>/dev/null || exit 0
PAYLOAD=$(cat 2>/dev/null)
TS=$(date +%s)000
node -e '
const [event, ts, raw] = process.argv.slice(1);
let p = {}; try { p = JSON.parse(raw || "{}"); } catch {}
const out = { ts: Number(ts), event, session_id: p.session_id || p.sessionId || null, cwd: p.cwd || null };
if (p.notification_type) out.notification_type = p.notification_type;
if (p.message) out.message = String(p.message).slice(0, 300);
if (p.tool_name) out.tool_name = p.tool_name;
if (p.reason) out.reason = p.reason;
process.stdout.write(JSON.stringify(out) + "\n");
' "$EVENT" "$TS" "$PAYLOAD" >> "$DIR/events.jsonl" 2>/dev/null || true
exit 0
