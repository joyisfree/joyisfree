# The day-3 care email, and the abandoned-checkout settings

> **PARKED, 8 Nov 2026.** No label shop takes orders yet and no way to be paid is live (agency/facts.json), so nothing on this page is sent or switched on. The text is kept, ready for the day Leif says he wants the shop open. Nothing here is asked of him now.

Drafted 8 Nov 2026 for #2 in `agency/docs/23-ways.md` (W12, retention flows that run themselves). The aim is to have it
live by 12 Nov, so it is running before the Christmas sends (`christmas-2026.md`) bring traffic and new sign-ups. It
depends on the consent record in `opt-in.md`. Anything in **[SQUARE CAPITALS]** is a placeholder that only Leif can
fill.

## 1. The two-minute read that decides what goes live

Before switching anything on, Leif reads the last 30 days from the store's own reports and writes the numbers here:

| Read on | Checkouts started | Abandoned checkouts with an email | Of those, with `express` consent | Orders |
|---|---|---|---|---|
| [DATE] | [N] | [N] | [N] | [N] |

**If fewer than 20 abandoned checkouts with an email are found, ship only the day-3 care email**, and leave the
abandoned-checkout flow off. With fewer than 20 a month, a 10% holdout is one or two people, the flow could never be
told apart from doing nothing, and the setup hour is better spent elsewhere. The care email does not depend on the
count, so it goes live either way.

## 2. The day-3 care email

**When:** 3 days after the order is marked dispatched. It lands about when the parcel does and before the first wash,
which is when care advice is useful. [CHECK: if most parcels take longer than 3 days, trigger it on delivery instead,
if the store can.]

**Who:** every buyer, whether they ticked the opt-in or not, except anyone who has unsubscribed. It is a service
message about the thing they bought; it carries an unsubscribe, so an unsubscribe is honoured here too.

**Subject:** Looking after your [FIBRE, e.g. linen]
**Preview text:** How to wash, dry and store it so it lasts.

> Hi [FIRST NAME, or "there" if the store has none],
>
> Your [PIECE NAME] should be with you about now. Here is how to look after it, taken from its care label.
>
> **Washing.** [FROM THE LABEL, for example: machine wash cold, gentle cycle, mild detergent, no bleach.]
>
> **Drying.** [FROM THE LABEL, for example: line dry in the shade, or dry flat.]
>
> **Ironing.** [FROM THE LABEL, for example: warm iron while still slightly damp. Linen creases; that is the fibre,
> not a fault.]
>
> **Storing.** Put it away clean and dry, somewhere that breathes.
>
> **What to expect.** [ONLY IF TRUE FOR THIS CLOTH, for example: linen softens with every wash.]
>
> If anything about your piece is not right, reply to this email. It comes straight to us.
>
> [SIGN-OFF NAME]
>
> *[The sender footer from `opt-in.md` section 5: legal name or registered business name, ABN, contact email, the
> "because you bought from us on [DATE]" line, and the one-click unsubscribe.]*

The rules, each with its reason:

- **Purely factual. No offer, no discount, no product links, no other products, no "shop" button, no review request and
  no social links.** One offer turns a service message into a marketing one, which the buyers who did not tick have not
  agreed to, and a care note with a pitch in it reads as a pitch. The review request comes later, as its own email.
- **Sender identification and an unsubscribe anyway.** The Spam Act treats a purely factual message differently from
  marketing (not re-checked here), and this email does not rely on that. Carrying both costs nothing, and it means
  nobody has to argue which side of the line the email sits on.
- **Every care line copies the sewn-in label.** The label is the instruction the garment is sold with; if the email and
  the label disagree, the buyer cannot know which to trust.
- **One version per fibre** if the range has more than one, chosen by product tag. If the store cannot branch, keep
  only the lines that hold for every fibre in the order. A wrong care instruction is worse than a short one.
- **No subject-line test.** The email has no links, so there is no click to count and nothing for a click
  test to measure.
- **No claim that it cuts returns.** That claim has no source. Instead, count returns and care complaints (shrinkage,
  damage in the wash) each month from switch-on, beside the same count for the months before, and write both in the
  ledger. If it helps, that is how it will show; if it does not, it still costs nothing and stays on.

## 3. The abandoned-checkout settings sheet

Fill in the value column on the day it is switched on, and change nothing until the kill date. A setting changed
halfway means the result belongs to neither version.

| Setting | Value | Why |
|---|---|---|
| **Tool** | The store's own free, built-in abandoned-checkout flow | $0-30 a month as planned, and no new vendor holding buyers' addresses. |
| **Who gets it** | Abandoned checkouts whose email carries `express` consent (`opt-in.md` section 4). No one else. | It asks for a sale, so it is marketing. An address typed into a checkout that was never finished, with no tick, carries no proof of consent. |
| **How many emails** | One | The smallest version that can be tested. A second email is added only if the first beats the holdout. |
| **Delay** | [THE STORE'S SETTING, written down on the day] | So the result can be repeated, or the delay changed knowingly next time. |
| **Discount** | None: no code, no "free shipping just for you", no countdown | A discount in the reminder pays away margin on orders that may have come back anyway, and teaches buyers that leaving the cart earns a code. Christmas is full price too. |
| **Content** | What they left (the store's own cart block), one link back to their checkout, the sender footer, the one-click unsubscribe | It keeps the test about the reminder and nothing else; no "you might also like". |
| **Holdout** | A random 10% of eligible abandoned checkouts get nothing | Without it, every order that comes back is credited to the email, including the ones that would have come back on their own. |
| **How the 10% is chosen** | The store's own random split. If it has none: [A RULE FIXED TODAY, for example every checkout whose number ends in 0] | A rule written down before the first checkout cannot be bent to flatter the result; choosing by hand can. |
| **No holdout possible?** | Then the flow stays off until one is possible | Without a holdout the kill rule below cannot be read. Fail closed: no way to judge it, no flow. |
| **Switched on** | [DATE], by Leif | The start of the count. |
| **Read** | Once a month, from the store's own flow report, into the ledger as **"attributed, not proven"** | The store counts every order that follows an email, which is not the same as an order the email caused. |
| **Kill date** | 5 Jan 2027 | Section 4. |

## 4. The kill rule

**Switch the abandoned-checkout flow off if it has recovered 0 orders above the holdout by 5 Jan 2027.** The day-3
care email stays on either way.

How it is read, fixed now so it cannot be chosen after the result is in. From the store's report, for the whole period
from switch-on to 5 Jan 2027:

1. **E** = abandoned checkouts that got the email; **e** = orders from them.
2. **H** = abandoned checkouts held out; **h** = orders from them (buyers who came back on their own).
3. Orders expected without the email: **E × h ÷ H**.
4. Orders recovered above the holdout: **e − (E × h ÷ H)**.
5. **If that is 0 or less, the flow goes off on 5 Jan 2027.** If H is 0, the holdout never ran and the flow goes off
   too, because the rule cannot be read.

Two worked examples:

- E = 45, e = 3; H = 5, h = 1. Expected without the email: 45 × 1 ÷ 5 = 9. Recovered above the holdout: 3 − 9 = −6.
  **Off.**
- E = 45, e = 3; H = 5, h = 0. Expected without the email: 0. Recovered above the holdout: 3. **Stays on**, recorded as
  "attributed, not proven".

What this can and cannot say: at this size a few people either way swing the number, so a positive result is not proof
that the email works. The rule is a floor. It exists to catch a flow that adds nothing, not to crown one that works,
which is all a small list can honestly do (the same reason `agency/RUN-drop-vs-email.md` expects TOO SMALL).

## 5. Not yet

The day-21 email, the review request and the win-back email are added **only after about 50 first orders**, and kept
evergreen: they name categories, never specific pieces. Before 50 orders too few people reach them to repay the setup,
and an email that names a piece goes wrong the day the piece sells out.

## 6. Who does what

- **Leif:** the two-minute read in section 1; the placeholders; switching both on; writing the date in section 3.
- **Claude:** this draft; the care lines once the labels are in (`opt-in.md` section 7 uses the same text); the
  monthly ledger line from the flow report Leif pastes in; reading the kill rule on 5 Jan 2027.
