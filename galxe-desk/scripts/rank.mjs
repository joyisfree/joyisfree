#!/usr/bin/env node
// The Prize Gate. A quest is entered only if its prize is real, the quest is open, our account is
// eligible, the claim path is known, the page is genuine, the expected value clears the bar and it
// fits the daily minutes. Everything else is refused with the reason written down.
//
//   node galxe-desk/scripts/rank.mjs --candidates galxe-desk/candidates.json \
//        --account galxe-desk/account.json --out galxe-desk/shortlist.md
//
// Pure functions are exported so the tests can prove every guard refuses what it should.

import { readFileSync, writeFileSync } from 'node:fs';

export const WORTHLESS_TYPES = new Set(['oat', 'points', 'gg', 'xp', 'badge', 'nft-no-floor', 'whitelist', 'role', 'none']);
export const GENUINE_HOSTS = new Set(['app.galxe.com']); // quests live only here; the marketing site is not a quest page
export const SPLITS = new Set(['even', 'raffle', 'luck', 'fcfs']);

/** Expected value for one participant, in USD, after the haircut, fee and gas. Null when it cannot be valued. */
export function expectedValue(c, haircut = 0.5) {
  const r = c.reward || {};
  if (!Number.isFinite(Number(c.participants))) return null; // unknown participants cannot be valued
  const n = Math.max(1, Number(c.participants) + 1);
  let gross;
  switch (r.split) {
    case 'even':
      gross = Number(r.poolUsd ?? NaN) / n;
      break;
    case 'luck':
      gross = Number(r.poolUsd ?? NaN) / n;
      break;
    case 'raffle':
      gross = (Number(r.prizeUsd ?? NaN) * Number(r.winners ?? NaN)) / n;
      break;
    case 'fcfs':
      gross = Number(r.slotsLeft ?? 0) > 0 ? Number(r.prizeUsd ?? NaN) : 0;
      break;
    default:
      return null;
  }
  if (!Number.isFinite(gross)) return null;
  let net = gross;
  if (r.tokenLaunched === false || r.vesting === true) net *= haircut;
  net -= Number(r.claimFeeUsd ?? 0) + Number(r.gasUsd ?? 0);
  return { gross, net };
}

/** Run one candidate through the gate. Returns { id, pass, reasons, ev, evGross }. */
export function gate(c, account, now = Date.now()) {
  const reasons = [];
  const r = c.reward || {};
  const q = c.requirements || {};
  const p = c.project || {};
  const threshold = Number(account.evThresholdUsd ?? 2);
  const haircut = Number(account.haircutUnlaunched ?? 0.5);
  const type = String(r.type || 'none').toLowerCase();

  // 1. The prize must be real.
  if (WORTHLESS_TYPES.has(type)) {
    const conv = r.pointsConversion;
    const published = type === 'points' && conv && Number(conv.ratio) > 0 && conv.date && conv.source;
    if (!published) reasons.push(`WORTHLESS_REWARD: ${type}`);
  }

  // 2. The quest must be open now.
  if (c.status !== 'Active') reasons.push(`NOT_OPEN: status ${c.status ?? 'unknown'}`);
  const start = c.startTime ? Date.parse(c.startTime) : NaN;
  const end = c.endTime ? Date.parse(c.endTime) : NaN;
  if (Number.isFinite(start) && now < start) reasons.push('NOT_OPEN: not started');
  if (Number.isFinite(end) && now > end) reasons.push('NOT_OPEN: ended');
  if (Number(c.cap) > 0 && Number(c.participants) >= Number(c.cap)) reasons.push('NOT_OPEN: cap reached');

  // 3. Our account must be eligible before a minute is spent. Unknown counts as unmet: the gate fails closed.
  if (!c.requirements || typeof c.requirements !== 'object' || Array.isArray(c.requirements)) {
    reasons.push('INELIGIBLE: requirements not recorded');
  }
  for (const f of ['xAgeMonths', 'xFollowers', 'scoreHumanity']) {
    if (f in q && (typeof q[f] !== 'number' || !Number.isFinite(q[f]))) reasons.push(`INELIGIBLE: ${f} unknown`);
  }
  for (const f of ['blueCheck', 'passport']) {
    if (f in q && typeof q[f] !== 'boolean') reasons.push(`INELIGIBLE: ${f} unknown`);
  }
  if ('holdings' in q && !Array.isArray(q.holdings)) reasons.push('INELIGIBLE: holdings unknown');
  if (Number(q.xAgeMonths || 0) > Number(account.xAgeMonths || 0)) {
    reasons.push(`INELIGIBLE: X account ${q.xAgeMonths} months needed, have ${account.xAgeMonths || 0}`);
  }
  if (Number(q.xFollowers || 0) > Number(account.xFollowers || 0)) {
    reasons.push(`INELIGIBLE: ${q.xFollowers} X followers needed, have ${account.xFollowers || 0}`);
  }
  if (q.blueCheck && !account.blueCheck) reasons.push('INELIGIBLE: X blue check needed');
  if (Number(q.scoreHumanity || 0) > Number(account.scoreHumanity || 0)) {
    reasons.push(`INELIGIBLE: Humanity L${q.scoreHumanity} needed, have L${account.scoreHumanity || 0}`);
  }
  if (q.passport && !account.passport) reasons.push('INELIGIBLE: Passport needed');
  for (const h of q.holdings || []) {
    if (!(account.holdings || []).includes(h)) reasons.push(`INELIGIBLE: must hold ${h}`);
  }

  // 4. The claim path must be known: chain with gas, window, fee.
  if (!r.claimChain) reasons.push('CLAIM_PATH_UNKNOWN: chain');
  else if (!(account.chains || {})[r.claimChain]) reasons.push(`CLAIM_PATH_UNKNOWN: no gas on ${r.claimChain}`);
  if (r.claimWindowDays == null) reasons.push('CLAIM_PATH_UNKNOWN: window');
  if (r.claimFeeUsd == null) reasons.push('CLAIM_PATH_UNKNOWN: fee');

  // 5. The page must be the genuine app and the project credible.
  let host = null;
  try { host = new URL(c.url).hostname; } catch { host = null; }
  if (!host || !GENUINE_HOSTS.has(host)) reasons.push(`LOOKALIKE_URL: ${host || 'invalid url'}`);
  const credible = c.spaceVerified === true || Number(p.fundingUsd || 0) >= 1_000_000 || p.tokenStatus === 'live';
  if (!credible) reasons.push('UNVERIFIED_PROJECT');

  // 6. The expected value must clear the bar. Unknown participants or pool cannot be valued: refused.
  const ev = expectedValue(c, haircut);
  if (!Number.isFinite(Number(c.participants))) reasons.push('LOW_EV: participants unknown');
  else if (!ev) reasons.push('LOW_EV: cannot value (split, pool or prize missing)');
  else if (ev.net < threshold) reasons.push(`LOW_EV: $${ev.net.toFixed(2)} < $${threshold.toFixed(2)}`);

  // 7. It must fit the day. Unknown minutes are refused, not assumed to be zero.
  const cap = Number(account.dailyMinutesCap ?? 10);
  if (!Number.isFinite(Number(c.minutes))) reasons.push('TOO_SLOW: minutes unknown');
  else if (Number(c.minutes) > cap) reasons.push(`TOO_SLOW: ${c.minutes} min > ${cap} min cap`);

  return { id: c.id, space: c.space, url: c.url, pass: reasons.length === 0, reasons, ev: ev?.net ?? null, evGross: ev?.gross ?? null };
}

/** Metadata objects (every key starting with "_", e.g. the scout's _sourcesChecked) are not quests and are skipped. */
export function isCandidate(c) {
  return !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).some((k) => !k.startsWith('_'));
}

export function rank(candidates, account, now = Date.now()) {
  const quests = candidates.filter(isCandidate);
  const skipped = candidates.length - quests.length;
  const results = quests.map((c) => gate(c, account, now));
  const passed = results.filter((x) => x.pass).sort((a, b) => b.ev - a.ev);
  const refused = results.filter((x) => !x.pass);
  return { passed, refused, results, skipped };
}

export function toMarkdown({ passed, refused }, when = new Date()) {
  const lines = [`# Shortlist, ${when.toISOString().slice(0, 10)}`, ''];
  lines.push(`Entered only if listed under **Do**. ${passed.length} pass, ${refused.length} refused.`, '');
  lines.push('## Do', '');
  if (passed.length === 0) lines.push('_Nothing clears the gate this week. That is a result, not a failure._', '');
  for (const x of passed) {
    lines.push(`- **${x.space} / ${x.id}**: EV $${x.ev.toFixed(2)} net ($${x.evGross.toFixed(2)} gross). ${x.url}`);
  }
  lines.push('', '## Refused, and why', '');
  for (const x of refused) lines.push(`- ${x.space} / ${x.id}: ${x.reasons.join('; ')}`);
  lines.push('');
  return lines.join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const candidatesPath = arg('candidates', 'galxe-desk/candidates.json');
  const accountPath = arg('account', 'galxe-desk/account.json');
  const out = arg('out', 'galxe-desk/shortlist.md');
  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  const account = JSON.parse(readFileSync(accountPath, 'utf8'));
  const result = rank(candidates, account);
  writeFileSync(out, toMarkdown(result));
  writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(result, null, 2));
  console.log(`${result.passed.length} pass, ${result.refused.length} refused -> ${out}`);
  for (const x of result.refused) console.log(`  refused ${x.id}: ${x.reasons.join('; ')}`);
}
