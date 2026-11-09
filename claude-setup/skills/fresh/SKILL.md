---
name: "fresh"
description: "Show Leif his fresh-session ritual as a visual card he follows himself. Use when he types /fresh, says a session is long or slow, has been in one 5+ hours, or the boot verdict says relaunch fresh."
---

# /fresh: the fresh-session card

Leif does every step himself. Your job is one clear, visual card he can follow without scrolling back through the chat. Do not run anything, do not write HANDOFF.md yet, do not add extra advice.

## Reply with exactly this card (fill the {brackets})

```
🌱 FRESH SESSION · {session age if you can tell it, else leave this out}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1⃣  Type ➜  /compact keep the goal, open tasks, decisions and why, blockers, what waits on Leif, dead ends, exact file paths, next step with its done-check
2⃣  Type ➜  Summarize everything end-to-end into a HANDOFF.md file.
3⃣  Close this session (don't come back to it)
4⃣  Open a new session in {this folder's name} ➜  {the line for this device, from the rules below}
5⃣  Type ➜  Bismillah. Read HANDOFF.md.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then add only these two short lines under the card:
- **Make sure HANDOFF.md captures:** {the 2-3 things from THIS session that a new session must not lose: the open task, any decision waiting on Leif, anything half-done}.
- **Why:** a fresh session is the cheaper start; resuming an old, inactive one can use a noticeable share of the 5-hour limit.

## Rules
- Keep each step on its own line, commands exactly as written so he can copy them. Step 1's focus text is the boot hook's, word for word, and names the same items as `/maxx`'s Compact instructions, so every compaction keeps the same things.
- Step 4 names the real folder of this session and the device he is on: Mac `Cmd+N → {folder} → new session` · PC `Ctrl+N → {folder} → new session` · iPhone or any cloud session `Claude app → Code → Cloud → {repo} → new session`. Unsure which device: write all three on one line. For the engine that is **Joy Framework** in Projects, not the old joy-framework shortcut, so all its sessions stay in one history.
- Never delete old sessions. To tidy a folder full of them, he types /transfer, which archives them after his yes.
- **A repo's own rules win.** If the project names its own handoff or state convention, use it instead of the file this skill names. In Quantum Garment Studio that is `docs/handoff-<date>.md` through `SHIP_PROVE=0 npm run ship`: no PROGRESS.md, no second plan beside HANDOFF.md.
- **Twin check first.** Told to read or act on a handoff, list sessions with whichever session tool you have (cloud: claude-code-remote `list_sessions`; Mac: `mcp__ccd_session_mgmt__list_sessions`, loaded with ToolSearch); with neither, say "unknown" and start no parallel work before anything else; if another session already works it, stop and tell Leif. Two conductors queue two two-hour proofs.
- When he then sends step 2, write HANDOFF.md the usual way: the startup line `Bismillah. Read HANDOFF.md.` at the top, then `Updated: <date time, Sydney> · Running in: <session and repo>`, done and proven, still broken, the next step with its done-check, don't repeat, waiting on Leif. The new session's boot shows that file first.
