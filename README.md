# Joyisfree

Tracks that live outside the studio app (`joyisfree/joyisfree1`). Each track has its own folder, its own `docs/state.md`
and its own ledger, and none of them touches the studio.

- [`galxe-desk/`](./galxe-desk/README.md): the Galxe Desk. A specialist team, a first pass of the official rulebook
  (the full read waits on the crawl — `npm run desk:check` still exits 1 and says so), a Prize Gate that refuses
  worthless or unclaimable quests, and a by-hand weekly run with a ledger and kill rules. Started 28 Oct 2026 from
  Leif's braindump, after three research scouts and three independent crypto reviewers.
- [`qalam/`](./qalam/docs/state.md): Qalam, a pen-first day. The habit lives on paper. A small claude.ai account skill
  (`qalam/skill/qalam/`) coaches the bedtime brain dump, reads a photo of the page and runs the Friday review. Every
  ayah and hadith is sourced, and `npm test` guards it. Started 7 Nov 2026.

No dependencies: `npm test` runs on Node 22 alone.
