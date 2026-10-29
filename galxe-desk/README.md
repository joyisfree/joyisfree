# The Galxe Desk

Leif's braindump, 28 Oct 2026: "Galxe maxing" with a separate X account, a team of specialists mirroring Galxe's own
team, the points system, an automated account that enters everything, and a 3× cross-check by crypto experts on
whether it is worth it. His second message: use the full team, hire new ones, read every official doc and term, and
make sure we **claim prizes**, not enter randoms and get rewarded worthless things.

## The verdict, in short (the full plan is in Claude's plan file of 28 Oct 2026)

1. As income, one honest Galxe account is worth about $0 to a few tens of dollars a month before fees; no verifiable
   log of anyone earning more exists. Three scouts and three independent reviewers (desk lead, growth lead, risk
   officer) all said so.
2. The automated "enters everything" account is the one certain loss: Galxe's bot system is built to catch it, a
   flagged account can do tasks but cannot claim, some bans are permanent and non-appealable, and the public "Galxe
   bots" sit in a category proven to steal keys. It is not built.
3. Worthless rewards are the default (OATs, per-brand points, Galxe Gold, raffles shared by about 1,400 wallets). The
   2025 to 2026 money went to on-chain usage with capital, NFT holders and hand-picked communities.
4. What is built: this desk. The team, the whole official rulebook, and a Prize Gate that refuses every quest whose
   prize is not real, open, eligible, claimable and worth the minutes. It makes a small game precise, and it is reusable.
5. The run: 90 days, by hand, 10 minutes a day, in the desk's own Brave profile with a throwaway wallet of at most
   $25, a ledger of minutes, fees and realised dollars, and kill rules. Decided by Leif on 28 Oct: Path 2, an existing
   aged personal X account (never the studio's), and the Galxe domains allowed in the cloud environment.

## The team

| Specialist (`.claude/agents/`) | Mirrors at Galxe | Owns |
|---|---|---|
| `galxe-rules-counsel` | Knowledge and Support, legal | The rulebook; allowed, eligible, claimable; rule changes |
| `galxe-prize-analyst` | Data | Values every prize; runs the Prize Gate; the weekly shortlist |
| `galxe-quest-scout` | Ecosystem and BD | Finds candidates across Galxe Explore and the research feeds |
| `galxe-security-guardian` | The security team | Verifies links, Spaces, chains; wallet cap and signature rules; veto |
| `crypto-desk-lead`, `web3-growth-lead`, `crypto-risk-officer` | The critic panel | Day 30, 60, 90 verdicts on the ledger |

The existing roster (Scout, Guardian, Verifier, Builder, Error Scholar, Explore) is reused as is. At most three run at
once, on Sonnet. Ranking, the ledger and the crawl are scripts, because a script beats an agent for anything exhaustive.
The routine is the skill `galxe-claim`.

## The files

- `rulebook/`: `sources.json`, the crawler's output (`pages/`, `INDEX.md`, `CHANGES.md`), and the desk's own
  `RULES.md` and `CLAIMING.md` (first pass seeded 28 Oct; complete once `npm run desk:check` says so).
- `scripts/rank.mjs`: the Prize Gate. `scripts/ledger.mjs`: the ledger and the kill rule. `scripts/rulebook-crawl.mjs`:
  the crawler. Tests beside them.
- `account.json`: the desk's account as the gate sees it (placeholders until the accounts exist; no secrets).
- `candidates.example.json`, `shortlist.example.md`: what the gate does with four real-shaped quests.
- `ledger/ledger.jsonl`: one JSON line per event, appended, never edited.
- `agency-brief.md`: the desk's second client, creators paid only for verified results.
- `docs/state.md`, `docs/errors.md`: where things stand, and the ledger of failures and weaknesses.

## Commands

```bash
npm test                  # the gate, the ledger and the crawler, with every guard shown to fail
npm run desk:rank -- --candidates galxe-desk/candidates.json --account galxe-desk/account.json --out galxe-desk/shortlist.md
npm run desk:status       # entered, won, claimed, realised, $/hour, claims due, OVERDUE, kill rule
npm run desk:ledger -- add --quest ID --action entered --minutes 8 --fee 0.08
npm run desk:crawl        # fetch every official page (needs the hosts reachable)
npm run desk:check        # is the rulebook complete: listed = fetched = read, missing 0
```

## What is Leif's, and only this

The sign-ins inside the desk's Brave profile (the aged personal X account, the Galxe account) and the wallet he
creates and funds to at most $25. Passport and Score only if a shortlisted quest requires one, at $5 and his yes.
Everything else is Claude's.
