# Galxe rules, as they bind one person with one account

First pass 28 Oct 2026; second pass 30 Oct.

Legend: VERIFIED = official text read through the Context7 index of docs.galxe.com. DIGEST = a search summary of an official page, still to be confirmed against the live page (RECHECK). Help-centre articles are cited as help/ID = https://help.galxe.com/en/articles/ID and carry no visible date. `npm run desk:check` counts every line below that still carries DIGEST or RECHECK, and the rulebook is complete only at zero.

## A. What is allowed, and what gets an account restricted

§A1. **A bot is "any automated program designed to interact with Galxe quests without real human involvement."**
The Bot Identification System uses behavioural signals (timing and sequence of actions across accounts) and on-chain
signals (rapid address creation, entries from "seemingly unrelated" addresses), and it also flags unusual activity
"even when done manually by individuals". Flagged accounts go to a security team; repeat or severe cases get temporary
or permanent restrictions. help/11827806, DIGEST.

§A2. **A flagged account can still do tasks but cannot claim** on quests with sybil prevention on, on the GG Rewards
Hub and on Gigapot; it sees "Bot activity detected… requires human participation." help/11586930, help/11827806, DIGEST.
This is the exact failure the desk exists to avoid: the prize is lost at the claim, after the work.

§A3. **Most restrictions come from patterns that indicate multiple accounts**, a Terms violation; irregular IPs,
device fingerprints and geographic inconsistencies also trigger review. Restrictions attach to behaviour, not wallets:
a new wallet does not clear one. One appeal, through live chat, with new evidence; repeat appeals and alternative
accounts do not help. Gigapot restrictions cannot be lifted. help/11925374, help/11424533, DIGEST.
Galxe's privacy policy does list "internet protocol (IP) address, web browser type, operating system version ...
device identifiers" among the data it collects, and says it uses data to "investigate, prevent, detect and take
action regarding" fraud and unauthorized access (VERIFIED, 30 Oct, https://docs.galxe.com/about/legal/privacy-policy).
That is collection and stated purpose; the specific behavioural triggers above remain DIGEST until the help pages are read.

§A4. **Terms of Service, prohibited uses (VERIFIED, wording confirmed 30 Oct 2026):** you will not "use or access the
Services through any unauthorized third party application(s) or client(s)", or share "your email password, private
keys or other sensitive information with any other person"; you will not use the Services "under a different wallet
address, email address or other identifier if we've disabled access for you"; you will not "buy, sell, rent or lease
access to your Digital Wallet"; plus "Abusive Activity" (unreasonable or disproportionate load, interfering with
systems or data, unauthorised access, using third-party accounts, transferring access rights). The list is
"representative, but not exhaustive", and Galxe "reserves the right to update or amend such list in its sole
discretion at any time, with or without notice" — the amendment power is over the Prohibited Uses list, not the
Terms as a whole (VERIFIED wording, 30 Oct).
https://docs.galxe.com/about/legal/terms-of-service. The effective date (10 Sep 2025) is DIGEST until the live page is read.
**For the desk:** the first clause rules out any bot, browser agent or scraper of the app's own private API acting as a
client. Live quest data comes through Galxe's official API with a token Galxe issues, or through a normal browser
read; never through a script posing as the app.

§A5. **Suspension and termination (VERIFIED):** Galxe may, "at its option and in its sole discretion", suspend or
restrict an account and its access to "any or all of the Services", or deactivate, cancel and block it, on legal
orders, where it "reasonably suspect[s] you of using the Services in connection with a Prohibited Uses", pending
investigations, partner limits, any action it deems "circumventing Galxe's controls, or abusing promotions which
Galxe may offer from time to time", or breach of the Terms. Some decisions rest on "confidential criteria that are
essential to GALXE's risk management", with no duty to disclose them — that wording is in the Passport Terms of Use,
not the main Terms (VERIFIED, 30 Oct). Galxe reserves the
right "to block access to the Services, in whole or in part, from any geographic location, IP addresses and unique
device identifiers or to any user who we believe is in breach of these Terms" (VERIFIED, 30 Oct). The power to "limit
the number of User Accounts or Digital Wallets you may link" is DIGEST until the live page is read.

§A6. **Earndrop eligibility is final, and unclaimed tokens can be lost (VERIFIED, 30 Oct).** Terms §10: participation
acknowledges that "Eligibility determinations (including algorithmic scoring) are final and non-appealable", that
"Claims may incur gas fees", that Galxe disclaims responsibility for "Project decisions to modify/cancel Earndrops or
eligibility rules", and that "Unclaimed tokens may be forfeited per project terms". The user alone bears "tax
compliance, wallet security, and regulatory research". https://docs.galxe.com/about/legal/terms-of-service

§A7. **One social account binds to one Galxe account; the primary wallet cannot be changed or deleted; unbinding a
social account or secondary wallet loses the rewards claimed through it.** help/9733866, DIGEST. A Galxe ID can link
wallet addresses from several supported chains, and Galxe "recommend[s] you to use an EVM wallet address as the
primary address" (VERIFIED, https://docs.galxe.com/galxe-id/introduction).

§A8. **One Passport per identity**, verified by Sumsub with a government ID; a second cannot be minted with other
documents; 30-day wait after revoking. help/9424571, DIGEST; Sumsub flow VERIFIED at
https://docs.galxe.com/about/legal/passport-terms-of-use. The check needs "a picture of themselves and a picture of
their passport, driver's license, national insurance card" and the Passport NFT is minted only once it passes;
giving "false, inaccurate, or misleading information to GALXE or to our third-party service providers" is "Fraud",
a prohibited use (VERIFIED, Passport terms).

§A9. **No VPN to get round location rules (VERIFIED, 30 Oct).** Terms §2: "You must not use any software or
networking techniques, including use of a Virtual Private Network (VPN) to modify your internet protocol address or
otherwise circumvent or attempt to circumvent this prohibition" (services are limited by jurisdiction and sanctions),
and Galxe may "monitor where our Services are accessed from". https://docs.galxe.com/about/legal/terms-of-service

§A10. **Quest participation is governed by X's rules too, and Galxe can switch anything off (VERIFIED, 30 Oct).** Terms
§9: participation in Quest "is expressly governed by Galxe's Terms, Privacy Policy, Campaign-Specific Rules, Galxe
Passport terms, and third-party platform policies (e.g., Twitter, Discord, Snapshot)". Galxe disclaims "Accuracy of
Quest completion tracking" and the "Value, functionality, or redemption of rewards", and "reserves the right to suspend
Quests, APIs, or user access without notice". Business+ terms (§7) disclaim liability for "Bot analysis false
positives": an honest account that gets flagged has no claim against Galxe, which is why the desk keeps every action
human-paced and logged. https://docs.galxe.com/about/legal/terms-of-service

§A11. **You must be 18, or of legal age where you live, to use Galxe at all (VERIFIED, 30 Oct).** "To be eligible to
use the Services you must be at least 18 years old or of the legal age in the jurisdiction you reside in"; below that
age, use is prohibited. https://docs.galxe.com/about/legal/terms-of-service

§A12. **When it is unclear whether something is a Prohibited Use, Galxe's own instruction is to ask
support@galxe.com (VERIFIED).** The desk's rule is the same: where a rule is unclear, it does not act. Same source.

**What the desk takes from A:** one person, one account, one device, no scripts on the account, no VPN, no bursts,
human pace. The automation Leif first described (an account that "enters everything") is §A1 by definition and loses
the prize by §A2. The "team" is on the judgement side, never on the clicking side.

## B. What a quester can earn, and what it is worth

§B1. **Space Loyalty Points are per brand**, claimed on-chain with gas (Gravity, Solana, Sui, Sei EVM), "not
transferable"; no conversion to a token is published. Recurring quests pay loyalty points only. help/9733873,
help/14963438, DIGEST. Worth only what that one brand later decides. The official credential API confirms points are
held per Space: a task can require "holding at least 100 points" in a named Space (VERIFIED,
https://docs.galxe.com/quest/credential-api/graphql-cred/single-config).

§B2. **Galxe Gold (GG) "has no real-world currency value, is non-transferable, and cannot be treated as personal
property or a medium of exchange"; Galxe may change how it is earned, valued or redeemed at any time without notice.**
https://docs.galxe.com/about/legal (VERIFIED). GG is earned only on quests that carry the claim fee (+30 XP and
+30 GG per qualified claim), by Score mint (100 GG) and by a Smart Balance deposit over $100 (100 GG). help/13545714,
help/12829115, DIGEST.

§B3. **XP sets the Loyalty Level and expires after 30, 60 or 90 days.** +1 daily check-in, +3 per quest, +300 Score
mint, +200 Galxe+ subscription. Levels L1 to L5 (one article) or L6 (another). help/13545714, DIGEST.

§B4. **The claim fee is $0.08 base;** L1 and L2 pay full price, L3 and L4 get 38% off, L5 and L6 get 75% off; Galxe+
credits apply first; GG pays the fee first and the shortfall comes out of a G reward (69 GG with a 60 G box yields
59.80 G); Spaces can sponsor the fee and some quests are gasless. help/12829115, DIGEST.

§B5. **Gigapot** is a weekly lottery at 50 GG a ticket or 300 GG for 10; the Grand Alpha takes 50% of the pot for one
winner, the other 50% is split among 1,000 winners; **winners must flip their ticket within 7 days**; pool sizes are
not published. help/11424533, DIGEST.

§B6. **Mystery Boxes** pay USDT, ETH or G with odds set by the brand and not published; the Rewards Hub is a
sweepstakes with a postcard "Alternate Method of Entry", one per entrant per year (VERIFIED, Terms). A 60 G prize was
about $0.25 at G ≈ $0.004 (CoinGecko, Oct 2026); a 99 GG box costs about 3.3 claims, about $0.26 in L1 fees.
Third-party box table, RECHECK.

§B7. **Referral:** 80 GG to the referrer once the invitee completes 10 recommended quests; no XP. help/10373007,
DIGEST. Self-referral is §A3.

§B8. **Galxe Score:** $5 a year, five dimensions (Experience, Fame, Assets, Expertise, Humanity), refreshed weekly;
Humanity L1 to L3 is chosen per quest by creators, L2 needs face verification; **the score can drop if the bot system
flags you.** help/9699532, DIGEST. Passport: minting "may be subject to fees and other charges ... established ...
in the sole discretion of GALXE" and its providers (VERIFIED, Passport terms); some partners "may use GALXE Passport
SBT as a proof-of-human mechanism to prevent sybil attack" (VERIFIED) — the desk does not assume any partner
*requires* it. The $5 ID fee and $1 facial re-check figures are help/9424571, DIGEST.

§B9. **Quest types (VERIFIED, API):** Drop (NFT/standard), MysteryBox, Airdrop (token), Points, ExternalLink, Bounty.
Reward types (DIGEST, help/9645630, help/11872447): points; OAT at the claim fee; NFT; token as an on-chain raffle
(gas in G) or off-chain first-come-first-served; luck-based random split with at least $1 per winner; Mystery Box;
off-chain custom (whitelist, mintlist, beta access, merchandise). **Raffle winners have 15 days to claim** (help/9645630,
DIGEST, RECHECK). No official typical-reward figure exists; the 2025 review's 2,700+ raffles over 3.8M wallets is
about 1,400 wallets a raffle. The API confirms a points task can pay repeatedly per unit measured: "a user earns 10
points for each 1 ETH they hold" (VERIFIED, https://docs.galxe.com/quest/credential-api/graphql-cred/multi-config).

§B10. **Earndrop** (Jan 2025) distributes a project's tokens to addresses the project chose, filtered by Passport and
Score; projects can ban addresses and a ban is irreversible; a claim fee may apply; tokens "have no guaranteed
value". help/10899990 DIGEST; legal VERIFIED. An Earndrop claim costs network gas plus a Galxe claim service fee tiered from $0.05 (claim worth $1 to $5) to $5.00 (claim worth $1,000 or more), paid in the network's native token for unlisted tokens (help/10899990, DIGEST, found by the 30 Oct scouts).

**What the desk takes from B:** OATs, points, GG and XP are refused by the Prize Gate as worthless unless a Space
publishes a dated points-to-token conversion. Only token, stablecoin, ETH and published-odds rewards are valued.

## C. What a quest can require of our account (eligibility)

§C1. **Creators can gate a quest by:** X account age (1, 3, 6 or 12 months), X followers (20, 50, 100 or 500), blue
check; Humanity Score L1 to L3; Galxe+ tier; Passport; Gitcoin/Human Passport; TrustScan (60 or lower); Nomis;
on-chain holdings or actions; loyalty-point thresholds; quests completed; surveys with proof; predictions; page
visits; imported data (CSV, Sheets, API, GraphQL, contract query). With no gate set, "multiple or new accounts can
participate freely" (which is why those quests are the most crowded). help/9729011, help/9728885, help/11586930,
DIGEST. Confirmed in the official credential docs (VERIFIED, docs.galxe.com/quest/credential-api and
/about/legal/passport-privacy-policy): contract-query credentials are "commonly used to query `ERC20` or `ERC721`
holders" (on-chain holdings); a task can require "holding at least 100 points" in a named Space (loyalty-point
thresholds); the "GALXE Passport credential only looks at your GALXE Passport NFT holding in your wallet", minted on
BNB Chain; and a `gitcoinPassport` credential value exists (Gitcoin/Human Passport, in name — the page gives no rules).

§C2. **The official eligibility query (VERIFIED):** `CheckUserEligibility(questId, address)` returns, per credential
group, each condition's `eligible` flag and each reward's `eligible` flag, with `conditionRelation` ALL or ANY;
"when `rewards.eligible` is true, user can claim rewards." Quest fields: `status` (NotStarted, Active, Expired,
CapReached, Draft, Deleted), `startTime`, `endTime`, `cap`, `participantsCount`, `loyaltyPoints`, `gasType`, `chain`.
https://docs.galxe.com/galxe-integration/guides/quests and /api-reference/quest.

§C3. **API access (VERIFIED):** a token is generated in the dashboard under Settings → Server API, bound to the
wallet that generates it, which must be owner or admin of a Space; free tier 10 QPS and 100,000 requests a month on
the /query endpoint; quest listing is per Space (`spaceId`). Whether `quest(id)` answers for quests outside one's own
Space is not stated: RECHECK by trying it with a free Space owned by the desk wallet, named neutrally, never the brand.
Under §A4 this token, or a normal browser read, is the only compliant source of live quest data. https://docs.galxe.com/galxe-integration/getting-started/authentication,
/resources/rate-limits, /api-reference/quest. No official feed (RSS, email, Telegram, push) for new quests exists. DIGEST.
When a Space is read through the API, use its numeric ID, not its alias: Galxe "recommend[s] that you use the number
ID for queries, as the alias may change" (VERIFIED, docs.galxe.com/quest/graphql-api/space/queries/space).

## D. The platform's state (why dates matter)

§D1. **Gravity L1 mainnet is live (21 Jul 2026 per DIGEST); Gravity Alpha shuts 1 Nov 2026;** quest reward contracts
moved to L1; **a direct-wallet claim fails if the G for gas sits on Alpha.** help/16010489, help/16305612, DIGEST.
§D2. G staking pays no yield (a GG boost) and its dashboard is closing (26 Oct or 1 Nov 2026, sources conflict);
Smart Savings became Smart Balance with no yield; **Starboard (InfoFi leaderboards) closed 3 Aug 2026.**
help/9202640, help/8388133, help/11426659, DIGEST.
§D3. **X revoked API access for apps that reward posting on 15 Jan 2026** (Kaito, Cookie); X's automation rules
forbid bulk or aggressive following, duplicate posts across one's accounts and bulk, keyword or scheduled auto-likes;
the authenticity policy forbids coordinated or compensated exchange of likes, reposts and follows and multi-account
amplification, permanent at first detection in severe cases; follow cap 400 a day. https://help.x.com/en/rules-and-policies/x-automation,
/authenticity, /x-follow-limit, https://www.theblock.co/post/385805 (15 Jan 2026). DIGEST.

## E. Security

§E1. Galxe's own advice: bookmark app.galxe.com, verify X and Discord handles, refuse approval pop-ups that appear on
navigation, use a fresh low-balance wallet, never give keys or seeds to bots, treat every signature as a possible
approval, revoke after anything odd, staff never DM. help/10078762, help/10345406, DIGEST.
§E2. Lookalike claim pages (galxe-claim.app, airdrop-galxe.one) drain wallets; the Oct 2023 DNS hijack cost about
$396K across about 980 users, refunded with 10%. help/8452958, The Block (Oct 2023). DIGEST.
§E3. The public "Galxe bots" on GitHub sit in a category with documented key-stealers (SlowMist, Jul 2025; compromised
@solana/web3.js, Dec 2024). Never run one. DIGEST.
