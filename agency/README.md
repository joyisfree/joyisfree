# The agency track

The brand side of the same judgement the Galxe Desk applies to quests. Started 5 Nov 2026, after the questing lane was
refused on the numbers (`galxe-desk/docs/decision-2026-10-31-questing.md`): the quester's side of a platform pays
almost nothing, so the effort moves to the side that sets the rules and keeps the audience.

Two instruments, built the desk's way — fail closed, every guard shown to fail, every claim answerable by a command:

| Instrument | Question it answers | Works at Joyisfree's size? |
|---|---|---|
| `scripts/creator-pilot.mjs` | Do micro-creators, paid **only** on verified orders and sign-ups, beat paid social? | **Yes.** It is accounting, not statistics. |
| `scripts/ab-test.mjs` | Does a limited drop beat a plain email to the same list? | **Almost certainly not**, and it says so first. |

The second one's most useful output is a refusal. At a clothing campaign's ~0.12% placed-order rate, detecting even a
doubling of orders needs about 39,000 on the list, so `--preflight` will normally answer *TOO SMALL: the plain email
stands* before a send is wasted. That is the honest result, not a failure of the test.

## Commands

```bash
npm run ab:test -- --preflight --list-size 2000 --metric orders   # can this list settle it at all? (run first)
npm run ab:test -- --check --file agency/experiments/drop-vs-email.json   # the rule is pre-registered and valid
npm run ab:test -- --file agency/experiments/drop-vs-email.json          # one look, on analyseOn, never earlier
npm run agency:pilot -- check            # the pilot's rules are fixed before the first event
npm run agency:pilot -- status           # verdict, cap remaining, each creator's verified cost per order
npm run agency:pilot -- weekly           # one row per creator per week
```

## Files

- `RUN-drop-vs-email.md`: the one-page run-sheet, including the Australian Spam Act rules and why no prize draw is
  attached to a drop.
- `experiments/drop-vs-email.json`: the pre-registration template, with the researched baseline labelled as a search
  summary to be replaced by Joyisfree's own campaign rate.
- `pilot/`: the live pilot rules and ledger. **Gitignored**: they hold customer-derived data. Buyer and account
  identifiers are stored only as sha256 hashes, which are pseudonymous, not anonymous.
- `docs/state.md`: where things stand.

## What is only Leif's

The store's average order value **before** the pilot (the denominator a creator must not be able to move), the list's
own campaign placed-order rate if he wants a better baseline, and the decision to recruit creators.
