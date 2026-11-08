// The realised-dollar record is shown to credit a dollar only through a play's own code inside its window, and to
// refuse what it should: a code shared by two plays, a plays file with a misspelt key, a date that is not a date or hours
// that are not a number, an export orders.mjs refuses, another store's export, a missing or doubled Discount Code column,
// two codes for one order and an export with no orders. It is shown never to turn an unknown into a zero: no hours, no
// code, a window the export does not reach and nothing paid each give no figure, not 0. Each guard has a case here
// that goes red without it. The fixture is a 14-order Shopify-shaped export built in this file (under 30 orders, so the
// one refusal of orders.mjs this passes over is exercised), one row per line item, with a BOM, CRLF line ends, emails
// on every row and line-item names holding commas, doubled quotes and a line break; a 44-order store pads it past 30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_ORDERS, STATUS, analyse } from './orders.mjs';
import {
  CODE_COLUMN, MONEY, attribute, checkPlays, cli, coverage, format, normCode, parseArgs, privacyGate, realise, realisedCents,
} from './realised.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'realised.mjs');
const DAY = 86_400_000;

// ------------------------------------------------------------------ the fixture

const COLUMNS = ['Name', 'Email', 'Financial Status', 'Paid at', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total',
  'Discount Code', 'Discount Amount', 'Created at', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Refunded Amount', 'Cancelled at'];
const ORDER_LEVEL = ['Financial Status', 'Paid at', 'Accepts Marketing', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total',
  'Discount Code', 'Discount Amount', 'Refunded Amount', 'Cancelled at'];
const LINE_NAMES = ['Joy Tee, "Sunrise" print / M', 'Free Hoodie\nwashed black / L', 'Plain cap'];

const money = (c) => (c / 100).toFixed(2);
const dayAfter = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** One CSV field, quoted only when it must be, the way a spreadsheet writes it. */
const field = (v) => (/[",\r\n]/.test(v) ? `"${v.split('"').join('""')}"` : v);

function order(n, day, status, subtotal, { code = '', refunded = 0, cancelled = '' } = {}) {
  return {
    Name: `#${n}`, Email: `buyer${n}@example.com`, 'Financial Status': status, 'Paid at': `${day} 10:01:00 +1100`,
    'Accepts Marketing': n % 2 ? 'yes' : 'no', Currency: 'AUD', Subtotal: money(subtotal), Shipping: '10.00', Taxes: '0.00',
    Total: money(subtotal + 1000), 'Discount Code': code, 'Discount Amount': code ? '5.00' : '0.00',
    'Created at': `${day} 10:00:00 +1100`, 'Refunded Amount': money(refunded), 'Cancelled at': cancelled, lines: 1 + (n % 3),
  };
}

/**
 * The 14-order store, in AUD, its orders from 1 Nov to 2 Dec. What each order is for:
 *   #1001, #1006, #1014  no code: unattributed, #1006 although it falls inside the gift guide's window
 *   #1002, #1003         the guide's code inside its window; #1003 written " guide10 " and part refunded (30.00)
 *   #1004                the guide's code on a pending order: counted, realises nothing yet
 *   #1005                the guide's code the day before its window: not credited
 *   #1007, #1008         Sam's codes, written "SamVip" and "SAM15"; #1008 refunded in full
 *   #1009                the guide's code and Sam's on one order: credited to neither
 *   #1010, #1012         the guide's code on a voided order and on a paid order with a "Cancelled at" date
 *   #1011                a code no play names
 *   #1013                the guide's code, refunded 45.00 on a 30.00 subtotal (the postage too): realises 0, not -15
 */
function baseOrders() {
  return [
    order(1001, '2026-11-01', 'paid', 6000),
    order(1002, '2026-11-21', 'paid', 8000, { code: 'GUIDE10' }),
    order(1003, '2026-11-22', 'partially_refunded', 10000, { code: ' guide10 ', refunded: 3000 }),
    order(1004, '2026-11-23', 'pending', 5000, { code: 'GUIDE10' }),
    order(1005, '2026-11-19', 'paid', 4000, { code: 'GUIDE10' }),
    order(1006, '2026-11-24', 'paid', 9000),
    order(1007, '2026-11-15', 'paid', 12000, { code: 'SamVip' }),
    order(1008, '2026-11-16', 'refunded', 7000, { code: 'SAM15', refunded: 7700 }),
    order(1009, '2026-11-25', 'paid', 5500, { code: 'GUIDE10, SAM15' }),
    order(1010, '2026-11-26', 'voided', 20000, { code: 'GUIDE10' }),
    order(1011, '2026-11-27', 'paid', 6500, { code: 'WELCOME5' }),
    order(1012, '2026-11-28', 'paid', 7500, { code: 'GUIDE10', cancelled: '2026-11-28 20:00:00 +1100' }),
    order(1013, '2026-11-29', 'paid', 3000, { code: 'GUIDE10', refunded: 4500 }),
    order(1014, '2026-12-02', 'paid', 4500),
  ];
}

/** The same store with 30 more uncoded sales from 2 to 18 Nov: 44 orders, past orders.mjs's 30. */
const paddedOrders = () => [...baseOrders(), ...Array.from({ length: 30 }, (_, i) => order(2001 + i, dayAfter('2026-11-02', i % 17), 'paid', 5000))];

/** Shopify's shape: order-level fields on the first row of an order only, Name, Email and Created at on every row. */
function shopifyCsv(orders, { columns = COLUMNS } = {}) {
  const lines = [columns.map(field).join(',')];
  for (const o of orders) {
    for (let k = 0; k < o.lines; k++) {
      const row = { ...o, 'Lineitem quantity': String(k + 1), 'Lineitem name': LINE_NAMES[k], 'Lineitem price': '25.00' };
      if (k > 0) for (const c of ORDER_LEVEL) row[c] = '';
      if (k > 0) Object.assign(row, o.later ?? {});
      lines.push(columns.map((c) => field(row[c] ?? '')).join(','));
    }
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Edit one order of the base store, by its number. */
const withOrder = (n, over) => baseOrders().map((o) => (o.Name === `#${n}` ? { ...o, ...over } : o));

const PLAYS = Object.freeze([
  { play: 'Gift guide', from: '2026-11-20', to: '2026-11-30', codes: ['GUIDE10'], hours: 2 },
  { play: 'Creator Sam', from: '2026-11-10', to: '2026-12-10', codes: ['sam15', ' SamVip '] },
  { play: 'Abandoned checkout', from: '2026-11-12', to: '2027-01-05', codes: [], holdout: { controlShare: 0.1, count: 2 } },
  { play: 'Spring drop', from: '2026-09-01', to: '2026-09-30', codes: ['SPRING'], hours: 1 },
]);
/** A fresh copy of the plays, edited. */
const plays = (edit) => {
  const p = structuredClone(PLAYS);
  edit?.(p);
  return p;
};

const BASE = shopifyCsv(baseOrders());

const report = (text, value = PLAYS, opts) => {
  const r = realise(text, value, opts);
  assert.equal(r.verdict, 'REPORT', `expected a report, got ${JSON.stringify(r.reasons)}`);
  return r.report;
};
const refusal = (text, value = PLAYS, opts) => {
  const r = realise(text, value, opts);
  assert.equal(r.verdict, 'REFUSED', 'expected a refusal, got a report');
  return r.reasons.join('\n');
};
const play = (rep, name) => rep.plays.find((p) => p.play === name);
const problems = (value) => {
  const c = checkPlays(value);
  assert.ok(c.problems, `expected the plays to be refused, got ${JSON.stringify(c.plays)}`);
  return c.problems.join('\n');
};
/** orders.mjs's own gate, waved through: only for showing this file's own checks hold without it. */
const OPEN = () => ({ verdict: 'REPORT', report: {} });

// ------------------------------------------------------------------ crediting

test('the fixture: each play gets only what its own code brought inside its window, and nothing by date', () => {
  const r = report(BASE);
  assert.equal(r.currency, 'AUD');
  assert.equal(r.orders, 14);
  assert.deepEqual(r.span, { first: '2026-11-01', last: '2026-12-02' });
  assert.equal(r.realisedCents, 62500);
  assert.deepEqual(r.buckets, {
    credited: { orders: 8, realisedCents: 27000 },
    unattributed: { orders: 3, realisedCents: 19500 },
    other: { orders: 1, realisedCents: 6500 },
    outside: { orders: 1, realisedCents: 4000 },
    contested: { orders: 1, realisedCents: 5500 },
  });
  const guide = play(r, 'Gift guide');
  assert.deepEqual(
    { orders: guide.orders, paid: guide.paid, awaiting: guide.awaiting, void: guide.void, paidCents: guide.paidCents, realisedCents: guide.realisedCents, refundedOrders: guide.refundedOrders, perHourCents: guide.perHourCents, outside: guide.outside, contested: guide.contested, coverage: guide.coverage },
    { orders: 6, paid: 3, awaiting: 1, void: 2, paidCents: 21000, realisedCents: 15000, refundedOrders: 2, perHourCents: 7500, outside: 1, contested: 1, coverage: 'full' },
  );
  assert.ok(Math.abs(guide.refundedShare - 6000 / 21000) < 1e-12);
  const sam = play(r, 'Creator Sam');
  assert.deepEqual(sam.codes, ['SAM15', 'SAMVIP'], 'the plays file is read in one spelling');
  assert.deepEqual(
    { orders: sam.orders, paid: sam.paid, paidCents: sam.paidCents, realisedCents: sam.realisedCents, refundedOrders: sam.refundedOrders, contested: sam.contested, coverage: sam.coverage },
    { orders: 2, paid: 2, paidCents: 19000, realisedCents: 12000, refundedOrders: 1, contested: 1, coverage: 'partial' },
  );
  assert.ok(Math.abs(sam.refundedShare - 7000 / 19000) < 1e-12);
});

test('an order with no code is unattributed, even on a day inside a play\'s window: a date never credits a dollar', () => {
  const none = report(shopifyCsv(baseOrders().map((o) => ({ ...o, 'Discount Code': '' }))));
  assert.deepEqual(none.buckets.credited, { orders: 0, realisedCents: 0 });
  assert.deepEqual(none.buckets.unattributed, { orders: 14, realisedCents: 62500 });
  const guide = play(none, 'Gift guide');
  assert.equal(guide.orders, 0);
  assert.equal(guide.realisedCents, 0, 'a window the export covers in full, with no coded order in it, is a real zero');
  assert.equal(attribute({ codes: [], day: '2026-11-24' }, new Map([['GUIDE10', { from: '2026-11-20', to: '2026-11-30' }]])).bucket, 'unattributed');
});

test('a play\'s code outside its window is not credited, and is counted under the play', () => {
  const r = report(shopifyCsv(withOrder(1002, { 'Created at': '2026-12-01 09:00:00 +1100' })));
  const guide = play(r, 'Gift guide');
  assert.equal(guide.orders, 5);
  assert.equal(guide.outside, 2);
  assert.equal(guide.realisedCents, 7000);
  assert.deepEqual(r.buckets.outside, { orders: 2, realisedCents: 12000 });
  const g = { from: '2026-11-20', to: '2026-11-30' };
  const by = new Map([['GUIDE10', g]]);
  assert.equal(attribute({ codes: ['GUIDE10'], day: '2026-11-20' }, by).bucket, 'credited', 'the first day is inside');
  assert.equal(attribute({ codes: ['GUIDE10'], day: '2026-11-30' }, by).bucket, 'credited', 'the last day is inside');
  assert.equal(attribute({ codes: ['GUIDE10'], day: '2026-11-19' }, by).bucket, 'outside');
  assert.equal(attribute({ codes: ['GUIDE10'], day: '2026-12-01' }, by).bucket, 'outside');
});

test('an order carrying the codes of two plays is credited to neither; a code no play names does not contest one', () => {
  const r = report(BASE);
  assert.deepEqual(r.buckets.contested, { orders: 1, realisedCents: 5500 });
  assert.equal(play(r, 'Gift guide').contested, 1);
  assert.equal(play(r, 'Creator Sam').contested, 1);
  const stacked = report(shopifyCsv(withOrder(1009, { 'Discount Code': 'GUIDE10, WELCOME5' })));
  assert.equal(play(stacked, 'Gift guide').orders, 7, 'the guide\'s code beside an unknown one is the guide\'s');
  assert.equal(stacked.buckets.contested.orders, 0);
});

test('a code no play names is counted and never credited', () => {
  const r = report(BASE);
  assert.deepEqual(r.buckets.other, { orders: 1, realisedCents: 6500 });
  assert.equal(attribute({ codes: ['WELCOME5'], day: '2026-11-27' }, new Map()).bucket, 'other');
});

test('codes match after trimming, ignoring case, in the plays file and in the export alike', () => {
  assert.equal(normCode('  guide10 '), 'GUIDE10');
  const r = report(BASE);
  assert.equal(play(r, 'Gift guide').orders, 6, '" guide10 " on #1003 is the guide\'s');
  assert.equal(play(r, 'Creator Sam').orders, 2, '"SamVip" on #1007 is Sam\'s " SamVip "');
});

// ------------------------------------------------------------------ what one order realised

test('realised: a refund comes off, never below 0; a refunded order, an unpaid one and a void one realise nothing', () => {
  const paid = { money: 'paid', status: 'paid', subtotal: 10000, refunded: 0 };
  assert.equal(realisedCents(paid), 10000);
  assert.equal(realisedCents({ ...paid, status: 'partially_refunded', refunded: 3000 }), 7000);
  assert.equal(realisedCents({ ...paid, refunded: 14000 }), 0, 'a refund holding the postage too never makes a negative');
  assert.equal(realisedCents({ ...paid, status: 'refunded', refunded: 0 }), 0, 'refunded in full is nothing kept, whatever the amount column says');
  assert.equal(realisedCents({ ...paid, money: 'awaiting', status: 'pending' }), 0, 'money not in hand is not realised');
  assert.equal(realisedCents({ ...paid, money: 'void', status: 'voided' }), 0);
});

test('a paid order with a "Cancelled at" date is void and realises nothing', () => {
  const guide = play(report(BASE), 'Gift guide');
  assert.equal(guide.void, 2, '#1010 voided and #1012 cancelled');
  assert.equal(guide.realisedCents, 15000, '#1012\'s 75.00 is not in it');
});

test('every status orders.mjs knows is classed here exactly once, and nothing else is', () => {
  assert.deepEqual(Object.keys(MONEY).sort(), Object.keys(STATUS).sort());
  for (const v of Object.values(MONEY)) assert.ok(['paid', 'awaiting', 'void'].includes(v));
  for (const s of ['voided', 'expired', 'cancelled', 'canceled', 'failed']) assert.equal(MONEY[s], 'void', s);
  for (const s of ['pending', 'authorized', 'authorised', 'partially_paid']) assert.equal(MONEY[s], 'awaiting', s);
});

// ------------------------------------------------------------------ unknown is never zero

test('unknown is never zero: no code, no coverage, no hours and nothing paid each give no figure, and the printout says so', () => {
  const r = report(BASE);
  const flow = play(r, 'Abandoned checkout');
  assert.equal(flow.measured, false);
  assert.equal(flow.realisedCents, null, 'a play with no code cannot be credited by this export, which is not the same as 0');
  assert.equal(flow.orders, null);
  const spring = play(r, 'Spring drop');
  assert.equal(spring.coverage, 'none');
  assert.equal(spring.realisedCents, null, 'a window the export does not reach is unknown');
  assert.equal(spring.perHourCents, null, 'even with hours given');
  assert.equal(play(r, 'Creator Sam').perHourCents, null, 'no hours, no figure per hour');
  const pend = report(shopifyCsv(withOrder(1004, { 'Discount Code': 'PEND' })), plays((p) => p.push({ play: 'Pending only', from: '2026-11-20', to: '2026-11-30', codes: ['PEND'] })));
  const only = play(pend, 'Pending only');
  assert.equal(only.orders, 1);
  assert.equal(only.paidCents, 0);
  assert.equal(only.refundedShare, null, 'nothing paid gives no refunded share, not 0%');
  const out = format(pend);
  assert.match(out, /PLAY {2}Pending only[^\n]*\n {2}1 order credited: 0 paid, 1 awaiting payment[^\n]*\n {2}realised AUD 0\.00 of AUD 0\.00 paid; nothing paid yet, so no refunded share/);
  assert.match(out, /PLAY {2}Abandoned checkout {2}2026-11-12 to 2027-01-05 {2}no code\n {2}it carries no code, so this export can credit it no dollar/);
  assert.match(out, /PLAY {2}Spring drop[^\n]*\n {2}NOT COVERED: the export's orders run 2026-11-01 to 2026-12-02/);
  assert.match(out, /per Leif hour: unknown, because the plays file gives no hours/);
  assert.doesNotMatch(out, /NaN|undefined|null/);
});

test('a window the export\'s orders do not span is INCOMPLETE, and its dollars are "at least"', () => {
  const span = { first: '2026-11-01', last: '2026-12-02' };
  assert.equal(coverage({ from: '2026-11-01', to: '2026-12-02' }, span), 'full');
  assert.equal(coverage({ from: '2026-10-31', to: '2026-11-30' }, span), 'partial');
  assert.equal(coverage({ from: '2026-11-20', to: '2026-12-03' }, span), 'partial');
  assert.equal(coverage({ from: '2026-09-01', to: '2026-10-31' }, span), 'none');
  assert.equal(coverage({ from: '2026-12-03', to: '2026-12-31' }, span), 'none');
  const out = format(report(BASE));
  assert.match(out, /PLAY {2}Creator Sam {2}2026-11-10 to 2026-12-10 {2}codes SAM15, SAMVIP\n[^\n]*\n {2}realised at least AUD 120\.00 of AUD 190\.00 paid; refunded share 36\.8%, on 1 order\n[^\n]*\n {2}INCOMPLETE: the window runs 2026-11-10 to 2026-12-10 and the export's orders run 2026-11-01 to 2026-12-02/);
});

test('every order lands in exactly one bucket: the buckets add up to the whole export', () => {
  for (const text of [BASE, shopifyCsv(paddedOrders())]) {
    const r = report(text);
    const b = Object.values(r.buckets);
    assert.equal(b.reduce((a, x) => a + x.orders, 0), r.orders);
    assert.equal(b.reduce((a, x) => a + x.realisedCents, 0), r.realisedCents);
    const credited = r.plays.filter((p) => p.measured).reduce((a, p) => a + p.orders, 0);
    assert.equal(credited, r.buckets.credited.orders, 'no order is credited to two plays');
  }
});

test('the printout: every bucket, each play\'s orders, money, share, hours, codes and holdout, in the export\'s currency', () => {
  const out = format(report(BASE));
  assert.match(out, /^REALISED {2}14 orders in Shopify's orders export, 2026-11-01 to 2026-12-02, in AUD: AUD 625\.00 realised in all/);
  assert.match(out, /credited to a play, by its own code inside its window: 8 orders, AUD 270\.00 realised/);
  assert.match(out, /no code, so unattributed whatever its date: 3 orders, AUD 195\.00 realised/);
  assert.match(out, /a code no play names \(counted, never printed\): 1 order, AUD 65\.00 realised/);
  assert.match(out, /under 30 orders count towards order value/);
  assert.match(out, /PLAY {2}Gift guide {2}2026-11-20 to 2026-11-30 {2}code GUIDE10\n {2}6 orders credited: 3 paid, 1 awaiting payment, 2 voided or cancelled\n {2}realised AUD 150\.00 of AUD 210\.00 paid; refunded share 28\.6%, on 2 orders\n {2}AUD 75\.00 per Leif hour, over 2 h\n {2}1 more order carried its code outside the window: not credited\n {2}1 more order carried its code and another play's: credited to neither/);
  assert.match(out, /holdout: 2 people held out \(10\.0%\)\. It credits no dollar here/);
  assert.ok(!out.includes('WELCOME5'), 'a code no play names is never printed');
});

// ------------------------------------------------------------------ the plays file

test('checkPlays accepts the fixture and puts every code in one spelling', () => {
  const c = checkPlays(PLAYS);
  assert.ok(c.plays, JSON.stringify(c.problems));
  assert.deepEqual(c.plays.map((p) => p.codes), [['GUIDE10'], ['SAM15', 'SAMVIP'], [], ['SPRING']]);
});

test('a code shared by two plays is refused, in any case or spacing and whatever their windows', () => {
  assert.match(problems(plays((p) => { p[3].codes = [' guide10']; })), /the code GUIDE10 is named by play 1 and by play 4 \("Spring drop"\): a code shared by two plays/);
  assert.match(refusal(BASE, plays((p) => { p[1].codes.push('GUIDE10'); })), /^the plays file: the code GUIDE10 is named by play 1/);
  assert.match(problems(plays((p) => { p[0].codes.push('Guide10'); })), /play 1 \("Gift guide"\) names the code GUIDE10 twice/);
});

test('checkPlays refuses a misspelt key, a bad name, a date that is not a date, a window backwards and a bad code', () => {
  assert.match(problems({ play: 'x' }), /a list of plays is needed/);
  assert.match(problems([]), /no play is listed/);
  assert.match(problems(['x']), /play 1 is not an object/);
  assert.match(problems(plays((p) => { p[0].hour = 2; })), /play 1 has the key "hour", which this does not know/);
  assert.match(problems(plays((p) => { p[0].__proto__x = 1; })), /has the key "__proto__x"/);
  assert.match(problems(plays((p) => { p[0].play = ' '; })), /play 1 needs its name/);
  assert.match(problems(plays((p) => { p[1].play = 'gift GUIDE'; })), /play 2 \("gift GUIDE"\) has the same name as play 1/);
  for (const bad of ['2026-11-31', '1', '20/11/2026', '2026-11-20T00:00:00Z', 20261120]) {
    assert.match(problems(plays((p) => { p[0].from = bad; })), /"from" must be the window's first day, written YYYY-MM-DD/, String(bad));
    assert.match(problems(plays((p) => { p[0].to = bad; })), /"to" must be the window's last day/, String(bad));
  }
  assert.match(problems(plays((p) => { p[0].to = '2026-11-19'; })), /the window ends on 2026-11-19, before it starts on 2026-11-20/);
  for (const bad of ['G', 'GUIDE 10', 'GUIDE10,SAM15', 'joy@code', '', 10, null]) {
    assert.match(problems(plays((p) => { p[0].codes = [bad]; })), /each code must be 2 to 32 letters, digits, - or _/, String(bad));
  }
  assert.match(problems(plays((p) => { p[0].codes = 'GUIDE10'; })), /"codes" must be a list/);
});

test('a play no dollar could ever be credited to is refused: no code and no holdout', () => {
  assert.match(problems(plays((p) => { delete p[2].holdout; })), /play 3 \("Abandoned checkout"\) has no code and no holdout/);
});

test('hours must be a number above 0 when given: a string, 0, a negative and a non-number are refused', () => {
  for (const bad of ['2', 0, -1, null, true, [2]]) {
    assert.match(problems(plays((p) => { p[0].hours = bad; })), /"hours" must be Leif's hours on it, a number above 0/, JSON.stringify(bad));
  }
  assert.ok(checkPlays(plays((p) => { p[0].hours = 0.25; })).plays);
});

test('a holdout must say the share held out (between 0 and 1) and how many people (a whole number, 1 or more)', () => {
  for (const bad of [0, 1, 1.5, -0.1, '0.1', null]) {
    assert.match(problems(plays((p) => { p[2].holdout.controlShare = bad; })), /holdout.controlShare must be the share held out/, JSON.stringify(bad));
  }
  for (const bad of [0, 2.5, -1, '2', null]) {
    assert.match(problems(plays((p) => { p[2].holdout.count = bad; })), /holdout.count must be how many people were held out/, JSON.stringify(bad));
  }
  assert.match(problems(plays((p) => { p[2].holdout = 0.1; })), /"holdout" must be \{ "controlShare", "count" \}/);
  assert.match(problems(plays((p) => { p[2].holdout.orders = 1; })), /the holdout has the key "orders"/);
});

test('a play name holding an "@" is refused, and the refusal does not repeat it', () => {
  const p = problems(plays((x) => { x[0].play = 'sam@creator.test'; }));
  assert.match(p, /play 1 needs its name in "play": up to 80 characters, with no "@"/);
  assert.ok(!p.includes('creator.test'));
});

// ------------------------------------------------------------------ the export

test('every refusal of orders.mjs is a refusal here, with its own reasons', () => {
  const cases = {
    'Accepts Marketing left blank': shopifyCsv(withOrder(1002, { 'Accepts Marketing': '' })),
    'two Totals for one order': shopifyCsv(withOrder(1002, { lines: 2, later: { Total: '1.00' } })),
    'two currencies': shopifyCsv(withOrder(1002, { Currency: 'USD' })),
    'an email for an order number': shopifyCsv(withOrder(1002, { Name: 'buyer@example.com' })),
    'a status it does not know': shopifyCsv(withOrder(1002, { 'Financial Status': 'gifted' })),
    'a day/month date': shopifyCsv(withOrder(1002, { 'Created at': '21/11/2026' })),
    'money that is not a number': shopifyCsv(withOrder(1002, { Subtotal: 'N/A' })),
    'a row short of fields': `${BASE}#1099,short\r\n`,
    'a quote never closed': `${BASE}#1099,"open\r\n`,
  };
  for (const [name, text] of Object.entries(cases)) {
    const a = analyse(text);
    assert.equal(a.verdict, 'REFUSED', `${name}: orders.mjs refuses it`);
    const r = realise(text, PLAYS);
    assert.equal(r.verdict, 'REFUSED', `${name}: so does realised.mjs`);
    assert.ok(!r.reasons.join('\n').includes('@'), name);
  }
  for (const name of ['Accepts Marketing left blank', 'two Totals for one order']) {
    assert.deepEqual(realise(cases[name], PLAYS).reasons, analyse(cases[name]).reasons, `${name}: only orders.mjs reads it, and its reasons stand`);
  }
});

test('this file\'s own checks hold even when orders.mjs\'s gate lets an export through', () => {
  const open = (text) => refusal(text, PLAYS, { gate: OPEN });
  assert.match(open(shopifyCsv(withOrder(1002, { Subtotal: 'N/A' }))), /order #1002: its subtotal, refund, date or currency cannot be read here/);
  assert.match(open(shopifyCsv(withOrder(1002, { 'Created at': '21/11/2026' }))), /order #1002: its subtotal, refund, date or currency/);
  assert.match(open(shopifyCsv(withOrder(1002, { 'Financial Status': 'gifted' }))), /order #1002: whether the money is in hand for the status "gifted" has not been decided here/);
  assert.match(open(shopifyCsv(withOrder(1002, { 'Financial Status': 'constructor' }))), /status "constructor" has not been decided/);
  assert.match(open(shopifyCsv(withOrder(1002, { Currency: 'USD' }))), /mixes currencies \(AUD, USD\)/);
  assert.match(open(`${BASE}#1099,short\r\n`), /row 30 does not have the header's 18 fields/);
  assert.match(open(shopifyCsv(withOrder(1002, { Name: 'buyer@example.com' }))), /has no order number that can be read/);
});

test('under 30 orders: orders.mjs\'s refusal of a median is the one passed over, and only when its count agrees', () => {
  const a = analyse(BASE);
  assert.equal(a.verdict, 'REFUSED');
  assert.equal(a.reasons.length, 1);
  assert.match(a.reasons[0], /^only 11 orders count towards order value \(3 more were voided, refunded or cancelled\)/, 'the wording this reads is pinned');
  assert.equal(report(BASE).fewerThanMin, true);
  const few = (n) => () => ({ verdict: 'REFUSED', reasons: [`only ${n} orders count towards order value: below ${MIN_ORDERS} the median is unreliable`] });
  assert.match(refusal(BASE, PLAYS, { gate: few(12) }), /^only 12 orders/, 'a count that is not this file\'s own leaves the refusal standing');
  assert.equal(report(BASE, PLAYS, { gate: few(11) }).orders, 14);
  const two = () => ({ verdict: 'REFUSED', reasons: [few(11)().reasons[0], 'something else is wrong'] });
  assert.match(refusal(BASE, PLAYS, { gate: two }), /something else is wrong/, 'the pass needs it to be the only reason');
  const padded = shopifyCsv(paddedOrders());
  assert.equal(analyse(padded).verdict, 'REPORT');
  const r = report(padded);
  assert.equal(r.fewerThanMin, false);
  assert.equal(r.orders, 44);
  assert.deepEqual(r.buckets.unattributed, { orders: 33, realisedCents: 169500 });
  assert.doesNotMatch(format(r), /under 30 orders/);
});

test('only Shopify\'s export is read: another store\'s is refused without pointing at a --map this command does not take', () => {
  const generic = 'Order,Date,Cur,State,Opt in,Goods,Postage,Paid,Refund,Discount Code\n1,2026-11-21,AUD,paid,no,80.00,10.00,90.00,0.00,GUIDE10\n';
  const why = refusal(generic);
  assert.match(why, /only Shopify's is read/);
  assert.doesNotMatch(why, /--map/);
});

test('the Discount Code column must be in the export, once', () => {
  assert.equal(CODE_COLUMN, 'Discount Code');
  assert.match(refusal(shopifyCsv(baseOrders(), { columns: COLUMNS.filter((c) => c !== CODE_COLUMN) })), /has no "Discount Code" column, so no order can be credited/);
  const twice = shopifyCsv(baseOrders(), { columns: [...COLUMNS, CODE_COLUMN] });
  assert.match(refusal(twice), /the column "Discount Code" appears 2 times/);
});

test('an order whose rows carry two different codes is refused, never picked between', () => {
  const text = shopifyCsv(withOrder(1002, { lines: 2, later: { 'Discount Code': 'SAM15' } }));
  assert.match(refusal(text), /order #1002 carries two different Discount Code values \(rows \d+ and \d+\)/);
  const same = shopifyCsv(withOrder(1002, { lines: 2, later: { 'Discount Code': 'GUIDE10' } }));
  assert.equal(play(report(same), 'Gift guide').orders, 6, 'the same code repeated on a later row is one code');
});

test('an export with no orders is refused: an empty file is not a store that sold nothing', () => {
  assert.match(refusal(shopifyCsv([])), /the export holds no orders/);
  assert.match(refusal(''), /no header row/);
});

// ------------------------------------------------------------------ the command line

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'realised-'));
  const csv = join(dir, 'export.csv');
  const json = join(dir, 'plays.json');
  writeFileSync(csv, BASE);
  writeFileSync(json, JSON.stringify(PLAYS));
  return { dir, csv, json, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('parseArgs allows only --file and --plays, each once, both needed, each with a value', () => {
  assert.deepEqual(parseArgs(['--file', 'x.csv', '--plays', 'p.json']), { file: 'x.csv', plays: 'p.json' });
  const err = (argv, re) => assert.match(parseArgs(argv).error ?? '', re, JSON.stringify(argv));
  err(['--file', 'x.csv', '--plays', 'p.json', '--now', '2020-01-01'], /unknown argument "--now"/);
  err(['--file', 'x.csv', '--plays', 'p.json', 'extra'], /unknown argument "extra"/);
  err(['--file', 'a.csv', '--file', 'b.csv', '--plays', 'p.json'], /--file is given twice/);
  err(['--plays', 'p.json', '--plays', 'q.json', '--file', 'x.csv'], /--plays is given twice/);
  err(['--file'], /--file needs a value/);
  err(['--file', '--plays', 'p.json'], /--file needs a value/);
  err(['--file', ' ', '--plays', 'p.json'], /--file needs a value/);
  err(['--plays', 'p.json'], /--file is needed/);
  err(['--file', 'x.csv'], /--plays is needed/);
});

test('the command line: 0 on a report, 1 on a refusal, 2 on misuse, and nothing from a customer in any output', () => {
  const s = scratch();
  try {
    const run = (args) => {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
      assert.ok(!`${r.stdout}${r.stderr}`.includes('@'), `"@" in the output of ${args.join(' ')}`);
      return r;
    };
    const ok = run(['--file', s.csv, '--plays', s.json]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^REALISED {2}14 orders/);
    for (const leak of ['example.com', 'buyer10', 'Sunrise', 'Hoodie', 'WELCOME5', '#10']) assert.ok(!ok.stdout.includes(leak), `${leak} must not be echoed`);
    const shared = join(s.dir, 'shared.json');
    writeFileSync(shared, JSON.stringify(plays((p) => { p[3].codes = ['GUIDE10']; })));
    const no = run(['--file', s.csv, '--plays', shared]);
    assert.equal(no.status, 1);
    assert.match(no.stderr, /^REFUSED {2}no dollar is credited, because:\n {2}- the plays file: the code GUIDE10 is named by play 1/);
    const bom = join(s.dir, 'bom.json');
    writeFileSync(bom, `\ufeff${JSON.stringify(PLAYS)}`);
    assert.equal(run(['--file', s.csv, '--plays', bom]).status, 0, 'a plays file saved with a BOM is still read');
    const broken = join(s.dir, 'broken.json');
    writeFileSync(broken, '[{"play": ');
    assert.equal(run(['--file', s.csv, '--plays', broken]).status, 1);
    assert.equal(run(['--file', s.csv, '--plays', s.json, '--bogus']).status, 2);
    assert.equal(run(['--file', join(s.dir, 'missing.csv'), '--plays', s.json]).status, 2);
    assert.equal(run(['--file', s.csv, '--plays', join(s.dir, 'missing.json')]).status, 2);
    assert.equal(run(['--file', s.dir, '--plays', s.json]).status, 2, 'a directory is not an export');
  } finally {
    s.clean();
  }
});

test('an output that would hold an "@" is replaced by a refusal before it is printed', () => {
  const g = privacyGate(0, 'REALISED  a@b', '');
  assert.deepEqual([g.code, g.stdout], [1, '']);
  assert.match(g.stderr, /nothing is printed/);
  assert.ok(!g.stderr.includes('@'));
  assert.equal(privacyGate(2, '', 'unknown argument "leif@x.test"').code, 2, 'misuse stays misuse');
  assert.deepEqual(privacyGate(0, 'clean', ''), { code: 0, stdout: 'clean', stderr: '' });
  const dir = mkdtempSync(join(tmpdir(), 'realised@test-'));
  try {
    const r = cli(['--file', join(dir, 'missing.csv'), '--plays', join(dir, 'plays.json')]);
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes('@'), 'a path holding an "@" is not echoed');
    const misuse = cli(['--file', 'x.csv', '--plays', 'p.json', '--who', 'leif@x.test']);
    assert.equal(misuse.code, 2);
    assert.ok(!misuse.stderr.includes('@'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
