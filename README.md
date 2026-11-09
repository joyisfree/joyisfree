# Joyisfree

Tracks that live outside the studio app (`joyisfree/joyisfree1`). Each track has its own folder, its own `docs/state.md`
and its own ledger, and none of them touches the studio.

- [`galxe-desk/`](./galxe-desk/README.md): the Galxe Desk. A specialist team, a first pass of the official rulebook
  (the full read waits on the crawl — `npm run desk:check` still exits 1 and says so), a Prize Gate that refuses
  worthless or unclaimable quests, and a by-hand weekly run with a ledger and kill rules. Started 28 Oct 2026 from
  Leif's braindump, after three research scouts and three independent crypto reviewers.

- [`claude-setup/`](./claude-setup/README.md): every Claude Code session boots itself. The source of the account skills
  that decide how a session starts (`joy-boot` with its SessionStart hook, `maxx`, `fresh`) and the cloud setup script.
  The hook reads the session's own transcript and says, on a resume, whether to continue, compact first or relaunch
  fresh; then `/joyisfree` does the work. Started 8 Nov 2026 from Leif's question about a resume skill.

No dependencies: `npm test` runs on Node 22 alone.
