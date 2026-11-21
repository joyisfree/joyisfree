#!/usr/bin/env node
// Mutation test: every guard listed below is removed, one at a time, in a throwaway copy of the scripts, and the
// test suite is run against that copy. A guard "bites" only if some test turns red when it is gone. A guard that
// survives its removal with the suite still green is a guard with no test behind it, and this command exits 1 and
// names it. This is how "the guards are shown to fail" (studio rule 3) is proven by one command, not asserted.
//
//   node galxe-desk/scripts/mutate.mjs                        # every mutation, four suites at a time
//   node galxe-desk/scripts/mutate.mjs --only agency,ledger   # those whose file path contains a term; a term that
//                                                             # selects nothing is refused, never "0 of 0"
//   node galxe-desk/scripts/mutate.mjs --since origin/main    # only those a change since that commit can reach; a
//                                                             # change to this file's SUITES, SUITE_FOR, READS,
//                                                             # relPath or SKIP reaches every one
//   node galxe-desk/scripts/mutate.mjs --add lines.json --group "<one line>"   # check, run, then write a batch
//   node galxe-desk/scripts/mutate.mjs --list                 # just list them (after --only and --since)
//   --jobs N (1 to 16, default 4 or fewer CPUs), --timeout-ms N (per suite run, default 120000), --verbose
//   (every result in list order, so --jobs 1 and --jobs 4 print the same bytes)
//
// Each mutation is a single, exact string swap that neutralises one guard. `from` must occur once in its file.
// It covers the whole repo, not only the desk: a bare file name means galxe-desk/scripts/<name>; anything with a
// slash is a path from the repo root. Each mutation runs in a full throwaway copy of the repo, against the test
// suite of the file (SUITE_FOR) or else of the directory it lives in (SUITES).
//
// Only KILLED counts: the suite exited 1 with a failed test in its TAP summary. A suite that stays green is
// SURVIVED; one past its deadline is TIMEOUT; a signal, an output overflow or any other exit is CRASHED. Every
// suite is first run once unmutated, and a suite that is not green then makes each of its mutations BASELINE_RED,
// because a test that was already red proves nothing about the guard. So no crash, hang or red-before-the-change
// can ever read as "every guard bites".
//
// A guard of this file needs a `from` that does not also match its own line in MUTATIONS, so each one ends in a line
// break or holds a backslash or a double quote, all of which the JSON of that line escapes (--add checks this).
// No two lines may leave their file byte-identical: that is one guard under two names, counted twice in "N of N"
// (--add refuses such a line, and mutate.test.mjs checks the whole list).

import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join, dirname, basename, resolve, relative, sep, isAbsolute, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(DIR, '..', '..');
export const SELF_REL = 'galxe-desk/scripts/mutate.mjs';

// The test files each directory's guards are judged by. A spawned child would not expand a '*.test.mjs' glob
// without a shell, so they are listed; a missing file is skipped, and a directory whose suite is empty refuses.
export const SUITES = {
  'galxe-desk/scripts': ['gate.test.mjs', 'ledger.test.mjs', 'crawl.test.mjs', 'do-card.test.mjs', 'verify-link.test.mjs', 'gigapot.test.mjs', 'agents.test.mjs', 'decision.test.mjs'],
  'agency/scripts': ['ab-test.test.mjs', 'creator-pilot.test.mjs', 'orders.test.mjs', 'realised.test.mjs'],
  '.claude/skills/joy-revise/scripts': ['worth-it.test.mjs'],
  scripts: ['prove.test.mjs'],
  'claude-setup/skills/joy-boot/scripts': ['boot.test.mjs'],
};

// A file judged by its own suite, not its folder's (paths from the repo root). This beats SUITES: mutate.mjs's own
// guards are judged by mutate.test.mjs alone, so the desk's mutations never pay for it. A listed test file that
// does not exist yet is skipped, and a file whose suite is then empty is NO_SUITE, never its folder's suite.
export const SUITE_FOR = {
  'galxe-desk/scripts/mutate.mjs': ['galxe-desk/scripts/mutate.test.mjs'],
  '.claude/hooks/guard.mjs': ['.claude/hooks/guard.test.mjs'],
  '.claude/workflows/fix-verify.js': ['scripts/workflows.test.mjs'],
  '.claude/workflows/review-3x.js': ['scripts/workflows.test.mjs'],
  'scripts/corpus/corpus.mjs': ['scripts/prove.test.mjs'],
};

// Files a folder's tests read that neither an import nor the folder's own top level shows (for --since). An entry
// ending in "/" covers everything under that folder: agents.test.mjs checks every file in .claude/agents.
export const READS = {
  '.claude/skills/joy-revise/scripts': ['galxe-desk/docs/decision-2026-10-31.json'],
  'galxe-desk/scripts': ['.claude/agents/'],
};

export const relPath = (file) => (file.includes('/') ? file : `galxe-desk/scripts/${file}`);

// Never copied into a mutation's throwaway repo: history, dependencies, fetched pages, the pilot's private data and
// other worktrees (a worktree of this repo lives under .claude/worktrees and is a whole second copy).
const SKIP = ['.git', 'node_modules', join('galxe-desk', 'rulebook', 'pages'), join('agency', 'pilot'), join('.claude', 'worktrees')];

// name | file | from (exact, unique) | to
export const MUTATIONS = [
  // rank.mjs — the Prize Gate
  ['worthless reward', 'rank.mjs', 'if (!published) return { reasons:', 'if (false) return { reasons:'],
  ['official eligibility false', 'rank.mjs', "if (r.eligible === false) reasons.push", "if (false) reasons.push"],
  ['claim chain missing', 'rank.mjs', "if (!r.claimChain) reasons.push('CLAIM_PATH_UNKNOWN: chain')", "if (false) reasons.push('CLAIM_PATH_UNKNOWN: chain')"],
  ['no gas on claim chain', 'rank.mjs', "else if (!(account.chains || {})[r.claimChain]) reasons.push", "else if (false) reasons.push"],
  ['claim window missing or non-numeric', 'rank.mjs', "if (r.claimWindowDays == null || !Number.isFinite(Number(r.claimWindowDays))) reasons.push", "if (false) reasons.push"],
  ['claim fee missing or non-numeric', 'rank.mjs', "if (r.claimFeeUsd == null || !Number.isFinite(Number(r.claimFeeUsd))) reasons.push", "if (false) reasons.push"],
  ['claim gas non-numeric', 'rank.mjs', "if (r.gasUsd != null && !Number.isFinite(Number(r.gasUsd))) reasons.push", "if (false) reasons.push"],
  ['first-come-first-served speed game', 'rank.mjs', "if (r.split === 'fcfs') {", "if (false) {"],
  ['low expected value', 'rank.mjs', "else if (ev.net < threshold) reasons.push", "else if (false) reasons.push"],
  ['participants unknown', 'rank.mjs', "if (p == null || !Number.isFinite(Number(p))) reasons.push('LOW_EV: participants unknown')", "if (false) reasons.push('LOW_EV: participants unknown')"],
  ['net EV is NaN (unknown cost)', 'rank.mjs', 'if (!Number.isFinite(net)) return null;', 'if (false) return null;'],
  ['haircut on unlaunched token', 'rank.mjs', 'if (r.tokenLaunched !== true || r.vesting === true) net *= haircut;', 'if (false) net *= haircut;'],
  ['raffle prize cap', 'rank.mjs', 'gross = prize * Math.min(1, Number(r.winners ?? NaN) / n);', 'gross = prize * (Number(r.winners ?? NaN) / n);'],
  ['status not Active', 'rank.mjs', "if (c.status !== 'Active') reasons.push", "if (false) reasons.push"],
  ['not started yet', 'rank.mjs', "if (Number.isFinite(start) && now < start) reasons.push", "if (false) reasons.push"],
  ['ended already', 'rank.mjs', "if (Number.isFinite(end) && now > end) reasons.push", "if (false) reasons.push"],
  ['cap reached', 'rank.mjs', "if (Number(c.cap) > 0 && Number(participantsOf(c)) >= Number(c.cap)) reasons.push", "if (false) reasons.push"],
  ['requirements not recorded', 'rank.mjs', "if (!c.requirements || typeof c.requirements !== 'object' || Array.isArray(c.requirements)) reasons.push", "if (false) reasons.push"],
  ['requirement not understood', 'rank.mjs', "for (const k of Object.keys(q)) if (!KNOWN_REQ.has(k)) reasons.push", "for (const k of []) if (!KNOWN_REQ.has(k)) reasons.push"],
  ['numeric requirement unknown', 'rank.mjs', "for (const f of ['xAgeMonths', 'xFollowers', 'scoreHumanity']) {", "for (const f of []) {"],
  ['boolean requirement unknown', 'rank.mjs', "for (const f of ['blueCheck', 'passport']) {", "for (const f of []) {"],
  ['holdings not an array', 'rank.mjs', "if ('holdings' in q && !Array.isArray(q.holdings)) reasons.push", "if (false) reasons.push"],
  ['X age gate', 'rank.mjs', 'if (Number(q.xAgeMonths || 0) > Number(account.xAgeMonths || 0)) reasons.push', 'if (false) reasons.push'],
  ['followers gate', 'rank.mjs', 'if (Number(q.xFollowers || 0) > Number(account.xFollowers || 0)) reasons.push', 'if (false) reasons.push'],
  ['passport gate', 'rank.mjs', "if (q.passport && !account.passport) reasons.push", "if (false) reasons.push"],
  ['excluded countries', 'rank.mjs', "if ('excludedCountries' in q) {", "if (false) {"],
  ['project KYC', 'rank.mjs', "if ('kyc' in q && typeof q.kyc !== 'boolean') reasons.push('INELIGIBLE: kyc unknown')", "if (false) reasons.push('INELIGIBLE: kyc unknown')"],
  ['lookalike or non-http URL', 'rank.mjs', "if (!parsed || !/^https?:$/.test(parsed.protocol)) reasons.push", "if (false) reasons.push"],
  ['lookalike hostname', 'rank.mjs', 'else if (!GENUINE_HOSTS.has(parsed.hostname)) reasons.push', 'else if (false) reasons.push'],
  ['unverified project', 'rank.mjs', 'if (!credible) reasons.push', 'if (false) reasons.push'],
  ['on-chain task cost unrecorded', 'rank.mjs', "if (onChain && (c.capitalUsd == null || c.taskGasUsd == null)) reasons.push", "if (false) reasons.push"],
  ['capital above cap', 'rank.mjs', 'else if (Number(c.capitalUsd || 0) > cap) reasons.push', 'else if (false) reasons.push'],
  ['task gas non-numeric', 'rank.mjs', "if (c.taskGasUsd != null && !Number.isFinite(Number(c.taskGasUsd))) reasons.push", "if (false) reasons.push"],
  ['minutes over cap', 'rank.mjs', 'else if (Number(c.minutes) > mcap) reasons.push', 'else if (false) reasons.push'],
  // ledger.mjs
  ['unknown ledger action', 'ledger.mjs', 'if (!ACTIONS.has(e.action)) throw', 'if (false) throw'],
  ['ledger quest id required', 'ledger.mjs', "if (!e.quest) throw", "if (false) throw"],
  ['ledger ts is a date', 'ledger.mjs', 'if (!e.ts || Number.isNaN(Date.parse(e.ts))) throw', 'if (false) throw'],
  ['win needs a real date deadline', 'ledger.mjs', "if (e.action === 'won' && (!e.deadline || Number.isNaN(Date.parse(e.deadline)))) throw", "if (false) throw"],
  ['kill: flag stops at once', 'ledger.mjs', 'if (flags.length) kill =', 'if (false) kill ='],
  ['kill: day 30 under floor', 'ledger.mjs', 'else if (day >= 30 && realisedUsd < day30Min) kill =', 'else if (false) kill ='],
  ['kill: day 60 under hourly bar', 'ledger.mjs', 'else if (day >= 60 && (perHour == null || perHour < minPerHour)) kill =', 'else if (false) kill ='],
  // rulebook-crawl.mjs
  ['empty index not complete', 'rulebook-crawl.mjs', 'complete: listed > 0 && missing === 0', 'complete: missing === 0'],
  ['CRLF rows still parse', 'rulebook-crawl.mjs', "const line = raw.replace(/\\r$/, '');", 'const line = raw;'],
  ['carry hash forward on MISSING', 'rulebook-crawl.mjs', "let row = { url, status: 'MISSING', sha: prev?.sha || ''", "let row = { url, status: 'MISSING', sha: ''"],
  ['changed page marked unread', 'rulebook-crawl.mjs', "changes.push(`${when} | CHANGED | ${url}`); row.read = ''; }", "changes.push(`${when} | CHANGED | ${url}`); }"],
  ['rule files must exist', 'rulebook-crawl.mjs', 'unconfirmed === 0 && filesMissing.length === 0', 'unconfirmed === 0'],
  // do-card.mjs
  ['a flag stops the Do card', 'do-card.mjs', "if (kill && kill !== 'CONTINUE') {", 'if (false) {'],
  ['defang non-Galxe links', 'do-card.mjs', 'return String(s).replace(/https?:\\/\\/[^\\s)]+/gi,', 'return String(s).replace(/zzzzzzzz/gi,'],
  ['the claim clock shows OVERDUE', 'do-card.mjs', 'if (overdue.length) {', 'if (false) {'],
  ['the claim clock shows what is due', 'do-card.mjs', 'if (due.length) {', 'if (false) {'],
  // rank.mjs, the watchlist view
  ['watchlist caps the list at --top N', 'rank.mjs', 'const shown = Number(top) > 0 ? passed.slice(0, Number(top)) : passed;', 'const shown = passed;'],
  // verify-link.mjs, the scam-link checker
  ['non-http scheme refused', 'verify-link.mjs', "if (!/^https?$/.test(scheme)) {", 'if (false) {'],
  ['credential decoy before the @', 'verify-link.mjs', 'if (u.username || u.password) {', 'if (false) {'],
  ['punycode homoglyph host', 'verify-link.mjs', "if (host.split('.').some((label) => label.startsWith('xn--'))) {", 'if (false) {'],
  ['known drainer host', 'verify-link.mjs', 'if (KNOWN_SCAM_HOSTS.has(host)) {', 'if (false) {'],
  ['official but not the quest app', 'verify-link.mjs', 'if (OFFICIAL_NON_QUEST_HOSTS.has(host)) {', 'if (false) {'],
  ['an unknown galxe.com subdomain is not claimable', 'verify-link.mjs', 'if (isGalxeDomain(host)) {', 'if (false) {'],
  ['a name-borrowing lookalike', 'verify-link.mjs', 'if (/galxe|galaxe|ga1xe|galxee/.test(host)) {', 'if (false) {'],
  ['only the genuine host is safe', 'verify-link.mjs', "return { verdict: 'GENUINE', reason: `${host} is the real Galxe quest app`, host, scheme, safe: true };", "return { verdict: 'GENUINE', reason: `${host} is the real Galxe quest app`, host, scheme, safe: false };"],
  // gigapot.mjs
  ['an unpriceable lottery is refused', 'gigapot.mjs', 'if (missing.length) {', 'if (false) {'],
  ['GG is never priced from a non-number', 'gigapot.mjs', 'if (!Number.isFinite(n) || n < 0) return null;', 'if (false) return null;'],
  // .claude/skills/joy-revise/scripts/worth-it.mjs — the positive-move verdict
  ...[
    ['unknowns must be an explicit list', "if (!Array.isArray(d.unknowns)) cannot.push(", 'if (false) cannot.push('],
    ['a named unknown refuses the verdict', 'for (const u of unknowns) cannot.push(`unknown: ${u}`);', 'for (const u of []) cannot.push(`unknown: ${u}`);'],
    ['a missing number is never zero', 'if (!Number.isFinite(v[key])) cannot.push(', 'if (false) cannot.push('],
    ['probability stays between 0 and 1', 'if (Number.isFinite(v.probability) && (v.probability < 0 || v.probability > 1)) {', 'if (false) {'],
    ['haircut stays between 0 and 1', 'if (!Number.isFinite(haircut) || haircut < 0 || haircut > 1) cannot.push(', 'if (false) cannot.push('],
    ['capital at risk is never assumed zero', 'if (!Number.isFinite(capital) || capital < 0) cannot.push(', 'if (false) cannot.push('],
    ['the cheapest decisive test is required', "if (!String(d.cheapestTest ?? '').trim()) {", 'if (false) {'],
    ['no kill rule, no verdict', "if (!String(k.metric ?? '').trim() || !Number.isFinite(killNumber) || !String(k.by ?? '').trim()) {", 'if (false) {'],
    ['capital at risk is counted in full', 'const netUsd = evUsd - v.costs - timeCostUsd - capital;', 'const netUsd = evUsd - v.costs - timeCostUsd;'],
  ].map(([name, from, to]) => [name, '.claude/skills/joy-revise/scripts/worth-it.mjs', from, to]),
  // agents.mjs — the reader/writer firewall over .claude/agents
  ['web reader may not also act', 'agents.mjs', 'if (web.length && write.length) out.push(', 'if (false) out.push('],
  ['web reader may not hold project memory', 'agents.mjs', "if (web.length && memory === 'project') out.push(", 'if (false) out.push('],
  ['an agent must list its tools', 'agents.mjs', "if (!tools.length) return ['no explicit tools line", "if (false) return ['no explicit tools line"],
  ['no frontmatter fails closed', 'agents.mjs', "if (!fm) return ['no frontmatter", "if (false) return ['no frontmatter"],
  ['MCP tools count as outside content', 'agents.mjs', "|| t.startsWith('mcp__');", '|| false;'],
  // agency/scripts/ab-test.mjs — the pre-registered A/B analyser
  ...[
    ['baseline rate must be a real rate', 'if (!(baseline > 0 && baseline < 1)) problems.push("preRegistered.baselineRate', 'if (false) problems.push("preRegistered.baselineRate'],
    ['the minimum lift must be stated', "if (!(minLift > 0)) problems.push('preRegistered.minLiftPct", "if (false) problems.push('preRegistered.minLiftPct"],
    ['the planned arm size must be stated', "if (!(planned > 0)) problems.push('preRegistered.plannedPerArm", "if (false) problems.push('preRegistered.plannedPerArm"],
    ['a rule cannot be fixed in the future', 'else if (isFuture(decided, now)) problems.push(', 'else if (false) problems.push('],
    ['the one look falls after the conversion window', 'if (!ready) problems.push(`preRegistered.analyseOn', 'if (false) problems.push(`preRegistered.analyseOn'],
    ['arm names must be distinct', 'if (names[0] && names[1] && names[0].toLowerCase() === names[1].toLowerCase()) problems.push(', 'if (false) problems.push('],
    ['conversions are a whole count, never blank', 'if (!(conversions >= 0)) problems.push(', 'if (false) problems.push('],
    ['no more conversions than recipients', 'if (recipients > 0 && conversions >= 0 && conversions > recipients) problems.push(', 'if (false) problems.push('],
    ['orders with $0 revenue are refused', 'if (conversions > 0 && revenueCents === 0) problems.push(', 'if (false) problems.push('],
    ['revenue with no orders is refused', 'if (conversions === 0 && revenueCents > 0) problems.push(', 'if (false) problems.push('],
    ['the sample must reach the planned size', 'if (smallest < plan.need) reasons.push(', 'if (false) reasons.push('],
    ['the 10-expected-conversions floor', 'if (expected < MIN_EXPECTED_CONVERSIONS) reasons.push(', 'if (false) reasons.push('],
    ['preflight: --metric must be known', 'if (!known) problems.push(`--metric', 'if (false) problems.push(`--metric'],
    ['preflight: --min-lift must be above 0', "if (!(lift > 0)) problems.push('--min-lift", "if (false) problems.push('--min-lift"],
  ].map(([name, from, to]) => [name, 'agency/scripts/ab-test.mjs', from, to]),
  // agency/scripts/creator-pilot.mjs — pay only on verified results, inside the cap
  ...[
    ['a duplicate order id is never paid twice', "if (firstLine.get(`order ${e.orderId}`) !== i) return 'DUPLICATE_ORDER_ID';", "if (false) return 'DUPLICATE_ORDER_ID';"],
    ['an order must come from the store export', "if (e.source !== 'store') return 'UNSOURCED';", "if (false) return 'UNSOURCED';"],
    ['an unknown code is unpaid', "if (!c) return 'UNKNOWN_CODE';", "if (false) return 'UNKNOWN_CODE';"],
    ['no order before its creator joined', "if (c.pos > pos) return 'BEFORE_CREATOR';", "if (false) return 'BEFORE_CREATOR';"],
    ['only orders inside days 1 to 60', "if (r.day < 1 || r.day > pilot.days) return 'OUTSIDE_WINDOW';", "if (false) return 'OUTSIDE_WINDOW';"],
    ['a stopped or flagged creator earns nothing more', "if (programmeFlag || stops[c.id]) return 'CREATOR_STOPPED';", "if (false) return 'CREATOR_STOPPED';"],
    ['a creator buying with their own code is unpaid', "if (c.selfIds.has(who)) return 'SELF_USE';", "if (false) return 'SELF_USE';"],
    ['an uncompleted sign-up is unpaid', "if (e.completed !== true) return 'NOT_COMPLETED';", "if (false) return 'NOT_COMPLETED';"],
    ['one account signs up once', "if (hasAccount && seenAccounts.has(e.account)) return 'DUPLICATE_ACCOUNT';", "if (false) return 'DUPLICATE_ACCOUNT';"],
    ['results past the cap are CAPPED', "if (room <= 0) r.reason = 'CAPPED';", "if (false) r.reason = 'CAPPED';"],
    ['payouts never exceed the cap', 'if (paid > toCents(pilot.capUsd)) problems.push(', 'if (false) problems.push('],
    ['a payment reference is used once', 'if (refs.has(e.ref)) problems.push(', 'if (false) problems.push('],
    ['refunds never exceed the order', 'if (orderValue.has(e.orderId) && total > orderValue.get(e.orderId)) problems.push(', 'if (false) problems.push('],
    ['a creator code is unique', 'if (codes.has(normCode(e.code))) problems.push(', 'if (false) problems.push('],
    ['the creator limit holds', 'if (ids.size > pilot.maxCreators) problems.push(', 'if (false) problems.push('],
    ['an id has one spelling only', 'if (normId(e[f]) !== e[f]) throw new Error(', 'if (false) throw new Error('],
    ['no raw email ever enters the ledger', "if (v.includes('@')) throw new Error(`a raw email", "if (false) throw new Error(`a raw email"],
    ['reach is never paid', "if (e.basis !== undefined && e.basis !== 'result') throw new Error(`reach is never paid", "if (false) throw new Error(`reach is never paid"],
    ['a programme flag holds every payout', "if (sc.programmeFlag) return { ...base, verdict: 'STOP_FLAG'", "if (false) return { ...base, verdict: 'STOP_FLAG'"],
  ].map(([name, from, to]) => [name, 'agency/scripts/creator-pilot.mjs', from, to]),
  // agency/scripts/orders.mjs — the 90-day order export, refused rather than estimated
  ...[
    ['mixed currencies are refused', 'if (currencies.length > 1) {', 'if (false) {'],
    ['under 30 orders gives no threshold', 'if (counted.length < MIN_ORDERS) {', 'if (false) {'],
    ['the AOV is fixed before the pilot starts', 'if (startDay <= now) return no(', 'if (false) return no('],
    ['the pilot must have a start date', "if (Number.isNaN(start)) return no('pilot.startDate", "if (false) return no('pilot.startDate"],
    ['nothing with an @ reaches the screen', "if (`${stdout}${stderr}`.includes('@')) return", 'if (false) return'],
    ['an email used as an order id is refused', "if (id.includes('@')) {", 'if (false) {'],
    ['an order with no status is refused', 'if (status === undefined) problems.push(', 'if (false) problems.push('],
    ['an unknown status is refused', 'else if (!Object.hasOwn(STATUS, status)) problems.push(', 'else if (false) problems.push('],
    ['a day/month date is refused', 'if (day === undefined) problems.push(', 'if (false) problems.push('],
    ['two values for one order are refused', 'else if (had.v !== v) problems.push(', 'else if (false) problems.push('],
    ['an order needs a currency code', 'if (!/^[A-Z]{3}$/.test(currency)) problems.push(', 'if (false) problems.push('],
    ['an unclosed quote is refused', "if (state === 'quoted') throw new CsvError(", 'if (false) throw new CsvError('],
    ['the threshold rounds up, never down', 'export const thresholdCents = (p80Cents) => Math.ceil(p80Cents / STEP_CENTS) * STEP_CENTS;', 'export const thresholdCents = (p80Cents) => Math.floor(p80Cents / STEP_CENTS) * STEP_CENTS;'],
  ].map(([name, from, to]) => [name, 'agency/scripts/orders.mjs', from, to]),
  // scripts/prove.mjs — the secret scanner
  // galxe-desk/scripts/ledger.mjs and do-card.mjs — the standing decision stops the refused lane (8 Nov 2026)
  ["the standing decision outranks CONTINUE","galxe-desk/scripts/ledger.mjs","const kill = s.flags > 0 ? s.kill : stop || s.kill;","const kill = s.kill;"],
  ["the decision never hides a flag","galxe-desk/scripts/ledger.mjs","s.flags > 0 ? s.kill :","false ? s.kill :"],
  ["desk:status reads the standing decision","galxe-desk/scripts/ledger.mjs","const s = withDecision(status(parseLedger(text), rules), decisionStop(readDecision(o.decision || DECISION_FILE)));","const s = status(parseLedger(text), rules);"],
  ["a missing or unreadable decision fails closed","galxe-desk/scripts/ledger.mjs","if (read?.error) return `STOP_DECISION: ${read.error}, so the lane is treated as stopped`;","if (read?.error) return null;"],
  ["a missing decision file is a stop, not a crash","galxe-desk/scripts/ledger.mjs","try { text = readFileSync(path, 'utf8'); } catch (err) { return { error: `the decision record ${path} could not be read (${err.code || err.message})` }; }","text = readFileSync(path, 'utf8');"],
  ["a decision file that is not JSON is a stop, not a crash","galxe-desk/scripts/ledger.mjs","try { return { decision: JSON.parse(text) }; } catch (err) { return { error: `the decision record ${path} is not valid JSON (${err.message})` }; }","return { decision: JSON.parse(text) };"],
  ["a decision that is not an object is a stop","galxe-desk/scripts/ledger.mjs","return 'STOP_DECISION: the decision record is not an object, so the lane is treated as stopped';","return null;"],
  ["a decision about another lane does not open this one","galxe-desk/scripts/ledger.mjs","if (d.lane !== LANE) return","if (false) return"],
  ["a refusal names its date, record and reopening","galxe-desk/scripts/ledger.mjs","if (d.verdict === 'REFUSED') return","if (false) return"],
  ["a reopening needs its date","galxe-desk/scripts/ledger.mjs","&& reopenedWhen(d.reopenedOn, today) && inWords","&& inWords"],
  ["a reopening needs Leif's own words","galxe-desk/scripts/ledger.mjs","reopenedWhen(d.reopenedOn, today) && inWords(d.leifsWords)) return null;","reopenedWhen(d.reopenedOn, today)) return null;"],
  ["a reopening date is YYYY-MM-DD, not whatever Date.parse reads","galxe-desk/scripts/ledger.mjs","if (!m) return false;","if (!m) return !Number.isNaN(Date.parse(v));"],
  ["a reopening date is a real day, never 30 February","galxe-desk/scripts/ledger.mjs","return d.toISOString().slice(0, 10) === v;","return true;"],
  ["a reopening comes after the refusal","galxe-desk/scripts/ledger.mjs","isDay(v) && v > REFUSED_ON && v <= today","isDay(v) && v <= today"],
  ["a reopening is never dated after today","galxe-desk/scripts/ledger.mjs","isDay(v) && v > REFUSED_ON && v <= today","isDay(v) && v > REFUSED_ON"],
  ["Leif's words are words, not a flag","galxe-desk/scripts/ledger.mjs","const inWords = (v) => typeof v === 'string' && v.trim() !== '';","const inWords = (v) => String(v ?? '').trim() !== '';"],
  ["a malformed reopening says what it lacks","galxe-desk/scripts/ledger.mjs","if (d.verdict === 'REOPENED') return `STOP_DECISION: a reopening needs","if (false) return `STOP_DECISION: a reopening needs"],
  ["an unknown verdict is a stop, never open","galxe-desk/scripts/ledger.mjs","return `STOP_DECISION: the decision record's verdict ${JSON.stringify(d.verdict)} is not REFUSED or REOPENED, so the lane is treated as stopped`;","return null;"],
  ["desk:status prints the decision beside a flag","galxe-desk/scripts/ledger.mjs","if (s.decision && s.decision !== s.kill) lines.push(","if (false) lines.push("],
  ["the Do card reads the standing decision","galxe-desk/scripts/do-card.mjs","const s = withDecision(status(entries, account.killRules), decisionStop(readDecision(arg('decision', DECISION_FILE))));","const s = status(entries, account.killRules);"],
  ["a refused lane is not sent to the critic panel","galxe-desk/scripts/do-card.mjs","const closed = String(kill).startsWith('STOP_DECISION');","const closed = false;"],
  ["a flagged card still names the decision","galxe-desk/scripts/do-card.mjs","if (decision && decision !== kill) why.push(","if (false) why.push("],
  ["a stopped card needs no shortlist","galxe-desk/scripts/do-card.mjs","const shortlist = kill === 'CONTINUE' ? JSON.parse(readFileSync(arg('shortlist', 'galxe-desk/shortlist.json'), 'utf8')) : { passed: [] };","const shortlist = JSON.parse(readFileSync(arg('shortlist', 'galxe-desk/shortlist.json'), 'utf8'));"],
  // .claude/skills/joy-revise/scripts/worth-it.mjs — strict dates, honest tests, the stored hourly bar (8 Nov 2026)
  ["the kill date must be a strict YYYY-MM-DD date",".claude/skills/joy-revise/scripts/worth-it.mjs","if (by == null) cannot.push(","if (false) cannot.push("],
  ["strict dates are round-trip checked",".claude/skills/joy-revise/scripts/worth-it.mjs","if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) return null;","if (!Number.isFinite(ms)) return null;"],
  ["today is read in Sydney, not UTC",".claude/skills/joy-revise/scripts/worth-it.mjs","timeZone: 'Australia/Sydney'","timeZone: 'UTC'"],
  ["an unreadable clock refuses",".claude/skills/joy-revise/scripts/worth-it.mjs","if (today == null) cannot.push(","if (false) cannot.push("],
  ["the kill date must be after today",".claude/skills/joy-revise/scripts/worth-it.mjs","else if (asOf != null && by <= asOf) cannot.push(","else if (false) cannot.push("],
  ["the kill date is at most 180 days out",".claude/skills/joy-revise/scripts/worth-it.mjs","else if (asOf != null && by - asOf > MAX_KILL_DAYS) cannot.push(","else if (false) cannot.push("],
  ["decidedOn must be a strict date",".claude/skills/joy-revise/scripts/worth-it.mjs","if (dec == null) cannot.push(","if (false) cannot.push("],
  ["a decision cannot be dated in the future",".claude/skills/joy-revise/scripts/worth-it.mjs","else if (today != null && dec > today) cannot.push(","else if (false) cannot.push("],
  ["a passed kill date can never approve",".claude/skills/joy-revise/scripts/worth-it.mjs","if (expired && netUsd >= 0) {","if (false) {"],
  ["the cheapest test needs four words or a command",".claude/skills/joy-revise/scripts/worth-it.mjs","} else if (typeof d.cheapestTest !== 'string' || (words(d.cheapestTest) < MIN_TEST_WORDS && !namesCommand(d.cheapestTest))) {","} else if (false) {"],
  ["a word carries a letter or a digit",".claude/skills/joy-revise/scripts/worth-it.mjs","filter((w) => /[\\p{L}\\p{N}]/u.test(w))","filter(Boolean)"],
  ["daysToFirstDollar is a whole number",".claude/skills/joy-revise/scripts/worth-it.mjs","if (!Number.isInteger(n) || n < 0) cannot.push(","if (false) cannot.push("],
  ["an hourly bar of 0 is refused",".claude/skills/joy-revise/scripts/worth-it.mjs","if (v.hourlyBar === 0) cannot.push(","if (false) cannot.push("],
  ["the default bar is said to be a default",".claude/skills/joy-revise/scripts/worth-it.mjs","notes.push(`hourly bar ${stored.currency}","void (`hourly bar ${stored.currency}"],
  ["the default bar is never mixed with another currency",".claude/skills/joy-revise/scripts/worth-it.mjs","else if (d.currency !== undefined && d.currency !== stored.currency) cannot.push(","else if (false) cannot.push("],
  ["the stored bar must be an object",".claude/skills/joy-revise/scripts/worth-it.mjs","if (b == null || typeof b !== 'object' || Array.isArray(b)) return { error:","if (false) return { error:"],
  ["the stored bar is a positive number",".claude/skills/joy-revise/scripts/worth-it.mjs","if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0) return { error:","if (false) return { error:"],
  ["the stored bar carries a currency code",".claude/skills/joy-revise/scripts/worth-it.mjs","if (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency)) return { error:","if (false) return { error:"],
  ["the stored bar says whose it is and why",".claude/skills/joy-revise/scripts/worth-it.mjs","if (!inWords(b.status) || !inWords(b.why)) return { error:","if (false) return { error:"],
  ["a flag with no value is empty, not absent",".claude/skills/joy-revise/scripts/worth-it.mjs","return v !== undefined && !v.startsWith('--') ? v : '';","return v !== undefined && !v.startsWith('--') ? v : undefined;"],
  ["--unknowns given empty is not a list",".claude/skills/joy-revise/scripts/worth-it.mjs","unknownsArg ? unknownsArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,","unknownsArg ? unknownsArg.split(',').map((s) => s.trim()).filter(Boolean) : [],"],
  // agency/scripts/realised.mjs — the realised-dollar record, credited only through a play's own code
  ...[
    ['realised: an order with no code is unattributed', "if (!o.codes.length) return { bucket: 'unattributed' };", "if (false) return { bucket: 'unattributed' };"],
    ['realised: a code no play names is never credited', "if (!owners.length) return { bucket: 'other' };", "if (false) return { bucket: 'other' };"],
    ["realised: two plays' codes on one order credit neither", "if (owners.length > 1) return { bucket: 'contested', plays: owners };", "if (false) return { bucket: 'contested', plays: owners };"],
    ["realised: a play's code outside its window is not credited", "if (o.day < play.from || o.day > play.to) return { bucket: 'outside', play };", "if (false) return { bucket: 'outside', play };"],
    ['realised: codes match ignoring case and spaces', 'export const normCode = (c) => c.trim().toUpperCase();', 'export const normCode = (c) => c;'],
    ['realised: a code shared by two plays is refused', 'else if (owner.has(n)) problems.push(', 'else if (false) problems.push('],
    ['realised: a code named twice in one play is refused', 'else if (codes.includes(n)) problems.push(', 'else if (false) problems.push('],
    ['realised: a code must be one the export cell can hold apart', 'if (!CODE_SHAPE.test(n)) problems.push(', 'if (false) problems.push('],
    ['realised: a play no dollar could reach is refused', 'if (Array.isArray(p.codes) && p.codes.length === 0 && holdout === undefined) problems.push(', 'if (false) problems.push('],
    ['realised: hours must be a number above 0', "if (p.hours !== undefined && !(typeof p.hours === 'number' && Number.isFinite(p.hours) && p.hours > 0)) problems.push(", 'if (false) problems.push('],
    ['realised: a window date is YYYY-MM-DD, round-trip checked', '/^\\d{4}-\\d{2}-\\d{2}$/.test(v) && calendarDay(v) === v', 'true'],
    ['realised: a window cannot end before it starts', 'else if (isDay(p.from) && p.to < p.from) problems.push(', 'else if (false) problems.push('],
    ['realised: a misspelt play key is refused', 'for (const k of Object.keys(p)) if (!PLAY_KEYS.has(k)) problems.push(', 'for (const k of []) if (!PLAY_KEYS.has(k)) problems.push('],
    ['realised: a holdout share is between 0 and 1', "if (!(typeof h.controlShare === 'number' && h.controlShare > 0 && h.controlShare < 1)) problems.push(", 'if (false) problems.push('],
    ['realised: a holdout count is a whole number', 'if (!(Number.isInteger(h.count) && h.count >= 1)) problems.push(', 'if (false) problems.push('],
    ['realised: a play name with an @ is refused', 'const NAME_SHAPE = /^[^\\p{Cc}@]{1,80}$/u;', 'const NAME_SHAPE = /^[^\\p{Cc}]{1,80}$/u;'],
    ['realised: two plays of one name are refused', 'if (names.has(key)) problems.push(', 'if (false) problems.push('],
    ['realised: only money in hand is realised', "if (o.money !== 'paid') return 0;", 'if (false) return 0;'],
    ['realised: a refunded order realises nothing', "if (o.status === 'refunded') return 0;", 'if (false) return 0;'],
    ['realised: a refund comes off the subtotal', 'return Math.max(0, o.subtotal - o.refunded);', 'return o.subtotal;'],
    ['realised: a refund never takes realised below 0', 'return Math.max(0, o.subtotal - o.refunded);', 'return o.subtotal - o.refunded;'],
    ['realised: a cancelled date voids the order', "const money = cancelled ? 'void' : state;", 'const money = state;'],
    ['realised: a status not classed here is refused', 'if (state === undefined) problems.push(', 'if (false) problems.push('],
    ['realised: every refusal of orders.mjs stands', "if (base.verdict !== 'REPORT' && few === undefined) return refused(", 'if (false) return refused('],
    ['realised: the under-30 pass needs its count to agree', "if (typeof few === 'number' && few !== counted) return refused(base.reasons);", 'if (false) return refused(base.reasons);'],
    ["realised: only Shopify's export is read", "if (cols.source !== 'shopify') return refused(", 'if (false) return refused('],
    ['realised: the Discount Code column is there, once', 'if (codeAt.length !== 1) {', 'if (false) {'],
    ['realised: two codes for one order are refused', 'else if (had.v !== v) problems.push(', 'else if (false) problems.push('],
    ['realised: an export with no orders is refused', 'if (!parsed.length) return refused(', 'if (false) return refused('],
    ['realised: mixed currencies are refused here too', 'if (currencies.length > 1) return refused(', 'if (false) return refused('],
    ['realised: unreadable money or dates are refused here too', 'if (!Number.isFinite(subtotal) || !Number.isFinite(refunded) || day === undefined || !/^[A-Z]{3}$/.test(currency)) {', 'if (false) {'],
    ['realised: a ragged row is refused here too', 'if (row.length !== width) {', 'if (false) {'],
    ['realised: a window the export does not reach has no figure', "if (play.to < span.first || play.from > span.last) return 'none';", "if (false) return 'none';"],
    ["realised: a window past the export is INCOMPLETE","if (play.from < span.first || play.to >= span.last) return 'partial';","if (false) return 'partial';"],
    ["realised: a window ending on the export's last order day is INCOMPLETE","play.to >= span.last","play.to > span.last"],
    ["realised: a key given twice in the plays file is refused","if (twice.length) return privacyGate(","if (false) return privacyGate("],
    ["realised: a repeated key is compared as JSON reads it","const key = JSON.parse(text.slice(i, j + 1));","const key = text.slice(i, j + 1);"],
    ["realised: a paid order worth 0 is not \"nothing paid yet\"",": p.paid === 0 ? '; nothing paid yet",": true ? '; nothing paid yet"],
    ['realised: a play with no code has no figure', "const measured = p.codes.length > 0 && cover !== 'none';", "const measured = cover !== 'none';"],
    ['realised: nothing paid gives no refunded share', 'refundedShare: paidCents > 0 ? (paidCents - realised) / paidCents : null,', 'refundedShare: paidCents > 0 ? (paidCents - realised) / paidCents : 0,'],
    ['realised: no hours gives no figure per hour', 'perHourCents: p.hours !== undefined ? Math.round(realised / p.hours) : null,', 'perHourCents: Math.round(realised / p.hours),'],
    ['realised: nothing with an @ reaches the screen', "if (`${stdout}${stderr}`.includes('@')) return", 'if (false) return'],
    ['realised: an unknown argument is misuse', 'if (!Object.hasOwn(FLAGS, t)) return { error:', 'if (false) return { error:'],
    ['realised: a flag given twice is misuse', 'if (Object.hasOwn(o, k)) return { error:', 'if (false) return { error:'],
  ].map(([name, from, to]) => [name, 'agency/scripts/realised.mjs', from, to]),
  // scripts/prove.mjs — one list of secret shapes, history, the decision clock, state, Leif's pages, facts (8 Nov 2026)
  ["secret shapes are caught","scripts/prove.mjs","const kinds = SECRET_SHAPES.filter(({ re }) => re.test(s)).map(({ name }) => name);","const kinds = [];"],
  ["a 0x 64-hex string is a secret","scripts/prove.mjs","if (HEX64.test(s.replace(ALLOWED_HEX_URL, ''))) kinds.push('0x-hex-key');","if (false) kinds.push('0x-hex-key');"],
  ["a 0x key beside an allowed DAO URL is still caught","scripts/prove.mjs","HEX64.test(s.replace(ALLOWED_HEX_URL, ''))","HEX64.test(s) && !/dao\\.galxe\\.com/.test(s)"],
  ["the private-key-pem shape is caught","scripts/prove.mjs","{ name: 'private-key-pem', re: /","{ name: 'private-key-pem', re: /(?!)/, was: /"],
  ["the jwt shape is caught","scripts/prove.mjs","{ name: 'jwt', re: /","{ name: 'jwt', re: /(?!)/, was: /"],
  ["the stripe shape is caught","scripts/prove.mjs","{ name: 'stripe', re: /","{ name: 'stripe', re: /(?!)/, was: /"],
  ["the github shape is caught","scripts/prove.mjs","{ name: 'github', re: /","{ name: 'github', re: /(?!)/, was: /"],
  ["the slack shape is caught","scripts/prove.mjs","{ name: 'slack', re: /","{ name: 'slack', re: /(?!)/, was: /"],
  ["the aws-access-key-id shape is caught","scripts/prove.mjs","{ name: 'aws-access-key-id', re: /","{ name: 'aws-access-key-id', re: /(?!)/, was: /"],
  ["the aws-secret-key shape is caught","scripts/prove.mjs","{ name: 'aws-secret-key', re: /","{ name: 'aws-secret-key', re: /(?!)/, was: /"],
  ["the google-api-key shape is caught","scripts/prove.mjs","{ name: 'google-api-key', re: /","{ name: 'google-api-key', re: /(?!)/, was: /"],
  ["the shopify shape is caught","scripts/prove.mjs","{ name: 'shopify', re: /","{ name: 'shopify', re: /(?!)/, was: /"],
  ["the klaviyo shape is caught","scripts/prove.mjs","{ name: 'klaviyo', re: /","{ name: 'klaviyo', re: /(?!)/, was: /"],
  ["the anthropic shape is caught","scripts/prove.mjs","{ name: 'anthropic', re: /","{ name: 'anthropic', re: /(?!)/, was: /"],
  ["the openai shape is caught","scripts/prove.mjs","{ name: 'openai', re: /","{ name: 'openai', re: /(?!)/, was: /"],
  ["the supabase-secret shape is caught","scripts/prove.mjs","{ name: 'supabase-secret', re: /","{ name: 'supabase-secret', re: /(?!)/, was: /"],
  ["the cloudinary-url shape is caught","scripts/prove.mjs","{ name: 'cloudinary-url', re: /","{ name: 'cloudinary-url', re: /(?!)/, was: /"],
  ["the x-session-cookie shape is caught","scripts/prove.mjs","{ name: 'x-session-cookie', re: /","{ name: 'x-session-cookie', re: /(?!)/, was: /"],
  ["the solana-base58-key shape is caught","scripts/prove.mjs","{ name: 'solana-base58-key', re: /","{ name: 'solana-base58-key', re: /(?!)/, was: /"],
  ["the keypair-byte-array shape is caught","scripts/prove.mjs","{ name: 'keypair-byte-array', re: /","{ name: 'keypair-byte-array', re: /(?!)/, was: /"],
  ["the labelled-hex-key shape is caught","scripts/prove.mjs","{ name: 'labelled-hex-key', re: /","{ name: 'labelled-hex-key', re: /(?!)/, was: /"],
  ["the labelled-seed shape is caught","scripts/prove.mjs","{ name: 'labelled-seed', re: /","{ name: 'labelled-seed', re: /(?!)/, was: /"],
  ["the labelled-secret shape is caught","scripts/prove.mjs","{ name: 'labelled-secret', re: /","{ name: 'labelled-secret', re: /(?!)/, was: /"],
  ["12 BIP39 words on a line are a seed","scripts/prove.mjs","if (seedRun(s)) kinds.push('bip39-seed');","if (false) kinds.push('bip39-seed');"],
  ["any non-letter separates seed words","scripts/prove.mjs","for (const t of String(text).split(/[^A-Za-z]+/)) {","for (const t of String(text).split(/\\s+/)) {"],
  ["seed words count in any case","scripts/prove.mjs","run = BIP39.has(t.toLowerCase()) ?","run = BIP39.has(t) ?"],
  ["rows of seed words add up down a page","scripts/prove.mjs","words: [...run.words, ...words]","words: [...words]"],
  ["seed rows join only within one file","scripts/prove.mjs","run !== null && run.file === at.file && at.n === run.n + 1","run !== null && at.n === run.n + 1"],
  ["seed rows join only on consecutive lines","scripts/prove.mjs","at.file && at.n === run.n + 1;","at.file && at.n > run.n;"],
  ["a seed written down a page is reported","scripts/prove.mjs","if (joins && !run.told && seedLike([...run.words, ...lead])) {","if (false) {"],
  ["a changed BIP39 list fails the check closed","scripts/prove.mjs","if (!bip39Intact(ctx.words ?? BIP39_WORDS)) return fail(","if (false) return fail("],
  ["the BIP39 list is pinned by its hash","scripts/prove.mjs","digest('hex') === BIP39_SHA256;","digest('hex') !== '';"],
  ["history is scanned","scripts/prove.mjs","...secretHits(index.lines), ...secretHits(past.lines)];","...secretHits(index.lines)];"],
  ["the tree is scanned","scripts/prove.mjs","const hits = [...secretHits(tree.lines), ","const hits = ["],
  ["commit messages are scanned","scripts/prove.mjs","else if (inMessage && raw.startsWith('    ')) lines.push(","else if (false) lines.push("],
  ["hunks are counted, not guessed from a first character","scripts/prove.mjs","if (raw.startsWith('+')) {","if (raw.startsWith('+') && !raw.startsWith('+++ ')) {"],
  ["the history scan reads every ref","scripts/prove.mjs","['log', '-p', '-m', '--all',","['log', '-p', '-m',"],
  ["the tree scan reads untracked files","scripts/prove.mjs","'--cached', '--others', '--exclude-standard'","'--cached', '--exclude-standard'"],
  ["git ls-files failing fails","scripts/prove.mjs","return fail(`git ls-files failed","return pass(`git ls-files failed"],
  ["git log failing fails","scripts/prove.mjs","return fail(`git log failed","return pass(`git log failed"],
  ["an unread file is not clean","scripts/prove.mjs","if (tree.unread.length) return fail(","if (false) return fail("],
  ["no file read is not clean","scripts/prove.mjs","if (!tree.files) return fail(","if (false) return fail("],
  ["no commit read is not clean","scripts/prove.mjs","if (!history.commits) return fail(","if (false) return fail("],
  ["commits with no added line are not clean","scripts/prove.mjs","if (!history.added) return fail(","if (false) return fail("],
  ["a known fake must sit at its commit, path and line","scripts/prove.mjs","fakes.some((f) => f.where === l.where && f.sha256 === sha256(l.text))","fakes.some((f) => f.sha256 === sha256(l.text))"],
  ["a known fake must be its exact text","scripts/prove.mjs","fakes.some((f) => f.where === l.where && f.sha256 === sha256(l.text))","fakes.some((f) => f.where === l.where)"],
  ["an absent studio is a NOTE, not a PASS","scripts/prove.mjs","if (!present) return note(","if (!present) return pass("],
  ["a claude/galxe-* branch fails the studio check","scripts/prove.mjs","const banned = refs.filter((r) => STUDIO_BRANCH_BAN.test(r));","const banned = [];"],
  ["a claude/galxe-* branch on the remote counts","scripts/prove.mjs","(?:heads|remotes\\/[^/]+)","(?:heads)"],
  ["the studio remote refs are read","scripts/prove.mjs","'refs/heads', 'refs/remotes'])","'refs/heads'])"],
  ["a dirty studio fails","scripts/prove.mjs","if (dirty.length) problems.push(","if (false) problems.push("],
  ["a studio git error fails","scripts/prove.mjs","return fail(`could not read the studio repo","return note(`could not read the studio repo"],
  ["an open item past its date fails","scripts/prove.mjs","if (lapsed.length) return fail(","if (false) return fail("],
  ["an item lapses once dated before today","scripts/prove.mjs","lapsed: open.filter((it) => dayNumber(it.date) < t)","lapsed: open.filter((it) => dayNumber(it.date) < t - 1)"],
  ["today is Sydney's, not UTC's","scripts/prove.mjs","timeZone: 'Australia/Sydney'","timeZone: 'UTC'"],
  ["a misshapen calendar fails","scripts/prove.mjs","if (problems.length) return fail(`${CALENDAR}:","if (false) return fail(`${CALENDAR}:"],
  ["the calendar must be a list","scripts/prove.mjs","if (!Array.isArray(items)) return [","if (false) return ["],
  ["an empty calendar fails","scripts/prove.mjs","if (!items.length) return [","if (false) return ["],
  ["each calendar item needs its text fields","scripts/prove.mjs","for (const f of CALENDAR_TEXT) if (!isText(it[f])) problems.push(","for (const f of CALENDAR_TEXT) if (false) problems.push("],
  ["each calendar date must be real","scripts/prove.mjs","if (dayNumber(it.date) == null) problems.push(","if (false) problems.push("],
  ["a calendar kind is checked","scripts/prove.mjs","if (!KINDS.has(it.kind)) problems.push(","if (false) problems.push("],
  ["a calendar status is checked","scripts/prove.mjs","if (!STATES.has(it.status)) problems.push(","if (false) problems.push("],
  ["calendar ids are unique","scripts/prove.mjs","if (seen.has(it.id)) problems.push(","if (false) problems.push("],
  ["a date is YYYY-MM-DD and nothing else","scripts/prove.mjs","const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(v);","const m = /^(\\d{4})-(\\d{1,2})-(\\d{1,2})/.exec(v);"],
  ["a date is a real day","scripts/prove.mjs","if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;","if (false) return null;"],
  ["the state file is 15 lines or fewer","scripts/prove.mjs","if (n > STATE_MAX_LINES) return fail(","if (false) return fail("],
  ["an empty state file fails","scripts/prove.mjs","if (n === 0) return fail(","if (false) return fail("],
  ["CLAUDE.md's first instruction names the state file","scripts/prove.mjs","if (first == null || !NAMES_STATE.test(first)) return fail(","if (false) return fail("],
  ["the root state file, not galxe-desk's","scripts/prove.mjs","(?:^|[^\\w./-])(?:\\.\\/)?docs","docs"],
  ["only the first instruction counts","scripts/prove.mjs","const first = firstInstruction(readFileSync(claude, 'utf8'));","const first = readFileSync(claude, 'utf8');"],
  ["\"npm run\" on a Leif page fails","scripts/prove.mjs","if (!why && NPM_RUN.test(line)) why = '\"npm run\"';","if (false) why = '\"npm run\"';"],
  ["a node command on a Leif page fails","scripts/prove.mjs","if (!why && NODE_COMMAND.test(line)) why = 'a node command';","if (false) why = 'a node command';"],
  ["a shell command in backticks fails","scripts/prove.mjs","if (!why && [...line.matchAll(INLINE_CODE)].some((m) => SHELL_START.test(m[1]))) why =","if (false) why ="],
  ["a shell code block fails at its fence","scripts/prove.mjs","if (fenced && SHELL_FENCE.test(f[1])) why =","if (false) why ="],
  ["a command in any code block fails","scripts/prove.mjs","} else if (fenced && (/^\\s*\\$\\s/.test(line) || SHELL_START.test(line))) why =","} else if (false) why ="],
  ["a missing Leif page fails","scripts/prove.mjs","(existsSync(join(root, p)) ? files : missing).push(p);","if (existsSync(join(root, p))) files.push(p);"],
  ["a page pattern that matches nothing fails","scripts/prove.mjs","else missing.push(`${p} (matches nothing)`);","else void 0;"],
  ["docs/leif.md is a Leif page","scripts/prove.mjs","export const LEIF_PAGES = ['docs/leif.md', ","export const LEIF_PAGES = ["],
  ["the facts file must be an object","scripts/prove.mjs","if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [","if (!doc) return ["],
  ["asOf must be a real date","scripts/prove.mjs","if (asOf == null) problems.push(","if (false) problems.push("],
  ["asOf cannot be after today","scripts/prove.mjs","else if (asOf > t) problems.push(","else if (false) problems.push("],
  ["facts must be a non-empty list","scripts/prove.mjs","if (!Array.isArray(doc.facts) || !doc.facts.length) {","if (false) {"],
  ["a fact needs a key","scripts/prove.mjs","if (!isText(f.key)) problems.push(","if (false) problems.push("],
  ["a fact needs a source","scripts/prove.mjs","if (!isText(f.source)) problems.push(","if (false) problems.push("],
  ["a fact needs a real date","scripts/prove.mjs","if (d == null) problems.push(`${label} date","if (false) problems.push(`${label} date"],
  ["a fact cannot be dated after today","scripts/prove.mjs","else if (d > t) problems.push(","else if (false) problems.push("],
  ["a fact needs a value","scripts/prove.mjs","if (f.value === undefined || f.value === null || f.value === '') problems.push(","if (false) problems.push("],
  ["a number needs a unit","scripts/prove.mjs","else if (typeof f.value === 'number' && !f.unit.trim()) problems.push(","else if (false) problems.push("],
  ["a misshapen facts file fails","scripts/prove.mjs","if (problems.length) return fail(`${FACTS}:","if (false) return fail(`${FACTS}:"],
  ["stale facts are a NOTE, not a PASS","scripts/prove.mjs","if (age > FACTS_STALE_DAYS) return note(","if (false) return note("],
  ["an unknown status is a FAIL","scripts/prove.mjs","const s = MARKS.has(result?.status) ? result.status : 'FAIL';","const s = MARKS.has(result?.status) ? result.status : 'PASS';"],
  ["a check that throws is a FAIL","scripts/prove.mjs","r = fail(`the check itself threw","r = note(`the check itself threw"],
  ["prove runs the secrets check","scripts/prove.mjs","  ['secrets', secrets, true],\n",""],
  ["the studio check is required","scripts/prove.mjs","['studio', studio, true],","['studio', studio, false],"],
  ["prove runs the decisions check","scripts/prove.mjs","  ['decisions', decisions, true],\n",""],
  ["prove runs the state check","scripts/prove.mjs","  ['state', state, true],\n",""],
  ["prove runs the leif-pages check","scripts/prove.mjs","  ['leif-pages', leifPages, true],\n",""],
  ["prove runs the facts check","scripts/prove.mjs","  ['facts', facts, true],\n",""],
  // agency/scripts/ab-test.mjs — round 3: arm-size bound, the clock, the interval at its own level (8 Nov 2026)
  ["an arm more than 5% over plan is not the planned test","agency/scripts/ab-test.mjs","if (a.recipients * 100 > plan.planned * (100 + OVERRUN * 100)) {","if (false) {"],
  ["the clock must have reached analyseOn","agency/scripts/ab-test.mjs","if (isFuture(plan.analyseOn, now)) {","if (false) {"],
  ["analysedOn is written the same way as analyseOn","agency/scripts/ab-test.mjs","else if (analysedOn.dateOnly !== plan.analyseOn.dateOnly) problems.push(","else if (false) problems.push("],
  ["the interval is built at the registered alpha","agency/scripts/ab-test.mjs","D.conversions, D.recipients, plan.za);","D.conversions, D.recipients);"],
  ["the interval is labelled with its own level","agency/scripts/ab-test.mjs","points, ${level} interval","points, 95% interval"],
  ["the floor figure is never rounded up to the floor","agency/scripts/ab-test.mjs","expects ${under(expected, MIN_EXPECTED_CONVERSIONS)} conversions","expects ${expected.toFixed(1)} conversions"],
  ["strictDate refuses minute 60","agency/scripts/ab-test.mjs","if (H > 23 || Mi > 59 || S > 59) return null;","if (H > 23 || S > 59) return null;"],
  ["strictDate refuses second 60","agency/scripts/ab-test.mjs","if (H > 23 || Mi > 59 || S > 59) return null;","if (H > 23 || Mi > 59) return null;"],
  ["strictDate refuses offset minute 60","agency/scripts/ab-test.mjs","if (oh > 14 || om > 59) return null;","if (oh > 14) return null;"],
  // agency/scripts/creator-pilot.mjs — round 3: the day-30 latch, pinned rules, canonical emails (8 Nov 2026)
  ["a refund dated after day 30 never reaches the day-30 rule","agency/scripts/creator-pilot.mjs","if (dayOf(t, pilot) <= DAY30) refundsBy30.set(","if (true) refundsBy30.set("],
  ["the day-30 decision is applied, never re-taken","agency/scripts/creator-pilot.mjs","if (latched) {","if (false) {"],
  ["a back-dated refund may not move a day-30 decision already taken","agency/scripts/creator-pilot.mjs","if (stateNow !== stateWith) {","if (false) {"],
  ["the rules must match the pin","agency/scripts/creator-pilot.mjs","if (first.pilotSha256 !== want) {","if (false) {"],
  ["the pin is a rules line, not a hash on another line","agency/scripts/creator-pilot.mjs","if (!first || first.type !== 'rules') {","if (!first) {"],
  ["status reads only under the pinned rules","agency/scripts/creator-pilot.mjs","if (unpinned.length) {","if (false) {"],
  ["a write is taken only under the pinned rules","agency/scripts/creator-pilot.mjs","if (pinBad.length) return","if (false) return"],
  ["an empty ledger takes only the pin","agency/scripts/creator-pilot.mjs","if (empty && !(event && event.type === 'rules')) {","if (false) {"],
  ["a rules line pins this pilot.json","agency/scripts/creator-pilot.mjs","if (e.pilotSha256 !== pilotSha256(pilot)) reasons.push(","if (false) reasons.push("],
  ["the rules are pinned once","agency/scripts/creator-pilot.mjs","if (i !== 0) problems.push(","if (false) problems.push("],
  ["a rules line carries its hash","agency/scripts/creator-pilot.mjs","if (typeof e.pilotSha256 !== 'string' || !HASH.test(e.pilotSha256)) throw new Error(","if (false) throw new Error("],
  ["weekly reads only under the pinned rules","agency/scripts/creator-pilot.mjs","if (validatePilot(pilot).length || pinProblems(entries, pilot).length ||","if (validatePilot(pilot).length ||"],
  ["check refuses rules changed after the pin","agency/scripts/creator-pilot.mjs","if (unpinnedRules.length) {","if (false) {"],
  ["--self-ids are stored as given, never hashed again","agency/scripts/creator-pilot.mjs","checkHash('--self-ids', h); return h;","return hashId(h);"],
  ["an email flag must hold an address","agency/scripts/creator-pilot.mjs","const hashEmail = (v) => hashId(canonicalEmail(v));","const hashEmail = (v) => hashId(v);"],
  ["hashId hashes an email in its one spelling","agency/scripts/creator-pilot.mjs","update(t.includes('@') ? canonicalEmail(t) : t)","update(t)"],
  ["a +tag is the same inbox","agency/scripts/creator-pilot.mjs","if (plus >= 0) local = local.slice(0, plus);","if (false) local = local.slice(0, plus);"],
  ["googlemail.com is gmail.com","agency/scripts/creator-pilot.mjs","if (domain === 'googlemail.com') domain = 'gmail.com';","if (false) domain = 'gmail.com';"],
  ["Gmail ignores dots","agency/scripts/creator-pilot.mjs","if (domain === 'gmail.com') local = local.split('.').join('');","if (false) local = local.split('.').join('');"],
  ["an address is one mailbox, one @ and one domain","agency/scripts/creator-pilot.mjs","if (at < 1 || at !== t.lastIndexOf('@') || at === t.length - 1) throw new Error(","if (false) throw new Error("],
  ["an address needs a mailbox before its +tag","agency/scripts/creator-pilot.mjs","if (!local) throw new Error(","if (false) throw new Error("],
  ["a flag set before day 30 survives day 30","agency/scripts/creator-pilot.mjs","if (stops[id]) continue;",""],
  ["a sign-up with no account is NO_ACCOUNT","agency/scripts/creator-pilot.mjs","if (typeof who !== 'string' || who === '') return e.type === 'order' ? 'NO_BUYER' : 'NO_ACCOUNT';","if (e.type === 'order' && typeof who !== 'string') return 'NO_BUYER';"],
  ["an empty buyer or account is no identity","agency/scripts/creator-pilot.mjs"," || who === '') return",") return"],
  ["a JSON number with a third decimal is not money","agency/scripts/creator-pilot.mjs"," || Math.abs(v * 100 - c) > 1e-6",""],
  ["a creator may still join on day 30","agency/scripts/creator-pilot.mjs","if (dayOf(t, pilot) > DAY30) reasons.push(","if (dayOf(t, pilot) >= DAY30) reasons.push("],
  ["the rules may be fixed on launch day","agency/scripts/creator-pilot.mjs","decided > start)","decided >= start)"],
  // agency/scripts/orders.mjs — round 3: no raw cell echoed, the 20% threshold, --write-aov refusals (8 Nov 2026)
  ["a startDate with a time counts from its UTC day","agency/scripts/orders.mjs","const startDay = Math.floor(start / DAY) * DAY;","const startDay = start;"],
  ["the start day is compared as a UTC day, not the written startDate","agency/scripts/orders.mjs","if (report.span.last >= startIso) return no(","if (report.span.last >= pilot.startDate) return no("],
  ["the start day is the UTC day, not the date as written","agency/scripts/orders.mjs","const startIso = new Date(startDay).toISOString().slice(0, 10);","const startIso = String(pilot.startDate).slice(0, 10);"],
  ["an order time with minute 60 is refused","agency/scripts/orders.mjs","Number(mi) > 59 || Number(s ?? 0) > 59)) return undefined;","Number(s ?? 0) > 59)) return undefined;"],
  ["an amount past exact whole cents is refused","agency/scripts/orders.mjs","return Number.isSafeInteger(c) ? c : NaN;","return c;"],
  ["a refusal names the order by its row, never its number","agency/scripts/orders.mjs","const which = (o) => `the order on row ${o.row}`;","const which = (o) => `order ${o.id}`;"],
  ["an unknown status is never echoed","agency/scripts/orders.mjs","its ${names.status} is not one this knows","its ${names.status} \"${raw}\" is not one this knows"],
  ["an order number must hold a digit","agency/scripts/orders.mjs","if (!/\\d/.test(id)) {","if (false) {"],
  ["the free-shipping threshold leaves at most 20% at or above it","agency/scripts/orders.mjs","while (atOrAbove(threshold) * 100 > counted.length * MAX_QUALIFYING_PCT) threshold += STEP_CENTS;","while (false) threshold += STEP_CENTS;"],
  ["an export ending over 120 days before the start is refused","agency/scripts/orders.mjs","if (!(gapDays <= MAX_GAP_DAYS)) return no(","if (false) return no("],
  ["an export spanning under 28 days is refused","agency/scripts/orders.mjs","if (!(report.span.days >= MIN_SPAN_DAYS)) return no(","if (false) return no("],
  ["a median of 0 is never written as the baseline","agency/scripts/orders.mjs","if (!(aovCents > 0)) return no(","if (false) return no("],
  // .claude/skills/joy-revise/scripts/worth-it.mjs — no blank read as a number, no placeholder as a test (8 Nov 2026)
  ["a blank is never read as a number",".claude/skills/joy-revise/scripts/worth-it.mjs","if (typeof v !== 'string' || !DECIMAL.test(v)) return NaN;","if (typeof v !== 'string') return NaN;"],
  ["a list is never read as a number",".claude/skills/joy-revise/scripts/worth-it.mjs","if (typeof v !== 'string' || !DECIMAL.test(v)) return NaN;","if (!DECIMAL.test(v)) return NaN;"],
  ["hours of 0 are refused",".claude/skills/joy-revise/scripts/worth-it.mjs","if (v.hours === 0) cannot.push(","if (false) cannot.push("],
  ["a word said twice counts once",".claude/skills/joy-revise/scripts/worth-it.mjs","return /\\p{L}/u.test(s) ? new Set(counted).size : 0;","return /\\p{L}/u.test(s) ? counted.length : 0;"],
  ["digits alone are not a test",".claude/skills/joy-revise/scripts/worth-it.mjs","return /\\p{L}/u.test(s) ? new Set(counted).size : 0;","return new Set(counted).size;"],
  ["a placeholder is not a test",".claude/skills/joy-revise/scripts/worth-it.mjs","} else if (PLACEHOLDER.test(d.cheapestTest)) {","} else if (false) {"],
  ["a short command must be the whole test",".claude/skills/joy-revise/scripts/worth-it.mjs","const COMMAND = /^`?","const COMMAND = /`?"],
  ["a named node file must exist",".claude/skills/joy-revise/scripts/worth-it.mjs","if (m[2] !== undefined) return existsSync(join(REPO, m[2]));","if (m[2] !== undefined) return true;"],
  ["a named npm script must exist",".claude/skills/joy-revise/scripts/worth-it.mjs","try { return Object.hasOwn(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts ?? {}, m[1]); } catch { return false; }","return true;"],
  ["a kill number must be above 0",".claude/skills/joy-revise/scripts/worth-it.mjs","if (killNumber <= 0) cannot.push(","if (false) cannot.push("],
  ["a kill metric is not a placeholder",".claude/skills/joy-revise/scripts/worth-it.mjs","if (PLACEHOLDER.test(k.metric) || !/\\p{L}{2}/u.test(k.metric)) cannot.push(","if (!/\\p{L}{2}/u.test(k.metric)) cannot.push("],
  ["a kill metric names something",".claude/skills/joy-revise/scripts/worth-it.mjs","if (PLACEHOLDER.test(k.metric) || !/\\p{L}{2}/u.test(k.metric)) cannot.push(","if (PLACEHOLDER.test(k.metric)) cannot.push("],
  // scripts/prove.mjs — the index and UTF-16 read, 8 more shapes, seed layouts, prose commands, the studio rule (9 Nov 2026)
  ["the index is scanned","scripts/prove.mjs","...secretHits(tree.lines), ...secretHits(index.lines),","...secretHits(tree.lines),"],
  ["git diff --cached failing fails","scripts/prove.mjs","return fail(`git diff --cached failed","return pass(`git diff --cached failed"],
  ["the staged scan prints a blob git calls binary","scripts/prove.mjs","'--cached', '-U0', '--text',","'--cached', '-U0',"],
  ["the history scan prints a blob git calls binary","scripts/prove.mjs","'--all', '--text',","'--all',"],
  ["a UTF-16 line printed by --text reads as its letters","scripts/prove.mjs","const noNul = (s) => s.split('\\u0000').join('');","const noNul = (s) => s;"],
  ["UTF-16 LE with a BOM is read, not skipped as binary","scripts/prove.mjs","if (buf[0] === 0xff && buf[1] === 0xfe) return","if (false) return"],
  ["UTF-16 BE with a BOM is read, not skipped as binary","scripts/prove.mjs","if (buf[0] === 0xfe && buf[1] === 0xff) return","if (false) return"],
  ["a binary file skipped is counted","scripts/prove.mjs","binary.push(p);","void p;"],
  ["the PASS names the binary files not read","scripts/prove.mjs","${tree.binary.length} binary file(s) not read${skipped}","${tree.binary.length} binary file(s) not read"],
  ["the extended-private-key shape is caught","scripts/prove.mjs","{ name: 'extended-private-key', re: /","{ name: 'extended-private-key', re: /(?!)/, was: /"],
  ["the wif-key shape is caught","scripts/prove.mjs","{ name: 'wif-key', re: /","{ name: 'wif-key', re: /(?!)/, was: /"],
  ["the url-password shape is caught","scripts/prove.mjs","{ name: 'url-password', re: /","{ name: 'url-password', re: /(?!)/, was: /"],
  ["the bearer-token shape is caught","scripts/prove.mjs","{ name: 'bearer-token', re: /","{ name: 'bearer-token', re: /(?!)/, was: /"],
  ["the npm-token shape is caught","scripts/prove.mjs","{ name: 'npm-token', re: /","{ name: 'npm-token', re: /(?!)/, was: /"],
  ["the telegram-bot-token shape is caught","scripts/prove.mjs","{ name: 'telegram-bot-token', re: /","{ name: 'telegram-bot-token', re: /(?!)/, was: /"],
  ["the webhook-secret shape is caught","scripts/prove.mjs","{ name: 'webhook-secret', re: /","{ name: 'webhook-secret', re: /(?!)/, was: /"],
  ["the google-oauth-secret shape is caught","scripts/prove.mjs","{ name: 'google-oauth-secret', re: /","{ name: 'google-oauth-secret', re: /(?!)/, was: /"],
  ["a camelCase label before a 64-hex key counts","scripts/prove.mjs","(?:privatekey|privkey|secretkey|(?<!","(?:(?<!"],
  ["a PK or _PK label before a 64-hex key counts","scripts/prove.mjs","|(?:priv|pk)(?![a-z]))|_pk(?![a-z]))","))"],
  ["a key label starts a word, so publicKey and cacheKey pass","scripts/prove.mjs","|(?<![A-Za-z0-9])(?:private|secret|key|","|(?:private|secret|key|"],
  ["\"API key\" with a space is a label","scripts/prove.mjs","(?:api[ _-]?key|","(?:api[_-]?key|"],
  ["a URL password needs a letter and a digit","scripts/prove.mjs","(?=[^\\s@/\\\\]*\\d)(?=[^\\s@/\\\\]*[A-Za-z])[^\\s@/\\\\]{6,}@","[^\\s@/\\\\]{6,}@"],
  ["a URL password placeholder is not a password","scripts/prove.mjs","(?![$<[{%*])",""],
  ["a URL password holds no backslash, so an escaped test string passes","scripts/prove.mjs","(?=[^\\s@/\\\\]*\\d)(?=[^\\s@/\\\\]*[A-Za-z])[^\\s@/\\\\]{6,}@","(?=[^\\s@/]*\\d)(?=[^\\s@/]*[A-Za-z])[^\\s@/]{6,}@"],
  ["a Bearer token needs a letter and a digit","scripts/prove.mjs","\\b[Bb]earer\\s+(?=[\\w.~+/-]*\\d)(?=[\\w.~+/-]*[A-Za-z])","\\b[Bb]earer\\s+"],
  ["a WIF key is never cut from a base64 run","scripts/prove.mjs","(?<![A-Za-z0-9+/=])(?:5[HJK][1-9A-HJ-NP-Za-km-z]{49}|[KL][1-9A-HJ-NP-Za-km-z]{51})(?![A-Za-z0-9+/=])","(?<![A-Za-z0-9])(?:5[HJK][1-9A-HJ-NP-Za-km-z]{49}|[KL][1-9A-HJ-NP-Za-km-z]{51})(?![A-Za-z0-9])"],
  ["a wrapped seed counts the words that lead the next line","scripts/prove.mjs","seedLike([...run.words, ...lead])","seedLike([...run.words])"],
  ["a wrapped seed counts the words that end a line","scripts/prove.mjs","else run = trail.length ? {","else run = false ? {"],
  ["a seed run crosses one blank line","scripts/prove.mjs","run = next && !run.blank ? { ...run, n: at.n, blank: true } : null;","run = null;"],
  ["a seed run never crosses two blank lines","scripts/prove.mjs","run = next && !run.blank ?","run = next ?"],
  ["table bars separate seed words","scripts/prove.mjs","String(text).split(/[\\s|]+/);","String(text).split(/[\\s]+/);"],
  ["(1) and #1 are numbering","scripts/prove.mjs","const SEED_NUMBER = /^(?:#?\\d{1,2}(?:st|nd|rd|th)?[.):]?|\\(\\d{1,2}\\)[.:]?|","const SEED_NUMBER = /^(?:\\d{1,2}(?:st|nd|rd|th)?[.):]?|"],
  ["quotes hide nothing, so a JSON key \"1\": is numbering","scripts/prove.mjs","const t = raw.split(/[\"'`]/).join('');","const t = raw;"],
  ["a bullet neither counts nor breaks a row","scripts/prove.mjs","if (!t || SEED_BULLET.test(t)) return '';","if (!t) return '';"],
  ["a word not on the list breaks a row","scripts/prove.mjs","return BIP39.has(w) ? w : null;","return BIP39.has(w) ? w : '';"],
  ["a row's leading words stop at the first word not on the list","scripts/prove.mjs","return { lead: row.slice(0, first), trail:","return { lead: row.filter(Boolean), trail:"],
  ["npm, npx or git in prose on a Leif page fails","scripts/prove.mjs","if (!why && PROSE_COMMAND.test(line)) why =","if (false) why ="],
  ["only real npm subcommands count in prose","scripts/prove.mjs","\\b(?:npm|pnpm)\\s+(?:install|i|ci|test|t|start|exec|update|init)\\b","\\b(?:npm|pnpm)\\s+\\w"],
  ["only real git subcommands count in prose","scripts/prove.mjs","\\bgit\\s+(?:pull|push|clone|commit|checkout|switch|status|add|fetch|reset|stash|merge|rebase|log|diff|init|restore)\\b","\\bgit\\s+\\w"],
  ["a command in an indented code block fails","scripts/prove.mjs","else if (indented && (/^\\s*\\$\\s/.test(line) || SHELL_START.test(line))) why =","else if (false) why ="],
  ["an indented code block starts only after a blank line","scripts/prove.mjs","INDENTED.test(line) && (blank || indented);","INDENTED.test(line);"],
  ["a shell command in <code> or <kbd> fails","scripts/prove.mjs","if (!why && [...line.matchAll(HTML_CODE)].some((m) => SHELL_START.test(m[1]))) why =","if (false) why ="],
  ["a script file in code is a command","scripts/prove.mjs","|${SCRIPT})`);",")`);"],
  ["a script needs a name before its extension","scripts/prove.mjs","*\\\\w\\\\.(?:sh|","*\\\\.(?:sh|"],
  ["the Windows and platform tools are commands","scripts/prove.mjs","|claude|powershell|pwsh|winget|choco|powercfg|nvm|fnm|vercel|supabase|netlify';","|claude';"],
  ["a pwsh fence is a shell fence","scripts/prove.mjs","|powershell|pwsh|ps1?|","|powershell|ps1?|"],
  ["a galxe branch holding commits main lacks fails","scripts/prove.mjs","const carrying = banned.filter((r) => ahead[r] !== 0);","const carrying = [];"],
  ["no main to measure a galxe branch against fails closed","scripts/prove.mjs","if (banned.length && !base) problems.push(","if (false) problems.push("],
  ["commits are counted against origin/main before main","scripts/prove.mjs","export const STUDIO_MAINS = ['refs/remotes/origin/main', 'refs/heads/main'];","export const STUDIO_MAINS = ['refs/heads/main', 'refs/remotes/origin/main'];"],
  ["a count git did not print as a number is unknown, not 0","scripts/prove.mjs","(/^\\d+$/.test(String(s).trim()) ? Number(String(s).trim()) : NaN)","Number(String(s).trim())"],
  ["each galxe branch's commits are counted","scripts/prove.mjs","if (base) for (const r of refs) if (STUDIO_BRANCH_BAN.test(r)) ahead[r] =","if (false) for (const r of refs) if (STUDIO_BRANCH_BAN.test(r)) ahead[r] ="],
  ["an empty galxe branch is named in the PASS","scripts/prove.mjs","claude/galxe-* branch with no commit beyond ${base}: ${banned.join(', ')}","no claude/galxe-* branch"],
  // agency/scripts — round 4: the plan states each arm's real size; latch edges; no cell echoed by any refusal (9 Nov 2026)
  ["preflight names half the list as plannedPerArm","agency/scripts/ab-test.mjs","with plannedPerArm ${thousands(perArm)}, half the list","with plannedPerArm ${thousands(toPlan)}, half the list"],
  ["an arm past its plan says the default arm stands","agency/scripts/ab-test.mjs","if (over) early.push(","if (false) early.push("],
  ["--check prints the band each arm is read in","agency/scripts/ab-test.mjs","`each arm is read only if it has ${thousands(fewest)} to ${thousands(most)} recipients, ${SHORTFALL * 100}% under to ${OVERRUN * 100}% over the plan, so plannedPerArm must be the number each arm will actually get (half the list, split 50/50), not a minimum`,",""],
  ["the band printed starts where the analysis reads","agency/scripts/ab-test.mjs","const fewest = Math.ceil((planned * (100 - SHORTFALL * 100)) / 100);","const fewest = Math.floor((planned * (100 - SHORTFALL * 100)) / 100);"],
  ["the band printed ends where the analysis reads","agency/scripts/ab-test.mjs","const most = Math.floor((planned * (100 + OVERRUN * 100)) / 100);","const most = Math.ceil((planned * (100 + OVERRUN * 100)) / 100);"],
  ["a refund dated day 30 counts toward the day-30 decision","agency/scripts/creator-pilot.mjs","if (dayOf(t, pilot) <= DAY30) refundsBy30.set(","if (dayOf(t, pilot) < DAY30) refundsBy30.set("],
  ["a refund dated day 31 does not reach the day-30 decision","agency/scripts/creator-pilot.mjs","if (dayOf(t, pilot) <= DAY30) refundsBy30.set(","if (dayOf(t, pilot) <= DAY30 + 1) refundsBy30.set("],
  ["the back-dated-refund guard covers a refund dated day 30","agency/scripts/creator-pilot.mjs","&& dayOf(t, pilot) <= DAY30) {","&& dayOf(t, pilot) < DAY30) {"],
  ["the back-dated-refund guard is on from day 31","agency/scripts/creator-pilot.mjs","if (e.type === 'refund' && dayOf(now, pilot) > DAY30 &&","if (e.type === 'refund' && dayOf(now, pilot) > DAY30 + 1 &&"],
  ["import-orders refuses an email column that holds no address","agency/scripts/creator-pilot.mjs","? hashEmail(email) : row?.buyer,","? hashId(email) : row?.buyer,"],
  ["a refusal never echoes a money cell","agency/scripts/orders.mjs",": ${names[f]} is not an amount of money (a plain number",": ${names[f]} is not an amount of money (${val(f)}; a plain number"],
  ["a refusal never echoes a marketing cell","agency/scripts/orders.mjs","has no yes or no in ${names.marketing}, so","has no yes or no in ${names.marketing} (${mk}), so"],
  ["a refusal never echoes a currency cell","agency/scripts/orders.mjs","has no three-letter currency code in ${names.currency}`);","has no three-letter currency code in ${names.currency}: ${val('currency')}`);"],
  ["every row's order number must hold a digit, not only the first","agency/scripts/orders.mjs","if (!/\\d/.test(id)) {","if (r === 1 && !/\\d/.test(id)) {"],
  ["a refusal never echoes either of two clashing cells","agency/scripts/orders.mjs","values (rows ${had.row} and ${r + 1})","values (${had.v} and ${v}, rows ${had.row} and ${r + 1})"],
  ["a refusal never echoes a date cell","agency/scripts/orders.mjs",": ${names.created} is not a date written year first",": ${names.created} (${val('created')}) is not a date written year first"],
  // galxe-desk/scripts/agents.mjs — YAML spellings the loader reads as a breach now fail (9 Nov 2026)
  ["a frontmatter problem is a breach","agents.mjs","if (fm.problems.length) return fm.problems;","if (false) return fm.problems;"],
  ["a trailing YAML comment is not part of the value","agents.mjs","if (hash !== -1) v = v.slice(0, hash).trim();","if (false) v = v.slice(0, hash).trim();"],
  ["matching quotes are not part of the value","agents.mjs","return quoted ? quoted[2].trim() : v;","return v;"],
  ["a [a, b] flow list of tools is read as a list","agents.mjs","return (flow ? flow[1] : v).split","return v.split"],
  ["a tools or memory value that is not plain fails closed","agents.mjs","if (READ.has(key) && [].concat(fields[key]).some((v) => UNPLAIN.test(v))) problems.push(","if (false) problems.push("],
  ["a key set twice fails closed","agents.mjs","if (Object.hasOwn(fields, key)) problems.push(","if (false) problems.push("],
  ["a line that is not key: value fails closed","agents.mjs","if (!kv) problems.push(","if (false) problems.push("],
  ["an indented line under tools or memory fails closed","agents.mjs","if (key === null || READ.has(key)) problems.push(","if (false) problems.push("],
  // scripts/prove.mjs — review fixes: cookie exports, seeds as CSV that number 1, 2, 3, commands in prose only with a step-shaped argument (9 Nov 2026)
  ["a Netscape cookies.txt line is an X session cookie","scripts/prove.mjs","|\\t)[A-Fa-f0-9]{32,}/ },",")[A-Fa-f0-9]{32,}/ },"],
  ["a cookie export's name and value are read together across lines","scripts/prove.mjs","if (COOKIE_NAME.test(text)) named = at;","if (false) named = at;"],
  ["a cookie name pairs only with a value in its own file","scripts/prove.mjs","named.file === at.file && ",""],
  ["a cookie name pairs only with a value a few lines below it","scripts/prove.mjs"," && at.n - named.n <= COOKIE_LINES",""],
  ["only a hex value beside a cookie name is the cookie","scripts/prove.mjs"," && COOKIE_VALUE.test(text)",""],
  ["1st, 2nd and 3rd are numbering","scripts/prove.mjs","\\d{1,2}(?:st|nd|rd|th)?[.):]?","\\d{1,2}[.):]?"],
  ["w1 and word1 are numbering","scripts/prove.mjs","|(?:w|word)[_-]?\\d{1,2}[.):]?)$/i;",")$/i;"],
  ["word_1 is numbering","scripts/prove.mjs","|(?:w|word)[_-]?\\d{1,2}[.):]?)$/i;","|(?:w|word)-?\\d{1,2}[.):]?)$/i;"],
  ["word-1 is numbering","scripts/prove.mjs","|(?:w|word)[_-]?\\d{1,2}[.):]?)$/i;","|(?:w|word)_?\\d{1,2}[.):]?)$/i;"],
  ["a seed label is numbering in any case","scripts/prove.mjs","\\d{1,2}[.):]?)$/i;","\\d{1,2}[.):]?)$/;"],
  ["numbering before a word neither counts nor breaks a row","scripts/prove.mjs","if (m !== NUMBERING) row.push(m);","if (true) row.push(m === NUMBERING ? null : m);"],
  ["a number after its words is a count, not numbering, and breaks the row","scripts/prove.mjs","else if (typeof kept[i + 1]?.[0] !== 'string') row.push(null);","else if (false) row.push(null);"],
  ["a seed holds mostly different words","scripts/prove.mjs",">= SEED_WORDS - SEED_REPEATS) return true;",">= 0) return true;"],
  ["a seed may repeat two of its twelve words","scripts/prove.mjs","export const SEED_REPEATS = 2;","export const SEED_REPEATS = 1;"],
  ["three repeats in twelve words are a list, not a seed","scripts/prove.mjs","export const SEED_REPEATS = 2;","export const SEED_REPEATS = 3;"],
  ["any twelve words in a row of a run are read, not only the first twelve","scripts/prove.mjs","end <= words.length; end++","end <= SEED_WORDS; end++"],
  ["seed words on one line add up","scripts/prove.mjs","? [...run.slice(1 - SEED_WORDS), t.toLowerCase()] : [];","? [t.toLowerCase()] : [];"],
  ["one line of repeated colours and sizes is not a seed","scripts/prove.mjs","if (seedLike(run)) return true;","if (run.length >= SEED_WORDS) return true;"],
  ["rows of repeated colours and sizes are not a seed","scripts/prove.mjs","&& seedLike([...run.words, ...lead])) {","&& [...run.words, ...lead].length >= SEED_WORDS) {"],
  ["the words just before a number are its label, not seed words","scripts/prove.mjs","if (!after.includes(null)) row.length = label;",""],
  ["a word after a number is never a label","scripts/prove.mjs","label = row.length + 1;","label = row.length;"],
  ["a terminal tool with an argument in prose fails","scripts/prove.mjs","if (!why && PROSE_TOOL.test(line)) why =","if (false) why ="],
  ["a script run by its path in prose fails","scripts/prove.mjs","if (!why && RUN_SCRIPT.test(line)) why =","if (false) why ="],
  ["a script's bare name is a file named, not a step","scripts/prove.mjs","(?=\\\\.{1,2}[\\\\\\\\/]|~[\\\\\\\\/])${SCRIPT}","${SCRIPT}"],
  ["a markdown link to a script is not a step","scripts/prove.mjs","(?<![\\\\w.~/\\\\\\\\(-])(?=","(?<![\\\\w.~/\\\\\\\\-])(?="],
  ["a tool counts in prose only with an argument shaped like a command","scripts/prove.mjs","(?:${SHELL})\\\\s+(?:${STEP_ARG})","(?:${SHELL})\\\\s+\\\\S"],
  ["a tool name inside a word is not a tool","scripts/prove.mjs","(?<![\\\\w./-])(?:(?:${SHELL})\\\\s+(?:${STEP_ARG})","(?:(?:${SHELL})\\\\s+(?:${STEP_ARG})"],
  ["a flag after any tool is a step","scripts/prove.mjs","'--?[A-Za-z]', // a flag","'(?!)', // a flag"],
  ["a flag is a dash and a letter, not a dash in a sentence","scripts/prove.mjs","'--?[A-Za-z]', // a flag","'-', // a flag"],
  ["a home folder after any tool is a step","scripts/prove.mjs","'~(?:[\\\\\\\\/]|$)', // the home folder: ~/Desktop, or a bare ~ that ends the line; never \"~ 200\" or \"~40 kg\"","'(?!)', // the home folder: ~/Desktop, or a bare ~ that ends the line; never \"~ 200\" or \"~40 kg\""],
  ["a ~ before a number is about, not a home folder","scripts/prove.mjs","'~(?:[\\\\\\\\/]|$)', // the home folder: ~/Desktop, or a bare ~ that ends the line; never \"~ 200\" or \"~40 kg\"","'~', // the home folder: ~/Desktop, or a bare ~ that ends the line; never \"~ 200\" or \"~40 kg\""],
  ["a relative path after any tool is a step","scripts/prove.mjs","'\\\\.{1,2}[\\\\\\\\/]', // a relative path","'(?!)', // a relative path"],
  ["an absolute path after any tool is a step","scripts/prove.mjs","'[\\\\\\\\/][\\\\w.~-]+[\\\\\\\\/]'; // two parts","'(?!)'; // two parts"],
  ["an absolute path has two parts, so \"export /import\" passes","scripts/prove.mjs","'[\\\\\\\\/][\\\\w.~-]+[\\\\\\\\/]'; // two parts","'[\\\\\\\\/][\\\\w.~-]'; // two parts"],
  ["a drive path after any tool is a step","scripts/prove.mjs","'[A-Za-z]:\\\\\\\\', // a drive","'(?!)', // a drive"],
  ["install after brew, choco or bun is a step","scripts/prove.mjs","|(?:brew|choco|bun)\\\\s+(?:un|re)?install\\\\b",""],
  ["brew, choco and bun count only with install, so \"the cold brew update\" passes","scripts/prove.mjs","(?:brew|choco|bun)\\\\s+(?:un|re)?install\\\\b","(?:brew|choco|bun)\\\\s+(?:${SUBCOMMAND})\\\\b"],
  ["a subcommand after a tool no sentence names is a step","scripts/prove.mjs","|(?:${CLI})\\\\s+(?:${SUBCOMMAND})\\\\b",""],
  ["a tool no sentence names counts only with a subcommand, so \"gh token\" passes","scripts/prove.mjs","(?:${CLI})\\\\s+(?:${SUBCOMMAND})\\\\b","(?:${CLI})\\\\s+\\\\S"],
  ["nvm, docker and gh are tools no sentence names","scripts/prove.mjs","const CLI = 'winget|pnpm|pip3?|nvm|fnm|deno|docker|gh';","const CLI = 'winget';"],
  ["install is a subcommand","scripts/prove.mjs","const SUBCOMMAND = '(?:un|re)?install|","const SUBCOMMAND = '"],
  ["run, list, search, update and upgrade are subcommands","scripts/prove.mjs","|upgrade|update|list|search|run|","|"],
  ["gh auth login is a subcommand","scripts/prove.mjs","|auth\\\\s+login';","';"],
  ["a command after sudo is a step","scripts/prove.mjs","|sudo\\\\s+(?:${SHELL})\\\\b",""],
  ["sudo counts only before a command, so \"no sudo is needed\" passes","scripts/prove.mjs","sudo\\\\s+(?:${SHELL})\\\\b","sudo\\\\s+\\\\S"],
  ["powercfg's /switch is a step","scripts/prove.mjs","|powercfg\\\\s+\\\\/[A-Za-z]",""],
  ["curl's or wget's URL is a step","scripts/prove.mjs","|(?:curl|wget)\\\\s+https?:\\\\/\\\\/)`);",")`);"],
  ["wget's URL is a step too","scripts/prove.mjs","(?:curl|wget)\\\\s+https?","curl\\\\s+https?"],
  ["curl counts only with its URL, so \"curl up with the draft\" passes","scripts/prove.mjs","(?:curl|wget)\\\\s+https?:\\\\/\\\\/","(?:curl|wget)\\\\s+\\\\S"],
  ["a numbered row joins only on the next number","scripts/prove.mjs","const joins = next && runsOn(run, nums);","const joins = next;"],
  ["numbers that do not rise along one line are not a seed's","scripts/prove.mjs","nums.some((n, i) => i > 0 && n <= nums[i - 1])","false"],
  ["a second column's numbers run on from the first","scripts/prove.mjs"," || nums[0] === run.first + 1;",";"],
  ["a row's numbers carry the run on","scripts/prove.mjs","blank: false, ...numbered(nums, run) };","blank: false };"],
  ["the home folder is a ~ before a path or the end of the line","scripts/prove.mjs","'~(?:[\\\\\\\\/]|$)', // the home folder: ~/Desktop, or a bare ~ that ends the line; never \"~ 200\" or \"~40 kg\"","'~(?!\\\\w)', // the home folder: ~/Desktop, or a bare ~ that ends the line; never \"~ 200\" or \"~40 kg\""],
  ["an absolute path after a word said in prose is prose","scripts/prove.mjs","(?:${PATH_SHELL})\\\\s+${ABSOLUTE_PATH}","(?:${SHELL})\\\\s+${ABSOLUTE_PATH}"],
  ["yarn installs only when nothing but a flag follows","scripts/prove.mjs","|yarn\\\\s+(?:un|re)?install(?=\\\\s*(?:$|--?[A-Za-z]))","|yarn\\\\s+(?:un|re)?install"],
  ["yarn install alone on a line is still a step","scripts/prove.mjs","|yarn\\\\s+(?:un|re)?install(?=\\\\s*(?:$|--?[A-Za-z]))",""],
  // scripts/prove.mjs — verifier round 3: a CSV splits only as a seed backup row or a six-word comma list; a numbered list of several words to a number is a list (9 Nov 2026)
  ["a seed backup's two cells are read as a number and a word","scripts/prove.mjs","const cells = SEED_CELLS.exec(String(text));","const cells = null;"],
  ["semicolons separate a seed backup's cells","scripts/prove.mjs","[\"']?\\s*[,;]\\s*[\"']?([A-Za-z]+)","[\"']?\\s*,\\s*[\"']?([A-Za-z]+)"],
  ["a row wider than two cells is not a seed backup's","scripts/prove.mjs","\\s*[,;]?\\s*$/i;","/i;"],
  ["a backup row's first cell is its number","scripts/prove.mjs","/^\\s*[\"']?(#?\\d{1,2}","/^\\s*[\"']?([A-Za-z]+|#?\\d{1,2}"],
  ["a comma list of six BIP39 words is read as words","scripts/prove.mjs","listCells(String(text)) ?? ",""],
  ["a comma list needs six cells","scripts/prove.mjs","parts.length >= SEED_LIST_CELLS && ",""],
  ["every cell of a comma list is a BIP39 word","scripts/prove.mjs"," && parts.every((c) => BIP39.has(c))",""],
  ["a number that owns several words at the end of a line heads a list","scripts/prove.mjs","if (nums.length && row.length > label && !row.slice(label).includes(null)) list = true;",""],
  ["more than two words between numbers is a list, not a label","scripts/prove.mjs","if (nums.length && after.length > SEED_LABEL_WORDS && !after.includes(null)) list = true;",""],
  ["two words may label a number","scripts/prove.mjs","export const SEED_LABEL_WORDS = 2;","export const SEED_LABEL_WORDS = 1;"],
  ["a list line is not seed words","scripts/prove.mjs","if (list || nums.some(","if (nums.some("],
  ["commas and semicolons split only a backup row or a comma list","scripts/prove.mjs","String(text).split(/[\\s|]+/);","String(text).split(/[\\s|,;]+/);"],
  // claude-setup/skills/joy-boot/scripts/boot.mjs, folded in from its own mutate.mjs (21 Nov 2026) (added by mutate --add)
  ["a big transcript is told to compact at 150,000 tokens, not ten times that","claude-setup/skills/joy-boot/scripts/boot.mjs","big: 150_000,","big: 1_500_000,"],
  // galxe-desk/scripts/mutate.mjs: its own guards, judged by mutate.test.mjs (21 Nov 2026) (added by mutate --add)
  ["--only: a term that selects nothing refuses the run","galxe-desk/scripts/mutate.mjs","    if (sel.unmatched.length) {\n","    if (false) {\n"],
  ["--only: each term that selects nothing is named","galxe-desk/scripts/mutate.mjs","const unmatched = terms.filter((t) => !list.some((m) => hit(m, t))); // each term must select something\n","const unmatched = []; // each term must select something\n"],
  ["--only: a list of no term is refused","galxe-desk/scripts/mutate.mjs","if (!terms.length) o.errors.push(`--only ${JSON.stringify(v)} names no term`); // \"--only ,\" is not \"everything\"\n","if (false) o.errors.push(`--only ${JSON.stringify(v)} names no term`); // \"--only ,\" is not \"everything\"\n"],
  ["an unknown argument is refused, not ignored","galxe-desk/scripts/mutate.mjs","} else o.errors.push(`unknown argument ${JSON.stringify(a)}`); // a typo is refused, not ignored\n","} // a typo is refused, not ignored\n"],
  ["an empty run is never \"every guard bites\"","galxe-desk/scripts/mutate.mjs","    return { lines, code: 1 }; // an empty run is never \"every guard bites\"\n","    return { lines, code: 0 }; // an empty run is never \"every guard bites\"\n"],
  ["a timeout is TIMEOUT, never a kill","galxe-desk/scripts/mutate.mjs","  if (timedOut) return 'TIMEOUT'; // past its deadline, whatever killed it\n","  if (false) return 'TIMEOUT'; // past its deadline, whatever killed it\n"],
  ["a signal is CRASHED, never a kill","galxe-desk/scripts/mutate.mjs","  if (signal || overflow) return 'CRASHED'; // stopped from outside, or more output than the buffer holds\n","  if (overflow) return 'CRASHED'; // stopped from outside, or more output than the buffer holds\n"],
  ["an output overflow is CRASHED, never a kill","galxe-desk/scripts/mutate.mjs","  if (signal || overflow) return 'CRASHED'; // stopped from outside, or more output than the buffer holds\n","  if (signal) return 'CRASHED'; // stopped from outside, or more output than the buffer holds\n"],
  ["exit 0 is SURVIVED","galxe-desk/scripts/mutate.mjs","  if (code === 0) return 'SURVIVED'; // green with the guard gone\n","  if (false) return 'SURVIVED'; // green with the guard gone\n"],
  ["a kill needs exit 1","galxe-desk/scripts/mutate.mjs","  if (code === 1 && FAILED_TEST.test(String(stdout ?? ''))) return 'KILLED'; // a test went red\n","  if (FAILED_TEST.test(String(stdout ?? ''))) return 'KILLED'; // a test went red\n"],
  ["a kill needs a failed test in the summary","galxe-desk/scripts/mutate.mjs","  if (code === 1 && FAILED_TEST.test(String(stdout ?? ''))) return 'KILLED'; // a test went red\n","  if (code === 1) return 'KILLED'; // a test went red\n"],
  ["\"# fail 0\" is not a failed test","galxe-desk/scripts/mutate.mjs","const FAILED_TEST = /^# fail [1-9]/m;\n","const FAILED_TEST = /^# fail /m;\n"],
  ["the failed-test count is read at the start of a line","galxe-desk/scripts/mutate.mjs","const FAILED_TEST = /^# fail [1-9]/m;\n","const FAILED_TEST = /# fail [1-9]/;\n"],
  ["only KILLED counts","galxe-desk/scripts/mutate.mjs","    else bad++; // only KILLED counts\n","    // only KILLED counts\n"],
  ["a result that never came back fails the run","galxe-desk/scripts/mutate.mjs","      bad++; // a result that never came back is a failed run, never a shorter one\n","      // a result that never came back is a failed run, never a shorter one\n"],
  ["a baseline must pass at least one test","galxe-desk/scripts/mutate.mjs","  if (!stopped && r.code === 0 && pass >= 1 && fail === 0) return null; // the one green baseline\n","  if (!stopped && r.code === 0 && fail === 0) return null; // the one green baseline\n"],
  ["a baseline with a failed test is red","galxe-desk/scripts/mutate.mjs","  if (!stopped && r.code === 0 && pass >= 1 && fail === 0) return null; // the one green baseline\n","  if (!stopped && r.code === 0 && pass >= 1) return null; // the one green baseline\n"],
  ["a baseline must exit 0","galxe-desk/scripts/mutate.mjs","  if (!stopped && r.code === 0 && pass >= 1 && fail === 0) return null; // the one green baseline\n","  if (!stopped && pass >= 1 && fail === 0) return null; // the one green baseline\n"],
  ["a signalled, late or overflowing baseline is red","galxe-desk/scripts/mutate.mjs","  const stopped = !r || r.signal || r.timedOut || r.overflow;\n","  const stopped = !r;\n"],
  ["a red baseline makes its mutations BASELINE_RED","galxe-desk/scripts/mutate.mjs","    const key = p.suite.join('\\n');\n    if (red.has(key))","    const key = p.suite.join('\\n');\n    if (false)"],
  ["a baseline that is not green is recorded","galxe-desk/scripts/mutate.mjs","    if (why) red.set(key, why); // the suite was not green before any mutation\n","    // the suite was not green before any mutation\n"],
  ["a deadline marks the run TIMEOUT","galxe-desk/scripts/mutate.mjs","      timedOut = true; // the deadline passed\n","      // the deadline passed\n"],
  ["a deadline stops the run","galxe-desk/scripts/mutate.mjs","      timedOut = true; // the deadline passed\n      stop(child);\n","      timedOut = true; // the deadline passed\n"],
  ["a deadline stops the whole process group","galxe-desk/scripts/mutate.mjs","const stop = (child) => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };\n","const stop = (child) => { try { child.kill('SIGKILL'); } catch { /* gone */ } };\n"],
  ["an output overflow is marked","galxe-desk/scripts/mutate.mjs","        overflow = true; // the output ran past the buffer\n","        // the output ran past the buffer\n"],
  ["a suite's output is read whole up to 64 MiB","galxe-desk/scripts/mutate.mjs","export const MAX_BUFFER = 64 * 1024 * 1024;\n","export const MAX_BUFFER = 1024 * 1024;\n"],
  ["a nested test runner still prints TAP","galxe-desk/scripts/mutate.mjs","    delete env.NODE_TEST_CONTEXT; // set under node --test, where a nested runner prints no TAP and exits 0\n","    // set under node --test, where a nested runner prints no TAP and exits 0\n"],
  ["the default deadline is 120 s","galxe-desk/scripts/mutate.mjs","export const DEFAULT_TIMEOUT_MS = 120_000;\n","export const DEFAULT_TIMEOUT_MS = 1_200_000;\n"],
  ["--jobs above 16 is refused","galxe-desk/scripts/mutate.mjs","|| Number(v) > 16) o.errors.push(`--jobs must be a whole number from 1 to 16, not ${JSON.stringify(v)}`);\n","|| false) o.errors.push(`--jobs must be a whole number from 1 to 16, not ${JSON.stringify(v)}`);\n"],
  ["--jobs below 1 is refused","galxe-desk/scripts/mutate.mjs","if (!/^\\d+$/.test(v) || Number(v) < 1 || Number(v) > 16)","if (!/^\\d+$/.test(v) || Number(v) > 16)"],
  ["--jobs must be a whole number","galxe-desk/scripts/mutate.mjs","if (!/^\\d+$/.test(v) || Number(v) < 1 || Number(v) > 16)","if (Number(v) < 1 || Number(v) > 16)"],
  ["--timeout-ms must be a positive whole number","galxe-desk/scripts/mutate.mjs","if (!/^\\d+$/.test(v) || Number(v) < 1) o.errors.push(`--timeout-ms","if (false) o.errors.push(`--timeout-ms"],
  ["the default is four jobs, or fewer CPUs","galxe-desk/scripts/mutate.mjs","export const DEFAULT_JOBS = Math.min(4, availableParallelism());\n","export const DEFAULT_JOBS = Math.min(4, availableParallelism()) + 1;\n"],
  ["results are stored by list position","galxe-desk/scripts/mutate.mjs","        results[i] = await worker(items[i], i);\n","        results.push(await worker(items[i], i));\n"],
  ["a worker that throws is CRASHED in its own slot","galxe-desk/scripts/mutate.mjs","        results[i] = crashed(items[i], err);\n","        throw err;\n"],
  ["the pool never runs more than --jobs at once","galxe-desk/scripts/mutate.mjs","Math.max(1, Math.min(jobs, items.length)) }, lane));\n","Math.max(1, items.length) }, lane));\n"],
  ["the pool runs --jobs at once","galxe-desk/scripts/mutate.mjs","Math.max(1, Math.min(jobs, items.length)) }, lane));\n","Math.max(1, Math.min(1, items.length)) }, lane));\n"],
  ["an empty result slot is found","galxe-desk/scripts/mutate.mjs","  for (let i = 0; i < n; i++) if (!results?.[i] || typeof results[i].status !== 'string') out.push(i);\n","  for (let i = 0; i < n; i++) if (false) out.push(i);\n"],
  ["--since: a revision that looks like an option never reaches git","galxe-desk/scripts/mutate.mjs","|| rev.startsWith('-')) return { error: `--since needs a revision, not ${JSON.stringify(rev)}` }; // never an option to git\n",") return { error: `--since needs a revision, not ${JSON.stringify(rev)}` }; // never an option to git\n"],
  ["--since: the revision must verify as a commit","galxe-desk/scripts/mutate.mjs","  if (!verified) return { error: `${rev} does not verify as a commit in this repository` };\n","  if (false) return { error: `${rev} does not verify as a commit in this repository` };\n"],
  ["--since: rev-parse must print a commit id","galxe-desk/scripts/mutate.mjs","const verified = v?.code === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha);\n","const verified = v?.code === 0;\n"],
  ["--since: a failed git diff is never \"nothing changed\"","galxe-desk/scripts/mutate.mjs","  if (diff?.code !== 0) return { error: `git diff against ${rev} failed (exit ${diff?.code}), so what changed is unknown` };\n","  if (false) return { error: `git diff against ${rev} failed (exit ${diff?.code}), so what changed is unknown` };\n"],
  ["--since: a failed git ls-files is never \"nothing untracked\"","galxe-desk/scripts/mutate.mjs","  if (extra?.code !== 0) return { error: `git ls-files failed (exit ${extra?.code}), so the untracked files are unknown` };\n","  if (false) return { error: `git ls-files failed (exit ${extra?.code}), so the untracked files are unknown` };\n"],
  ["--since: untracked files count as changed","galxe-desk/scripts/mutate.mjs","  const all = [...new Set([...nul(diff.stdout), ...nul(extra.stdout)])];\n","  const all = [...new Set([...nul(diff.stdout)])];\n"],
  ["--since: another worktree is not a change here","galxe-desk/scripts/mutate.mjs","  return { sha, files: all.filter((f) => !f.startsWith('.claude/worktrees/')).sort() }; // another worktree is another checkout\n","  return { sha, files: all.sort() }; // another worktree is another checkout\n"],
  ["--since: a failed diff of mutate.mjs refuses the run","galxe-desk/scripts/mutate.mjs","      if (d?.code !== 0) {\n","      if (false) {\n"],
  ["--since: imports are followed through files no suite owns","galxe-desk/scripts/mutate.mjs","      if (SCRIPT.test(target)) visit(target); // followed through files no suite owns\n","      // followed through files no suite owns\n"],
  ["--since: imports are followed however deep","galxe-desk/scripts/mutate.mjs","      stack.push(d); // and what that imports\n","      // and what that imports\n"],
  ["--since: a changed test file selects its suite's guards","galxe-desk/scripts/mutate.mjs","    for (const start of [rel, ...tests]) for (const f of reach(start)) if (changed.has(f)) return true;\n","    for (const start of [rel]) for (const f of reach(start)) if (changed.has(f)) return true;\n"],
  ["--since: a changed file selects its own guards","galxe-desk/scripts/mutate.mjs","    for (const start of [rel, ...tests]) for (const f of reach(start)) if (changed.has(f)) return true;\n","    for (const start of [...tests]) for (const f of reach(start)) if (changed.has(f)) return true;\n"],
  ["--since: a data file under the same top-level folder selects","galxe-desk/scripts/mutate.mjs","    for (const c of changed) if (!c.endsWith('.mjs') && c.startsWith(`${top}/`)) return true; // a data file nearby\n","    // a data file nearby\n"],
  ["--since: a file READS lists selects","galxe-desk/scripts/mutate.mjs","    return (reads[dirOf(rel)] ?? []).some(readChanged);\n","    return false;\n"],
  ["--since: a hunk outside MUTATIONS is code","galxe-desk/scripts/mutate.mjs","      if (!inside) outside = true; // this hunk changed code, not a line of the list\n","      // this hunk changed code, not a line of the list\n"],
  ["--since: changed code in mutate.mjs runs its own guards","galxe-desk/scripts/mutate.mjs","    if (rel === self && own.outside) return true;\n","    if (false) return true;\n"],
  ["--since: only lines inside MUTATIONS name mutations","galxe-desk/scripts/mutate.mjs","      if (next > open && next < close) added.push(line.slice(1)); // a line of the list, by its own line number\n","      added.push(line.slice(1)); // a line of the list, by its own line number\n"],
  ["--since: an added line selects the mutations it names","galxe-desk/scripts/mutate.mjs","    let hit = list.flatMap((m, i) => (spellings(m[0]).some((s) => t.includes(s)) ? [i] : []));\n","    let hit = [];\n"],
  ["--since: a name is found inside a JSON string","galxe-desk/scripts/mutate.mjs","[name, JSON.stringify(name).slice(1, -1), name.split('\\\\')","[name, name.split('\\\\')"],
  ["--since: a name is found inside a single-quoted string","galxe-desk/scripts/mutate.mjs",", name.split('\\\\').join('\\\\\\\\').split(\"'\").join(\"\\\\'\")];","];"],
  ["--since: a group's path line selects that file's guards","galxe-desk/scripts/mutate.mjs","    if (!hit.length) hit = list.flatMap((m, i) => (t.includes(m[1]) ? [i] : [])); // a group's path line\n","    // a group's path line\n"],
  ["--since: a line that names nothing selects every mutation","galxe-desk/scripts/mutate.mjs","    if (!hit.length) hit = list.map((_, i) => i); // an added line that names nothing: every mutation\n","    // an added line that names nothing: every mutation\n"],
  ["--since: mutate.mjs changed with no hunk selects everything","galxe-desk/scripts/mutate.mjs","  const unknown = selfChanged && own.hunks === 0; // mutate.mjs changed but no hunk says how: run everything\n","  const unknown = false; // mutate.mjs changed but no hunk says how: run everything\n"],
  ["--since: a changed script no mutation names is UNGUARDED","galxe-desk/scripts/mutate.mjs","SCRIPT.test(f) && !/\\.test\\.m?js$/.test(f)","false && !/\\.test\\.m?js$/.test(f)"],
  ["a file's own suite beats its folder's","galxe-desk/scripts/mutate.mjs","  if (Object.hasOwn(suiteFor, rel)) return [...suiteFor[rel]]; // a file's own suite beats its folder's\n","  // a file's own suite beats its folder's\n"],
  ["--add needs --group","galxe-desk/scripts/mutate.mjs","if (o.add !== undefined && o.group === undefined) o.errors.push('--add needs --group \"<one line>\"');\n","if (false) o.errors.push('--add needs --group \"<one line>\"');\n"],
  ["--add takes no --only, --since or --list","galxe-desk/scripts/mutate.mjs","if (o.add !== undefined && (o.only || o.since !== undefined || o.list)) o.errors.push('--add runs its own batch only; drop --only, --since and --list');\n","if (false) o.errors.push('--add runs its own batch only; drop --only, --since and --list');\n"],
  ["--add needs a group","galxe-desk/scripts/mutate.mjs","  if (typeof group !== 'string' || !group.trim()) problems.push('--group must name the batch in one line');\n","  if (false) problems.push('--group must name the batch in one line');\n"],
  ["--add refuses a group with a line break","galxe-desk/scripts/mutate.mjs","  else if (/[\\r\\n\\u2028\\u2029]/.test(group)) problems.push(","  else if (false) problems.push("],
  ["--add refuses an empty batch","galxe-desk/scripts/mutate.mjs","  if (!Array.isArray(batch) || !batch.length) {\n","  if (!Array.isArray(batch)) {\n"],
  ["--add refuses a line that is not four strings","galxe-desk/scripts/mutate.mjs","    if (!Array.isArray(line) || line.length !== 4 || !line.every((x) => typeof x === 'string')) {\n","    if (!Array.isArray(line)) {\n"],
  ["--add refuses an empty from","galxe-desk/scripts/mutate.mjs","    if (from === '') problems.push(`${tag}: from is empty`);\n","    if (false) problems.push(`${tag}: from is empty`);\n"],
  ["--add refuses a from that equals its to","galxe-desk/scripts/mutate.mjs","    if (from === to) problems.push(`${tag}: from and to are the same, so no guard is removed`);\n","    if (false) problems.push(`${tag}: from and to are the same, so no guard is removed`);\n"],
  ["--add refuses a name already in MUTATIONS","galxe-desk/scripts/mutate.mjs","  const taken = new Set(mutations.map((m) => m[0]));\n","  const taken = new Set();\n"],
  ["--add refuses a name used twice in the batch","galxe-desk/scripts/mutate.mjs","    taken.add(name); // a second line of the batch may not reuse it either\n","    // a second line of the batch may not reuse it either\n"],
  ["--add refuses an absolute path","galxe-desk/scripts/mutate.mjs","    if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) {\n","    if (false) {\n"],
  ["--add refuses a path holding \"..\"","galxe-desk/scripts/mutate.mjs","    if (path.includes('..')) {\n","    if (false) {\n"],
  ["--add refuses a missing file","galxe-desk/scripts/mutate.mjs","    if (!existsSync(p) || !statSync(p).isFile()) {\n","    if (false) {\n"],
  ["--add refuses a file with no suite","galxe-desk/scripts/mutate.mjs","    if (!suiteOf(rel, { root, suites, suiteFor }).length) problems.push(`${tag}: ${rel} has no suite to judge it`);\n","    if (false) problems.push(`${tag}: ${rel} has no suite to judge it`);\n"],
  ["--add refuses a from found no times or twice","galxe-desk/scripts/mutate.mjs","    if (found.status) problems.push(`${tag}: from ${found.status === 'NO_MATCH' ? 'is not found' : 'occurs more than once'} in ${rel}`);\n","    if (false) problems.push(`${tag}: from ${found.status === 'NO_MATCH' ? 'is not found' : 'occurs more than once'} in ${rel}`);\n"],
  ["--add refuses a from that would match its own written line","galxe-desk/scripts/mutate.mjs","    else if (rel === target && ins?.text && findOnce(ins.text, from).status) problems.push(`${tag}: from would also match its own line once written into ${rel}`);\n","    else if (false) problems.push(`${tag}: from would also match its own line once written into ${rel}`);\n"],
  ["--add refuses a harness with two closing lines","galxe-desk/scripts/mutate.mjs","  if (open < 0 || lines.lastIndexOf('export const MUTATIONS = [') !== open || closes.length !== 1 || closes[0] < open) {\n","  if (open < 0 || lines.lastIndexOf('export const MUTATIONS = [') !== open || closes.length < 1 || closes[0] < open) {\n"],
  ["--add counts only KILLED","galxe-desk/scripts/mutate.mjs","    if (r?.status !== 'KILLED') notKilled.push(`line ${k + 1} (${JSON.stringify(batch[k][0])}) was not killed: ${r?.status ?? 'MISSING'}${r?.detail ? ` — ${r.detail}` : ''}`);\n","    if (false) notKilled.push(`line ${k + 1} (${JSON.stringify(batch[k][0])}) was not killed: ${r?.status ?? 'MISSING'}${r?.detail ? ` — ${r.detail}` : ''}`);\n"],
  ["--add writes nothing unless every line is killed","galxe-desk/scripts/mutate.mjs","  if (notKilled.length) return { ok: false, problems: notKilled }; // nothing is written unless every line bites\n","  // nothing is written unless every line bites\n"],
  ["--add checks the re-imported list ends with the batch","galxe-desk/scripts/mutate.mjs","  if (JSON.stringify(tail) !== JSON.stringify(batch)) {\n","  if (false) {\n"],
  ["--add puts the old bytes back","galxe-desk/scripts/mutate.mjs","    writeAtomic(target, before); // the old bytes go back\n","    // the old bytes go back\n"],
  // galxe-desk/scripts/mutate.mjs: a READS folder entry, so .claude/agents reaches agents.mjs (21 Nov 2026) (added by mutate --add)
  ["--since: a READS folder entry covers what is under it","galxe-desk/scripts/mutate.mjs","  const readChanged = (f) => (f.endsWith('/') ? [...changed].some((c) => c.startsWith(f)) : changed.has(f)); // a folder entry covers what is under it\n","  const readChanged = (f) => changed.has(f); // a folder entry covers what is under it\n"],
  ["--since: a changed agent file reruns the desk's firewall guards","galxe-desk/scripts/mutate.mjs","  'galxe-desk/scripts': ['.claude/agents/'],\n","\n"],
  // claude-setup/skills/joy-boot/scripts/boot.mjs: its input guard, now that boot.test.mjs sends null (21 Nov 2026) (added by mutate --add)
  ["boot: a null hook input is read as an empty object","claude-setup/skills/joy-boot/scripts/boot.mjs","if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};",""],
  // galxe-desk/scripts/mutate.mjs: a config hunk runs every guard; one guard never counts twice (21 Nov 2026) (added by mutate --add)
  ["--since: a hunk in a config block of mutate.mjs selects every mutation","galxe-desk/scripts/mutate.mjs","  const everything = unknown ? 'changed, but no hunk of its diff says how' : own.config; // a config change reaches every folder's run\n","  const everything = unknown ? 'changed, but no hunk of its diff says how' : null; // a config change reaches every folder's run\n"],
  ["--since: a config marker that is missing selects every mutation","galxe-desk/scripts/mutate.mjs","    if (at < 0 || twice) return null; // a marker missing or twice: where this block sits is unknown\n","    if (at < 0 || twice) return []; // a marker missing or twice: where this block sits is unknown\n"],
  ["--since: a config marker found twice selects every mutation","galxe-desk/scripts/mutate.mjs","    const twice = at >= 0 && lines.some((l, i) => i > at && l.startsWith(marker)); // a second marker\n","    const twice = false; // a second marker\n"],
  ["--since: a config block that never closes selects every mutation","galxe-desk/scripts/mutate.mjs","    if (end < 0) return null; // a block that never closes\n","    if (false) return null; // a block that never closes\n"],
  ["--since: a config block runs to its closing line","galxe-desk/scripts/mutate.mjs","    spans.push({ name, start: at + 1, end: end + 1 }); // a block runs to its closing line\n","    spans.push({ name, start: at + 1, end: at + 1 }); // a block runs to its closing line\n"],
  ["--since: a line ending in \";\" inside a config block does not close it","galxe-desk/scripts/mutate.mjs","(i === at || /^[}\\]]/.test(l))","true"],
  ["--since: a cut touches the lines on both sides of it","galxe-desk/scripts/mutate.mjs","      const [lo, hi] = d === 0 ? [c, c + 1] : [c, c + d - 1]; // a cut touches the lines on both sides of it\n","      const [lo, hi] = [c, c + d - 1]; // a cut touches the lines on both sides of it\n"],
  ["--since: a hunk that meets a config block marks it changed","galxe-desk/scripts/mutate.mjs","      for (const s of spans ?? []) if (lo <= s.end && hi >= s.start) touched.add(s.name); // this hunk changed a config block\n","      for (const s of spans ?? []) if (false) touched.add(s.name); // this hunk changed a config block\n"],
  ["--since: config blocks that cannot be found select every mutation","galxe-desk/scripts/mutate.mjs","  const config = !spans ? `changed, and its ${CONFIG.map((b) => b[0]).join(', ')} cannot each be found once` : touched.size ? `changed ${[...touched].join(' and ')}` : null;\n","  const config = false ? `changed, and its ${CONFIG.map((b) => b[0]).join(', ')} cannot each be found once` : touched.size ? `changed ${[...touched].join(' and ')}` : null;\n"],
  ["--add refuses a line that is an existing guard under a new name","galxe-desk/scripts/mutate.mjs","      if (twin !== undefined) problems.push(`${tag}: is the same guard as ${JSON.stringify(twin)}: it leaves ${rel} byte-identical`);\n","      if (false) problems.push(`${tag}: is the same guard as ${JSON.stringify(twin)}: it leaves ${rel} byte-identical`);\n"],
  ["--add refuses a batch line that repeats an earlier line's cut","galxe-desk/scripts/mutate.mjs","      known.set(key, name); // a later line of the batch may not repeat it either\n","       // a later line of the batch may not repeat it either\n"],
  ["--add checks a line against the guards already listed for its file","galxe-desk/scripts/mutate.mjs","    if (!effects.has(rel)) effects.set(rel, new Map(mutations.filter((m) => relPath(m[1]) === rel).map((m) => [effect(rel, src, m[2], m[3]), m[0]]).filter(([key]) => key !== null)));\n","    if (!effects.has(rel)) effects.set(rel, new Map());\n"],
  ["--add counts a bare name and its full path as one file","galxe-desk/scripts/mutate.mjs","    if (!effects.has(rel)) effects.set(rel, new Map(mutations.filter((m) => relPath(m[1]) === rel).map((m) => [effect(rel, src, m[2], m[3]), m[0]]).filter(([key]) => key !== null)));\n","    if (!effects.has(rel)) effects.set(rel, new Map(mutations.filter((m) => m[1] === rel).map((m) => [effect(rel, src, m[2], m[3]), m[0]]).filter(([key]) => key !== null)));\n"],
  ["two listed lines that leave a file byte-identical are found","galxe-desk/scripts/mutate.mjs","    if (seen.has(key)) pairs.push([seen.get(key), m[0]]); // one guard under two names\n","    if (false) pairs.push([seen.get(key), m[0]]); // one guard under two names\n"],
];

// ---------------------------------------------------------------------------------------------------------------
// The runner. Pure pieces are exported so mutate.test.mjs can judge them on a fixture repo, with git, the child
// process and the copy injected where a test fakes a crash, a timeout or a git failure.

export const MAX_BUFFER = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_JOBS = Math.min(4, availableParallelism());
const FAILED_TEST = /^# fail [1-9]/m;
const LIVE = new Set();

const posixRel = (p) => p.split(sep).join('/');
export const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');

// The test files listed for `rel`, from the repo root: its own suite if it has one, else its folder's.
export function suiteListed(rel, { suites = SUITES, suiteFor = SUITE_FOR } = {}) {
  if (Object.hasOwn(suiteFor, rel)) return [...suiteFor[rel]]; // a file's own suite beats its folder's
  const dir = dirOf(rel);
  return (suites[dir] || []).map((f) => (dir ? `${dir}/${f}` : f));
}

export const suiteOf = (rel, { root = REPO, suites = SUITES, suiteFor = SUITE_FOR } = {}) =>
  suiteListed(rel, { suites, suiteFor }).filter((f) => existsSync(join(root, f)));

// Where `from` sits in `src`, or why it cannot be used: it must occur exactly once. A run and --add both use this.
export function findOnce(src, from) {
  if (typeof from !== 'string' || from === '') return { status: 'NO_MATCH', detail: 'the pattern is empty' };
  const i = src.indexOf(from);
  if (i < 0) return { status: 'NO_MATCH', detail: 'pattern not found' };
  if (src.indexOf(from, i + 1) >= 0) return { status: 'AMBIGUOUS', detail: 'pattern occurs more than once' };
  return { i };
}

// A mutation checked against the tree before anything is copied: its file, its one match and its suite.
export function prepare(m, { root = REPO, suites = SUITES, suiteFor = SUITE_FOR, read = (p) => readFileSync(p, 'utf8') } = {}) {
  const [name, file, from, to] = m;
  const rel = relPath(file);
  const p = join(root, rel);
  if (!existsSync(p)) return { name, status: 'NO_MATCH', detail: `${rel} does not exist` };
  const at = findOnce(read(p), from);
  if (at.status) return { name, status: at.status, detail: `${at.detail} in ${rel}` };
  const suite = suiteOf(rel, { root, suites, suiteFor });
  // A guard with no suite to judge it cannot be said to bite. Fail closed rather than report it killed.
  if (!suite.length) return { name, status: 'NO_SUITE', detail: `no test file exists for ${rel}` };
  return { name, rel, from, to, suite };
}

// What one suite run means. Only an exit of 1 with a failed test in the TAP summary is a kill.
export function classify({ code, signal, timedOut, overflow, stdout } = {}) {
  if (timedOut) return 'TIMEOUT'; // past its deadline, whatever killed it
  if (signal || overflow) return 'CRASHED'; // stopped from outside, or more output than the buffer holds
  if (code === 0) return 'SURVIVED'; // green with the guard gone
  if (code === 1 && FAILED_TEST.test(String(stdout ?? ''))) return 'KILLED'; // a test went red
  return 'CRASHED';
}

// Why an unmutated suite run is not green, or null when it is: exit 0, at least one pass and no failure.
export function baselineProblem(r) {
  const out = String(r?.stdout ?? '');
  const pass = Number((/^# pass (\d+)/m.exec(out) || [])[1] ?? NaN);
  const fail = Number((/^# fail (\d+)/m.exec(out) || [])[1] ?? NaN);
  const stopped = !r || r.signal || r.timedOut || r.overflow;
  if (!stopped && r.code === 0 && pass >= 1 && fail === 0) return null; // the one green baseline
  return `${r?.detail ? `${r.detail}; ` : ''}exit ${r?.code ?? 'none'}${r?.signal ? `, signal ${r.signal}` : ''}${r?.timedOut ? ', past its deadline' : ''}${r?.overflow ? ', output over the buffer' : ''}, # pass ${pass}, # fail ${fail}`;
}

const stop = (child) => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
const stopAll = () => { for (const child of LIVE) stop(child); };

// Run node with `args` in its own process group, so a deadline or an overflow stops its children too.
export function spawnNode(args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = MAX_BUFFER } = {}) {
  return new Promise((done) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // set under node --test, where a nested runner prints no TAP and exits 0
    let child;
    let timer;
    let settled = false;
    let timedOut = false;
    let overflow = false;
    let size = 0;
    let stderr = '';
    const out = [];
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) LIVE.delete(child);
      done({ timedOut, overflow, stdout: Buffer.concat(out).toString('utf8'), stderr, ...r });
    };
    try {
      child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ code: null, signal: null, detail: `could not start node: ${err.message}` });
      return;
    }
    LIVE.add(child);
    timer = setTimeout(() => {
      timedOut = true; // the deadline passed
      stop(child);
    }, timeoutMs);
    child.stdout.on('data', (b) => {
      size += b.length;
      if (size > maxBuffer) {
        overflow = true; // the output ran past the buffer
        stop(child);
      } else out.push(b);
    });
    child.stderr.on('data', (b) => { if (stderr.length < 65_536) stderr += b; });
    child.on('error', (err) => finish({ code: null, signal: null, detail: `node could not run: ${err.message}` }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

export function copyRepo(root, work) {
  cpSync(root, work, { recursive: true, filter: (src) => { const r = relative(root, src); return !SKIP.some((s) => r === s || r.startsWith(s + sep)); } });
}

// One suite run in a fresh throwaway copy: unmutated when `m` is null (the baseline), else with `m` applied.
async function runSuite(root, suite, m, { spawn: run, copy, timeoutMs, maxBuffer }) {
  const work = mkdtempSync(join(tmpdir(), 'mutate-'));
  try {
    copy(root, work);
    if (m) {
      const p = join(work, m.rel);
      const src = readFileSync(p, 'utf8');
      const at = findOnce(src, m.from);
      if (at.status) return { code: null, signal: null, detail: `${at.detail} in the copy of ${m.rel}` };
      writeFileSync(p, src.slice(0, at.i) + m.to + src.slice(at.i + m.from.length));
    }
    return await run(['--test', '--test-reporter=tap', ...suite.map((f) => join(work, f))], { cwd: work, timeoutMs, maxBuffer });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// At most `jobs` workers at once. Each result is stored at its item's own position, so the output order never
// depends on which finished first, and a worker that throws fills its own slot with CRASHED.
export async function runPool(items, jobs, worker, crashed = (item, err) => ({ status: 'CRASHED', detail: `the worker threw: ${err?.message ?? err}` })) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = crashed(items[i], err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, lane));
  return results;
}

// The positions in `results` that hold no result. A loop, not filter or forEach, which skip an empty slot.
export function missingSlots(results, n) {
  const out = [];
  for (let i = 0; i < n; i++) if (!results?.[i] || typeof results[i].status !== 'string') out.push(i);
  return out;
}

function describe(name, status, r, { timeoutMs, maxBuffer }) {
  if (status === 'KILLED') return { name, status };
  if (status === 'SURVIVED') return { name, status, detail: 'the suite stayed green with this guard removed' };
  if (status === 'TIMEOUT') return { name, status, detail: `the suite ran past its ${timeoutMs} ms deadline` };
  const last = `${r?.stderr ?? ''}\n${r?.stdout ?? ''}`.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  const why = `${r?.detail ?? `exit ${r?.code ?? 'none'}`}${r?.signal ? `, signal ${r.signal}` : ''}${r?.overflow ? `, output past ${maxBuffer} bytes` : ''}`;
  return { name, status, detail: last ? `${why}: ${last.slice(0, 200)}` : why };
}

// Run `list` with a pool of `jobs`: each involved suite once unmutated first, then each mutation in its own copy.
export async function runAll(list, opts = {}) {
  const { root = REPO, jobs = DEFAULT_JOBS, timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = MAX_BUFFER, suites = SUITES, suiteFor = SUITE_FOR, spawn: run = spawnNode, copy = copyRepo, pool = runPool } = opts;
  const deps = { spawn: run, copy, timeoutMs, maxBuffer };
  const texts = new Map();
  const read = (p) => { if (!texts.has(p)) texts.set(p, readFileSync(p, 'utf8')); return texts.get(p); };
  const prepared = list.map((m) => prepare(m, { root, suites, suiteFor, read }));
  const keys = [...new Set(prepared.filter((p) => !p.status).map((p) => p.suite.join('\n')))];
  const base = await pool(keys, jobs, (key) => runSuite(root, key.split('\n'), null, deps));
  const red = new Map();
  keys.forEach((key, i) => {
    const why = baselineProblem(base[i]);
    if (why) red.set(key, why); // the suite was not green before any mutation
  });
  const results = await pool(prepared, jobs, async (p) => {
    if (p.status) return p;
    const key = p.suite.join('\n');
    if (red.has(key)) return { name: p.name, status: 'BASELINE_RED', detail: `its suite (${p.suite.length} test file${p.suite.length === 1 ? '' : 's'} in ${[...new Set(p.suite.map(dirOf))].join(', ')}) is not green before any mutation: ${red.get(key)}` };
    const r = await runSuite(root, p.suite, p, deps);
    return describe(p.name, classify(r), r, deps);
  }, (p, err) => ({ name: p.name, status: 'CRASHED', detail: `the run threw: ${err?.message ?? err}` }));
  return { results, missing: missingSlots(results, list.length), baselines: keys.map((key) => ({ suite: key.split('\n'), problem: red.get(key) ?? null })) };
}

// The printed report and the exit code. Counted against `n`, the number chosen, never the number that came back.
export function summarise(results, n, { verbose = false, since, notRun = 0 } = {}) {
  const lines = [];
  let killed = 0;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const r = results?.[i];
    if (!r || typeof r.status !== 'string') {
      bad++; // a result that never came back is a failed run, never a shorter one
      lines.push(`MISSING: result ${i + 1} of ${n} never came back`);
      continue;
    }
    if (r.status === 'KILLED') killed++;
    else bad++; // only KILLED counts
    if (verbose || r.status !== 'KILLED') lines.push(`${r.status}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  if (since !== undefined) {
    if (n === 0) return { lines: [...lines, `killed 0 of 0 selected since ${since}: nothing to judge`], code: 0 };
    lines.push(`killed ${killed} of ${n} selected since ${since}, ${notRun} not run${bad ? `, ${bad} not killed` : ' (every selected guard bites)'}`);
    return { lines, code: bad ? 1 : 0 };
  }
  if (n === 0) {
    lines.push('killed 0 of 0 mutations: nothing ran, so nothing is proven');
    return { lines, code: 1 }; // an empty run is never "every guard bites"
  }
  lines.push(`killed ${killed} of ${n} mutations${bad ? `, ${bad} not killed` : ' (every guard bites)'}`);
  return { lines, code: bad ? 1 : 0 };
}

const VALUED = new Set(['--only', '--jobs', '--timeout-ms', '--since', '--add', '--group']);

// The command line, read strictly: an unknown argument, a bad number or a lone --group is an error, never a default.
export function parseCli(argv) {
  const o = { list: false, verbose: false, only: undefined, jobs: DEFAULT_JOBS, timeoutMs: DEFAULT_TIMEOUT_MS, since: undefined, add: undefined, group: undefined, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') o.list = true;
    else if (a === '--verbose') o.verbose = true;
    else if (VALUED.has(a)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) o.errors.push(`${a} needs a value`);
      else if (a === '--only') {
        const terms = v.split(',').map((t) => t.trim()).filter(Boolean);
        if (!terms.length) o.errors.push(`--only ${JSON.stringify(v)} names no term`); // "--only ," is not "everything"
        else o.only = [...(o.only ?? []), ...terms];
      } else if (a === '--jobs') {
        if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 16) o.errors.push(`--jobs must be a whole number from 1 to 16, not ${JSON.stringify(v)}`);
        else o.jobs = Number(v);
      } else if (a === '--timeout-ms') {
        if (!/^\d+$/.test(v) || Number(v) < 1) o.errors.push(`--timeout-ms must be a whole number of milliseconds, not ${JSON.stringify(v)}`);
        else o.timeoutMs = Number(v);
      } else if (a === '--since') o.since = v;
      else if (a === '--add') o.add = v;
      else o.group = v;
    } else o.errors.push(`unknown argument ${JSON.stringify(a)}`); // a typo is refused, not ignored
  }
  if (o.add !== undefined && o.group === undefined) o.errors.push('--add needs --group "<one line>"');
  if (o.group !== undefined && o.add === undefined) o.errors.push('--group goes with --add');
  if (o.add !== undefined && (o.only || o.since !== undefined || o.list)) o.errors.push('--add runs its own batch only; drop --only, --since and --list');
  return o;
}

// The mutations whose file path contains any term, in list order, and the terms that select nothing at all.
export function selectOnly(list, terms) {
  const hit = (m, t) => relPath(m[1]).includes(t);
  const unmatched = terms.filter((t) => !list.some((m) => hit(m, t))); // each term must select something
  const chosen = list.filter((m) => terms.some((t) => hit(m, t)));
  return { chosen, unmatched };
}

export function gitRun(args, { cwd = REPO, env = process.env } = {}) {
  try {
    return { code: 0, stdout: execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER, timeout: 60_000 }) };
  } catch (err) {
    return { code: typeof err.status === 'number' ? err.status : null, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? err.message ?? err) };
  }
}

const nul = (s) => String(s ?? '').split('\0').filter(Boolean);

// The files changed since `rev`: tracked changes against the working tree, plus untracked files. Any git failure
// is an error, never an empty list: "git failed" must not read as "nothing changed".
export function changedSince(rev, { git = gitRun, root = REPO } = {}) {
  if (typeof rev !== 'string' || !rev.trim() || rev.startsWith('-')) return { error: `--since needs a revision, not ${JSON.stringify(rev)}` }; // never an option to git
  const v = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: root });
  const sha = String(v?.stdout ?? '').trim();
  const verified = v?.code === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha);
  if (!verified) return { error: `${rev} does not verify as a commit in this repository` };
  const diff = git(['diff', '--no-color', '--no-ext-diff', '--name-only', '-z', '--no-renames', sha, '--'], { cwd: root });
  if (diff?.code !== 0) return { error: `git diff against ${rev} failed (exit ${diff?.code}), so what changed is unknown` };
  const extra = git(['ls-files', '-z', '--others', '--exclude-standard'], { cwd: root });
  if (extra?.code !== 0) return { error: `git ls-files failed (exit ${extra?.code}), so the untracked files are unknown` };
  const all = [...new Set([...nul(diff.stdout), ...nul(extra.stdout)])];
  return { sha, files: all.filter((f) => !f.startsWith('.claude/worktrees/')).sort() }; // another worktree is another checkout
}

const SCRIPT = /\.(m?js|cjs)$/;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\.?\/[^'"]+)\1/g;

// The relative imports of every script in `folders`, followed into any file they reach (a helper outside the suite
// folders included). Bare and node: imports are not followed.
export function importGraph(root, folders) {
  const graph = new Map();
  const visit = (rel) => {
    if (graph.has(rel)) return;
    const deps = new Set();
    graph.set(rel, deps);
    let src = '';
    try { src = readFileSync(join(root, rel), 'utf8'); } catch { return; }
    for (const m of src.matchAll(IMPORT)) {
      const target = posix.normalize(posix.join(dirOf(rel) || '.', m[2].split(/[?#]/)[0]));
      if (target.startsWith('../')) continue;
      deps.add(target);
      if (SCRIPT.test(target)) visit(target); // followed through files no suite owns
    }
  };
  for (const folder of folders) {
    let names = [];
    try { names = readdirSync(join(root, folder)).sort(); } catch { continue; }
    for (const name of names) if (SCRIPT.test(name)) visit(folder ? `${folder}/${name}` : name);
  }
  return graph;
}

// `start` and everything it imports, however deep.
export function closure(graph, start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const d of graph.get(stack.pop()) ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      stack.push(d); // and what that imports
    }
  }
  return seen;
}

// The blocks of this file that decide how every other file's guards are run: which tests judge a folder or a file
// (SUITES, SUITE_FOR), what a folder's tests read (READS), which file a bare name means (relPath) and what a
// mutation's copy leaves out (SKIP). A change to one of them can turn any guard's verdict, so --since runs them all.
export const CONFIG = [['SUITES', 'export const SUITES = '], ['SUITE_FOR', 'export const SUITE_FOR = '], ['READS', 'export const READS = '], ['relPath', 'export const relPath = '], ['SKIP', 'const SKIP = ']];

// Each config block's 1-based lines in `src`, from its marker to the first line at or after it that ends in ";" and
// is the marker's own line or starts with "}" or "]". Null when a marker is missing or appears twice, or a block
// never closes, because then where the config sits is unknown.
export function configSpans(src) {
  const lines = String(src).split('\n');
  const spans = [];
  for (const [name, marker] of CONFIG) {
    const at = lines.findIndex((l) => l.startsWith(marker));
    const twice = at >= 0 && lines.some((l, i) => i > at && l.startsWith(marker)); // a second marker
    if (at < 0 || twice) return null; // a marker missing or twice: where this block sits is unknown
    const end = lines.findIndex((l, i) => i >= at && l.trimEnd().endsWith(';') && (i === at || /^[}\]]/.test(l)));
    if (end < 0) return null; // a block that never closes
    spans.push({ name, start: at + 1, end: end + 1 }); // a block runs to its closing line
  }
  return spans;
}

// A -U0 diff of mutate.mjs read against the file as it is now: the lines added inside the MUTATIONS array, whether
// any hunk falls outside it (then mutate.mjs's own code changed, and its own guards must run), and `config`: null,
// or why the change reaches every guard (a hunk touched a config block, or where they sit cannot be read).
export function selfChanges(diff, src) {
  const lines = String(src).split('\n');
  const open = lines.indexOf('export const MUTATIONS = [') + 1;
  const close = lines.findIndex((l, i) => i >= open && l === '];') + 1;
  const spans = configSpans(src);
  const touched = new Set();
  const added = [];
  let outside = !(open > 0 && close > open);
  let hunks = 0;
  let next = 0;
  for (const line of String(diff).split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      hunks++;
      const c = Number(h[1]);
      const d = h[2] === undefined ? 1 : Number(h[2]);
      const inside = d === 0 ? c >= open && c < close : c > open && c + d - 1 < close;
      if (!inside) outside = true; // this hunk changed code, not a line of the list
      const [lo, hi] = d === 0 ? [c, c + 1] : [c, c + d - 1]; // a cut touches the lines on both sides of it
      for (const s of spans ?? []) if (lo <= s.end && hi >= s.start) touched.add(s.name); // this hunk changed a config block
      next = c;
    } else if (hunks && line.startsWith('+')) {
      if (next > open && next < close) added.push(line.slice(1)); // a line of the list, by its own line number
      next++;
    }
  }
  const config = !spans ? `changed, and its ${CONFIG.map((b) => b[0]).join(', ')} cannot each be found once` : touched.size ? `changed ${[...touched].join(' and ')}` : null;
  return { added, outside, hunks, config };
}

// A name as it can be spelled in this file: raw, inside a JSON string, or inside a single-quoted string.
const spellings = (name) => [name, JSON.stringify(name).slice(1, -1), name.split('\\').join('\\\\').split("'").join("\\'")];

export const suiteFolders = (suites = SUITES, suiteFor = SUITE_FOR) =>
  [...new Set([...Object.keys(suites), ...Object.keys(suiteFor).map(dirOf), ...Object.values(suiteFor).flat().map(dirOf)])].sort();

// Which mutations a change can reach. A mutation of file F (folder D) is selected when anything F or its suite's
// tests import, however deep, changed (F and the tests themselves included); a non-.mjs file under D's top-level
// folder changed; a file READS lists for D changed; or, for mutate.mjs itself, its line changed (by name) or a hunk
// fell outside MUTATIONS (its own guards). Every mutation is selected when mutate.mjs changed with no hunk to say
// how, or changed a config block (CONFIG), and `everything` then says why. `unguarded` lists changed scripts in a
// suite folder no mutation names.
export function selectSince(list, files, opts = {}) {
  const { root = REPO, suites = SUITES, suiteFor = SUITE_FOR, reads = READS, self = SELF_REL, selfDiff = '', selfSrc = '' } = opts;
  const changed = new Set(files);
  const selfChanged = changed.delete(self); // mutate.mjs is judged by its diff, not as one changed file
  const folders = suiteFolders(suites, suiteFor);
  const graph = opts.graph ?? importGraph(root, folders);
  const own = selfChanged ? selfChanges(selfDiff, selfSrc) : { added: [], outside: false, hunks: 0, config: null };
  const unknown = selfChanged && own.hunks === 0; // mutate.mjs changed but no hunk says how: run everything
  const everything = unknown ? 'changed, but no hunk of its diff says how' : own.config; // a config change reaches every folder's run
  const byLine = new Set();
  for (const line of own.added) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t === '...[' || t === '[') continue;
    let hit = list.flatMap((m, i) => (spellings(m[0]).some((s) => t.includes(s)) ? [i] : []));
    if (!hit.length) hit = list.flatMap((m, i) => (t.includes(m[1]) ? [i] : [])); // a group's path line
    if (!hit.length) hit = list.map((_, i) => i); // an added line that names nothing: every mutation
    for (const i of hit) byLine.add(i);
  }
  const readChanged = (f) => (f.endsWith('/') ? [...changed].some((c) => c.startsWith(f)) : changed.has(f)); // a folder entry covers what is under it
  const reached = new Map();
  const reach = (start) => { if (!reached.has(start)) reached.set(start, closure(graph, start)); return reached.get(start); };
  const touches = (rel) => {
    if (rel === self && own.outside) return true;
    const tests = suiteListed(rel, { suites, suiteFor });
    for (const start of [rel, ...tests]) for (const f of reach(start)) if (changed.has(f)) return true;
    const top = rel.split('/')[0];
    for (const c of changed) if (!c.endsWith('.mjs') && c.startsWith(`${top}/`)) return true; // a data file nearby
    return (reads[dirOf(rel)] ?? []).some(readChanged);
  };
  const selected = list.filter((m, i) => everything || byLine.has(i) || touches(relPath(m[1])));
  const named = new Set(list.map((m) => relPath(m[1])));
  const unguarded = [...changed].filter((f) => SCRIPT.test(f) && !/\.test\.m?js$/.test(f) && folders.includes(dirOf(f)) && !named.has(f) && existsSync(join(root, f))).sort();
  return { selected, unguarded, everything: everything ? `${self} ${everything}, so every mutation is selected` : null };
}

// What a mutation leaves its file as, as one key: the file and a hash of its mutated text, made by slicing. Null when
// `from` is not found exactly once. Two mutations with one key are one guard under two names.
const effect = (rel, src, from, to) => {
  const at = findOnce(src, from);
  return at.status ? null : `${rel}\0${createHash('sha256').update(src.slice(0, at.i) + to + src.slice(at.i + from.length)).digest('hex')}`;
};

// The pairs in `list` that leave their file byte-identical, [earlier name, later name]. Such a pair would count one
// guard twice in "killed N of N". A line whose file or match is missing is the run's NO_MATCH, not a twin.
export function twinsOf(list, { root = REPO, read = (p) => readFileSync(p, 'utf8') } = {}) {
  const texts = new Map();
  const seen = new Map();
  const pairs = [];
  for (const m of list) {
    const rel = relPath(m[1]);
    if (!texts.has(rel)) { try { texts.set(rel, read(join(root, rel))); } catch { texts.set(rel, null); } }
    const key = texts.get(rel) === null ? null : effect(rel, texts.get(rel), m[2], m[3]);
    if (key === null) continue;
    if (seen.has(key)) pairs.push([seen.get(key), m[0]]); // one guard under two names
    else seen.set(key, m[0]);
  }
  return pairs;
}

// Why a batch for --add cannot go in, one reason per line; empty when it can.
export function validateLines(batch, opts = {}) {
  const { mutations = MUTATIONS, root = REPO, group, suites = SUITES, suiteFor = SUITE_FOR, target = SELF_REL, targetSrc } = opts;
  const problems = [];
  if (typeof group !== 'string' || !group.trim()) problems.push('--group must name the batch in one line');
  else if (/[\r\n\u2028\u2029]/.test(group)) problems.push('--group holds a line break; it must be one line');
  if (!Array.isArray(batch) || !batch.length) {
    problems.push('the batch must be a JSON array of [name, path, from, to] lines, at least one');
    return problems;
  }
  const taken = new Set(mutations.map((m) => m[0]));
  const ins = typeof targetSrc === 'string' ? insertLines(targetSrc, batch, String(group ?? '')) : null;
  if (ins?.error) problems.push(ins.error);
  const effects = new Map(); // per file, what each guard leaves it as: the list's, then the batch's so far
  const effectsOf = (rel, src) => {
    if (!effects.has(rel)) effects.set(rel, new Map(mutations.filter((m) => relPath(m[1]) === rel).map((m) => [effect(rel, src, m[2], m[3]), m[0]]).filter(([key]) => key !== null)));
    return effects.get(rel);
  };
  batch.forEach((line, k) => {
    if (!Array.isArray(line) || line.length !== 4 || !line.every((x) => typeof x === 'string')) {
      problems.push(`line ${k + 1}: must be [name, path, from, to], four strings`);
      return;
    }
    const [name, path, from, to] = line;
    const tag = `line ${k + 1} (${JSON.stringify(name)})`;
    if (!name.trim()) problems.push(`${tag}: the name is empty`);
    if (from === '') problems.push(`${tag}: from is empty`);
    if (from === to) problems.push(`${tag}: from and to are the same, so no guard is removed`);
    if (taken.has(name)) problems.push(`${tag}: the name is taken`);
    taken.add(name); // a second line of the batch may not reuse it either
    if (isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
      problems.push(`${tag}: the path is absolute; give it from the repo root`);
      return;
    }
    if (path.includes('..')) {
      problems.push(`${tag}: the path contains ".."`);
      return;
    }
    const rel = relPath(path);
    const p = join(root, rel);
    if (!existsSync(p) || !statSync(p).isFile()) {
      problems.push(`${tag}: ${rel} does not exist`);
      return;
    }
    if (!suiteOf(rel, { root, suites, suiteFor }).length) problems.push(`${tag}: ${rel} has no suite to judge it`);
    if (from === '') return;
    const src = readFileSync(p, 'utf8');
    const found = findOnce(src, from);
    if (found.status) problems.push(`${tag}: from ${found.status === 'NO_MATCH' ? 'is not found' : 'occurs more than once'} in ${rel}`);
    else if (rel === target && ins?.text && findOnce(ins.text, from).status) problems.push(`${tag}: from would also match its own line once written into ${rel}`);
    else {
      const known = effectsOf(rel, src);
      const key = effect(rel, src, from, to);
      const twin = known.get(key);
      if (twin !== undefined) problems.push(`${tag}: is the same guard as ${JSON.stringify(twin)}: it leaves ${rel} byte-identical`);
      known.set(key, name); // a later line of the batch may not repeat it either
    }
  });
  return problems;
}

// The text of `src` with the batch written as one group just before the one line "];" that closes MUTATIONS.
export function insertLines(src, batch, group) {
  const lines = String(src).split('\n');
  const open = lines.indexOf('export const MUTATIONS = [');
  const closes = lines.flatMap((l, i) => (l === '];' ? [i] : []));
  if (open < 0 || lines.lastIndexOf('export const MUTATIONS = [') !== open || closes.length !== 1 || closes[0] < open) {
    return { error: 'MUTATIONS must open once and close with the one line "];" in the file, so where to write is unknown' };
  }
  const at = lines.slice(0, closes[0]).join('\n').length + 1;
  const block = `${[`  // ${group} (added by mutate --add)`, ...batch.map((l) => `  ${JSON.stringify(l)},`)].join('\n')}\n`;
  return { text: src.slice(0, at) + block + src.slice(at) };
}

function writeAtomic(file, text) {
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const loadList = async (file) => (await import(`${pathToFileURL(file).href}?add=${Date.now()}-${process.hrtime.bigint()}`)).MUTATIONS;

// --add: refuse the whole batch on any bad line; run it; write it only if every line is KILLED; then re-import the
// file and put the old bytes back unless its list now ends with the batch.
export async function addLines(batch, opts = {}) {
  const { group, root = REPO, target = join(root, SELF_REL), mutations = MUTATIONS, suites = SUITES, suiteFor = SUITE_FOR, load = loadList } = opts;
  const run = opts.run ?? ((lines) => runAll(lines, { root, suites, suiteFor, jobs: opts.jobs, timeoutMs: opts.timeoutMs }));
  const before = readFileSync(target, 'utf8');
  const problems = validateLines(batch, { mutations, root, group, suites, suiteFor, target: posixRel(relative(root, target)), targetSrc: before });
  if (problems.length) return { ok: false, problems };
  const { results = [] } = (await run(batch)) ?? {};
  const notKilled = [];
  for (let k = 0; k < batch.length; k++) {
    const r = results[k];
    if (r?.status !== 'KILLED') notKilled.push(`line ${k + 1} (${JSON.stringify(batch[k][0])}) was not killed: ${r?.status ?? 'MISSING'}${r?.detail ? ` — ${r.detail}` : ''}`);
  }
  if (notKilled.length) return { ok: false, problems: notKilled }; // nothing is written unless every line bites
  const ins = insertLines(before, batch, group);
  if (ins.error) return { ok: false, problems: [ins.error] };
  writeAtomic(target, ins.text);
  let list = null;
  try { list = await load(target); } catch { list = null; }
  const tail = Array.isArray(list) ? list.slice(-batch.length) : null;
  if (JSON.stringify(tail) !== JSON.stringify(batch)) {
    writeAtomic(target, before); // the old bytes go back
    return { ok: false, problems: ['the written file did not re-import with the batch at the end of MUTATIONS, so the old bytes are back'] };
  }
  return { ok: true, problems: [] };
}

// The command. Returns the exit code; `print` receives each line of the report.
export async function main(argv, deps = {}) {
  const { mutations = MUTATIONS, root = REPO, suites = SUITES, suiteFor = SUITE_FOR, reads = READS, git = gitRun, run = runAll, add = addLines, print = (s) => console.log(s), readText = (f) => readFileSync(f, 'utf8') } = deps;
  const o = parseCli(argv);
  if (o.errors.length) {
    for (const e of o.errors) print(`refused: ${e}`);
    return 1;
  }
  if (o.add !== undefined) {
    let batch;
    try { batch = JSON.parse(readText(o.add)); } catch (err) { print(`refused: ${o.add} is not readable JSON (${err.message})`); return 1; }
    const r = await add(batch, { group: o.group, root, mutations, jobs: o.jobs, timeoutMs: o.timeoutMs });
    for (const p of r.problems) print(`refused: ${p}`);
    print(r.ok ? `added ${batch.length} mutation${batch.length === 1 ? '' : 's'} under "${o.group}", every one killed` : 'added nothing');
    return r.ok ? 0 : 1;
  }
  let chosen = mutations;
  if (o.only) {
    const sel = selectOnly(mutations, o.only);
    if (sel.unmatched.length) {
      for (const t of sel.unmatched) print(`refused: --only ${JSON.stringify(t)} selects no mutation (a term matches part of a file path)`);
      return 1;
    }
    chosen = sel.chosen;
  }
  let notRun = 0;
  if (o.since !== undefined) {
    const ch = changedSince(o.since, { git, root });
    if (ch.error) {
      print(`refused: ${ch.error}`);
      return 1;
    }
    let selfDiff = '';
    if (ch.files.includes(SELF_REL)) {
      const d = git(['diff', '--no-color', '--no-ext-diff', '-U0', '--no-renames', ch.sha, '--', SELF_REL], { cwd: root });
      if (d?.code !== 0) {
        print(`refused: git diff of ${SELF_REL} failed (exit ${d?.code}), so which of its lines changed is unknown`);
        return 1;
      }
      selfDiff = d.stdout;
    }
    const selfPath = join(root, SELF_REL);
    const sel = selectSince(mutations, ch.files, { root, suites, suiteFor, reads, selfDiff, selfSrc: existsSync(selfPath) ? readFileSync(selfPath, 'utf8') : '' });
    for (const f of sel.unguarded) print(`UNGUARDED: ${f} changed and no mutation names it`);
    if (sel.everything) print(`NOTE: ${sel.everything}`);
    const keep = new Set(sel.selected);
    chosen = chosen.filter((m) => keep.has(m));
    notRun = mutations.length - chosen.length;
  }
  if (o.list) {
    for (const [name, file] of chosen) print(`- ${name} (${relPath(file)})`);
    print(`\n${chosen.length} mutations.`);
    return 0;
  }
  const { results } = chosen.length ? await run(chosen, { root, suites, suiteFor, jobs: o.jobs, timeoutMs: o.timeoutMs }) : { results: [] };
  const s = summarise(results, chosen.length, { verbose: o.verbose, since: o.since, notRun });
  for (const line of s.lines) print(line);
  return s.code;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { stopAll(); process.exit(130); });
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { stopAll(); console.error(`mutate.mjs crashed: ${err?.stack ?? err}`); process.exitCode = 1; },
  );
}
