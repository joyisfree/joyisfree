#!/usr/bin/env node
// The positive-move verdict, as arithmetic instead of a feeling. Part of the `joy-revise` skill, section 5.
//
//   node .claude/skills/joy-revise/scripts/worth-it.mjs --file decision.json
//   node .claude/skills/joy-revise/scripts/worth-it.mjs --payoff 500 --probability 0.2 --costs 25 \
//        --hours 10 --hourly-bar 25 --haircut 0.5 --cheapest-test "email the existing list first" \
//        --kill-metric "realised dollars" --kill-number 100 --kill-by 2026-12-31 \
//        [--days-to-first-dollar 14] [--decided-on 2026-11-08] [--currency AUD] [--config PATH]
//
// It answers PURSUE, REFUSE or CANNOT_VALUE. It is built to refuse rather than to guess, because the failure it
// exists to prevent is a plan that looks profitable only because something was quietly treated as zero.
//
// Why the dates, the test and the bar are stricter than they were (8 Nov 2026, audit C5 and C9). The gate read
// `--kill-by 1` as 1 Jan 2001, because Date.parse guesses, took `--cheapest-test x` as a test, and returned PURSUE with
// exit 0. And the $15/h bar every verdict rested on was never Leif's choice. So now:
//   - a date is YYYY-MM-DD and nothing else, round-trip checked, so 2026-11-31 is refused rather than rolled into December;
//   - the kill date must fall after today in Sydney, and no more than 180 days after it: a stop that has already come,
//     or is half a year away, stops nothing;
//   - a decision may carry decidedOn (never in the future), and is then judged on that day, so a committed record still
//     reproduces its own verdict later; once its kill date has gone it can still say no, but it can never say yes;
//   - the cheapest test needs four different words, not digits alone, or is one command that exists here
//     (`npm run orders` is a whole test in three; `npm run nothing-here` and `node x.mjs` are not), and a placeholder
//     such as TBD or "to be decided" is refused, as is a kill rule that cannot fire: a number of 0 or below, no metric;
//   - a number is a number, or a string written as one. Number() reads " ", [] and [""] as 0, so a blank or a list is
//     refused. Hours of 0 are refused like a bar of 0; a 0 typed for costs, capital or the first dollar is a real 0;
//   - daysToFirstDollar is optional, a whole number of days, reported as stated and never guessed;
//   - the hourly bar is stored once, in joy.config.json at the repo root. It is used only when a decision gives no
//     bar, with a line saying it is a default and not Leif's choice. A stored bar that cannot be read, or that is in
//     another currency than the decision, refuses rather than falls back. A bar of 0 is refused: his time is never free.
//
// decision.json shape (every money figure in the same currency, every unknown named):
// {
//   "name": "the plan in a few words",
//   "decidedOn": "2026-11-08",  // optional: the day it was decided, which the kill date is measured from (default today)
//   "currency": "AUD",          // optional: checked against the stored bar's currency when the bar is left out
//   "payoff": 500,              // realised value if it works — the median, never the headline
//   "probability": 0.2,         // 0..1, honest chance it works at all
//   "haircut": 0.5,             // 0..1 multiplier on anything unlaunched, vesting, promised or uncertain
//   "costs": 25,                // money out: fees, gas, deposits, subscriptions
//   "capitalAtRisk": 0,         // money that could be lost outright, counted in full
//   "hours": 10,                // Leif's hours, above 0
//   "hourlyBar": 25,            // what an hour of his time must earn; left out, the stored default is used and said so
//   "daysToFirstDollar": 14,    // optional: whole days to the first realised dollar
//   "unknowns": [],             // any named unknown refuses the whole thing
//   "cheapestTest": "...",      // the one check that would change the answer: four different words, or a real command
//   "killRule": { "metric": "realised dollars", "number": 100, "by": "2026-12-31" }  // the number above 0
// }

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERDICTS = new Set(['PURSUE', 'REFUSE', 'CANNOT_VALUE']);

// Found from this file, not from the working directory, so the same bar is read wherever the command runs.
export const CONFIG_FILE = fileURLToPath(new URL('../../../../joy.config.json', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const MAX_KILL_DAYS = 180;
export const MIN_TEST_WORDS = 4;
const DAY = 86_400_000;

const NUMERIC = [
  ['payoff', 'the realised value if it works'],
  ['probability', 'the honest chance it works'],
  ['costs', 'money out'],
  ['hours', "Leif's hours"],
  ['hourlyBar', 'what an hour of his time must earn'],
];

// A decimal written out. Number() reads " ", "\t", [] and [""] as 0 and [500] as 500; none of them is a number here.
const DECIMAL = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i;

/** A field is only a number if it really is one: a missing field, "unknown", a blank or a list is never zero. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string' || !DECIMAL.test(v)) return NaN;
  return Number(v);
}

const inWords = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * YYYY-MM-DD and nothing else, round-trip checked, as a whole day number (days since 1970-01-01), or null.
 * Date.parse reads "1" as 1 Jan 2001 and "Nov 9" as 9 Nov 2001, and rolls 2026-11-31 into December: all refused here.
 */
export function strictDate(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) return null;
  return ms / DAY;
}

/** A day number written back as YYYY-MM-DD. */
export const dayText = (day) => new Date(day * DAY).toISOString().slice(0, 10);

/** Today's calendar date in Sydney as a day number, or null when this machine cannot tell (the gate then refuses). */
export function sydneyDay(now = Date.now()) {
  try {
    const parts = {};
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
    for (const p of fmt.formatToParts(new Date(now))) parts[p.type] = p.value;
    return strictDate(`${parts.year}-${parts.month}-${parts.day}`);
  } catch {
    return null;
  }
}

/**
 * Check a parsed config's stored hourly bar. Returns { bar } or { error }; it never throws and never fills a gap.
 * The bar must carry its currency and say whose number it is and why, so the verdict can print both.
 */
export function checkHourlyBar(cfg, source = CONFIG_FILE) {
  const b = cfg?.hourlyBar;
  const where = basename(source);
  if (b == null || typeof b !== 'object' || Array.isArray(b)) return { error: `${where} has no hourlyBar object` };
  if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0) return { error: `hourlyBar.amount in ${where} is not a positive number` };
  if (typeof b.currency !== 'string' || !/^[A-Z]{3}$/.test(b.currency)) return { error: `hourlyBar.currency in ${where} is not a three-letter code such as AUD` };
  if (!inWords(b.status) || !inWords(b.why)) return { error: `hourlyBar in ${where} must say whose number it is (status) and why` };
  return { bar: { amount: b.amount, currency: b.currency, status: b.status.trim(), why: b.why.trim(), source: where } };
}

/** Read and check the stored hourly bar. A file that is missing or is not JSON comes back as the reason it failed. */
export function readHourlyBar(path = CONFIG_FILE) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (err) { return { error: `${basename(String(path)) || 'the config'} could not be read (${err.code || err.message})` }; }
  try { return checkHourlyBar(JSON.parse(text), path); } catch (err) { return { error: `${basename(path)} is not valid JSON (${err.message})` }; }
}

// Words carry letters or digits, a word said twice counts once, and digits alone are not a test: "- -- --- ----",
// "TBD TBD TBD TBD" and "1 2 3 4" are not four words, while "check 20 abandoned checkouts" is.
const words = (s) => {
  const counted = s.toLowerCase().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return /\p{L}/u.test(s) ? new Set(counted).size : 0;
};
// A named command is decisive however short it is, `npm run orders` is a whole test, but only when it is the whole
// test and is real here: a script in package.json, or a file in the repo.
const COMMAND = /^`?(?:npm (?:run )?([\w:.-]+)|node ([\w./-]+\.m?js))(?:\s[^`]*)?`?$/;
const namesCommand = (s) => {
  const m = COMMAND.exec(s.trim());
  if (!m) return false;
  if (m[2] !== undefined) return existsSync(join(REPO, m[2]));
  try { return Object.hasOwn(JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts ?? {}, m[1]); } catch { return false; }
};
// Obvious placeholders only: this does not judge prose, it refuses a test or a stop that says it is not decided yet.
const PLACEHOLDER = /\b(?:tbd|tba|tbc|todo|placeholder)\b|\bn\/a\b|\bto be (?:decided|determined|confirmed|agreed)\b|^\W*no (?:test|check)\b/i;

/**
 * Judge one decision. Returns { verdict, reasons, notes, evUsd, timeCostUsd, netUsd, perHourUsd, daysToFirstDollar,
 * cannotValue }. CANNOT_VALUE wins over everything: an unpriceable decision is not a cheap decision.
 * `now` is injectable so a test can stand on any day; `defaultBar` is what readHourlyBar() returned, used only when
 * the decision gives no hourlyBar.
 */
export function worthIt(d = {}, { now = Date.now(), defaultBar } = {}) {
  const cannot = [];
  const notes = [];
  const unpriced = (reasons) => ({
    verdict: 'CANNOT_VALUE', reasons, notes, evUsd: null, timeCostUsd: null, netUsd: null, perHourUsd: null, daysToFirstDollar: null, cannotValue: true,
  });

  // 1. Named unknowns refuse outright. This is the whole point: the plan must say what it does not know.
  const unknowns = Array.isArray(d.unknowns) ? d.unknowns.filter((u) => String(u ?? '').trim()) : [];
  if (!Array.isArray(d.unknowns)) cannot.push('unknowns must be a list (write [] to say there are none)');
  for (const u of unknowns) cannot.push(`unknown: ${u}`);

  // 2. The hourly bar: the decision's own, or else the stored default, said out loud. Never a silent fallback.
  let bar = d.hourlyBar;
  if (bar === undefined && defaultBar) {
    const { bar: stored, error } = defaultBar;
    if (error) cannot.push(`hourlyBar was not given and the stored default cannot be used: ${error}`);
    else if (d.currency !== undefined && d.currency !== stored.currency) cannot.push(`hourlyBar was not given, and the stored default is in ${stored.currency} while this decision is in ${d.currency}: give the bar in ${d.currency}`);
    else {
      bar = stored.amount;
      notes.push(`hourly bar ${stored.currency} ${stored.amount}/h, read from ${stored.source} (${stored.status}; ${stored.why}); every money figure here is read as ${stored.currency}`);
    }
  }

  // 3. Every number must be a real number, in range.
  const v = {};
  for (const [key, what] of NUMERIC) {
    v[key] = num(key === 'hourlyBar' ? bar : d[key]);
    if (!Number.isFinite(v[key])) cannot.push(`${key} is not a number (${what})`);
    else if (v[key] < 0) cannot.push(`${key} cannot be negative`);
  }
  if (v.hourlyBar === 0) cannot.push("hourlyBar is 0: an hour of Leif's time is never free, and a zero bar passes anything");
  if (v.hours === 0) cannot.push('hours is 0: every plan takes some of his time, at least the sitting that decides it, and zero hours zero the time cost as a zero bar would');
  if (Number.isFinite(v.probability) && (v.probability < 0 || v.probability > 1)) {
    cannot.push('probability must be between 0 and 1');
  }
  const haircut = d.haircut === undefined ? 1 : num(d.haircut);
  if (!Number.isFinite(haircut) || haircut < 0 || haircut > 1) cannot.push('haircut must be between 0 and 1 (1 means no haircut)');
  const capital = d.capitalAtRisk === undefined ? 0 : num(d.capitalAtRisk);
  if (!Number.isFinite(capital) || capital < 0) cannot.push('capitalAtRisk is not a number (write 0 if none is at risk)');
  let days = null;
  if (d.daysToFirstDollar !== undefined) {
    const n = num(d.daysToFirstDollar);
    if (!Number.isInteger(n) || n < 0) cannot.push('daysToFirstDollar must be a whole number of days (leave it out when nobody knows: "unknown" is not zero)');
    else days = n;
  }

  // 4. The discipline that made the good decisions good: a test that would change the answer, and a stop.
  if (!String(d.cheapestTest ?? '').trim()) {
    cannot.push('cheapestTest is missing: name the one check that would change the answer, and do it before spending');
  } else if (typeof d.cheapestTest !== 'string' || (words(d.cheapestTest) < MIN_TEST_WORDS && !namesCommand(d.cheapestTest))) {
    cannot.push(`cheapestTest ${JSON.stringify(d.cheapestTest)} is under ${MIN_TEST_WORDS} words and names no command: say what is checked and how, or name the command that checks it`);
  } else if (PLACEHOLDER.test(d.cheapestTest)) {
    cannot.push(`cheapestTest ${JSON.stringify(d.cheapestTest)} is a placeholder, not a test: decide the check before the verdict, not after`);
  }

  // 5. The dates. Today is Sydney's calendar day; a decision dated in the past is judged on the day it was decided.
  const today = sydneyDay(now);
  if (today == null) cannot.push("today's date in Sydney could not be read, so no kill date can be checked against it");
  let asOf = today;
  let anchored = false;
  if (d.decidedOn !== undefined) {
    const dec = strictDate(d.decidedOn);
    if (dec == null) cannot.push(`decidedOn must be a date written YYYY-MM-DD (got ${JSON.stringify(d.decidedOn)})`);
    else if (today != null && dec > today) cannot.push(`decidedOn ${d.decidedOn} is after today in Sydney (${dayText(today)}): a decision cannot be dated in the future`);
    else { asOf = dec; anchored = true; }
  }
  const k = d.killRule ?? {};
  const killNumber = num(k.number);
  let by = null;
  if (!String(k.metric ?? '').trim() || !Number.isFinite(killNumber) || !String(k.by ?? '').trim()) {
    cannot.push('killRule needs a metric, a number and a date: a plan with no point at which it stops is not a plan');
  } else {
    if (killNumber <= 0) cannot.push(`killRule.number is ${killNumber}: "${k.metric} under ${killNumber}" can never fire on a count or on realised dollars; write the smallest result that would justify carrying on`);
    if (PLACEHOLDER.test(k.metric) || !/\p{L}{2}/u.test(k.metric)) cannot.push(`killRule.metric ${JSON.stringify(k.metric)} is a placeholder: name what is counted, such as realised dollars or orders`);
    by = strictDate(k.by);
    const from = asOf == null ? '' : `${dayText(asOf)}, ${anchored ? 'the day it was decided' : 'today in Sydney'}`;
    if (by == null) cannot.push(`killRule.by must be a date written YYYY-MM-DD (got ${JSON.stringify(k.by)}): a bare number, a slash date or a month name is read by guesswork`);
    else if (asOf != null && by <= asOf) cannot.push(`killRule.by ${k.by} is not after ${from}: a stop that has already come stops nothing`);
    else if (asOf != null && by - asOf > MAX_KILL_DAYS) cannot.push(`killRule.by ${k.by} is ${by - asOf} days after ${from}, more than ${MAX_KILL_DAYS}: a stop half a year away is not a stop`);
  }

  if (cannot.length) return unpriced(cannot);

  // 6. The arithmetic. Realised value, haircut, then every cost including his time and anything at risk.
  const evUsd = v.payoff * v.probability * haircut;
  const timeCostUsd = v.hours * v.hourlyBar;
  const netUsd = evUsd - v.costs - timeCostUsd - capital;
  const perHourUsd = (evUsd - v.costs - capital) / v.hours; // hours above 0 is checked in step 3

  // 7. A past decision whose stop has gone is reproduced, never re-approved: it can still say no, never yes.
  const expired = by <= today;
  if (expired && netUsd >= 0) {
    return unpriced([`killRule.by ${k.by} has passed (today in Sydney is ${dayText(today)}): a past decision can be reproduced, never approved again; judge it afresh with a new kill date`]);
  }
  if (expired) notes.push(`this reproduces the verdict of ${d.decidedOn}; its kill date ${k.by} has passed, so it approves nothing today`);

  const reasons = [
    `expected realised value $${evUsd.toFixed(2)} = $${v.payoff.toFixed(2)} x ${v.probability} chance x ${haircut} haircut`,
    `against $${v.costs.toFixed(2)} costs, $${timeCostUsd.toFixed(2)} of time (${v.hours} h at $${v.hourlyBar}/h)${capital > 0 ? `, $${capital.toFixed(2)} at risk` : ''}`,
    `returns $${perHourUsd.toFixed(2)} an hour against a $${v.hourlyBar} bar`,
  ];
  if (days != null) reasons.push(`first realised dollar expected in ${days} day${days === 1 ? '' : 's'} (as stated, not computed)`);
  reasons.push(netUsd >= 0
    ? `net $${netUsd.toFixed(2)}: it clears, so it is worth a bounded try with the kill rule set`
    : `net $${netUsd.toFixed(2)}: it does not clear, and the hours are the largest cost`);

  return { verdict: netUsd >= 0 ? 'PURSUE' : 'REFUSE', reasons, notes, evUsd, timeCostUsd, netUsd, perHourUsd, daysToFirstDollar: days, cannotValue: false };
}

export function format(d, r) {
  const lines = [`VERDICT  ${r.verdict}${d.name ? ` — ${d.name}` : ''}`, ''];
  for (const x of r.reasons) lines.push(`  ${r.cannotValue ? 'gap' : '·'} ${x}`);
  for (const n of r.notes ?? []) lines.push(`  note ${n}`);
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
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  // A flag given with no value is not a flag left out: it comes back empty, and an empty field is never a number.
  return v !== undefined && !v.startsWith('--') ? v : '';
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const file = arg('file');
  const unknownsArg = arg('unknowns');
  const d = file ? JSON.parse(readFileSync(file, 'utf8')) : {
    name: arg('name'),
    decidedOn: arg('decided-on'),
    currency: arg('currency'),
    payoff: arg('payoff'),
    probability: arg('probability'),
    haircut: arg('haircut'),
    costs: arg('costs'),
    capitalAtRisk: arg('capital-at-risk'),
    hours: arg('hours'),
    hourlyBar: arg('hourly-bar'),
    daysToFirstDollar: arg('days-to-first-dollar'),
    // Left out means none named; given empty is not a list.
    unknowns: unknownsArg === undefined ? [] : unknownsArg ? unknownsArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    cheapestTest: arg('cheapest-test'),
    killRule: { metric: arg('kill-metric'), number: arg('kill-number'), by: arg('kill-by') },
  };
  const config = arg('config');
  const r = worthIt(d, { defaultBar: readHourlyBar(config === undefined ? CONFIG_FILE : config) });
  console.log(format(d, r));
  process.exitCode = r.verdict === 'PURSUE' ? 0 : 1;
}
