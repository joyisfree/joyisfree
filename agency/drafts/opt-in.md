# Opt-in: the wording, the consent record and the care guide

> **PARKED, 8 Nov 2026.** No label shop takes orders yet and no way to be paid is live (agency/facts.json), so nothing on this page is sent or switched on. The text is kept, ready for the day Leif says he wants the shop open. Nothing here is asked of him now.

Drafted 8 Nov 2026 for #1 in `agency/docs/23-ways.md` (W11, the consented owned list). It comes first because #2 (the
care email and the abandoned-checkout flow, `care-email.md`) and #3 (Christmas, `christmas-2026.md`) may only send to
the people this records. Anything in **[SQUARE CAPITALS]** is a placeholder that only Leif can fill. Nothing here goes
live until he has filled it in and switched it on in the store himself.

## 1. Check what the store does now, before changing anything

**Not yet done.** This draft was written without access to the store, so the plan's first step (check the current form
for a stored consent record and a working unsubscribe) is still open. With a test address Leif owns:

1. **Sign up through the current form. Does the store save when, where and how that address agreed?** If it keeps only
   the address, there is no proof of consent, and if challenged the sender has to prove it.
2. **Does the unsubscribe link in the first email work, with no login, and does the address then stop getting
   marketing?** A broken unsubscribe is a breach in every message it goes out in.
3. **Is any box at checkout ticked already?** It must start unticked (section 2).
4. **Where else have addresses come from?** Old imports, a market sign-up sheet, creator pages. Each source needs its
   own record (section 4), or those addresses are not mailed.

If any answer is no, fix that first. The wording below does not help a form that cannot keep a record.

## 2. The checkout opt-in

One box, unticked, beside the email field:

> [ ] Email me about new pieces, care tips and order-by dates from Joyisfree. Unsubscribe in one click, any time.

- **Unticked by default.** The buyer ticks it, or nothing happens. The sender has to prove consent, and a box the buyer
  never touched proves nothing they chose.
- **Never a condition of buying.** The order goes through either way. A tick given only to get an order is not a free
  choice, and it fills the list with people who did not want to be on it, which is where complaints come from.
- **Separate from the terms-and-conditions tick.** One box cannot mean two things; bundled, nobody can say which one
  the buyer agreed to.
- **It names what they will get.** New pieces, care, order-by dates. Consent covers what was described, and a box that
  said only "updates" leaves room to argue about a sales email.

## 3. The site opt-in (the care-guide form)

In the label site's footer and on its care page:

> **Look after natural fibres for years.**
> Get our printable care guide for linen, cotton and [OTHER FIBRES JOYISFREE USES], and occasional emails from
> Joyisfree about new pieces, care and order-by dates. Unsubscribe in one click, any time.
>
> [ your email ] **[ Send me the guide ]**
>
> We never share or sell your address.

- **The form says plainly that signing up means emails, not only the guide.** If it promised only a PDF, the address
  was given for the PDF, and calling it consent to marketing is the kind of claim that fails when it is tested.
- **The guide arrives in the first email of the welcome flow**, not as a download on the page. That proves the address
  works before anything else is sent to it.
- **"We never share or sell your address" stays true.** The list is Joyisfree's alone: never given to an agency client,
  a brand in a joint edit, or a creator. The consent was given to Joyisfree; anyone else mailing it has none.
- **No countdown and no "offer ends" line on the form.** There is no offer, so there is nothing to end, and false
  urgency is a consumer-law and trust risk (`agency/RUN-drop-vs-email.md`).
- **Later sources use the same wording and get their own source tag**: the creator pages, the QR card in the parcel
  (#20), a market stall (#21). A form inside the studio app, if one ever comes, is built in the studio repo under that
  repo's own rules, never from here.

## 4. The consent record

Every address on the list carries these fields, kept in the store's own email tool as customer tags or fields. Keep
these spellings, so a search for one finds all of them.

| Field | What goes in it | Example |
|---|---|---|
| **Date** | When they agreed, with the time zone | `2026-11-20 14:03 AEDT` |
| **Source** | Where they agreed | `checkout`, `site-care-guide`, `qr-card`, `market`, `creator-<handle>` |
| **Wording** | The version of the wording they saw (the log below) | `optin-v1-checkout` |
| **Consent** | `express` or `inferred`, never blank | `express` |
| **Basis** (inferred only) | What the inference rests on | the order number |

The store records the unsubscribe date itself when one happens; check in section 1 that it does.

- **Express** means they ticked the box in section 2 or typed their address into the form in section 3. **Inferred**
  means they bought and did not tick. The two carry different weight, and only the record says which is which.
- **Inferred addresses get service messages only**: the order emails and the day-3 care email (`care-email.md`). They
  get no campaigns, no abandoned-checkout reminder and no Christmas emails. Inferred consent rests on an argument about
  the relationship, which may not hold for a sales email; express consent rests on a tick. This may be stricter than
  the law requires. It is a choice, and it is Leif's to change.
- **The record lives in the store, never in this repo.** An email address is personal information, and this repo holds
  no customer data; the pilot's own data is gitignored for the same reason.
- **An address with no record is not mailed.** It can rejoin through the site form like anyone else. No record means
  no proof, and the proof is the sender's to give.

### The wording log

Add a row when wording goes live; never edit a row once it has. New wording is a new version, because the record
points at the version each person saw, and editing it would change what they are recorded as agreeing to.

| Version | Live from | Where | Exact wording |
|---|---|---|---|
| `optin-v1-checkout` | [DATE SWITCHED ON] | checkout box | Email me about new pieces, care tips and order-by dates from Joyisfree. Unsubscribe in one click, any time. |
| `optin-v1-site` | [DATE SWITCHED ON] | site care-guide form | Get our printable care guide for linen, cotton and [OTHER FIBRES], and occasional emails from Joyisfree about new pieces, care and order-by dates. Unsubscribe in one click, any time. |

## 5. Sender identification

Every message carries this footer, the same each time:

> Sent by **[LEIF'S LEGAL NAME OR REGISTERED BUSINESS NAME]**, ABN **[ABN]**, trading as Joyisfree.
> Contact: **[CONTACT EMAIL]**.
> You are getting this because you [ticked "Email me" at checkout | asked for the care guide | bought from us] on
> [DATE FROM THE RECORD].
> **Unsubscribe in one click: [UNSUBSCRIBE LINK].** We act on it straight away, and always within 5 working days.

- **Identify the sender by the legal name, or the name and ABN** (ACMA, as in `agency/RUN-drop-vs-email.md`).
  "Joyisfree" alone is a trading name and may not be the legal one; the reader must be able to tell who actually sent
  the message. The name and ABN are Leif's to supply; they are not guessed here.
- **The contact address must work and be read**, for long after each send. The footer promises a way to reach the
  sender, and a dead inbox breaks the promise. The Act sets a minimum period for this; it has not been re-checked here,
  so keep the address working indefinitely.
- **The "because you" line fills from the record.** It is not the legal minimum. It is there because it answers "why
  am I getting this?" honestly, and it reminds the reader they chose it.
- **Keep "straight away" only if the store's unsubscribe is instant.** If it is not, delete those two words; every line
  in the footer must be literally true.

## 6. Unsubscribe

- **In every message**, including the factual day-3 care email. One rule for every send means nobody has to judge
  which messages need it.
- **Free and one step**: one click, no login, no password, no reason asked for. The rule is that leaving is free; a
  login or a form costs the reader time, and a reader who cannot leave reports the email instead.
- **Honoured within 5 working days** (ACMA; ignore any blog that says 10). The store's tool normally acts at once; the
  5 days is the outer limit, not the target.
- **One list, in one tool.** No copy in a spreadsheet, a second email tool or an ad audience. A copy never hears the
  unsubscribe, so the next send from it reaches someone who said stop.
- **Unsubscribing from marketing does not stop the receipt and the dispatch notice.** Those are about the order itself.
  It does stop the day-3 care email, because that email offers an unsubscribe and an offer made must be honoured.

## 7. The lead magnet: a printable natural-fibre care guide

An outline only. Claude writes the text from the care labels Leif supplies (a photo of each is enough), and Leif checks
it against the real garments before it goes live.

- **Format:** two A4 pages, as a PDF that prints cleanly in black and white. It is meant to live in a laundry drawer,
  and the printer it meets is most likely a home one.
- **Title:** "Looking after natural fibres: linen, cotton and [OTHER FIBRES JOYISFREE USES]".

**Page 1: the care**

1. **Before the first wash.** What to expect from each fibre. Linen softens as it is washed. [SHRINKAGE LINE: only if
   true for Joyisfree's cloth, for example pre-washed or not.]
2. **Washing.** Temperature, cycle, detergent and what to avoid, for each fibre, copied from the sewn-in care label,
   with the label's symbol beside each line.
3. **Drying.** Line or flat, shade or sun, tumble or not, as the label says.
4. **Ironing and creases.** Heat as the label says; ironing while slightly damp; or letting linen crease, as it does.
5. **Stains.** Plain first aid for natural fibres: act quickly, blot rather than rub, cold water first, and test
   anything stronger on a hidden seam.
6. **Storing.** Clean and dry before it is put away, somewhere that breathes, out of strong sun. A line on moths only if
   any wool is in the range.
7. **Mending.** Small repairs early, before they spread. [REPAIR NOTE: only if Leif offers repairs.]
8. **When it is finished with.** Pass it on, rehome it, or cut it up for rags.

**Page 2: the reference**

- The care-label symbols the Joyisfree labels actually use, each explained in one line.
- The web address, on one line.
- The sender footer from section 5.
- No prices, no offer, no product photos.

Rules for the guide:

- **Every instruction agrees with the sewn-in care label. Where they differ, the label wins and the guide is
  corrected.** The label is the instruction the garment is sold with, and a buyer who follows the guide over the label
  and ruins a piece has a fair complaint.
- **No "biodegradable", "compostable" or "sustainable" claim** unless Leif holds the evidence for that exact garment.
  The team ruled out unbacked eco claims across the plan, because an environmental claim is one the business has to be
  able to back.
- **No offer and no prices.** An offer dates the guide; without one it stays useful, and stays in the drawer, for years.
- **No claim that it reduces returns.** No source for that was found (#2 in `agency/docs/23-ways.md`).

## 8. How we will know it worked

From #1 in `agency/docs/23-ways.md`, unchanged:

- **Measure for 14 days first.** The 90-day target is set from that baseline: weekly sign-ups × 13, plus the pilot's
  buyers. No opt-in rate is known for this store, so a target set before the baseline would be a guess.
- **Success is consented buyers on the list, plus a live welcome flow and a live post-purchase flow**, not a raw count.
  Every email play (#2, #3, #6) scales with consented buyers, and a large list that never buys earns nothing.
- **The evidence, as labelled:** a clothing campaign email turns about 0.12% of recipients into an order (Klaviyo,
  SUMMARY, unverified). Flows earn about $1.94 per recipient against about $0.11 for campaigns (SUMMARY).

## 9. What only Leif can do

- Fill in **[LEIF'S LEGAL NAME OR REGISTERED BUSINESS NAME]**, **[ABN]** and **[CONTACT EMAIL]**.
- Run the check in section 1 with his own test address, or give Claude read access to the store's settings to do it.
- Switch both opt-ins on in the store, and write the date into the wording log.
- Supply the care labels, and check the guide against the garments.

These are his because the store, the business's identity and the sign-ins are his.
