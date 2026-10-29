# Claiming: how a prize actually lands, and every way it does not

First pass, 28 Oct 2026, from RULES.md. Confirm each line against the live page when the crawl runs (RECHECK).

## 1. Before a minute is spent: can this address claim?

1. **Reward type is real:** token, stablecoin, ETH, or a Mystery Box with published odds. OAT, points, GG, XP,
   badges, roles and whitelists are refused (RULES §B1, §B2, §B6).
2. **The quest is open:** `status` Active, now between `startTime` and `endTime`, `participantsCount` below `cap`
   when a cap exists (RULES §C2).
3. **Every requirement is met by our account, by name:** X age, followers, blue check, Humanity level, Passport,
   holdings, Galxe+ (RULES §C1). The desk's facts live in `galxe-desk/account.json`. A requirement we cannot verify
   counts as unmet.
4. **The official check, when the API token works for the quest:** `CheckUserEligibility(questId, address)`;
   `rewards.eligible` true means the address can claim (RULES §C2). Run it before the tasks and again before the claim.
5. **The claim path is known:** chain, window, fee, gas (section 2).
6. **The page is genuine:** host exactly `app.galxe.com`, Space verified or project funded and known, handles match
   (RULES §E1, §E2).
7. **It is worth it:** expected value per participant above the bar after the haircut and fees; the Prize Gate
   (`scripts/rank.mjs`) does the arithmetic and writes the reason for every refusal.

## 2. The claim path by reward type

| Reward | How it is decided | How it is claimed | Window | Chain and gas | Fee |
|---|---|---|---|---|---|
| Token, even split or luck-based | Pool ÷ participants, or random split with at least $1 a winner | Claim button after the quest ends, or Earndrop claim page | Raffle claims last 15 days (RECHECK); Earndrop as announced | Reward contracts on Gravity L1; G for gas must be on L1, never Alpha (shuts 1 Nov 2026) | $0.08 base, less at L3+, GG credits first; sponsored or gasless on some quests |
| Token raffle | On-chain draw, gas in G | Claim within the window if drawn | 15 days (RECHECK) | Gravity L1 | as above |
| Token, first-come-first-served | Off-chain, slots run out | Claim at once when eligible | until slots end | as stated by the quest | as above |
| Mystery Box (Rewards Hub) | Odds set by the brand, unpublished | Open with GG; prize credited | n/a | n/a | GG |
| Gigapot | Weekly lottery, GG tickets | **Flip the ticket within 7 days or it is void** | 7 days | n/a | GG |
| Earndrop | Project's own eligibility list, Passport and Score filters | Claim page in the window; project can ban irreversibly | as announced | as announced; gas may apply | may apply |
| OAT, NFT, points | n/a for the desk | refused by the gate | | | |

## 3. Every way people "enter and get nothing", and the desk's answer

| What went wrong | Rule | The desk's answer |
|---|---|---|
| Entered a quest with an X-age or follower gate the account fails | §C1 | The gate refuses it before any time is spent |
| Account flagged by the bot system; tasks counted, claim refused | §A1, §A2 | No scripts on the account, human pace, one device; a flag stops the desk |
| Multi-account pattern (shared IP, device, self-referral) | §A3, §B7 | One person, one account, no VPN |
| Missed the claim window (15 days raffle per help/9645630 RECHECK, 7 days Gigapot) | §B5, §B9, section 2 | Every win is logged with its deadline; `npm run desk:status` shows due and OVERDUE first |
| G for gas on Gravity Alpha, claim fails | §D1 | Gas only on Gravity L1; nothing on Alpha |
| Unbound the X account or a secondary wallet, rewards lost | §A7 | Nothing is unbound during the 90 days |
| Claimed on a lookalike site, wallet drained | §E1, §E2 | Guardian veto: host must be exactly app.galxe.com; refuse approvals and Permits |
| Reward was OAT, points or GG | §B1, §B2 | Refused as worthless unless a dated conversion is published |
| Raffle shared by thousands | §B9 | EV arithmetic refuses crowded raffles (e.g. 10 slots over 6,700 wallets) |
| Token unlaunched or vesting, headline value never realised | §B10 | 50% haircut in the gate; count only realised dollars in the ledger |
| Prize withheld as a rule violation, decision final | §A5, §A6 | Nothing to appeal if the rules were kept; one appeal with evidence if not |

## 4. The claim day, in order

1. `npm run desk:status`: anything OVERDUE or due today is first.
2. Guardian checklist on the exact URL from `shortlist.md`.
3. Re-run the eligibility check if the API token works; otherwise re-read the requirements on the page.
4. Leif clicks: tasks, then verify, then claim. Signs only a readable sign-in message or the exact claim transaction.
5. Ledger at once: `claimed` with fee, gas and minutes; later `realised` with the cash amount after selling.
6. Any notice, odd prompt or failure: `flag` in the ledger, stop, risk officer reviews.
