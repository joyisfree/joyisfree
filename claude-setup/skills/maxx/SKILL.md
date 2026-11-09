---
name: "maxx"
description: "Equip this computer's Claude Code once with Leif's universal settings, from a free audit of his sessions. Use when Leif types /maxx, sets up a computer or updates his universal settings. Not a resume."
---

# /maxx: equip this computer, the top-1% way

Run once per computer, then monthly or after a big Claude Code update. Change only `~/.claude/settings.json`, `~/.claude/CLAUDE.md` and `~/.claude/hooks/joy-boot.mjs`, after backing the first two up. Add what's missing; never remove or overwrite anything without Leif's yes; add no hooks beyond the one Joy Boot hook in the universal set. Never print secrets.

/maxx is monthly and per computer. The per-session prompt is /joyisfree, and a resumed session is joy-boot's job (its section 2b), fed by the hook this skill installs.

Why so few settings: no official or respected source recommends a standard set of environment variables. The best users keep setup small and rely on habits: a fresh session per task, a plan for anything bigger than one sentence, and a pass/fail check Claude can run (Claude Code docs, "Best practices").

The two scripts live in this skill's `scripts/` folder (the base directory is shown when the skill loads). If that folder is missing on this computer, the same files are in the joyisfree repo under `claude-setup/skills/maxx/scripts/`.

## Steps
1. Tell Leif in one line what you're doing.
2. Check `node -v` first: Node 22 or newer is needed for the audit, the check and the hook; if it is missing, say so and name the LTS installer from nodejs.org, then stop. Audit: run `node "<skill folder>/scripts/audit.mjs" 30`. Show him the table and its signals. It reads numbers only, never content, and uses no Claude usage. If `~/.claude/usage-data/report.html` (from /insights) is under 31 days old, also read its friction headings and add the top two.
3. Back up: copy `~/.claude/settings.json` to `~/.claude/settings.backup-<YYYY-MM-DD>.json`, and `~/.claude/CLAUDE.md` to `~/.claude/CLAUDE.backup-<YYYY-MM-DD>.md`, if they exist. No settings.json yet means no backup; `check.mjs` knows that case.
4. Compare the current files with the universal set below. Show one short table: already set · will add · leaving alone, each with a few words why. If `~/.claude/hooks/session-start.py` is already registered (Leif's Mac), it prints the state file and the unpushed count itself: install the Joy Boot hook with `--verdict-only` so nothing prints twice, and don't change that hook here.
5. Ask ONE question with the question tool: apply the additions? (recommended: yes) And turn prompt suggestions off? (a small saving)
6. Apply only what he approved, in one pass, merged into the existing `env` and `hooks` blocks (never a second `env` or `hooks` key), the way this computer's own rules allow. A settings gate may ask for the docs link: give https://code.claude.com/docs/en/env-vars or https://code.claude.com/docs/en/settings. Then run `node "<skill folder>/scripts/check.mjs" ~/.claude/settings.backup-<YYYY-MM-DD>.json ~/.claude/settings.json`. Anything but PASS: restore the backup at once and tell him.
7. Last, and alone, only if `permissions.defaultMode` is `bypassPermissions`, ask: "Switch new sessions to Auto mode? (recommended)". Give him these facts:
   - the docs say to use Bypass "only in isolated environments like containers or VMs";
   - his deny rules and safety hooks keep working in both modes;
   - Auto adds a check that stops risky actions and tricks planted in web pages or files, and pauses back to asking after 3 blocks in a row or 20 in total;
   - folders where he picked a mode in the app's mode picker keep that pick, so he switches those once by hand.

   On yes, set it, then run `check.mjs` again.
8. Prove the hook once: `node ~/.claude/hooks/joy-boot.mjs --dry '{"source":"startup"}'` from a project folder prints a `JOY BOOT ·` block for it.
9. Reply with: what changed; the top 3 audit signals, each with one thing to do; and "Done. New sessions pick this up; sessions already open need a restart."

## Universal set (checked against the official docs, 28 Oct and 8 Nov 2026)
Will add if missing:
- `~/.claude/CLAUDE.md`, two short sections. Every /compact, Leif's or automatic, then keeps what a handoff needs, and a dictated message gets the treatment Leif chose (8 Nov 2026):
  ```
  # Compact instructions
  When compacting, always keep the goal, open tasks, decisions and why, blockers, what's waiting on Leif, dead ends, exact file paths, and the next step with its done-check. Keep the latest JOY BOOT line. Drop long tool output.

  # Voice messages
  When Leif's message reads like dictation (spoken run-ons, filler words, odd splits such as "skills .md"), treat it as a Braindump at skills.md intensity: listen, give honest feedback (strong · underdeveloped · missing), then the elite upgrade through skills.md's core layers (2 Preserve → Layer → Enhance → Verify → Export, 6 CEC, 7 MURLA, 9 experience physics, 10 cost and security guardian, and the critic panel). Read the whole skills.md only when he says "Full Boot".
  ```
- **The Joy Boot hook** (Leif, 8 Nov 2026: every session boots itself). Copy `boot.mjs` from the joy-boot skill (`ls ~/.claude/skills/synced/*/joy-boot/scripts/boot.mjs`, else `claude-setup/skills/joy-boot/scripts/boot.mjs` in the joyisfree repo) to `~/.claude/hooks/joy-boot.mjs`, then add this entry to `hooks.SessionStart`, exactly as written (`check.mjs` accepts nothing else):
  ```json
  { "matcher": "startup|resume|clear|fork", "hooks": [ { "type": "command", "command": "[ -f ~/.claude/hooks/joy-boot.mjs ] && node ~/.claude/hooks/joy-boot.mjs 2>/dev/null || true", "timeout": 5 } ] }
  ```
  (put ` --verdict-only` after `joy-boot.mjs` in the command where `session-start.py` runs). In about a tenth of a second and with no Claude usage it prints where we are, what is unpushed, and on a resume or fork whether to continue, compact first or relaunch fresh. It never runs on the `compact` matcher: the new summary is already in context. This entry is for computers only: a cloud session never reads `~/.claude/settings.json` (docs, 8 Nov 2026); there the hook comes from a repository's committed `.claude/settings.json` (the joyisfree repo carries one) and the three CLAUDE.md sections (Compact instructions, Voice messages, Joy Boot) plus a copy of the boot script from the environment's setup script (`claude-setup/cloud/setup.sh`).
- env `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: "1"`: after each command, Claude returns to the project folder, so nothing runs in the wrong folder.
- env `BASH_DEFAULT_TIMEOUT_MS: "300000"` (5 minutes; the default is 2), only if the audit shows 3 or more timeouts and they were builds or tests. A dev server that never ends belongs in the background instead.

Ask: `promptSuggestionEnabled: false` (step 5) and `permissions.defaultMode: "auto"` (step 7).

Leave alone if present: `CLAUDE_CODE_SUBAGENT_MODEL` (helpers on Sonnet), the auto-compact window, deny rules, safety hooks, Remote Control. Leave `idleCompaction` on (never set it `false`): since Claude Code 2.1.290 an idle session past about 200K tokens is compacted by itself before the cache expires, which is compact-all's job done for free.

Don't add:
- a hook that re-shows HANDOFF.md after a compact: /compact also triggers it, so an old note would load just before the new one is written, and the Compact instructions already keep what matters;
- a status line: it shows only in the terminal, and the app's Context card already shows how full a session is;
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: users reported it ignored in some versions, and the auto-compact window already does the job;
- switches that turn off updates or error reports: no gain, and they lose fixes;
- `cleanupPeriodDays`: desktop app sessions are already kept at any age.

## Scripts (in `scripts/`, run as files, never retyped)
- `audit.mjs [days=30]`: measures every session on this computer from `~/.claude/projects/*/*.jsonl`, read-only, numbers only.
- `check.mjs <backup.json> <settings.json>`: proves a settings change kept every guardrail. The only hook change it allows is the Joy Boot SessionStart entry, exactly as above (plain or `--verdict-only`); any other hook change, lost rule or lost setting is FAIL. A missing backup is read as "settings.json did not exist before". `check.test.mjs` shows each verdict.
