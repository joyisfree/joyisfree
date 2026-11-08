#!/usr/bin/env node
// The desk's ledger: what was entered, won, claimed and realised, the minutes and fees it cost,
// the claims that are due, and the kill rule's verdict. One JSON line per event, appended, never edited.
//
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --space AIW3 --action entered --minutes 8 --fee 0.08
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --action won --amount 16.5 --deadline 2026-11-12   # the deadline comes from CLAIMING.md section 2
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --action claimed --fee 0.08 --gas 0.02 --minutes 2
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --action realised --amount 14.9
//   node galxe-desk/scripts/ledger.mjs status
//
// Actions: entered, won, claimed, realised, lost, flag. "flag" is any bot notice, odd approval prompt
// or restriction, and it stops the desk by itself.
//
// The lane's standing decision sits above the ledger. Leif refused questing as income on 31 Oct 2026, and until this
// file existed that verdict lived only in prose, so `status` printed CONTINUE and exited 0 on a lane he had closed.
// `status` now reads galxe-desk/decision.json: a refusal is STOP_DECISION (exit 2), it outranks CONTINUE and the
// numeric stops, and it never hides a recorded flag. A missing or unreadable decision is a stop too, never an open lane.
//
//   node galxe-desk/scripts/ledger.mjs status --decision PATH   # judge another decision file (the default sits beside scripts/)

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ACTIONS = new Set(['entered', 'won', 'claimed', 'realised', 'lost', 'flag']);
const DAY = 86_400_000;

// Found from this file, not from the working directory, so the same record is read wherever the command runs.
export const DECISION_FILE = fileURLToPath(new URL('../decision.json', import.meta.url));
export const LANE = 'galxe-questing';

export function parseLedger(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function validate(e) {
  if (!ACTIONS.has(e.action)) throw new Error(`unknown action ${e.action}`);
  if (!e.quest) throw new Error('quest id required');
  if (!e.ts || Number.isNaN(Date.parse(e.ts))) throw new Error('ts must be an ISO date');
  // A win's deadline must be a real date: a non-date (or a bare `--deadline` that args() turns into "true")
  // would give NaN, and `NaN < now` is false, so the claim would read as due for ever and never OVERDUE.
  if (e.action === 'won' && (!e.deadline || Number.isNaN(Date.parse(e.deadline)))) throw new Error('a win needs its claim deadline as a date (the windows are in rulebook/CLAIMING.md section 2)');
  return e;
}

export function status(entries, rules = {}, now = Date.now()) {
  const day30Min = Number(rules.day30MinRealisedUsd ?? 10);
  const minPerHour = Number(rules.minNetUsdPerHour ?? 15);
  const horizon = Number(rules.horizonDays ?? 90);
  const sum = (f) => entries.reduce((a, e) => a + (Number(f(e)) || 0), 0);
  const count = (a) => entries.filter((e) => e.action === a).length;

  const realisedUsd = sum((e) => (e.action === 'realised' ? e.amount : 0));
  const costsUsd = sum((e) => (Number(e.fee) || 0) + (Number(e.gas) || 0));
  const minutes = sum((e) => e.minutes);
  const netUsd = realisedUsd - costsUsd;
  const perHour = minutes > 0 ? netUsd / (minutes / 60) : null;

  const claimedQuests = new Set(entries.filter((e) => e.action === 'claimed').map((e) => e.quest));
  const due = [];
  const overdue = [];
  for (const e of entries.filter((x) => x.action === 'won')) {
    if (claimedQuests.has(e.quest)) continue;
    const dl = Date.parse(e.deadline);
    (dl < now ? overdue : due).push({ quest: e.quest, deadline: e.deadline });
  }

  const first = entries.length ? Math.min(...entries.map((e) => Date.parse(e.ts))) : null;
  // Calendar days in UTC: the day of the first entry is day 1, the next calendar day is day 2.
  const dayStart = (t) => Math.floor(t / DAY) * DAY;
  const day = first == null ? 0 : (dayStart(now) - dayStart(first)) / DAY + 1;
  const flags = entries.filter((e) => e.action === 'flag');

  let kill = 'CONTINUE';
  if (flags.length) kill = `STOP_FLAG: ${flags[flags.length - 1].note || 'flag recorded'}`;
  else if (day >= 30 && realisedUsd < day30Min) kill = `STOP_DAY30: realised $${realisedUsd.toFixed(2)} < $${day30Min}`;
  else if (day >= 60 && (perHour == null || perHour < minPerHour)) kill = `STOP_RATE: $${perHour == null ? '0.00' : perHour.toFixed(2)}/h < $${minPerHour}/h`;
  else if (day > horizon) kill = `HORIZON: day ${day} > ${horizon}, decide on the numbers`;

  return {
    day,
    entered: count('entered'),
    won: count('won'),
    claimed: count('claimed'),
    lost: count('lost'),
    realisedUsd,
    costsUsd,
    netUsd,
    minutes,
    netUsdPerHour: perHour,
    due,
    overdue,
    flags: flags.length,
    kill,
  };
}

/** Read the decision file. It never throws: a file that is missing or is not JSON comes back as the reason it failed. */
export function readDecision(path = DECISION_FILE) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (err) { return { error: `the decision record ${path} could not be read (${err.code || err.message})` }; }
  try { return { decision: JSON.parse(text) }; } catch (err) { return { error: `the decision record ${path} is not valid JSON (${err.message})` }; }
}

// A reopening is dated as a real calendar day, YYYY-MM-DD: never Date.parse alone, which reads 'Leif 1' as a date.
export const REFUSED_ON = '2026-10-31';
const isDay = (v) => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === v;
};
/** Today in Sydney, YYYY-MM-DD: the clock Leif lives on. */
export const sydneyToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now);
const reopenedWhen = (v, today) => isDay(v) && v > REFUSED_ON && v <= today;
const inWords = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The stop a decision imposes, or null when the lane is open. Only a well-formed reopening opens it: verdict REOPENED,
 * the date, and Leif's own words. A refusal, an unreadable file, another lane or a verdict not known here are all stops.
 */
export function decisionStop(read, today = sydneyToday()) {
  const d = read?.decision;
  if (read?.error) return `STOP_DECISION: ${read.error}, so the lane is treated as stopped`;
  if (d == null || typeof d !== 'object' || Array.isArray(d)) return 'STOP_DECISION: the decision record is not an object, so the lane is treated as stopped';
  if (d.lane !== LANE) return `STOP_DECISION: the decision record is for lane ${JSON.stringify(d.lane)}, not ${LANE}, so this lane is treated as stopped`;
  if (d.verdict === 'REFUSED') return `STOP_DECISION: refused ${d.decidedOn || '(no date recorded)'} (${d.record || 'no record named'}); reopens only if ${d.reopensOnlyIf || 'Leif reopens it in his own words'}`;
  if (d.verdict === 'REOPENED' && reopenedWhen(d.reopenedOn, today) && inWords(d.leifsWords)) return null;
  if (d.verdict === 'REOPENED') return `STOP_DECISION: a reopening needs reopenedOn as a date and leifsWords quoting Leif (the date as YYYY-MM-DD, after the ${REFUSED_ON} refusal and not after today in Sydney), so the lane is still treated as stopped`;
  return `STOP_DECISION: the decision record's verdict ${JSON.stringify(d.verdict)} is not REFUSED or REOPENED, so the lane is treated as stopped`;
}

/**
 * The ledger's status with the lane's decision applied. A recorded flag is never hidden: it stays the kill rule and
 * the decision is carried beside it. Otherwise a decision's stop outranks CONTINUE and the ledger's numeric stops.
 */
export function withDecision(s, stop) {
  const kill = s.flags > 0 ? s.kill : stop || s.kill;
  return { ...s, kill, decision: stop || null };
}

/** The claim clock on its own: what must be claimed, and what is already late. A won prize unclaimed is a prize lost. */
export function formatDue(s) {
  const lines = [];
  if (s.overdue.length) lines.push(`OVERDUE (claim window gone, check before anything else): ${s.overdue.map((d) => `${d.quest} (was ${d.deadline})`).join(', ')}`);
  if (s.due.length) lines.push(`Due: ${s.due.map((d) => `${d.quest} by ${d.deadline}`).join(', ')}`);
  if (!lines.length) lines.push('No claim is waiting. Nothing won is unclaimed.');
  return lines.join('\n');
}

export function format(s) {
  const ph = s.netUsdPerHour == null ? 'n/a' : `$${s.netUsdPerHour.toFixed(2)}/h`;
  const lines = [
    `Day ${s.day}: entered ${s.entered}, won ${s.won}, claimed ${s.claimed}, lost ${s.lost}, flags ${s.flags}`,
    `Realised $${s.realisedUsd.toFixed(2)}, costs $${s.costsUsd.toFixed(2)}, net $${s.netUsd.toFixed(2)} over ${s.minutes} min = ${ph}`,
    `Claims due: ${s.due.length ? s.due.map((d) => `${d.quest} by ${d.deadline}`).join(', ') : 'none'}`,
    `OVERDUE: ${s.overdue.length ? s.overdue.map((d) => `${d.quest} (was ${d.deadline})`).join(', ') : 'none'}`,
    `Kill rule: ${s.kill}`,
  ];
  if (s.decision && s.decision !== s.kill) lines.push(`Decision: ${s.decision}`);
  return lines.join('\n');
}

function args() {
  const out = {};
  const a = process.argv.slice(3);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const cmd = process.argv[2];
  const o = args();
  const file = o.file || 'galxe-desk/ledger/ledger.jsonl';
  if (cmd === 'add') {
    const e = validate({
      ts: o.ts || new Date().toISOString(),
      quest: o.quest,
      space: o.space,
      action: o.action,
      minutes: o.minutes ? Number(o.minutes) : undefined,
      fee: o.fee ? Number(o.fee) : undefined,
      gas: o.gas ? Number(o.gas) : undefined,
      amount: o.amount ? Number(o.amount) : undefined,
      deadline: o.deadline,
      note: o.note,
    });
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(e) + '\n');
    console.log(`recorded ${e.action} for ${e.quest}`);
  } else if (cmd === 'status' || cmd === 'due') {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const rules = o.account ? JSON.parse(readFileSync(o.account, 'utf8')).killRules : JSON.parse(readFileSync('galxe-desk/account.json', 'utf8')).killRules;
    const s = withDecision(status(parseLedger(text), rules), decisionStop(readDecision(o.decision || DECISION_FILE)));
    if (cmd === 'due') {
      console.log(formatDue(s));
      if (s.overdue.length) process.exitCode = 2;
    } else {
      console.log(format(s));
      if (s.kill !== 'CONTINUE') process.exitCode = 2;
    }
  } else {
    console.error('usage: ledger.mjs add --quest ID --action entered|won|claimed|realised|lost|flag [--minutes N --fee USD --gas USD --amount USD --deadline DATE --note TEXT]\n       ledger.mjs status [--file PATH --account PATH --decision PATH]\n       ledger.mjs due [--file PATH --account PATH]   # the claim clock only');
    process.exitCode = 1;
  }
}
