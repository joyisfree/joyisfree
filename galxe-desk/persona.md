# The alias: one public pseudonymous account, treated as an asset

Written 30 Oct 2026, from three read-only research passes (gm.ai/Gravity, pump.fun/Solana, account market +
alias/private X + returns). This is the foundation of the desk: the quests are the byproduct, the account is the thing
that compounds.

## Why an alias is the right instrument (and not a limitation)

Crypto Twitter is the distribution, reputation and deal-flow layer of this market. Most of its most valuable accounts
are **pseudonymous** — an alias is the norm there, not a workaround. And the money in 2025 to 2026 did not go to the
accounts that entered the most quests. It went to the accounts that were **selected**: Monad's hand-picked community
track paid about $7,000 an account against about $186 for passive on-chain users. Being selected is a reputation game.
That is why one credible alias beats any number of fresh accounts, and why it is worth building rather than buying.

## The five rules that are not bent

1. **Public, never private.** Protected mode is the one change that would break the whole thing. Galxe verifies X
   tasks by reading the follow graph and the post itself; a protected account's reposts and likes are not publicly
   visible and a follow of a public account can sit pending, so repost and like quests fail. Age and follower gates
   read a public profile. Keep the account public; privacy comes from the alias, not from the lock.
2. **Alias yes, new account no.** Renaming the handle is safe: verification keys on the account's numeric X ID, not
   the handle, so an aged account keeps its age and followers through a rename. A brand-new account fails the 1-, 3-,
   6- and 12-month age gates for months. Leif's existing aged account, renamed and repurposed, is the strongest
   instrument available and costs nothing.
3. **Never bought.** Galxe's Terms (section 2 and the Abusive Activity list in section 9, read verbatim) prohibit
   buying, selling, renting or leasing wallet access, using a third party's account and transferring access; the
   Passport terms repeat it. X's own platform-manipulation policy bans account trading. Beyond the rules: sold
   accounts ship with session tokens the seller keeps and can use to take the account back, and a purchased account
   presents exactly the new-device, new-IP, changed-behaviour pattern Galxe's detector is built to catch — a flagged
   account can still do the tasks but **cannot claim**. Every benefit a bought account promises, a renamed aged
   account already has.
4. **Firewalled from the studio, completely.** Its own Brave profile, its own email, its own device footprint. It
   never touches the Joyisfree handle, business email, phone, domain, card or main browser profile. One person, one
   account, one device; no VPN (Terms section 2 forbids using one to change your apparent location); no bursts; human
   pace.
5. **No automation on the account, ever.** Galxe defines a bot as a program interacting with quests "without real
   human involvement" and flags activity that merely looks scripted, even when done by hand. X allows original
   scheduled posts but forbids bulk or aggressive following, duplicate posts across your own accounts, and bulk,
   keyword or scheduled auto-likes. So: scheduled original posts are fine (Postiz); automated likes, follows, reposts
   and reply rings are never fine. Claude writes and schedules; the clicks and every signature stay Leif's.

## The niche

One account cannot out-shout Crypto Twitter, and it does not need to. It needs to be the obvious voice in one small
room. The room that is actually Leif's: **where physical product meets on-chain** — garment and print design,
phygital drops, proof-of-purchase collectibles, brands that make things rather than tokens. Almost nobody covers it
credibly, Leif has real authority there (a garment-design app and a natural-fibre label), and it is adjacent to the
agency's clients. Mindshare in a small, real room beats noise in a big one, and it is the kind of account a project
running a community track actually wants to pick.

What it posts, in rough proportion:
- **Half: useful, specific craft.** What a print method costs, why a colourway fails on dark fabric, what a drop
  actually sold — the things only someone who makes product knows. This is the authority, and it is free to produce
  because it is already Leif's day job.
- **A third: honest airdrop and quest judgement.** The weekly "real ones only" post, generated from the desk's own
  shortlist (`thread-format.md`), plus the scam-link checker's verdicts. Useful to the room, and it is the desk's
  output rather than extra work.
- **The rest: ordinary presence.** Replies, questions, credit to others. This is what makes an account read as a
  person, which is both the point and the thing the bot detector is looking for the absence of.

Never: engagement bait, reply-guy spam under big accounts, "gm" farming, price calls, referral links, or anything
paid-for-engagement (X's authenticity policy treats coordinated or compensated engagement as severe, and the apps
that paid for posting lost API access in Jan 2026).

## Cadence

A weekly block, in the one pass Leif already does: a handful of original posts scheduled ahead through Postiz, the
weekly honest-airdrop post, and whatever replies happen naturally in the moment. The account ages whether or not it
is farmed; the posting is what makes the age mean something.

## What the account unlocks, in order of how real it is

1. **Quest gates, free.** Age and follower requirements that a new account fails for months — the original problem.
2. **Selection.** Community and discretionary tracks, whitelists, early access: the tier where the real money was.
3. **A media asset for Joyisfree.** The same audience is the agency's and the label's. This is the part that keeps
   paying if Galxe itself goes nowhere, which the evidence says is the likely case.

## What it is honestly worth

No documented per-account Galxe earnings exist. Individual quest prizes run around $10; independent analysis found
only 8 of 62 airdrops in 2024 were positive 90 days after claim, and most recipients sell at once. So the quest income
is expected to be small and may be nothing. The reason to build the account anyway is item 3 above, and item 2 if it
comes. The ledger (`npm run desk:status`) decides on realised dollars at day 30, 60 and 90, and the kill rule ends the
questing without ending the account.
