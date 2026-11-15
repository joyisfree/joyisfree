# The Agency Desk

Leif's braindump, 5 Nov 2026: focus on the influencer marketing agency, build teams, audit everything, and write
personalisations for every brand worker he finds and adds on LinkedIn, to get the agency more deals. Then: "action it
all 100x smarter, more accurate, faster", and "brainstorm 23 ways with our team".

## The idea, said plainly

Leif already does the hard human part: he finds the right person at a brand, or the right creator, and connects.
The desk does the homework he used to do by hand (watching a creator's videos, reading a brand person's posts) and
writes the first message. A first message says:
1. I know your job (when we know it).
2. I know your brand's moment (a creator it featured, a launch, a season), with a link and a date.
3. One question, which is also the consent ask ("If creator partnerships are yours, want a one-pager here or by
   email?"), then an easy way out.

The creator who fits, and every number, wait for the one-pager that goes out after a yes: an address found through
LinkedIn is never emailed without one (Spam Act 2003: Leif sends from Australia). Nothing drafts itself. Leif says
"personalise" and names a person, and a draft is made only when he says "draft it".

## The team (`.claude/agents/`, each with an explicit tools list)

| Specialist | Tools | Owns |
|---|---|---|
| `agency-reader` | WebSearch, WebFetch | Public roles, launches, markets, published partnership addresses. Never YouTube's pages. No write tools, no connectors, no memory. |
| `agency-matchmaker` | Read, Grep, Glob | Roster truth and the one creator who fits (a private line, and the one-pager), or "no honest fit". |
| `agency-copywriter` | Read, Grep, Glob | Note, DM, the one-pager after a yes, subject, in Leif's voice. Never sends, never writes a file. |
| `agency-guardian` | Read, Grep, Glob | Veto: route and consent, truth, that every detail is really that person's (check 2), opt-out, privacy. No memory. |
| `agency-critic-panel` | Read, Grep, Glob | Three seats (a brand's influencer lead, an agency founder, a LinkedIn specialist) on samples. |

`agents.test.mjs` fails if a specialist holds a tool that writes or runs code, or if a brief or the skill still
carries a rule Leif has replaced. New agent files register at the next session start. The routine is the skill
`agency-personalise`.

## Commands (Node 22, no dependencies)

```bash
npm test                     # every agency script, each guard shown to fail on its own case
npm run agency:audit   -- --li <dir> --ima <dir> --out <scratch>      # counts on stdout, names only in --out
npm run agency:worklist -- --li <dir> --ima <dir> --rules <rules.json> --connections <Connections.csv> --out <scratch>/worklist.json
npm run agency:lint    -- --rows <rows.json> --roster <roster.json> --today YYYY-MM-DD   # exit 1 on any bad line
npm run agency:privacy -- --names <people.txt> --terms <brands-and-creators.txt> [--history --known <hash,hash>]
node agency-desk/scripts/roster.mjs --li <dir> --ima <dir> --extra <private.json> --out <scratch>/roster.json
node agency-desk/scripts/finalise.mjs --run <team output.json> --worklist <worklist.json> --roster <roster.public.json> \
     --config <private finalise.json> --today YYYY-MM-DD --out <scratch>/rows.json
node agency-desk/scripts/tracker.mjs add --log <private events.jsonl> --key "Brand | Name" --event reply
node agency-desk/scripts/tracker.mjs status --log <private events.jsonl> --today YYYY-MM-DD   # exit 1 on an overdue promise

# The homework, through the YouTube Data API (the key is saved in the environment, never in a file)
export NODE_USE_ENV_PROXY=1
node agency-desk/scripts/youtube-api.mjs --check --ledger <scratch>/units.json                # "key works · 1 unit"
node agency-desk/scripts/person.mjs --creator @handle --today YYYY-MM-DD --out <scratch>/desk --ledger <scratch>/units.json --terms <private terms.txt>
node agency-desk/scripts/person.mjs --person "Name" --brand "Brand" --paste <file> --today YYYY-MM-DD --out <scratch>/desk --terms <private terms.txt>
node agency-desk/scripts/person.mjs --brands <worklist.json> --limit 40 --today YYYY-MM-DD --out <scratch>/desk --ledger <scratch>/units.json --terms <private terms.txt>
node agency-desk/scripts/provenance.mjs --brief <brief.json> --pack <evidence.json>           # exit 1 on any line that is not theirs
node agency-desk/scripts/measure.mjs --channels <private channels.json> --today YYYY-MM-DD --out <scratch>/measured.json --ledger <scratch>/units.json
```

Every script that writes refuses a path inside this repository. The sheets are exported through the Drive connector
as xlsx into the scratchpad and split into one CSV per tab.

## What the scripts check

- **audit:**
  - duplicate brand labels (autofill copies), the same person twice, personal webmail;
  - addresses on another company's domain;
  - a brand whose IMA website and LinkedIn addresses are two different companies;
  - Invalid addresses;
  - lines that praise a product, claim something about Leif's life, or are placeholders;
  - creator numbers the sheet contradicts;
  - settings typed as dates, a missing postal address, wrong-purpose inboxes and template subjects.
- **roster:**
  - The typical video is the median of the listed recent videos, so one viral video cannot lift it.
  - A creator without a measured list keeps the sheet's figure, labelled "not re-measured".
  - Rates stay private.
- **youtube-api:** the only door to YouTube.
  - It talks to the official YouTube Data API and nowhere else. YouTube's terms ban scripts on its pages, and a test
    fails if any other script fetches anything.
  - The key is never in a link, a file or a log. A link with a key in it throws.
  - A redirect is never followed. A missing key, a spent quota and a network failure are named stops, told in plain
    words.
  - A ledger counts the day's units (a search costs 100, any other call 1) and refuses the 91st search of a Pacific
    day, so a run never ends half-read without saying so.
- **measure:**
  - The median and best of a creator's recent long videos, each at least 7 days old, from the API.
  - A video of three minutes or less might be a Short, so it is left out. Fewer than 6 long videos means no number.
- **digest:** one creator's last 50 uploads, or one person's pasted LinkedIn posts, become evidence items.
  - Each item has an id, its exact words, a link and a date: titles, sponsor lines, standing partners, plans, chapters,
    viewers' comments (never a commenter's name), the creator's own replies.
  - The numbers: typical, average and best views, how often they post, the last upload, and an engagement rate
    labelled "our calculation from YouTube data". Hidden likes mean no rate, never a rate built from zeros.
  - "Mostly Shorts", "comments off" and "not in English" are said as they are. What was not read is "unknown" or
    "not checked", never "none".
  - A pasted LinkedIn page keeps only the person's own posts. Reposts, comments and reactions are dropped as it is
    read, and an age such as "3w" becomes a date range judged by its older end.
  - Health, family hardship, children, religion, politics and money troubles are marked never-a-hook.
- **provenance:** check 1 of the two checks on a brief (the guardian is check 2).
  - Every line cites evidence from that person's own pack, and every quote appears there word for word.
  - An interpretation is labelled "My read:". A viewer's words are never passed off as the creator's.
  - A LinkedIn post is referred to by topic, never quoted. A detail seen only in a screenshot gets one tick at most.
  - "Partnered" needs a sponsor line or YouTube's paid flag. Figures are never typed into a line.
- **person:** the one command behind "personalise".
  - The identity gate: an exact handle from Leif, the sheet's address or domain on the channel, or niche plus
    country. A channel found by name that someone else manages is the wrong person. No match, no card.
  - A brand's channel counts only on a domain or handle match, and a creator's video counts as naming a brand only
    with the whole word plus the brand's domain, its handle or a sponsor line.
  - Evidence is deleted 30 days after it was read (YouTube's policy), and listed for a refresh at 25.
  - Every handle and brand it researches joins the private terms list the privacy gate reads.
- **lint:**
  - Lengths, banned phrases and unconfirmed claims.
  - A note or a DM carries no number and no creator's name. The DM asks exactly one question, which is the consent
    ask, gives an easy way out, and names Leif and Joyisfree Studio.
  - Hooks must carry a source and a date, within a freshness window by kind (sponsor 18 months, launch 6).
  - LinkedIn pages and search pages, YouTube's included, are never a source.
  - A row for someone in Canada, or whose country is unknown, is held (Canada's law covers a LinkedIn message).
  - The route needs a published address with its page, or recorded consent.
  - Colleagues never get the same note, the same DM or the same detail.
  - An email reads like a friend texting: 40 to 70 words, one question, an opt-out, no links, and a postal line for
    a US or Canadian recipient.
- **finalise:**
  - Each row that fails the lint becomes an honest role check (five openers, so colleagues never get the same one).
  - Warm threads, holds, wrong-company contacts and a sixth person at one brand become skips with the reason.
  - A held row is never rewritten: it becomes a bare invite with no note, or waits.
  - It always restarts from the team's rows, so new evidence brings the fuller copy back.
- **tracker:**
  - An append-only log: invite, accept, dm, reply, yes, stop, promise, done.
  - A promise needs a due date, and an overdue one fails the status.
  - After a "stop", nothing more can be added for that person.
  - One follow-up 7 days after an unanswered DM, and only one.
- **privacy:**
  - No real address, person, brand or creator name in a tracked file, and no API key.
  - `--history` scans every line ever committed and names the commit and the file, never the value.
  - It refuses to run without its names and terms lists, because a gate with nothing to look for would pass a leak.
  - Names of three or four letters are matched as written, capital included, because skipping short names let a
    real one through.

## Where data lives

The repository is public: it holds the method only. Names, addresses, replies, rates and the audit details live
in Leif's Google Drive and his private Desk doc (the Board there is the only place a person's status lives).
Working copies sit in the session scratchpad, which is wiped at session end.

## What is Leif's, and only his

- Every click on LinkedIn, Gmail and the sheets.
- Confirming any line that says something about his own life.
- The postal address the engine needs before LIVE. It goes in **last**: an empty address is what keeps the old engine
  from sending its old lines. Fill it only after the sheet fixes and the Mac engine fixes.
- The free YouTube Data API key, saved in the cloud environment's settings and never pasted into a chat.
- Optionally, LinkedIn's "Get a copy of your data" export (Connections), which gives every contact's current
  title in one file.
