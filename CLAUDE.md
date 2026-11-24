# Joyisfree (non-studio tracks) — orientation for Claude

Start with [`docs/state.md`](./docs/state.md): both tracks in 15 lines or fewer. Leif's one page is `docs/leif.md`.
Galxe questing was refused on 31 Oct 2026, so [`galxe-desk/README.md`](./galxe-desk/README.md) and
`galxe-desk/docs/state.md` are the desk's record: kept, not run. The account skills
`joy-boot` and `joy-teams` apply here as everywhere: check what already ran, the token law, the worth-it gate, one
ledger per project (`galxe-desk/docs/errors.md`), and Leif's decisions in one digest.

Rules that hold in this repo:

- **No secrets, ever.** No keys, seed phrases, API tokens or session cookies in any file, log or commit. The wallet
  and the sign-ins are Leif's; Claude never types a secret into a website.
- **No scripts touch the Galxe or X account.** The desk automates judgement (scouting, valuing, ranking, the
  rulebook, the ledger), never the clicks on the account. Galxe defines a bot as a program acting "without real human
  involvement" and a flagged account cannot claim.
- **Specialists are files** in `.claude/agents/` with an explicit `tools` list; none gets deploy, delete, database or
  browser tools. An agent that reads untrusted web text gets no write or code-execution tools, and no `memory: project`
  (which in some builds silently grants Write/Edit): `galxe-reader` reads the feeds and pages, the prize analyst and
  the scout and the rules counsel hold no web tools, and the security guardian is read-only with no memory.
  `node galxe-desk/scripts/agents.mjs` (inside `npm test`) fails if any agent breaks this. The routine is
  `.claude/skills/galxe-claim/SKILL.md`.
- **Every claim answerable by a command:** `npm test` (the gate, the ledger and the crawler, with guards shown to
  fail), `npm run desk:check` (is the rulebook complete), `npm run desk:status` (the ledger and the kill rule),
  `npm run prove` (the proof: PROVEN only when every listed guard, all N, is shown to bite) and `npm run prove:fast`
  (the inner loop: only what a change can reach, by what each test file reads, reusing kills made on byte-identical
  inputs; never PROVEN, and the full prove never reads that cache).
- **The method is machinery** (docs/plan-2026-11-19.md). `.claude/hooks/guard.mjs` blocks force pushes, hard resets,
  whole-tree discards, `clean -f`, history rewrites and `rm -rf` outside tmp, in sessions opened in this folder; a session
  opened a folder up gets it as the `joy-guard` plugin (`plugins/joy-guard/`, installed by the cloud environment's setup
  script). The plugin's guard is a copy a test holds byte-identical: after any guard change, run
  `cp .claude/hooks/guard.mjs plugins/joy-guard/hooks/guard.mjs`. A new guard's mutation line goes in only through `node galxe-desk/scripts/mutate.mjs --add <file.json>
  --group "<one line>"`, which runs it and writes nothing unless it is killed
  (`--try <file.json>` runs the same checks and writes nothing). Confirmed findings are fixed through the
  saved workflows `.claude/workflows/review-3x.js`, then `fix-verify.js` (at most 2 rounds, then back to the lead);
  each run gets a `workflow run:` line in `galxe-desk/docs/errors.md`, which the 19 Dec kill rule counts.
- **Nothing from here enters the studio repo.** The studio asserts that its app contacts only its own origin.
- Run git as `git -C <path> <command>`, never `cd <path> && git`.
