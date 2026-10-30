# Joyisfree (non-studio tracks) — orientation for Claude

Start with [`galxe-desk/README.md`](./galxe-desk/README.md) and `galxe-desk/docs/state.md`. The account skills
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
  the scout hold no web tools, and the security guardian is read-only with no memory. The routine is
  `.claude/skills/galxe-claim/SKILL.md`.
- **Every claim answerable by a command:** `npm test` (the gate, the ledger and the crawler, with guards shown to
  fail), `npm run desk:check` (is the rulebook complete), `npm run desk:status` (the ledger and the kill rule).
- **Nothing from here enters the studio repo.** The studio asserts that its app contacts only its own origin.
- Run git as `git -C <path> <command>`, never `cd <path> && git`.
