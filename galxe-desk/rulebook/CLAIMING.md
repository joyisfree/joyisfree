# Claiming: how a prize actually lands, and every way it does not

Legend: first pass 28 Oct 2026, from RULES.md. Every line marked RECHECK is confirmed against the live page when the crawl runs, and `npm run desk:check` counts the ones left.

## 1. Before a minute is spent: can this address claim?

1. **Reward type is real:** token, stablecoin, ETH, or a Mystery Box with published odds. OAT, points, GG, XP,
   badges, roles and whitelists are refused (RULES §B1, §B2, §B6).
2. **The quest is open:** `status` Active, now between `startTime` and `endTime`, `participantsCount` below `cap`
   when a cap exists (RULES §C2).
3. **Every requirement the gate models is checked against our account by name, and any it does not model counts as
   unmet (fail closed):** it models X age, followers, blue check, Humanity level, Passport, holdings, excluded
   countries and project KYC (RULES §C1), from `galxe-desk/account.json`. A requirement the gate cannot model —
   Galxe+, TrustScan, Nomis, a Gitcoin threshold — is refused as "not understood", never waved through.
4. **The official check, when the API token works for the quest:** `CheckUserEligibility(questId, address)`;
   `rewards.eligible` true means the address can claim (RULES §C2). Run it before the tasks and again before the claim.
5. **The claim path is known:** chain, window, fee, gas (section 2).
6. **The page is genuine:** host exactly `app.galxe.com`, Space verified or project funded and known, handles match
   (RULES §E1, §E2).
7. **It is worth it:** expected value per participant above the bar after the haircut and fees; the Prize Gate
   (`scripts/rank.mjs`) does the arithmetic and writes the reason for every refusal.
8. **Each task's own deadline is met, not only the quest's.** A credential "control[s] the time range of the
   credential, prohibiting new verifications after the deadline" (VERIFIED), so a task done after its own window will
   not verify even while the quest is still open.
9. **On-chain tasks are chain-specific and Passport is wallet-specific.** An on-chain credential is checked live on
   the one "blockchain network, contract address, and method" its creator set (VERIFIED), so the holding or action
   must be on that chain; a Passport-gated quest checks only the Passport NFT "holding in your wallet" on BNB Chain
   (VERIFIED), so it must be done from the wallet that holds the Passport.

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

## 4. The weekly pass, in order

1. `npm run desk:status`: anything OVERDUE, or due before next week, comes first.
2. The Do card (`npm run desk:card`) lists the week: quests that end before next week first, all inside the one
   wallet cap, with each exact URL and the tasks in order.
3. The guardian checks each exact URL; contract addresses come from the project's own docs and are noted before signing.
4. If the API token works, re-run the eligibility check (RULES §C2); otherwise re-read the requirements on the page.
5. Leif clicks: tasks, then Verify, then claim. He signs only a readable sign-in message or the exact claim or task
   transaction, with exact-amount approvals.
6. After each on-chain task the approval is revoked; claimed prizes leave the desk wallet the same day.
7. Leif says in one line what he did; Claude writes the ledger (`claimed` with fee, gas and minutes; later `realised`
   with the cash amount after selling).
8. Any notice, odd prompt or failure: `flag` in the ledger, stop, the risk officer reviews.
