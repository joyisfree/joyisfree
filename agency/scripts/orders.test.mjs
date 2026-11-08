// The orders analyser is shown to refuse what it should: a broken CSV, a missing or doubled column, a line item
// counted as an order, money that is not a number, two currencies, a voided order taken for a sale, a status or a
// marketing answer it cannot read, fewer than 30 orders, an email or a name where the order number should be, a
// customer's cell echoed in a refusal, a free-shipping threshold most orders already meet, and a baseline written once
// the pilot has started (a startDate with a time and an offset included), from the wrong currency, from a median of 0,
// or from an export too short or too old. Each guard has a case here that goes red without it.
// The fixture is a 42-order Shopify-shaped export built in this file, one row per line item, with a BOM, CRLF line
// ends and line-item names holding commas, doubled quotes and a line break. The clock is always injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_ORDERS, STATUS, parseCsv, CsvError, moneyCents, calendarDay, nearestRank, thresholdCents, resolveColumns,
  analyse, writeAov, format, parseArgs, parseMap, cli,
} from './orders.mjs';
import { PILOT_DEFAULTS, validatePilot } from './creator-pilot.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'orders.mjs');
const DAY = 86_400_000;

// ------------------------------------------------------------------ the fixture

const COLUMNS = ['Name', 'Email', 'Financial Status', 'Paid at', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total',
  'Discount Amount', 'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Refunded Amount', 'Cancelled at'];
const LINE_NAMES = ['Joy Tee, "Sunrise" print / M', 'Free Hoodie\nwashed black / L', 'Plain cap'];
const ORDER_LEVEL = ['Financial Status', 'Paid at', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total', 'Discount Amount', 'Refunded Amount', 'Cancelled at'];

const money = (c) => (c / 100).toFixed(2);
const dayAfter = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** One CSV field, quoted only when it must be, the way a spreadsheet writes it. */
const field = (v) => (/[",\r\n]/.test(v) ? `"${v.split('"').join('""')}"` : v);

/**
 * The 42-order store. Orders 1 to 40 are sales with subtotals 50.00, 52.00 ... 128.00 (shipping 10.00 on the first 20,
 * 12.50 on the rest); 7 and 33 are partly refunded (20.00 each); every third accepts marketing. Order 41 is voided
 * (500.00) and 42 refunded in full (400.00): both would move every figure if they were counted as sales.
 * Each order has 1 to 3 line items: 83 rows for 42 orders.
 */
function baseOrders() {
  const out = [];
  for (let i = 1; i <= 40; i++) {
    const subtotal = 5000 + (i - 1) * 200;
    const shipping = i <= 20 ? 1000 : 1250;
    const partly = i === 7 || i === 33;
    out.push({
      Name: `#${1000 + i}`, Email: `buyer${i}@example.com`, 'Financial Status': partly ? 'partially_refunded' : 'paid',
      'Paid at': `${dayAfter('2026-08-10', (i - 1) * 2)} 14:25:00 +1000`, 'Accepts Marketing': i % 3 === 0 ? 'yes' : 'no',
      Currency: 'USD', Subtotal: money(subtotal), Shipping: money(shipping), Taxes: '0.00', Total: money(subtotal + shipping),
      'Discount Amount': '0.00', 'Created at': `${dayAfter('2026-08-10', (i - 1) * 2)} 14:23:05 +1000`,
      'Refunded Amount': partly ? '20.00' : '0.00', 'Cancelled at': '', lines: 1 + (i % 3),
    });
  }
  out.push({
    Name: '#1041', Email: 'voided@example.com', 'Financial Status': 'voided', 'Paid at': '', 'Accepts Marketing': 'yes', Currency: 'USD',
    Subtotal: '500.00', Shipping: '15.00', Taxes: '0.00', Total: '515.00', 'Discount Amount': '0.00', 'Created at': '2026-11-01 09:00:00 +1100',
    'Refunded Amount': '0.00', 'Cancelled at': '', lines: 2,
  });
  out.push({
    Name: '#1042', Email: 'refunded@example.com', 'Financial Status': 'refunded', 'Paid at': '2026-11-07 18:31:00 +1100', 'Accepts Marketing': 'no',
    Currency: 'USD', Subtotal: '400.00', Shipping: '15.00', Taxes: '0.00', Total: '415.00', 'Discount Amount': '0.00',
    'Created at': '2026-11-07 18:30:00 +1100', 'Refunded Amount': '415.00', 'Cancelled at': '', lines: 1,
  });
  return out;
}

/** Shopify's shape: order-level fields on the first row of an order only, Name, Email and Created at on every row. */
function shopifyCsv(orders, { eol = '\r\n', bom = true, columns = COLUMNS } = {}) {
  const lines = [columns.map(field).join(',')];
  for (const o of orders) {
    for (let k = 0; k < o.lines; k++) {
      const row = { ...o, 'Lineitem quantity': String(k + 1), 'Lineitem name': LINE_NAMES[k], 'Lineitem price': '25.00' };
      if (k > 0) for (const c of ORDER_LEVEL) row[c] = '';
      Object.assign(row, k > 0 ? o.later ?? {} : {});
      lines.push(columns.map((c) => field(row[c] ?? '')).join(','));
    }
  }
  return `${bom ? '﻿' : ''}${lines.join(eol)}${eol}`;
}

/** Edit one order of the base store. */
const withOrder = (n, over) => baseOrders().map((o, i) => (i === n - 1 ? { ...o, ...over } : o));
/** The row order n of the base store starts on in its Shopify export: the header is row 1. */
const rowOf = (n) => 2 + baseOrders().slice(0, n - 1).reduce((a, o) => a + o.lines, 0);

/** Another store's export, one row per order, under its own column names. */
const GENERIC = { id: 'Order', created: 'Date', currency: 'Cur', status: 'State', marketing: 'Opt in', subtotal: 'Goods', shipping: 'Postage', total: 'Paid', refunded: 'Refund' };
const SHOPIFY_OF = { id: 'Name', created: 'Created at', currency: 'Currency', status: 'Financial Status', marketing: 'Accepts Marketing', subtotal: 'Subtotal', shipping: 'Shipping', total: 'Total', refunded: 'Refunded Amount' };
function genericCsv(orders, extra = []) {
  const cols = [...Object.values(GENERIC), 'Customer email', ...extra.map(([h]) => h)];
  const lines = [cols.join(',')];
  for (const o of orders) {
    const vals = Object.keys(GENERIC).map((f) => o[SHOPIFY_OF[f]]);
    lines.push([...vals, o.Email, ...extra.map(([, fn]) => fn(o))].map(field).join(','));
  }
  return `${lines.join('\n')}\n`;
}
const GENERIC_MAP = Object.entries(GENERIC).map(([k, v]) => `${k}=${v}`).join(',');
const genericMap = (over = {}) => parseMap(Object.entries({ ...GENERIC, ...over }).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join(',')).map;

const report = (text, opts) => {
  const r = analyse(text, opts);
  assert.equal(r.verdict, 'REPORT', `expected a report, got ${JSON.stringify(r.reasons)}`);
  return r.report;
};
const refusal = (text, opts) => {
  const r = analyse(text, opts);
  assert.equal(r.verdict, 'REFUSED', 'expected a refusal, got a report');
  return r.reasons.join('\n');
};

const BASE = shopifyCsv(baseOrders());

// ------------------------------------------------------------------ RFC 4180

test('parseCsv reads quoted commas, doubled quotes, line breaks inside quotes, CRLF and LF, and drops a BOM', () => {
  const text = '﻿Name,Note,Price\r\n#1,"a, b",1.00\r\n#2,"say ""hi""",2.00\n#3,"two\r\nlines",3.00\n#4,,4.00';
  assert.deepEqual(parseCsv(text), [
    ['Name', 'Note', 'Price'],
    ['#1', 'a, b', '1.00'],
    ['#2', 'say "hi"', '2.00'],
    ['#3', 'two\r\nlines', '3.00'],
    ['#4', '', '4.00'],
  ]);
  assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']], 'a final line break does not make an empty record');
  assert.deepEqual(parseCsv('a,""'), [['a', '']], 'an empty quoted field at the very end still counts');
});

test('parseCsv refuses a quote never closed, a quote inside a bare field, text after a closing quote, a lone CR', () => {
  assert.throws(() => parseCsv('a,b\n1,"open\n2,3\n'), (e) => e instanceof CsvError && /opened on line 2 is never closed/.test(e.message));
  assert.throws(() => parseCsv('a,b\n1,ab"c\n'), (e) => e instanceof CsvError && /line 2 has a quote inside a field/.test(e.message));
  assert.throws(() => parseCsv('a,b\n1,"ab"c\n'), (e) => e instanceof CsvError && /line 2 has text after a closing quote/.test(e.message));
  assert.throws(() => parseCsv('a,b\r1,2\r'), (e) => e instanceof CsvError && /carriage return with no line feed/.test(e.message));
  assert.match(refusal('Name,Lineitem name\n#1,"open\n'), /not valid CSV/);
});

// ------------------------------------------------------------------ strict values

test('moneyCents reads plain amounts only: blank, words, separators, signs, symbols and a third decimal are NaN', () => {
  assert.equal(moneyCents('84.50'), 8450);
  assert.equal(moneyCents(' 84.5 '), 8450);
  assert.equal(moneyCents('0'), 0);
  assert.equal(moneyCents('120'), 12000);
  for (const bad of ['', '  ', 'N/A', '1,200.00', '-5.00', '$84.50', '84.505', '+5', '1e3', undefined, null]) {
    assert.ok(Number.isNaN(moneyCents(bad)), `${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(moneyCents('90071992547409.91'), Number.MAX_SAFE_INTEGER, 'the largest exact amount is read');
  assert.ok(Number.isNaN(moneyCents('100000000000000000000')), 'an amount past exact whole cents is refused, never rounded');
});

test('calendarDay takes Shopify and ISO times year first, and refuses day/month dates and impossible days or hours', () => {
  assert.equal(calendarDay('2026-08-10 14:23:05 +1000'), '2026-08-10');
  assert.equal(calendarDay('2026-08-10T23:59:59Z'), '2026-08-10');
  assert.equal(calendarDay('2026-08-10'), '2026-08-10');
  assert.equal(calendarDay('10/08/2026'), undefined, 'day/month is ambiguous');
  assert.equal(calendarDay('2026-02-30'), undefined, 'not 2 March');
  assert.equal(calendarDay('2026-08-10 24:30:00 +1000'), undefined, 'no hour 24');
  assert.equal(calendarDay('2026-08-10 14:60:00'), undefined, 'no minute 60');
  assert.equal(calendarDay('2026-08-10 14:00:60'), undefined, 'no second 60');
  assert.equal(calendarDay('2026-08-10 14:59:59'), '2026-08-10');
  assert.equal(calendarDay(undefined), undefined);
});

test('nearestRank is always a real value, the lower middle on an even count; the threshold starts at the p80 rounded up to a 5', () => {
  const s = [1, 2, 3, 4];
  assert.equal(nearestRank(s, 50), 2);
  assert.equal(nearestRank(s, 25), 1);
  assert.equal(nearestRank(s, 100), 4);
  assert.ok(Number.isNaN(nearestRank([], 50)));
  assert.equal(thresholdCents(11200), 11500);
  assert.equal(thresholdCents(7240), 7500);
  assert.equal(thresholdCents(7500), 7500, 'a p80 already on a multiple of 5 stays');
  assert.equal(thresholdCents(7501), 8000);
});

// ------------------------------------------------------------------ the report

test('the 42-order Shopify export: line items grouped into orders, voided and refunded counted but kept out of value', () => {
  const r = report(BASE);
  assert.equal(r.source, 'shopify');
  assert.equal(r.currency, 'USD');
  assert.equal(r.rows, 83, 'one row per line item');
  assert.equal(r.orders, 42, 'deduplicated by Name');
  assert.equal(r.countedOrders, 40);
  assert.deepEqual(r.excluded, { voided: 1, refunded: 1 });
  assert.deepEqual(r.span, { first: '2026-08-10', last: '2026-11-07', days: 90 });
  assert.equal(r.ordersPer30Days, 14);
  assert.deepEqual(r.subtotalCents, { min: 5000, q1: 6800, median: 8800, q3: 10800, p80: 11200, p90: 12000, max: 12800, mean: 8900 });
  assert.equal(r.totalCents.median, 9800);
  assert.equal(r.totalCents.mean, 10025);
  assert.equal(r.shippingMedianCents, 1000);
  assert.deepEqual(r.refunds, { totalCents: 45500, orders: 3, share: 3 / 42 });
  assert.deepEqual(r.marketing, { accepts: 14, orders: 42, share: 14 / 42 });
  assert.deepEqual(r.threshold, { cents: 11500, p80Cents: 11200, qualifying: 7, of: 40, share: 7 / 40, absorbedCents: 8750 });
});

test('LF line ends and no BOM give the same report; a partly refunded order still counts at its full subtotal', () => {
  assert.deepEqual(report(shopifyCsv(baseOrders(), { eol: '\n', bom: false })), report(BASE));
  assert.equal(STATUS.partially_refunded, true);
});

/** 30 or more paid sales at the given subtotals, in cents, each with the given postage. */
const salesAt = (subtotals, shipping = 800) => subtotals.map((sub, i) => ({
  ...baseOrders()[i % 40], Name: `#${2001 + i}`, 'Financial Status': 'paid', 'Refunded Amount': '0.00',
  Subtotal: money(sub), Shipping: money(shipping), Total: money(sub + shipping), lines: 1,
}));
const times = (n, cents) => Array(n).fill(cents);

test('an order whose value sits exactly on the threshold qualifies, and only qualifying orders give up their postage', () => {
  // 30 sales: subtotals 70.00 ... 93.00, then 95.00 on orders 25 to 30. The p80 is 93.00, so the threshold is 95.00,
  // and the 6 orders on it (exactly 20%) qualify.
  const orders = baseOrders().slice(0, 30).map((o, i) => {
    const sub = i < 24 ? 7000 + i * 100 : 9500;
    return { ...o, 'Financial Status': 'paid', 'Refunded Amount': '0.00', Subtotal: money(sub), Shipping: i < 24 ? '9.00' : '11.00', Total: money(sub + (i < 24 ? 900 : 1100)) };
  });
  const r = report(shopifyCsv(orders));
  assert.equal(r.threshold.p80Cents, 9300);
  assert.equal(r.threshold.cents, 9500);
  assert.equal(r.threshold.qualifying, 6, 'at or above, not strictly above');
  assert.equal(r.threshold.share, 0.2);
  assert.equal(r.threshold.absorbedCents, 6 * 1100);
});

test('ties at the p80 never give free shipping to more than 20% of orders: the threshold is raised 5 at a time', () => {
  // 25 tees at 45.00 and 5 hoodies at 90.00: the p80 is 45.00, which every order meets.
  const tees = report(shopifyCsv(salesAt([...times(25, 4500), ...times(5, 9000)])));
  assert.equal(tees.threshold.p80Cents, 4500);
  assert.deepEqual(tees.threshold, { cents: 5000, p80Cents: 4500, qualifying: 5, of: 30, share: 5 / 30, absorbedCents: 5 * 800 });
  assert.match(format(tees), /Free-shipping threshold: USD 50\.00 \(the p80 subtotal USD 45\.00 rounded up to a multiple of 5, then raised/);
  assert.match(format(tees), /5 of 30 orders \(16\.7%\) are at or above it/);
  // 18 at 45.00, 14 at 90.00, 5 at 135.00, 3 at 180.00: the p80 of 90.00 is met by 22 of 40, and 95.00 by 8 (20%).
  const mixed = report(shopifyCsv(salesAt([...times(18, 4500), ...times(14, 9000), ...times(5, 13500), ...times(3, 18000)])));
  assert.deepEqual([mixed.threshold.p80Cents, mixed.threshold.cents, mixed.threshold.qualifying], [9000, 9500, 8]);
  // A one-product drop: every order at 45.00.
  const one = report(shopifyCsv(salesAt(times(40, 4500))));
  assert.deepEqual([one.threshold.cents, one.threshold.qualifying], [5000, 0]);
  for (const r of [tees, mixed, one, report(BASE)]) assert.ok(r.threshold.qualifying * 5 <= r.threshold.of, 'at most 20% at or above');
});

test('repeating the order-level fields on every line-item row is accepted: only a different value is refused', () => {
  const orders = baseOrders().map((o) => ({ ...o, later: { 'Financial Status': o['Financial Status'], Subtotal: o.Subtotal, Currency: o.Currency } }));
  assert.deepEqual(report(shopifyCsv(orders)), report(BASE));
});

test('another store\'s export read with --map gives the same figures as the Shopify one for the same orders', () => {
  const r = report(genericCsv(baseOrders()), { map: genericMap() });
  assert.equal(r.source, 'map');
  assert.equal(r.rows, 42);
  const { source, rows, ...same } = r;
  const { source: s2, rows: r2, ...base } = report(BASE);
  assert.deepEqual(same, base);
});

test('the report and its printout hold no email, no "@" and no line item', () => {
  const r = report(BASE);
  const text = `${JSON.stringify(r)}\n${format(r)}`;
  assert.ok(!text.includes('@'));
  assert.ok(!text.includes('Sunrise') && !text.includes('Hoodie'));
  assert.match(format(r), /Free-shipping threshold: USD 115\.00/);
});

// ------------------------------------------------------------------ refusals: columns

test('without --map, an export that is not Shopify\'s is refused and told to use --map', () => {
  assert.match(refusal(genericCsv(baseOrders())), /does not look like Shopify's orders export.*--map/);
});

test('a missing required column is refused by name; a missing Financial Status says voided orders cannot be told apart', () => {
  const drop = (c) => shopifyCsv(baseOrders(), { columns: COLUMNS.filter((x) => x !== c) });
  assert.match(refusal(drop('Refunded Amount')), /the column "Refunded Amount" \(refunded/);
  assert.match(refusal(drop('Financial Status')), /"Financial Status".*voided/);
  assert.match(refusal(drop('Accepts Marketing')), /"Accepts Marketing"/);
  assert.equal(analyse(drop('Cancelled at')).verdict, 'REPORT', 'Cancelled at is optional');
});

test('--map that names no status column is refused: voided and refunded orders could not be told from sales', () => {
  assert.match(refusal(genericCsv(baseOrders()), { map: genericMap({ status: null }) }), /--map names no status column.*voided/);
  assert.match(refusal(genericCsv(baseOrders()), { map: genericMap({ total: 'Grand total' }) }), /the column "Grand total" \(total/);
});

test('a column that appears twice, or two fields read from one column, is refused', () => {
  const twice = shopifyCsv(baseOrders(), { columns: [...COLUMNS, 'Subtotal'] });
  assert.match(refusal(twice), /"Subtotal" appears 2 times/);
  assert.match(refusal(genericCsv(baseOrders()), { map: genericMap({ total: 'Goods' }) }), /subtotal and total are both read from the column "Goods"/);
});

test('a row with more or fewer fields than the header is refused by its row number', () => {
  const lines = BASE.split('\r\n');
  lines[3] = `${lines[3]},extra`;
  assert.match(refusal(lines.join('\r\n')), /row 4 does not have the header's 17 fields/);
});

// ------------------------------------------------------------------ refusals: orders

test('a line-item row with no Name is refused: which order it belongs to cannot be told', () => {
  const lines = BASE.split('\r\n');
  lines[2] = lines[2].slice(lines[2].indexOf(','));
  assert.match(refusal(lines.join('\r\n')), /row 3 has no Name/);
});

test('an order-number column holding emails is refused: it would merge a customer\'s orders into one', () => {
  assert.match(refusal(genericCsv(baseOrders()), { map: genericMap({ id: 'Customer email' }) }), /holds email addresses, not order numbers/);
});

test('two different values for one order-level field across its rows are refused, never picked between', () => {
  assert.equal(rowOf(2), 4);
  assert.match(refusal(shopifyCsv(withOrder(2, { later: { Subtotal: '99.00' } }))), /the order on row 4 carries two different Subtotal values \(rows 4 and 5\)/);
});

test('money that is missing, not a number, negative or past the cent is refused, naming the order\'s row and the column', () => {
  assert.match(refusal(shopifyCsv(withOrder(5, { Subtotal: 'N/A' }))), new RegExp(`the order on row ${rowOf(5)}: Subtotal is not an amount of money`));
  assert.match(refusal(shopifyCsv(withOrder(5, { Shipping: '' }))), new RegExp(`the order on row ${rowOf(5)} has no Shipping on any of its rows`));
  assert.match(refusal(shopifyCsv(withOrder(6, { 'Refunded Amount': '-5.00' }))), new RegExp(`the order on row ${rowOf(6)}: Refunded Amount is not an amount`));
  assert.match(refusal(shopifyCsv(withOrder(41, { Total: '515.005' }))), new RegExp(`the order on row ${rowOf(41)}: Total is not an amount`), 'a voided order\'s money is checked too');
});

test('an order with no readable currency is refused, and so is an export that mixes currencies', () => {
  assert.match(refusal(shopifyCsv(withOrder(3, { Currency: '' }))), new RegExp(`the order on row ${rowOf(3)} has no three-letter currency code`));
  assert.match(refusal(shopifyCsv(withOrder(3, { Currency: 'US Dollars' }))), new RegExp(`the order on row ${rowOf(3)} has no three-letter currency code`));
  assert.match(refusal(shopifyCsv(withOrder(3, { Currency: 'AUD' }))), /mixes currencies \(AUD, USD\)/);
});

test('an order with no status, or one this does not know, is refused: voided or a sale cannot be told', () => {
  assert.match(refusal(shopifyCsv(withOrder(8, { 'Financial Status': '' }))), new RegExp(`the order on row ${rowOf(8)} has no Financial Status, so whether it was voided`));
  const disputed = refusal(shopifyCsv(withOrder(8, { 'Financial Status': 'disputed' })));
  assert.match(disputed, new RegExp(`the order on row ${rowOf(8)}: its Financial Status is not one this knows`));
  assert.ok(!disputed.includes('disputed'), 'the cell itself is never echoed');
  const odd = refusal(shopifyCsv(withOrder(8, { 'Financial Status': 'x@y.z' })));
  assert.match(odd, /its Financial Status is not one this knows/);
  assert.ok(!odd.includes('@'), 'a mis-mapped column is never echoed');
});

test('no refusal echoes a cell: an order is named by its row, and a column of customers\' names never reaches the screen', () => {
  const names = ['Jane Doe', 'Ahmed Khan', 'Mary-Jane O Brien', 'Li Wei', 'Sofia Rossi'];
  const customer = ['Customer', (o) => names[Number(o.Name.slice(1)) % names.length]];
  const text = genericCsv(baseOrders(), [customer]);
  const leaks = (out) => [...names, '#10'].filter((x) => out.includes(x));
  // status read from the names column
  const status = refusal(text, { map: genericMap({ status: 'Customer' }) });
  assert.match(status, /the order on row 2: its Customer is not one this knows/);
  assert.deepEqual(leaks(status), [], 'no name and no order number is echoed');
  // every other per-order refusal names the row, not the order number
  for (const over of [{ Subtotal: 'N/A' }, { Shipping: '' }, { Currency: 'US Dollars' }, { 'Accepts Marketing': 'maybe' }, { 'Created at': '28/08/2026' }]) {
    const why = refusal(shopifyCsv(withOrder(5, over)));
    assert.match(why, new RegExp(`^the order on row ${rowOf(5)}\\b`), JSON.stringify(over));
    assert.ok(!why.includes('#1005'), JSON.stringify(over));
  }
  const s = scratch();
  try {
    const csv = join(s.dir, 'names.csv');
    writeFileSync(csv, text);
    const r = cli(['--file', csv, '--map', `${GENERIC_MAP.split('status=State').join('status=Customer')}`]);
    assert.equal(r.code, 1);
    assert.deepEqual(leaks(`${r.stdout}${r.stderr}`), [], 'nor through the command line');
  } finally {
    s.clean();
  }
});

test('an order-number column holding names is refused: two orders by one customer would merge into one', () => {
  // Every customer has a name of their own, but the first two orders are Jane Smith's and identical in every field.
  const n = (o) => Number(o.Name.slice(1)) - 1001;
  const buyer = (o) => (n(o) < 2 ? 'Jane Smith' : `Buyer ${String.fromCharCode(65 + (n(o) % 26), 65 + Math.floor(n(o) / 26))}`);
  const twins = baseOrders().map((o, i) => (i === 1 ? { ...baseOrders()[0], Name: '#1002' } : o));
  const text = genericCsv(twins, [['Customer', buyer]]);
  assert.equal(report(text, { map: genericMap() }).orders, 42, 'by the real order number they are two orders');
  const r = analyse(text, { map: genericMap({ id: 'Customer' }) });
  assert.equal(r.verdict, 'REFUSED', 'by the name they would silently be one, and 42 orders would read as 41');
  assert.match(r.reasons.join('\n'), /the Customer column holds a value with no digit in it on row 2, so it is not an order number/);
  assert.ok(!r.reasons.join('\n').includes('Jane') && !r.reasons.join('\n').includes('Buyer'), 'and no name is echoed');
});

test('an order with a Cancelled at date is counted as an order but kept out of every value figure', () => {
  const r = report(shopifyCsv(withOrder(40, { 'Cancelled at': '2026-10-28 10:00:00 +1100' })));
  assert.equal(r.orders, 42);
  assert.equal(r.countedOrders, 39);
  assert.deepEqual(r.excluded, { cancelled: 1, voided: 1, refunded: 1 });
  assert.equal(r.subtotalCents.max, 12600, 'the cancelled 128.00 order is out');
});

test('an order with no yes or no for Accepts Marketing is refused rather than counted as a no', () => {
  assert.match(refusal(shopifyCsv(withOrder(9, { 'Accepts Marketing': '' }))), new RegExp(`the order on row ${rowOf(9)} has no yes or no in Accepts Marketing`));
  assert.match(refusal(shopifyCsv(withOrder(9, { 'Accepts Marketing': 'maybe' }))), new RegExp(`the order on row ${rowOf(9)} has no yes or no`));
});

test('an order date that is not year first, or not a real day, is refused', () => {
  assert.match(refusal(shopifyCsv(withOrder(10, { 'Created at': '28/08/2026 10:00' }))), new RegExp(`the order on row ${rowOf(10)}: Created at is not a date written year first`));
  assert.match(refusal(shopifyCsv(withOrder(10, { 'Created at': '2026-02-30 10:00:00 +1000' }))), new RegExp(`the order on row ${rowOf(10)}: Created at is not a date`));
});

test(`fewer than ${MIN_ORDERS} orders that count towards value is refused as unreliable; exactly ${MIN_ORDERS} is read`, () => {
  const orders = baseOrders();
  const keep = (n) => [...orders.slice(0, n), ...orders.slice(40)];
  assert.match(refusal(shopifyCsv(keep(29))), /only 29 orders count towards order value \(2 more were voided, refunded or cancelled\).*unreliable/);
  assert.equal(report(shopifyCsv(keep(30))).countedOrders, 30);
});

test('an empty file, or one whose first line is blank, is refused: there is no header to read', () => {
  assert.match(refusal(''), /no header row/);
  assert.match(refusal(`\n${BASE}`), /no header row/);
});

test('expired, cancelled and failed orders are kept out of value like voided ones; pending and authorised are sales', () => {
  for (const [status, key] of [['expired', 'expired'], ['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['failed', 'failed'], ['Voided', 'voided']]) {
    const r = report(shopifyCsv(withOrder(41, { 'Financial Status': status })));
    assert.deepEqual(r.excluded, { [key]: 1, refunded: 1 }, status);
  }
  for (const status of ['pending', 'authorized', 'Partially Paid']) {
    const r = report(shopifyCsv(withOrder(41, { 'Financial Status': status })));
    assert.equal(r.countedOrders, 41, status);
  }
});

test('resolveColumns names every missing field at once', () => {
  const r = resolveColumns(['Name', 'Lineitem name'], undefined);
  assert.equal(r.problems.length, 8);
});

// ------------------------------------------------------------------ the write

// The fixture's last order is on 2026-11-07, 24 days before this start; the clock is 2026-11-08.
const PILOT = { ...PILOT_DEFAULTS, decidedOn: '2026-11-01', startDate: '2026-12-01', paidSocialBandUsd: [30, 100] };

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'orders-test-'));
  const csv = join(dir, 'export.csv');
  writeFileSync(csv, BASE);
  return { dir, csv, pilot: join(dir, 'pilot.json'), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('--write-aov writes the median subtotal into the existing pilot.json and changes nothing else', () => {
  const s = scratch();
  try {
    writeFileSync(s.pilot, `${JSON.stringify(PILOT, null, 2)}\n`);
    const r = cli(['--file', s.csv, '--write-aov', '--pilot', s.pilot], Date.parse('2026-11-08T12:00:00Z'));
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /baselineAovUsd set to 88\.00/);
    const written = JSON.parse(readFileSync(s.pilot, 'utf8'));
    assert.deepEqual(written, { ...PILOT, baselineAovUsd: 88 });
    assert.deepEqual(Object.keys(written), Object.keys(PILOT), 'key order kept');
    assert.ok(!validatePilot(written).some((p) => /baselineAovUsd/.test(p)), 'creator-pilot.mjs accepts the baseline written');
    assert.ok(!readFileSync(s.pilot, 'utf8').includes('@'));
  } finally {
    s.clean();
  }
});

test('--write-aov refuses a pilot.json that does not exist, and does not create one', () => {
  const s = scratch();
  try {
    const r = cli(['--file', s.csv, '--write-aov', '--pilot', s.pilot], Date.parse('2026-11-08T12:00:00Z'));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no pilot\.json at .* only writes into an existing one/);
    assert.ok(!existsSync(s.pilot));
  } finally {
    s.clean();
  }
});

test('--write-aov refuses a pilot.json that is not a JSON object, and leaves it as it was', () => {
  const s = scratch();
  try {
    for (const body of ['not json {', '[1, 2]', 'null']) {
      writeFileSync(s.pilot, body);
      const r = cli(['--file', s.csv, '--write-aov', '--pilot', s.pilot], Date.parse('2026-11-08T12:00:00Z'));
      assert.equal(r.code, 1, body);
      assert.match(r.stderr, /not readable JSON|must hold the pilot rules as a JSON object/);
      assert.equal(readFileSync(s.pilot, 'utf8'), body);
    }
  } finally {
    s.clean();
  }
});

const R = () => report(BASE);
const now = Date.parse('2026-11-08T12:00:00Z');
function withPilot(p, fn) {
  const s = scratch();
  try {
    writeFileSync(s.pilot, JSON.stringify(p));
    return fn(s.pilot);
  } finally {
    s.clean();
  }
}

test('--write-aov refuses when pilot.startDate is not set or is not a real date', () => {
  for (const startDate of [null, '', '2099-02-30', '2099-01-01T00:00', '2099-01-01T24:00:00Z', '2099-01-01T24:30:00Z', '2099-01-01T00:60:00Z']) {
    withPilot({ ...PILOT, startDate }, (path) => {
      const w = writeAov(path, R(), now);
      assert.equal(w.ok, false, JSON.stringify(startDate));
      assert.match(w.reasons[0], /startDate is not a date/);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
    });
  }
});

test('--write-aov refuses when pilot.startDate is on or before now: the denominator is fixed before the start', () => {
  for (const startDate of ['2026-11-08', '2026-11-01']) {
    withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate }, (path) => {
      const w = writeAov(path, R(), now);
      assert.equal(w.ok, false, startDate);
      assert.match(w.reasons[0], /on or before now/);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
    });
  }
  withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate: '2026-11-08' }, (path) => {
    assert.equal(writeAov(path, R(), Date.parse('2026-11-08T00:00:00Z')).ok, false, 'the first instant of the start day is on it, not before');
  });
  withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate: '2026-11-09' }, (path) => {
    assert.equal(writeAov(path, { ...R(), span: { ...R().span, last: '2026-11-08' } }, now).ok, true, 'the next day is still before the start');
  });
});

test('--write-aov reads a startDate with a time as its UTC day, as creator-pilot.mjs counts day 1', () => {
  // 23:00 UTC on the 8th: day 1 is the 8th, which has begun at noon UTC, so the pilot has started.
  withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate: '2026-11-08T23:00:00Z' }, (path) => {
    const w = writeAov(path, R(), now);
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /startDate 2026-11-08T23:00:00Z is on or before now/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
  });
  // 05:00 in Sydney on the 9th is 19:00 UTC on the 8th, so day 1 is the 8th, and an order on the 8th is a pilot order.
  withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate: '2026-11-09T05:00:00+10:00' }, (path) => {
    const w = writeAov(path, { ...R(), span: { ...R().span, last: '2026-11-08' } }, Date.parse('2026-11-01T00:00:00Z'));
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /runs to 2026-11-08, on or after the pilot's start 2026-11-08:/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
  });
  // Midnight in Sydney on the 10th is 13:00 UTC on the 9th: an export to the 8th is before it, and is written.
  withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate: '2026-11-10T00:00:00+11:00' }, (path) => {
    const w = writeAov(path, { ...R(), span: { ...R().span, last: '2026-11-08' } }, now);
    assert.equal(w.ok, true, JSON.stringify(w.reasons));
    assert.match(w.message, /fixed before the start on 2026-11-09$/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 88);
  });
});

test('--write-aov refuses an export holding orders on or after the pilot start: the baseline is pre-pilot only', () => {
  withPilot({ ...PILOT, decidedOn: '2026-10-01', startDate: '2026-11-07' }, (path) => {
    const w = writeAov(path, R(), Date.parse('2026-11-01T00:00:00Z'));
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /runs to 2026-11-07, on or after the pilot's start 2026-11-07/);
  });
});

test('--write-aov refuses an export whose last order is more than 120 days before the start: an old season is not the baseline', () => {
  const ending = (last) => ({ ...R(), span: { first: dayAfter(last, -89), last, days: 90 } });
  withPilot(PILOT, (path) => {
    assert.equal(writeAov(path, ending(dayAfter('2026-12-01', -120)), now).ok, true, '120 days before is still read');
  });
  withPilot(PILOT, (path) => {
    const w = writeAov(path, ending(dayAfter('2026-12-01', -121)), now);
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /ends on 2026-08-02, more than 120 days before the pilot's start 2026-12-01/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
  });
  // A one-day export of Black Friday 2019, held against a start far ahead: refused on both counts, the age first.
  const old = shopifyCsv(baseOrders().map((o) => ({ ...o, 'Created at': '2019-11-29 10:00:00 -0500' })));
  withPilot({ ...PILOT, startDate: '2099-01-01' }, (path) => {
    assert.match(writeAov(path, report(old), now).reasons[0], /ends on 2019-11-29, more than 120 days before/);
  });
});

test('--write-aov refuses an export that spans under 28 days: one week\'s drop cannot set the baseline', () => {
  const spanning = (days) => ({ ...R(), span: { first: dayAfter('2026-11-07', 1 - (days ?? 1)), last: '2026-11-07', days } });
  withPilot(PILOT, (path) => {
    assert.equal(writeAov(path, spanning(28), now).ok, true, '28 days is read');
  });
  for (const days of [27, 1, undefined]) {
    withPilot(PILOT, (path) => {
      const w = writeAov(path, spanning(days), now);
      assert.equal(w.ok, false, String(days));
      assert.match(w.reasons[0], /under 28 days one week's drop or sale can set the baseline/);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
    });
  }
  const week = shopifyCsv(baseOrders().map((o, i) => ({ ...o, 'Created at': `${dayAfter('2026-11-01', i % 7)} 10:00:00 +1100` })));
  withPilot(PILOT, (path) => {
    assert.match(writeAov(path, report(week), now).reasons[0], /the export spans 7 days, 2026-11-01 to 2026-11-07/);
  });
});

test('--write-aov refuses a median subtotal of 0: it is the pilot\'s "unset", and a good earlier baseline is kept', () => {
  // 20 of the 40 sales are gifted at 0.00, so the lower middle order is a 0.00 one.
  const gifted = shopifyCsv(baseOrders().map((o, i) => (i < 20 ? { ...o, Subtotal: '0.00', Total: o.Shipping } : o)));
  const r = report(gifted);
  assert.equal(r.subtotalCents.median, 0);
  withPilot({ ...PILOT, baselineAovUsd: 55 }, (path) => {
    const w = writeAov(path, r, now);
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /median subtotal of the 40 orders that count is not above 0/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 55, 'the earlier baseline stands');
  });
  withPilot(PILOT, (path) => {
    assert.equal(writeAov(path, { ...R(), subtotalCents: { ...R().subtotalCents, median: Number.NaN } }, now).ok, false, 'an unknown median is not written either');
  });
  const one = shopifyCsv(baseOrders().map((o, i) => (i < 19 ? { ...o, Subtotal: '0.00', Total: o.Shipping } : o)));
  withPilot(PILOT, (path) => {
    assert.equal(writeAov(path, report(one), now).ok, true, 'with 19 gifted the median is a real sale, and is written');
  });
});

test('--write-aov refuses an export that is not in USD, because the field is baselineAovUsd', () => {
  const aud = shopifyCsv(baseOrders().map((o) => ({ ...o, Currency: 'AUD' })));
  withPilot(PILOT, (path) => {
    const w = writeAov(path, report(aud), now);
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /in US dollars and this export is in AUD/);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).baselineAovUsd, 0);
  });
});

// ------------------------------------------------------------------ the command line

test('parseArgs allows only --file, --map, --write-aov and --pilot, each once, with values where needed', () => {
  assert.deepEqual(parseArgs(['--file', 'x.csv']), { file: 'x.csv' });
  assert.deepEqual(parseArgs(['--file', 'x.csv', '--write-aov', '--pilot', 'p.json']), { file: 'x.csv', writeAov: true, pilot: 'p.json' });
  const err = (argv, re) => assert.match(parseArgs(argv).error ?? '', re, JSON.stringify(argv));
  err(['--file', 'x.csv', '--now', '2020-01-01'], /unknown argument "--now"/);
  err(['--file', 'x.csv', 'extra'], /unknown argument "extra"/);
  err(['--file', 'a.csv', '--file', 'b.csv'], /--file is given twice/);
  err(['--file', 'x.csv', '--write-aov', '--write-aov', '--pilot', 'p'], /--write-aov is given twice/);
  err(['--file'], /--file needs a value/);
  err(['--file', '--write-aov'], /--file needs a value/);
  err(['--file', ' '], /--file needs a value/);
  err([], /--file is needed/);
  err(['--file', 'x.csv', '--write-aov'], /--write-aov needs --pilot/);
  err(['--file', 'x.csv', '--pilot', 'p.json'], /--pilot only goes with --write-aov/);
});

test('parseMap refuses an entry that is not key=Column, an unknown key, a key twice and an empty column', () => {
  assert.deepEqual(parseMap('subtotal=Goods, total = Paid').map, { subtotal: 'Goods', total: 'Paid' });
  assert.match(parseMap('subtotal').error, /not key=Column/);
  assert.match(parseMap('price=Goods').error, /key "price" is not one this knows/);
  assert.match(parseMap('total=A,total=B').error, /names total twice/);
  assert.match(parseMap('total=').error, /needs a column name/);
  assert.match(parseArgs(['--file', 'x', '--map', 'price=Goods']).error, /not one this knows/);
});

test('the command line: 0 on a report, 1 on a refusal, 2 on misuse, and no "@" in any output', () => {
  const s = scratch();
  try {
    const few = join(s.dir, 'few.csv');
    writeFileSync(few, shopifyCsv(baseOrders().slice(0, 5)));
    const run = (args) => {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
      assert.ok(!`${r.stdout}${r.stderr}`.includes('@'), `"@" in the output of ${args.join(' ')}`);
      return r;
    };
    const ok = run(['--file', s.csv]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /42 orders on 83 rows/);
    assert.match(ok.stdout, /median USD 88\.00/);
    for (const leak of ['example.com', 'Sunrise', 'Hoodie', 'buyer1']) assert.ok(!ok.stdout.includes(leak), `${leak} must not be echoed`);
    const no = run(['--file', few]);
    assert.equal(no.status, 1);
    assert.match(no.stderr, /REFUSED.*\n.*unreliable/);
    assert.equal(run(['--file', s.csv, '--bogus']).status, 2);
    assert.equal(run(['--file', join(s.dir, 'missing.csv')]).status, 2);
    assert.equal(run(['--file', s.dir]).status, 2, 'a directory is not an export');
    assert.equal(run(['--file', s.csv, '--map', 'subtotal']).status, 2);
  } finally {
    s.clean();
  }
});

test('an output that would hold an "@" is replaced by a refusal before it is printed', () => {
  const s = scratch();
  try {
    const r = cli(['--file', s.csv, '--map', `${GENERIC_MAP.split('total=Paid').join('total=paid@store.test')}`]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.ok(!r.stderr.includes('@'));
    assert.match(r.stderr, /nothing is printed/);
    const misuse = cli(['--file', s.csv, '--who', 'leif@x.test']);
    assert.equal(misuse.code, 2, 'misuse stays misuse');
    assert.ok(!misuse.stderr.includes('@'));
  } finally {
    s.clean();
  }
});

test('a report that would print an "@" exits 1, and the pilot write behind it is not committed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orders@test-'));
  try {
    const csv = join(dir, 'export.csv');
    const pilot = join(dir, 'pilot.json');
    writeFileSync(csv, BASE);
    const body = JSON.stringify(PILOT);
    writeFileSync(pilot, body);
    const r = cli(['--file', csv, '--write-aov', '--pilot', pilot], now);
    assert.equal(r.code, 1);
    assert.ok(!`${r.stdout}${r.stderr}`.includes('@'));
    assert.match(r.stderr, /nothing is printed or written/);
    assert.equal(readFileSync(pilot, 'utf8'), body, 'not written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
