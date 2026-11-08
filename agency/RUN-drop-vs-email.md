# Run-sheet: does a limited drop beat a plain email?

One page, in the order you do it. Written 5 Nov 2026, after the questing lane was refused on the numbers and this was
named the cheapest decisive test on the brand side.

## 1. Ask the instrument first, before writing a word

```
npm run ab:test -- --preflight --list-size <how many people are on the list> --metric orders
```

**Expect TOO SMALL.** A clothing brand's campaign email turns about **0.12%** of recipients into an order (Klaviyo
2026 benchmark, from a search summary; the range across sources is 0.07% to 0.13%). At that rate, telling whether a
drop **doubles** orders needs **19,586 people in each half**, and the tool has you plan **20,617 per half — 41,234 on
the list** — so that the 5% of addresses that may bounce cannot sink the test. Detecting a 50% lift needs 65,309 per
half, planned at 68,747 (137,494 on the list). Smaller lists cannot tell the two apart, however the send goes.

When it says TOO SMALL: **send the plain email and stop.** The test cannot settle it, and where the stakes are low the
honest rule is to pick the cheaper option. That answer cost one command instead of a campaign, which is the point.

`--metric clicks` will clear a smaller list: at Omnisend's 0.74% campaign click rate (a search summary), a doubling
needs 3,146 per half, planned at 3,312 (6,624 on the list). But clicks are not money: treat a click result as a hint
about the subject line and the hook, never as proof that drops sell.

## 2. Only if the list is big enough

1. Copy `agency/experiments/drop-vs-email.json` and fill in the dates. **The rule is fixed before the send** —
   `decidedOn` must be strictly earlier than `dataCollectedFrom` — or the tool refuses the result as a story told
   after the fact. Write both the same way, both as dates or both as timestamps with an offset: a date against a
   timestamp is refused, because a bare date has no hour and the order cannot be told.
2. Replace `baselineRate` with your own **campaign** placed-order rate if you have it (never a flow's), and set
   `plannedPerArm` to at least the "plan" figure `--preflight` printed (20,617 at the template's figures).
3. `npm run ab:test -- --check --file <your copy>` must pass before anything is sent. It refuses a plan with no room
   for bounces.
4. Split **one list at random**, 50/50, in the email platform. Never two different segments.
5. Hold everything else equal: send time, sender name and address, offer and price, products and imagery. The only
   difference between the arms is the drop framing; otherwise you will not know what you measured.
6. **Look once**, on `analyseOn` (the send date plus the 7-day window). Checking early and stopping when it looks good
   is the classic way to manufacture a false winner, so the tool prints no rates or p-values before that date.
7. Fill in recipients, placed orders and revenue for each arm, then `npm run ab:test -- --file <your copy>`. Take
   orders and revenue from the same store report: an arm with orders and $0 revenue is refused, and so is an arm
   with revenue and no orders.

## 3. The Australian rules that apply to any version of this

- **Consent.** Send only to people who agreed to hear from Joyisfree. If challenged, the sender has to prove consent,
  so keep the sign-up record.
- **Identify the sender** by the business's legal name, or the name and ABN.
- **Unsubscribe** must be in every email, free, and honoured within **5 working days** (ACMA; ignore any blog that
  says 10).
- **No prize draw attached to the drop.** A draw is a trade promotion lottery, and the permit rules differ by state and
  conflict between sources (South Australia, the ACT and New South Wales especially; treat the ACT as needing a
  permit). If a draw is ever wanted, that is a question for a lawyer, not the email.
- **Scarcity must be true.** "Limited" means limited. False urgency is a consumer-law and trust risk, and it has not
  been researched here, so keep the claim literally accurate.

## 4. What this is not

It is not the main revenue path. That is the creator-results pilot (`agency/scripts/creator-pilot.mjs`): it pays only
on verified orders, it is accounting rather than statistics, and so it works at any list size.
