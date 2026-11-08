#!/usr/bin/env node
// A two-arm email test that cannot be talked into a result it did not earn.
//
//   node agency/scripts/ab-test.mjs --preflight --list-size 2000 --metric orders        # before anything is written
//   node agency/scripts/ab-test.mjs --check --file agency/experiments/drop-vs-email.json  # before anything is sent
//   node agency/scripts/ab-test.mjs --file agency/experiments/drop-vs-email.json          # once, on analyseOn
//
// Why this exists: the cheapest decisive test on the brand side is "does one limited drop to Joyisfree's list beat a
// plain email to the same list?" An A/B test run badly is worse than none, because it produces a number that feels
// like evidence. A review of the first draft found fifteen ways this one could be talked into a result (a sample-size
// formula that came out a third too small, ties handed to arm A, a rule dated after the send let through, blank cells
// read as zeros, unlimited peeking). Each is now a guard, and each guard has a test that goes red without it.
//
// The most useful thing it says is usually the first thing: at a clothing campaign's ~0.12% placed-order rate, a
// doubling of orders needs about 19,586 recipients per arm, and 20,617 once 5% are allowed to bounce (41,234 on the
// list). --preflight says TOO SMALL before a send is wasted, and the cheaper arm is the one to send. That is the
// answer, not a consolation prize.
//
// Verdicts, in the order they are checked (exit 0 only for WINNER):
//   NOT_PRE_REGISTERED   the rule is incomplete, dated after the data (or dated so the order cannot be told),
//                        or underpowered by design; at --check, also planned with no room for 5% lost to bounces
//   INVALID_DATA         a count is blank, malformed or impossible, or revenue and orders do not match
//   TOO_EARLY            read before analyseOn, or an arm more than 5% short of plan; no p-value is shown at all
//   INSUFFICIENT_SAMPLE  an arm below the required n, or under 10 expected conversions; the default arm stands
//   INCONCLUSIVE_DEFAULT not significant; the default arm stands, and the list could not tell the arms apart
//   NO_CLEAR_WIN         significant on conversion, but the other arm earns more per recipient
//   WINNER               significant on conversion, and not behind on money
//
// The minimum lift sizes the test; it is not a second bar the result must clear. Two reviewers simulated a
// "significant but below the bar" verdict and it cut real power from ~63% to ~44% at exactly the registered effect,
// so no such verdict exists here. The lift is printed, winner over loser, for reading only.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERDICTS = ['NOT_PRE_REGISTERED', 'INVALID_DATA', 'TOO_EARLY', 'INSUFFICIENT_SAMPLE', 'INCONCLUSIVE_DEFAULT', 'NO_CLEAR_WIN', 'WINNER'];

/** The only metric the code actually tests. Anything else would be a conversion test wearing another label. */
export const METRIC = 'conversion_rate';

/** Below this many expected conversions in the smaller arm, no verdict is reached whatever the formula says. */
export const MIN_EXPECTED_CONVERSIONS = 10;

/** An arm more than this fraction short of plannedPerArm is not the test that was planned. */
const SHORTFALL = 0.05;

const DAY = 86_400_000;

// The researched baselines for --preflight. SUMMARY means taken from search summaries, the pages not opened.
export const BASELINES = {
  orders: { rate: 0.0012, source: 'SUMMARY, not verified: Klaviyo 2026 benchmark, clothing campaigns, placed orders per recipient 0.12% (range 0.07% to 0.13%); flows run far higher and must never be used' },
  clicks: { rate: 0.0074, source: 'SUMMARY, not verified: Omnisend 2025 benchmark, campaign clicks per recipient 0.74%' },
};

// Standard normal quantiles. A small exact table beats a home-rolled inverse CDF: anything not listed is refused
// rather than approximated, because silently wrong statistics are the failure this file exists to prevent.
const Z_TWO_SIDED = [[0.10, 1.6448536269514722], [0.05, 1.959963984540054], [0.01, 2.5758293035489004]];
const Z_POWER = [[0.80, 0.8416212335729143], [0.90, 1.2815515655446004], [0.95, 1.6448536269514722]];
const Z_95 = 1.959963984540054;

/**
 * Abramowitz & Stegun 7.1.26. Good to about 1.5e-7, far beyond what a marketing test needs. Its polynomial leaves
 * 1e-9 at the origin, where erf is exactly 0 (it is odd), so 0 is answered exactly: two arms with the same rate
 * must give z = 0, normalCdf(0) = 0.5 and p = 1, not p = 0.999999999.
 */
export function erf(x) {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return sign * y;
}

export const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Wilson's score interval for x of n. Unlike x/n ± z·√(pq/n), it keeps its width at 0 and at n. */
function wilson(x, n, z) {
  const p = x / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z / den) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [centre - half, centre + half];
}

/**
 * The 95% interval for pO − pD, the other arm's rate minus the default's: Newcombe's hybrid score interval (1998,
 * method 10), built from each arm's Wilson interval. It replaced an unpooled Wald interval that collapsed to
 * "+0.00 to +0.00" at 0 orders against 0, which claims the arms are known to be equal, and that ran too narrow
 * whenever one arm had none. Pinned to Newcombe's published examples in the tests. The counts are the caller's,
 * already checked as whole numbers with 0 ≤ x ≤ n and n > 0.
 */
export function differenceInterval(xO, nO, xD, nD, z = Z_95) {
  const pO = xO / nO;
  const pD = xD / nD;
  const [lO, uO] = wilson(xO, nO, z);
  const [lD, uD] = wilson(xD, nD, z);
  const d = pO - pD;
  return [d - Math.sqrt((pO - lO) ** 2 + (uD - pD) ** 2), d + Math.sqrt((uO - pO) ** 2 + (pD - lD) ** 2)];
}

// ---------------------------------------------------------------- strict parsing: unknown is never zero

/** A decimal is a finite number, or a string of plain digits with an optional fraction. No hex, no exponents. */
function decimal(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return NaN;
}

/** A count is a safe whole number, or a string of digits. No "", no whitespace, no arrays, no hex, no exponents. */
function count(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : NaN;
  }
  return NaN;
}

/** Money to whole cents, exactly. A string is read digit by digit; a number must already be whole cents. */
function cents(v) {
  if (typeof v === 'string') {
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v);
    if (!m) return NaN;
    const c = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(c) ? c : NaN;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const c = Math.round(v * 100);
    if (!Number.isSafeInteger(c) || Math.abs(v * 100 - c) > 1e-6) return NaN;
    return c;
  }
  return NaN;
}

/** Look a level up in a z table after normalising it, so "0.10", 0.1 and "0.1" are the same alpha. */
function zFor(table, v) {
  const x = decimal(v);
  if (!Number.isFinite(x)) return undefined;
  const hit = table.find(([k]) => Math.abs(k - x) < 1e-9);
  return hit ? { level: hit[0], z: hit[1] } : undefined;
}
const levels = (table) => table.map(([k]) => k.toFixed(2)).join(', ');

// ---------------------------------------------------------------- strict dates

/**
 * Only YYYY-MM-DD, or a full timestamp with seconds optional and an explicit Z or +hh:mm / -hh:mm offset.
 * Round-trip checked, so 2026-02-30 is refused rather than rolled into March. Slash dates, bare numbers and
 * timestamps with no offset are refused: Date.parse reads "3/12/2026" as 12 March, and a time with no offset as
 * whatever zone the machine happens to be in.
 * Returns { text, dateOnly, ms, day } where day is the calendar day as written, or null.
 */
export function strictDate(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(v);
  if (!m) return null;
  const [, Y, M, D, h, min, s, frac, off] = m;
  const y = Number(Y);
  const mo = Number(M);
  const d = Number(D);
  const dayMs = Date.UTC(y, mo - 1, d);
  const back = new Date(dayMs);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  const day = dayMs / DAY;
  if (h === undefined) return { text: v, dateOnly: true, ms: dayMs, day };
  const H = Number(h);
  const Mi = Number(min);
  const S = s === undefined ? 0 : Number(s);
  if (H > 23 || Mi > 59 || S > 59) return null;
  let offsetMin = 0;
  if (off !== 'Z') {
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(4, 6));
    if (oh > 14 || om > 59) return null;
    offsetMin = (off[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const ms = dayMs + ((H * 60 + Mi) * 60 + S) * 1000 + Number((frac ?? '').padEnd(3, '0')) - offsetMin * 60_000;
  return { text: v, dateOnly: false, ms, day };
}

/** a before b? If either is a bare date, compare calendar days, because a bare date says nothing about the hour. */
const earlier = (a, b) => (a.dateOnly || b.dateOnly ? a.day < b.day : a.ms < b.ms);

/**
 * In the future? A bare date is future only once it is future everywhere on Earth (UTC+14), so a rule written today
 * in Sydney is never refused because UTC is still on yesterday. A timestamp is compared to the instant.
 */
function isFuture(d, now) {
  if (d.dateOnly) return d.day > Math.floor((now + 14 * 3_600_000) / DAY);
  return d.ms > now;
}

// ---------------------------------------------------------------- sample size

function nRaw(p, lift, za, zb) {
  const p2 = p * (1 + lift);
  if (!(p2 < 1)) return null;
  const pbar = (p + p2) / 2;
  const top = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p * (1 - p) + p2 * (1 - p2));
  return top ** 2 / (p2 - p) ** 2;
}

/**
 * Recipients needed PER ARM to detect a relative lift of minLiftPct on a baseline rate: the standard two-proportion
 * formula, with the pooled variance under the null and each arm's own variance under the alternative.
 * p2 = p(1+L); p̄ = (p+p2)/2; n = ⌈(z_a·√(2p̄(1−p̄)) + z_b·√(p(1−p) + p2(1−p2)))² / (p2−p)²⌉. null if p2 ≥ 1.
 */
export function requiredPerArm({ baselineRate, minLiftPct, alpha = 0.05, power = 0.8 } = {}) {
  const a = zFor(Z_TWO_SIDED, alpha);
  const b = zFor(Z_POWER, power);
  const p = decimal(baselineRate);
  const lift = decimal(minLiftPct) / 100;
  if (!a || !b || !(p > 0 && p < 1) || !(lift > 0)) return null;
  const n = nRaw(p, lift, a.z, b.z);
  return n == null ? null : Math.ceil(n);
}

/**
 * The smallest relative lift (in %) an arm of perArm could detect. There is no closed form, because the treated
 * arm's variance depends on the lift being solved for, so it is found by bisection on requiredPerArm. null when
 * even a lift to a 100% rate could not be detected at this size.
 */
export function detectableLiftPct({ perArm, baselineRate, alpha = 0.05, power = 0.8 } = {}) {
  const a = zFor(Z_TWO_SIDED, alpha);
  const b = zFor(Z_POWER, power);
  const p = decimal(baselineRate);
  const n = count(perArm);
  if (!a || !b || !(p > 0 && p < 1) || !(n > 0)) return null;
  let lo = 0;
  let hi = (1 / p - 1) * (1 - 1e-12);
  if (nRaw(p, hi, a.z, b.z) > n) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (nRaw(p, mid, a.z, b.z) <= n) hi = mid;
    else lo = mid;
  }
  return hi * 100;
}

/** The fewest an arm may have for any verdict: the formula, and never fewer than the expected-conversions floor. */
const minimumFor = (need, p) => Math.max(need, Math.ceil(MIN_EXPECTED_CONVERSIONS / p));

/**
 * What to plan per arm: the minimum, grossed up for the 5% shortfall the analysis tolerates, so that an arm which
 * loses its tolerated 5% to bounces still has the minimum. Planned at the bare minimum, one bounced address made a
 * fully-run test INSUFFICIENT_SAMPLE. Whole-number arithmetic, the same as the shortfall check it must agree with.
 */
const planFor = (need, p) => Math.ceil((minimumFor(need, p) * 100) / (100 - SHORTFALL * 100));

// ---------------------------------------------------------------- formatting helpers

const pct = (x, dp = 2) => `${(x * 100).toFixed(dp)}%`;
const usd = (c) => `$${(c / 100).toFixed(2)}`;
const perRecipient = (c, n) => `$${(c / 100 / n).toFixed(4)}`;
const thousands = (n) => n.toLocaleString('en-AU');

// ---------------------------------------------------------------- pre-registration

/**
 * Is the rule fixed, complete and dated before the data? Needs no arm data, so it can refuse BEFORE the send.
 * stage 'check' allows the planned send and analysis dates to lie in the future; stage 'analyse' does not.
 * Returns { verdict: 'PRE_REGISTERED' | 'NOT_PRE_REGISTERED', ok, reasons, plan }.
 */
export function checkPreRegistration(e = {}, { now = Date.now(), stage = 'check' } = {}) {
  const problems = [];
  const pre = e?.preRegistered && typeof e.preRegistered === 'object' ? e.preRegistered : {};

  if (pre.metric !== METRIC) {
    problems.push(`preRegistered.metric must be "${METRIC}": it is the one thing this code tests (revenue per recipient is reported, never tested)`);
  }
  const baseline = decimal(pre.baselineRate);
  if (!(baseline > 0 && baseline < 1)) problems.push("preRegistered.baselineRate must be between 0 and 1: your list's own CAMPAIGN rate, never a flow's");
  const minLift = decimal(pre.minLiftPct);
  if (!(minLift > 0)) problems.push('preRegistered.minLiftPct is missing: state the smallest lift worth acting on (it sizes the test)');
  const a = zFor(Z_TWO_SIDED, pre.alpha);
  if (!a) problems.push(`preRegistered.alpha ${JSON.stringify(pre.alpha)} is not one of ${levels(Z_TWO_SIDED)}`);
  const b = zFor(Z_POWER, pre.power);
  if (!b) problems.push(`preRegistered.power ${JSON.stringify(pre.power)} is not one of ${levels(Z_POWER)}`);

  let need = null;
  let minimum = null;
  let toPlan = null;
  if (baseline > 0 && baseline < 1 && minLift > 0 && a && b) {
    need = requiredPerArm({ baselineRate: baseline, minLiftPct: minLift, alpha: a.level, power: b.level });
    if (need == null) problems.push(`a ${minLift}% lift on a ${pct(baseline)} baseline would pass a 100% rate: no test can be sized for it`);
    else {
      minimum = minimumFor(need, baseline);
      toPlan = planFor(need, baseline);
    }
  }

  // Under the minimum, the plan cannot work even if every address delivers. Under the planning figure, it works
  // only if nearly none bounce: refused at --check, while the plan can still be changed. After the send the plan
  // is what it was, and an arm short of the minimum is answered by the arms themselves (INSUFFICIENT_SAMPLE).
  const planned = count(pre.plannedPerArm);
  if (!(planned > 0)) problems.push('preRegistered.plannedPerArm must be a whole number: how many recipients each arm will get');
  else if (minimum != null && planned < minimum) {
    const why = planned < need
      ? `${thousands(need)} per arm are needed to detect a ${minLift}% lift at power ${b.level.toFixed(2)}`
      : `${thousands(minimum)} per arm are needed for ${MIN_EXPECTED_CONVERSIONS} expected conversions at a ${pct(baseline)} baseline`;
    problems.push(`underpowered by design: plannedPerArm is ${thousands(planned)} but ${why}. Do not run it as a decision; the default arm stands.`);
  } else if (toPlan != null && stage === 'check' && planned < toPlan) {
    problems.push(`plannedPerArm ${thousands(planned)} leaves no room for bounces: the analysis tolerates an arm up to ${SHORTFALL * 100}% short of plan, and ${thousands(planned)} less ${SHORTFALL * 100}% is under the ${thousands(minimum)} needed. Plan at least ${thousands(toPlan)} per arm.`);
  }

  const window = count(pre.conversionWindowDays);
  if (!(window >= 1)) problems.push('preRegistered.conversionWindowDays must be a whole number of days, 1 or more');

  // The dates. The rule must be fixed strictly before the first send, and nothing may be dated in the future
  // except, at --check, the planned send and analysis dates.
  const decided = strictDate(pre.decidedOn);
  const from = strictDate(e?.dataCollectedFrom);
  const analyseOn = strictDate(pre.analyseOn);
  if (!decided) problems.push('preRegistered.decidedOn must be the date the rule was fixed, as YYYY-MM-DD or a timestamp with Z or +hh:mm');
  else if (isFuture(decided, now)) problems.push(`preRegistered.decidedOn ${decided.text} is in the future: a rule cannot have been fixed on a day that has not happened`);
  if (!from) problems.push('dataCollectedFrom must be the date sending starts, as YYYY-MM-DD or a timestamp with Z or +hh:mm');
  else if (stage !== 'check' && isFuture(from, now)) problems.push(`dataCollectedFrom ${from.text} is in the future: there cannot be data yet`);
  // A bare date says nothing about the hour, so a bare date against a timestamp cannot be ordered: 2026-11-05T23:00Z
  // is 10am on 6 Nov in Sydney, an hour after a 9am send dated 2026-11-06. Both must be written the same way.
  if (decided && from && decided.dateOnly !== from.dateOnly) {
    problems.push(`preRegistered.decidedOn (${decided.text}) and dataCollectedFrom (${from.text}) must be written the same way, both as YYYY-MM-DD or both as timestamps with an offset: a bare date has no hour, so which came first cannot be told`);
  } else if (decided && from && !earlier(decided, from)) {
    problems.push(`the rule (${decided.text}) was not fixed strictly before the data (${from.text}): that is not a test, it is a story. Re-run it pre-registered.`);
  }
  if (!analyseOn) problems.push('preRegistered.analyseOn must be the one day the results will be read, as YYYY-MM-DD or a timestamp with Z or +hh:mm');
  else if (from && window >= 1) {
    const ready = from.dateOnly || analyseOn.dateOnly ? analyseOn.day >= from.day + window : analyseOn.ms >= from.ms + window * DAY;
    if (!ready) problems.push(`preRegistered.analyseOn ${analyseOn.text} falls inside the ${window}-day conversion window that starts ${from.text}: orders still arriving would be missed`);
  }

  // The arms are part of the design: two, named, distinct, and one of them the pre-registered default.
  const arms = Array.isArray(e?.arms) ? e.arms : null;
  const names = [];
  if (!arms || arms.length !== 2) problems.push('exactly two arms are needed');
  else {
    arms.forEach((arm, i) => {
      const name = typeof arm?.name === 'string' ? arm.name.trim() : '';
      if (!name) problems.push(`arm ${i + 1} needs a name`);
      names.push(name);
    });
    if (names[0] && names[1] && names[0].toLowerCase() === names[1].toLowerCase()) problems.push(`arm names must be distinct: both are "${names[0]}"`);
  }
  const wanted = typeof pre.defaultArm === 'string' ? pre.defaultArm.trim().toLowerCase() : '';
  const defaultIndex = wanted ? names.findIndex((n) => n && n.toLowerCase() === wanted) : -1;
  if (!wanted) problems.push('preRegistered.defaultArm is missing: name the arm that stands if the test cannot decide (the cheaper one)');
  else if (names.length === 2 && defaultIndex < 0) problems.push(`preRegistered.defaultArm "${pre.defaultArm}" is not one of the arms`);

  if (problems.length) return { verdict: 'NOT_PRE_REGISTERED', ok: false, headline: 'VERDICT  NOT_PRE_REGISTERED', reasons: problems };

  const plan = {
    baseline, minLift, alpha: a.level, za: a.z, power: b.level, need, minimum, toPlan, planned, window,
    decided, from, analyseOn, names, defaultIndex, defaultArm: names[defaultIndex],
  };
  return {
    verdict: 'PRE_REGISTERED',
    ok: true,
    headline: 'CHECK  PRE_REGISTERED',
    plan,
    reasons: [
      `metric: conversion rate, two-sided at alpha ${a.level.toFixed(2)}, power ${b.level.toFixed(2)}`,
      `${thousands(need)} per arm detect a ${minLift}% lift on a ${pct(baseline)} baseline; ${thousands(planned)} per arm are planned, against the ${thousands(toPlan)} that lets ${SHORTFALL * 100}% bounce`,
      `rule fixed ${decided.text}, sending from ${from.text}, ${window}-day conversion window, one look on ${analyseOn.text}`,
      `if the test cannot decide, "${names[defaultIndex]}" stands`,
    ],
  };
}

// ---------------------------------------------------------------- the analysis

/**
 * Analyse a finished experiment, once. `now` is injectable so the future-date guards can be tested.
 * Returns { verdict, headline, reasons, ... }; see the header for the verdicts and their order.
 */
export function analyse(e = {}, { now = Date.now() } = {}) {
  // 1. The rule must have been fixed, completely, before the data existed.
  const check = checkPreRegistration(e, { now, stage: 'analyse' });
  if (!check.ok) return check;
  const plan = check.plan;

  // 2. The data must be real counts, and the reading must be dated.
  const problems = [];
  const parsed = e.arms.map((arm, i) => {
    const name = plan.names[i];
    const recipients = count(arm?.recipients);
    const conversions = count(arm?.conversions);
    const revenueCents = cents(arm?.revenueUsd);
    if (!(recipients > 0)) problems.push(`${name}: recipients must be a whole number above 0, written as digits`);
    if (!(conversions >= 0)) problems.push(`${name}: conversions must be a whole number written as digits (0 or more, never blank)`);
    if (!(revenueCents >= 0)) problems.push(`${name}: revenueUsd must be dollars and cents, 0 or more (never blank, never a fraction of a cent)`);
    if (recipients > 0 && conversions >= 0 && conversions > recipients) problems.push(`${name}: more conversions than recipients`);
    if (conversions > 0 && revenueCents === 0) problems.push(`${name}: ${conversions} conversions but $0 revenue, so revenue was not recorded. Enter it from the store before reading the test.`);
    if (conversions === 0 && revenueCents > 0) problems.push(`${name}: ${usd(revenueCents)} revenue but 0 conversions: the counts and the revenue come from different sources or windows. Take both from the same store report.`);
    return { name, recipients, conversions, revenueCents };
  });
  const analysedOn = strictDate(e.analysedOn);
  if (!analysedOn) problems.push('analysedOn must be the date you are reading the results, as YYYY-MM-DD or a timestamp with Z or +hh:mm');
  else if (isFuture(analysedOn, now)) problems.push(`analysedOn ${analysedOn.text} is in the future`);
  if (problems.length) return { verdict: 'INVALID_DATA', headline: 'VERDICT  INVALID_DATA', reasons: problems };

  // 3. One look only, on the day it was planned for, at the size it was planned at. No p-value, no rates: a number
  //    seen early is a number that gets acted on.
  const early = [];
  if (earlier(analysedOn, plan.analyseOn)) early.push(`the results are due on ${plan.analyseOn.text}, and this reading is dated ${analysedOn.text}. One look only: come back then.`);
  for (const a of parsed) {
    if (a.recipients * 100 < plan.planned * (100 - SHORTFALL * 100)) {
      early.push(`${a.name} has ${thousands(a.recipients)} recipients against ${thousands(plan.planned)} planned, more than ${SHORTFALL * 100}% short: this is not the test that was planned`);
    }
  }
  if (early.length) {
    return {
      verdict: 'TOO_EARLY',
      headline: 'VERDICT  TOO_EARLY',
      arms: parsed.map(({ name, recipients }) => ({ name, recipients })),
      defaultArm: plan.defaultArm,
      reasons: [...early, 'no p-value and no rates are shown before then, by design'],
    };
  }

  for (const a of parsed) a.rate = a.conversions / a.recipients;
  const [A, B] = parsed;
  const smallest = Math.min(A.recipients, B.recipients);
  const detectable = (n) => detectableLiftPct({ perArm: n, baselineRate: plan.baseline, alpha: plan.alpha, power: plan.power });
  const detectableText = (n) => {
    const d = detectable(n);
    return d == null ? 'no lift at all, even to a 100% rate' : `a lift of about ${d.toFixed(0)}% or more`;
  };
  const expected = plan.baseline * smallest;

  // 4. Too small to settle anything is its own answer, and the most common one on a real list.
  if (smallest < plan.need || expected < MIN_EXPECTED_CONVERSIONS) {
    const reasons = [];
    if (smallest < plan.need) reasons.push(`${thousands(plan.need)} recipients per arm are needed to detect a ${plan.minLift}% lift on a ${pct(plan.baseline)} baseline; the smaller arm has ${thousands(smallest)}`);
    if (expected < MIN_EXPECTED_CONVERSIONS) reasons.push(`the smaller arm expects ${expected.toFixed(1)} conversions at the baseline, under the floor of ${MIN_EXPECTED_CONVERSIONS}: too few for any verdict`);
    reasons.push(`at ${thousands(smallest)} per arm this test could only detect ${detectableText(smallest)}`);
    reasons.push(`no winner may be declared from it. The pre-registered default arm, "${plan.defaultArm}", stands.`);
    return {
      verdict: 'INSUFFICIENT_SAMPLE', headline: `VERDICT  INSUFFICIENT_SAMPLE — "${plan.defaultArm}" stands`,
      requiredPerArm: plan.need, smallestArm: smallest, expectedConversions: expected,
      detectableLiftPct: detectable(smallest), defaultArm: plan.defaultArm, reasons,
    };
  }

  // 5. The test itself: two-proportion z, pooled, two-sided. It is not exact, and this is by how much. Orders come
  //    in whole numbers, so its false-winner rate sways either side of alpha at every size. Exact enumeration under
  //    no difference, through analyse itself (pinned in the tests, marked *), puts it at 5.18%* at alpha 0.05 on the
  //    floor of 10 expected per arm and 5.30%* at 12; at alpha 0.10, 11.46%* with one arm 40% larger than the other
  //    (14,286 against 20,000). A scan from 10 to 60 expected per arm found, with arms within 5% of each other, at
  //    most 5.30% at 0.05, 10.41% at 0.10 and 0.96% at 0.01, and within 0.13 points of alpha from 20 expected up;
  //    arms far from equal reach 11.46% at 0.10 and 1.07% at 0.01. At the template's own plan (0.12%, 20,617 per
  //    arm) it is 4.92%*. The floor of 10 is not raised, because raising it would not make this exact (at 40
  //    expected it is still 5.05%); it is kept for what it does do, which is stop a verdict resting on a handful of
  //    orders.
  const pooled = (A.conversions + B.conversions) / (A.recipients + B.recipients);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / A.recipients + 1 / B.recipients));
  const z = se > 0 ? (B.rate - A.rate) / se : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  const rateLine = `conversion rate: ${A.name} ${pct(A.rate)} (${A.conversions}/${A.recipients}) vs ${B.name} ${pct(B.rate)} (${B.conversions}/${B.recipients}), p = ${pValue.toFixed(4)} at alpha ${plan.alpha.toFixed(2)}`;
  const moneyLine = `revenue per recipient: ${A.name} ${perRecipient(A.revenueCents, A.recipients)} (${usd(A.revenueCents)} total), ${B.name} ${perRecipient(B.revenueCents, B.recipients)} (${usd(B.revenueCents)} total)`;
  const base = { arms: parsed, z, pValue, requiredPerArm: plan.need, smallestArm: smallest, defaultArm: plan.defaultArm };

  if (!(pValue < plan.alpha)) {
    // 6. Not significant. Named for what it is: the list could not tell them apart, which is not evidence they
    //    are equal. The difference is the other arm minus the default, with Newcombe's 95% score interval, which
    //    keeps its width at 0 orders against 0.
    const D = parsed[plan.defaultIndex];
    const O = parsed[1 - plan.defaultIndex];
    const diff = O.rate - D.rate;
    const ci = differenceInterval(O.conversions, O.recipients, D.conversions, D.recipients);
    const pp = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}`;
    return {
      ...base, verdict: 'INCONCLUSIVE_DEFAULT', headline: `VERDICT  INCONCLUSIVE_DEFAULT — "${plan.defaultArm}" stands (pre-registered default)`,
      differenceCi95: ci, detectableLiftPct: detectable(smallest),
      reasons: [
        rateLine,
        `${O.name} minus ${D.name}: ${pp(diff)} points, 95% interval ${pp(ci[0])} to ${pp(ci[1])} points`,
        `at ${thousands(smallest)} per arm this test could detect ${detectableText(smallest)}; anything smaller would go unseen`,
        moneyLine,
        'this list could not tell them apart; it does not show they are equal',
        `the pre-registered default arm, "${plan.defaultArm}", stands`,
      ],
    };
  }

  // 7. Significant on conversion. Money is compared exactly, in cents, by cross-multiplication, so a tie is a tie
  //    and never a win for whichever arm is listed first. The arms are compared as objects, never by name.
  const winner = B.rate > A.rate ? B : A;
  const loser = winner === B ? A : B;
  const left = BigInt(A.revenueCents) * BigInt(B.recipients);
  const right = BigInt(B.revenueCents) * BigInt(A.recipients);
  const moneyWinner = left > right ? A : right > left ? B : null;
  const divergent = moneyWinner !== null && moneyWinner !== winner;
  const lift = loser.rate > 0 ? `${(((winner.rate - loser.rate) / loser.rate) * 100).toFixed(0)}%` : 'n/a (the other arm had no conversions)';
  const reasons = [
    rateLine,
    `${winner.name} over ${loser.name}: lift ${lift}; planned minimum lift (it sized the test) ${plan.minLift}%`,
    moneyLine,
    moneyWinner === null ? 'revenue per recipient is level' : `${moneyWinner.name} earns more per recipient`,
  ];
  if (divergent) {
    reasons.push(`${winner.name} wins on conversion but ${moneyWinner.name} earns more per recipient. Money decides, and money was not tested: no clear win. The pre-registered default arm, "${plan.defaultArm}", stands.`);
    return {
      ...base, verdict: 'NO_CLEAR_WIN', headline: `VERDICT  NO_CLEAR_WIN — "${plan.defaultArm}" stands`,
      winner: null, rateWinner: winner.name, moneyWinner: moneyWinner.name, divergent: true, reasons,
    };
  }
  return {
    ...base, verdict: 'WINNER', headline: `VERDICT  WINNER — ${winner.name}`,
    winner: winner.name, moneyWinner: moneyWinner === null ? null : moneyWinner.name, divergent: false, reasons,
  };
}

// ---------------------------------------------------------------- the pre-flight

/**
 * Can a list of this size settle the question at all? Pure: returns an object, prints nothing.
 * { verdict: 'BIG_ENOUGH' | 'TOO_SMALL' | 'INVALID', ok, headline, reasons, perArm, requiredPerArm, ... }
 */
export function preflight({ listSize, metric, baselineRate, minLiftPct = 100, alpha = 0.05, power = 0.8 } = {}) {
  const problems = [];
  const size = count(listSize);
  if (!(size >= 2)) problems.push('--list-size must be a whole number of recipients, 2 or more');
  const known = Object.hasOwn(BASELINES, String(metric)) ? BASELINES[metric] : null;
  if (!known) problems.push(`--metric must be one of ${Object.keys(BASELINES).join(', ')}`);
  let p = known?.rate;
  let source = known?.source;
  if (baselineRate !== undefined) {
    p = decimal(baselineRate);
    source = 'your own figure (--baseline-rate)';
    if (!(p > 0 && p < 1)) problems.push('--baseline-rate must be between 0 and 1');
  }
  const lift = decimal(minLiftPct);
  if (!(lift > 0)) problems.push('--min-lift must be a percentage above 0');
  const a = zFor(Z_TWO_SIDED, alpha);
  const b = zFor(Z_POWER, power);
  if (!a) problems.push(`--alpha must be one of ${levels(Z_TWO_SIDED)}`);
  if (!b) problems.push(`--power must be one of ${levels(Z_POWER)}`);
  const need = problems.length ? null : requiredPerArm({ baselineRate: p, minLiftPct: lift, alpha: a.level, power: b.level });
  if (!problems.length && need == null) problems.push(`a ${lift}% lift on a ${pct(p)} baseline would pass a 100% rate`);
  if (problems.length) return { verdict: 'INVALID', ok: false, headline: 'PRE-FLIGHT  INVALID', reasons: problems };

  // Big enough means big enough to plan: the planning figure already holds the expected-conversions floor and the
  // 5% that may bounce, so a list that clears it can be pre-registered and pass --check.
  const perArm = Math.floor(size / 2);
  const toPlan = planFor(need, p);
  const detectable = detectableLiftPct({ perArm, baselineRate: p, alpha: a.level, power: b.level });
  const expected = perArm * p;
  const bigEnough = perArm >= toPlan;
  const what = metric === 'orders' ? 'placed orders' : 'clicks';
  const reasons = [
    `baseline ${pct(p)} ${what} per recipient. Source: ${source}`,
    `to detect a ${lift}% lift at alpha ${a.level.toFixed(2)} and power ${b.level.toFixed(2)} you need ${thousands(need)} per arm`,
    `plan ${thousands(toPlan)} per arm (${thousands(toPlan * 2)} on the list): that holds the floor of ${MIN_EXPECTED_CONVERSIONS} expected ${what} and lets ${SHORTFALL * 100}% bounce`,
    `with ${thousands(perArm)} per arm you could only detect ${detectable == null ? 'no lift at all, even to a 100% rate' : `a lift of about ${detectable.toFixed(0)}% or more`}`,
    `expected ${what} per arm: ${expected.toFixed(1)}, against a floor of ${MIN_EXPECTED_CONVERSIONS}`,
    bigEnough
      ? `BIG ENOUGH: pre-register the rule with plannedPerArm at least ${thousands(toPlan)}, run --check, then send.`
      : 'TOO SMALL: do not run this as a decision. Send the cheaper arm (the one you would name as defaultArm) and stop.',
  ];
  return {
    verdict: bigEnough ? 'BIG_ENOUGH' : 'TOO_SMALL', ok: bigEnough,
    headline: `PRE-FLIGHT  a list of ${thousands(size)} splits into ${thousands(perArm)} per arm`,
    listSize: size, perArm, baselineRate: p, baselineSource: source, minLiftPct: lift,
    requiredPerArm: need, planPerArm: toPlan, detectableLiftPct: detectable, expectedPerArm: expected, floor: MIN_EXPECTED_CONVERSIONS, reasons,
  };
}

/** One shape for every result: a headline, then the reasons. */
export function format(r) {
  const lines = [r.headline ?? `VERDICT  ${r.verdict}`, ''];
  for (const x of r.reasons ?? []) lines.push(`  · ${x}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- command line

const MODES = new Set(['--preflight', '--check']);
const PREFLIGHT_VALUES = { '--list-size': 'listSize', '--metric': 'metric', '--baseline-rate': 'baselineRate', '--min-lift': 'minLiftPct', '--alpha': 'alpha', '--power': 'power' };
const FILE_VALUES = { '--file': 'file' };

/**
 * Read the command line against an allow-list. An unknown flag, a flag given twice, or a value flag with nothing
 * after it is refused, never skipped: `--baseline 0.0003` or a bare `--min-lift` used to fall back to the defaults
 * and could print BIG ENOUGH, exit 0, for a list that is TOO SMALL at the figures that were meant.
 * Returns { mode: 'preflight' | 'check' | 'analyse', values } or { error }.
 */
export function parseArgs(argv) {
  const modes = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (MODES.has(t)) {
      if (modes.has(t)) return { error: `${t} is given twice` };
      modes.add(t);
      continue;
    }
    const key = Object.hasOwn(PREFLIGHT_VALUES, t) ? PREFLIGHT_VALUES[t] : Object.hasOwn(FILE_VALUES, t) ? FILE_VALUES[t] : null;
    if (key === null) return { error: `unknown argument ${JSON.stringify(t)}` };
    if (Object.hasOwn(values, key)) return { error: `${t} is given twice` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${t} needs a value after it` };
    values[key] = v;
    i++;
  }
  const preflightOnly = Object.keys(PREFLIGHT_VALUES).filter((f) => Object.hasOwn(values, PREFLIGHT_VALUES[f]));
  if (modes.has('--preflight')) {
    if (modes.has('--check')) return { error: '--preflight and --check are different steps: run one at a time' };
    if (Object.hasOwn(values, 'file')) return { error: '--preflight reads no file: it runs before the experiment is written' };
    return { mode: 'preflight', values };
  }
  if (preflightOnly.length) return { error: `${preflightOnly.join(', ')} only go with --preflight` };
  if (!Object.hasOwn(values, 'file')) return { error: '--file is needed' };
  return { mode: modes.has('--check') ? 'check' : 'analyse', values };
}

/**
 * Exit 0 means "go": a WINNER, a pre-registration that passes, a list big enough to plan. 1 is a refusal, whatever
 * the reason. 2 is misuse. Anything this does not recognise is a refusal, never a go.
 */
export function exitCode(mode, verdict) {
  if (mode === 'preflight') return verdict === 'BIG_ENOUGH' ? 0 : verdict === 'TOO_SMALL' ? 1 : 2;
  if (mode === 'check') return verdict === 'PRE_REGISTERED' ? 0 : 1;
  return verdict === 'WINNER' ? 0 : 1;
}

const USAGE = [
  'usage: ab-test.mjs --preflight --list-size N --metric orders|clicks [--baseline-rate 0.0012] [--min-lift 100] [--alpha 0.05] [--power 0.80]',
  '       ab-test.mjs --check --file <experiment.json>',
  '       ab-test.mjs --file <experiment.json>',
].join('\n');

function readExperiment(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`cannot read ${file}: ${err.message}`);
    return undefined;
  }
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`${args.error}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (args.mode === 'preflight') {
    const r = preflight(args.values);
    if (r.verdict === 'INVALID') console.error(`${format(r)}\n\n${USAGE}`);
    else console.log(format(r));
    process.exitCode = exitCode('preflight', r.verdict);
  } else {
    const e = readExperiment(args.values.file);
    if (e === undefined) process.exitCode = 2;
    else {
      const r = args.mode === 'check' ? checkPreRegistration(e) : analyse(e);
      console.log(format(r));
      process.exitCode = exitCode(args.mode, r.verdict);
    }
  }
}
