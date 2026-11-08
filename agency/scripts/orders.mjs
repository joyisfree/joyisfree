#!/usr/bin/env node
// The store's own orders, read once: the average order value from before the pilot, the spread of order values, the
// order volume and the accepts-marketing count, all from one CSV export of the last 90 days. The export is only read;
// the one write is --write-aov, into a pilot.json that already exists.
//
//   node agency/scripts/orders.mjs --file export.csv
//   node agency/scripts/orders.mjs --file export.csv --write-aov --pilot agency/pilot/pilot.json
//   node agency/scripts/orders.mjs --file other.csv --map "id=Order,created=Date,currency=Currency,status=Status,marketing=Opt in,subtotal=Goods,shipping=Postage,total=Paid,refunded=Refunded"
//
// Exit 0 on a report (and on a write), 1 on a refusal, 2 on misuse.
//
// Why this exists: that one export unblocks four plays, and each needs a figure that must not be guessed. The creator
// pilot needs the average order value from BEFORE it starts, the denominator a creator must not be able to move; the
// free-shipping threshold needs the spread of order values; the retention flows need the order volume; the list needs
// how many buyers accept marketing. A spreadsheet gives all four, and it can also quietly count a line item as an
// order, average two currencies, take a voided order for a sale, or read a blank as zero. Each of those is refused
// here by name, and nothing is estimated: every figure is a real order's value, or plain arithmetic on them.
//
// Shopify's orders export has one row per line item. The order's own fields (status, money, currency, marketing) sit
// on the first row of each order, and later rows of the same Name leave them blank. So rows are grouped by Name and
// each order-level field is taken from the row that carries it. A later row carrying a different value is refused
// (two orders sharing a Name, or a damaged file), never picked between. Any other store's export is read with --map.
//
// The defaults chosen, each the stricter reading (change them here, deliberately):
//   - the median and every percentile are nearest-rank: always a real order's value in whole cents, and for an even
//     count the lower of the two middle orders, which keeps the pilot's denominator on the low, stricter side;
//   - voided, refunded, expired, cancelled and failed orders, and any order with a "Cancelled at" date, are counted as
//     orders but kept out of every value figure; pending and authorised orders are in, because the basket was chosen;
//   - a partly refunded order counts at its full subtotal, and its refund shows in the refunds line;
//   - the threshold is the p80 subtotal rounded up to a multiple of 5 (a p80 already on one stays), so at most 20% of
//     orders are above it, and an order qualifies at or above it;
//   - fewer than 30 orders that count towards value gives no figures at all, not rough ones;
//   - accepts-marketing is counted per order, not per customer: counting customers would need the email, and this
//     file never reads it;
//   - the date span is the store's own calendar dates as written in the export, so no time zone is assumed;
//   - --write-aov writes only into a pilot whose startDate is a real date after now, from orders all before it, and
//     only from a USD export, because the field is baselineAovUsd.
//
// Privacy: the Email column is never read, and nothing returned or printed holds a cell from the file except order
// numbers, dates, currency codes and money. An order-number column holding "@" is refused (it would merge a
// customer's orders into one), and any output that would contain "@" is replaced by a refusal before it is printed
// and before the pilot write behind it is committed.

import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;
/** Below this many orders that count towards value, a median, a p80 and a threshold are unreliable, so none is given. */
export const MIN_ORDERS = 30;
const STEP_CENTS = 500;
const MAX_LISTED = 10;

/** The fields every export must name. `cancelled` is optional: when present, a date in it keeps the order out. */
export const FIELDS = ['id', 'created', 'currency', 'status', 'marketing', 'subtotal', 'shipping', 'total', 'refunded'];
export const OPTIONAL_FIELDS = ['cancelled'];
const ORDER_LEVEL = [...FIELDS, ...OPTIONAL_FIELDS].filter((f) => f !== 'id');
const MONEY_FIELDS = ['subtotal', 'shipping', 'total', 'refunded'];

const WHAT = {
  id: 'the order number, which tells one order from its line items',
  created: 'the order date',
  currency: 'the currency code',
  status: 'the payment status, which tells voided, cancelled and refunded orders from sales',
  marketing: 'whether the buyer accepts marketing',
  subtotal: 'the goods value before shipping',
  shipping: 'the shipping charged',
  total: 'the order total',
  refunded: 'the amount refunded',
  cancelled: 'the cancellation date',
};

/** Shopify's orders export, by its own column names. */
export const SHOPIFY = Object.freeze({
  id: 'Name', created: 'Created at', currency: 'Currency', status: 'Financial Status', marketing: 'Accepts Marketing',
  subtotal: 'Subtotal', shipping: 'Shipping', total: 'Total', refunded: 'Refunded Amount', cancelled: 'Cancelled at',
});
const SHOPIFY_SIGNS = ['Lineitem name', 'Lineitem quantity', 'Financial Status'];

/** Every status this knows. true: a sale, in the value figures. false: counted as an order, kept out of every value. */
export const STATUS = Object.freeze({
  paid: true, partially_paid: true, partially_refunded: true, pending: true, authorized: true, authorised: true,
  completed: true, processing: true, on_hold: true,
  voided: false, refunded: false, expired: false, cancelled: false, canceled: false, failed: false,
});
const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

// ---------------------------------------------------------------- RFC 4180, strictly

export class CsvError extends Error {}

/**
 * RFC 4180 CSV to an array of records (arrays of strings). Quoted fields may hold commas, line breaks and doubled
 * quotes; records end in CRLF or LF; a leading UTF-8 BOM is dropped; a last record with no line break still counts.
 * Anything malformed throws a CsvError naming the line, because a broken quote silently shifts money between columns:
 * a quote never closed, a quote inside an unquoted field, text after a closing quote, a carriage return on its own.
 */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new CsvError('the file is not text');
  const records = [];
  let record = [];
  let field = '';
  let state = 'start'; // start | bare | quoted | closed
  let line = 1;
  let openedOn = 0;
  const endField = () => { record.push(field); field = ''; state = 'start'; };
  const endRecord = () => { endField(); records.push(record); record = []; line++; };
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else state = 'closed';
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (state !== 'start') throw new CsvError(`line ${line} has a quote inside a field that did not start with one`);
      state = 'quoted';
      openedOn = line;
    } else if (c === ',') endField();
    else if (c === '\r') {
      if (text[i + 1] !== '\n') throw new CsvError(`line ${line} ends in a carriage return with no line feed after it`);
      i++;
      endRecord();
    } else if (c === '\n') endRecord();
    else if (state === 'closed') throw new CsvError(`line ${line} has text after a closing quote`);
    else { field += c; state = 'bare'; }
  }
  if (state === 'quoted') throw new CsvError(`the quoted field opened on line ${openedOn} is never closed`);
  if (state !== 'start' || field !== '' || record.length) endRecord();
  return records;
}

// ---------------------------------------------------------------- strict values: unknown is never zero

/** Money to whole cents: a plain amount, 0 or more, at most two decimals. Blank, "N/A", "1,200", "-5", "$5" and "84.505" are NaN. */
export function moneyCents(v) {
  if (typeof v !== 'string') return NaN;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return NaN;
  const c = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(c) ? c : NaN;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?: ?(?:Z|UTC|[+-]\d{2}:?\d{2}))?)?$/;

/**
 * The calendar day an order was placed, as the store wrote it: "2026-08-10", "2026-08-10 14:23:05 +1000" (Shopify)
 * or an ISO time. Year first only, because 03/04/2026 cannot be told from 04/03/2026. Round-trip checked, so
 * 2026-02-30 is refused rather than read as 2 March. Returns "YYYY-MM-DD" or undefined.
 */
export function calendarDay(v) {
  if (typeof v !== 'string') return undefined;
  const m = DATE.exec(v.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const back = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return undefined;
  if (h !== undefined && (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59)) return undefined;
  return `${y}-${mo}-${d}`;
}

/** The pilot's own rule (creator-pilot.mjs): YYYY-MM-DD, or a full ISO time with an explicit Z or offset. NaN otherwise. */
function strictTime(v) {
  if (typeof v !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(v);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  const back = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return NaN;
  if (h !== undefined && (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59)) return NaN;
  return Date.parse(v);
}

/** Nearest-rank percentile of an ascending list: always one of its own values, never an interpolation. NaN when empty. */
export function nearestRank(sorted, pct) {
  if (!sorted.length) return NaN;
  const rank = Math.ceil((pct * sorted.length) / 100);
  return sorted[Math.max(rank, 1) - 1];
}

/** The free-shipping threshold: the p80 subtotal rounded up to the next multiple of 5 (in cents, 500). */
export const thresholdCents = (p80Cents) => Math.ceil(p80Cents / STEP_CENTS) * STEP_CENTS;

/** A status is echoed only when it is plainly a word, so a mis-mapped column can never put a customer's data on screen. */
const shown = (raw) => (/^[A-Za-z _-]{1,30}$/.test(raw) ? `"${raw}"` : 'an unreadable value');

function refused(reasons) {
  const listed = reasons.slice(0, MAX_LISTED);
  if (reasons.length > MAX_LISTED) listed.push(`and ${reasons.length - MAX_LISTED} more like these`);
  return { verdict: 'REFUSED', reasons: listed };
}

// ---------------------------------------------------------------- which column holds what

/**
 * Find each field's column. With no map the export must be Shopify's (it carries a Lineitem or Financial Status
 * column); with a map, every field must be named. A missing column, one that appears twice, or two fields read from
 * the same column are refused by name. Returns { problems, at, names, source }.
 */
export function resolveColumns(header, map) {
  const lower = header.map((h) => h.trim().toLowerCase());
  let want;
  let source;
  if (map) {
    want = map;
    source = 'map';
  } else if (SHOPIFY_SIGNS.some((s) => lower.includes(s.toLowerCase()))) {
    want = SHOPIFY;
    source = 'shopify';
  } else {
    return { problems: [`this does not look like Shopify's orders export (it has no ${SHOPIFY_SIGNS.join(', ')} column): name the columns with --map ${FIELDS.map((f) => `${f}=<column>`).join(',')}`] };
  }
  const problems = [];
  const at = {};
  const names = {};
  for (const f of [...FIELDS, ...OPTIONAL_FIELDS]) {
    const name = want[f];
    const required = FIELDS.includes(f);
    if (name === undefined) {
      if (required) problems.push(`--map names no ${f} column (${WHAT[f]}): add ${f}=<column>`);
      continue;
    }
    const hits = [];
    lower.forEach((h, i) => { if (h === name.trim().toLowerCase()) hits.push(i); });
    if (hits.length === 0) {
      if (required || source === 'map') problems.push(`the column "${name}" (${f}: ${WHAT[f]}) is not in the file`);
      continue;
    }
    if (hits.length > 1) {
      problems.push(`the column "${name}" appears ${hits.length} times, so which one holds the ${f} cannot be told`);
      continue;
    }
    at[f] = hits[0];
    names[f] = name;
  }
  const byColumn = new Map();
  for (const [f, i] of Object.entries(at)) {
    if (byColumn.has(i)) problems.push(`${byColumn.get(i)} and ${f} are both read from the column "${names[f]}": one column cannot hold both`);
    else byColumn.set(i, f);
  }
  return { problems, at, names, source };
}

// ---------------------------------------------------------------- the analysis

function spread(sorted) {
  return {
    min: sorted[0],
    q1: nearestRank(sorted, 25),
    median: nearestRank(sorted, 50),
    q3: nearestRank(sorted, 75),
    p80: nearestRank(sorted, 80),
    p90: nearestRank(sorted, 90),
    max: sorted[sorted.length - 1],
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

/**
 * Read one orders export. Returns { verdict: 'REPORT', report } or { verdict: 'REFUSED', reasons }. Money in the
 * report is whole cents in the export's one currency; shares are fractions of 1. No email, no row, no line item is
 * in it: only counts, order-value figures and the date span.
 */
export function analyse(text, { map } = {}) {
  let records;
  try {
    records = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvError) return refused([`the file is not valid CSV: ${err.message}`]);
    throw err;
  }
  const isBlank = (row) => row.length === 1 && row[0].trim() === '';
  if (!records.length || isBlank(records[0])) return refused(['the file has no header row on its first line']);

  const cols = resolveColumns(records[0], map);
  if (cols.problems.length) return refused(cols.problems);
  const { at, names, source } = cols;

  const width = records[0].length;
  const ragged = [];
  for (let r = 1; r < records.length; r++) if (!isBlank(records[r]) && records[r].length !== width) ragged.push(r + 1);
  if (ragged.length) {
    return refused([`row${ragged.length > 1 ? 's' : ''} ${ragged.slice(0, MAX_LISTED).join(', ')}${ragged.length > MAX_LISTED ? ' and more' : ''} ${ragged.length > 1 ? 'do' : 'does'} not have the header's ${width} fields: a broken quote or a stray comma would put money in the wrong column`]);
  }

  // Group line-item rows into orders. Each order-level field comes from the row that carries it.
  const orders = new Map();
  const problems = [];
  let rows = 0;
  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    if (isBlank(row)) continue;
    rows++;
    const id = row[at.id].trim();
    if (id === '') {
      problems.push(`row ${r + 1} has no ${names.id}, so which order it belongs to cannot be told`);
      continue;
    }
    if (id.includes('@')) {
      return refused([`the ${names.id} column holds email addresses, not order numbers: grouping by it would merge a customer's orders into one. Map id to the order number`]);
    }
    let o = orders.get(id);
    if (!o) {
      o = { id, values: {} };
      orders.set(id, o);
    }
    for (const f of ORDER_LEVEL) {
      if (at[f] === undefined) continue;
      const v = row[at[f]].trim();
      if (v === '') continue;
      const had = o.values[f];
      if (had === undefined) o.values[f] = { v, row: r + 1 };
      else if (had.v !== v) problems.push(`order ${id} carries two different ${names[f]} values (rows ${had.row} and ${r + 1}): two orders share one ${names.id}, or the export is damaged`);
    }
  }

  // Every order-level value must be read, not assumed.
  const parsed = [];
  for (const o of orders.values()) {
    const val = (f) => o.values[f]?.v;
    const cents = {};
    for (const f of MONEY_FIELDS) {
      cents[f] = moneyCents(val(f));
      if (!Number.isFinite(cents[f])) {
        problems.push(val(f) === undefined
          ? `order ${o.id} has no ${names[f]} on any of its rows: unknown money is never zero`
          : `order ${o.id}: ${names[f]} is not an amount of money (a plain number such as 84.50, 0 or more, at most two decimals)`);
      }
    }
    const currency = (val('currency') ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) problems.push(`order ${o.id} has no three-letter currency code in ${names.currency}`);
    const raw = val('status');
    const status = raw === undefined ? undefined : raw.toLowerCase().split(/[\s-]+/).join('_');
    if (status === undefined) problems.push(`order ${o.id} has no ${names.status}, so whether it was voided or refunded cannot be told`);
    else if (!Object.hasOwn(STATUS, status)) problems.push(`order ${o.id}: ${names.status} ${shown(raw)} is not one this knows (${Object.keys(STATUS).join(', ')}), so whether it is a sale cannot be told`);
    const mk = (val('marketing') ?? '').toLowerCase();
    const accepts = YES.has(mk) ? true : NO.has(mk) ? false : undefined;
    if (accepts === undefined) problems.push(`order ${o.id} has no yes or no in ${names.marketing}, so it cannot be counted either way`);
    const day = calendarDay(val('created'));
    if (day === undefined) problems.push(`order ${o.id}: ${names.created} is not a date written year first (YYYY-MM-DD, with or without a time); a day/month date is ambiguous`);
    const cancelled = at.cancelled !== undefined && val('cancelled') !== undefined;
    parsed.push({ id: o.id, ...cents, currency, status, accepts, day, cancelled });
  }
  if (problems.length) return refused(problems);

  const currencies = [...new Set(parsed.map((o) => o.currency))].sort();
  if (currencies.length > 1) {
    return refused([`the export mixes currencies (${currencies.join(', ')}): an average of unlike money means nothing. Export one currency at a time`]);
  }

  // Voided, refunded and cancelled orders are counted as orders, and kept out of every value figure.
  const excluded = {};
  for (const o of parsed) {
    o.counts = STATUS[o.status] === true && !o.cancelled;
    if (!o.counts) {
      const why = o.cancelled || o.status === 'canceled' ? 'cancelled' : o.status;
      excluded[why] = (excluded[why] ?? 0) + 1;
    }
  }
  const counted = parsed.filter((o) => o.counts);
  if (counted.length < MIN_ORDERS) {
    const out = parsed.length - counted.length;
    return refused([`only ${counted.length} orders count towards order value${out ? ` (${out} more were voided, refunded or cancelled)` : ''}: below ${MIN_ORDERS} the median, the spread and the free-shipping threshold are unreliable, so none is given. Export a longer period`]);
  }

  const asc = (xs) => [...xs].sort((a, b) => a - b);
  const subtotal = spread(asc(counted.map((o) => o.subtotal)));
  const total = spread(asc(counted.map((o) => o.total)));
  const shippingMedianCents = nearestRank(asc(counted.map((o) => o.shipping)), 50);

  const threshold = thresholdCents(subtotal.p80);
  const qualifying = counted.filter((o) => o.subtotal >= threshold);
  const absorbedCents = qualifying.reduce((a, o) => a + o.shipping, 0);

  const days = parsed.map((o) => o.day).sort();
  const first = days[0];
  const last = days[days.length - 1];
  const spanDays = (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY + 1;

  const refundedOrders = parsed.filter((o) => o.refunded > 0).length;
  const accepts = parsed.filter((o) => o.accepts).length;

  return {
    verdict: 'REPORT',
    report: {
      source,
      currency: currencies[0],
      rows,
      orders: parsed.length,
      countedOrders: counted.length,
      excluded,
      span: { first, last, days: spanDays },
      ordersPer30Days: Math.round((parsed.length * 30 * 10) / spanDays) / 10,
      subtotalCents: subtotal,
      totalCents: total,
      shippingMedianCents,
      refunds: { totalCents: parsed.reduce((a, o) => a + o.refunded, 0), orders: refundedOrders, share: refundedOrders / parsed.length },
      marketing: { accepts, orders: parsed.length, share: accepts / parsed.length },
      threshold: {
        cents: threshold,
        p80Cents: subtotal.p80,
        qualifying: qualifying.length,
        of: counted.length,
        share: qualifying.length / counted.length,
        absorbedCents,
      },
    },
  };
}

// ---------------------------------------------------------------- the one write

/**
 * Plan the one write: the median subtotal into an existing pilot.json as baselineAovUsd, and nothing else. Refused
 * when the file is missing or is not a JSON object, when startDate is not a date or is on or before now (the
 * denominator is fixed before the pilot starts, never after), when any order is dated on or after the start, and when
 * the export is not in USD. Writes nothing: the command line commits the plan only once its output has passed the
 * privacy gate. Returns { ok: true, pilotPath, content, baselineAovUsd, was, message } or { ok: false, reasons }.
 */
export function planAov(pilotPath, report, now = Date.now()) {
  const no = (why) => ({ ok: false, reasons: [why] });
  if (!existsSync(pilotPath)) return no(`there is no pilot.json at ${pilotPath}: --write-aov only writes into an existing one, so write the pilot rules first (PILOT_DEFAULTS in creator-pilot.mjs)`);
  let pilot;
  try {
    pilot = JSON.parse(readFileSync(pilotPath, 'utf8'));
  } catch {
    return no(`${pilotPath} is not readable JSON`);
  }
  if (!pilot || typeof pilot !== 'object' || Array.isArray(pilot)) return no(`${pilotPath} must hold the pilot rules as a JSON object`);
  const start = strictTime(pilot.startDate);
  if (Number.isNaN(start)) return no('pilot.startDate is not a date (YYYY-MM-DD): set the launch day first, so the baseline is provably fixed before it');
  const startDay = Math.floor(start / DAY) * DAY;
  if (startDay <= now) return no(`pilot.startDate ${pilot.startDate} is on or before now: the pilot's denominator must be fixed before it starts, never once it has`);
  const startIso = new Date(startDay).toISOString().slice(0, 10);
  if (report.span.last >= startIso) return no(`the export runs to ${report.span.last}, on or after the pilot's start ${startIso}: the baseline must come only from orders placed before the pilot`);
  if (report.currency !== 'USD') return no(`baselineAovUsd is in US dollars and this export is in ${report.currency}: convert it deliberately, by hand, never here`);
  const was = pilot.baselineAovUsd;
  const aov = report.subtotalCents.median / 100;
  return {
    ok: true,
    pilotPath,
    content: `${JSON.stringify({ ...pilot, baselineAovUsd: aov }, null, 2)}\n`,
    baselineAovUsd: aov,
    was,
    message: `baselineAovUsd set to ${aov.toFixed(2)} in ${pilotPath} (was ${JSON.stringify(was) ?? 'unset'}): the median subtotal of ${report.countedOrders} orders from ${report.span.first} to ${report.span.last}, fixed before the start on ${startIso}`,
  };
}

/** Commit a plan from planAov: written beside the file, then renamed over it, so a failed write never leaves half a pilot. */
export function commitAov(plan) {
  const tmp = `${plan.pilotPath}.tmp-${process.pid}`;
  writeFileSync(tmp, plan.content);
  renameSync(tmp, plan.pilotPath);
}

/** planAov and commitAov together, for callers with no output to gate. */
export function writeAov(pilotPath, report, now = Date.now()) {
  const plan = planAov(pilotPath, report, now);
  if (plan.ok) commitAov(plan);
  return plan;
}

// ---------------------------------------------------------------- what is printed

export function format(r) {
  const m = (c) => `${r.currency} ${(c / 100).toFixed(2)}`;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const out = Object.entries(r.excluded).map(([k, n]) => `${n} ${k}`).join(', ');
  const d = (x) => `Q1 ${m(x.q1)}, median ${m(x.median)}, Q3 ${m(x.q3)}, p80 ${m(x.p80)}, p90 ${m(x.p90)} (lowest ${m(x.min)}, highest ${m(x.max)})`;
  const t = r.threshold;
  return [
    `ORDERS  ${r.orders} orders on ${r.rows} rows (${r.source === 'shopify' ? "Shopify's orders export, one row per line item" : 'columns named by --map'}), ${r.span.first} to ${r.span.last} (${r.span.days} days), in ${r.currency}`,
    `  ${r.countedOrders} count towards order value${out ? `; ${out} counted as orders but kept out of every value figure` : ''}`,
    `  volume: ${r.ordersPer30Days.toFixed(1)} orders per 30 days`,
    '',
    `Order value on Subtotal (goods, before shipping): median ${m(r.subtotalCents.median)}, mean ${m(r.subtotalCents.mean)}  (the median is the pilot's baseline)`,
    `Order value on Total: median ${m(r.totalCents.median)}, mean ${m(r.totalCents.mean)}`,
    `  Subtotal spread: ${d(r.subtotalCents)}`,
    `  Total spread:    ${d(r.totalCents)}`,
    `Shipping charged: median ${m(r.shippingMedianCents)}`,
    `Refunds: ${m(r.refunds.totalCents)} in total, on ${r.refunds.orders} of ${r.orders} orders (${pct(r.refunds.share)})`,
    `Accepts marketing: ${r.marketing.accepts} of ${r.marketing.orders} orders (${pct(r.marketing.share)}), counted per order, not per customer`,
    '',
    `Free-shipping threshold: ${m(t.cents)} (the p80 subtotal ${m(t.p80Cents)}, rounded up to a multiple of 5)`,
    `  ${t.qualifying} of ${t.of} orders (${pct(t.share)}) are at or above it already; on them the store would have absorbed ${m(t.absorbedCents)} of postage over these ${r.span.days} days`,
  ].join('\n');
}

const formatRefusal = (reasons, head = 'no figures are given') => [`REFUSED  ${head}, because:`, ...reasons.map((x) => `  - ${x}`)].join('\n');

// ---------------------------------------------------------------- the command line

const USAGE = [
  'usage: orders.mjs --file export.csv',
  '                  [--map id=COL,created=COL,currency=COL,status=COL,marketing=COL,subtotal=COL,shipping=COL,total=COL,refunded=COL[,cancelled=COL]]',
  '                  [--write-aov --pilot agency/pilot/pilot.json]',
  '  exit 0 on a report, 1 on a refusal, 2 on misuse',
].join('\n');

const VALUE_FLAGS = { '--file': 'file', '--map': 'map', '--pilot': 'pilot' };
const BARE_FLAGS = { '--write-aov': 'writeAov' };
const MAP_KEYS = new Set([...FIELDS, ...OPTIONAL_FIELDS]);

/** "subtotal=Goods,shipping=Postage,..." to { subtotal: 'Goods', ... }, or { error }. Unknown and repeated keys are refused. */
export function parseMap(spec) {
  const map = {};
  for (const part of spec.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) return { error: `--map entry ${JSON.stringify(part)} is not key=Column` };
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim();
    if (!MAP_KEYS.has(k)) return { error: `--map key ${JSON.stringify(k)} is not one this knows (${[...MAP_KEYS].join(', ')})` };
    if (Object.hasOwn(map, k)) return { error: `--map names ${k} twice` };
    if (!v) return { error: `--map ${k}= needs a column name after it` };
    map[k] = v;
  }
  return { map };
}

/**
 * Read the command line against an allow-list. An unknown argument, a flag given twice, a value flag with nothing
 * after it, --pilot without --write-aov and the reverse are all refused, never skipped. Returns the options or { error }.
 */
export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (Object.hasOwn(BARE_FLAGS, t)) {
      if (o[BARE_FLAGS[t]]) return { error: `${t} is given twice` };
      o[BARE_FLAGS[t]] = true;
      continue;
    }
    if (!Object.hasOwn(VALUE_FLAGS, t)) return { error: `unknown argument ${JSON.stringify(t)}` };
    const k = VALUE_FLAGS[t];
    if (Object.hasOwn(o, k)) return { error: `${t} is given twice` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--') || v.trim() === '') return { error: `${t} needs a value after it` };
    o[k] = v;
    i++;
  }
  if (!o.file) return { error: '--file is needed (the orders export, as CSV)' };
  if (o.writeAov && !o.pilot) return { error: '--write-aov needs --pilot <path to the existing pilot.json>' };
  if (o.pilot && !o.writeAov) return { error: '--pilot only goes with --write-aov' };
  if (o.map !== undefined) {
    const m = parseMap(o.map);
    if (m.error) return { error: m.error };
    o.map = m.map;
  }
  return o;
}

const PRIVACY = 'REFUSED  nothing is printed or written: the output would have held an at sign, which may be part of an email address. If a column holding emails is named in --map, name the right one.';

/**
 * The last gate before anything reaches a screen or a file: an "@" anywhere in the output replaces it with a refusal,
 * and a report that would have exited 0 exits 1 instead, so the pilot write behind it is never committed.
 */
function done(code, stdout, stderr) {
  if (`${stdout}${stderr}`.includes('@')) return { code: code === 0 ? 1 : code, stdout: '', stderr: PRIVACY };
  return { code, stdout, stderr };
}

/** The whole command, as { code, stdout, stderr }. `now` is for tests that import this; the command line always uses the real clock. */
export function cli(argv, now = Date.now()) {
  const a = parseArgs(argv);
  if (a.error) return done(2, '', `${a.error}\n\n${USAGE}`);
  let text;
  try {
    text = readFileSync(a.file, 'utf8');
  } catch {
    return done(2, '', `cannot read ${a.file}: --file needs the orders export, as CSV\n\n${USAGE}`);
  }
  const r = analyse(text, { map: a.map });
  if (r.verdict !== 'REPORT') return done(1, '', formatRefusal(r.reasons));
  const report = format(r.report);
  if (!a.writeAov) return done(0, report, '');
  const plan = planAov(a.pilot, r.report, now);
  if (!plan.ok) return done(1, report, formatRefusal(plan.reasons, 'nothing was written'));
  const out = done(0, `${report}\n\n${plan.message}`, '');
  if (out.code === 0) commitAov(plan);
  return out;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const r = cli(process.argv.slice(2));
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  process.exitCode = r.code;
}
