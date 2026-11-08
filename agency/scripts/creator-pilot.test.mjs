// The creator-results pilot is shown to refuse what it should: rules dated after the data, a corrupt line skipped,
// money that is not a number, reach, the same order twice under two spellings, the creator's own orders, a payout
// past the cap or past what is owed, a back-dated line that takes money already paid. Every guard in section 7 of the
// design (G1 to G27) has a case here that goes red without it, and so does every fix from the second review round.
// The clock is always injected (`now`, or --now on the command line): no case depends on today's date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PILOT_DEFAULTS, REASONS, toCents, hashId, normId, parseLedger, validatePilot, validateEvent, screen, status,
  checkPayout, checkAppend, format,
} from './creator-pilot.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'creator-pilot.mjs');

// ------------------------------------------------------------------ the fixture (design section 7)

// Start 2026-11-09, baseline AOV $100. A has code JOYA; B has code JOYB and selfIds = [hash('b@x')].
const PILOT = { ...PILOT_DEFAULTS, decidedOn: '2026-11-06', startDate: '2026-11-09', baselineAovUsd: 100, paidSocialBandUsd: [30, 100] };
const B_SELF = hashId('b@x');

/** Pilot day n at hh:00 UTC (day 1 is 2026-11-09; day 0 is the day before the window). */
const at = (n, hh = 10) => new Date(Date.UTC(2026, 10, 8 + n, hh)).toISOString();
/** The injected clock: noon on pilot day n. */
const nowAt = (n) => Date.parse(at(n, 12));

const CA = { ts: at(1, 8), type: 'creator', creator: 'A', code: 'JOYA', handle: '@a', followers: 4200, selfIds: [] };
const CB = { ts: at(1, 8), type: 'creator', creator: 'B', code: 'JOYB', handle: '@b', followers: 900, selfIds: [B_SELF] };
const order = (orderId, code, n, valueUsd = 100, over = {}) => ({
  ts: at(n), type: 'order', orderId, code, valueUsd, buyer: hashId(`buyer-${String(orderId).trim()}@x`), source: 'store', ...over,
});
const signup = (signupId, code, n, over = {}) => ({
  ts: at(n), type: 'signup', signupId, code, account: hashId(`acct-${signupId}@x`), completed: true, source: 'app', ...over,
});
const refund = (orderId, n, amountUsd) => ({ ts: at(n), type: 'refund', orderId, amountUsd });
const payout = (creator, n, amountUsd, ref) => ({ ts: at(n), type: 'payout', creator, amountUsd, ref });
const flag = (n, note, creator) => (creator === undefined ? { ts: at(n), type: 'flag', note } : { ts: at(n), type: 'flag', note, creator });
const post = (creator, n) => ({ ts: at(n), type: 'post', creator, url: 'https://example.com/p/1' });

/** Write each line through checkAppend, the way the CLI does; every one must be accepted. */
function build(lines, now, start = []) {
  let ledger = start;
  for (const ev of lines) {
    const r = checkAppend(ledger, PILOT, ev, now);
    assert.ok(r.ok, `setup line refused: ${JSON.stringify(ev)}: ${r.reasons.join('; ')}`);
    ledger = [...ledger, r.event];
  }
  return ledger;
}
const creatorOf = (s, id) => s.creators.find((c) => c.id === id);
const reasonsOf = (s, ref) => s.rejected.filter((r) => r.ref === ref).map((r) => r.reason);

// ------------------------------------------------------------------ the command line, in a throwaway folder

function sandbox(lines = [], pilot = PILOT) {
  const dir = mkdtempSync(join(tmpdir(), 'creator-pilot-'));
  writeFileSync(join(dir, 'pilot.json'), JSON.stringify(pilot));
  writeFileSync(join(dir, 'ledger.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  return dir;
}
const cli = (dir, ...argv) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const paths = ['--file', 'ledger.jsonl', '--pilot', 'pilot.json'];
const ledgerText = (dir) => readFileSync(join(dir, 'ledger.jsonl'), 'utf8');

// ------------------------------------------------------------------ G1 to G27

test('G1 rules not fixed before the data: decidedOn after startDate gives NOT_PRE_REGISTERED, and pay refuses', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2)], nowAt(3));
  const late = { ...PILOT, decidedOn: '2026-11-10' };
  assert.ok(validatePilot(late).some((p) => /after startDate/.test(p)));
  const s = status(L, late, nowAt(3));
  assert.equal(s.verdict, 'NOT_PRE_REGISTERED');
  assert.deepEqual(s.creators, []);
  assert.equal(s.cap, null);
  assert.equal(checkPayout(L, late, { creator: 'A', amountUsd: 15, ref: 'BANK-1' }, nowAt(3)).ok, false);
  const w = checkAppend(L, late, payout('A', 3, 15, 'BANK-1'), nowAt(3));
  assert.equal(w.ok, false);
  assert.match(w.reasons[0], /^NOT_PRE_REGISTERED/);
  // The honest rules pay the same payout, so the refusal is the rule's, not the ledger's.
  assert.equal(checkPayout(L, PILOT, { creator: 'A', amountUsd: 15, ref: 'BANK-1' }, nowAt(3)).ok, true);
});

test('G2 a corrupt ledger line stops everything: "ok\\n{bad\\nok" throws /line 2/, it does not return 2 entries', () => {
  const ok1 = JSON.stringify(CA);
  const ok2 = JSON.stringify(CB);
  assert.equal(parseLedger(`${ok1}\n\n${ok2}\n`).length, 2);
  assert.throws(() => parseLedger(`${ok1}\n{bad\n${ok2}`), /line 2: not JSON/);
  // A line that parses but is not an event is refused the same way, with its number, never skipped.
  assert.throws(() => parseLedger(`${ok1}\n${JSON.stringify({ ts: at(2), type: 'like' })}\n${ok2}`), /line 2: unknown type/);
});

test('G3 money that is not a real number is refused: toCents of "true", "", true, "12.345" is NaN', () => {
  for (const v of ['true', '', true, '12.345', null, undefined, false, 'abc', NaN, Infinity]) assert.ok(Number.isNaN(toCents(v)), JSON.stringify(v));
  assert.equal(toCents('84.50'), 8450);
  assert.equal(toCents(84.5), 8450);
  assert.equal(toCents('12.34'), 1234);
  assert.throws(() => validateEvent(order('1001', 'JOYA', 2, 'true')), /valueUsd must be a dollar amount above 0/);
  assert.throws(() => validateEvent(order('1001', 'JOYA', 2, 0)), /valueUsd must be a dollar amount above 0/);
});

test('G4 an unknown type, or a reach field, is refused: likes is never paid, and type "like" does not exist', () => {
  assert.throws(() => validateEvent({ type: 'order', likes: 50 }), /reach is never paid/);
  for (const f of ['reposts', 'follows', 'reach', 'impressions', 'views']) {
    assert.throws(() => validateEvent({ ...order('1001', 'JOYA', 2), [f]: 1 }), /reach is never paid/, f);
  }
  assert.throws(() => validateEvent({ type: 'like', ts: at(2) }), /unknown type "like"/);
  assert.throws(() => validateEvent({ ...payout('A', 3, 15, 'BANK-1'), basis: 'reach' }), /reach is never paid: a basis of "reach"/);
  assert.doesNotThrow(() => validateEvent({ ...payout('A', 3, 15, 'BANK-1'), basis: 'result' }));
});

test('G5 a code is unique: a second creator line with code " joya " is refused with /code already used/', () => {
  const L = build([CA, CB], nowAt(2));
  const r = checkAppend(L, PILOT, { ...CA, ts: at(2), creator: 'C', code: ' joya ' }, nowAt(2));
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /code already used/);
  assert.deepEqual(r.reasons, ['code already used: JOYA']);
});

test('G6 no more than 12 creators: the 13th is refused', () => {
  const creators = Array.from({ length: 13 }, (_, k) => ({ ts: at(1, 8), type: 'creator', creator: `C${k + 1}`, code: `JOY${k + 1}`, handle: `@c${k + 1}`, followers: 1, selfIds: [] }));
  const L = build(creators.slice(0, 12), nowAt(2));
  const r = checkAppend(L, PILOT, creators[12], nowAt(2));
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['the pilot is full: at most 12 creators']);
});

test('G7 a duplicate order id: verifiedOrders 1, payable $15 not $30, the second DUPLICATE_ORDER_ID, and checkAppend refuses it', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2)], nowAt(3));
  const r = checkAppend(L, PILOT, order('1001', 'JOYA', 2), nowAt(3));
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['order id 1001 is already in the ledger']);
  // A copy that got in by hand is counted once.
  const s = status([...L, order('1001', 'JOYA', 2)], PILOT, nowAt(3));
  assert.equal(creatorOf(s, 'A').verifiedOrders, 1);
  assert.equal(creatorOf(s, 'A').payableUsd, 15);
  assert.deepEqual(reasonsOf(s, '1001'), ['DUPLICATE_ORDER_ID']);
  assert.equal(s.fraud.duplicates, 1);
});

test('G8 an order must come from the store export: source "creator" is rejected UNSOURCED and pays $0', () => {
  const L = [...build([CA, CB], nowAt(3)), order('1001', 'JOYA', 2, 100, { source: 'creator' }), signup('S1', 'JOYA', 2, { source: 'web' })];
  const s = status(L, PILOT, nowAt(3));
  assert.deepEqual(reasonsOf(s, '1001'), ['UNSOURCED']);
  assert.deepEqual(reasonsOf(s, 'S1'), ['UNSOURCED']);
  assert.equal(creatorOf(s, 'A').payableUsd, 0);
  assert.equal(creatorOf(s, 'A').verifiedOrders, 0);
});

test('G9 an unknown code gives UNKNOWN_CODE, and an order before the creator joined gives BEFORE_CREATOR', () => {
  const L = build([CB, { ...CA, ts: at(3, 8) }, order('1001', 'NOPE', 2), order('1002', 'JOYA', 2), order('1003', 'JOYA', 4)], nowAt(5));
  const s = status(L, PILOT, nowAt(5));
  assert.deepEqual(reasonsOf(s, '1001'), ['UNKNOWN_CODE']);
  assert.deepEqual(reasonsOf(s, '1002'), ['BEFORE_CREATOR']);
  assert.deepEqual(reasonsOf(s, '1003'), []);
  assert.equal(creatorOf(s, 'A').payableUsd, 15);
});

test("G10 self-use: a JOYB order with buyer hash('b@x') is SELF_USE and $0; the same buyer under JOYA is verified", () => {
  const L = build([CA, CB, order('1001', 'JOYB', 2, 100, { buyer: B_SELF }), order('1002', 'JOYA', 2, 100, { buyer: B_SELF })], nowAt(3));
  const s = status(L, PILOT, nowAt(3));
  assert.deepEqual(reasonsOf(s, '1001'), ['SELF_USE']);
  assert.equal(creatorOf(s, 'B').payableUsd, 0);
  assert.deepEqual(reasonsOf(s, '1002'), []);
  assert.equal(creatorOf(s, 'A').payableUsd, 15);
  assert.equal(s.fraud.selfUse, 1);
});

test('G11 an order with no buyer is NO_BUYER, because self-use cannot be ruled out', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2, 100, { buyer: undefined })], nowAt(3));
  const s = status(L, PILOT, nowAt(3));
  assert.deepEqual(reasonsOf(s, '1001'), ['NO_BUYER']);
  assert.equal(creatorOf(s, 'A').payableUsd, 0);
});

test('G12 an order outside days 1 to 60: day 0 and day 61 give OUTSIDE_WINDOW', () => {
  const L = build([{ ...CA, ts: at(0, 8) }, order('1000', 'JOYA', 0), order('1005', 'JOYA', 5), order('1061', 'JOYA', 61)], nowAt(62));
  const s = status(L, PILOT, nowAt(62));
  assert.equal(creatorOf(s, 'A').state, 'ACTIVE');
  assert.deepEqual(reasonsOf(s, '1000'), ['OUTSIDE_WINDOW']);
  assert.deepEqual(reasonsOf(s, '1061'), ['OUTSIDE_WINDOW']);
  assert.deepEqual(reasonsOf(s, '1005'), []);
  assert.equal(creatorOf(s, 'A').payableUsd, 15);
});

test('G13 a sign-up not completed is NOT_COMPLETED; the same account under a second code is DUPLICATE_ACCOUNT', () => {
  const L = build([
    CA, CB,
    signup('S1', 'JOYA', 2, { completed: 'yes' }),
    signup('S2', 'JOYA', 2),
    signup('S3', 'JOYB', 3, { account: hashId('acct-S2@x') }),
  ], nowAt(4));
  const s = status(L, PILOT, nowAt(4));
  assert.deepEqual(reasonsOf(s, 'S1'), ['NOT_COMPLETED']);
  assert.deepEqual(reasonsOf(s, 'S2'), []);
  assert.deepEqual(reasonsOf(s, 'S3'), ['DUPLICATE_ACCOUNT']);
  assert.equal(creatorOf(s, 'A').payableUsd, 5);
  assert.equal(creatorOf(s, 'B').payableUsd, 0);
  // A repeated sign-up id is refused at write time, and counted once if it got in by hand.
  assert.deepEqual(checkAppend(L, PILOT, signup('S2', 'JOYA', 4), nowAt(4)).reasons, ['sign-up id S2 is already in the ledger']);
  const hand = status([...L, signup('S2', 'JOYB', 4, { account: hashId('fresh@x') })], PILOT, nowAt(4));
  assert.deepEqual(reasonsOf(hand, 'S2'), ['DUPLICATE_SIGNUP_ID']);
  assert.equal(creatorOf(hand, 'B').payableUsd, 0);
});

test('G14 refund netting and clawback: $15 paid on a $100 order, then a full refund: payable $0, clawback 15, pay 5 refused', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2), payout('A', 3, 15, 'BANK-1'), refund('1001', 4, 100)], nowAt(5));
  const s = status(L, PILOT, nowAt(5));
  const a = creatorOf(s, 'A');
  assert.equal(a.payableUsd, 0);
  assert.equal(a.paidUsd, 15);
  assert.equal(a.clawbackUsd, 15);
  assert.equal(a.owedUsd, 0);
  assert.equal(s.fraud.clawbacksUsd, 15);
  assert.deepEqual(reasonsOf(s, '1001'), ['REFUNDED']);
  const p = checkPayout(L, PILOT, { creator: 'A', amountUsd: 5, ref: 'BANK-2' }, nowAt(5));
  assert.equal(p.ok, false);
  assert.ok(p.reasons.some((x) => /JOYA owes a clawback of \$15\.00/.test(x)), p.reasons.join('; '));
});

test('G15 no over-refunding, and no refund for an unknown order', () => {
  const L = build([CA, order('1001', 'JOYA', 2)], nowAt(3));
  assert.deepEqual(checkAppend(L, PILOT, refund('1001', 3, 120), nowAt(3)).reasons, ['refunds on 1001 would total $120.00, more than the $100.00 order']);
  assert.deepEqual(checkAppend(L, PILOT, refund('9999', 3, 10), nowAt(3)).reasons, ['no order 9999 in the ledger to refund']);
  // A partial refund is allowed; a second one that would pass the order is not.
  const L2 = build([refund('1001', 3, 60)], nowAt(3), L);
  assert.deepEqual(checkAppend(L2, PILOT, refund('1001', 3, 50), nowAt(3)).reasons, ['refunds on 1001 would total $110.00, more than the $100.00 order']);
});

// A's 40 orders of $100 fill the $600 cap and A is paid $600. One is refunded, so A owes a $15 clawback and $15 of
// the cap frees up; B's order earns it. Paying B $15 would take payouts to $615.
const capLedger = () => build([
  CA, CB,
  ...Array.from({ length: 40 }, (_, k) => order(String(2000 + k), 'JOYA', 2 + (k % 3))),
  payout('A', 5, 600, 'BANK-1'),
  refund('2000', 6, 100),
  order('3000', 'JOYB', 7),
], nowAt(8));

test('G16 the cap is checked before writing: paid plus the new payout over $600 is refused with /cap/, and the CLI writes nothing', () => {
  const L = capLedger();
  const s = status(L, PILOT, nowAt(8));
  assert.equal(creatorOf(s, 'B').owedUsd, 15);
  assert.equal(s.cap.paidUsd, 600);
  const p = checkPayout(L, PILOT, { creator: 'B', amountUsd: 15, ref: 'BANK-2' }, nowAt(8));
  assert.equal(p.ok, false);
  assert.match(p.reasons.join(' '), /cap/);
  assert.deepEqual(p.reasons, ['paying $15.00 would take payouts to $615.00, over the $600.00 cap']);
  const dir = sandbox(L);
  try {
    const before = ledgerText(dir);
    const r = cli(dir, 'pay', ...paths, '--creator', 'B', '--amount', '15', '--ref', 'BANK-2', '--ts', at(8, 11), '--now', at(8, 12));
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /over the \$600\.00 cap/);
    assert.equal(ledgerText(dir), before);
    assert.equal(ledgerText(dir).trim().split('\n').length, L.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G17 no payout beyond what is owed: A is owed $15 and pay 16 is refused', () => {
  const L = build([CA, order('1001', 'JOYA', 2)], nowAt(3));
  const p = checkPayout(L, PILOT, { creator: 'A', amountUsd: 16, ref: 'BANK-1' }, nowAt(3));
  assert.equal(p.ok, false);
  assert.ok(p.reasons.includes('$16.00 is more than JOYA is owed ($15.00)'), p.reasons.join('; '));
  assert.equal(checkPayout(L, PILOT, { creator: 'A', amountUsd: 15, ref: 'BANK-1' }, nowAt(3)).ok, true);
});

test('G18 no payout to an unknown creator, under a duplicate ref, or of 0 or less', () => {
  const L = build([CA, order('1001', 'JOYA', 2), payout('A', 3, 5, 'BANK-1')], nowAt(3));
  assert.deepEqual(checkPayout(L, PILOT, { creator: 'Z', amountUsd: 5, ref: 'BANK-2' }, nowAt(3)).reasons, ['unknown creator "Z"']);
  const dup = checkPayout(L, PILOT, { creator: 'A', amountUsd: 5, ref: 'BANK-1' }, nowAt(3));
  assert.equal(dup.ok, false);
  assert.ok(dup.reasons.includes('payment reference BANK-1 is already in the ledger'), dup.reasons.join('; '));
  for (const amountUsd of [0, -5, '0', 'true']) {
    const p = checkPayout(L, PILOT, { creator: 'A', amountUsd, ref: 'BANK-2' }, nowAt(3));
    assert.equal(p.ok, false, JSON.stringify(amountUsd));
    assert.match(p.reasons.join(' '), /the amount must be a dollar amount above 0/);
  }
  assert.equal(checkAppend(L, PILOT, payout('A', 3, 0, 'BANK-2'), nowAt(3)).ok, false);
  assert.equal(checkPayout(L, PILOT, { creator: 'A', amountUsd: 5, ref: 'BANK-2' }, nowAt(3)).ok, true);
});

// $90 orders earn $13.50: 44 of them fill $594.00, the 45th gets the last $6.00, every one after it is CAPPED.
const hourly = (k) => new Date(Date.parse(at(2, 0)) + k * 3_600_000).toISOString();
const capOrders = Array.from({ length: 48 }, (_, k) => order(String(4000 + k), 'JOYA', 2, 90, { ts: hourly(k) }));

test('G19 results beyond the cap: the one that crosses is paid in part, the rest are CAPPED, the total is exactly 60000 cents', () => {
  const sc = screen([CA, ...capOrders], PILOT, nowAt(15));
  assert.equal(sc.results.reduce((a, r) => a + r.payableCents, 0), 60000);
  const partial = sc.results.filter((r) => r.partial);
  assert.deepEqual(partial.map((r) => [r.ref, r.payableCents, r.earnedCents]), [['4044', 600, 1350]]);
  const capped = sc.results.filter((r) => r.reason === 'CAPPED');
  assert.deepEqual(capped.map((r) => r.ref), ['4045', '4046', '4047']);
  for (const r of capped) {
    assert.equal(r.verified, true);
    assert.equal(r.payableCents, 0);
  }
  const s = status([CA, ...capOrders], PILOT, nowAt(15));
  assert.equal(s.verdict, 'CAP_REACHED');
  assert.equal(s.cap.payableUsd, 600);
  assert.equal(s.cap.remainingUsd, 0);
});

test('G20 the day-30 share rule: B at $56 on one order is 0.56 of AOV and STOPPED_DAY30; its day-31 order is CREATOR_STOPPED; the $56 is still owed', () => {
  const L = build([
    CA, CB,
    order('1001', 'JOYA', 2),
    order('2001', 'JOYB', 2, 40),
    ...Array.from({ length: 10 }, (_, k) => signup(`SB${k}`, 'JOYB', 3 + k)),
    order('2031', 'JOYB', 31),
  ], nowAt(32));
  const s = status(L, PILOT, nowAt(32));
  const b = creatorOf(s, 'B');
  assert.equal(b.state, 'STOPPED_DAY30');
  assert.equal(b.shareOfAov, 0.56);
  assert.deepEqual(reasonsOf(s, '2031'), ['CREATOR_STOPPED']);
  assert.equal(b.payableUsd, 56);
  assert.equal(b.owedUsd, 56);
  assert.equal(checkPayout(L, PILOT, { creator: 'B', amountUsd: 56, ref: 'BANK-1' }, nowAt(32)).ok, true);
  assert.equal(creatorOf(s, 'A').state, 'ACTIVE');
  assert.equal(creatorOf(s, 'A').shareOfAov, 0.15);
  // The rule runs once day 30 is over, not before.
  assert.equal(creatorOf(status(L.filter((e) => e.orderId !== '2031'), PILOT, nowAt(30)), 'B').state, 'ACTIVE');
});

test('G21 no orders by day 30 is a stop: STOPPED_NO_ORDERS, never a NaN that compares as a pass', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2)], nowAt(31));
  const s = status(L, PILOT, nowAt(31));
  assert.equal(creatorOf(s, 'B').state, 'STOPPED_NO_ORDERS');
  assert.equal(creatorOf(s, 'B').shareOfAov, null);
  assert.equal(creatorOf(s, 'A').state, 'ACTIVE');
  assert.equal(creatorOf(status(L, PILOT, nowAt(30)), 'B').state, 'ACTIVE');
  // A creator added after day 30 could never pass the rule, so the line is refused.
  const late = checkAppend(L, PILOT, { ...CA, ts: at(31), creator: 'C', code: 'JOYC' }, nowAt(31));
  assert.deepEqual(late.reasons, ['day 30 counts from the programme start, so a creator added after it could never pass the day-30 rule']);
});

// Blended cost per order: $135 order ($20.25) + one sign-up ($5) = $25.25; $100 order + 3 sign-ups = $30.00;
// $100 order by day 30 and 6 sign-ups after it = $45.00 (A's own day-30 share is 0.15, so A is never stopped).
const ledger2525 = () => build([CA, order('1001', 'JOYA', 2, 135), signup('S1', 'JOYA', 3)], nowAt(61));
const ledger30 = () => build([CA, order('1001', 'JOYA', 2), ...[3, 4, 5].map((n) => signup(`S${n}`, 'JOYA', n))], nowAt(61));
const ledger45 = () => build([CA, order('1001', 'JOYA', 2), ...[40, 41, 42, 43, 44, 45].map((n) => signup(`S${n}`, 'JOYA', n))], nowAt(61));

test('G22 the day-60 band rule: $25.25 at day 61 is CONTINUE; exactly $30, $45 or no orders is STOP_DAY60; day 60 is provisional', () => {
  const ok = status(ledger2525(), PILOT, nowAt(61));
  assert.equal(ok.blended.costPerOrderUsd, 25.25);
  assert.equal(ok.verdict, 'CONTINUE');
  assert.equal(ok.provisional, false);
  assert.equal(ok.decision, 'CONTINUE');
  const exactly30 = status(ledger30(), PILOT, nowAt(61));
  assert.equal(exactly30.blended.costPerOrderUsd, 30);
  assert.equal(creatorOf(exactly30, 'A').state, 'ACTIVE');
  assert.equal(exactly30.verdict, 'STOP_DAY60');
  const dear = status(ledger45(), PILOT, nowAt(61));
  assert.equal(dear.blended.costPerOrderUsd, 45);
  assert.equal(dear.verdict, 'STOP_DAY60');
  const none = status(build([CA], nowAt(61)), PILOT, nowAt(61));
  assert.equal(none.verdict, 'STOP_DAY60');
  assert.match(none.verdictText, /no verified orders/);
  const day60 = status(ledger2525(), PILOT, nowAt(60));
  assert.equal(day60.provisional, true);
  assert.equal(day60.decision, null);
  assert.match(day60.verdictText, /provisional, day 60 of 60/);
});

test('G23 a flag freezes: a flagged A has later orders CREATOR_STOPPED and pay refused; a flag with no creator is STOP_FLAG and refuses all payouts', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2), order('2001', 'JOYB', 2), flag(3, 'same buyer on six codes', 'A'), order('1002', 'JOYA', 4)], nowAt(5));
  const s = status(L, PILOT, nowAt(5));
  assert.deepEqual(reasonsOf(s, '1002'), ['CREATOR_STOPPED']);
  assert.equal(creatorOf(s, 'A').state, 'FLAGGED');
  assert.equal(creatorOf(s, 'A').held, true);
  assert.equal(creatorOf(s, 'A').payableUsd, 15);
  const pa = checkPayout(L, PILOT, { creator: 'A', amountUsd: 15, ref: 'BANK-1' }, nowAt(5));
  assert.equal(pa.ok, false);
  assert.ok(pa.reasons.some((x) => /JOYA is flagged/.test(x)), pa.reasons.join('; '));
  assert.equal(checkPayout(L, PILOT, { creator: 'B', amountUsd: 15, ref: 'BANK-1' }, nowAt(5)).ok, true);
  const frozen = build([flag(5, 'bot notice on the store'), order('2002', 'JOYB', 5)], nowAt(6), L);
  const fs = status(frozen, PILOT, nowAt(6));
  assert.equal(fs.verdict, 'STOP_FLAG');
  assert.deepEqual(reasonsOf(fs, '2002'), ['CREATOR_STOPPED']);
  const pb = checkPayout(frozen, PILOT, { creator: 'B', amountUsd: 15, ref: 'BANK-1' }, nowAt(6));
  assert.equal(pb.ok, false);
  assert.match(pb.reasons[0], /^STOP_FLAG: bot notice on the store/);
});

test('G24 no raw emails in the ledger: a buyer, account or self id containing "@" is refused', () => {
  assert.throws(() => validateEvent(order('1001', 'JOYA', 2, 100, { buyer: 'b@x' })), /a raw email in buyer is refused/);
  assert.throws(() => validateEvent(signup('S1', 'JOYA', 2, { account: 'c@x' })), /a raw email in account is refused/);
  assert.throws(() => validateEvent({ ...CA, selfIds: ['a@x'] }), /a raw email in selfIds is refused/);
  const r = checkAppend(build([CA], nowAt(3)), PILOT, order('1001', 'JOYA', 2, 100, { buyer: 'b@x' }), nowAt(3));
  assert.equal(r.ok, false);
  assert.match(r.reasons[0], /raw email/);
});

test('G25 no future-dated lines: a ts more than a day ahead is refused, and so is a payout dated before the result it pays', () => {
  const L = build([CA, order('1001', 'JOYA', 5)], nowAt(6));
  assert.deepEqual(checkAppend(L, PILOT, order('1002', 'JOYA', 8), nowAt(6)).reasons, [`ts ${at(8)} is more than a day in the future`]);
  assert.equal(checkAppend(L, PILOT, order('1002', 'JOYA', 7), nowAt(6)).ok, true);
  const early = checkAppend(L, PILOT, payout('A', 4, 15, 'BANK-1'), nowAt(6));
  assert.equal(early.ok, false);
  assert.ok(early.reasons.some((x) => /dated before the result it pays/.test(x)), early.reasons.join('; '));
  assert.equal(checkAppend(L, PILOT, payout('A', 5, 15, 'BANK-1'), nowAt(6)).ok, true);
  assert.deepEqual(checkPayout(L, PILOT, { creator: 'A', amountUsd: 15, ref: 'BANK-1', ts: at(9) }, nowAt(6)).reasons, ['the payout is dated more than a day in the future']);
});

test('G26 capped results do not flatter cost: 20 more capped orders leave costPerOrderUsd unchanged', () => {
  const base = [CA, ...capOrders];
  const more = Array.from({ length: 20 }, (_, k) => order(String(5000 + k), 'JOYA', 6, 90, { ts: hourly(100 + k) }));
  const s1 = status(base, PILOT, nowAt(15));
  const s2 = status([...base, ...more], PILOT, nowAt(15));
  assert.equal(s2.rejected.filter((r) => r.reason === 'CAPPED').length, 23);
  assert.equal(s2.blended.verifiedOrders, s1.blended.verifiedOrders);
  assert.equal(s2.blended.costPerOrderUsd, s1.blended.costPerOrderUsd);
  assert.equal(creatorOf(s2, 'A').costPerOrderUsd, creatorOf(s1, 'A').costPerOrderUsd);
  assert.equal(creatorOf(s2, 'A').verifiedOrders, 45);
});

test('G27 dollar signs survive formatting: /STOP_DAY60: $45.00 per order >= $30/', () => {
  const text = format(status(ledger45(), PILOT, nowAt(61)));
  assert.match(text, /STOP_DAY60: \$45\.00 per order >= \$30/);
  assert.match(text, /Cap: \$45\.00 payable of \$600\.00/);
});

// ------------------------------------------------------------------ the second review round, each fix shown to bite

test('round 2: normId gives one spelling: trimmed, one leading "#" dropped, upper-cased; nothing for a non-id', () => {
  assert.equal(normId(' #1001 '), '1001');
  assert.equal(normId('1001 '), '1001');
  assert.equal(normId(1001), '1001');
  assert.equal(normId(' ana '), 'ANA');
  assert.equal(normId('bank-0042'), 'BANK-0042');
  for (const v of [null, undefined, {}, [], NaN, true]) assert.equal(normId(v), undefined, String(v));
});

test('round 2 G7: "1001 ", " 1001", "#1001" are order 1001: each refused as a repeat, and a full refund of any spelling leaves $0', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2)], nowAt(3));
  for (const twin of ['1001 ', ' 1001', '#1001', ' #1001 ']) {
    assert.deepEqual(checkAppend(L, PILOT, order(twin, 'JOYA', 2), nowAt(3)).reasons, ['order id 1001 is already in the ledger'], JSON.stringify(twin));
  }
  const r = checkAppend(L, PILOT, refund(' 1001 ', 3, 100), nowAt(3));
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.event.orderId, '1001');
  const s = status([...L, r.event], PILOT, nowAt(3));
  assert.equal(creatorOf(s, 'A').verifiedOrders, 0);
  assert.equal(creatorOf(s, 'A').payableUsd, 0);
  assert.deepEqual(reasonsOf(s, '1001'), ['REFUNDED']);
  // The value written is the normalised one, and a creator id in another case is the same creator.
  const fresh = checkAppend(L, PILOT, order('  2002 ', 'JOYA', 2), nowAt(3));
  assert.equal(fresh.ok, true, fresh.reasons.join('; '));
  assert.equal(fresh.event.orderId, '2002');
  assert.deepEqual(checkAppend(L, PILOT, { ...CA, ts: at(2), creator: ' a ', code: 'JOYZ' }, nowAt(3)).reasons, ['creator id A already used']);
});

test('round 2: a stored id in any other spelling is refused, so a hand-edited twin makes the ledger INVALID_LEDGER', () => {
  const L = build([CA, CB, order('1001', 'JOYA', 2)], nowAt(3));
  const s = status([...L, order('1001 ', 'JOYA', 2)], PILOT, nowAt(3));
  assert.equal(s.verdict, 'INVALID_LEDGER');
  assert.match(s.verdictText, /entry 4: orderId "1001 " is not in its one spelling "1001"/);
  assert.throws(() => validateEvent({ ...CA, creator: 'ana' }), /creator "ana" is not in its one spelling "ANA"/);
  assert.throws(() => validateEvent(payout('A', 3, 15, 'bank-1')), /ref "bank-1" is not in its one spelling "BANK-1"/);
  assert.throws(() => validateEvent(signup('#s1', 'JOYA', 2)), /signupId "#s1" is not in its one spelling "S1"/);
  assert.throws(() => validateEvent(flag(3, 'odd', 'b')), /creator "b" is not in its one spelling "B"/);
});

test('round 2: an id of "undefined", "null" or "NaN", or none at all, is refused rather than paid', () => {
  for (const bad of ['undefined', 'null', 'NULL', 'NaN', ' true ']) {
    assert.throws(() => validateEvent(order(bad, 'JOYA', 2)), /order needs orderId/, bad);
  }
  const L = build([CA], nowAt(3));
  for (const bad of ['undefined', 'null', null, undefined, {}]) {
    assert.deepEqual(checkAppend(L, PILOT, order(bad, 'JOYA', 2), nowAt(3)).reasons, ['order needs orderId'], String(bad));
  }
});

test('round 2: a payout ref or creator in another spelling is the same one to checkPayout', () => {
  const L = build([CA, order('1001', 'JOYA', 2), payout('A', 3, 5, 'BANK-1')], nowAt(3));
  assert.ok(checkPayout(L, PILOT, { creator: 'A', amountUsd: 5, ref: ' bank-1 ' }, nowAt(3)).reasons.includes('payment reference BANK-1 is already in the ledger'));
  assert.equal(checkPayout(L, PILOT, { creator: ' a ', amountUsd: 5, ref: 'BANK-2' }, nowAt(3)).ok, true);
});

test('round 2: a hand-appended copy of an order under another code, dated earlier, cannot take the commission from the line already paid', () => {
  const L = [...build([CA, CB, order('1001', 'JOYA', 2), payout('A', 3, 15, 'BANK-1')], nowAt(4)), order('1001', 'JOYB', 2, 100, { ts: at(2, 9) })];
  const s = status(L, PILOT, nowAt(4));
  assert.equal(creatorOf(s, 'A').payableUsd, 15);
  assert.equal(creatorOf(s, 'A').clawbackUsd, 0);
  assert.equal(creatorOf(s, 'B').payableUsd, 0);
  assert.deepEqual(s.rejected.map((r) => [r.ref, r.code, r.reason]), [['1001', 'JOYB', 'DUPLICATE_ORDER_ID']]);
  assert.equal(checkPayout(L, PILOT, { creator: 'B', amountUsd: 15, ref: 'BANK-2' }, nowAt(4)).ok, false);
});

test('round 2: a paid result is final: a late store export or a back-dated flag that would cut what was paid is refused', () => {
  // A's $4,000 order fills the $600 cap and A is paid $600. In ts order, B's order dated day 2 would take $15 of it.
  const L = build([CA, CB, order('1001', 'JOYA', 5, 4000), payout('A', 6, 600, 'BANK-1')], nowAt(7));
  const late = checkAppend(L, PILOT, order('2001', 'JOYB', 2), nowAt(7));
  assert.equal(late.ok, false);
  assert.match(late.reasons[0], /^JOYA has been paid \$600\.00 and this line would cut their payable to \$585\.00: a paid result is final/);
  assert.match(checkAppend(L, PILOT, flag(4, 'odd', 'A'), nowAt(7)).reasons[0], /cut their payable to \$0\.00: a paid result is final/);
  assert.match(checkAppend(L, PILOT, flag(4, 'bot notice'), nowAt(7)).reasons[0], /a paid result is final/);
  // The same lines dated now cut nothing already paid, so they are taken.
  assert.equal(checkAppend(L, PILOT, flag(7, 'odd', 'A'), nowAt(7)).ok, true);
  const now7 = checkAppend(L, PILOT, order('2001', 'JOYB', 7), nowAt(7));
  assert.equal(now7.ok, true, now7.reasons.join('; '));
  // A line that lowers nobody below what they were paid is taken even while a clawback is open (G16's B order).
  assert.equal(creatorOf(status(capLedger(), PILOT, nowAt(8)), 'A').clawbackUsd, 15);
});

test('round 2: every write ends by re-validating the ledger: a refund before its order, or a post or flag before its creator, is refused', () => {
  const L = build([CA, order('1001', 'JOYA', 5)], nowAt(6));
  assert.deepEqual(checkAppend(L, PILOT, refund('1001', 4, 100), nowAt(6)).reasons, [`the refund is dated ${at(4)}, before order 1001 was placed (${at(5)})`]);
  assert.equal(checkAppend(L, PILOT, refund('1001', 5, 100), nowAt(6)).ok, true);
  const L2 = build([CB, { ...CA, ts: at(3, 8) }], nowAt(4));
  assert.deepEqual(checkAppend(L2, PILOT, post('A', 2), nowAt(4)).reasons, ['the ledger would not validate with this line: entry 3: post for a creator not in the ledger (A)']);
  assert.deepEqual(checkAppend(L2, PILOT, flag(2, 'odd', 'A'), nowAt(4)).reasons, ['the ledger would not validate with this line: entry 3: flag for a creator not in the ledger (A)']);
  assert.equal(checkAppend(L2, PILOT, post('A', 3), nowAt(4)).ok, true);
});

test('round 2: an order without source "store", or a sign-up without source "app", is refused at write time and takes no id', () => {
  const L = build([CA, CB], nowAt(3));
  for (const source of ['creator', undefined, 'Store']) {
    const r = checkAppend(L, PILOT, order('1001', 'JOYA', 2, 100, { source }), nowAt(3));
    assert.equal(r.ok, false, String(source));
    assert.match(r.reasons[0], /^an order is written only from the store's own export: source must be "store"/);
  }
  assert.equal(checkAppend(L, PILOT, order('1001', 'JOYA', 2), nowAt(3)).ok, true);
  const s = checkAppend(L, PILOT, signup('S1', 'JOYA', 2, { source: 'screenshot' }), nowAt(3));
  assert.equal(s.ok, false);
  assert.match(s.reasons[0], /^a sign-up is written only from the app: source must be "app"/);
  assert.equal(checkAppend(L, PILOT, signup('S1', 'JOYA', 2), nowAt(3)).ok, true);
});

test('round 2: validatePilot wants JSON numbers for money and rates; a string is refused by name, never a TypeError', () => {
  const L = build([CA, order('1001', 'JOYA', 2)], nowAt(3));
  const cases = [['paidSocialBandUsd', ['30', '100']], ['capUsd', '600'], ['signupUsd', '5'], ['baselineAovUsd', '100'], ['commissionRate', '0.15'], ['day30MaxShareOfAov', '0.3']];
  for (const [field, value] of cases) {
    const p = { ...PILOT, [field]: value };
    assert.ok(validatePilot(p).some((x) => x.startsWith(`${field} must`) && /JSON number/.test(x)), `${field}: ${validatePilot(p).join('; ')}`);
    assert.equal(status(L, p, nowAt(3)).verdict, 'NOT_PRE_REGISTERED', field);
    assert.equal(checkPayout(L, p, { creator: 'A', amountUsd: 15, ref: 'BANK-1' }, nowAt(3)).ok, false, field);
  }
  assert.deepEqual(validatePilot(PILOT), []);
});

test('a hand-edited ledger that breaks a whole-ledger rule is INVALID_LEDGER: no figures, and no write onto it', () => {
  const base = build([CA, CB, order('1001', 'JOYA', 2), payout('A', 3, 15, 'BANK-1')], nowAt(4));
  const extra = Array.from({ length: 11 }, (_, k) => ({ ts: at(2), type: 'creator', creator: `C${k}`, code: `JOYC${k}`, handle: '@c', followers: 1, selfIds: [] }));
  const cases = [
    [{ ...CA, ts: at(2), creator: 'C' }, /code JOYA already used/],
    [{ ...CA, ts: at(2), code: 'JOYC' }, /creator A added twice/],
    [refund('9999', 3, 10), /refund for an order not in the ledger \(9999\)/],
    [[refund('1001', 3, 60), refund('1001', 4, 60)], /refunds on 1001 exceed the order/],
    [payout('A', 4, 1, 'BANK-1'), /payment reference BANK-1 used twice/],
    [payout('A', 4, 590, 'BANK-2'), /payouts total \$605\.00, over the cap/],
    [payout('Z', 4, 1, 'BANK-3'), /payout to a creator not in the ledger \(Z\)/],
    [post('Z', 3), /post for a creator not in the ledger \(Z\)/],
    [extra, /more than 12 creators/],
  ];
  for (const [lines, re] of cases) {
    const L = [...base, ...[lines].flat()];
    const s = status(L, PILOT, nowAt(4));
    assert.equal(s.verdict, 'INVALID_LEDGER', String(re));
    assert.match(s.verdictText, re);
    assert.deepEqual(s.creators, []);
    const w = checkAppend(L, PILOT, post('A', 4), nowAt(4));
    assert.equal(w.ok, false);
    assert.match(w.reasons[0], /^INVALID_LEDGER/);
  }
  assert.equal(status(base, PILOT, nowAt(4)).verdict, 'CONTINUE');
});

test('hashId refuses to hash nothing, so missing buyers cannot all collide on one hash', () => {
  assert.throws(() => hashId(''), /nothing to hash/);
  assert.throws(() => hashId('true'), /nothing to hash/);
  assert.throws(() => hashId(undefined), /nothing to hash/);
  assert.equal(hashId(' B@X '), B_SELF);
  assert.ok(REASONS.DUPLICATE_ORDER_ID.includes('first line recorded'));
});

// ------------------------------------------------------------------ the command line

test('CLI status exits 0 only on CONTINUE, and 2 on STOP_DAY60, NOT_PRE_REGISTERED and a corrupt ledger', () => {
  const dirs = [];
  try {
    const go = sandbox(ledger2525());
    dirs.push(go);
    const r0 = cli(go, 'status', ...paths, '--now', at(61, 12));
    assert.equal(r0.code, 0, r0.out + r0.err);
    assert.match(r0.out, /Verdict {2}CONTINUE: \$25\.25 per order < \$30/);
    const stop = sandbox(ledger45());
    dirs.push(stop);
    const r1 = cli(stop, 'status', ...paths, '--now', at(61, 12));
    assert.equal(r1.code, 2);
    assert.match(r1.out, /STOP_DAY60: \$45\.00 per order >= \$30/);
    const unfixed = sandbox(ledger2525(), { ...PILOT, decidedOn: '2026-11-10' });
    dirs.push(unfixed);
    const r2 = cli(unfixed, 'status', ...paths, '--now', at(61, 12));
    assert.equal(r2.code, 2);
    assert.match(r2.out, /NOT_PRE_REGISTERED/);
    const corrupt = sandbox([CA]);
    dirs.push(corrupt);
    writeFileSync(join(corrupt, 'ledger.jsonl'), `${JSON.stringify(CA)}\n{bad\n`);
    const r3 = cli(corrupt, 'status', ...paths, '--now', at(3, 12));
    assert.equal(r3.code, 2);
    assert.match(r3.out, /INVALID_LEDGER: line 2/);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test('CLI a refused pay writes nothing: to an unknown creator, or over what is owed', () => {
  const dir = sandbox(build([CA, order('1001', 'JOYA', 2)], nowAt(3)));
  try {
    const before = ledgerText(dir);
    const r1 = cli(dir, 'pay', ...paths, '--creator', 'Z', '--amount', '5', '--ref', 'BANK-1', '--now', at(3, 12));
    assert.equal(r1.code, 1);
    assert.match(r1.err, /refused unknown creator "Z"/);
    const r2 = cli(dir, 'pay', ...paths, '--creator', 'A', '--amount', '16', '--ref', 'BANK-1', '--now', at(3, 12));
    assert.equal(r2.code, 1);
    assert.match(r2.err, /\$16\.00 is more than JOYA is owed \(\$15\.00\)/);
    assert.equal(ledgerText(dir), before);
    const r3 = cli(dir, 'pay', ...paths, '--creator', 'a', '--amount', '15', '--ref', 'bank-1', '--now', at(3, 12));
    assert.equal(r3.code, 0, r3.err);
    assert.match(ledgerText(dir), /"creator":"A","amountUsd":15,"ref":"BANK-1"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI round 2: ids are stored in one spelling, "1001 " is refused as a repeat, and an order without --source store is refused', () => {
  const dir = sandbox([]);
  try {
    const now = ['--now', at(3, 12)];
    assert.equal(cli(dir, 'add-creator', ...paths, '--id', 'ana', '--code', 'joya', '--handle', '@ana', '--followers', '4200', '--ts', at(1, 8), ...now).code, 0);
    const unsourced = cli(dir, 'order', ...paths, '--order-id', '1001', '--code', 'JOYA', '--value', '100', '--buyer-email', 'z@z.com', '--ts', at(2), ...now);
    assert.equal(unsourced.code, 1);
    assert.match(unsourced.err, /source must be "store"/);
    assert.equal(cli(dir, 'order', ...paths, '--order-id', '1001', '--code', 'JOYA', '--value', '100', '--buyer-email', 'z@z.com', '--source', 'store', '--ts', at(2), ...now).code, 0);
    const twin = cli(dir, 'order', ...paths, '--order-id', '1001 ', '--code', 'JOYA', '--value', '100', '--buyer-email', 'z@z.com', '--source', 'store', '--ts', at(2), ...now);
    assert.equal(twin.code, 1);
    assert.match(twin.err, /order id 1001 is already in the ledger/);
    const lines = ledgerText(dir).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((e) => [e.type, e.creator ?? e.orderId, e.code]), [['creator', 'ANA', 'JOYA'], ['order', '1001', 'JOYA']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI round 2: import-orders refuses a row whose id is null or not an id, instead of paying order "undefined"', () => {
  const dir = sandbox([CA]);
  try {
    writeFileSync(join(dir, 'export.json'), JSON.stringify([
      { orderId: null, code: 'JOYA', value: 100, email: 'q@r.com', ts: at(2) },
      { orderId: { value: 5 }, code: 'JOYA', value: 100, email: 'p@r.com', ts: at(2) },
      { id: ' 77 ', code: 'joya', value: 100, email: 's@r.com', ts: at(2) },
    ]));
    const r = cli(dir, 'import-orders', ...paths, '--from', 'export.json', '--now', at(3, 12));
    assert.equal(r.code, 1);
    assert.match(r.err, /refused row 1: order needs orderId/);
    assert.match(r.err, /refused row 2: order needs orderId/);
    const lines = ledgerText(dir).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.filter((e) => e.type === 'order').map((e) => e.orderId), ['77']);
    assert.doesNotMatch(ledgerText(dir), /UNDEFINED|undefined|object Object/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI round 2: a bare --file, --pilot or --from is refused, and nothing is read from or written to ./true', () => {
  const dir = sandbox([]);
  try {
    // A file called "true" that holds valid rules: without the guard a bare --pilot would read it and carry on.
    writeFileSync(join(dir, 'true'), JSON.stringify(PILOT));
    const r1 = cli(dir, 'add-creator', '--file', '--pilot', 'pilot.json', '--id', 'ana', '--code', 'JOYA', '--handle', '@ana', '--followers', '1', '--ts', at(1, 8), '--now', at(3, 12));
    assert.equal(r1.code, 1);
    assert.match(r1.err, /--file needs a path/);
    assert.equal(readFileSync(join(dir, 'true'), 'utf8'), JSON.stringify(PILOT));
    const r2 = cli(dir, 'add-creator', '--file', 'ledger.jsonl', '--pilot', '--id', 'ana', '--code', 'JOYA', '--handle', '@ana', '--followers', '1', '--ts', at(1, 8), '--now', at(3, 12));
    assert.equal(r2.code, 1);
    assert.match(r2.err, /--pilot needs a path/);
    assert.equal(ledgerText(dir), '');
    writeFileSync(join(dir, 'true'), JSON.stringify([{ orderId: '1', code: 'JOYA', value: 100, email: 'a@b.c', ts: at(2) }]));
    const r3 = cli(dir, 'import-orders', ...paths, '--from', '--now', at(3, 12));
    assert.equal(r3.code, 1);
    assert.match(r3.err, /--from needs a path/);
    assert.equal(ledgerText(dir), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI round 2: check refuses a dollar figure written as a string by name, with no stack trace', () => {
  const dir = sandbox([], { ...PILOT, capUsd: '600' });
  try {
    const r = cli(dir, 'check', ...paths);
    assert.equal(r.code, 1);
    assert.match(r.err, /capUsd must be a JSON number, not "600"/);
    assert.doesNotMatch(r.err, /TypeError/);
    const good = sandbox([]);
    try {
      const ok = cli(good, 'check', ...paths);
      assert.equal(ok.code, 0, ok.err);
      assert.match(ok.out, /cap \$600, 60 days/);
    } finally {
      rmSync(good, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
