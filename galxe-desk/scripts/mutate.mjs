#!/usr/bin/env node
// Mutation test: every guard listed below is removed, one at a time, in a throwaway copy of the scripts, and the
// test suite is run against that copy. A guard "bites" only if some test turns red when it is gone. A guard that
// survives its removal with the suite still green is a guard with no test behind it, and this command exits 1 and
// names it. This is how "the guards are shown to fail" (studio rule 3) is proven by one command, not asserted.
//
//   node galxe-desk/scripts/mutate.mjs            # run every mutation, report killed / survived
//   node galxe-desk/scripts/mutate.mjs --list     # just list the mutations
//
// Each mutation is a single, exact string swap that neutralises one guard. `from` must occur once in its file.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DIR = dirname(fileURLToPath(import.meta.url));

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
];

// Apply one mutation to a throwaway copy of the scripts and run the suite there. KILLED = a test went red.
function runOne(m, scriptsDir) {
  const [name, file, from, to] = m;
  const p = join(scriptsDir, file);
  const src = readFileSync(p, 'utf8');
  const i = src.indexOf(from);
  if (i < 0) return { name, status: 'NO_MATCH', detail: `pattern not found in ${file}` };
  if (src.indexOf(from, i + 1) >= 0) return { name, status: 'AMBIGUOUS', detail: `pattern occurs more than once in ${file}` };
  writeFileSync(p, src.slice(0, i) + to + src.slice(i + from.length));
  // execFileSync would not expand a '*.test.mjs' glob without a shell, so the test files are listed by hand.
  const testFiles = ['gate.test.mjs', 'ledger.test.mjs', 'crawl.test.mjs', 'do-card.test.mjs', 'verify-link.test.mjs', 'gigapot.test.mjs'].map((f) => join(scriptsDir, f));
  try {
    execFileSync(process.execPath, ['--test', ...testFiles], { stdio: 'pipe' });
    return { name, status: 'SURVIVED', detail: 'the suite stayed green with this guard removed' };
  } catch {
    return { name, status: 'KILLED' };
  }
}

export function run() {
  const results = [];
  for (const m of MUTATIONS) {
    const work = mkdtempSync(join(tmpdir(), 'mutate-'));
    try {
      cpSync(DIR, work, { recursive: true });
      results.push(runOne(m, work));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return results;
}

const isMain = (() => { try { return import.meta.url === new URL(`file://${process.argv[1]}`).href || import.meta.url.endsWith('mutate.mjs'); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--list')) {
    for (const [name, file] of MUTATIONS) console.log(`- ${name} (${file})`);
    console.log(`\n${MUTATIONS.length} mutations.`);
  } else {
    const results = run();
    const killed = results.filter((r) => r.status === 'KILLED');
    const bad = results.filter((r) => r.status !== 'KILLED');
    for (const r of bad) console.log(`${r.status}: ${r.name} — ${r.detail}`);
    console.log(`killed ${killed.length} of ${results.length} mutations${bad.length ? `, ${bad.length} not killed` : ' (every guard bites)'}`);
    process.exitCode = bad.length ? 1 : 0;
  }
}
