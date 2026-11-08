# Joyisfree team brainstorm: 23 ranked ways for Leif (5 Nov 2026)

## How this was produced

- **Six seats** each proposed ideas on their own, without seeing the others' lists: **47 ideas** in all. Working apart
  is the point: it keeps six lists from becoming one list written six times.
- Ideas that were the same offer in different words were **merged into 28** (W01 to W28), so no idea was scored twice
  and no idea got a second chance by being written twice.
- **Each of the 28 was scored by three judges held apart**: an evidence judge, a Leif judge (is it worth his hours and
  his attention) and an adversary. No judge saw another's score, so one judge's enthusiasm could not carry the others.
- **25 survived and 3 were killed** (W19, W22, W23; the reasons are under "Killed ideas" at the end).
- Copied here on 8 Nov 2026 from the team's synthesis of 5 Nov 2026. Every evidence label, score and kill rule is as
  the team wrote it; nothing has been re-scored and no statistic has been added. The [C], [E] and [R] tags are the
  team's own and are kept as given.

> **8 Nov 2026: #9 has LAPSED. Not done this year.** The Christmas Garden Gift Edit (W07) needed its invites out by
> **7 Nov 2026**, with confirm-and-pay by 12 Nov. That deadline has passed, so it is not run in 2026: moving the dates now
> would run a later, shorter offer than the one the judges scored. The entry stays below unchanged, as the record of
> what was judged.
>
> Other dates below are as written on 5 Nov 2026. Where one has now passed (the W13 order export was planned for 6-7
> Nov), confirm what actually happened before building on it.
>
> Drafts for the first three plays are in `agency/drafts/`: `opt-in.md` (#1), `care-email.md` (#2) and
> `christmas-2026.md` (#3).
>
> **Also 8 Nov 2026:**
> - **#11 is BLOCKED.** It would put the studio's licensed garment files in front of outside makers, which the
>   licence forbids; W22 was killed for the same reason. The reasons are under #11.
> - **Struck:** the outside-designer leg of #16 and the studio-trial leg of #20, for the same licence.
> - **Re-priced:** the first five, at A$25 and A$50 an hour instead of $15. See "The first five, priced at A$25 and
>   A$50 an hour" after the first three. No verdict flips, because none of the five yet has a verdict to flip.

**How the 23 were built:** 28 ideas were judged and 3 were killed. Three pairs of survivors were merged where the judges' improved versions pointed to the same offer: W04 into #15, W05 into #8 and W17 into #13. That leaves 22. The 23rd is W19 (the alias account), included as the one [R] for instruction only, so the alias channel is covered.

**Conventions:**
- Lens scores read evidence / Leif / adversary, out of 5 each, with the total out of 15.
- Leif's time is costed at $15/h. (8 Nov 2026: that rate was never his choice, and A$15 is below the adult minimum
  wage. The first five are re-priced at A$25 and A$50 below; A$25 is the stored default, not his choice.)
- Evidence labels are kept as given: SUMMARY (search summary, page not opened), UNVERIFIED, NOT_FOUND, or "none known". No new statistics have been added.
- "Judges' version" means the betterVersion from the judges has been applied.

**Channel coverage:**
- Owned email: #1, #2, #3, #6, #14
- Creators: #5, #17, #19
- Retail and wholesale: #4, #7, #21
- The app (studio): #10, #11 (blocked 8 Nov), #12, #16, #20, #22
- The agency: #8, #9 (lapsed for 2026), #13, #15, #18
- Alias account: #23
- Partnerships: #7 (Faire), #9 (multi-brand edit, lapsed for 2026), #13 (client capsule)

---

## The 23 ways

**1. [C] W11: The consented owned list, measured rather than targeted**
- **What:** An unticked opt-in at checkout and on the label site first, using the store's own email tool. Every sign-up is tagged with its source and consent type (express or inferred). A printable care guide is the lead magnet. The creator pages and a first-party studio form come later. The 90-day target is set after a 14-day baseline: weekly sign-ups x 13, plus pilot buyers. Success means consented buyers on the list plus a live welcome flow and a live post-purchase flow, not a raw count.
- **Why it pays:** Every email play scales with this list. Evidence: Spam Act consent, sender ID and 5-working-day unsubscribe (ACMA, cited in RUN-drop-vs-email.md). Campaign order rate 0.12% (Klaviyo, SUMMARY, unverified). Flows earn about $1.94 vs about $0.11 per recipient for campaigns (SUMMARY). No opt-in rate is known for this store.
- **Cost / time / first dollar:** $0-30 a month. About 1 h once, then about 0.25 h/week. No direct dollar; the baseline exists in 14 days.
- **First step:** Claude checks the current form for a stored consent record and a working unsubscribe, then drafts the wording and the care guide. Leif switches it on.
- **Reuses:** the store, the consent rules in RUN-drop-vs-email.md, `ab-test --preflight`
- **Lenses:** 3 / 4 / 4 = 11

**2. [C] W12: Retention flows that run themselves**
- **What (judges' version):**
  - Switch on the store's free built-in abandoned-checkout flow, consented buyers only, no discount, with a random 10% holdout.
  - Send the day-3 linen-care email to every buyer as a purely factual service message: no offer, no product links, sender ID and unsubscribe included anyway.
  - Add the day-21, review-request and win-back emails only after about 50 first orders. Keep them evergreen (name categories, not specific pieces).
  - The ledger shows "attributed, not proven" monthly, read from the store's own flow report.
- **Why it pays:** Flows reach buyers at the moment of intent. Evidence: Baymard puts average cart abandonment at about 70%. Flows earn about 18x more per recipient than campaigns (SUMMARY; this is selection-biased and is not a conversion lift). The claim that the care email cuts returns has no source, so track returns.
- **Cost / time / first dollar:** $0-30 a month. About 1.5 h once, then about 5 minutes a month. First dollar 7-14 days after switch-on, if there is traffic.
- **First step:** Leif reads checkouts started and orders for the last 30 days. Claude drafts the care email and the settings sheet.
- **Reuses:** the store, the ledger, the A/B analyser (`--metric clicks` for subject lines only)
- **Lenses:** 3 / 4 / 4 = 11

**3. [C] W14: A no-discount Christmas**
- **What (judges' version):**
  - A gift guide on 20 Nov, a Black Friday gift-with-purchase on 27 Nov, an Express Post email, then digital gift cards only.
  - The order-by date is Leif's own last dispatch day before Australia Post's earliest published lodgement date, with one date for WA/NT/remote and one for everywhere else. The wording is "best chance", never a guarantee.
  - The gift-with-purchase uses only finished stock counted once before 15 Nov, with a store rule that stops at zero. If there is no finished stock, drop the gift.
  - Gift cards show their expiry date, at least 3 years out.
  - Leif approves everything in one sitting on 15 Nov.
- **Why it pays:** It protects full price, and the deadline is real. Evidence: 0.12% (SUMMARY) gives about 2-3 orders per send on an illustrative list of 2,000. The 3-year gift-card minimum has applied since 1 Nov 2019, and Black Friday is 27 Nov 2026. The claim that a gift lifts order value has no source.
- **Cost / time / first dollar:** $0 cash. About 1 h once. First dollar in 15-22 days.
- **First step:** Claude pulls the real list size, last year's Nov-Dec orders and Australia Post's cut-offs by zone.
- **Reuses:** the consented list, Postiz (original posts only), the W13 threshold, the ledger
- **Lenses:** 3 / 4 / 4 = 11

**4. [C] W13: Lift order value with a threshold and gift cards, and get the pilot its AOV**
- **What (judges' version):**
  - Set the free-shipping threshold from the order distribution: the value fewer than about 20% of current orders already exceed, with a break-even check on the postage the store will absorb. Absorbed postage is a real cost, not $0.
  - Gift cards and the threshold go live now.
  - Add bundles only if the store links bundle stock to its components natively. Show "save $X" only if the items really sell separately at those prices.
  - Measure contribution per order against the same weeks last year.
  - Launch on a different date from W01 so neither result contaminates the other.
- **Why it pays:** Every order carries a fixed packing cost, so a bigger basket is cheap margin. Gift-card money is a liability until redeemed. Evidence: Baymard finds extra costs are the most-cited reason for abandoning, given by about half of abandoners. No base rate is known for order-value lift in small apparel stores. The one certain deliverable is the pre-pilot AOV that W01 is waiting on.
- **Cost / time / first dollar:** Absorbed postage only. About 1 h once. First dollar in 1-7 days.
- **First step:** Leif exports the last 90 days of orders.
- **Reuses:** the order export, the ledger
- **Lenses:** 3 / 4 / 3 = 10

**5. [C] W01: The creator-results pilot on the label**
- **What (judges' version):**
  - The smallest size: 5 creators, a $250 cap, stated in AUD. Money is released only after the first verified order.
  - Pay only on verified first-time orders. Drop the flat $5 sign-up bounty.
  - Each creator gets a link plus code with no customer discount, or a discount capped so that discount plus commission stays at or under 20%.
  - Check coupon sites weekly. Collect each creator's ABN before the first payout. Add a disclosure refusal to the ledger.
  - Pre-register a break-even cost per order (AOV x margin, minus fulfilment) and two predictions: at least 6 of 20 creators accept, and at least 4 of those 6 post.
  - Leif works in two sittings and supplies two exports, at day 30 and day 60. Exit at day 14 if fewer than 3 creators accept.
- **Why it pays:** It is the only play with real orders and no platform in between, and cost follows sales. Evidence: commission-only programmes exist (LTK, ShopMy, Shopify Collabs). A 10-15% first-order commission is a common DTC starting rate (SUMMARY, vendor, USD). The $30-100 paid-social band has no outside source. The ACCC labelling rule was not re-checked. The likeliest result is 0-3 orders.
- **Cost / time / first dollar:** $0 up front, at most $250 paid against verified orders. About 1 h/week in weeks 1-2, then about 0. First dollar in 10-35 days, possibly later or never.
- **First step:** Take the AOV from #4. Claude dates pilot.json, runs `npm run agency:pilot -- check`, and drafts the shortlist and invites.
- **Reuses:** creator-pilot.mjs
- **Lenses:** 3 / 3 / 4 = 10

**6. [E] W08: One threshold pre-order email**
- **What (judges' version):**
  - First get a written supplier quote for 1, 3 and 5 units: unit cost including setup, minimum order and lead time.
  - The copy reads: "Made only if N order by [date], otherwise a full refund within 5 business days." N is the break-even count.
  - Use a payment provider that does not hold pre-order funds.
  - Send only once a basic post-purchase email exists. No A/B test.
- **Why it pays:** Cash comes in before any cost. Evidence: 0.12% (SUMMARY; the range given is 0.07-0.13%, and another source gives 0.17%) means about 2-3 orders, or about $190 at a placeholder $80 order on a 2,000 list. The pre-order research is a modelled argument (SUMMARY), and pre-orders convert lower.
- **Cost / time / first dollar:** $0-100. 1.5-2 h in the send week, plus 2-4 h of fulfilment. First dollar in 7-21 days.
- **First step:** Leif asks the supplier for the written quote. Claude runs the preflight.
- **Reuses:** `ab-test.mjs --preflight`, the RUN-drop-vs-email.md run-sheet
- **Lenses:** 3 / 4 / 3 = 10

**7. [E] W15: A wholesale line sheet for garden, home and gift stockists**
- **What (judges' version):**
  - Build a landed-cost sheet for each SKU. Drop any SKU below the margin floor, and drop the sun hat unless no sun-protection claim is made.
  - Offer only 2-3 hero SKUs already in stock, made to order after a paid pro-forma invoice.
  - Use Faire's direct-referral link as the default ordering route, after checking its fees and returns terms.
  - Phone 3-5 shops to ask about their real terms. Use Nov-Dec only for the line sheet and samples, and pitch from late Jan to Mar for the Mother's Day and autumn buy.
- **Why it pays:** One stockist order is worth many retail orders. Evidence: keystone pricing is a convention, not a measured rate. The research's wholesale row is NOT_FOUND ("do not budget on this"). No stockist conversion rate is known.
- **Cost / time / first dollar:** $50-200. 2-3 h/week for 4 weeks, then 0.5. First dollar realistically after January.
- **First step:** Claude builds the cost sheet and the shop list. Leif sets the margin and makes the 3-5 calls.
- **Reuses:** label photos, the agency network, desk:verify, worth-it, the ledger
- **Lenses:** 3 / 3 / 3 = 9

**8. [E] W02 + W05: A pay-on-results creator sprint for one agency client, with a disclosure gate**
- **What (judges' version):**
  - Pitch only after the label pilot has its day-30 number, and to one client not on a retainer.
  - A flat $300-350 fee that pays for Leif's hours even at zero orders. Drop the $8 per-order fee, which is a conflict of interest.
  - The client pays creators directly from the ledger's payout list, so the agency never holds the money.
  - A hard pre-publication disclosure gate, which is W05 folded in: no payout on any post without the platform's paid-partnership label or #ad. Word it as "our disclosure standard", never as "ACCC compliant".
  - A data term covering only order id, code, value, refund status and a hashed buyer field. All figures in AUD.
- **Why it pays:** Warm clients, and the fee lands at signing. Evidence: productised flat-fee services exist (Design Pickle). No pay-on-results precedent with numbers was found, and no close rate is known. ACCC Dec 2023 sweep: 81% of 118 influencers raised concerns (re-check before quoting).
- **Cost / time / first dollar:** $0. About 1-3 h/week per client. First dollar 14-30 days after the pitch.
- **First step:** Claude writes the offer and a sample report (`npm run agency:pilot -- weekly`), then holds it until day 30.
- **Reuses:** creator-pilot.mjs (`--pilot`/`--file`), worth-it
- **Lenses:** 2 / 3 / 3 = 8 (W05 scored 2 / 3 / 2 = 7)

**9. [E] W07: The Christmas Garden Gift Edit, a clearly labelled sponsored page (time-critical)**
- **Status, 8 Nov 2026: LAPSED.** The invite deadline was 7 Nov 2026 and it has passed, so this is not done this year.
- **What:** The majority judges' version, taken over the evidence judge's free-listing variant:
  - A flat listing fee, with "brands paid to appear" on the page and the paid-partnership tag on every creator post.
  - No commission leg: each brand runs its own codes and pays its own creators.
  - Invite the 3-5 warmest clients by 7 Nov, with confirm-and-pay by 12 Nov.
  - The opt-in list stays Joyisfree-only and is never shared with the brands. No "arrives by Christmas" promises.
- **Why it pays:** Fees are paid up front. Evidence: paid gift-guide placement is a common format. No AU conversion figure is known.
- **Cost / time / first dollar:** $0-50. About 2 h/week until 18 Dec. First dollar in 7-14 days.
- **First step:** Claude drafts the invite and landing copy today. Leif sends by 7 Nov.
- **Kill rule (adapted floor):** if fewer than 3 brands have paid by 12 Nov, refund them and run a label-only edit.
- **Reuses:** creator-pilot.mjs (attribution report only), the Spam Act rules
- **Lenses:** 2 / 3 / 3 = 8

**10. [E] W09: A threshold batch pre-order designed in the studio**
- **What (judges' version):**
  - Start with a free 7-day "reserve your size" round (cards saved but charged only if the threshold is met) to a counted list segment, plus creator links.
  - One hero piece in one colourway, on blanks the decorator already stocks.
  - Threshold = the higher of the maker's minimum order and the worth-it break-even. Open the paid pre-order only if reservations reach at least 2-3x the threshold.
  - The maker ships direct. Care labels on every piece, no unbacked eco claims, and an ACL s36 delay plan.
- **Why it pays:** Cash before cost, no dead stock, and proof for #11 and #12. Evidence: the Ministry of Supply Kickstarter (check before quoting; Kickstarter brings its own traffic). At 0.12%, two sends give about 5-7 of the 30 units. No base rate is known.
- **Cost / time / first dollar:** $0-150 (sample after the gate only). About 10-15 h per batch. Cash in 1-30 days; earned revenue at 8-10 weeks.
- **First step:** Leif gets the maker's unit cost at the minimum order. Claude runs `npm run worth-it`.
- **Reuses:** studio factory files, Postiz, creator codes, worth-it
- **Lenses:** 2 / 3 / 3 = 8

**11. [E] W20: Founding Maker seats, sold outside the app**
- **Status, 8 Nov 2026: BLOCKED.**
  - **The licence.** The studio's 648 garments are the Seaggs Vector Mockup Pack, and its licence forbids sharing,
    re-posting or re-selling the files. This play sells seats to 30 outside makers, adds each one to the sign-in
    allowlist and sends each a screen recording of the studio, so the files would reach people outside Joyisfree.
  - **Why it was missed.** W22 was killed for this same licence (see "Killed ideas"), but the judges did not apply
    that check to this play.
  - **A second block.** The studio is hosted on Vercel's free Hobby plan, which does not allow commercial use (studio
    notes, 23 Oct).
  - **How it reopens.** Only when Seaggs has quoted a licence that allows paying subscribers, and the hosting question
    is settled. Claude drafts the Seaggs email, and it is sent on Leif's yes. The other way back is a seat that uses
    only blanks the maker uploads, so the Seaggs files never reach them.
  - The entry stays below unchanged, as the record of what was judged.
- **What (judges' versions merged):**
  - Send 30 named personal asks, each with a screen recording of the studio as it is now.
  - The product is a one-off A$190 12-month "season" with no auto-renew and a 30-day refund.
  - The exact sign-in email is a required Stripe field, and Leif adds it to the allowlist within 24 h.
  - One dated cohort start, set for when Guided 3 steps is ready, and one group call a month.
  - Publish a one-page terms of service. "Price locked for life" becomes "your founder price applies on every renewal while you renew".
- **Why it pays:** Software revenue with no new studio code. Evidence: Lenny Rachitsky's 2022 freemium figure of 3-5% (a different funnel, yardstick only). The invite gate passed its live check 21/21 (HANDOFF.md). The studio has 3 accounts, and the "pilot sign-up channel" does not exist yet.
- **Cost / time / first dollar:** $0 plus Stripe fees. 1-3 h/week in month 1, then about 0.5. First dollar in 14-21 days.
- **First step:** Claude drafts the Payment Link copy and the terms. Leif creates the link in his own Stripe account.
- **Reuses:** `enforce_signup_allowlist`, byjoyisfreestudio.com
- **Lenses:** 2 / 3 / 3 = 8

**12. [E] W21: Maker-ready print packs as a fixed-price service**
- **What (judges' version):**
  - Narrow the offer to decoration packs for named, stocked blanks, tops only. No cut-and-sew from a sketch, and no joggers.
  - Add the 7 missing Shop Sheet fields, with a script that refuses to export a pack if any is absent. Verify the separation films by script.
  - The gate before selling is a real AU printer quoting and sampling from the pack alone, with no phone call. A re-run with AI seats does not count.
  - Sell through printers' referrals, under one page of terms: redo-or-refund (ACL s64A), a client IP warranty and confidentiality.
- **Why it pays:** It earns from the studio's strengths now. Evidence: internal Shop Test, 25 Oct: 0 of 3 packs were makeable from the pack alone. Its "trade seats" were AI personas and the test stopped before its check pass. Labels do pay for tech packs (Techpacker, Fiverr, Upwork), but no verified price or conversion rate is known.
- **Cost / time / first dollar:** $0, plus paying for one real quote or sample. 0.5-3 h/week. First dollar 14-35 days after the gate passes.
- **First step:** Unpause the Shop Sheet (session local_248dacc9) to add the fields.
- **Reuses:** the factory-files ZIP, the tech pack, the 382 dpi output
- **Lenses:** 2 / 3 / 3 = 8

**13. [E] W16 + W17: An agency-client product line (branded staff merch or a co-branded capsule), paid up front**
- **What (judges' versions):**
  - Sell the design: a board plus maker pack for a fixed fee, paid up front.
  - The client orders from and pays the decorator directly. The decorator owns the sample, the run and any reprint, and signs a one-paragraph agreement to remake its own defects.
  - Get the client's brand guidelines and written OK to use the logo before any colourway work.
  - Test the fee against local embroiderers. If their free mockups make a design fee unsellable, switch to a per-unit price at cost plus 40-50%.
  - The W17 capsule follows the same rules: a design fee, a fixed wholesale price per unit, the client as retailer, one-size garden pieces (apron, smock, tote), a written go/no-go date tied to the minimum order, and ad labels on creator posts.
- **Why it pays:** The buyers already pay Joyisfree. Evidence: Hedley & Bennett's founding story (a survivor story). The promotional-products category is long established and commoditised. Prices are placeholders, and there is no evidence at all for the capsule.
- **Cost / time / first dollar:** $0-300. About 1-2 h per job once the decorator runs operations. First dollar 7-45 days (the design fee).
- **First step:** Get one decorator quote at 10, 25 and 50 units, plus one local embroiderer's retail price, then ask 3-5 clients.
- **Kill rule:** no signed quote and deposit from those 3-5 asks within 30 days means drop it.
- **Reuses:** the client roster, studio colourways and factory pack, worth-it
- **Lenses:** W16 2 / 3 / 3 = 8; W17 2 / 2 / 3 = 7

**14. [E] W18: Monthly craft-content batch, every post pointing to one owned sign-up page**
- **What (judges' version):**
  - Pinterest first.
  - One 45-minute monthly batch: a voice note plus photos, which Claude turns into 4 posts and 1 newsletter, every number source-noted.
  - Every post has its own tracked link to one sign-up page that starts a welcome flow ending in a waitlist or pre-order for the next drop.
  - Count only new sign-ups from public channels. Record each handle's reach on day 0.
  - Never post to X. No unbacked eco claims.
- **Why it pays:** It builds an owned audience of the target buyers. Evidence: persona.md argues for craft-as-authority but gives no conversion figure; none known.
- **Cost / time / first dollar:** $0. About 10 minutes a week. First dollar through the first drop.
- **Kill rule:** fewer than 10 public-channel sign-ups by day 60.
- **Reuses:** Postiz, the label handles, the thread format
- **Lenses:** 2 / 3 / 3 = 8

**15. [E] W26 + W04: Free self-serve calculators on the agency page**
- **What (judges' version):** A static, first-party calculator with no tracking.
  - "Can your list settle this test?": it asks which metric the brand tests (opens, clicks or orders). A TOO SMALL verdict always comes with what to do instead: test on clicks, pool several sends, or build flows first.
  - Creator quote break-even: fee ÷ (AOV x margin), with a counter-offer on a commission or base-plus-commission basis.
  - No judgement on named creators. The fake-follower screen does not exist, and naming creators carries defamation risk.
  - The page states plainly that Joyisfree sells the sprint. Leif also sends 5 personal verdicts to warm contacts.
- **Why it pays:** An honest hook that feeds #8 and #18. Evidence: the preflight figures (about 19,560 per arm, about 39,000 in total, from the repo's own calculation, re-derived by the judges). Free sample-size calculators are common, so the hook is not rare. No lead conversion rate or demand data is known.
- **Cost / time / first dollar:** $0. 1-2 h once. First dollar in 30-60 days, indirect.
- **Kill rule:** 10 reports sent and 0 audit or sprint enquiries within 60 days means retire it.
- **Reuses:** `ab-test --preflight`, `npm run worth-it`, the CANNOT_VALUE refusal pattern
- **Lenses:** W26 2 / 3 / 3 = 8; W04 2 / 3 / 2 = 7

**16. [E] W24: "Design it, we sew it" commissions on the label store**
- **Status, 8 Nov 2026:** the outside-designer leg is struck, for the garment licence that blocks #11. The commission
  offer to label buyers and the list stands.
- **What (judges' version):**
  - ~~First count the outside users who have actually saved a design (a Supabase row count).~~ Struck 8 Nov 2026:
    outside users designing in the studio would be using the Seaggs garment files (see #11).
  - Get the maker's one-off quote for each pattern, and set a worth-it floor with a remake allowance.
  - Offer 3 numbered slots with a 30-50% deposit to label buyers and the list ~~and app designers~~ (struck 8 Nov
    2026, as above), showing one garment that was actually made.
  - Before cutting, the customer signs off a paid spec and proof: a real cloth swatch, DTG/DTF or embroidery only, placement in mm, the size chart and a strike-off.
  - The terms include an IP warranty, the right to refuse any design, and "no change-of-mind refunds" with the statutory guarantees stated.
  - One order window per month. The app gets a static link only.
- **Why it pays:** Only Joyisfree has both the app and the sewing room. Evidence: Citizen Wolf (a different model, made-to-measure). No base rate is known.
- **Cost / time / first dollar:** $0. About 2-3 h a month as a batch. First dollar in 14-30 days.
- **Kill rule:** fewer than 2 deposits within 21 days.
- **Reuses:** the studio (link only), the patterns and maker, worth-it, the ledger
- **Lenses:** 2 / 3 / 3 = 8

**17. [E] W10: A creator capsule paid as a royalty**
- **What (judges' version):**
  - Only if a pilot creator delivered at least 10-15 verified orders in 30 days.
  - The creator chooses a second colourway on the W09 blank, from the same maker.
  - A 7-day waitlist with a $10 refundable deposit, using the app mockup.
  - Minimum = the higher of the maker's minimum order and about 3x the creator's pilot orders. Go only if deposits cover at least 50%. Cards are charged only once the run is confirmed.
  - The royalty covers all sales of the piece, under a signed one-page IP licence with ad labels on every post.
- **Why it pays:** Pre-orders fund production. Evidence: no AU capsule conversion figure is known. Referral benchmarks: 0.88% baseline and 5.58% top quartile of revenue, for $5M-25M brands (SUMMARY, vendor).
- **Cost / time / first dollar:** $0-300. About 1.5 then 0.5 h/week. First dollar 45-75 days after the day-30 report.
- **Reuses:** creator-pilot.mjs (royalty, clawback), the day-30 ranking
- **Lenses:** 2 / 3 / 3 = 8

**18. [E] W03: A forward 30-day measured trial for one client (replaces the look-back audit)**
- **What (judges' version):**
  - At intake, check four things: unique per-creator codes, a CSV order export with a buyer field, each creator's own email or ID, and a client privacy notice that allows sharing orders.
  - Build a small CSV-to-JSON importer and an AUD field first.
  - Report only cost per verified order and the share that could not be verified. No keep/cut verdicts on named creators and no fraud language.
  - Declare any creator from Joyisfree's own roster up front. About $250 paid in advance.
- **Why it pays:** It leads into #8. Evidence: no price or demand data. Spam Act Schedule 2 allows inferred consent for published business addresses. The repo shows creator-pilot.mjs is forward-only (NOT_PRE_REGISTERED, OUTSIDE_WINDOW), no follower-screen code exists, and verify-link.mjs is Galxe-only.
- **Cost / time / first dollar:** $0. About 2 h per trial. First dollar in 10-30 days.
- **Kill rule:** none of the 3-5 warm clients passes the intake questions.
- **Reuses:** creator-pilot.mjs
- **Lenses:** 2 / 3 / 2 = 7

**19. [E] W06: License proven creator posts as disclosed partnership ads**
- **What (judges' version):**
  - First add a per-post code to the post event in creator-pilot.mjs, plus a separate ad-only code. The creator gets the flat licence fee only, with no commission on ad-code orders.
  - Require at least 5 verified, non-refunded orders before licensing anything.
  - Sell it only as a fixed add-on in a client sprint, to clients spending about $1,000 a month or more on Meta or TikTok. No self-test on the label.
  - Clear claims and music before any asset runs.
- **Why it pays:** It puts paid spend behind creative with a verified sales record. Evidence: Meta partnership ads and TikTok Spark Ads are documented products. A +20-50% paid-usage premium and a $75 base plus 10% hybrid (SUMMARY, vendor, USD). No AU figures.
- **Cost / time / first dollar:** $0. About 0.5 h/week. First dollar in 30-50 days.
- **Reuses:** creator-pilot.mjs events, the weekly report
- **Lenses:** 2 / 3 / 2 = 7

**20. [E] W27: A QR card in every order linking to consented sign-up and a colourway vote**
- **What (judges' version):**
  - One plain reusable QR card, no unique codes.
  - A self-serve page: the buyer enters their order email and ticks an explicit consent box, and the email is checked against real orders.
  - The reward is a vote on the next colourway plus first pre-order access.
  - ~~Offer a studio trial only after Guided 3 steps ships, and only to voters who show maker intent.~~ Struck 8 Nov
    2026: a studio trial would put the Seaggs garment files in front of outside users (see #11).
  - Print 50 cards, with a privacy notice.
- **Why it pays:** It reaches the warmest buyers. Evidence: no redemption rate is known. Post-purchase flows at $2-5 per recipient (UNVERIFIED).
- **Cost / time / first dollar:** $40-60 at most (get a quote). About 0.1 h/week. First dollar through #2 and #10.
- **Kill rule:** fewer than 5 of the first 50 cards scanned means ~~drop the studio offer and~~ keep the email capture.
  (8 Nov 2026: with the studio offer struck, this rule no longer stops anything. The card needs a new kill rule
  before it is printed.)
- **Lenses:** 2 / 3 / 2 = 7

**21. [E] W28: One shared makers' market stall, only if the gate clears**
- **What (judges' version):**
  - Only markets with applications still open on 5 Nov count. A one-day local Christmas market is preferred, shared with a complementary maker.
  - Feed worth-it 15-20 real hours, public liability insurance, the organiser's footfall and the takings of 2-3 past stallholders. Go only if break-even is at or below the label's best online week.
  - The goal is consented sign-ups. No "no refunds" signs, gift-card expiry shown, surcharges capped at actual cost.
- **Why it pays:** "Linen sells on touch" has no source. Evidence: Finders Keepers publishes its terms. Markets are NOT_FOUND in the research ("do not budget").
- **Cost / time / first dollar:** The stall fee (unknown), $0-60 for a card reader, plus insurance. 6-8 h shared, otherwise 15-20 h. First dollar in 20-45 days.
- **Kill rule:** no open market that clears the gate by 15 Nov 2026 means diarise July-August 2027.
- **Lenses:** 2 / 3 / 2 = 7

**22. [E] W25: A "Will it print?" checker, tested by hand before it is built**
- **What (judges' version):**
  - For 3-4 weeks, post teardowns of the studio:hard refusals, each linking to a form: "send us your artwork, get a free verdict".
  - One real AU print shop confirms or corrects the checks. Label results "a guide, not a guarantee".
  - Build the browser checker only if at least 20 people submit artwork, built from the studio's own functions with a test that fails when the two copies disagree.
  - Each verdict offers a paid A$9-19 fix pack instead of a weekly newsletter.
- **Why it pays:** It turns the refusal engine into a reason to visit. Evidence: HubSpot's Website Grader (survivorship). No base rate. The repo shows `refusals.json` has been `{}` on every run, and no real garment has been produced yet.
- **Cost / time / first dollar:** $0-20. 0.25 h/week. First dollar a few days after the fix pack exists.
- **Kill rule:** fewer than 20 submissions in the window means do not build it.
- **Lenses:** 2 / 3 / 2 = 7

**23. [R] W19: Alias X account (included for instruction, not recommended)**
- **What:** A firewalled alias posting dated, original craft posts, with a week-8 checkpoint.
- **Why not recommended:**
  - The Leif lens killed it: no dollar is expected and none may ever come, the audience is there for tokens, and the firewall stops it driving label sales.
  - Posting through Postiz breaks the repo rule that no script touches the X account.
  - "Scam" verdicts carry defamation risk, and unmasking the alias cannot be undone.
  - The "one conversation" bar at week 8 is easy to meet, so the kill rule never fires.
- **Evidence:** Monad paid about $7,000 vs about $186 (persona.md, unverified, crypto-only).
- **The lesson:** optionality still costs attention. If it is kept at all: posts by Leif's own hand only, no scam verdicts, a day-0 baseline, and automatic dormancy on day 56 unless a written paid offer with a dollar figure is logged.
- **Cost / time / first dollar:** $0. 0.5 h/week or more. No first dollar.
- **Lenses:** 2 / 2 / 3 = 7 (kill flag from the Leif lens)

---

## PARKED by the premise check (8 Nov 2026)

The first five below all assume a label shop that takes orders. The premise check (`agency/facts.json`) found none: 0
storefront order notices in 90 days, and no payment rail that can take a dollar. The master plan's own rule, "no store
found parks every label play", fired, so **#1–#5 are parked**, the 15 Nov sitting is withdrawn, and the Christmas
sends are not scheduled. They wake only when Leif says he wants the shop open. The plays that do not need a shop (#8,
#13, #18, the agency-client work) belong to the agency session, which runs Leif's real agency from its own Drive doc.

## The first three to do, in order (as planned before the premise check)

**1. W13: the 90-day order export, plus gift cards and the threshold (6-7 Nov)**
- **Why first:** One 1-hour export unblocks four other plays. It gives W01 its missing AOV (agency/docs/state.md), W12 its traffic count, W14 its threshold and basket data, and W11 its buyer count. Gift cards also catch Christmas from this week, and every change can be undone.
- **Cheapest decisive test:** Leif exports the orders. Claude computes the median, the distribution, postage per order and the share of orders already above each candidate threshold, then picks the value fewer than 20% of orders exceed.
- **Kill rule:** if median contribution per order for 7 Nov-7 Dec 2026 is below the 90-day pre-change median, revert the threshold on 8 Dec 2026. Gift cards stay. Bundles are dropped if the store has no native linked stock.

**2. W12, gated on W11's consent check (live by 12 Nov)**
- **Why second:** It scores 11, runs itself and is safe under the Spam Act. It has to be live before the Christmas sends bring traffic and new sign-ups.
- **Cheapest decisive test:** a 2-minute read of the last 30 days: checkouts started, abandoned checkouts with a consented email, and orders. Claude also confirms the checkout opt-in is unticked and records consent.
- **Kill rule:** if fewer than 20 abandoned checkouts with an email are found, ship only the day-3 care email. Otherwise run the abandoned-checkout flow with a 10% holdout, and switch it off if it has recovered 0 orders above the holdout by 5 Jan 2027.

**3. W14: no-discount Christmas (approve on 15 Nov, first send 20 Nov)**
- **Why third:** Its dates are fixed, it costs no cash, it takes one 1-hour sitting and it protects full price. It needs the consent check from #2 first.
- **Cheapest decisive test:** by 15 Nov, the real consented list size, the count of finished gift items, and Leif's own dispatch dates for each zone.
- **Kill rule:**
  - If the consented list is under 500 (at 0.12%, SUMMARY, that is about 0.6 orders per send), send only the gift guide and the cut-off email.
  - If the 20 Nov guide brings 0 orders by 26 Nov 2026, drop the Black Friday gift-with-purchase email.
  - If orders that received the gift do not beat the November median order value by more than the gift's cost by 31 Dec 2026, there is no gift-with-purchase next year.

**Next in the queue:** W01 starts once the AOV exists, around 9 Nov, and on a different launch date from W13. If Leif wants W07 at all, its invites must go out by 7 Nov; otherwise skip it this year. (8 Nov 2026: the 7 Nov date has passed, so W07 is skipped this year.)

---

## The first five, priced at A$25 and A$50 an hour (8 Nov 2026)

The team costed Leif's time at $15 an hour. He never chose that figure, and A$15 is below the adult minimum wage.
The stored price of his hour is now **A$25, a default and not his choice**, until he names his own. Here the first
five are priced from their own stated cash and hours, at A$25 and at twice that, over a 90-day run. Nothing is
re-scored; only arithmetic is added. The cash figures above carry no currency label and are read here as AUD.
Totals are rounded to whole dollars.

| # | Cash, 90 days (as stated) | Leif's hours, 90 days (as stated) | His time at A$25 | His time at A$50 | Total at A$25 | Total at A$50 | First dollar (as stated) | Verdict at either price |
|---|---|---|---|---|---|---|---|---|
| 1 | $0-90 ($0-30 a month) | 4.25 (1 once, then 0.25 a week) | A$106.25 | A$212.50 | A$106-196 | A$213-303 | none direct | CANNOT_VALUE: "no direct dollar" |
| 2 | $0-90 ($0-30 a month) | 1.75 (1.5 once, then 5 min a month) | A$43.75 | A$87.50 | A$44-134 | A$88-178 | 7-14 days after switch-on, if there is traffic | CANNOT_VALUE: no dollar figure |
| 3 | $0 | 1 (the one sitting) | A$25 | A$50 | A$25 | A$50 | 15-22 days | CANNOT_VALUE: 2-3 orders a send, no order value |
| 4 | absorbed postage, no figure | 1 | A$25 | A$50 | CANNOT_VALUE | CANNOT_VALUE | 1-7 days | CANNOT_VALUE: no postage or payoff figure |
| 5 | $0 up front; up to A$250 paid only out of verified orders | at least 2 (1 a week in weeks 1-2; the day-30 and day-60 sittings have no stated length) | at least A$50 | at least A$100 | at least A$50 | at least A$100 | 10-35 days, possibly never | CANNOT_VALUE: 0-3 orders, no order value |

- **Verdicts.** None of the five states what it would earn in dollars. So the worth-it gate returns CANNOT_VALUE for
  every one, at both prices. That is not zero: it means the payoff is the missing fact. The 90-day order export (an
  order count and an average order value) is what lets #3 and #5 be priced at all.
- **No FRAGILE verdict among the five.** A verdict can only flip if there is a verdict at each price, and there is
  none yet. When the export lands, the five are run through the gate again at both prices. Any play whose verdict
  differs between A$25 and A$50 is then marked FRAGILE here.
- **Ranked by what they cost, cheapest first.** Only #3's place holds at both prices. (Corrected 8 Nov 2026: this
  said the order was the same at both prices and did not depend on the price of an hour. The table shows otherwise.)
  - #3 first: one hour and no cash, where #1, #2 and #5 each take at least 1.75 hours.
  - Then #2 and #5, in an order that is **FRAGILE**, because it turns on the price of an hour too. #2 costs 1.75 hours
    plus its cash; #5 costs its hours alone. So #5 is cheaper only while #2's 90-day cash is more than (#5's hours
    minus 1.75) times the price of an hour. At #5's stated 2 hours, that is A$6.25 at A$25 and A$12.50 at A$50. A
    subscription between those two figures puts #5 first at A$25 and #2 first at A$50.
  - #1 last is not proven. #5 costs more than #1 once its day-30 and day-60 sittings together run over 2.25 hours
    (longer, if #1 pays for its subscription). At A$25, #2 costs more than #1 if #2's cash runs more than A$62.50
    above #1's: with A$90 for #2 and none for #1, #2 is A$133.75 and #1 A$106.25. At A$50 the gap would have to
    pass A$125, which the $0-90 ranges cannot reach.
  - #4 cannot be ranked until its absorbed postage has a figure.

  This ranks cost, not value: without a payoff, the cheapest is not shown to be the best.
- **What the price of an hour does change.**
  - The five take 6.5 hours to set up. That is A$162.50 at A$25 and A$325 at A$50, against $97.50 at the old $15.
  - Over 90 days they take at least 10 hours, so at least A$250 or A$500. #5's later sittings have no stated length.
  - On the stated hours, #1 takes the most of his time: 4.25 hours, 3.25 of them its weekly quarter-hour of upkeep.
    That stops being true if #5's two later sittings together run over 2.25 hours.
- **Only the first five are priced here.** The plan (`docs/plan-2026-11-08.md`, wave 0 item 7) asked for all 23 at
  both prices. The other 18 have not been re-priced, so that item is done for five of the 23.

---

## Killed ideas
- **W19 (alias X account):** killed by the Leif lens. No dollar is expected, posting through Postiz breaks the no-scripts-on-X rule, and the scam verdicts carry defamation risk. It is shown above as #23 [R] for instruction only.
- **W22 (Etsy template collections):** the Seaggs Vector Mockup Pack licence forbids resale and redistribution. The archive is a generated QA fixture, not sellable designs, and exported recipes embed the supplier's Cloudinary URLs.
- **W23 (decorator referral partner):** the Shop Test "decorators" were AI reviewer seats, so no real partner exists, and the packs failed 0 of 3.
- **Merged, not killed:** W04 into #15, W05 into #8, W17 into #13.

### Files this draws on
- `agency/scripts/creator-pilot.mjs`
- `agency/docs/state.md`
- `agency/RUN-drop-vs-email.md`
- `agency/experiments/drop-vs-email.json`
- the studio repo's `HANDOFF.md` (read only; nothing from here enters the studio repo)
