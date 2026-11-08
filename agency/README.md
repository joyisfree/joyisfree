# The label track (folder `agency/`)

> **PARKED, 8 Nov 2026.** The premise check found no label storefront (0 order notices in 90 days) and no payment rail
> that can take a dollar (`facts.json`), so every play here is parked until Leif says he wants the shop open. This is
> the clothing label's own sales track. It is **not** Leif's agency: that is run by another Claude session from his Drive
> doc "Start here — Agency plan after the team meeting (8 Nov 2026)", and this repo does not compete with it. The
> folder keeps the name `agency/` only because the scripts, tests and mutations point at it.

The brand side of the same judgement the Galxe Desk applies to quests. Started 5 Nov 2026, after the questing lane was
refused on the numbers (`galxe-desk/docs/decision-2026-10-31-questing.md`): the quester's side of a platform pays
almost nothing, so the effort moves to the side that sets the rules and keeps the audience.

Where things stand: `docs/state.md` here, and `docs/state.md` at the repo root for both tracks. Leif's decisions and
inputs are on one page, `docs/leif.md` at the repo root, and nowhere else.

Three instruments, built the desk's way: fail closed, every guard shown to fail, every claim answerable by a command.

| Instrument | Question it answers | Works at Joyisfree's size? |
|---|---|---|
| `scripts/orders.mjs` | From one 90-day order export: the order value, its spread, postage, refunds, the accepts-marketing count and the free-shipping threshold | **Yes**, from 30 orders up. Below 30 it refuses rather than estimate. |
| `scripts/creator-pilot.mjs` | Do micro-creators, paid **only** on verified orders and sign-ups, beat paid social? | It is accounting, not statistics, so yes, but it is **parked** until the store has 30 or more orders in 90 days and the pre-pilot order value is on file. |
| `scripts/ab-test.mjs` | Does a limited drop beat a plain email to the same list? | **Almost certainly not**, and it says so first. |

The A/B test's most useful output is a refusal. At a clothing campaign's ~0.12% placed-order rate, detecting even a
doubling of orders needs 41,234 on the list, so its pre-flight step will normally answer *TOO SMALL: the plain email
stands* before a send is wasted. That is the honest result, not a failure of the test.

## Commands

Every command is in `RUNBOOK.md`, which only Claude uses. They were moved there on 8 Nov 2026 because the pages Leif
reads had handed him nine terminal steps, and he does not use a terminal. `npm run prove` now fails if a command
appears on a page Leif reads.

## Files

- `RUN-drop-vs-email.md`: **Leif's page** for the drop-versus-email question. Its first line is the answer at his size
  (the plain email is sent); then what happens, what he decides, what he will see, and the Australian Spam Act rules
  every send obeys, including why no prize draw is attached to a drop. No commands.
- `RUNBOOK.md`: every command on this track, for Claude only.
- `calendar.json`: every dated decision and date on one clock. `npm run prove` goes red the day after an open item's
  date passes in Sydney, because #9 (the Gift Edit) lapsed on 7 Nov with nothing turning red.
- `facts.json`: the numbers the plan rests on, each dated and sourced; `npm run prove` fails while it is missing or
  any fact lacks a source or a date.
- `drafts/`: the opt-in wording and consent record (`opt-in.md`), the day-3 care email and the abandoned-checkout
  settings (`care-email.md`), and Christmas 2026 (`christmas-2026.md`). Leif's pages too, so no commands.
- `docs/23-ways.md`: the team's 23 ranked plays, with every evidence label and kill rule kept.
- `experiments/drop-vs-email.json`: the pre-registration template, with the researched baseline labelled as a search
  summary to be replaced by Joyisfree's own campaign rate.
- `pilot/`: the live pilot rules and ledger. **Gitignored**: they hold customer-derived data. Buyer and account
  identifiers are stored only as sha256 hashes, which are pseudonymous, not anonymous.
- `docs/state.md`: where this track stands.

## What is only Leif's

Everything is on `docs/leif.md` at the repo root: at most three decisions, each worded so "yes" accepts the
recommendation, and the inputs only he can give, with minutes. The old ask for the store's pre-pilot average order
value is withdrawn: the orders instrument derives it from his 90-day export.
