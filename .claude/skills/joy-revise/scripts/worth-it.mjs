#!/usr/bin/env node
// The positive-move verdict, as arithmetic instead of a feeling. Part of the `joy-revise` skill, section 5.
//
//   node .claude/skills/joy-revise/scripts/worth-it.mjs --file decision.json
//   node .claude/skills/joy-revise/scripts/worth-it.mjs --payoff 500 --probability 0.2 --costs 25 \
//        --hours 10 --hourly-bar 15 --haircut 0.5 --cheapest-test "email the existing list first" \
//        --kill-metric "realised dollars" --kill-number 100 --kill-by 2026-12-31
//
// It answers PURSUE, REFUSE or CANNOT_VALUE. It is built to refuse rather than to guess, because the failure it
// exists to prevent is a plan that looks profitable only because something was quietly treated as zero.
//
// decision.json shape (every money figure in the same currency, every unknown named):
// {
//   "name": "the plan in a few words",
//   "payoff": 500,            // realised value if it works — the median, never the headline
//   "probability": 0.2,       // 0..1, honest chance it works at all
//   "haircut": 0.5,           // 0..1 multiplier on anything unlaunched, vesting, promised or uncertain
//   "costs": 25,              // money out: fees, gas, deposits, subscriptions
//   "capitalAtRisk": 0,       // money that could be lost outright, counted in full
//   "hours": 10,              // Leif's hours
//   "hourlyBar": 15,          // what an hour of his time must earn
//   "unknowns": [],           // any named unknown refuses the whole thing
//   "cheapestTest": "...",    // the one check that would change the answer
//   "killRule": { "metric": "realised dollars", "number": 100, "by": "2026-12-31" }
// }

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const VERDICTS = new Set(['PURSUE', 'REFUSE', 'CANNOT_VALUE']);

const NUMERIC = [
  ['payoff', 'the realised value if it works'],
  ['probability', 'the honest chance it works'],
  ['costs', 'money out'],
  ['hours', "Leif's hours"],
  ['hourlyBar', 'what an hour of his time must earn'],
];

/** A field is only a number if it really is one: a missing field or the string "unknown" is never zero. */
function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'boolean') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Judge one decision. Returns { verdict, reasons, evUsd, timeCostUsd, netUsd, perHourUsd, cannotValue }.
 * CANNOT_VALUE wins over everything: an unpriceable decision is not a cheap decision.
 */
export function worthIt(d = {}) {
  const cannot = [];

  // 1. Named unknowns refuse outright. This is the whole point: the plan must say what it does not know.
  const unknowns = Array.isArray(d.unknowns) ? d.unknowns.filter((u) => String(u ?? '').trim()) : [];
  if (!Array.isArray(d.unknowns)) cannot.push('unknowns must be a list (write [] to say there are none)');
  for (const u of unknowns) cannot.push(`unknown: ${u}`);

  // 2. Every number must be a real number, in range.
  const v = {};
  for (const [key, what] of NUMERIC) {
    v[key] = num(d[key]);
    if (!Number.isFinite(v[key])) cannot.push(`${key} is not a number (${what})`);
    else if (v[key] < 0) cannot.push(`${key} cannot be negative`);
  }
  if (Number.isFinite(v.probability) && (v.probability < 0 || v.probability > 1)) {
    cannot.push('probability must be between 0 and 1');
  }
  const haircut = d.haircut === undefined ? 1 : num(d.haircut);
  if (!Number.isFinite(haircut) || haircut < 0 || haircut > 1) cannot.push('haircut must be between 0 and 1 (1 means no haircut)');
  const capital = d.capitalAtRisk === undefined ? 0 : num(d.capitalAtRisk);
  if (!Number.isFinite(capital) || capital < 0) cannot.push('capitalAtRisk is not a number (write 0 if none is at risk)');

  // 3. The discipline that made the good decisions good: a test that would change the answer, and a stop.
  if (!String(d.cheapestTest ?? '').trim()) {
    cannot.push('cheapestTest is missing: name the one check that would change the answer, and do it before spending');
  }
  const k = d.killRule ?? {};
  const killNumber = num(k.number);
  if (!String(k.metric ?? '').trim() || !Number.isFinite(killNumber) || !String(k.by ?? '').trim()) {
    cannot.push('killRule needs a metric, a number and a date: a plan with no point at which it stops is not a plan');
  } else if (Number.isNaN(Date.parse(k.by))) {
    cannot.push('killRule.by must be a date');
  }

  if (cannot.length) {
    return { verdict: 'CANNOT_VALUE', reasons: cannot, evUsd: null, timeCostUsd: null, netUsd: null, perHourUsd: null, cannotValue: true };
  }

  // 4. The arithmetic. Realised value, haircut, then every cost including his time and anything at risk.
  const evUsd = v.payoff * v.probability * haircut;
  const timeCostUsd = v.hours * v.hourlyBar;
  const netUsd = evUsd - v.costs - timeCostUsd - capital;
  const perHourUsd = v.hours > 0 ? (evUsd - v.costs - capital) / v.hours : null;

  const reasons = [
    `expected realised value $${evUsd.toFixed(2)} = $${v.payoff.toFixed(2)} x ${v.probability} chance x ${haircut} haircut`,
    `against $${v.costs.toFixed(2)} costs, $${timeCostUsd.toFixed(2)} of time (${v.hours} h at $${v.hourlyBar}/h)${capital > 0 ? `, $${capital.toFixed(2)} at risk` : ''}`,
  ];
  if (perHourUsd != null) reasons.push(`returns $${perHourUsd.toFixed(2)} an hour against a $${v.hourlyBar} bar`);
  reasons.push(netUsd >= 0
    ? `net $${netUsd.toFixed(2)}: it clears, so it is worth a bounded try with the kill rule set`
    : `net $${netUsd.toFixed(2)}: it does not clear, and the hours are the largest cost`);

  return { verdict: netUsd >= 0 ? 'PURSUE' : 'REFUSE', reasons, evUsd, timeCostUsd, netUsd, perHourUsd, cannotValue: false };
}

export function format(d, r) {
  const lines = [`VERDICT  ${r.verdict}${d.name ? ` — ${d.name}` : ''}`, ''];
  for (const x of r.reasons) lines.push(`  ${r.cannotValue ? 'missing' : '·'} ${x}`);
  lines.push('');
  if (r.cannotValue) {
    lines.push('  An unpriceable decision is not a cheap decision. Fill the gaps above, or refuse it.');
  } else {
    lines.push(`  CHEAPEST TEST  ${d.cheapestTest}`);
    lines.push(`  KILL RULE      ${d.killRule.metric} under ${d.killRule.number} by ${d.killRule.by} stops this`);
  }
  return lines.join('\n');
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const file = arg('file');
  const d = file ? JSON.parse(readFileSync(file, 'utf8')) : {
    name: arg('name'),
    payoff: arg('payoff'),
    probability: arg('probability'),
    haircut: arg('haircut'),
    costs: arg('costs'),
    capitalAtRisk: arg('capital-at-risk'),
    hours: arg('hours'),
    hourlyBar: arg('hourly-bar'),
    unknowns: arg('unknowns') ? arg('unknowns').split(',').map((s) => s.trim()).filter(Boolean) : [],
    cheapestTest: arg('cheapest-test'),
    killRule: { metric: arg('kill-metric'), number: arg('kill-number'), by: arg('kill-by') },
  };
  const r = worthIt(d);
  console.log(format(d, r));
  process.exitCode = r.verdict === 'PURSUE' ? 0 : 1;
}
