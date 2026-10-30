# The weekly post: the desk's shortlist, published honestly

Written 30 Oct 2026. The point of this file: the alias's best content is **the desk's output**, not extra work.
Every Monday the gate already produces a shortlist with an expected value and a written reason for every refusal.
That artefact, published plainly, is more useful than anything else in the niche — because almost everyone else is
paid to be enthusiastic.

## The rule that makes it worth reading

**Publish the refusals, not just the picks.** Anyone can post "new airdrop live". Almost nobody posts "I looked at
nine, eight are not worth your time, here is the arithmetic". The refusals are the product; they are also honest
advertising for the judgement, which is the thing Joyisfree can eventually sell (`agency-brief.md`).

Never: referral links, affiliate codes, "not financial advice" theatre, urgency, or a pick the gate refused. If the
week's answer is "nothing", post that. A week of "nothing clears the gate" is a credibility deposit.

## The shape

Generated from `galxe-desk/shortlist.json` (and `shortlist.md`) after the Monday run.

**Post 1 — the verdict.**
> This week I checked {N} Galxe quests. {P} are worth doing. {R} are not, and here's why.

**Post 2…P+1 — one per pick.** From each entry in `passed`:
> {space} / {name} — about ${ev} net per entry after fees, {minutes} min, claim by {claimBy}.
> Why it clears: {the reward type, the pool and participants, the published arithmetic}.
> {url}  ← verified with the link checker

**Post P+2 — the refusals, grouped by reason.** From `byReason`:
> Refused: {n} worthless rewards (OAT/points/GG with no published conversion), {n} claim path unknown,
> {n} expected value under ${threshold}, {n} not open, {n} ineligible for my account.
> The full reason for each is in the shortlist.

**Last post — the standing warning.** Rotate one real example from the desk's own scam list:
> Reminder: a Galxe quest is only ever claimed on app.galxe.com. This week's lookalikes: {hosts}.
> Paste any claim link into a checker before you connect anything.

## Where each number comes from

| In the post | From |
|---|---|
| N, P, R | `shortlist.json`: `results.length`, `passed.length`, `refused.length` |
| ev, evGross, minutes, claimBy, url, space, name | each entry of `passed` |
| the refusal counts | `byReason` (counts quests, not reason lines) |
| the lookalike hosts | `verify-link.mjs` → `KNOWN_SCAM_HOSTS`, plus anything the week's scouting flagged |
| the threshold | `account.json` → `evThresholdUsd` |

Commands behind it:

```bash
npm run desk:rank -- --candidates galxe-desk/candidates.json --account galxe-desk/account.json --out galxe-desk/shortlist.md --top 5
npm run desk:verify -- <each url in the post>      # every link published is checked first
npm run desk:due                                    # anything already won and unclaimed comes before new picks
```

## Standing rules for publishing

- **Check every link in the post with `desk:verify` before it goes out.** Publishing a drainer once would end the
  account's usefulness permanently. Nothing but a GENUINE verdict is ever posted.
- **No claim is made that the desk cannot answer with a command.** The EV figures come from the gate, not from a feel.
- **Say what is unknown.** Where the rulebook still carries a DIGEST line (`npm run desk:check`), the post says the
  figure is unconfirmed rather than stating it flat.
- **Original wording every week.** X forbids duplicate posts across accounts; the numbers change, and so should the
  sentences. Scheduled through Postiz, never auto-liked or auto-reposted.
- **Leif posts, or approves the schedule.** The account is his; Claude drafts from the shortlist.
