# Mission Control — how to run it

Your local board for every Claude Code session on this Mac. One page: which sessions are
waiting on you, which are working, which finished, which terminals were closed. Click a
card to read the transcript and jump to its window. Local only, no login, no cloud.

## Start

```bash
cd ~/Desktop/mission-control-v2
npm start            # → http://localhost:3011
```

No build step and no dependencies. Node 22 is already installed. Keep it running in a
spare terminal tab (or `nohup npm start >/dev/null 2>&1 &`).

Config lives in `~/.mission-control/config.json` (created on first start):

| key | default | meaning |
|---|---|---|
| `port` | 3011 | the old CloudCLI fork used 3010, so this stays out of its way |
| `skipPermissions` | true | Resume / New session launch `claude --dangerously-skip-permissions` (your usual mode). Set false for normal prompts |
| `autoArchiveDays` | 7 | idle/ended sessions drop off the Active tab after this many days. Never for live sessions. Nothing is deleted |
| `pollMs` | 3000 | how often `claude agents --json` is polled |

## Where status comes from

- **Live sessions and busy/idle**: `claude agents --json`, which lists every running Claude
  Code process including ones started by hand in a terminal, with pid, cwd and session id.
  Several pids on one session id = several terminal windows attached to it (the card shows
  an "N windows" chip).
- **Waiting on you**: Claude Code hooks (see below). A permission prompt or a session that
  ended its turn on a question goes to the Waiting lane. Without hooks, the board falls
  back to reading the transcript tail (question mark / tool call with no result).
- **Names, last message, transcript**: read directly from `~/.claude/projects/**/*.jsonl`.
  Mission Control never writes into `~/.claude/projects`.
- **Archive and custom names**: `~/.mission-control/meta.json`.

## Hooks (one-time)

```bash
npm run install-hooks
```

This backs up `~/.claude/settings.json` to `~/.claude/settings.json.bak-<timestamp>` and
adds one async hook entry each for `SessionStart`, `SessionEnd`, `UserPromptSubmit`,
`Stop`, `Notification` and `PermissionRequest`, all pointing at `hooks/mc-hook.sh`. The
hook appends one JSON line to `~/.mission-control/events.jsonl` and exits 0 in a few
milliseconds. It never blocks or fails a session. Existing hooks (the gstack Stop hook) are
kept.

Hooks only apply to sessions started after they were installed. Sessions already open keep
working on the transcript fallback until you restart them.

To remove: `npm run uninstall-hooks` (removes only the Mission Control entries, backs up
first).

## Actions on a card

- **Focus window**: finds the terminal tab that owns the session (pid → tty → Terminal.app
  or iTerm2) and brings it to the front. It never opens a second window for a live session.
- **Resume in Terminal** (shown when no process is attached): opens one new Terminal window
  with `claude --resume <id>` in the session's folder.
- **Rename**, **Archive** / **Reopen**.
- **+ New session**: folder, name, first prompt → one new Terminal window running `claude`
  there with that prompt. The name is attached to the new session id.

## v2 (not built yet)

Reply from the drawer, and Slack away mode (ping when waiting, reply from Slack). Both sit
on the same hook stream.

## Tests

```bash
npm test
```
