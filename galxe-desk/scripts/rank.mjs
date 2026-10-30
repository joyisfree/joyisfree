#!/usr/bin/env node
// The Prize Gate. A quest is entered only if its prize is real, the quest is open, our account is eligible, the claim
// path is known, the page is genuine, any on-chain task fits the wallet, the expected value clears the bar and it fits
// the week. Everything else is refused with the reason written down. Unknown counts as unmet: the gate fails closed.
//
// Two lanes:
//   cash   - token, stablecoin or ETH prizes valued per participant (pool / participants, raffle odds), claimable now.
//   voyage - points, credentials or OATs that only count when the project itself has said they feed a token it has
//            confirmed but not launched (the Linea Voyage pattern). Tracked as positions, never as cash.
//
//   node galxe-desk/scripts/rank.mjs --candidates galxe-desk/candidates.json \
//        --account galxe-desk/account.json --out galxe-desk/shortlist.md
//
// Candidates may use Galxe's official quest shape (docs.galxe.com/galxe-integration/api-reference/quest: type, status,
// startTime/endTime in unix seconds, cap, participantsCount, chain, gasType, space, credentialGroups with
// conditionRelation ALL|ANY, conditions and rewards {rewardType, rewardCount, eligible}) or the desk's flat `reward`.
// Pure functions are exported so the tests can prove every guard refuses what it should.

import { readFileSync, writeFileSync } from 'node:fs';

export const WORTHLESS_TYPES = new Set(['oat', 'points', 'gg', 'xp', 'badge', 'nft-no-floor', 'whitelist', 'role', 'none', 'credential']);
export const POSITION_TYPES = new Set(['points', 'oat', 'credential']); // may carry pre-token value with Voyage evidence
export const GENUINE_HOSTS = new Set(['app.galxe.com']); // quests live only here; the marketing site is not a quest page
export const SPLITS = new Set(['even', 'raffle', 'luck', 'fcfs']);
const ONCHAIN = /\b(swap|bridge|hold|holding|stake|staking|deposit|mint|trade|liquidity|lend|borrow|buy)\b/i;
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

export const isUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
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
    case 'raffle':
      gross = (Number(r.prizeUsd ?? NaN) * Number(r.winners ?? NaN)) / n;
      break;
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
  if (r.tokenLaunched === false || r.vesting === true) net *= haircut;
  net -= Number(r.claimFeeUsd ?? 0) + Number(r.gasUsd ?? 0) + Number(c.taskGasUsd ?? 0);
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

  // The page must be the genuine app and the project credible.
  let host = null;
  try { host = new URL(c.url).hostname; } catch { host = null; }
  if (!host || !GENUINE_HOSTS.has(host)) reasons.push(`LOOKALIKE_URL: ${host || 'invalid url'}`);
  const credible = spaceVerified(c) || Number(p.fundingUsd || 0) >= 1_000_000 || p.tokenStatus === 'live';
  if (!credible) reasons.push('UNVERIFIED_PROJECT');

  // On-chain tasks put money in the wallet: their capital must fit the cap, and both capital and gas must be known.
  const onChain = tasksOf(c).some((g) => g.items.some((t) => t.onChain));
  const cap = Number(account.walletCapUsd ?? 25);
  if (onChain && (c.capitalUsd == null || c.taskGasUsd == null)) reasons.push('TASK_COST_UNKNOWN: on-chain task without capital and gas recorded');
  if (c.capitalUsd != null && !Number.isFinite(Number(c.capitalUsd))) reasons.push('TASK_COST_UNKNOWN: capital');
  else if (Number(c.capitalUsd || 0) > cap) reasons.push(`CAPITAL_ABOVE_CAP: $${Number(c.capitalUsd)} > $${cap} wallet cap`);

  // It must fit the week. Unknown minutes are refused, not assumed to be zero.
  const mcap = Number(account.questMinutesCap ?? account.dailyMinutesCap ?? 15);
  if (!Number.isFinite(Number(c.minutes)) || c.minutes == null) reasons.push('TOO_SLOW: minutes unknown');
  else if (Number(c.minutes) > mcap) reasons.push(`TOO_SLOW: ${c.minutes} min > ${mcap} min cap`);
  return reasons;
}

/** Cash lane: is this reward real, claimable, worth it, and not a speed game? */
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
  if (r.claimWindowDays == null) reasons.push('CLAIM_PATH_UNKNOWN: window');
  if (r.claimFeeUsd == null) reasons.push('CLAIM_PATH_UNKNOWN: fee');

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

/** Voyage lane: points, credentials or OATs count only with the project's own evidence that they feed an unlaunched token. */
export function voyageVerdict(o, c, account) {
  const v = c.voyage || {};
  const cfg = { minFundingUsd: 10_000_000, pLaunch: 0.5, haircut: 0.5, minUsd: 10, ...(account.voyage || {}) };
  const reasons = [];
  if (o.reward?.eligible === false) reasons.push('INELIGIBLE: the official eligibility check says this address cannot claim');
  if (v.officialSpace !== true || !spaceVerified(c)) reasons.push("VOYAGE_EVIDENCE: not the project's own verified Space");
  if (!isUrl(v.tokenConfirmedUrl)) reasons.push('VOYAGE_EVIDENCE: token not confirmed by the project');
  if (v.tokenLaunched !== false) reasons.push(v.tokenLaunched === true ? 'VOYAGE_EVIDENCE: token already launched, value it as cash' : 'VOYAGE_EVIDENCE: launch status unknown');
  if (!isUrl(v.pointsCountUrl)) reasons.push('VOYAGE_EVIDENCE: no project statement that these points count');
  if (!(Number(v.fundingUsd) >= cfg.minFundingUsd) || !isUrl(v.fundingSourceUrl)) reasons.push(`VOYAGE_EVIDENCE: funding under $${cfg.minFundingUsd / 1e6}M or unsourced`);
  if (v.threshold == null) reasons.push('VOYAGE_EVIDENCE: threshold unknown');
  if (v.reachable !== true) reasons.push('VOYAGE_EVIDENCE: threshold not shown reachable at the weekly pace');
  if (!v.cutoff || Number.isNaN(Date.parse(v.cutoff))) reasons.push('VOYAGE_EVIDENCE: cut-off date unknown');
  if (!(Number(v.estimateUsd) > 0) || !isUrl(v.estimateBasisUrl)) reasons.push('VOYAGE_EVIDENCE: no estimate with a sourced basis');
  const value = Number(v.estimateUsd) > 0 ? Number(v.estimateUsd) * cfg.pLaunch * cfg.haircut : null;
  if (value != null && value < cfg.minUsd) reasons.push(`LOW_EV: position $${value.toFixed(2)} < $${cfg.minUsd.toFixed(2)}`);
  return { reasons, value, gross: Number(v.estimateUsd) || null };
}

function claimBy(c, o, lane) {
  if (lane === 'voyage') return c.voyage?.cutoff ?? null;
  const end = toMs(c.endTime);
  const w = Number(o?.reward?.claimWindowDays);
  return Number.isFinite(end) && Number.isFinite(w) ? new Date(end + w * DAY).toISOString().slice(0, 10) : null;
}

/** Run one candidate through the gate. Returns the verdict, the lane, the best option and what the Do card needs. */
export function gate(c, account, now = Date.now()) {
  const quest = questReasons(c, account, now);
  const evals = rewardOptions(c).map((o) => {
    const lane = POSITION_TYPES.has(String(o.reward.type).toLowerCase()) && c.voyage ? 'voyage' : 'cash';
    const v = lane === 'voyage' ? voyageVerdict(o, c, account) : cashVerdict(o, c, account);
    return { ...o, lane, ...v };
  });
  const passing = evals.filter((e) => e.reasons.length === 0)
    .sort((a, b) => (a.lane === b.lane ? b.value - a.value : a.lane === 'cash' ? -1 : 1));
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
    pass: reasons.length === 0 && !!best, lane: best?.lane ?? null, option: best?.label ?? null, reasons,
    ev: shown?.value ?? null, evGross: shown?.gross ?? null,
    minutes: Number.isFinite(Number(c.minutes)) ? Number(c.minutes) : null,
    claimBy: best ? claimBy(c, best, best.lane) : null, tasks: tasksOf(c),
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
  const passed = results.filter((x) => x.pass && x.lane === 'cash').sort((a, b) => b.ev - a.ev);
  const voyage = results.filter((x) => x.pass && x.lane === 'voyage').sort((a, b) => b.ev - a.ev);
  const refused = results.filter((x) => !x.pass);
  const byReason = {};
  // Quests per reason (a quest refused for three claim-path gaps counts once under CLAIM_PATH_UNKNOWN).
  for (const x of refused) for (const k of new Set(x.reasons.map((r) => r.replace(/^\[[^\]]*\]\s*/, '').split(':')[0]))) byReason[k] = (byReason[k] || 0) + 1;
  return { passed, voyage, refused, results, skipped, byReason };
}

export function toMarkdown({ passed, voyage = [], refused, byReason = {} }, when = new Date()) {
  const lines = [`# Shortlist, ${when.toISOString().slice(0, 10)}`, ''];
  lines.push(`Entered only if listed under **Do** or **Voyage**. ${passed.length} cash, ${voyage.length} voyage, ${refused.length} refused.`, '');
  lines.push('## Do: cash prizes', '');
  if (passed.length === 0) lines.push('_No cash prize clears the gate this week. That is a result, not a failure._', '');
  for (const x of passed) lines.push(`- **${x.space} / ${x.id}**: EV $${x.ev.toFixed(2)} net ($${x.evGross.toFixed(2)} gross), ${x.option}, claim by ${x.claimBy ?? 'unknown'}. ${x.url}`);
  lines.push('', '## Voyage: points that can become the airdrop (positions, not cash)', '');
  if (voyage.length === 0) lines.push('_No points campaign has the evidence this week._', '');
  for (const x of voyage) lines.push(`- **${x.space} / ${x.id}**: position worth $${x.ev.toFixed(2)} after odds and haircut, cut-off ${x.claimBy}. ${x.url}`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const candidatesPath = arg('candidates', 'galxe-desk/candidates.json');
  const accountPath = arg('account', 'galxe-desk/account.json');
  const out = arg('out', 'galxe-desk/shortlist.md');
  const candidates = JSON.parse(readFileSync(candidatesPath, 'utf8'));
  const account = JSON.parse(readFileSync(accountPath, 'utf8'));
  const result = rank(candidates, account);
  writeFileSync(out, toMarkdown(result));
  writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(result, null, 2));
  console.log(`read ${candidates.length} (${result.skipped} metadata), ${result.passed.length} cash, ${result.voyage.length} voyage, ${result.refused.length} refused -> ${out}`);
  console.log(`refused by reason: ${JSON.stringify(result.byReason)}`);
}
