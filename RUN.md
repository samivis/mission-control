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

## Lanes (what each one means)

| Lane | Internal key | Meaning |
|---|---|---|
| **Waiting on you** | `waiting` | needs an answer or a permission approval. From a hook (permission prompt / idle notification) plus a read of the last message |
| **Working** | `working` | the agent is running (`claude agents` says busy) |
| **Finished** | `done` | turn complete · window still open. The agent reported and stopped; nothing was asked of you |
| **Closed** | `ended` | terminal closed · resume anytime. No process attached; the transcript is on disk and Resume continues it |
| **Archived** | — | off the Active tab (manual, or auto after 7 idle/closed days). Reopen anytime |

The UI labels are Finished/Closed; the API, `meta.json`, `rules.json` and tests keep `done`/`ended`.

### Drag a card to fix the board

Drag any card onto another lane header (or onto the **Archived** tab), or use **Move ▾** on
the card. The card is pinned there and shows a `moved by you ✕` chip (✕ = back to automatic).
The pin lasts until that session takes its next turn, then automatic status resumes.
Working and Closed are display-only pins: a dead process is never shown as Working and a
live one never as Closed.

### The board learns from your moves

Every move between **Waiting on you** and **Finished** is a correction. It is appended to
`~/.mission-control/corrections.jsonl` with the message that was judged. After every 3 new
corrections (or on **Rules → Learn now**, or `npm run learn`) a headless Claude call reads
the current phrase lists plus the new corrections and returns updated lists. The exact call:

```bash
printf '%s' "$PROMPT" | claude -p --output-format json --no-session-persistence --tools ""
```

(run with the `CLAUDECODE` / `CLAUDE_CODE_*` env vars stripped so it works from inside a
Claude session; about 25 s; no tools, no saved transcript.) The reply is validated (arrays
of lowercase 2-6 word phrases, max 60 each) before anything is written; invalid output is
logged as "skipped" and the rules are untouched. Every write first backs up
`~/.mission-control/rules.json` to `rules.json.bak-<ts>`; **Rules → Revert last learning**
restores it. Applied changes and their reasons land in `~/.mission-control/learning-log.jsonl`
and show in the Rules popover.

What the rules are: fixed base rules (message ends with `?` → waiting; `?` in the last
paragraph → waiting) plus two tunable phrase lists matched against the last paragraph of the
final message: `askPhrases` (→ waiting) and `reportPhrases` (→ finished, even with a `?`
inside the paragraph). Edit them by hand in the Rules popover or in `rules.json`.

## Actions on a card

- **Focus window**: finds the terminal tab that owns the session (pid → tty → Terminal.app
  or iTerm2) and brings it to the front. It never opens a second window for a live session.
- **Resume** (shown on Closed cards): opens one new Terminal window
  with `claude --resume <id>` in the session's folder.
- **Rename**, **Archive** / **Reopen**, **Move ▾** (see Lanes).
- **+ New session**: folder, name, first prompt → one new Terminal window running `claude`
  there with that prompt. The name is attached to the new session id.

## v2 (not built yet)

Reply from the drawer, and Slack away mode (ping when waiting, reply from Slack). Both sit
on the same hook stream.

## Tests

```bash
npm test
```
