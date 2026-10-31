# Decision: the questing lane is refused on the numbers (31 Oct 2026)

Run with the `joy-revise` skill, tier 1 (inline — every fact was already established and triple-sourced; no new
agents were spent). The arithmetic is reproducible:
`npm run worth-it -- --payoff 50 --probability 0.2 --haircut 0.5 --costs 5 --hours 6.5 --hourly-bar 15 ...`

## WEAKEST ASSUMPTION

*"One honest Galxe account can earn more than the hours it costs."* Checked first, against Leif's own figures in
`account.json` ($15/h bar, 30 minutes a week, $25 wallet cap) rather than against hope.

**It does not hold.** At his own bar, 90 days of weekly passes is about 6.5 hours, which prices at $97.50. Break-even
therefore needs about **$1,025 of realised value at 20% odds** (or $205 at certainty). Documented individual prizes
run about **$10**, and no verified per-account earnings report above a few tens of dollars exists anywhere.

## SURVIVED (two refutation attempts failed)

- **Negative even when the case is made generously.** At the top of the vendor range ($300) with 30% odds and the
  haircut: **net −$57.50, returning $6.15 an hour against a $15 bar.** The realistic case is **net −$97.50**. The
  hours are the largest cost in every version, which is why no amount of better quest-picking fixes it.
- **The common case cannot be priced at all.** Galxe publishes neither pool size nor tickets sold, so the gate and
  the Gigapot calculator both return CANNOT_VALUE. An unpriceable bet is refused, not discounted.
- **The platform is contracting, not opening.** Newest Earndrops in the search index are all 2025; Starboard closed
  3 Aug 2026; the G-staking boost sunsets 1 Nov 2026; Gravity Alpha shuts 1 Nov 2026; and the first live scout found
  **0 verifiable 2026 quests across about 160 searches**.
- **Buying an account is out**, on the rules and on the mechanics: ToS section 2 and the Abusive Activity list
  prohibit buying, selling or renting wallet access and using a third party's account; sold accounts ship with
  session tokens the seller can use to reclaim them; and a bought account presents exactly the pattern the detector
  catches — a flagged account can do the tasks but **cannot claim**.
- **A private X account breaks the quests**, because reposts and likes are not publicly visible and follows can sit
  pending. An alias *rename* is safe (verification keys on the numeric X ID).
- **The real financial risk is the claim page, not the odds**: fake galxe.com drainers, and Galxe's own front end was
  hijacked on 6 Oct 2023 (about $396k refunded to roughly 1,120 users).
- **What pays regardless of Galxe:** the aged public alias as an asset (clears age and follower gates for free, and is
  the kind of account picked for discretionary community tracks — the tier that paid about $7,000 against about $186
  for passive users); the judgement and tooling, already built and reusable; and the agency's creator-results path,
  which is real revenue with no platform in between.

## DROPPED (refuted, so not carried forward)

- *"The top gm.ai leaderboards interact with Galxe."* Refuted: gm.ai is an unrelated Solana AI token with no
  leaderboard and no Galxe or Gravity link. A name collision, and one actively farmed by a lookalike drainer.
- *"pump.fun shows comparable quest earnings."* Refuted: its leaderboard ranks trading P&L, about 93 of its top 100
  wallets are bots, and about 96% of even profitable traders cleared under $500. Not quest income.
- *"A pre-token points lane could be farmed by rule."* Refuted on the Linea backtest: the 2,000 LXP threshold was
  published about a week before launch, roughly two years after the Galxe campaign. No rule-based lane could enter.

## VERDICT

**REFUSE — questing as income.**

On "is it gambling": not in the strict sense. Most of it is **unpaid labour with a small, uncertain, variable
payout** — there is no stake, so it is not a wager. Two parts genuinely are prize draws: **Gigapot** is a weekly
lottery, and the Rewards Hub Mystery Boxes are legally **sweepstakes**, which is why their terms carry a postcard
"alternate method of entry". And in one respect the money side is *worse* than a casino: a casino publishes its odds,
whereas Galxe publishes neither the pool nor the number of entrants. The stake is Leif's hours, and the odds are
undisclosed.

**PURSUE instead**, because each of these pays whether or not a single quest ever clears: the alias as a real asset,
the desk's judgement and tooling, and the creator-results pilot.

## CHEAPEST TEST

For the brand and agency path: **does one drop to Joyisfree's existing list outperform a plain email to the same
list?** It needs no Space, no deposit, no wallet and no new platform. If a quest platform cannot beat an email, it is
a cost and not a channel.

## KILL RULE

The questing lane is stopped by this verdict, with no hours committed. If it is ever reopened, the existing rules
stand and are already enforced by `npm run desk:status`: realised under $10 by day 30 stops it; under $15 an hour by
day 60 stops it; any bot flag stops it at once and blanks the Do card.

## ONLY LEIF'S

**Nothing.** This decision costs him no action. Gravity Alpha shuts 1 Nov 2026 and his exposure is confirmed **zero**
(`holdings: []`, every chain `false`), so tomorrow's deadline takes nothing from him.

The capability stays: the gate, the ledger, the scam-link checker, the rulebook and the verdict instrument are all
built, tested and reusable. Stopping the questing does not stop the desk.
