# `.claude/` — settings for this repo

`settings.suggested.json` holds optional rules that are **inert until you turn them on**:

```bash
cp .claude/settings.suggested.json .claude/settings.json
```

It is left off on purpose. The rules widen what a session may do without asking, and an agent
must not be able to widen its own permissions — the harness refuses to let a session write its own
active settings file, so this is yours to activate, never a session's. (Same boundary and pattern as
the studio repo `joyisfree1`.)

What switching it on does:

- **Stops prompting for the three read-only desk commands** — `npm test` (the proof gate),
  `npm run desk:status` (the ledger + kill rule), `npm run desk:check` (is the rulebook complete).
  The write/network commands (`desk:rank`, `desk:crawl`, `desk:ledger`, `desk:card`) are deliberately
  left out, so they still ask.
- **Keeps `.env` and its local variants out of the Read tool.** This repo's law is *No secrets, ever*
  (`CLAUDE.md`), so there should be nothing to read; the deny rule is defence in depth for Mac and
  cloud sessions alike. `.env.example` (names only) stays readable.

Nothing here runs a command at session start — no hook, by choice. A session already reads `CLAUDE.md`,
which points it at `galxe-desk/README.md` and `galxe-desk/docs/state.md`; adding a startup command would
only add cost for context a session picks up anyway.
