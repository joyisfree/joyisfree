# The Agency Desk

Leif's braindump, 5 Nov 2026: focus on the influencer marketing agency, build teams, audit everything, and write
personalisations for every brand worker he finds and adds on LinkedIn, to get the agency more deals. Then: "action it
all 100x smarter, more accurate, faster", and "brainstorm 23 ways with our team".

## The idea, said plainly

Leif already does the hard human part: he finds the right person at a brand and connects. The desk writes the note that
makes them reply. Every note says three true things:
1. I know your job.
2. I know your brand's moment (a creator it backed, a launch, a season), with a link and a date.
3. Here is the one creator who fits, with the honest number.

Then one easy question. The DM after they accept ends with the consent ask ("Want the one-pager here or by email?"),
because an address found through LinkedIn is never emailed without a yes (Spam Act 2003: Leif sends from Australia).

## The team (`.claude/agents/`, each with an explicit tools list)

| Specialist | Tools | Owns |
|---|---|---|
| `agency-reader` | WebSearch, WebFetch | Public roles, a brand's creator sponsorships, launches, markets, published partnership addresses. No write tools, no connectors, no memory. |
| `agency-matchmaker` | Read, Grep, Glob | Roster truth and the one creator who fits, or "no honest fit". |
| `agency-copywriter` | Read, Grep, Glob, Write | Note, DM, after-yes email opener, subject, in Leif's voice. Never sends. |
| `agency-guardian` | Read, Grep, Glob | Veto: route and consent, truth of numbers and claims, opt-out, privacy. No memory. |
| `agency-critic-panel` | Read, Grep, Glob | Three seats (a brand's influencer lead, an agency founder, a LinkedIn specialist) on samples. |

New agent files register at the next session start. Until then, every helper runs as `galxe-reader`, which also has
no write tools and none of Leif's connectors. The routine is the skill `agency-personalise`.

## Commands (Node 22, no dependencies)

```bash
npm test                     # every agency script, each guard shown to fail on its own case
npm run agency:audit   -- --li <dir> --ima <dir> --out <scratch>      # counts on stdout, names only in --out
npm run agency:worklist -- --li <dir> --ima <dir> --rules <rules.json> --connections <Connections.csv> --out <scratch>/worklist.json
npm run agency:lint    -- --rows <rows.json> --roster <roster.json> --today YYYY-MM-DD   # exit 1 on any bad line
npm run agency:pack    -- --sheet1 <Sheet1.csv> --rows <rows.json> --out <scratch>/pack.csv [--diff <old pack.csv>]
npm run agency:privacy -- --names <people.txt> --terms <brands-and-creators.txt>          # exit 1 on any hit
node agency-desk/scripts/roster.mjs --li <dir> --ima <dir> --extra <private.json> --out <scratch>/roster.json
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
- **lint:**
  - Lengths, banned phrases and unconfirmed claims.
  - Numbers must match the roster.
  - One creator per message.
  - Hooks must carry a source and a date, within a freshness window by kind (sponsor 18 months, launch 6).
  - LinkedIn and search pages are never a source.
  - The DM must carry the consent ask and an opt-out.
  - The route needs a published address with its page, or recorded consent.
  - Colleagues never get the same note.
- **pack:** keeps Sheet1's row order with a key column, defuses cell text that would run as a formula, and shows
  missing, orphan and changed rows.
- **privacy:** no real address, person, brand or creator name in a tracked file.

## Where data lives

The repository is public: it holds the method only. Names, addresses, replies, rates, the pack and the audit
details live in Leif's Google Drive, and working copies sit in the session scratchpad (wiped at session end).

## What is Leif's, and only his

- Every click on LinkedIn, Gmail and the sheets.
- Confirming any line that says something about his own life.
- The postal address the engine needs before LIVE.
- Allowing the website domains in the cloud environment so the website audit can run.
- Optionally, LinkedIn's "Get a copy of your data" export (Connections), which gives every contact's current
  title in one file.
