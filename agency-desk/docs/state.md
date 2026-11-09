# State — 9 Nov 2026, week 1 actioned (the Agency Desk)
- **Goal:** every brand contact Leif adds on LinkedIn gets a true note and DM that earns a reply; email only after a yes (Spam Act).
- **Done (all real data in Leif's Drive and Gmail drafts, none here):**
  - 18 Gmail drafts, none sent: 7 warm brands (4 carry [WAIT: ...]) and 11 creator check-ins inside their old threads (one new email carries [CHECK: ...]).
  - Three creators who declined our budget get no email. A fourth with no address gets a channel message for Leif to paste.
  - Pack v2: 332 rows, 0 lint errors. Only one names a creator: the one creator with a yes in the last 90 days. 192 rows are honest role checks.
  - Today v2: 10 rows, one per brand, none of them mower brands. Today v1 is marked old in Drive.
  - The Week 1 kit Doc in Drive holds the send order, the sheet fixes, the reply kit and the line for the Mac session.
  - New scripts with tests:
    - `finalise.mjs` (the finishing pass and Today);
    - `measure.mjs` (feed medians, needs YouTube allowed);
    - `tracker.mjs` (promises carry dates, a stop is final).
  - New lint rules, both failing closed: a creator is named only within 90 days of a yes, and a number is quoted only within 30 days of a dated measurement.
  - The privacy gate now catches short names.
- **Honest result:** the notes are true but plain. Confidence is Low, because titles still await Leif's LinkedIn export and creator numbers await fresh screenshots.
- **Next (in order):**
  1. Leif sends the drafts in the kit's order: one warm brand a day, the creators we owe first.
  2. Each creator yes, with its screenshot date, goes into the private roster overrides. Re-run finalise and the fuller notes come back.
  3. The LinkedIn export (Connections, Messages, Invitations): titles for the work list, and the tracker's history.
  4. Allow YouTube in the network settings, then run `measure.mjs` for every roster creator and US scout.
  5. After a mower creator says yes: release the waitFor lane for robot-mower brands.
  6. Weeks 2 to 4 as planned: the price rule, the US creator lane, the reply scoreboard by opener.
- **Blocked:**
  - The website audit and creator measuring: both domains and YouTube are refused by the network policy.
  - LIVE email: the postal address. It goes in **last**, after the sheet fixes and the Mac fixes.
- **For a Mac session** (the old engine's code is on the Mac; its session answers only Leif's trusted devices):
  - the address picker chooses service and support inboxes;
  - SEND_HOURS is stored as a date;
  - one contact list belongs to a different company that shares the name;
  - the Creators tab claims 300k for a creator whose typical video is about 5k;
  - the "Ready" drafts carry the old lines;
  - one time zone is used for every brand;
  - and keep the engine frozen, so a brand that already has a draft never gets the old email as well.
- **Traps:**
  - Start the next session from Leif's private bundle ("Agency private bundle (9 Nov).zip", sent for his Drive folder).
    - Unzip it into the scratchpad and follow its README. Don't re-run the research: it took 171 searches.
    - Only the sheet exports are pulled fresh.
  - Restarts and plan-mode switches pause or drop in-flight calls. Write progress into the plan before each external step, and check list_drafts before creating anything.
  - The Drive connector cannot take a large file, so big workbooks go to Leif as a file.
  - Web searches are capped at about 200 a session.
  - A few real names sit in two earlier pushed commits. Cleaning them needs a force-push on this branch, which needs Leif's yes.
- **Proof:**
  - `npm test`;
  - `npm run agency:privacy -- --names <people> --terms <brands and creators>`: 0 hits;
  - `finalise.mjs ... --today 2026-11-09`: 0 lint errors.
