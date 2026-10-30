#!/usr/bin/env node
// The desk's ledger: what was entered, won, claimed and realised, the minutes and fees it cost,
// the claims that are due, and the kill rule's verdict. One JSON line per event, appended, never edited.
//
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --space AIW3 --action entered --minutes 8 --fee 0.08
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --action won --amount 16.5 --deadline 2026-11-12   # the deadline comes from CLAIMING.md section 2
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --action claimed --fee 0.08 --gas 0.02 --minutes 2
//   node galxe-desk/scripts/ledger.mjs add --quest GCPnQtZ2uL --action realised --amount 14.9
//   node galxe-desk/scripts/ledger.mjs add --quest GCvoyage1 --space PreToken --action position --lane voyage --points 300 --threshold 2000 --cutoff 2027-03-31 --minutes 8
//   node galxe-desk/scripts/ledger.mjs status
//
// Actions: entered, won, claimed, realised, lost, flag, position. "flag" is any bot notice, odd approval prompt
// or restriction, and it stops the desk by itself. "position" records Voyage-lane points against the project's
// threshold and cut-off; positions are not money until the tokens are sold and recorded as "realised".
// Entries carry a lane (cash by default, or voyage): the hourly kill rule judges the cash lane only.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const ACTIONS = new Set(['entered', 'won', 'claimed', 'realised', 'lost', 'flag', 'position']);
const DAY = 86_400_000;

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
  if (e.action === 'won' && !e.deadline) throw new Error('a win needs its claim deadline (the windows are in rulebook/CLAIMING.md section 2)');
  if (e.action === 'position') {
    if (!Number.isFinite(Number(e.points)) || e.points == null) throw new Error('a position needs its points');
    if (!e.cutoff || Number.isNaN(Date.parse(e.cutoff))) throw new Error("a position needs the project's cut-off date");
  }
  if (e.lane != null && !['cash', 'voyage'].includes(e.lane)) throw new Error('lane must be cash or voyage');
  return e;
}

export function status(entries, rules = {}, now = Date.now()) {
  const day30Min = Number(rules.day30MinRealisedUsd ?? 10);
  const minPerHour = Number(rules.minNetUsdPerHour ?? 15);
  const horizon = Number(rules.horizonDays ?? 90);
  const sum = (f) => entries.reduce((a, e) => a + (Number(f(e)) || 0), 0);
  const count = (a) => entries.filter((e) => e.action === a).length;

  const isVoyage = (e) => e.lane === 'voyage' || e.action === 'position';
  const realisedUsd = sum((e) => (e.action === 'realised' ? e.amount : 0));
  const costsUsd = sum((e) => (Number(e.fee) || 0) + (Number(e.gas) || 0));
  const minutes = sum((e) => (isVoyage(e) ? 0 : e.minutes)); // the cash lane's minutes; the hourly rule judges these
  const voyageMinutes = sum((e) => (isVoyage(e) ? e.minutes : 0));
  const netUsd = realisedUsd - costsUsd;
  const perHour = minutes > 0 ? netUsd / (minutes / 60) : null;

  // Voyage positions: the latest entry per quest; open while its cut-off has not passed.
  const latest = new Map();
  for (const e of entries.filter((x) => x.action === 'position')) latest.set(e.quest, e);
  const positions = [...latest.values()].map((e) => ({ quest: e.quest, points: Number(e.points), threshold: e.threshold ?? null, cutoff: e.cutoff, open: Date.parse(e.cutoff) >= now }));
  const openPositions = positions.filter((p) => p.open).length;

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
  else if (day >= 30 && realisedUsd < day30Min) {
    const why = `realised ${realisedUsd.toFixed(2)} < ${day30Min}`;
    kill = openPositions ? `CASH_STOP_DAY30: ${why}; ${openPositions} voyage position(s) continue while the panel finds their evidence still holds` : `STOP_DAY30: ${why}`;
  } else if (day >= 60 && (perHour == null || perHour < minPerHour)) {
    const why = `${perHour == null ? '0.00' : perHour.toFixed(2)}/h < ${minPerHour}/h`;
    kill = openPositions ? `CASH_STOP_RATE: ${why}; ${openPositions} voyage position(s) continue while the panel finds their evidence still holds` : `STOP_RATE: ${why}`;
  }
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
    voyageMinutes,
    positions,
    openPositions,
    netUsdPerHour: perHour,
    due,
    overdue,
    flags: flags.length,
    kill,
  };
}

export function format(s) {
  const ph = s.netUsdPerHour == null ? 'n/a' : `$${s.netUsdPerHour.toFixed(2)}/h`;
  const lines = [
    `Day ${s.day}: entered ${s.entered}, won ${s.won}, claimed ${s.claimed}, lost ${s.lost}, flags ${s.flags}`,
    `Realised $${s.realisedUsd.toFixed(2)}, costs $${s.costsUsd.toFixed(2)}, net $${s.netUsd.toFixed(2)} over ${s.minutes} min = ${ph}`,
    `Claims due: ${s.due.length ? s.due.map((d) => `${d.quest} by ${d.deadline}`).join(', ') : 'none'}`,
    `OVERDUE: ${s.overdue.length ? s.overdue.map((d) => `${d.quest} (was ${d.deadline})`).join(', ') : 'none'}`,
    `Voyage positions: ${s.positions && s.positions.length ? s.positions.map((p) => `${p.quest} ${p.points}/${p.threshold ?? '?'} pts by ${p.cutoff}${p.open ? '' : ' (closed)'}`).join(', ') : 'none'}${s.voyageMinutes ? ` (${s.voyageMinutes} min)` : ''}`,
    `Kill rule: ${s.kill}`,
  ];
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
      lane: o.lane,
      points: o.points != null ? Number(o.points) : undefined,
      threshold: o.threshold != null ? (o.threshold === 'none' ? 'none' : Number(o.threshold)) : undefined,
      cutoff: o.cutoff,
    });
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(e) + '\n');
    console.log(`recorded ${e.action} for ${e.quest}`);
  } else if (cmd === 'status') {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const rules = o.account ? JSON.parse(readFileSync(o.account, 'utf8')).killRules : JSON.parse(readFileSync('galxe-desk/account.json', 'utf8')).killRules;
    const s = status(parseLedger(text), rules);
    console.log(format(s));
    if (s.kill !== 'CONTINUE') process.exitCode = 2;
  } else {
    console.error('usage: ledger.mjs add --quest ID --action entered|won|claimed|realised|lost|flag|position [--lane cash|voyage --minutes N --fee USD --gas USD --amount USD --deadline DATE --points N --threshold N --cutoff DATE --note TEXT]\n       ledger.mjs status [--file PATH --account PATH]');
    process.exitCode = 1;
  }
}
