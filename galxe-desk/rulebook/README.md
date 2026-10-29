# The rulebook

Every official page the desk relies on, read and kept. `sources.json` lists where the crawler looks;
`npm run desk:crawl` fetches every page into `pages/` with its URL, fetch date and hash, writes `INDEX.md`
(every page, FETCHED or MISSING, read or not, and one line on what it means for claiming) and appends
`CHANGES.md` on every re-run. `npm run desk:check` says whether the rulebook is complete: listed = fetched = read,
missing 0.

`RULES.md` and `CLAIMING.md` are the desk's own words, § by §, each line with its source and date. They were
seeded on 28 Oct 2026 from the research digests (search summaries of Galxe's pages) and from the Context7 index of
docs.galxe.com (verified text). They are a **first pass** until the crawl runs and the rules counsel marks every page
read; every line marked RECHECK is to be confirmed against the live page.

The crawl needs network access to galxe.com, docs.galxe.com, help.galxe.com, app.galxe.com and help.x.com. On
28 Oct 2026 this cloud environment blocked them (Leif has said yes to allowing them); the Mac session can run the
same command in the meantime.

Saved pages are Galxe's and X's own text, kept privately as reference material for this desk. Not for redistribution.
