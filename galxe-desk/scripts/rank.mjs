#!/usr/bin/env node
// The Prize Gate. A quest is entered only if its prize is real, the quest is open, our account is eligible, the claim
// path is known, the page is genuine, any on-chain task fits the wallet, the expected value clears the bar and it fits
// the week. Everything else is refused with the reason written down. Unknown counts as unmet: the gate fails closed.
//
// Points, OATs, credentials and Galxe Gold are refused as worthless unless the project has published a dated
// conversion (tokens per point and a price); then they are valued like any other prize. A separate lane for
// pre-token points was designed on 30 Oct 2026 and dropped on the evidence: Linea published its 2,000 LXP rule a
// week before launch, about two years after its Galxe campaign, so no rule-based lane could have entered in time.
//
//   node galxe-desk/scripts/rank.mjs --candidates galxe-desk/candidates.json \
//        --account galxe-desk/account.json --out galxe-desk/shortlist.md
//
// Candidates may use Galxe's official quest shape (docs.galxe.com/galxe-integration/api-reference/quest: type, status,
// startTime/endTime in unix seconds, cap, participantsCount, chain, gasType, space, credentialGroups with
// conditionRelation ALL|ANY, conditions and rewards {rewardType, rewardCount, eligible}) or the desk's flat `reward`.
// Pure functions are exported so the tests can prove every guard refuses what it should.

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const WORTHLESS_TYPES = new Set(['oat', 'points', 'gg', 'xp', 'badge', 'nft-no-floor', 'whitelist', 'role', 'none', 'credential']);
export const GENUINE_HOSTS = new Set(['app.galxe.com']); // quests live only here; the marketing site is not a quest page
export const SPLITS = new Set(['even', 'raffle', 'luck', 'fcfs']);
// A task is on-chain if it names a wallet action. The list errs wide on purpose: over-reading a task as
// on-chain only forces its capital and gas to be recorded (fail closed), it never lets a cost slip through.
const ONCHAIN = /\b(swap|swapped|bridge|bridged|hold|holding|held|stake|staked|staking|restake|unstake|deposit|deposited|mint|minted|trade|traded|transact|transaction|transactions|liquidity|lp|lend|borrow|buy|bought|purchase|supply|supplied|send|sent|transfer|lock|locked|balance|in your wallet)\b/i;
const ON_X = /(twitter|x\.com|\bon x\b|\bfollow\b|retweet|repost|\blike\b|\bquote\b)/i;
const DAY = 86_400_000;

/** Galxe's rewardType -> the desk's reward type. Unknown types pass through lowercased and cannot be valued. */
export function mapRewardType(t) {
  const s = String(t ?? 'none').toLowerCase().replace(/[^a-z]/g, '');
  const map = {
    oat: 'oat', nft: 'nft-no-floor', token: 'token', airdrop: 'token', erc20: 'token', points: 'points',
    loyaltypoints: 'points', mysterybox: 'mysterybox', custom: 'whitelist', whitelist: 'whitelist', gg: 'gg', xp: 'xp',
    credential: 'credential', none: 'none',
  };
  return map[s] ?? (s || 'none');
}

/** Times arrive as unix seconds (the API), milliseconds or ISO strings. */
export function toMs(t) {
  if (t == null || t === '') return NaN;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  if (/^\d+$/.test(String(t))) { const n = Number(t); return n < 1e12 ? n * 1000 : n; }
  return Date.parse(t);
}

const participantsOf = (c) => c.participants ?? c.participantsCount;
const spaceName = (c) => (c.space && typeof c.space === 'object' ? c.space.name : c.space);
const spaceVerified = (c) => c.spaceVerified === true || (c.space && typeof c.space === 'object' && c.space.verified === true);

/** Every reward the quest offers, as options the gate can value: official credential groups, or the flat `reward`. */
export function rewardOptions(c) {
  if (Array.isArray(c.credentialGroups) && c.credentialGroups.length) {
    const out = [];
    c.credentialGroups.forEach((g, gi) => (g.rewards || []).forEach((rw) => {
      const type = mapRewardType(rw.rewardType);
      const group = c.credentialGroups.length > 1 ? ` (group ${gi + 1})` : '';
      out.push({ label: `${type}${group}`, reward: { ...(rw.value || {}), type, eligible: rw.eligible, rewardCount: rw.rewardCount } });
    }));
    return out;
  }
  if (c.reward) return [{ label: String(c.reward.type || 'none').toLowerCase(), reward: c.reward }];
  return [];
}

/** The tasks, in order, for the Do card. An ANY group means one of its tasks is enough. */
export function tasksOf(c) {
  const item = (text, kind, eligible) => ({ text, onX: kind === 'x' || ON_X.test(text), onChain: kind === 'onchain' || ONCHAIN.test(text), done: eligible === true });
  if (Array.isArray(c.credentialGroups) && c.credentialGroups.length) {
    return c.credentialGroups.map((g) => ({
      relation: g.conditionRelation === 'ANY' ? 'ANY' : 'ALL',
      items: (g.conditions || []).map((k) => item(String(k.expression ?? k.name ?? 'task'), k.kind, k.eligible)),
    }));
  }
  if (Array.isArray(c.tasks)) return [{ relation: 'ALL', items: c.tasks.map((t) => item(String(t))) }];
  return [];
}

/** Expected value for one participant, in USD, after the haircut, the claim fee, claim gas and task gas. Null when it cannot be valued. */
export function expectedValue(c, haircut = 0.5, reward = c.reward || {}) {
  const r = reward;
  const p = participantsOf(c);
  if (p == null || !Number.isFinite(Number(p))) return null; // unknown participants cannot be valued
  const n = Math.max(1, Number(p) + 1);
  let gross;
  switch (r.split) {
    case 'even':
    case 'luck':
      gross = Number(r.poolUsd ?? NaN) / n;
      break;
    case 'raffle': {
      // One entry can win at most one prize, so the chance of winning is capped at 1.
      const prize = Number(r.prizeUsd ?? NaN);
      gross = prize * Math.min(1, Number(r.winners ?? NaN) / n);
      break;
    }
    case 'fcfs':
      gross = Number(r.slotsLeft ?? 0) > 0 ? Number(r.prizeUsd ?? NaN) : 0;
      break;
    default: {
      // Points with a published, dated conversion: points earned x tokens per point x token price.
      const conv = r.pointsConversion;
      if (String(r.type).toLowerCase() !== 'points' || !conv) return null;
      gross = Number(r.pointsEarned ?? r.rewardCount ?? NaN) * Number(conv.ratio ?? NaN) * Number(conv.tokenPriceUsd ?? NaN);
    }
  }
  if (!Number.isFinite(gross)) return null;
  let net = gross;
  // Fail closed: only a token explicitly launched and not vesting escapes the haircut. Absent, "unknown" or
  // the string "false" all keep the haircut, because the desk never values an uncertain token at face.
  if (r.tokenLaunched !== true || r.vesting === true) net *= haircut;
  net -= Number(r.claimFeeUsd ?? 0) + Number(r.gasUsd ?? 0) + Number(c.taskGasUsd ?? 0);
  if (!Number.isFinite(net)) return null; // a fee or gas written as "unknown" is NaN, not zero; refuse, do not pass
  return { gross, net };
}

/** Reasons that refuse the whole quest, whatever its rewards. */
export function questReasons(c, account, now = Date.now()) {
  const reasons = [];
  const q = c.requirements || {};
  const p = c.project || {};

  // Open now.
  if (c.status !== 'Active') reasons.push(`NOT_OPEN: status ${c.status ?? 'unknown'}`);
  const start = toMs(c.startTime);
  const end = toMs(c.endTime);
  if (Number.isFinite(start) && now < start) reasons.push('NOT_OPEN: not started');
  if (Number.isFinite(end) && now > end) reasons.push('NOT_OPEN: ended');
  if (Number(c.cap) > 0 && Number(participantsOf(c)) >= Number(c.cap)) reasons.push('NOT_OPEN: cap reached');

  // Our account must be eligible before a minute is spent. Unknown counts as unmet.
  if (!c.requirements || typeof c.requirements !== 'object' || Array.isArray(c.requirements)) reasons.push('INELIGIBLE: requirements not recorded');
  // A requirement the gate does not model cannot be checked against the account, so it is treated as unmet.
  const KNOWN_REQ = new Set(['xAgeMonths', 'xFollowers', 'blueCheck', 'scoreHumanity', 'passport', 'holdings', 'excludedCountries', 'kyc']);
  for (const k of Object.keys(q)) if (!KNOWN_REQ.has(k)) reasons.push(`INELIGIBLE: requirement ${k} not understood (fail closed)`);
  for (const f of ['xAgeMonths', 'xFollowers', 'scoreHumanity']) {
    if (f in q && (typeof q[f] !== 'number' || !Number.isFinite(q[f]))) reasons.push(`INELIGIBLE: ${f} unknown`);
  }
  for (const f of ['blueCheck', 'passport']) {
    if (f in q && typeof q[f] !== 'boolean') reasons.push(`INELIGIBLE: ${f} unknown`);
  }
  if ('holdings' in q && !Array.isArray(q.holdings)) reasons.push('INELIGIBLE: holdings unknown');
  if (Number(q.xAgeMonths || 0) > Number(account.xAgeMonths || 0)) reasons.push(`INELIGIBLE: X account ${q.xAgeMonths} months needed, have ${account.xAgeMonths || 0}`);
  if (Number(q.xFollowers || 0) > Number(account.xFollowers || 0)) reasons.push(`INELIGIBLE: ${q.xFollowers} X followers needed, have ${account.xFollowers || 0}`);
  if (q.blueCheck && !account.blueCheck) reasons.push('INELIGIBLE: X blue check needed');
  if (Number(q.scoreHumanity || 0) > Number(account.scoreHumanity || 0)) reasons.push(`INELIGIBLE: Humanity L${q.scoreHumanity} needed, have L${account.scoreHumanity || 0}`);
  if (q.passport && !account.passport) reasons.push('INELIGIBLE: Passport needed');
  for (const h of q.holdings || []) if (!(account.holdings || []).includes(h)) reasons.push(`INELIGIBLE: must hold ${h}`);
  // Jurisdiction and KYC: many token distributions exclude countries or need the project's own KYC.
  if ('excludedCountries' in q) {
    if (!Array.isArray(q.excludedCountries)) reasons.push('INELIGIBLE: excludedCountries unknown');
    else if (!account.country) reasons.push('INELIGIBLE: our country is not recorded in account.json');
    else if (q.excludedCountries.map((x) => String(x).toUpperCase()).includes(String(account.country).toUpperCase())) reasons.push(`INELIGIBLE: ${account.country} is excluded`);
  }
  if ('kyc' in q && typeof q.kyc !== 'boolean') reasons.push('INELIGIBLE: kyc unknown');
  else if (q.kyc && !account.kycOk) reasons.push('INELIGIBLE: project KYC needed (Leif decides on KYC)');

  // The page must be the genuine app, reached over http(s), and the project credible. A non-http scheme
  // (javascript:, data:, ftp:) is refused outright, not waved through on a matching hostname.
  const parsed = (() => { try { return new URL(c.url); } catch { return null; } })();
  if (!parsed || !/^https?:$/.test(parsed.protocol)) reasons.push(`LOOKALIKE_URL: ${parsed ? `${parsed.protocol.replace(':', '')} not http` : 'invalid url'}`);
  else if (!GENUINE_HOSTS.has(parsed.hostname)) reasons.push(`LOOKALIKE_URL: ${parsed.hostname}`);
  const credible = spaceVerified(c) || Number(p.fundingUsd || 0) >= 1_000_000 || p.tokenStatus === 'live';
  if (!credible) reasons.push('UNVERIFIED_PROJECT');

  // On-chain tasks put money in the wallet: their capital must fit the cap, and both capital and gas must be known.
  const onChain = tasksOf(c).some((g) => g.items.some((t) => t.onChain));
  const cap = Number(account.walletCapUsd ?? 25);
  if (onChain && (c.capitalUsd == null || c.taskGasUsd == null)) reasons.push('TASK_COST_UNKNOWN: on-chain task without capital and gas recorded');
  if (c.capitalUsd != null && !Number.isFinite(Number(c.capitalUsd))) reasons.push('TASK_COST_UNKNOWN: capital');
  else if (Number(c.capitalUsd || 0) > cap) reasons.push(`CAPITAL_ABOVE_CAP: $${Number(c.capitalUsd)} > $${cap} wallet cap`);
  // taskGasUsd is subtracted from every quest's value, so a non-numeric one would poison EV wherever it appears.
  if (c.taskGasUsd != null && !Number.isFinite(Number(c.taskGasUsd))) reasons.push('TASK_COST_UNKNOWN: task gas');

  // It must fit the week. Unknown minutes are refused, not assumed to be zero.
  const mcap = Number(account.questMinutesCap ?? account.dailyMinutesCap ?? 15);
  if (!Number.isFinite(Number(c.minutes)) || c.minutes == null) reasons.push('TOO_SLOW: minutes unknown');
  else if (Number(c.minutes) > mcap) reasons.push(`TOO_SLOW: ${c.minutes} min > ${mcap} min cap`);
  return reasons;
}

/** Is this reward real, claimable, worth it, and not a speed game? */
export function cashVerdict(o, c, account) {
  const reasons = [];
  const r = o.reward || {};
  const type = String(r.type || 'none').toLowerCase();
  const threshold = Number(account.evThresholdUsd ?? 2);
  const haircut = Number(account.haircutUnlaunched ?? 0.5);

  if (WORTHLESS_TYPES.has(type)) {
    const conv = r.pointsConversion;
    const published = type === 'points' && conv && Number(conv.ratio) > 0 && conv.date && conv.source;
    // A worthless reward needs no further reasons: its claim path and value are beside the point.
    if (!published) return { reasons: [`WORTHLESS_REWARD: ${type}`], value: null, gross: null };
  }
  if (r.eligible === false) reasons.push('INELIGIBLE: the official eligibility check says this address cannot claim');

  if (!r.claimChain) reasons.push('CLAIM_PATH_UNKNOWN: chain');
  else if (!(account.chains || {})[r.claimChain]) reasons.push(`CLAIM_PATH_UNKNOWN: no gas on ${r.claimChain}`);
  if (r.claimWindowDays == null || !Number.isFinite(Number(r.claimWindowDays))) reasons.push('CLAIM_PATH_UNKNOWN: window');
  if (r.claimFeeUsd == null || !Number.isFinite(Number(r.claimFeeUsd))) reasons.push('CLAIM_PATH_UNKNOWN: fee');
  if (r.gasUsd != null && !Number.isFinite(Number(r.gasUsd))) reasons.push('CLAIM_PATH_UNKNOWN: claim gas');

  // First-come-first-served is a speed game bots win; a weekly pass enters only when at least half the slots are free.
  if (r.split === 'fcfs') {
    const slots = Number(r.slots);
    const left = Number(r.slotsLeft);
    if (!(slots > 0) || !Number.isFinite(left)) reasons.push('SPEED_GAME: first-come-first-served with unknown slots');
    else if (left / slots < 0.5) reasons.push(`SPEED_GAME: ${left} of ${slots} slots left`);
  }

  const ev = expectedValue(c, haircut, r);
  const p = participantsOf(c);
  if (p == null || !Number.isFinite(Number(p))) reasons.push('LOW_EV: participants unknown');
  else if (!ev) reasons.push('LOW_EV: cannot value (split, pool or prize missing)');
  else if (ev.net < threshold) reasons.push(`LOW_EV: $${ev.net.toFixed(2)} < $${threshold.toFixed(2)}`);
  return { reasons, value: ev?.net ?? null, gross: ev?.gross ?? null };
}

function claimBy(c, o) {
  const end = toMs(c.endTime);
  const w = Number(o?.reward?.claimWindowDays);
  return Number.isFinite(end) && Number.isFinite(w) ? new Date(end + w * DAY).toISOString().slice(0, 10) : null;
}

/** Run one candidate through the gate. Returns the verdict, the best option and what the Do card needs. */
export function gate(c, account, now = Date.now()) {
  const quest = questReasons(c, account, now);
  const evals = rewardOptions(c).map((o) => {
    const v = cashVerdict(o, c, account);
    return { ...o, ...v };
  });
  const passing = evals.filter((e) => e.reasons.length === 0)
    .sort((a, b) => b.value - a.value);
  const best = quest.length === 0 ? passing[0] ?? null : null;
  const reasons = [...quest];
  if (!best) {
    if (evals.length === 0) reasons.push('WORTHLESS_REWARD: none');
    else if (evals.length === 1) reasons.push(...evals[0].reasons);
    else for (const e of evals) reasons.push(...e.reasons.map((r) => `[${e.label}] ${r}`));
  }
  const shown = best ?? evals[0] ?? null;
  return {
    id: c.id, name: c.name ?? null, space: spaceName(c), url: c.url,
    pass: reasons.length === 0 && !!best, option: best?.label ?? null, reasons,
    ev: shown?.value ?? null, evGross: shown?.gross ?? null,
    minutes: Number.isFinite(Number(c.minutes)) ? Number(c.minutes) : null,
    claimBy: best ? claimBy(c, best) : null, tasks: tasksOf(c),
    endsAt: Number.isFinite(toMs(c.endTime)) ? new Date(toMs(c.endTime)).toISOString().slice(0, 10) : null,
    capitalUsd: Number.isFinite(Number(c.capitalUsd)) ? Number(c.capitalUsd) : 0,
  };
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
  const byReason = {};
  // Quests per reason (a quest refused for three claim-path gaps counts once under CLAIM_PATH_UNKNOWN).
  for (const x of refused) for (const k of new Set(x.reasons.map((r) => r.replace(/^\[[^\]]*\]\s*/, '').split(':')[0]))) byReason[k] = (byReason[k] || 0) + 1;
  return { passed, refused, results, skipped, byReason };
}

export function toMarkdown({ passed, refused, byReason = {} }, when = new Date()) {
  const lines = [`# Shortlist, ${when.toISOString().slice(0, 10)}`, ''];
  lines.push(`Entered only if listed under **Do**. ${passed.length} pass, ${refused.length} refused.`, '');
  lines.push('## Do: real prizes, claimable', '');
  if (passed.length === 0) lines.push('_Nothing clears the gate this week. That is a result, not a failure._', '');
  for (const x of passed) lines.push(`- **${x.space} / ${x.id}**: EV $${x.ev.toFixed(2)} net ($${x.evGross.toFixed(2)} gross), ${x.option}, claim by ${x.claimBy ?? 'unknown'}. ${x.url}`);
  lines.push('', '## Refused, and why', '');
  const counts = Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  if (counts) lines.push(`By reason: ${counts}.`, '');
  for (const x of refused) lines.push(`- ${x.space} / ${x.id}: ${x.reasons.join('; ')}`);
  lines.push('');
  return lines.join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Resolve both sides to a real path before comparing, so the CLI still runs when the invocation path has a
// space, a symlink or a non-ASCII character (a raw `file://${argv[1]}` would not match import.meta.url then).
const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const candidatesPath = arg('candidates', 'galxe-desk/candidates.json');
  const accountPath = arg('account', 'galxe-desk/account.json');
  const out = arg('out', 'galxe-desk/shortlist.md');
  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  const account = JSON.parse(readFileSync(accountPath, 'utf8'));
  const result = rank(candidates, account);
  writeFileSync(out, toMarkdown(result));
  writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(result, null, 2));
  console.log(`read ${candidates.length} (${result.skipped} metadata), ${result.passed.length} pass, ${result.refused.length} refused -> ${out}`);
  console.log(`refused by reason: ${JSON.stringify(result.byReason)}`);
}
