#!/usr/bin/env node
// Mutation test: every guard listed below is removed, one at a time, in a throwaway copy of the scripts, and the
// test suite is run against that copy. A guard "bites" only if some test turns red when it is gone. A guard that
// survives its removal with the suite still green is a guard with no test behind it, and this command exits 1 and
// names it. This is how "the guards are shown to fail" (studio rule 3) is proven by one command, not asserted.
//
//   node galxe-desk/scripts/mutate.mjs                 # run every mutation in the repo, report killed / survived
//   node galxe-desk/scripts/mutate.mjs --only agency   # only the mutations whose file path contains "agency"
//   node galxe-desk/scripts/mutate.mjs --list          # just list the mutations
//
// Each mutation is a single, exact string swap that neutralises one guard. `from` must occur once in its file.
// It covers the whole repo, not only the desk: a bare file name means galxe-desk/scripts/<name>; anything with a
// slash is a path from the repo root. Each mutation runs in a full throwaway copy of the repo, against the test
// suite of the directory the file lives in.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(DIR, '..', '..');

// The test files each directory's guards are judged by. execFileSync would not expand a '*.test.mjs' glob without a
// shell, so they are listed; a missing file is skipped, and a directory whose suite is empty refuses to run.
export const SUITES = {
  'galxe-desk/scripts': ['gate.test.mjs', 'ledger.test.mjs', 'crawl.test.mjs', 'do-card.test.mjs', 'verify-link.test.mjs', 'gigapot.test.mjs', 'agents.test.mjs', 'decision.test.mjs'],
  'agency/scripts': ['ab-test.test.mjs', 'creator-pilot.test.mjs', 'orders.test.mjs', 'realised.test.mjs'],
  '.claude/skills/joy-revise/scripts': ['worth-it.test.mjs'],
  scripts: ['prove.test.mjs'],
};

export const relPath = (file) => (file.includes('/') ? file : `galxe-desk/scripts/${file}`);

// Never copied into a mutation's throwaway repo: history, dependencies, fetched pages and the pilot's private data.
const SKIP = ['.git', 'node_modules', join('galxe-desk', 'rulebook', 'pages'), join('agency', 'pilot')];

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
  ['an agent must list its tools', 'agents.mjs', "if (!fm.tools) return ['no explicit tools line", "if (false) return ['no explicit tools line"],
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
  ["12 BIP39 words on a line are a seed","scripts/prove.mjs","if (seedRun(s) >= SEED_WORDS) kinds.push('bip39-seed');","if (false) kinds.push('bip39-seed');"],
  ["any non-letter separates seed words","scripts/prove.mjs","for (const t of String(text).split(/[^A-Za-z]+/)) {","for (const t of String(text).split(/\\s+/)) {"],
  ["seed words count in any case","scripts/prove.mjs","run = BIP39.has(t.toLowerCase()) ? run + 1 : 0;","run = BIP39.has(t) ? run + 1 : 0;"],
  ["rows of seed words add up down a page","scripts/prove.mjs","run.words += words;","run.words = words;"],
  ["seed rows join only within one file","scripts/prove.mjs","if (words && run && run.file === at.file && at.n === run.n + 1) {","if (words && run && at.n === run.n + 1) {"],
  ["seed rows join only on consecutive lines","scripts/prove.mjs","at.n === run.n + 1) {","at.n > run.n) {"],
  ["a seed written down a page is reported","scripts/prove.mjs","if (run && !run.told && run.words >= SEED_WORDS) {","if (false) {"],
  ["a changed BIP39 list fails the check closed","scripts/prove.mjs","if (!bip39Intact(ctx.words ?? BIP39_WORDS)) return fail(","if (false) return fail("],
  ["the BIP39 list is pinned by its hash","scripts/prove.mjs","digest('hex') === BIP39_SHA256;","digest('hex') !== '';"],
  ["history is scanned","scripts/prove.mjs","const hits = [...secretHits(tree.lines), ...secretHits(past.lines)];","const hits = [...secretHits(tree.lines)];"],
  ["the tree is scanned","scripts/prove.mjs","const hits = [...secretHits(tree.lines), ...secretHits(past.lines)];","const hits = [...secretHits(past.lines)];"],
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
];

// Apply one mutation to a throwaway copy of the scripts and run the suite there. KILLED = a test went red.
function runOne(m, root) {
  const [name, file, from, to] = m;
  const rel = relPath(file);
  const p = join(root, rel);
  if (!existsSync(p)) return { name, status: 'NO_MATCH', detail: `${rel} does not exist` };
  const src = readFileSync(p, 'utf8');
  const i = src.indexOf(from);
  if (i < 0) return { name, status: 'NO_MATCH', detail: `pattern not found in ${rel}` };
  if (src.indexOf(from, i + 1) >= 0) return { name, status: 'AMBIGUOUS', detail: `pattern occurs more than once in ${rel}` };
  writeFileSync(p, src.slice(0, i) + to + src.slice(i + from.length));
  const dir = dirname(rel).split(sep).join('/');
  const testFiles = (SUITES[dir] || []).map((f) => join(root, dir, f)).filter((f) => existsSync(f));
  // A guard with no suite to judge it cannot be said to bite. Fail closed rather than report it killed.
  if (!testFiles.length) return { name, status: 'NO_SUITE', detail: `no test file exists for ${dir}` };
  try {
    execFileSync(process.execPath, ['--test', ...testFiles], { stdio: 'pipe', cwd: root });
    return { name, status: 'SURVIVED', detail: 'the suite stayed green with this guard removed' };
  } catch {
    return { name, status: 'KILLED' };
  }
}

export function run({ only } = {}) {
  const results = [];
  const chosen = only ? MUTATIONS.filter((m) => relPath(m[1]).includes(only)) : MUTATIONS;
  for (const m of chosen) {
    const work = mkdtempSync(join(tmpdir(), 'mutate-'));
    try {
      cpSync(REPO, work, { recursive: true, filter: (src) => !SKIP.some((s) => relative(REPO, src) === s || relative(REPO, src).startsWith(s + sep)) });
      results.push(runOne(m, work));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return results;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--list')) {
    for (const [name, file] of MUTATIONS) console.log(`- ${name} (${relPath(file)})`);
    console.log(`\n${MUTATIONS.length} mutations.`);
  } else {
    const oi = process.argv.indexOf('--only');
    const results = run({ only: oi >= 0 ? process.argv[oi + 1] : undefined });
    const killed = results.filter((r) => r.status === 'KILLED');
    const bad = results.filter((r) => r.status !== 'KILLED');
    for (const r of bad) console.log(`${r.status}: ${r.name} — ${r.detail}`);
    console.log(`killed ${killed.length} of ${results.length} mutations${bad.length ? `, ${bad.length} not killed` : ' (every guard bites)'}`);
    process.exitCode = bad.length ? 1 : 0;
  }
}
