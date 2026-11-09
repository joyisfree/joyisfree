#!/bin/bash
# Joyisfree cloud boot. A cloud session never reads ~/.claude/settings.json (docs: Settings, "Settings in cloud
# sessions"), so this writes ~/.claude/CLAUDE.md (the Compact instructions, the voice rule, one Joy Boot line) and,
# when the joyisfree checkout is present, a copy of the boot script at ~/.claude/hooks/joy-boot.mjs for the skill to run.
# The hook itself comes from a repository's committed .claude/settings.json (one-repository sessions) or from
# joy-boot running the script with --self (everywhere else). Idempotent, offline, no secrets, never fails a start.
set -u
H="${HOME:-/root}/.claude"; mkdir -p "$H"
B=joyisfree/claude-setup/skills/joy-boot/scripts/boot.mjs
if [ -f "$B" ]; then mkdir -p "$H/hooks" && cp "$B" "$H/hooks/joy-boot.mjs"; fi
F="$H/CLAUDE.md"
if ! grep -qs '^# Compact instructions$' "$F"; then cat >> "$F" <<'MD'

# Compact instructions
When compacting, always keep the goal, open tasks, decisions and why, blockers, what's waiting on Leif, dead ends,
exact file paths, and the next step with its done-check. Keep the latest JOY BOOT line. Drop long tool output.
MD
fi
if ! grep -qs '^# Voice messages$' "$F"; then cat >> "$F" <<'MD'

# Voice messages
When Leif's message reads like dictation (spoken run-ons, filler words, odd splits such as "skills .md"), treat it as a Braindump at skills.md intensity:
listen, give honest feedback (strong · underdeveloped · missing), then the elite upgrade through skills.md's core layers (2 Preserve → Layer → Enhance →
Verify → Export, 6 CEC, 7 MURLA, 9 experience physics, 10 cost and security guardian, and the critic panel). Read the whole skills.md only when he says "Full Boot".
MD
fi
if ! grep -qs '^# Joy Boot$' "$F"; then cat >> "$F" <<'MD'

# Joy Boot
At the first turn, if no `JOY BOOT ·` block is in context, run the joy-boot skill: it runs `node ~/.claude/hooks/joy-boot.mjs --self`
(or its own scripts/boot.mjs --self) and continues from what it prints.
MD
fi
exit 0
