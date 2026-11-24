# Agency Desk handoff (24 Nov 2026)

Everything from 5 to 23 Nov in one place. Plain words first, then the detail for the next Claude session.
This repo is public, so private things are named by title and place only. There are no names, addresses, rates or
document links here.

## In plain words (for Leif)

- **What it is:** a research team for the influencer marketing agency (IMA). You hunt the brand people and creators.
  The desk does the homework: it reads a creator's last 50 videos or a brand person's own LinkedIn posts, checks
  twice that every detail is really theirs, and gives you a 60-second brief.
- **Where it stopped:**
  - the engine is built and tested on made-up data, and saved online;
  - it has never read one real video, because it is waiting on your free YouTube key.
- **Nothing runs by itself.** Nothing drafts, sends or emails you on its own. A draft is made only when you say "draft
  it", and a sheet you hand over waits until you say go.
- **What's yours:** the short list under "Only Leif" below. The first item, the YouTube key, unlocks everything else.

## Where everything lives

| Place | What is there |
|---|---|
| This repo, branch `claude/influencer-agency-linkedin-personalization-tb9h1m` | The method only: scripts, tests, the five specialists, the skill, these docs |
| The Claude Doc "Joyisfree Personalisation Desk" (private to Leif) | **Board:** one row per person, with Next step and Status, the only place status lives. It holds 19 rows: 5 "Send the draft" and 14 "Wait", each with the reason. **Other tabs:** Creators, Brands, Brands without a hook yet, Website fixes (4 fixes) |
| Drive folder "Joyisfree Agency — Nov 2026" | The private bundle "Agency private bundle (16 Nov).zip" (no YouTube data), the Drafts log of 14 Nov, the packs and kits from 8 to 10 Nov, and the overrides file marked "NOT USABLE (page-read 15 Nov)" |
| Gmail, folder "Joyisfree Drafts" | 19 unsent drafts, as of 16 Nov: 5 ready and 14 on hold. Sending is blocked in `.claude/settings.json` |
| The session scratchpad | Working copies of the sheets, the private term lists and patches. It lasts for one session only, so the Drive bundle is the copy that lasts |

**Never in this repo:** real names, email addresses, rates, pipeline, the YouTube key or any other secret.

## The story, by date

| Date | What happened |
|---|---|
| 5 Nov | The audit of the website and three sheets (332 people across 120 brands). The lines were about products, not people. One creator's number was wrong, there were wrong-company contacts and wrong inboxes, and the warm leads had gone cold waiting on us |
| 8 Nov | The team run (78 helpers): 332 rows, all passing the lint, plus 7 warm-brand Gmail drafts. Rule: **a number is quoted only when it is measured** |
| 9 Nov | Creator check-ins written and reviewed 3 times. Rules: **a creator is named only within 90 days of a yes; a number only within 30 days of a measurement** |
| 10 Nov | The 18 drafts were rewritten in Leif's own voice: short, friendly, one question, an easy way out |
| 12 Nov | "Second me": Claude drafts for every new person, and Leif presses send |
| 14 Nov | The voice check for emails, and a scheduled Mon/Wed/Fri drafting run. Found that 101 of 108 "never contacted" creators had already been emailed. The sheet is not the record; Gmail is |
| 15 Nov | YouTube was opened. The desk read YouTube pages by script, then **withdrew all of it**: YouTube's terms ban scripts on its pages, so the official API is the only door. Plan v3, three reviewers (22 problems), `/joy-revise`, the team's action plan v3.2. **The scheduled drafting was switched off: drafts only on "draft it"** |
| 15–16 Nov | The homework engine was built with tests first: the API door, the digest, the twice-checking, the "personalise" command, the new message checks, the privacy check over history |
| 16 Nov | Stopped on Leif's word. The last half-done piece was finished: the key also works when saved as a variable |
| 23 Nov | Leif: "Stop sending myself emails." Those emails come from the **Dawah Channel** jobs on his Mac, not from this desk. Rule saved: **IMA is the agency; Quran, Sunnah, voice-overs and faceless YouTube content are always the Dawah Channel.** A `/alpha` check and a paste line for the Mac (below) |

## Decisions that hold, and why

1. **YouTube only through the official YouTube Data API**, never its pages. Its terms ban scripts, and its robots.txt
   disallows the search page and the feed.
2. **Claude never opens linkedin.com.** Leif pastes a person's own posts, or screenshots, and the desk digests them.
   A post is referred to by topic and never quoted.
3. **The first message:** one true, dated brand detail, plus one question that is also the consent ask, plus an easy
   opt-out, plus "Leif, Joyisfree Studio". Numbers and creator names wait for the one-pager after a yes. A creator
   with a number fails the lint, and it reads like a mass pitch.
4. **The 2x check.** Check 1 is a script (`provenance.mjs`): every quote is word for word in that person's own
   evidence. Check 2 is the guardian, which is read-only and holds a veto. Both must pass for ✓✓. A detail seen only in
   a screenshot gets one tick at most.
5. **The law.**
   - **Australia (Spam Act):** the sender is named, there is an opt-out, and there is consent before emailing an
     address found on LinkedIn.
   - **Canada (CASL), and any unknown country:** a plain invite with no note; the message waits.
   - **US:** DMs go. US emails wait for a postal line, which goes in last and is never typed into the sheet, because
     that cell wakes the old send engine.
6. **The Board is the only place status lives**, so nobody is messaged twice and Leif keeps no second log.
7. **Nothing automatic.** Drafts only on "draft it", and no emails from Leif's Gmail to himself.
8. **IMA and the Dawah Channel never mix.**

## What's built (`agency-desk/scripts/`, Node 22, no dependencies)

| Script | Its job | Tests |
|---|---|---|
| `youtube-api.mjs` | The only door to YouTube. **Key:** none in code or links, from a network secret or the `YOUTUBE_API_KEY` variable. **Limits:** a unit ledger per Pacific day, capped at 90 searches and 9,000 units. **Stops:** plain-word stops, and a redirect is never followed. `--check` costs 1 unit | `youtube-api.test.mjs` |
| `measure.mjs` | Typical views: the median of the last 12 long videos, each at least 7 days old | `measure.test.mjs` |
| `digest.mjs` | A creator's evidence pack. **Reads:** titles, sponsor lines, announced plans, what fans say (never who), standout videos. **Numbers:** labelled engagement rate, refresh-by +30 days. **LinkedIn:** the reader keeps only the person's own posts | `digest.test.mjs` |
| `provenance.mjs` | Check 1: is every line really this person's? | `provenance.test.mjs` |
| `person.mjs` | The "personalise" command: `--creator`, `--person --brand --paste`, `--brands` (round 2), `--prune` (30 days), `--forget` | `person.test.mjs` |
| `lint-lines.mjs` | Message rules: one question, no numbers or creator names, colleagues never share a DM, the Canada/unknown hold, the email voice check | `lint.test.mjs`, `email-lint.test.mjs` |
| `finalise.mjs` | The honest fallback note and DM, when no hook has passed the checks yet | `finalise.test.mjs` |
| `privacy-gate.mjs` | No real name, address or key in files or in git history (`--history --known`) | `privacy-gate.test.mjs` |
| `worklist.mjs`, `newrows.mjs`, `tracker.mjs`, `roster.mjs`, `audit.mjs` | The work list per company, who is new, the promise tracker, roster truth, the sheet audit | Each has its own test file |
| `pack.mjs` | The old pack-in-the-sheet. **To retire** (step R4) | `pack.test.mjs` |

**The specialists** (`.claude/agents/agency-*.md`):

| Specialist | Tools |
|---|---|
| reader | web only, no write |
| copywriter | read only, no write |
| guardian | read only, with a veto |
| matchmaker | read only |
| critic panel | read only |

`agents.test.mjs` fails if any of them gains write, edit, shell or memory.

The routine is `.claude/skills/agency-personalise/SKILL.md`. The command list is in `README.md`.

## State right now (checked 24 Nov)

- `npm test`: 388 pass, 0 fail.
- Privacy gate: 0 hits on the files.
- `--history` names one old commit, `97f7333`. A second, `9a95ffa`, also still holds those lines. A scrub needs Leif's
  yes.
- The branch is level with the remote, and the working tree is clean.
- The Mon/Wed/Fri drafting task is `enabled:false`.
- Nothing has been sent. The 19 drafts sit unsent, as of 16 Nov.

## What's left, in order

**Claude, only after Leif says go (no key needed):**
- **R2.** Write down the five fallback notes and DMs word for word, and check the README against the code.
- **R3.** `nextStep()` in the work list ("DM now", "Invite + note", "Invite", "Wait"; without Premium, five notes a
  month). A `--board` read-back of Board status into the tracker. The Board writer: do-first order, 20 rows a call.
- **R4.** Move the work-list tests out of `pack.test.mjs`, then retire `pack.mjs`, its npm script and the skill's
  Pack step.
- **R5.**
  - a test that runs the skill's two example DMs through the lint;
  - a "Round 2" section in the skill;
  - the skill's stale steps fixed;
  - `roster.mjs` still says "public feed": reword it.
- **R6.** The jargon check on what Leif reads, then a code review of everything since `37509f5`.
- **R7.** Rewrite `state.md`, the ledger, the final checks, commit and push, and a fresh private bundle in Drive.

**After the key:**
- **S22.** One approval card: allow `www.googleapis.com` and `developers.google.com`, and remove `www.youtube.com`.
  Then `--check`.
- **S23.** Re-measure the 10 creators through the API. The 15 Nov numbers are set aside and are not usable.
- **S24.** The demo creator end to end to ✓✓, with its tab and Board row.
- **S25.** Round 2 for every brand, **only after Leif's yes to the demo**. It runs over about 2 quota days. Nothing is
  drafted or sent, and the sheet is untouched.

**After the LinkedIn Connections file:**
- **S26.** Real titles and who is connected, then the next steps are refreshed.

**Later:**
- **Z1.** Scrub the 2 old commits, after Leif's yes.
- **Z2.** A one-pager the same day someone says yes.
- **Z3.** The first real LinkedIn paste becomes an anonymised test.
- **Z4.** The kill rule: fewer than 5 briefs used in real messages by **29 Nov 2026** means stop building and ask
  what's missing.

## Only Leif

1. **The YouTube key, about 15 minutes. Never in chat.**
   - At console.cloud.google.com, create a project and turn on "YouTube Data API v3".
   - Create an API key limited to that API.
   - Save it in this environment's settings as a Network secret for `www.googleapis.com`, header `X-Goog-Api-Key`.
     If that section isn't offered, save it as the variable `YOUTUBE_API_KEY` instead.
   - A key may only reach a new session.
2. **The LinkedIn Connections file:** Settings → Data privacy → Get a copy of your data → Connections. Drop it in the
   Drive folder.
3. **Read the demo tab for 60 seconds** when it's ready: yes or no. A yes starts round 2.
4. **LinkedIn Premium:** yes or no.
5. **Scrub the 2 old commits that still hold a few real names:** yes or no. Copies already taken can't be recalled.
6. **Any time:** send the 5 ready drafts, and do the 4 website fixes in the Desk doc.
7. **The postal address, last:** a PO box works. Never type it into the sheet.
8. **The Dawah Channel line, pasted into the Dawah session on the Mac.** It stops the emails to yourself and cuts
   your voice-overs at your pauses:

   ```text
   Dawah Channel, 3 changes, then tell me in 3 lines.
   1) Stop every job that emails me ("This week", "claims wait for your verdict", "Script for review", "Something stopped working"). Turn off only those email steps, change nothing else, and tell me in this session instead, never by email.
   2) Voice-overs: I read a Hadith or Quran story in my own voice and pause about 2 seconds between pieces, like last time. Cut the one recording at my pauses (ffmpeg silence detection, merge short breaths, never mid-word, each piece within the Shorts length). The whole recording is the episode, and each piece is a Short. Test it on my next recording before anything is uploaded.
   3) Keep the scholar check and the private-only uploads exactly as they are.
   Save to your memory: IMA is the influencer marketing agency. Anything with Quran, Sunnah or voice, or faceless YouTube content, is always the Dawah Channel.
   Then write today's /alpha card into ALPHA.md in this folder.
   ```

## Rules that are not bent

- No secrets in any file, log or commit. Leif enters keys in the environment settings himself.
- Gmail drafts only. Sending is blocked, and anything visible to others is asked first.
- Spam Act consent before emailing an address found on LinkedIn.
- Nothing from here enters the studio repo, and the studio repo is never touched.
- Run git as `git -C <path> <command>`. No pull request unless Leif asks.
- Tests come first and are shown to fail. Before every push, the staged snapshot is checked alone in a temporary
  worktree.

## Lessons (full lines in `docs/errors.md`)

- **Reading YouTube's pages by script was against its terms.** Check a site's terms and robots.txt before reading it
  by script.
- **A scheduled task outlived the instruction that replaced it.** When a rule changes in conversation, switch off
  everything built on the old rule.
- **A plan reviewed three times by its own author still held 22 problems.** Independent reviewers and refuters find
  what the author can't.
- **A website finding was wrong**, because `&amp;` was stripped before decoding. Decode first, then judge.
- **The sheet said "never contacted", but Gmail said otherwise.** Gmail is the record.
- **Rewriting a draft drops its Gmail label.** Relabel after every rewrite.

## How to resume (a new session)

1. Check out the branch above, and run `npm test`.
2. Get the private files: download "Agency private bundle (16 Nov).zip" from the Drive folder into the scratchpad,
   never into the repo. The term lists for the privacy gate are inside.
3. Run the privacy gate with those lists:
   `npm run agency:privacy -- --names <sheet-names.txt> --terms <terms.txt> agency-desk .claude package.json README.md CLAUDE.md`.
4. Once the key is saved, run:
   `NODE_USE_ENV_PROXY=1 node agency-desk/scripts/youtube-api.mjs --check --ledger <scratch>/units.json`.
   Then go on to step S24, with the commands in `README.md`.
5. Read the Board in the Desk doc before writing anything, because it is the only status.

## Not verified

- Nothing has run against the live YouTube API: there is no key yet.
- Two Google policy pages (quota, and the 30-day rule for API data) were read only through search snippets. S22 opens
  them first-hand.
- The LinkedIn reader has only seen made-up text, not a real paste.
- The Dawah pause-cut is untested. It needs one real recording to tune.
