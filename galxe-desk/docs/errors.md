# Errors and weaknesses ledger (append only)

Format: `date | fail · seen · turned | what | root cause | status | times | revisit`

2026-10-28 | seen | the cloud environment's network policy blocked galxe.com, docs.galxe.com, help.galxe.com and help.x.com (proxy 403), so no official page could be read live; the scouts worked from search digests | environment allowlist, not an outage | open: Leif said yes to allowing the hosts; the executing session re-checks before any crawl | 3 | 2026-11-04
2026-10-28 | seen | the session's shared web-search budget (200) ran out across three scouts, leaving parts of their briefs unsearched (reddit, X creator revenue share, fashion brands beyond Nike) | one cap shared by all subagents | turned: Context7's index of docs.galxe.com gave verified text for the rulebook first pass; the rest waits for the crawl | 1 | 2026-11-04
2026-10-28 | seen | help-centre articles carry no visible date, so every DIGEST line in RULES.md is RECHECK until the live page is read | Intercom help centre layout | open | 1 | after the first crawl
2026-10-29 | fail | the ledger's "day" test expected calendar days while the code counted elapsed 24-hour periods | an unstated definition | turned: day is now a UTC calendar day, documented in the code; 42 tests green | 1 | -
