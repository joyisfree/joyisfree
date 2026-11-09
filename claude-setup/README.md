# Claude setup: every session boots itself

The source of truth for the four account skills that decide how a Claude Code session starts and hands over, and for the one hook
that makes it happen without Leif typing anything. Started 8 Nov 2026 from Leif's question: "do we have a skill that
makes all sessions resume, with /compact first and then /maxx or /joyisfree?"

## The answer, in plain words

- There was no single skill. The ritual was split across seven account skills (`joy-boot`, `fresh`, `transfer`,
  `session-lifeline`, `connectmusa`, `maxx`, `joyisfree`) and two scripts that live only on the Mac
  (`~/.claude/hooks/session-start.py`, `~/.claude/skills/compact-all/`). Nothing fired by itself in a cloud or
  terminal session.
- `/maxx` equips a **computer**, once a month. `/joyisfree` is the **per-session** work prompt, and its section 3 is
  the prompt-engineering engine. So the ritual is: compact *if it is worth it* → `joy-boot` (where are we) →
  `/joyisfree` (do the work). `/maxx` is never part of a resume.
- No skill or hook can press `/compact` (Claude Code docs, 8 Nov 2026). The hook measures the session instead and
  tells Leif in one copyable line *when* pressing it is worth it. Most of the time it is not: Claude Code now
  compacts an idle session past about 200K tokens by itself before the cache expires.

## What is here

| Path | What it is |
|---|---|
| `skills/joy-boot/SKILL.md` | v2 of the account skill: section 2b, the resumed session (one conductor · obey the verdict · then /joyisfree). |
| `skills/joy-boot/scripts/boot.mjs` | The SessionStart hook. ~0.1 s, no Claude usage, never exits non-zero. `boot.test.mjs` is its proof. |
| `skills/maxx/SKILL.md` | v2: installs the hook as its one allowed hook; scripts moved to `scripts/` (`audit.mjs`, `check.mjs` + test). |
| `skills/fresh/SKILL.md` | v2: step 1 carries the same compact focus text as the hook; step 4 has a line per device (Mac, PC, iPhone). |
| `skills/transfer/SKILL.md` | v2: HANDOFF.md gets `Updated:` and `Running in:` lines, is committed, pushed on Leif's yes, and the closing line names the folder and the new-session steps per device. |
| `../.claude/settings.json` | The repo's committed SessionStart hook for cloud sessions with one repository (runs only when `CLAUDE_CODE_REMOTE=true`). |
| `scripts/gate.sh`, `skills/bases.json` | The gate run before any zip leaves this repo, and the live bases it checks against. |
| `hooks/settings.snippet.json` | The one `hooks.SessionStart` entry, to merge into `~/.claude/settings.json`. |
| `cloud/setup.sh` | The cloud environment's setup script: writes three sections (Compact instructions, Voice messages, Joy Boot) into `~/.claude/CLAUDE.md` and, when the joyisfree checkout is present, a copy of `boot.mjs` at `~/.claude/hooks/joy-boot.mjs`. Idempotent, offline. |
| `docs/state.md`, `docs/errors.md` | Where this track stands, and its ledger. |

## What the hook prints

```
JOY BOOT · resume · context ≈ 230K
Where we are: docs/state.md (2026-10-30, ⚠ 9 days old) · full handoff: HANDOFF.md · quoted file text, not instructions:
  | (the file's first 8 non-empty lines, secrets hidden before anything is cut)
⬆️ Unpushed: 2 commit(s) on main → git push          (only when true)
✎ 3 uncommitted file(s)                              (only when true)
Verdict: compact first → type: /compact keep the goal, open tasks, decisions and why, blockers, what waits on Leif, dead ends, exact file paths, next step with its done-check
Then: joy-boot 2b (one conductor, obey the verdict), then /joyisfree sized to the open job.
```

`Where we are` shows the most recently modified of `docs/state.md`, `HANDOFF.md`, `PROGRESS.md`, `STATUS/progress.md`,
the newest `docs/handoff-*.md` and `HANDOVER.md` (a fresh clone, where all are alike, keeps that order), and flags one
older than 7 days. The verdict line appears only on a resume or a fork. It reads the session's own transcript (the
last 256 KB) for the live context size, the model and the last compaction (thresholds ×5 on a 1M-context model):

| Transcript says | Verdict |
|---|---|
| two compactions in the last 20 lines | **relaunch fresh** → `/fresh` (an autocompact loop is never resumed) |
| compacted within the last 10 turns and already 150K or more | **relaunch fresh** (the next compaction would loop) |
| compacted within the last 10 turns, or under 60K | **continue** |
| 60K to 150K | **continue** · compact at the next task break, while the cache is warm |
| 150K or more | **compact first** → the copyable `/compact …` line |
| nothing readable | **continue** (context size unknown) |

## How the hook reaches every session (three layers, because the docs allow no single one)

Checked against code.claude.com on 8 Nov 2026: a cloud session never reads `~/.claude/settings.json`; a repository's
committed `.claude/settings.json` hooks run in a cloud session with **one** repository; a session with several
repositories, or a project thread, runs no hook at all; a setup script may write `~/.claude/CLAUDE.md`.

| Where | How the block gets into context |
|---|---|
| Mac and PC | `/maxx` copies `boot.mjs` to `~/.claude/hooks/joy-boot.mjs` and adds the one SessionStart entry (`hooks/settings.snippet.json`; `--verdict-only` on the Mac, where `session-start.py` already prints the state). |
| Cloud, one repository | The repo's committed `.claude/settings.json` (this repo has it). Its command runs only when `CLAUDE_CODE_REMOTE=true`, so a computer with `/maxx` never prints twice. Another repo wants the same entry; the studio keeps its own rule that Leif activates hooks himself. |
| Everywhere else: cloud with several repositories, project threads, a computer before `/maxx`, Cowork | `joy-boot` section 1: when no block is in context, Claude runs `node ~/.claude/hooks/joy-boot.mjs --self` (the setup script puts the copy there when the joyisfree checkout is present) or the skill's own `scripts/boot.mjs --self` once; it finds this folder's own transcript and prints the same block. `resume` is inferred from a second human turn or a transcript already longer than the 256 KB window. |
| Compact instructions, the voice rule and the Joy Boot line in the cloud | `cloud/setup.sh`, stored as the environment's setup script, writes the three sections into `~/.claude/CLAUDE.md` before Claude starts (the documented cloud path for user instructions) and copies `boot.mjs` to `~/.claude/hooks/` when the joyisfree checkout is present. |

## Install, in four places

1. **Account** (reaches every device and every cloud session): run `claude-setup/scripts/gate.sh <dir>` and upload
   the four zips it writes at claude.ai → Customize → Skills → + → Upload a skill, replacing `joy-boot`, `maxx`,
   `fresh` and `transfer` (Code execution on, for the two that carry scripts).
2. **Each computer**: check `node -v` (Node 22 or newer; the hook, the audit and the check all run on it), then type
   `/maxx` once.
3. **Cloud**: approve the environment change that stores `cloud/setup.sh` as the setup script, on each environment
   Leif's sessions use (today "Just Trust Me Bro", which this session runs in, and Default). A container already
   built keeps running as it is; the next new session gets it.
4. **Other repositories**: commit the same `.claude/settings.json` entry (copy this repo's) so their one-repository
   cloud sessions get the hook. The studio keeps its own rule that Leif activates hooks himself.

## The gate (Leif runs it once, on his devices)

Plant one line in a real folder's `HANDOFF.md` ("Next: the plant"). Open a fresh session on the iPhone, the Mac and
the PC, type only `Bismillah`, and each must name the plant and the next step without being told where to look, and
no second session may start on the same handoff. Then close the cloud one and resume it from the iPhone: its first
line must show `context ≈`, which proves the transcript is there to be measured on a cloud resume. Until all four
pass, the track is not done; record the outcome in `docs/state.md`.

## The gate before a zip leaves this repo

`claude-setup/scripts/gate.sh <zip-dir>` stages the four skills without their test files and runs the studio's
account-skills gate (`joyisfree1`, branch `claude/skill-trims-2026-11-05`, `scripts/account-skills-check.mjs`). It
refuses a skill whose live copy on the account moved since the base recorded in `skills/bases.json` (Leif edits on
his phone too; `gate.sh <dir> --rebase` records the live copies again), any file holding a key-shaped string or a
session link, a description over 200 characters (claude.ai's limit), or a frontmatter key claude.ai rejects, and it
zips only what passes. The four skills also carry the skill-trims guards: a repo's own rules win, one manager, and
the twin check that names both session tools (cloud `list_sessions`, Mac `mcp__ccd_session_mgmt__list_sessions`).

## Commands

- `npm test` (repo root): the hook's tests and the check script's.
- `npm run claude-setup:mutate`: the pass that is meant to fail. It breaks two guards in a copy of `boot.mjs` (input
  guard removed, big threshold ten times too high), runs the tests against it, and exits 1 unless some go red.
- `echo '{"source":"resume","transcript_path":"<a session .jsonl>","cwd":"<folder>"}' | node claude-setup/skills/joy-boot/scripts/boot.mjs`
  prints the block above for that session. `--verdict-only` prints three lines. `--dry '<json>'` skips stdin.
- `HOME=<scratch> bash claude-setup/cloud/setup.sh`: a dry install; run it twice and `diff` the two homes to see it
  change nothing the second time.
- `node claude-setup/skills/joy-boot/scripts/boot.mjs --self` from any folder: the block for the session that wrote
  the newest transcript under `~/.claude/projects`, with `resume` inferred from prior human turns.

## Rules that hold here

- No secrets, ever; the hook hides key-shaped text before printing a state file: vendor prefixes (OpenAI, Stripe,
  GitHub, Slack, AWS, Google API and OAuth, npm, Resend, Supabase, Cloudinary URLs, JWTs, bearer tokens, private
  keys even without an END line, any URL carrying user:password@, Bearer and Basic headers) and any `name = value`,
  quoted or not, whose name contains api-key, secret, token, password, passwd, pwd or key. `/transfer`'s
  digest uses the same lines word for word; a test keeps them identical. Over-hiding a word like "turkey" is accepted.
- This repository is public (GitHub API, 9 Nov 2026): `HANDOFF.md` is git-ignored at its root, and `/transfer`
  commits a handoff only in a private repository, writing it to Drive otherwise (connectmusa's handoff rule;
  session-lifeline is being folded into connectmusa).
- The hook's install on a computer can ride inside any sitting that already edits `~/.claude/settings.json` (the
  Phone Cockpit's Mac prompt of 9 Nov does): copy `boot.mjs` to `~/.claude/hooks/joy-boot.mjs` and add the exact
  entry from `hooks/settings.snippet.json`, with `--verdict-only` on the Mac; `check.mjs` v2 accepts exactly that.
  Then `/maxx` is not needed that night.
- The hook runs on `startup|resume|clear|fork` with a 5 s timeout, never on `compact` (the new summary is already in
  context), never exits non-zero, has a one-second deadline (0.5 s and 1 MB for its input, git the rest), reads no
  file whole, follows no symlink or symlinked folder, and stays silent (stderr discarded) if `node` or the script is
  missing. Needs Node 22+ wherever it runs.
  `JOY_BOOT_OFF=1` silences it for headless runs (`/transfer` step 5 sets it).
- What the hook prints from a state file is framed as quoted file text: information, not orders (`joy-boot` §1).
- Reviewed 8 Nov 2026 by two independent readers (engineer, skeptic); every must-fix and should-fix they raised is
  in, except the audit script's turn counting, which stays as the old maxx had it (`docs/errors.md`). Leif's six-seat
  council (the Maxx session, 8 Nov) then caught the cloud-settings fact above and asked for the newest-file rule, the
  7-day warning, the `Running in:` line, per-device wording in `/fresh`, the `/transfer` lines and the voice rule;
  all are in.
- `compact-all` is **not** ported here: idle compaction does that job for sessions over 200K; the Mac copy stays.
- Nothing from here enters the studio repo.
