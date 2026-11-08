# Label-track runbook (Claude only)

Every command on the label track (the `agency/` folder; not Leif's agency, which another session runs), in one place. Written 8 Nov 2026, when the commands were moved off the pages Leif
reads. Leif never uses this page: he does not use a terminal (his rule since 21 Oct: no pastes, no keyboard steps), so
a command on a page he reads is a step handed to the one person who cannot take it. `npm run prove` fails its
`leif-pages` line if any command appears on `docs/leif.md`, `agency/RUN-drop-vs-email.md` or `agency/drafts/*.md`.
When a step here needs Leif, it goes onto `docs/leif.md` as one plain sentence with its minutes, never as the command.

## 0. Before and after any agency work

```bash
npm run prove          # exit 0 only if every required check holds; cite it, not a hand count
npm run desk:status    # must exit 2 (STOP_DECISION) while Galxe questing is refused
```

- A `desk:status` exit of 0 means `galxe-desk/decision.json` changed. Stop and find out why before anything else: the
  refusal is Leif's only closed decision, and only his own words reopen it.
- The prove lines that cover this track: `decisions` (`agency/calendar.json`), `state` (`docs/state.md`, 15 lines or
  fewer, named by CLAUDE.md's first instruction), `leif-pages`, `facts` (`agency/facts.json`) and `privacy`
  (`agency/pilot/` ignored, nothing under it tracked).

## 1. The 90-day order export (once a shop exists; the Sun 15 Nov sitting was withdrawn on 8 Nov, `facts.json`)

Leif downloads it; Claude reads it during the sitting.

```bash
npm run orders -- --file <export.csv>
npm run orders -- --file <other.csv> --map "id=Order,created=Date,currency=Currency,status=Status,marketing=Opt in,subtotal=Goods,shipping=Postage,total=Paid,refunded=Refunded"
```

- It reports the median and mean order value, the spread, postage per order, refunds, the accepts-marketing count and
  the free-shipping threshold that fewer than 20% of orders already reach, with the postage break-even. Shopify's
  headers are detected; any other store needs `--map`.
- It refuses, by name, an export under 30 orders, mixed currencies, non-numeric totals and missing columns, because a
  guessed figure here would steer the threshold and the pilot. Report a refusal to Leif in one plain line.
- Keep the export out of the repo (outside it, or under the gitignored `agency/pilot/`) and never commit it: it holds
  customers' emails. The script never reads the Email column and never prints an "@".
- Afterwards, in the same turn: write each number into `agency/facts.json` with its source and date, and turn what it
  shows into at most three yes-or-no questions on `docs/leif.md`, each with its minutes. (The D1-D3 questions drafted
  for 15 Nov were withdrawn on 8 Nov with the sitting; write fresh ones from the export, never revive those unread.)
- `--write-aov --pilot agency/pilot/pilot.json` writes the pre-pilot order value, and only into a pilot whose
  startDate is after now, from a USD export. It is refused without `--pilot`, so it is not a proof of anything. Use it
  only once the pilot reopens (section 3).

## 2. Drop versus email (the A/B test)

### 2.1 Ask the instrument first, before a word is written

```bash
npm run ab:test -- --preflight --list-size <N> --metric orders
```

- Expect **TOO SMALL** and exit 1. At 0.12% placed orders per recipient (Klaviyo 2026, a search summary; range 0.07%
  to 0.13%), detecting a doubling needs 19,586 per arm, planned at 20,617 per arm (41,234 on the list) so 5% can
  bounce. A 50% lift is planned at 68,747 per arm (137,494).
- On TOO SMALL, tell Leif one line and stop: "Your list can't settle this; the plain email is sent."
  `agency/RUN-drop-vs-email.md` already says so in its first line, so nothing more goes to him.
- `--metric clicks` clears at 3,312 per arm (6,624 on the list) at Omnisend's 0.74% (a search summary). Clicks are not
  money: treat a click result as a hint about the subject line and the hook, never as proof that drops sell.

### 2.2 Only if it says BIG ENOUGH

1. Copy `agency/experiments/drop-vs-email.json` and fill in the dates. `decidedOn` must be strictly earlier than
   `dataCollectedFrom`, because a rule written after the data is a story told after the fact. Write both the same
   way (both dates, or both timestamps with an offset): a bare date has no hour, so its order against a timestamp
   cannot be told, and the tool refuses the pair.
2. Replace `baselineRate` with Joyisfree's own **campaign** placed-order rate if there is one, never a flow's, because
   flows run 15 to 20 times higher and would make any list look big enough. Set `plannedPerArm` to half the list being
   split, the number each arm will actually get, as the preflight's BIG ENOUGH line prints it; never just "at least"
   the plan figure. The analysis refuses an arm more than 5% under or over `plannedPerArm`, and over is final: planned
   at 20,617, a list of 44,000 split 50/50 gives 22,000 an arm and is never read, so the one send is spent.
3. This must pass before anything is sent; it refuses a plan with no room for bounces, and prints the band of
   recipients each arm must land in to be read:

   ```bash
   npm run ab:test -- --check --file <your copy>
   ```

4. Put the one yes on `docs/leif.md` (run it once, on the fixed date) and, on his yes, a click card for his part:
   split **one list at random**, 50/50, in the email platform (never two different segments), and schedule both sends.
5. Hold everything else equal: send time, sender name and address, offer and price, products and imagery. The drop
   framing must be the only difference, or nobody knows what was measured.
6. **Look once**, on `analyseOn` (the send date plus the 7-day window). Checking early and stopping when it looks good
   manufactures false winners, so the tool prints no rates or p-values before that date.
7. Fill in recipients, placed orders and revenue for each arm from the same store report, then run the command below.
   An arm with orders and $0 revenue is refused, and so is one with revenue and no orders.

   ```bash
   npm run ab:test -- --file <your copy>
   ```

## 3. The creator pilot (parked)

Parked until the store has 30 or more orders in 90 days and the pre-pilot order value is on file, because below that
it would most likely bring 0 to 3 orders. Before it reopens: the judges' rules (an ABN before the first payout, no pay
on a post without a #ad or paid-partnership label, first-time buyers only, an exit at day 14 if fewer than 3 creators
accept, A$250 cap, 5 creators, no sign-up bounty; the defaults in the code are still US$600, 12 and $5), and a ledger
checkpoint with a Drive copy, each red-tested first. A missing ledger currently reads as an empty one, which would
reset the cap.

```bash
npm run agency:pilot -- check     # the pilot's rules are fixed before the first event
npm run agency:pilot -- status    # verdict, cap remaining, each creator's verified cost per order; exit 2 unless CONTINUE
npm run agency:pilot -- weekly    # one row per creator per week
```

The event commands (`add-creator`, `post`, `order`, `import-orders`, `signup`, `refund`, `pay`, `flag`) and their flags
are in the usage text of `agency/scripts/creator-pilot.mjs`.

- The first accepted write pins the rules: line 1 of the ledger is `{type: "rules", ts, pilotSha256}` of `pilot.json`.
  Any later edit of `pilot.json` makes every command refuse with NOT_PRE_REGISTERED, so write the pre-pilot order value
  (`npm run orders -- --write-aov ...`) before the first event, never after.
- The day-30 stop is decided once, from refunds dated by day 30; a refund dated later nets its own order but never
  re-takes that decision. A back-dated refund that would move it is refused. A refund can still free cap room that
  another creator's capped order then earns, never more than the commission it took back (the cap rule, G16).

## 4. The decision clock (`agency/calendar.json`)

- One array of `{id, date, what, whose, kind, status, lapsesIf}`. `kind` is `decision` or `date`; `status` is `open`,
  `decided` or `lapsed`; dates are strict `YYYY-MM-DD`.
- prove's `decisions` line goes red once an `open` item's date is before today **in Sydney**, so a missed date shows
  the next morning instead of being found later. #9 lapsed on 7 Nov because nothing turned red.
- When Leif answers, set `status` to `decided` in the same turn and add `answer` (his words) and `answeredOn`. prove
  reads only the seven fields; the two extra ones are the record. An item Claude withdraws (as on 8 Nov, when the
  premise check found no store) is set to `decided` with `closedBecause` saying why, never deleted.
- Mark an item `lapsed` only with `lapsesIf` saying what was lost. Never move a date to turn the line green: that is how
  a lapse would hide.
- A new dated item found mid-task goes into the calendar and onto `docs/leif.md` in the same turn, before any fleet.
  `docs/leif.md` holds at most three decisions, each worded so "yes" accepts the recommendation.
- Log Leif's real minutes on `docs/leif.md` after each sitting, so the under-an-hour claim stays checkable.

## 5. Before any send (the Spam Act)

The plain-words version is on `agency/RUN-drop-vs-email.md` for Leif. Claude checks, before every send:

- **Consent** is recorded for every address (when, where, how), because the sender has to prove it if challenged. An
  address with no record is not mailed. Inferred-consent buyers get only what D2 allowed.
- **Sender identity:** the legal name, or the name and ABN, in every email.
- **Unsubscribe** in every email, free, honoured within 5 working days (ACMA).
- **No prize draw** on a drop: state trade-promotion permit rules conflict between sources.
- **Scarcity** claims are literally true.
- **Outreach** belongs to the agency session (Leif's Drive doc "Start here — Agency plan after the team meeting
  (8 Nov 2026)"), not this repo. The rules above still hold for any send from here.

## 6. The realised-dollar record (`agency/scripts/realised.mjs`)

Only once a shop exists. It credits a dollar to a play only through that play's own discount code, inside its window,
on paid orders, net of refunds; everything else is counted as unattributed, never guessed.

```bash
npm run realised -- --file <export.csv> --plays <plays.json>
```

- Keep the export and the plays file outside the repo or under the gitignored `agency/pilot/`. The script never reads
  the Email column and refuses any output containing "@".
- A window the export does not fully cover is printed INCOMPLETE with "at least" figures; report it that way to Leif.
- Exit 0 is a report, 1 a refusal (say why in one plain line), 2 misuse.
