---
name: galxe-claim
description: The Galxe desk's routine. Use on Monday to produce the week's shortlist and Do card, after Leif's weekly pass to write the ledger, after any bot notice or odd prompt, and at day 30, 60 and 90 for the critic panel. Not for the studio app.
---

# Galxe claim routine

The desk enters only quests whose prize is real, open, eligible, claimable and worth the minutes. Judgement is
Claude's; the clicks on the account are Leif's, because X forbids scripting its website, Galxe flags automated quest
interaction (RULES §A1, §A2) and its Terms bar any "unauthorized third party application(s) or client(s)" (§A4).

## Where live data may come from (RULES §A4)

Galxe's official API with a token issued from a Space the desk wallet owns, or a normal browser read of a public page.
Never a script posing as the app, never the app's private API, never anything signed in as Leif. Anything that reads
untrusted text (quest pages, crypto news, search results) runs as a reader with no write tools and none of Leif's
connectors: `galxe-reader` once the session has it, otherwise `galxe-quest-scout` told not to write, with
`git status` checked afterwards.

## Monday: the shortlist and the Do card (about 30 minutes of helpers, at most three)

0. `npm run desk:status` first, then `npm run desk:due`. If the kill rule is anything but CONTINUE (a flag, day-30 or
   hourly stop), there is no shortlist and no Do card this week: the critic panel (the risk officer first) reviews
   before questing resumes. The Do card builder enforces this too — it refuses to list quests while the desk is
   stopped — but the week starts with the check, not with the scout. Anything already won and unclaimed outranks
   every new quest, and the Do card puts the claim clock above the week's list.
1. `galxe-reader` reads the feeds and quest pages (no write tools, none of Leif's connectors); `galxe-quest-scout`
   takes its notes and records candidates in Galxe's official quest shape (`credentialGroups`, `participantsCount`,
   times, `requirements`, `project`, `capitalUsd`, `taskGasUsd`). A fact not in the reader's notes is written as
   `"unknown"`: the gate refuses unknowns, so a guess can only let a bad quest through.
2. `galxe-prize-analyst` values the rewards from what the scout recorded (it does not browse) and runs the gate:
   `node galxe-desk/scripts/rank.mjs --candidates galxe-desk/candidates.json --account galxe-desk/account.json --out galxe-desk/shortlist.md`
3. `galxe-security-guardian` checks every pass; a veto removes it, whatever its value. Every URL that will reach
   Leif goes through `npm run desk:verify -- <url>` first: anything but GENUINE never appears on the card.
4. `npm run desk:card -- --shortlist galxe-desk/shortlist.json` writes the Do card: the week's minutes filled with the
   quests that end before next week first, all inside the one wallet cap. It reads the ledger's kill state and writes
   a stop notice instead of a card if the desk is stopped.
5. The main session shows Leif the Do card. Nothing else.
6. The week's post is drafted from the same shortlist, following `galxe-desk/thread-format.md`: the picks with their
   arithmetic and, more importantly, the refusals. Every link in it is checked with `desk:verify` before it goes out,
   and Leif posts or approves the schedule — the account is his (`galxe-desk/persona.md`).

## Leif's one weekly pass (about 30 minutes, on the Mac)

1. In the "Galxe desk" Brave profile (only the aged personal X account, the Galxe account and the throwaway wallet
   live there), he works the Do card top to bottom.
2. He signs only a readable sign-in message, the exact claim, or the exact on-chain task transaction the guardian
   noted; an exact-amount token approval only when a task needs one. Any unlimited allowance, blind Permit or
   `setApprovalForAll` prompt is refused and reported.
3. He tells Claude in one line what he did ("did 1 and 2"). Claude writes the ledger:
   `node galxe-desk/scripts/ledger.mjs add --quest ID --space NAME --action entered --minutes N --fee 0.08`;
   a win `--action won --amount USD --deadline YYYY-MM-DD` (window from `rulebook/CLAIMING.md` section 2);
   a claim `--action claimed --fee USD --gas USD --minutes N`; a sale `--action realised --amount USD`.
4. `npm run desk:status` shows claims due, anything OVERDUE (worked first next pass) and the kill rule.

## Standing rules, never bent

- One person, one account, one device; no scripts on the account; no VPN (§A9); no bursts; human pace.
- Never the studio's X handle, business email, phone, domain, card or main browser profile.
- The wallet holds at most `walletCapUsd`, shared by every quest at once. Contract addresses come from the project's
  own docs and are noted before signing; approvals are revoked after each on-chain task; claimed prizes leave the desk
  wallet the same day.
- Passport, Score and any project KYC only with Leif's yes.
- On "Bot activity detected", any restriction or any unexpected prompt:
  `node galxe-desk/scripts/ledger.mjs add --quest ID --action flag --note "what it said"`. That stops the desk by
  itself, and the risk officer reviews before anything resumes.

## The full read (first session where the official hosts answer)

`npm run desk:crawl`; one `galxe-rules-counsel` reads every claim-relevant page in full and marks each INDEX row with
a one-line note (a second counsel only past about 150 such pages); the Verifier samples 15 notes against the saved
pages; RULES.md and CLAIMING.md are confirmed line by line. `npm run desk:check` is complete only at zero unconfirmed
rule lines. That count proves no rule rests on a search summary, and the notes and the sample prove the reading.

## No unattended engine until a manual run earns it

A recurring scheduled run is created only after one manual networked run has produced a real shortlist. When it is,
it runs as a fresh session with no connectors, in an environment limited to named hosts, with access to this repo only.

## Day 30, 60, 90: the critic panel

`crypto-desk-lead`, `web3-growth-lead` and `crypto-risk-officer` judge the ledger (three at most, Sonnet), their
verdicts go in `docs/state.md`, and `npm run desk:status` applies the kill rule: day 30 under $10 realised stops; day
60 under the hourly bar stops; a flag stops at once. Stopping keeps the capability; it only ends the questing.
