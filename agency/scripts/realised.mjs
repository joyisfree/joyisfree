#!/usr/bin/env node
// The realised-dollar record: what each play really brought in, read from the store's own orders export and credited
// to a play only through that play's own code. The export and the plays file are only read; nothing is written.
//
//   node agency/scripts/realised.mjs --file export.csv --plays agency/plays.json
//
// Exit 0 on a report, 1 on a refusal, 2 on misuse.
//
// Why this exists (master plan item 11, 8 Nov 2026). The 6 Feb panel judges each play on realised dollars per Leif
// hour and stops any leg under the bar, and nothing measured that: orders.mjs reads an export for the baseline, and the
// desk's ledger is Galxe's. Worse, the plays overlap in time. The threshold and gift cards start 10 Nov, the flows
// 12 Nov, the gift guide 20 Nov and the gift-with-purchase 27 Nov (the audit's own finding), so an order's date says
// nothing about which play brought it, and crediting by window would hand every play every order in its dates. So a
// dollar is credited to a play only when the order carries that play's own code, in the export's Discount Code column,
// on a day inside the play's window. Never by date alone.
//
// plays.json is a list, one object per play, and every key is checked (a misspelt key is refused, never ignored):
// [
//   { "play": "Gift guide", "from": "2026-11-20", "to": "2026-11-30", "codes": ["GUIDE10"], "hours": 2 },
//   { "play": "Abandoned checkout", "from": "2026-11-12", "to": "2027-01-05", "codes": [],
//     "holdout": { "controlShare": 0.1, "count": 2 } }
// ]
//   play: its name; from and to: the window's first and last day, YYYY-MM-DD, both inside it; codes: its discount or
//   creator codes ([] only for a play measured by a holdout); hours: optional, Leif's hours on it; holdout: optional,
//   the share held out of it and how many people that was.
//
// The defaults chosen, each the stricter reading (change them here, deliberately):
//   - a code is matched after trimming, ignoring case. A code in plays.json is 2 to 32 letters, digits, - or _ (the
//     creator pilot's rule), so a code with a comma or a space, which the export's cell could not hold apart, is refused;
//   - a code shared by two plays is refused whatever their windows, and so is a code named twice. An order carrying the
//     codes of two plays is credited to neither, and shown; a code no play names is counted, never credited;
//   - a play's code on an order outside the play's window is not credited, and is counted under the play;
//   - an order's day is the store's own calendar date as the export writes it (calendarDay in orders.mjs), so no time
//     zone is assumed, and the window's from and to are compared with that date;
//   - realised is the Subtotal less the Refunded Amount, never below 0, on paid orders only. The whole refund is
//     charged against the goods, even the part that may have been shipping, so realised errs low. A refunded order
//     realises 0. Pending, authorised and part-paid orders are counted but realise nothing yet, because the money is not
//     in hand; voided, expired, cancelled and failed orders, and any order with a "Cancelled at" date, realise nothing;
//   - the refunded share is of the paid subtotal (paid less realised, over paid). With nothing paid it is unknown, not 0%;
//   - dollars per Leif hour are given only when plays.json gives hours, a number above 0. None given is unknown, not 0;
//   - a window that starts before the export's first order, or ends on or after its last order's day, is INCOMPLETE,
//     and its dollars are "at least". An export ends when it was taken, so its last order's day may not have been over:
//     only an order on a later day shows a window's last day was. A window wholly outside the export, or a play with no
//     code, has no realised figure at all: a dollar this export cannot see is unknown, never zero;
//   - a holdout credits no dollar here. Telling the held-out buyers from the rest needs customer identities, which this
//     never reads. It is checked and shown, and its lift is read from the flow's own report;
//   - only Shopify's orders export is read, because it is the one whose Discount Code column is known by name. Another
//     store's export is refused, never guessed at;
//   - every refusal of orders.mjs is a refusal here: the export goes through orders.mjs's own analyse() first. The one
//     exception is its refusal to give a median from under 30 orders, because a sum of real orders is not an estimate.
//     That refusal is passed over only when it is the sole reason and the order count in it matches the count made
//     here; otherwise it stands. An export with no orders at all is refused.
//
// Privacy: the Email column is never read, and nothing printed holds a cell from the export except money, dates and the
// currency code. A code no play names is counted, never printed, because it may be a one-off code made for one buyer.
// Any output that would hold an "@" is replaced by a refusal before it is printed.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CsvError, MIN_ORDERS, STATUS, analyse, calendarDay, moneyCents, parseCsv, resolveColumns } from './orders.mjs';

/** The export's column that holds an order's discount or creator code, as Shopify names it. */
export const CODE_COLUMN = 'Discount Code';
const MAX_LISTED = 10;

const PLAY_KEYS = new Set(['play', 'from', 'to', 'codes', 'holdout', 'hours']);
const HOLDOUT_KEYS = new Set(['controlShare', 'count']);
/** The creator pilot's rule for a code, read after normCode. */
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
/** A play's name: up to 80 characters, no "@" and no control characters, so it is safe to print. */
const NAME_SHAPE = /^[^\p{Cc}@]{1,80}$/u;

/**
 * Each status orders.mjs knows, by whether its money is in hand. paid: it is (a refund still comes off it). awaiting:
 * the order is counted, and realises nothing until it is paid. void: it never will. Anything not plainly paid is
 * awaiting. A status orders.mjs learns later and this table does not class is refused, never guessed.
 */
export const MONEY = Object.freeze({
  paid: 'paid', partially_refunded: 'paid', refunded: 'paid', completed: 'paid',
  pending: 'awaiting', authorized: 'awaiting', authorised: 'awaiting', partially_paid: 'awaiting', processing: 'awaiting', on_hold: 'awaiting',
  voided: 'void', expired: 'void', cancelled: 'void', canceled: 'void', failed: 'void',
});

/** One spelling of a code: trimmed, upper-cased. Applied to the plays file and to the export's cell alike. */
export const normCode = (c) => c.trim().toUpperCase();

/** YYYY-MM-DD and nothing else, round-trip checked, so 2026-11-31 is refused rather than rolled into December. */
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && calendarDay(v) === v;

/** A key or a status is echoed only when it is plainly a word, so nothing else from a file reaches the screen. */
const shown = (raw) => (typeof raw === 'string' && /^[A-Za-z _-]{1,30}$/.test(raw) ? `"${raw}"` : 'an unreadable value');

function capped(reasons) {
  const listed = reasons.slice(0, MAX_LISTED);
  if (reasons.length > MAX_LISTED) listed.push(`and ${reasons.length - MAX_LISTED} more like these`);
  return listed;
}
const refused = (reasons) => ({ verdict: 'REFUSED', reasons: capped(reasons) });

// ---------------------------------------------------------------- the plays file

/**
 * Check a parsed plays.json. Returns { plays } with each code in its one spelling, or { problems }. Nothing is filled
 * in: a missing or misspelt field, a date that is not a date, hours that are not a positive number, a code shared by
 * two plays and a play that no dollar could ever be credited to are each refused by name.
 */
export function checkPlays(value) {
  if (!Array.isArray(value)) return { problems: ['a list of plays is needed, each { "play", "from", "to", "codes" }, and this is not a list'] };
  if (!value.length) return { problems: ['no play is listed, so there is nothing to credit a dollar to'] };
  const problems = [];
  const plays = [];
  const names = new Map();
  const owner = new Map();
  value.forEach((p, i) => {
    let at = `play ${i + 1}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      problems.push(`${at} is not an object`);
      return;
    }
    for (const k of Object.keys(p)) if (!PLAY_KEYS.has(k)) problems.push(`${at} has the key ${shown(k)}, which this does not know (${[...PLAY_KEYS].join(', ')}): a misspelt key would be ignored, so it is refused`);
    const name = typeof p.play === 'string' ? p.play.trim() : '';
    if (!NAME_SHAPE.test(name)) problems.push(`${at} needs its name in "play": up to 80 characters, with no "@" and no control characters`);
    else {
      at = `${at} ("${name}")`;
      const key = name.toLowerCase();
      if (names.has(key)) problems.push(`${at} has the same name as play ${names.get(key) + 1}: two plays of one name cannot be told apart in the report`);
      else names.set(key, i);
    }
    if (!isDay(p.from)) problems.push(`${at}: "from" must be the window's first day, written YYYY-MM-DD`);
    if (!isDay(p.to)) problems.push(`${at}: "to" must be the window's last day, written YYYY-MM-DD`);
    else if (isDay(p.from) && p.to < p.from) problems.push(`${at}: the window ends on ${p.to}, before it starts on ${p.from}`);
    const codes = [];
    if (!Array.isArray(p.codes)) problems.push(`${at}: "codes" must be a list of its discount or creator codes ([] only for a play measured by a holdout)`);
    else {
      for (const c of p.codes) {
        const n = typeof c === 'string' ? normCode(c) : '';
        if (!CODE_SHAPE.test(n)) problems.push(`${at}: each code must be 2 to 32 letters, digits, - or _ (the creator pilot's rule), so the export's cell can hold it apart`);
        else if (codes.includes(n)) problems.push(`${at} names the code ${n} twice`);
        else if (owner.has(n)) problems.push(`the code ${n} is named by play ${owner.get(n) + 1} and by ${at}: a code shared by two plays cannot say which one an order came from`);
        else {
          owner.set(n, i);
          codes.push(n);
        }
      }
    }
    let holdout;
    if (p.holdout !== undefined) {
      const h = p.holdout;
      if (!h || typeof h !== 'object' || Array.isArray(h)) problems.push(`${at}: "holdout" must be { "controlShare", "count" }`);
      else {
        for (const k of Object.keys(h)) if (!HOLDOUT_KEYS.has(k)) problems.push(`${at}: the holdout has the key ${shown(k)}, which this does not know (${[...HOLDOUT_KEYS].join(', ')})`);
        if (!(typeof h.controlShare === 'number' && h.controlShare > 0 && h.controlShare < 1)) problems.push(`${at}: holdout.controlShare must be the share held out, a number between 0 and 1 (0.1 for 10%)`);
        if (!(Number.isInteger(h.count) && h.count >= 1)) problems.push(`${at}: holdout.count must be how many people were held out, a whole number, 1 or more`);
        holdout = { controlShare: h.controlShare, count: h.count };
      }
    }
    if (Array.isArray(p.codes) && p.codes.length === 0 && holdout === undefined) problems.push(`${at} has no code and no holdout, so no dollar could ever be credited to it`);
    if (p.hours !== undefined && !(typeof p.hours === 'number' && Number.isFinite(p.hours) && p.hours > 0)) problems.push(`${at}: "hours" must be Leif's hours on it, a number above 0; leave it out when nobody knows, because unknown is not zero`);
    plays.push({ play: name, from: p.from, to: p.to, codes, hours: p.hours, holdout });
  });
  return problems.length ? { problems: capped(problems) } : { plays };
}

// ---------------------------------------------------------------- one order

/** What one order realised, in cents: the subtotal less the refund, never below 0, and only once the money is in hand. */
export function realisedCents(o) {
  if (o.money !== 'paid') return 0;
  if (o.status === 'refunded') return 0;
  return Math.max(0, o.subtotal - o.refunded);
}

/**
 * Which play, if any, one order is credited to. Only a code on the order can credit it, so an order with no code is
 * unattributed whatever its date. Returns { bucket } with bucket one of credited, outside, contested, other, unattributed,
 * and the play (or, when contested, the plays) its codes belong to.
 */
export function attribute(o, byCode) {
  if (!o.codes.length) return { bucket: 'unattributed' };
  const owners = [...new Set(o.codes.map((c) => byCode.get(c)).filter((p) => p !== undefined))];
  if (!owners.length) return { bucket: 'other' };
  if (owners.length > 1) return { bucket: 'contested', plays: owners };
  const [play] = owners;
  if (o.day < play.from || o.day > play.to) return { bucket: 'outside', play };
  return { bucket: 'credited', play };
}

/**
 * How much of a play's window the export's orders span: full, partial (its dollars are "at least") or none. A window
 * ending on the export's last order day is partial: the export may have been taken before that day was over.
 */
export function coverage(play, span) {
  if (play.to < span.first || play.from > span.last) return 'none';
  if (play.from < span.first || play.to >= span.last) return 'partial';
  return 'full';
}

// ---------------------------------------------------------------- the export

/** orders.mjs's refusal to give a median from under 30 orders, the one refusal this does not take as its own. */
const FEW = /^only (\d+) orders count towards order value\b/;
const fewOrdersOnly = (reasons) => {
  if (!Array.isArray(reasons) || reasons.length !== 1) return undefined;
  const m = FEW.exec(reasons[0]);
  return m ? Number(m[1]) : undefined;
};

const READ = ['created', 'currency', 'status', 'subtotal', 'refunded', 'cancelled', 'code'];
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * Read one export against one plays file (as parsed JSON). Returns { verdict: 'REPORT', report } or
 * { verdict: 'REFUSED', reasons }. Money is whole cents in the export's one currency; shares are fractions of 1; a
 * figure that cannot be known is null, never 0. `gate` is orders.mjs's analyse, injectable only so a test can show
 * that this file's own checks hold even when that gate lets something through.
 */
export function realise(text, playsValue, { gate = analyse } = {}) {
  const checked = checkPlays(playsValue);
  if (checked.problems) return refused(checked.problems.map((x) => `the plays file: ${x}`));
  const { plays } = checked;

  let records;
  try {
    records = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) return refused([`the file is not valid CSV: ${err.message}`]);
    throw err;
  }
  const isBlank = (row) => row.length === 1 && row[0].trim() === '';
  if (!records.length || isBlank(records[0])) return refused(['the file has no header row on its first line']);
  const cols = resolveColumns(records[0]);
  if (cols.source !== 'shopify') return refused([`this does not look like Shopify's orders export (it has no Lineitem name, Lineitem quantity or Financial Status column): only Shopify's is read, because its ${CODE_COLUMN} column is known by name, and another store's export is refused rather than guessed at`]);
  if (cols.problems.length) return refused(cols.problems);
  const lower = records[0].map((h) => h.trim().toLowerCase());
  const codeAt = [];
  lower.forEach((h, i) => { if (h === CODE_COLUMN.toLowerCase()) codeAt.push(i); });
  if (codeAt.length !== 1) {
    return refused([codeAt.length
      ? `the column "${CODE_COLUMN}" appears ${codeAt.length} times, so which one holds an order's code cannot be told`
      : `the export has no "${CODE_COLUMN}" column, so no order can be credited to any play: export the orders with their discount codes`]);
  }

  // Every refusal of orders.mjs is a refusal here, but its refusal of a median from under 30 orders. few is null when
  // orders.mjs gave a report, the count it names when that refusal was its only one, and undefined for any other.
  const base = gate(text);
  const few = base.verdict === 'REPORT' ? null : fewOrdersOnly(base.reasons);
  if (base.verdict !== 'REPORT' && few === undefined) return refused(base.reasons ?? ['orders.mjs refused the export']);

  const at = { ...cols.at, code: codeAt[0] };
  const label = { ...cols.names, code: CODE_COLUMN };
  const width = records[0].length;
  const orders = new Map();
  const problems = [];
  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    if (isBlank(row)) continue;
    if (row.length !== width) {
      problems.push(`row ${r + 1} does not have the header's ${width} fields`);
      continue;
    }
    const id = row[at.id].trim();
    if (id === '' || id.includes('@')) {
      problems.push(`row ${r + 1} has no order number that can be read`);
      continue;
    }
    let o = orders.get(id);
    if (!o) {
      o = { id, values: {} };
      orders.set(id, o);
    }
    for (const f of READ) {
      if (at[f] === undefined) continue;
      const v = row[at[f]].trim();
      if (v === '') continue;
      const had = o.values[f];
      if (had === undefined) o.values[f] = { v, row: r + 1 };
      else if (had.v !== v) problems.push(`order ${id} carries two different ${label[f]} values (rows ${had.row} and ${r + 1}): two orders share one ${label.id}, or the export is damaged`);
    }
  }

  const parsed = [];
  for (const o of orders.values()) {
    const val = (f) => o.values[f]?.v;
    const subtotal = moneyCents(val('subtotal'));
    const refunded = moneyCents(val('refunded'));
    const day = calendarDay(val('created'));
    const currency = (val('currency') ?? '').toUpperCase();
    if (!Number.isFinite(subtotal) || !Number.isFinite(refunded) || day === undefined || !/^[A-Z]{3}$/.test(currency)) {
      problems.push(`order ${o.id}: its subtotal, refund, date or currency cannot be read here, so nothing is credited from this export`);
    }
    const raw = val('status');
    const status = raw === undefined ? undefined : raw.toLowerCase().split(/[\s-]+/).join('_');
    const state = status !== undefined && Object.hasOwn(MONEY, status) ? MONEY[status] : undefined;
    if (state === undefined) problems.push(`order ${o.id}: whether the money is in hand for the status ${shown(raw)} has not been decided here, so it is refused rather than guessed`);
    const cancelled = val('cancelled') !== undefined;
    const money = cancelled ? 'void' : state;
    const codes = [...new Set((val('code') ?? '').split(',').map(normCode).filter(Boolean))];
    parsed.push({ id: o.id, subtotal, refunded, day, currency, status, cancelled, money, codes });
  }
  if (problems.length) return refused(problems);
  if (!parsed.length) return refused(['the export holds no orders: no dollar can be credited, and nothing can be said about any window. Export the period the plays ran in']);
  const currencies = [...new Set(parsed.map((o) => o.currency))].sort();
  if (currencies.length > 1) return refused([`the export mixes currencies (${currencies.join(', ')}): a sum of unlike money means nothing. Export one currency at a time`]);

  // The under-30 refusal is passed over only when its count is the count made here, from the same rule.
  const counted = parsed.filter((o) => Object.hasOwn(STATUS, o.status) && STATUS[o.status] === true && !o.cancelled).length;
  if (typeof few === 'number' && few !== counted) return refused(base.reasons);

  const byCode = new Map();
  for (const p of plays) for (const c of p.codes) byCode.set(c, p);
  const days = parsed.map((o) => o.day).sort();
  const span = { first: days[0], last: days[days.length - 1] };

  const buckets = {};
  for (const b of ['credited', 'unattributed', 'other', 'outside', 'contested']) buckets[b] = { orders: 0, realisedCents: 0 };
  const perPlay = new Map(plays.map((p) => [p, { credited: [], outside: 0, contested: 0 }]));
  for (const o of parsed) {
    const a = attribute(o, byCode);
    buckets[a.bucket].orders++;
    buckets[a.bucket].realisedCents += realisedCents(o);
    if (a.bucket === 'credited') perPlay.get(a.play).credited.push(o);
    else if (a.bucket === 'outside') perPlay.get(a.play).outside++;
    else if (a.bucket === 'contested') for (const p of a.plays) perPlay.get(p).contested++;
  }

  const rows = plays.map((p) => {
    const { credited, outside, contested } = perPlay.get(p);
    const cover = coverage(p, span);
    const measured = p.codes.length > 0 && cover !== 'none';
    const head = { play: p.play, from: p.from, to: p.to, codes: p.codes, hours: p.hours, holdout: p.holdout, coverage: cover, measured, outside, contested };
    if (!measured) {
      return { ...head, orders: null, paid: null, awaiting: null, void: null, paidCents: null, realisedCents: null, refundedOrders: null, refundedShare: null, perHourCents: null };
    }
    const paid = credited.filter((o) => o.money === 'paid');
    const paidCents = sum(paid.map((o) => o.subtotal));
    const realised = sum(credited.map(realisedCents));
    return {
      ...head,
      orders: credited.length,
      paid: paid.length,
      awaiting: credited.filter((o) => o.money === 'awaiting').length,
      void: credited.filter((o) => o.money === 'void').length,
      paidCents,
      realisedCents: realised,
      refundedOrders: paid.filter((o) => realisedCents(o) < o.subtotal).length,
      refundedShare: paidCents > 0 ? (paidCents - realised) / paidCents : null,
      perHourCents: p.hours !== undefined ? Math.round(realised / p.hours) : null,
    };
  });

  return {
    verdict: 'REPORT',
    report: {
      source: 'shopify',
      currency: currencies[0],
      orders: parsed.length,
      realisedCents: sum(parsed.map(realisedCents)),
      span,
      fewerThanMin: typeof few === 'number',
      buckets,
      plays: rows,
    },
  };
}

// ---------------------------------------------------------------- what is printed

export function format(r) {
  const m = (c) => `${r.currency} ${(c / 100).toFixed(2)}`;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const line = (b) => `${n(b.orders, 'order')}, ${m(b.realisedCents)} realised`;
  const b = r.buckets;
  const lines = [
    `REALISED  ${n(r.orders, 'order')} in Shopify's orders export, ${r.span.first} to ${r.span.last}, in ${r.currency}: ${m(r.realisedCents)} realised in all`,
    `  credited to a play, by its own code inside its window: ${line(b.credited)}`,
    `  no code, so unattributed whatever its date: ${line(b.unattributed)}`,
    `  a code no play names (counted, never printed): ${line(b.other)}`,
    `  a play's code outside that play's window, not credited: ${line(b.outside)}`,
    `  the codes of two plays on one order, credited to neither: ${line(b.contested)}`,
    '  realised is the subtotal (goods, before shipping) less refunds, on paid orders only; pending and voided orders realise nothing',
  ];
  if (r.fewerThanMin) lines.push(`  under ${MIN_ORDERS} orders count towards order value, so orders.mjs gives no median here; these are sums of real orders, not estimates`);
  for (const p of r.plays) {
    lines.push('', `PLAY  ${p.play}  ${p.from} to ${p.to}  ${p.codes.length ? `${p.codes.length > 1 ? 'codes' : 'code'} ${p.codes.join(', ')}` : 'no code'}`);
    if (!p.codes.length) {
      lines.push('  it carries no code, so this export can credit it no dollar: its realised dollars are unknown here');
    } else if (p.coverage === 'none') {
      lines.push(`  NOT COVERED: the export's orders run ${r.span.first} to ${r.span.last}, wholly outside this window, so its dollars are unknown: export its dates`);
    } else {
      const least = p.coverage === 'partial' ? 'at least ' : '';
      lines.push(`  ${n(p.orders, 'order')} credited: ${p.paid} paid, ${p.awaiting} awaiting payment, ${p.void} voided or cancelled`);
      lines.push(`  realised ${least}${m(p.realisedCents)} of ${m(p.paidCents)} paid${p.refundedShare === null ? '; nothing paid yet, so no refunded share' : `; refunded share ${pct(p.refundedShare)}, on ${n(p.refundedOrders, 'order')}`}`);
      lines.push(p.perHourCents === null ? '  per Leif hour: unknown, because the plays file gives no hours for it' : `  ${least}${m(p.perHourCents)} per Leif hour, over ${p.hours} h`);
      if (p.coverage === 'partial') lines.push(`  INCOMPLETE: the window runs ${p.from} to ${p.to} and the export's orders run ${r.span.first} to ${r.span.last}; if the export stopped short, or was taken before ${r.span.last} was over, orders are missing`);
    }
    if (p.outside) lines.push(`  ${n(p.outside, 'more order')} carried its code outside the window: not credited`);
    if (p.contested) lines.push(`  ${n(p.contested, 'more order')} carried its code and another play's: credited to neither`);
    if (p.holdout) lines.push(`  holdout: ${n(p.holdout.count, 'person', 'people')} held out (${pct(p.holdout.controlShare)}). It credits no dollar here: telling held-out buyers from the rest needs customer identities, which this never reads, so the lift is read from the flow's own report`);
  }
  return lines.join('\n');
}

const formatRefusal = (reasons, head = 'no dollar is credited') => [`REFUSED  ${head}, because:`, ...reasons.map((x) => `  - ${x}`)].join('\n');

// ---------------------------------------------------------------- the command line

const USAGE = [
  'usage: realised.mjs --file export.csv --plays agency/plays.json',
  '  exit 0 on a report, 1 on a refusal, 2 on misuse',
].join('\n');

const FLAGS = { '--file': 'file', '--plays': 'plays' };

/** Read the command line against an allow-list. An unknown argument, a flag given twice or with no value is misuse. */
export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!Object.hasOwn(FLAGS, t)) return { error: `unknown argument ${JSON.stringify(t)}` };
    const k = FLAGS[t];
    if (Object.hasOwn(o, k)) return { error: `${t} is given twice` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--') || v.trim() === '') return { error: `${t} needs a value after it` };
    o[k] = v;
    i++;
  }
  if (!o.file) return { error: "--file is needed (the store's orders export, as CSV)" };
  if (!o.plays) return { error: '--plays is needed (the plays file, a JSON list of plays)' };
  return o;
}

const PRIVACY = 'REFUSED  nothing is printed: the output would have held an at sign, which may be part of an email address.';

/** The last gate before anything reaches a screen: an "@" anywhere replaces the output with a refusal, and 0 becomes 1. */
export function privacyGate(code, stdout, stderr) {
  if (`${stdout}${stderr}`.includes('@')) return { code: code === 0 ? 1 : code, stdout: '', stderr: PRIVACY };
  return { code, stdout, stderr };
}

/** The whole command, as { code, stdout, stderr }. */
export function cli(argv) {
  const a = parseArgs(argv);
  if (a.error) return privacyGate(2, '', `${a.error}\n\n${USAGE}`);
  let text;
  try {
    text = readFileSync(a.file, 'utf8');
  } catch {
    return privacyGate(2, '', `cannot read ${a.file}: --file needs the store's orders export, as CSV\n\n${USAGE}`);
  }
  let raw;
  try {
    raw = readFileSync(a.plays, 'utf8');
  } catch {
    return privacyGate(2, '', `cannot read ${a.plays}: --plays needs the plays file, a JSON list of plays\n\n${USAGE}`);
  }
  let plays;
  try {
    plays = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return privacyGate(1, '', formatRefusal(['the plays file is not readable JSON']));
  }
  const r = realise(text, plays);
  if (r.verdict !== 'REPORT') return privacyGate(1, '', formatRefusal(r.reasons));
  return privacyGate(0, format(r.report), '');
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const r = cli(process.argv.slice(2));
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  process.exitCode = r.code;
}
