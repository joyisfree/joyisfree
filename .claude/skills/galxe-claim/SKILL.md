---
name: galxe-claim
description: The Galxe desk's routine. Use on Monday to produce the week's shortlist, each day for the 10-minute claim pass on the Mac, after any bot notice or odd prompt, and at day 30, 60 and 90 for the critic panel. Not for the studio app.
---

# Galxe claim routine

The desk enters only quests whose prize is real, open, eligible, claimable and worth the minutes. Judgement is
Claude's; the clicks on the account are Leif's, because Galxe defines a bot as a program acting "without real human
involvement" and flags scripted-looking activity even by hand. Everything below runs from `galxe-desk/`.

## Monday, about 30 minutes, two helpers at most

1. `galxe-quest-scout` writes `candidates.json` from the feeds (Galxe Explore, DefiLlama airdrops, CryptoRank
   Drophunting, Bankless monthly, Airdrop Alert).
2. `galxe-prize-analyst` values each candidate and runs the gate:
   `node galxe-desk/scripts/rank.mjs --candidates galxe-desk/candidates.json --account galxe-desk/account.json --out galxe-desk/shortlist.md`
3. `galxe-security-guardian` checks every line of `shortlist.md`; a veto removes the quest.
4. If the rulebook crawl ran (`npm run desk:crawl` where the hosts are reachable), `galxe-rules-counsel` reads
   `rulebook/CHANGES.md` and updates `RULES.md` and `CLAIMING.md`.
5. The manager (the main session) shows Leif the shortlist: quest, net EV, minutes, claim window. Nothing else.

## Each day, 10 minutes, on the Mac

1. In the desk's own Brave profile ("Galxe desk": only the aged personal X account, the Galxe account and the
   throwaway wallet live there), Claude in Brave opens the next shortlisted quest at its exact `app.galxe.com` URL,
   re-checks the requirements against `account.json`, and leaves the page ready.
2. Leif does the task clicks and the claim click. Signs only a readable sign-in message or the exact claim.
   Refuses any approval, Permit or unlimited-allowance prompt and says so.
3. Record it at once:
   `node galxe-desk/scripts/ledger.mjs add --quest ID --space NAME --action entered --minutes N --fee 0.08`
   A win: `--action won --amount USD --deadline YYYY-MM-DD`, the window taken from `rulebook/CLAIMING.md` section 2
   (raffle 15 days per help/9645630, RECHECK until the crawl; Gigapot 7 days; Earndrop as announced).
   A claim: `--action claimed --fee USD --gas USD --minutes N`. Cash out: `--action realised --amount USD`.
4. `npm run desk:status` prints claims due, anything OVERDUE, and the kill rule. An overdue claim is worked first.

## Standing rules, never bent

- One person, one account, one device, no scripts touching the account, no VPN, no bursts, human pace.
- Never the studio's X handle, business email, phone, domain, card or main browser profile.
- The wallet holds at most `walletCapUsd` from `account.json` and nothing the desk would mind losing.
- Passport and Score only when a shortlisted quest requires one, and only with Leif's yes.
- On "Bot activity detected", any restriction, or any unexpected prompt:
  `node galxe-desk/scripts/ledger.mjs add --quest ID --action flag --note "what it said"`; stop the day; the risk
  officer reviews before anything resumes.

## Day 30, 60, 90: the critic panel

Run `crypto-desk-lead`, `web3-growth-lead` and `crypto-risk-officer` on the ledger (three at most, Sonnet), record
their verdicts in `docs/state.md`, and obey the kill rule in `npm run desk:status`: day 30 under $10 realised stops;
day 60 under the hourly bar stops; a flag stops at once. Stopping keeps the capability; it only ends the questing.
