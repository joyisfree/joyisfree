// The A/B analyser is shown to refuse what it should: a rule dated after the send, a blank cell read as zero, a tie
// handed to arm A, a peek before the analysis date, a sample the formula once called big enough. Every guard and
// every verdict has a case here that goes red without it, and the sample-size formula is pinned to the reviewers'
// table so it cannot drift back to the version that came out a third too small. The second review added: the
// interval pinned to Newcombe's published examples, the z-test's false-winner rate measured by exact enumeration
// (so its comment cannot overclaim again), a plan that survives its own 5% tolerance, a bare date never ordered
// against a timestamp, a strict command line, an exit-code test for every verdict, and the run-sheet's figures
// checked against the tool. The third added: an arm past its plan, the interval at the registered level, a floor
// figure never rounded up to the floor, the clock asked as well as analysedOn (and the two dates written alike), the
// strictDate ranges for minutes, seconds and offset minutes, and the false-winner figures measured again. The fourth
// added: the plan the preflight names is the plan the analysis reads (a 44,000 list end to end), the band --check
// prints is the band read, and an arm past its plan says the default stands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyse, requiredPerArm, detectableLiftPct, normalCdf, erf, strictDate, format, preflight, checkPreRegistration,
  differenceInterval, parseArgs, exitCode, MIN_EXPECTED_CONVERSIONS, VERDICTS,
} from './ab-test.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'ab-test.mjs');
const TEMPLATE = join(HERE, '..', 'experiments', 'drop-vs-email.json');
const RUN_SHEET = join(HERE, '..', 'RUN-drop-vs-email.md');
const NOW = Date.parse('2026-11-05T12:00:00Z');
const DAY = 86_400_000;

// A complete, honest experiment: 5% baseline, 50% lift needs 1,471 per arm, so 1,549 are planned (1,471 is 1,549
// less 5%, the bounces the analysis tolerates), and 1,500 were delivered to each arm.
const pre = (over = {}) => ({
  decidedOn: '2026-10-01',
  metric: 'conversion_rate',
  baselineRate: 0.05,
  minLiftPct: 50,
  alpha: 0.05,
  power: 0.8,
  plannedPerArm: 1549,
  conversionWindowDays: 7,
  analyseOn: '2026-10-12',
  defaultArm: 'plain email',
  ...over,
});
const arm = (name, recipients, conversions, revenueUsd) => ({ name, recipients, conversions, revenueUsd });
const exp = ({ preOver = {}, arms, ...over } = {}) => ({
  name: 'drop vs plain',
  preRegistered: pre(preOver),
  dataCollectedFrom: '2026-10-05',
  analysedOn: '2026-10-13',
  arms: arms ?? [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 120, 9000)],
  ...over,
});
const run = (e, now = NOW) => analyse(e, { now });
const has = (r, re) => assert.ok(r.reasons.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(r.reasons)}`);

// ------------------------------------------------------------------ the formula, pinned

test('requiredPerArm is pinned to the standard two-proportion formula (the reviewers\' table)', () => {
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 50 }), 1471);
  assert.equal(requiredPerArm({ baselineRate: 0.03, minLiftPct: 100 }), 749);
  assert.equal(requiredPerArm({ baselineRate: 0.0012, minLiftPct: 100 }), 19586);
  assert.equal(requiredPerArm({ baselineRate: 0.0012, minLiftPct: 50 }), 65309);
  assert.equal(requiredPerArm({ baselineRate: 0.0012, minLiftPct: 20 }), 359265);
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 100 }), 435);
});

test('requiredPerArm refuses a lift that passes a 100% rate, and an alpha or power off the table', () => {
  assert.equal(requiredPerArm({ baselineRate: 0.6, minLiftPct: 100 }), null);
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 50, alpha: 0.07 }), null);
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 50, power: 0.5 }), null);
  assert.equal(requiredPerArm({ baselineRate: 0, minLiftPct: 50 }), null);
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 0 }), null);
});

test('alpha and power are normalised before the lookup: "0.10" and "0.80" are the same as 0.1 and 0.8', () => {
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 50, alpha: '0.10' }), requiredPerArm({ baselineRate: 0.05, minLiftPct: 50, alpha: 0.1 }));
  assert.equal(requiredPerArm({ baselineRate: 0.05, minLiftPct: 50, power: '0.80' }), 1471);
  const r = checkPreRegistration(exp({ preOver: { alpha: '0.10', power: '0.80' } }), { now: NOW });
  assert.equal(r.verdict, 'PRE_REGISTERED', JSON.stringify(r.reasons));
});

test('detectableLiftPct is the bisection inverse of the corrected formula, pinned to the reviewers\' figures', () => {
  assert.ok(Math.abs(detectableLiftPct({ perArm: 1000, baselineRate: 0.05 }) - 62.0) < 0.1);
  assert.ok(Math.abs(detectableLiftPct({ perArm: 400, baselineRate: 0.03 }) - 146.3) < 0.1);
  assert.ok(Math.abs(detectableLiftPct({ perArm: 250, baselineRate: 0.05 }) - 139.3) < 0.1);
  // The inverse holds at the boundary: at the found lift the size is enough, just under it it is not.
  const L = detectableLiftPct({ perArm: 1471, baselineRate: 0.05 });
  assert.ok(requiredPerArm({ baselineRate: 0.05, minLiftPct: L }) <= 1471);
  assert.ok(requiredPerArm({ baselineRate: 0.05, minLiftPct: L - 0.01 }) > 1471);
});

test('detectableLiftPct says null when no lift at all could be detected, and refuses a non-count arm', () => {
  assert.equal(detectableLiftPct({ perArm: 1, baselineRate: 0.0012 }), null);
  assert.equal(detectableLiftPct({ perArm: 0, baselineRate: 0.05 }), null);
  assert.equal(detectableLiftPct({ perArm: 12.5, baselineRate: 0.05 }), null);
});

test('erf and normalCdf are right where the verdict depends on them, and exact at the origin', () => {
  // The A&S polynomial alone leaves 1e-9 at 0; erf is odd, so 0 is answered exactly.
  assert.equal(erf(0), 0);
  assert.equal(normalCdf(0), 0.5);
  assert.ok(Math.abs(erf(-1) + erf(1)) < 1e-12);
  assert.ok(Math.abs(erf(1) - 0.8427007929497149) < 1.5e-7);
  assert.ok(Math.abs(normalCdf(1.959963984540054) - 0.975) < 1e-6);
});

test('the difference interval is Newcombe\'s hybrid score interval, pinned to his published examples (1998, method 10)', () => {
  const near = (got, want) => assert.ok(Math.abs(got[0] - want[0]) < 5e-5 && Math.abs(got[1] - want[1]) < 5e-5, `${got} vs ${want}`);
  near(differenceInterval(56, 70, 48, 80), [0.0524, 0.3339]);
  near(differenceInterval(9, 10, 3, 10), [0.1705, 0.8090]);
  near(differenceInterval(5, 56, 0, 29), [-0.0381, 0.1926]);
  near(differenceInterval(0, 10, 0, 20), [-0.1611, 0.2775]);
  // 0 against 0 is not "known to be equal": the interval keeps its width (the Wald interval it replaced gave 0 to 0).
  const [lo, hi] = differenceInterval(0, 19586, 0, 19586);
  assert.ok(lo < 0 && hi > 0, `${lo}, ${hi}`);
  assert.ok(Math.abs(lo + hi) < 1e-15);
});

// ------------------------------------------------------------------ strict dates

test('strictDate accepts a bare date and full timestamps with an explicit offset, read to the right instant', () => {
  assert.deepEqual(strictDate('2026-11-05'), { text: '2026-11-05', dateOnly: true, ms: Date.parse('2026-11-05T00:00:00Z'), day: Date.parse('2026-11-05T00:00:00Z') / 86_400_000 });
  assert.equal(strictDate('2026-11-05T10:30+11:00').ms, Date.parse('2026-11-04T23:30:00Z'));
  assert.equal(strictDate('2026-11-05T10:30:15Z').ms, Date.parse('2026-11-05T10:30:15Z'));
  assert.equal(strictDate('2026-11-05T10:30:15.250-05:00').ms, Date.parse('2026-11-05T15:30:15.250Z'));
  // The calendar day is the day as written, not the UTC day.
  assert.equal(strictDate('2026-11-05T10:30+11:00').day, strictDate('2026-11-05').day);
});

for (const [why, v] of [
  ['a day that does not exist (round-trip)', '2026-02-30'],
  ['month 13', '2026-13-01'],
  ['an Australian slash date', '3/12/2026'],
  ['a US slash date', '12/3/2026'],
  ['a bare number', 1],
  ['a timestamp with no offset (machine-zone dependent)', '2026-11-05T10:30'],
  ['a space instead of T', '2026-11-05 10:30Z'],
  ['hour 24', '2026-11-05T24:00Z'],
  ['an offset past +14', '2026-11-05T10:00+15:00'],
  ['minute 60 (it would roll into the next hour)', '2026-11-05T10:60Z'],
  ['second 60 (it would roll into the next minute)', '2026-11-05T10:30:60Z'],
  ['offset minutes 60 (+10:60 would read as +11:00)', '2026-11-05T10:00+10:60'],
  ['compact digits', '20261105'],
  ['an empty string', ''],
  ['null', null],
  ['a Date object', new Date('2026-11-05')],
]) {
  test(`strictDate refuses ${why}`, () => assert.equal(strictDate(v), null));
}

// ------------------------------------------------------------------ the verdicts

test('WINNER: significant on conversion and ahead on money, with the rate, lift and money shown', () => {
  const r = run(exp());
  assert.equal(r.verdict, 'WINNER');
  assert.equal(r.winner, 'limited drop');
  assert.equal(r.moneyWinner, 'limited drop');
  assert.ok(r.pValue < 0.05);
  has(r, /^conversion rate: plain email 5\.00% \(75\/1500\) vs limited drop 8\.00% \(120\/1500\), p = /);
  has(r, /^limited drop over plain email: lift 60%; planned minimum lift \(it sized the test\) 50%$/);
  // Dollar signs survive formatting (a past regression ate them).
  assert.match(format(r), /plain email \$5\.0000 \(\$7500\.00 total\), limited drop \$6\.0000 \(\$9000\.00 total\)/);
  assert.match(format(r), /^VERDICT {2}WINNER — limited drop$/m);
});

test('WINNER: when the first arm wins, the lift is printed winner over loser, never as a negative', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 120, 9000), arm('limited drop', 1500, 75, 7500)] }));
  assert.equal(r.verdict, 'WINNER');
  assert.equal(r.winner, 'plain email');
  has(r, /^plain email over limited drop: lift 60%;/);
  assert.ok(!r.reasons.some((x) => /-\d+%/.test(x)));
});

test('WINNER: a significant lift below the planned minimum is still a WINNER (no below-bar verdict, per the refuters)', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 105, 9000)] }));
  assert.equal(r.verdict, 'WINNER');
  has(r, /lift 40%; planned minimum lift \(it sized the test\) 50%/);
});

test('WINNER: the lift reads n/a rather than dividing by zero when the losing arm had no conversions', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 0, 0), arm('limited drop', 1500, 20, 2000)] }));
  assert.equal(r.verdict, 'WINNER');
  has(r, /lift n\/a \(the other arm had no conversions\)/);
});

test('revenue tie: level revenue is not a money win for whichever arm is listed first (it was, on every all-$0 case)', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 120, 7500)] }));
  assert.equal(r.verdict, 'WINNER');
  assert.equal(r.moneyWinner, null);
  assert.equal(r.divergent, false);
  has(r, /^revenue per recipient is level$/);
});

test('revenue tie is found by exact cross-multiplication in cents, across unequal arm sizes', () => {
  // $3000 / 1500 and $3200 / 1600 are both exactly $2.00 a recipient.
  const r = run(exp({ arms: [arm('plain email', 1500, 75, 3000), arm('limited drop', 1600, 128, 3200)] }));
  assert.equal(r.verdict, 'WINNER');
  assert.equal(r.moneyWinner, null);
  // One cent more in the first arm breaks the tie towards it, and that is a divergence.
  const r2 = run(exp({ arms: [arm('plain email', 1500, 75, 3000.01), arm('limited drop', 1600, 128, 3200)] }));
  assert.equal(r2.verdict, 'NO_CLEAR_WIN');
});

test('NO_CLEAR_WIN: the conversion winner earning less per recipient never returns WINNER', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 120, 6000)] }));
  assert.equal(r.verdict, 'NO_CLEAR_WIN');
  assert.equal(r.winner, null);
  assert.equal(r.rateWinner, 'limited drop');
  assert.equal(r.moneyWinner, 'plain email');
  assert.equal(r.divergent, true);
  has(r, /no clear win\. The pre-registered default arm, "plain email", stands/);
});

test('INCONCLUSIVE_DEFAULT: the pre-registered default stands, with the 95% interval, the detectable lift and the honest sentence', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 85, 8000)] }));
  assert.equal(r.verdict, 'INCONCLUSIVE_DEFAULT');
  assert.equal(r.defaultArm, 'plain email');
  assert.equal(r.winner, undefined);
  assert.ok(r.pValue >= 0.05);
  // Newcombe's score interval for drop minus plain, 85/1500 against 75/1500: -0.9519 to +2.2922 points.
  assert.deepEqual(r.differenceCi, differenceInterval(85, 1500, 75, 1500));
  assert.equal(r.differenceCiLevel, 0.95);
  assert.ok(Math.abs(r.differenceCi[0] + 0.009519) < 1e-6 && Math.abs(r.differenceCi[1] - 0.022922) < 1e-6, String(r.differenceCi));
  assert.ok(Math.abs(r.detectableLiftPct - detectableLiftPct({ perArm: 1500, baselineRate: 0.05 })) < 1e-9);
  has(r, /^this list could not tell them apart; it does not show they are equal$/);
  has(r, /^limited drop minus plain email: \+0\.67 points, 95% interval -0\.95 to \+2\.29 points$/);
  assert.match(format(r), /INCONCLUSIVE_DEFAULT — "plain email" stands/);
});

test('INCONCLUSIVE_DEFAULT: the default arm is found by name whatever its case, and the interval is the other arm minus it', () => {
  const r = run(exp({ preOver: { defaultArm: '  LIMITED DROP ' }, arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 85, 8000)] }));
  assert.equal(r.defaultArm, 'limited drop');
  has(r, /^plain email minus limited drop: -0\.67 points, 95% interval -2\.29 to \+0\.95 points$/);
  // And the other way round: an arm written in capitals is found by a lower-case defaultArm.
  const caps = run(exp({ arms: [arm('Plain Email', 1500, 75, 7500), arm('Limited Drop', 1500, 85, 8000)] }));
  assert.equal(caps.verdict, 'INCONCLUSIVE_DEFAULT', JSON.stringify(caps.reasons));
  assert.equal(caps.defaultArm, 'Plain Email');
});

test('INCONCLUSIVE_DEFAULT: 0 orders against 0 gives a finite p and an interval either side of zero, never NaN or 0 to 0', () => {
  const r = run(exp({ arms: [arm('plain email', 1500, 0, 0), arm('limited drop', 1500, 0, 0)] }));
  assert.equal(r.verdict, 'INCONCLUSIVE_DEFAULT');
  assert.equal(r.pValue, 1);
  assert.equal(r.z, 0);
  assert.ok(r.differenceCi[0] < 0 && r.differenceCi[1] > 0, String(r.differenceCi));
  assert.doesNotMatch(format(r), /NaN/);
  has(r, /, p = 1\.0000 at alpha 0\.05$/);
  has(r, /^limited drop minus plain email: \+0\.00 points, 95% interval -0\.26 to \+0\.26 points$/);
});

test('INCONCLUSIVE_DEFAULT: the interval is at the registered level, so under alpha 0.01 it is 99% and includes zero', () => {
  // 115 of 2,305 against 150 of 2,305 is p = 0.0268: not significant at 0.01. Its 95% interval, +0.17 to +2.87
  // points, sat wholly above zero beside "could not tell them apart", reading as the difference the test refused.
  const r = run(exp({ preOver: { alpha: 0.01, plannedPerArm: 2305 }, arms: [arm('plain email', 2305, 115, 11500), arm('limited drop', 2305, 150, 15000)] }));
  assert.equal(r.verdict, 'INCONCLUSIVE_DEFAULT', JSON.stringify(r.reasons));
  has(r, /, p = 0\.0268 at alpha 0\.01$/);
  assert.deepEqual(r.differenceCi, differenceInterval(150, 2305, 115, 2305, 2.5758293035489004));
  assert.equal(r.differenceCiLevel, 0.99);
  assert.ok(r.differenceCi[0] < 0 && r.differenceCi[1] > 0, String(r.differenceCi));
  has(r, /^limited drop minus plain email: \+1\.52 points, 99% interval -0\.25 to \+3\.31 points$/);
  assert.ok(!r.reasons.some((x) => /95% interval/.test(x)), JSON.stringify(r.reasons));
  // At alpha 0.10 it is the 90% interval, the width the test itself used.
  const t = run(exp({ preOver: { alpha: 0.1 }, arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 85, 8000)] }));
  assert.equal(t.verdict, 'INCONCLUSIVE_DEFAULT', JSON.stringify(t.reasons));
  assert.deepEqual(t.differenceCi, differenceInterval(85, 1500, 75, 1500, 1.6448536269514722));
  has(t, /^limited drop minus plain email: \+0\.67 points, 90% interval /);
});

test('INSUFFICIENT_SAMPLE: an arm under the required n gets no winner, and no advice to raise the bar past the gate', () => {
  // Planned at 1,500, with no room for bounces: --check refuses that before the send, but after it the plan is what
  // it was, and the arms answer for themselves.
  const r = run(exp({ preOver: { plannedPerArm: 1500 }, arms: [arm('plain email', 1430, 72, 7200), arm('limited drop', 1430, 140, 9000)] }));
  assert.equal(r.verdict, 'INSUFFICIENT_SAMPLE');
  assert.equal(r.requiredPerArm, 1471);
  assert.equal(r.pValue, undefined);
  has(r, /1,471 recipients per arm are needed/);
  has(r, /"plain email", stands/);
  assert.ok(!r.reasons.some((x) => /larger minimum lift/.test(x)));
});

test('INSUFFICIENT_SAMPLE: under 10 expected conversions in the smaller arm stops it, whatever the formula says', () => {
  // 1% baseline, 600% lift: the formula wants only 167 per arm, but 10 expected conversions need 1,000.
  const e = exp({
    preOver: { baselineRate: 0.01, minLiftPct: 600, plannedPerArm: 1000 },
    arms: [arm('plain email', 960, 2, 200), arm('limited drop', 960, 30, 3000)],
  });
  const r = run(e);
  assert.ok(960 >= requiredPerArm({ baselineRate: 0.01, minLiftPct: 600 }));
  assert.equal(r.verdict, 'INSUFFICIENT_SAMPLE');
  has(r, new RegExp(`9\\.6 conversions at the baseline, under the floor of ${MIN_EXPECTED_CONVERSIONS}`));
});

test('INSUFFICIENT_SAMPLE: an arm just under the floor never reads as the floor itself ("10.0 ... under the floor of 10")', () => {
  // 8,334 is the fewest that expect 10 orders at 0.12%; one address short, 8,333 expect 9.9996, which rounded to 10.0.
  const at = (n) => run(exp({ preOver: { baselineRate: 0.0012, minLiftPct: 400, plannedPerArm: 8334 }, arms: [arm('plain email', n, 9, 900), arm('limited drop', 8334, 30, 3000)] }));
  const r = at(8333);
  assert.equal(r.verdict, 'INSUFFICIENT_SAMPLE', JSON.stringify(r.reasons));
  has(r, /^the smaller arm expects 9\.9996 conversions at the baseline, under the floor of 10: too few for any verdict$/);
  // Every arm in the band that used to print 10.0 prints a figure under the floor.
  for (let n = 8292; n <= 8333; n++) {
    const line = at(n).reasons.find((x) => x.startsWith('the smaller arm expects'));
    assert.ok(Number(/expects ([\d.]+) conversions/.exec(line)?.[1]) < MIN_EXPECTED_CONVERSIONS, `${n}: ${line}`);
  }
  assert.equal(at(8291).reasons.find((x) => x.startsWith('the smaller arm expects')), 'the smaller arm expects 9.9 conversions at the baseline, under the floor of 10: too few for any verdict');
});

test('TOO_EARLY: read before analyseOn shows no p-value and no rates at all', () => {
  const r = run(exp({ analysedOn: '2026-10-11' }));
  assert.equal(r.verdict, 'TOO_EARLY');
  assert.equal(r.pValue, undefined);
  assert.equal(r.z, undefined);
  assert.deepEqual(r.arms, [{ name: 'plain email', recipients: 1500 }, { name: 'limited drop', recipients: 1500 }]);
  const text = format(r);
  assert.doesNotMatch(text, /p =|\d\.\d\d%|\b75\b|\b120\b|\$/);
  has(r, /due on 2026-10-12, and this reading is dated 2026-10-11/);
});

test('TOO_EARLY: an arm more than 5% short of plan is not the planned test (1,482 is exactly 5% short of 1,560)', () => {
  const short = run(exp({ arms: [arm('plain email', 1471, 75, 7500), arm('limited drop', 1500, 120, 9000)] }));
  assert.equal(short.verdict, 'TOO_EARLY');
  has(short, /plain email has 1,471 recipients against 1,549 planned/);
  assert.notEqual(run(exp({ arms: [arm('plain email', 1472, 75, 7500), arm('limited drop', 1500, 120, 9000)] })).verdict, 'TOO_EARLY');
  // Exactly 5% short is inside the tolerance; one fewer is not.
  const at = (n) => run(exp({ preOver: { plannedPerArm: 1560 }, arms: [arm('plain email', n, 75, 7500), arm('limited drop', 1560, 120, 9000)] })).verdict;
  assert.equal(at(1481), 'TOO_EARLY');
  assert.notEqual(at(1482), 'TOO_EARLY');
});

test('TOO_EARLY: an arm more than 5% over plan is not the planned test either (sending more after a look is a second look)', () => {
  // The same rates at ten times the plan of 1,549 gave WINNER, exit 0, with nothing said about the size.
  const ten = run(exp({ arms: [arm('plain email', 15490, 775, 77500), arm('limited drop', 15490, 860, 86000)] }));
  assert.equal(ten.verdict, 'TOO_EARLY', JSON.stringify(ten.reasons));
  assert.equal(ten.pValue, undefined);
  has(ten, /^plain email has 15,490 recipients against 1,549 planned, more than 5% over: /);
  has(ten, /^limited drop has 15,490 recipients against 1,549 planned, more than 5% over: /);
  has(ten, /^no p-value and no rates are shown for a test other than the one planned, by design$/);
  // TOO_EARLY reads as "wait", but no later run can read an arm past its plan, so it says so and names the default.
  has(ten, /^no later run reads this test, on any date: an arm past its plan stays past it\. The pre-registered default arm, "plain email", stands\.$/);
  assert.equal(ten.defaultArm, 'plain email');
  assert.doesNotMatch(format(ten), /p =|\d\.\d\d%|\$/);
  // Exactly 5% over is inside the tolerance; one more is not (1,638 is 1,560 and 5%).
  const at = (n) => run(exp({ preOver: { plannedPerArm: 1560 }, arms: [arm('plain email', 1560, 75, 7500), arm('limited drop', n, 120, 9000)] })).verdict;
  assert.equal(at(1639), 'TOO_EARLY');
  assert.equal(at(1638), 'WINNER');
});

test('a plan that lets 5% bounce still reads when they do: one bounce past the bare minimum is not INSUFFICIENT_SAMPLE', () => {
  // The reviewers' case: planned at exactly the 19,586 needed, one undelivered address made a full test unreadable.
  const big = (plannedPerArm, delivered) => exp({
    preOver: { baselineRate: 0.0012, minLiftPct: 100, plannedPerArm, analyseOn: '2026-10-12' },
    arms: [arm('plain email', delivered, 5, 100), arm('limited drop', delivered - 1, 5, 900)],
  });
  assert.equal(checkPreRegistration(big(20617, 20617), { now: NOW }).verdict, 'PRE_REGISTERED');
  // 20,617 less 5% is 19,586.15: an arm of 19,587 is inside the tolerance and has the 19,586 needed.
  const r = run(big(20617, 19588));
  assert.notEqual(r.verdict, 'INSUFFICIENT_SAMPLE', JSON.stringify(r.reasons));
  assert.notEqual(r.verdict, 'TOO_EARLY', JSON.stringify(r.reasons));
});

test('TOO_EARLY: a timestamped reading an hour before a timestamped analyseOn is early', () => {
  const r = run(exp({ preOver: { analyseOn: '2026-10-12T09:00+11:00' }, analysedOn: '2026-10-12T08:00+11:00' }));
  assert.equal(r.verdict, 'TOO_EARLY');
  assert.equal(run(exp({ preOver: { analyseOn: '2026-10-12T09:00+11:00' }, analysedOn: '2026-10-12T09:00+11:00' })).verdict, 'WINNER');
});

test('TOO_EARLY: the clock is asked, not only analysedOn, and before any count is read', () => {
  // analyseOn is 2026-11-05T22:00Z. At 10:00Z a reading dated a bare '2026-11-06' passed it and gave WINNER, 12 hours
  // early, because a bare date against a timestamp compared only the days as written.
  const now = Date.parse('2026-11-05T10:00:00Z');
  const e = (analysedOn, arms) => exp({ preOver: { decidedOn: '2026-10-01T09:00+11:00', analyseOn: '2026-11-06T09:00+11:00' }, dataCollectedFrom: '2026-10-30T09:00+11:00', analysedOn, arms });
  const due = /^the results are due on 2026-11-06T09:00\+11:00, and by this machine's clock that has not arrived\. One look only: come back then\.$/;
  for (const analysedOn of ['2026-11-06', '2026-11-05T21:00+11:00', undefined, 'not a date']) {
    const r = run(e(analysedOn), now);
    assert.equal(r.verdict, 'TOO_EARLY', `${analysedOn}: ${JSON.stringify(r.reasons)}`);
    has(r, due);
    assert.equal(r.pValue, undefined);
    assert.doesNotMatch(format(r), /p =|\d\.\d\d%|\b75\b|\b120\b|\$/);
  }
  // Before the day not even a data error is shown, because it would name the counts ("75 conversions but $0 revenue").
  const bad = run(e('2026-11-05T21:00+11:00', [arm('plain email', 1500, 75, 0), arm('limited drop', 1500, 120, 9000)]), now);
  assert.equal(bad.verdict, 'TOO_EARLY', JSON.stringify(bad.reasons));
  assert.doesNotMatch(format(bad), /\b75\b/);
  // At the planned instant it reads. A bare analyseOn has arrived once it has begun in UTC+14, as a bare analysedOn has.
  assert.equal(run(e('2026-11-06T09:00+11:00'), Date.parse('2026-11-05T22:00:00Z')).verdict, 'WINNER');
  const bare = exp({ preOver: { decidedOn: '2026-11-01', analyseOn: '2026-11-13' }, dataCollectedFrom: '2026-11-06', analysedOn: '2026-11-13' });
  assert.equal(run(bare, Date.parse('2026-11-12T09:59:00Z')).verdict, 'TOO_EARLY');
  assert.equal(run(bare, Date.parse('2026-11-12T10:00:00Z')).verdict, 'WINNER');
});

test('INVALID_DATA: analysedOn is written the same way as analyseOn, as decidedOn and dataCollectedFrom must be', () => {
  const r = run(exp({ preOver: { analyseOn: '2026-10-12T09:00+11:00' }, analysedOn: '2026-10-13' }));
  assert.equal(r.verdict, 'INVALID_DATA', JSON.stringify(r.reasons));
  has(r, /^analysedOn \(2026-10-13\) and preRegistered\.analyseOn \(2026-10-12T09:00\+11:00\) must be written the same way, both as YYYY-MM-DD or both as timestamps with an offset/);
  const other = run(exp({ analysedOn: '2026-10-13T09:00+11:00' }));
  assert.equal(other.verdict, 'INVALID_DATA', JSON.stringify(other.reasons));
  has(other, /^analysedOn \(2026-10-13T09:00\+11:00\) and preRegistered\.analyseOn \(2026-10-12\) must be written the same way/);
});

test('verdict order: NOT_PRE_REGISTERED beats INVALID_DATA beats TOO_EARLY beats INSUFFICIENT_SAMPLE', () => {
  const badData = [arm('plain email', 1500, '', 7500), arm('limited drop', 1500, 120, 9000)];
  assert.equal(run(exp({ preOver: { metric: 'clicks' }, arms: badData })).verdict, 'NOT_PRE_REGISTERED');
  assert.equal(run(exp({ analysedOn: '2026-10-11', arms: badData })).verdict, 'INVALID_DATA');
  assert.equal(run(exp({ analysedOn: '2026-10-11', arms: [arm('plain email', 1400, 70, 7000), arm('limited drop', 1400, 120, 9000)] })).verdict, 'TOO_EARLY');
});

// ------------------------------------------------------------------ pre-registration guards

const notPreRegistered = [
  ['the metric must be conversion_rate, the one thing tested', { preOver: { metric: 'revenue per recipient' } }, /metric must be "conversion_rate"/],
  ['a missing metric', { preOver: { metric: undefined } }, /metric must be "conversion_rate"/],
  ['a missing baseline is not zero', { preOver: { baselineRate: undefined } }, /baselineRate must be between 0 and 1/],
  ['a baseline written as a percentage string', { preOver: { baselineRate: '5%' } }, /baselineRate must be between 0 and 1/],
  ['a baseline of 1', { preOver: { baselineRate: 1 } }, /baselineRate must be between 0 and 1/],
  ['a missing minimum lift', { preOver: { minLiftPct: undefined } }, /minLiftPct is missing/],
  ['a minimum lift that passes a 100% rate', { preOver: { baselineRate: 0.6, minLiftPct: 100, plannedPerArm: 100 } }, /would pass a 100% rate/],
  ['an alpha off the table, listed in the same form', { preOver: { alpha: 0.07 } }, /alpha 0\.07 is not one of 0\.10, 0\.05, 0\.01/],
  ['a missing alpha', { preOver: { alpha: undefined } }, /alpha undefined is not one of/],
  ['a boolean power', { preOver: { power: true } }, /power true is not one of 0\.80, 0\.90, 0\.95/],
  ['a missing plannedPerArm', { preOver: { plannedPerArm: undefined } }, /plannedPerArm must be a whole number/],
  ['a fractional plannedPerArm', { preOver: { plannedPerArm: 1500.5 } }, /plannedPerArm must be a whole number/],
  ['plannedPerArm under the formula: underpowered by design', { preOver: { plannedPerArm: 1470 } }, /underpowered by design: plannedPerArm is 1,470 but 1,471 per arm are needed/],
  ['plannedPerArm under the 10-conversion floor: underpowered by design', { preOver: { baselineRate: 0.01, minLiftPct: 600, plannedPerArm: 999 } }, /underpowered by design: .*1,000 per arm are needed for 10 expected conversions/],
  ['a missing conversion window', { preOver: { conversionWindowDays: undefined } }, /conversionWindowDays must be a whole number/],
  ['a zero conversion window', { preOver: { conversionWindowDays: 0 } }, /conversionWindowDays must be a whole number of days, 1 or more/],
  ['analyseOn inside the conversion window', { preOver: { analyseOn: '2026-10-11' } }, /analyseOn 2026-10-11 falls inside the 7-day conversion window/],
  ['analyseOn timestamps a minute inside the window', { dataCollectedFrom: '2026-10-05T09:00Z', preOver: { analyseOn: '2026-10-12T08:59Z' } }, /falls inside the 7-day conversion window/],
  ['a missing analyseOn', { preOver: { analyseOn: undefined } }, /analyseOn must be the one day/],
  ['a missing decidedOn', { preOver: { decidedOn: undefined } }, /decidedOn must be the date the rule was fixed/],
  ['a slash-dated decidedOn (3/12/2026 read as 12 March let a December rule through)', { preOver: { decidedOn: '3/12/2026' }, dataCollectedFrom: '2026-10-05' }, /decidedOn must be the date/],
  ['a bare-number decidedOn', { preOver: { decidedOn: 1 } }, /decidedOn must be the date/],
  ['a missing dataCollectedFrom', { dataCollectedFrom: undefined }, /dataCollectedFrom must be the date sending starts/],
  ['a rule fixed the same day as the send', { preOver: { decidedOn: '2026-10-05' } }, /was not fixed strictly before the data/],
  ['a rule fixed 90 minutes after a same-day send (the Sydney case)', { preOver: { decidedOn: '2026-10-05T10:30+11:00' }, dataCollectedFrom: '2026-10-05T09:00+11:00' }, /was not fixed strictly before the data/],
  ['a UTC timestamp for a rule fixed an hour after a bare-dated send (10am AEDT on 6 Nov is 2026-11-05T23:00Z)', { preOver: { decidedOn: '2026-11-05T23:00:00.000Z', analyseOn: '2026-11-13' }, dataCollectedFrom: '2026-11-06', analysedOn: '2026-11-14' }, /decidedOn \(2026-11-05T23:00:00\.000Z\) and dataCollectedFrom \(2026-11-06\) must be written the same way/],
  ['a timestamped rule against a bare-dated send, even a day earlier as written', { preOver: { decidedOn: '2026-10-04T23:00+11:00' } }, /must be written the same way/],
  ['a bare-dated rule against a timestamped send', { preOver: { decidedOn: '2026-10-04' }, dataCollectedFrom: '2026-10-05T09:00+11:00' }, /must be written the same way/],
  ['a baseline written with an exponent', { preOver: { baselineRate: '5e-2' } }, /baselineRate must be between 0 and 1/],
  ['a rule fixed after the send', { preOver: { decidedOn: '2026-10-06' } }, /was not fixed strictly before the data/],
  ['two equal timestamps', { preOver: { decidedOn: '2026-10-05T09:00Z' }, dataCollectedFrom: '2026-10-05T09:00Z' }, /was not fixed strictly before the data/],
  ['a decidedOn in the future', { preOver: { decidedOn: '2026-11-20' }, dataCollectedFrom: '2026-11-25', analysedOn: '2026-11-04' }, /decidedOn 2026-11-20 is in the future/],
  ['a dataCollectedFrom in the future, at analysis', { dataCollectedFrom: '2026-11-20', preOver: { analyseOn: '2026-11-27' } }, /dataCollectedFrom 2026-11-20 is in the future/],
  ['three arms', { arms: [arm('a', 1500, 75, 7500), arm('b', 1500, 75, 7500), arm('c', 1500, 75, 7500)] }, /exactly two arms are needed/],
  ['arms not a list', { arms: 'two' }, /exactly two arms are needed/],
  ['an arm with no name', { arms: [arm(undefined, 1500, 75, 7500), arm('limited drop', 1500, 120, 9000)] }, /arm 1 needs a name/],
  ['an arm whose name is only spaces', { arms: [arm('plain email', 1500, 75, 7500), arm('   ', 1500, 120, 9000)] }, /arm 2 needs a name/],
  ['two arms with the same name, whatever the case and spacing', { preOver: { defaultArm: 'plain email' }, arms: [arm('plain email', 1500, 75, 7500), arm(' Plain Email ', 1500, 120, 9000)] }, /arm names must be distinct/],
  ['a missing defaultArm', { preOver: { defaultArm: undefined } }, /defaultArm is missing/],
  ['a defaultArm that is not one of the arms', { preOver: { defaultArm: 'the cheaper one' } }, /defaultArm "the cheaper one" is not one of the arms/],
  ['no preRegistered block at all', { preRegistered: undefined }, /metric must be/],
];

for (const [name, over, re] of notPreRegistered) {
  test(`NOT_PRE_REGISTERED: ${name}`, () => {
    const r = run(exp(over));
    assert.equal(r.verdict, 'NOT_PRE_REGISTERED', `expected NOT_PRE_REGISTERED, got ${r.verdict}: ${JSON.stringify(r.reasons)}`);
    assert.equal(r.pValue, undefined, 'no number before the rule is sound');
    has(r, re);
  });
}

test('the rule a minute before a timestamped send passes, and a bare date strictly earlier passes', () => {
  assert.equal(run(exp({ preOver: { decidedOn: '2026-10-05T08:59Z' }, dataCollectedFrom: '2026-10-05T09:00Z' })).verdict, 'WINNER');
  assert.equal(run(exp({ preOver: { decidedOn: '2026-10-04' } })).verdict, 'WINNER');
  assert.equal(run(exp({ preOver: { decidedOn: '2026-10-05T09:00+11:00' }, dataCollectedFrom: '2026-10-05T09:01+11:00' })).verdict, 'WINNER');
});

test('--check validates the pre-registration with no arm data, and allows the planned send to lie ahead', () => {
  const planned = exp({
    preOver: { decidedOn: '2026-11-04', analyseOn: '2026-11-17' },
    dataCollectedFrom: '2026-11-10',
    analysedOn: null,
    arms: [arm('plain email', null, null, null), arm('limited drop', null, null, null)],
  });
  const r = checkPreRegistration(planned, { now: NOW });
  assert.equal(r.verdict, 'PRE_REGISTERED', JSON.stringify(r.reasons));
  assert.equal(r.ok, true);
  assert.equal(r.plan.defaultArm, 'plain email');
  // The same file read as an analysis is refused: there cannot be data from the future.
  assert.equal(run(planned).verdict, 'NOT_PRE_REGISTERED');
});

test('--check still refuses a rule dated in the future, and a bare date only once it is future everywhere (UTC+14)', () => {
  const at = (decidedOn) => checkPreRegistration(exp({ preOver: { decidedOn, analyseOn: '2026-11-30' }, dataCollectedFrom: '2026-11-20' }), { now: NOW });
  assert.equal(at('2026-11-06').verdict, 'PRE_REGISTERED'); // at 12:00 UTC it is already 6 November in UTC+14
  const r = at('2026-11-07');
  assert.equal(r.verdict, 'NOT_PRE_REGISTERED');
  has(r, /decidedOn 2026-11-07 is in the future/);
  assert.equal(at('2026-11-05T12:00:01Z').verdict, 'NOT_PRE_REGISTERED');
});

test('--check refuses an underpowered plan before the send', () => {
  const r = checkPreRegistration(exp({ preOver: { plannedPerArm: 1000 } }), { now: NOW });
  assert.equal(r.verdict, 'NOT_PRE_REGISTERED');
  has(r, /underpowered by design/);
});

test('--check refuses a plan with no room for the 5% the analysis tolerates, and names the figure to plan', () => {
  const at = (plannedPerArm, stage) => checkPreRegistration(exp({ preOver: { plannedPerArm } }), { now: NOW, stage });
  const r = at(1548, 'check');
  assert.equal(r.verdict, 'NOT_PRE_REGISTERED');
  has(r, /^plannedPerArm 1,548 leaves no room for bounces: .*under the 1,471 needed\. Plan at least 1,549 per arm\.$/);
  assert.equal(at(1549, 'check').verdict, 'PRE_REGISTERED');
  has(at(1549, 'check'), /1,549 per arm are planned, against the 1,549 that lets 5% bounce/);
  // After the send the plan cannot be changed, so only the bare minimum is held to.
  assert.equal(at(1471, 'analyse').verdict, 'PRE_REGISTERED');
  // The plan is a size, not a minimum: --check names the band each arm must land in, and it is the band read.
  has(at(1549, 'check'), /^each arm is read only if it has 1,472 to 1,626 recipients, 5% under to 5% over the plan, so plannedPerArm must be the number each arm will actually get \(half the list, split 50\/50\), not a minimum$/);
  for (const plannedPerArm of [1549, 1560, 1561, 20617, 22000]) {
    const line = checkPreRegistration(exp({ preOver: { plannedPerArm } }), { now: NOW }).reasons.find((x) => x.startsWith('each arm is read only'));
    const [lo, hi] = (/has ([\d,]+) to ([\d,]+) recipients/.exec(line ?? '') ?? []).slice(1).map((x) => Number(x.split(',').join('')));
    const read = (a, b) => run(exp({ preOver: { plannedPerArm }, arms: [arm('plain email', a, 75, 7500), arm('limited drop', b, 120, 9000)] })).verdict;
    assert.notEqual(read(lo, hi), 'TOO_EARLY', `${plannedPerArm}: ${line}`);
    assert.equal(read(lo - 1, hi), 'TOO_EARLY', `${plannedPerArm}: ${line}`);
    assert.equal(read(lo, hi + 1), 'TOO_EARLY', `${plannedPerArm}: ${line}`);
  }
  // The floor is grossed up too: 1,000 for 10 expected conversions at 1% becomes 1,053.
  const floor = (plannedPerArm) => checkPreRegistration(exp({ preOver: { baselineRate: 0.01, minLiftPct: 600, plannedPerArm } }), { now: NOW });
  has(floor(1052), /under the 1,000 needed\. Plan at least 1,053 per arm/);
  assert.equal(floor(1053).verdict, 'PRE_REGISTERED');
});

// ------------------------------------------------------------------ data guards

const invalidData = [
  ['blank conversions are not zero', [arm('plain email', 1500, '', 7500)], /plain email: conversions must be a whole number/],
  ['whitespace conversions are not zero', [arm('plain email', 1500, '  ', 7500)], /conversions must be a whole number/],
  ['an empty-array cell is not zero', [arm('plain email', 1500, [], 7500)], /conversions must be a whole number/],
  ['a one-element array is not its element', [arm('plain email', [1500], 75, 7500)], /recipients must be a whole number/],
  ['hex is not a count', [arm('plain email', '0x5DC', 75, 7500)], /recipients must be a whole number/],
  ['an exponent is not a count', [arm('plain email', 1500, '7.5e1', 7500)], /conversions must be a whole number/],
  ['a padded count is not written as digits', [arm('plain email', 1500, ' 75 ', 7500)], /conversions must be a whole number/],
  ['a fractional count', [arm('plain email', 1500, 75.5, 7500)], /conversions must be a whole number/],
  ['a negative count', [arm('plain email', 1500, -1, 7500)], /conversions must be a whole number/],
  ['"unknown" is not a count', [arm('plain email', 1500, 'unknown', 7500)], /conversions must be a whole number/],
  ['null conversions', [arm('plain email', 1500, null, 7500)], /conversions must be a whole number/],
  ['a boolean count', [arm('plain email', true, 75, 7500)], /recipients must be a whole number above 0/],
  ['zero recipients', [arm('plain email', 0, 0, 0)], /recipients must be a whole number above 0/],
  ['more conversions than recipients', [arm('plain email', 1500, 1501, 7500)], /more conversions than recipients/],
  ['blank revenue is not zero', [arm('plain email', 1500, 75, '')], /revenueUsd must be dollars and cents/],
  ['null revenue is not zero', [arm('plain email', 1500, 75, null)], /revenueUsd must be dollars and cents/],
  ['hex revenue', [arm('plain email', 1500, 75, '0x10')], /revenueUsd must be dollars and cents/],
  ['exponent revenue', [arm('plain email', 1500, 75, '1e3')], /revenueUsd must be dollars and cents/],
  ['a fraction of a cent', [arm('plain email', 1500, 75, 7500.005)], /revenueUsd must be dollars and cents/],
  ['three decimal places as text', [arm('plain email', 1500, 75, '7500.005')], /revenueUsd must be dollars and cents/],
  ['negative revenue', [arm('plain email', 1500, 75, -5)], /revenueUsd must be dollars and cents/],
  ['revenue with a dollar sign', [arm('plain email', 1500, 75, '$7500')], /revenueUsd must be dollars and cents/],
  ['conversions with $0 revenue: revenue was not recorded', [arm('plain email', 1500, 75, 0)], /75 conversions but \$0 revenue, so revenue was not recorded/],
  ['revenue with 0 conversions: phantom money', [arm('plain email', 1500, 0, '50000')], /plain email: \$50000\.00 revenue but 0 conversions: the counts and the revenue come from different sources/],
  ['a digit-string count past the safe integers (9007199254740993 reads as ...992)', [arm('plain email', '9007199254740993', 75, 7500)], /recipients must be a whole number/],
  ['a digit-string revenue past the safe integers in cents', [arm('plain email', 1500, 75, '99999999999999999')], /revenueUsd must be dollars and cents/],
];

for (const [name, first, re] of invalidData) {
  test(`INVALID_DATA: ${name}`, () => {
    const r = run(exp({ arms: [...first, arm('limited drop', 1500, 120, 9000)] }));
    assert.equal(r.verdict, 'INVALID_DATA', `expected INVALID_DATA, got ${r.verdict}: ${JSON.stringify(r.reasons)}`);
    has(r, re);
  });
}

test('INVALID_DATA: the reading must be dated, and not in the future', () => {
  for (const analysedOn of [undefined, null, '13/10/2026', '2026-10-13T10:00']) {
    const r = run(exp({ analysedOn }));
    assert.equal(r.verdict, 'INVALID_DATA', `analysedOn ${analysedOn}`);
    has(r, /analysedOn must be the date you are reading the results/);
  }
  const future = run(exp({ analysedOn: '2026-11-20' }));
  assert.equal(future.verdict, 'INVALID_DATA');
  has(future, /analysedOn 2026-11-20 is in the future/);
});

test('counts and money written as plain digit strings are read exactly', () => {
  const r = run(exp({ arms: [arm('plain email', '1500', '75', '7500.5'), arm('limited drop', '1500', '120', '9000.05')] }));
  assert.equal(r.verdict, 'WINNER');
  assert.equal(r.arms[0].revenueCents, 750050);
  assert.equal(r.arms[1].revenueCents, 900005);
  assert.equal(run(exp({ arms: [arm('plain email', 1500, 75, 7500.5), arm('limited drop', 1500, 120, 9000)] })).arms[0].revenueCents, 750050);
});

// ------------------------------------------------------------------ the pre-flight

test('preflight: 2,000 on the list, orders, is TOO SMALL with the 19,586 and the 20,617 to plan shown', () => {
  const r = preflight({ listSize: 2000, metric: 'orders' });
  assert.equal(r.verdict, 'TOO_SMALL');
  assert.equal(r.ok, false);
  assert.equal(r.perArm, 1000);
  assert.equal(r.baselineRate, 0.0012);
  assert.match(r.baselineSource, /^SUMMARY.*Klaviyo 2026/);
  assert.equal(r.minLiftPct, 100);
  assert.equal(r.requiredPerArm, 19586);
  assert.equal(r.planPerArm, 20617);
  assert.ok(Math.abs(r.expectedPerArm - 1.2) < 1e-9);
  assert.equal(r.floor, 10);
  assert.ok(Math.abs(r.detectableLiftPct - detectableLiftPct({ perArm: 1000, baselineRate: 0.0012 })) < 1e-9);
  has(r, /you need 19,586 per arm$/);
  has(r, /^plan 20,617 per arm \(41,234 on the list\): that holds the floor of 10 expected placed orders and lets 5% bounce$/);
  has(r, /expected placed orders per arm: 1\.2, against a floor of 10/);
  // Nothing is pre-registered yet at preflight, so the line names what to do, not a default arm that does not exist.
  has(r, /^TOO SMALL: do not run this as a decision\. Send the cheaper arm \(the one you would name as defaultArm\) and stop\.$/);
  assert.ok(!r.reasons.some((x) => /pre-registered default/.test(x)));
});

test('preflight: BIG ENOUGH starts at the figure to plan, not at the bare 19,586 (41,234 on the list, not 39,172)', () => {
  assert.equal(preflight({ listSize: 39172, metric: 'orders' }).verdict, 'TOO_SMALL');
  assert.equal(preflight({ listSize: 41232, metric: 'orders' }).verdict, 'TOO_SMALL');
  const r = preflight({ listSize: 41234, metric: 'orders' });
  assert.equal(r.verdict, 'BIG_ENOUGH');
  has(r, /^BIG ENOUGH: pre-register the rule with plannedPerArm 20,617, half the list and the number each arm will get \(at least 20,617\); the analysis refuses an arm more than 5% under or 5% over it\. Run --check, then send\.$/);
});

test('preflight: clicks use the Omnisend 2025 baseline, and a list big enough says so', () => {
  const r = preflight({ listSize: 2000, metric: 'clicks' });
  assert.equal(r.baselineRate, 0.0074);
  assert.match(r.baselineSource, /^SUMMARY.*Omnisend 2025/);
  assert.equal(r.requiredPerArm, 3146);
  assert.equal(r.planPerArm, 3312);
  assert.equal(r.verdict, 'TOO_SMALL');
  assert.equal(preflight({ listSize: 6624, metric: 'clicks' }).verdict, 'BIG_ENOUGH');
  const big = preflight({ listSize: 80000, metric: 'orders' });
  assert.equal(big.verdict, 'BIG_ENOUGH');
  assert.equal(big.ok, true);
  has(big, /^BIG ENOUGH: pre-register the rule with plannedPerArm 40,000, half the list and the number each arm will get \(at least 20,617\);/);
});

// The plan the preflight names is the plan the analysis reads. It once said "plannedPerArm at least 20,617", the
// template shipped 20,617, and an arm more than 5% over plan is refused: so every honest 50/50 test on a list of
// 43,296 or more ended TOO_EARLY after the send, exit 1, with no later run able to read it.
const plannedFrom = (text) => {
  const line = text.split('\n').find((x) => x.includes('BIG ENOUGH'));
  const m = /plannedPerArm\D*?(\d{1,3}(?:,\d{3})*)/.exec(line ?? '');
  return { line, figure: m ? Number(m[1].split(',').join('')) : NaN };
};

test('preflight to analysis: on a list of 44,000, a plan built from the printed figure reads at 22,000 per arm', () => {
  const pf = cli(['--preflight', '--list-size', '44000', '--metric', 'orders']);
  assert.equal(pf.code, 0, pf.out);
  const { line, figure } = plannedFrom(pf.out);
  const t = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  const plan = { ...t, preRegistered: { ...t.preRegistered, decidedOn: '2026-10-01', analyseOn: '2026-10-12', plannedPerArm: figure }, dataCollectedFrom: '2026-10-05' };
  const dir = mkdtempSync(join(tmpdir(), 'ab-test-'));
  try {
    const p = join(dir, 'plan44k.json');
    writeFileSync(p, JSON.stringify(plan));
    const check = cli(['--check', '--file', p]);
    assert.equal(check.code, 0, check.out);
    writeFileSync(p, JSON.stringify({ ...plan, analysedOn: '2026-10-13', arms: [arm('plain email', 22000, 20, 2000), arm('limited drop', 22000, 52, 5200)] }));
    const r = cli(['--file', p]);
    assert.doesNotMatch(r.out, /TOO_EARLY/, `planned at ${figure} from "${line}": ${r.out}`);
    assert.match(r.out, /^VERDICT {2}WINNER — limited drop$/m);
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(figure, 22000);
  assert.match(line, /more than 5% under or 5% over it/);
});

test('preflight to analysis: every list big enough, odd or even, reads at the plan the preflight names', () => {
  for (const n of [41234, 41235, 43295, 43296, 44001, 50000, 80000, 1000001]) {
    const pf = preflight({ listSize: n, metric: 'orders' });
    assert.equal(pf.verdict, 'BIG_ENOUGH', String(n));
    const { figure } = plannedFrom(pf.reasons.join('\n'));
    const e = exp({ preOver: { baselineRate: 0.0012, minLiftPct: 100, plannedPerArm: figure }, arms: [arm('plain email', Math.floor(n / 2), 20, 2000), arm('limited drop', n - Math.floor(n / 2), 52, 5200)] });
    const c = checkPreRegistration(e, { now: NOW });
    assert.equal(c.verdict, 'PRE_REGISTERED', `${n}: ${JSON.stringify(c.reasons)}`);
    const r = run(e);
    assert.notEqual(r.verdict, 'TOO_EARLY', `${n}, planned at ${figure}: ${JSON.stringify(r.reasons)}`);
  }
});

test('preflight: a list past the formula but under 10 expected conversions per arm is still TOO SMALL', () => {
  const r = preflight({ listSize: 400, metric: 'orders', baselineRate: 0.01, minLiftPct: 600 });
  assert.ok(r.perArm >= r.requiredPerArm, `${r.perArm} vs ${r.requiredPerArm}`);
  assert.equal(r.verdict, 'TOO_SMALL');
});

test('preflight: --baseline-rate overrides the built-in figure, and --min-lift moves the required n', () => {
  const r = preflight({ listSize: 2000, metric: 'orders', baselineRate: '0.03' });
  assert.equal(r.baselineRate, 0.03);
  assert.equal(r.requiredPerArm, 749);
  assert.match(r.baselineSource, /your own figure/);
  assert.equal(preflight({ listSize: 2000, metric: 'orders', minLiftPct: '50' }).requiredPerArm, 65309);
});

for (const [why, input, re] of [
  ['no metric', { listSize: 2000 }, /--metric must be one of orders, clicks/],
  ['an unknown metric', { listSize: 2000, metric: 'revenue' }, /--metric must be one of/],
  ['an inherited property as a metric', { listSize: 2000, metric: 'toString' }, /--metric must be one of/],
  ['no list size', { metric: 'orders' }, /--list-size must be a whole number/],
  ['a list size with a thousands comma', { listSize: '2,000', metric: 'orders' }, /--list-size must be a whole number/],
  ['a list of one', { listSize: 1, metric: 'orders' }, /--list-size must be a whole number of recipients, 2 or more/],
  ['a baseline above 1', { listSize: 2000, metric: 'orders', baselineRate: '1.5' }, /--baseline-rate must be between 0 and 1/],
  ['a baseline written with an exponent', { listSize: 2000, metric: 'orders', baselineRate: '5e-2' }, /--baseline-rate must be between 0 and 1/],
  ['a baseline written in hex', { listSize: 2000, metric: 'orders', baselineRate: '0x1' }, /--baseline-rate must be between 0 and 1/],
  ['a baseline with a leading space', { listSize: 2000, metric: 'orders', baselineRate: ' 0.05' }, /--baseline-rate must be between 0 and 1/],
  ['a zero minimum lift', { listSize: 2000, metric: 'orders', minLiftPct: 0 }, /--min-lift must be a percentage above 0/],
  ['an alpha off the table', { listSize: 2000, metric: 'orders', alpha: '0.2' }, /--alpha must be one of/],
  ['a lift past a 100% rate', { listSize: 2000, metric: 'orders', baselineRate: 0.6 }, /would pass a 100% rate/],
]) {
  test(`preflight INVALID: ${why}`, () => {
    const r = preflight(input);
    assert.equal(r.verdict, 'INVALID');
    has(r, re);
  });
}

// ------------------------------------------------------------------ the z-test's false-winner rate, measured

// Every pair of order counts under no difference, weighted by its binomial probability, through analyse itself. The
// figures pinned here are the ones the comment on step 5 quotes, so it cannot drift back to "at or under alpha".
const LOG_FACT = [0];
const logFact = (n) => { while (LOG_FACT.length <= n) LOG_FACT.push(LOG_FACT[LOG_FACT.length - 1] + Math.log(LOG_FACT.length)); return LOG_FACT[n]; };
const pmf = (n, p) => {
  const out = [];
  for (let k = 0; k <= Math.ceil(n * p + 12 * Math.sqrt(n * p) + 20); k++) out.push(Math.exp(logFact(n) - logFact(k) - logFact(n - k) + k * Math.log(p) + (n - k) * Math.log1p(-p)));
  return out;
};
function falseWinnerRate({ p, nA, nB, alpha, minLiftPct, plannedPerArm }) {
  const A = pmf(nA, p);
  const B = pmf(nB, p);
  const preOver = { baselineRate: p, minLiftPct, alpha, plannedPerArm };
  let rate = 0;
  for (let x = 0; x < A.length; x++) {
    for (let y = 0; y < B.length; y++) {
      const r = run(exp({ preOver, arms: [arm('plain email', nA, x, x * 100), arm('limited drop', nB, y, y * 100)] }));
      if (r.verdict === 'WINNER') rate += A[x] * B[y];
      else assert.equal(r.verdict, 'INCONCLUSIVE_DEFAULT', `${x}/${nA} vs ${y}/${nB}: ${JSON.stringify(r.reasons)}`);
    }
  }
  return rate;
}

// The highest the scan found, each through analyse itself. The unequal pairs sit inside the 5% either side of plan.
const PINNED = [
  ['5.18%*', { p: 0.0007, nA: 14286, nB: 14286, alpha: 0.05, minLiftPct: 300, plannedPerArm: 14286 }, 0.05183],
  ['5.30%*', { p: 0.0007, nA: 17143, nB: 17143, alpha: 0.05, minLiftPct: 300, plannedPerArm: 17143 }, 0.05296],
  ['10.50%*', { p: 0.0074, nA: 1352, nB: 1379, alpha: 0.10, minLiftPct: 300, plannedPerArm: 1352 }, 0.10501],
  ['10.30%*', { p: 0.05, nA: 420, nB: 428, alpha: 0.10, minLiftPct: 150, plannedPerArm: 420 }, 0.10304],
  ['1.001%*', { p: 0.0012, nA: 49167, nB: 51625, alpha: 0.01, minLiftPct: 100, plannedPerArm: 49167 }, 0.010011],
  ['4.92%*', { p: 0.0012, nA: 20617, nB: 20617, alpha: 0.05, minLiftPct: 100, plannedPerArm: 20617 }, 0.04920],
];

test('the pooled z-test is not exact, and its false-winner rate is what the comment says (exact enumeration)', () => {
  const comment = readFileSync(SCRIPT, 'utf8');
  for (const [figure, c, want] of PINNED) {
    const got = falseWinnerRate(c);
    // Tight enough that 1.001% is shown to be over alpha, not just near it.
    assert.ok(Math.abs(got - want) < (c.alpha === 0.01 ? 5e-7 : 5e-5), `${figure}: ${got} vs ${want}`);
    assert.ok(comment.includes(figure), `the comment quotes ${figure}`);
  }
  assert.ok(falseWinnerRate(PINNED[4][1]) > 0.01);
  assert.doesNotMatch(comment, /at or under alpha/);
  // Arms 40% apart (14,286 against 20,000, once quoted at 11.46%) are no longer a test this tool will read.
  assert.doesNotMatch(comment, /11\.46%/);
  assert.equal(run(exp({ preOver: { baselineRate: 0.0007, minLiftPct: 300, alpha: 0.1, plannedPerArm: 14286 }, arms: [arm('plain email', 14286, 10, 1000), arm('limited drop', 20000, 14, 1400)] })).verdict, 'TOO_EARLY');
});

// The scan behind the comment's "the highest found" and "within 0.31 points", so those are pinned too (about a second).
test('the scan behind the step-5 comment finds the maxima it quotes, where it says they are', () => {
  // analyse decides exactly this, and is too slow to call fifteen million times: WINNER when p < alpha (each arm's
  // revenue follows its orders here, so money never diverges). It is checked against analyse at the pinned points.
  const ALPHAS = [0.1, 0.05, 0.01];
  const rates = (p, nA, nB) => {
    const A = pmf(nA, p);
    const B = pmf(nB, p);
    const out = [0, 0, 0];
    for (let x = 0; x < A.length; x++) {
      for (let y = 0; y < B.length; y++) {
        const pooled = (x + y) / (nA + nB);
        const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
        const z = se > 0 ? (y / nB - x / nA) / se : 0;
        const pv = 2 * (1 - normalCdf(Math.abs(z)));
        ALPHAS.forEach((a, i) => { if (pv < a) out[i] += A[x] * B[y]; });
      }
    }
    return out;
  };
  for (const [figure, c, want] of PINNED) assert.ok(Math.abs(rates(c.p, c.nA, c.nB)[ALPHAS.indexOf(c.alpha)] - want) < 5e-5, figure);
  const best = ALPHAS.map(() => ({ rate: 0 }));
  let off = 0;
  for (const p of [0.0007, 0.0012, 0.0074, 0.05]) {
    for (const ratio of [1, 1.02, 1.05, 1.08, 'band']) {
      for (let E = 10; E <= 60; E++) {
        const nA = Math.ceil(E / p - 1e-9);
        // 'band': the widest pair the tolerance allows, the smaller arm 5% short of a plan the larger is 5% over.
        const nB = ratio === 'band' ? Math.floor((Math.floor((nA * 100) / 95) * 105) / 100) : Math.round(nA * ratio);
        rates(p, nA, nB).forEach((r, i) => {
          if (r > best[i].rate) best[i] = { rate: r, p, nA, nB };
          if (E >= 20) off = Math.max(off, Math.abs(r - ALPHAS[i]));
        });
      }
    }
  }
  const where = (c) => ({ p: c.p, nA: c.nA, nB: c.nB });
  assert.deepEqual(where(best[0]), where(PINNED[2][1]), '10.50% is the highest at 0.10');
  assert.deepEqual(where(best[1]), where(PINNED[1][1]), '5.30% is the highest at 0.05');
  assert.deepEqual(where(best[2]), where(PINNED[4][1]), '1.001% is the highest at 0.01');
  assert.ok(off < 0.0031, `from 20 expected up, the furthest from alpha is ${(off * 100).toFixed(3)} points`);
  const forty = Math.ceil(40 / 0.0007 - 1e-9);
  assert.ok(Math.abs(rates(0.0007, forty, forty)[1] - 0.0505) < 5e-5, 'at 40 expected it is still 5.05%');
});

// ------------------------------------------------------------------ the command line

function cli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

test('exitCode: 0 only for WINNER on an analysis, PRE_REGISTERED on a check, BIG_ENOUGH on a preflight', () => {
  for (const v of VERDICTS) assert.equal(exitCode('analyse', v), v === 'WINNER' ? 0 : 1, v);
  for (const v of ['PRE_REGISTERED', 'BIG_ENOUGH', 'anything else', undefined]) assert.equal(exitCode('analyse', v), 1, String(v));
  assert.equal(exitCode('check', 'PRE_REGISTERED'), 0);
  for (const v of ['NOT_PRE_REGISTERED', 'WINNER', undefined]) assert.equal(exitCode('check', v), 1, String(v));
  assert.equal(exitCode('preflight', 'BIG_ENOUGH'), 0);
  assert.equal(exitCode('preflight', 'TOO_SMALL'), 1);
  for (const v of ['INVALID', 'WINNER', undefined]) assert.equal(exitCode('preflight', v), 2, String(v));
});

test('parseArgs reads only what it knows, and never lets a flag fall back to a default', () => {
  assert.deepEqual(parseArgs(['--preflight', '--list-size', '2000', '--metric', 'orders', '--baseline-rate', '0.0003', '--min-lift', '50', '--alpha', '0.10', '--power', '0.90']), {
    mode: 'preflight', values: { listSize: '2000', metric: 'orders', baselineRate: '0.0003', minLiftPct: '50', alpha: '0.10', power: '0.90' },
  });
  assert.deepEqual(parseArgs(['--check', '--file', 'x.json']), { mode: 'check', values: { file: 'x.json' } });
  assert.deepEqual(parseArgs(['--file', 'x.json']), { mode: 'analyse', values: { file: 'x.json' } });
  // A negative number is a value (refused later as a number), not a flag.
  assert.equal(parseArgs(['--preflight', '--min-lift', '-5']).values.minLiftPct, '-5');
  for (const [why, argv, re] of [
    ['a misspelt flag', ['--preflight', '--list-size', '60000', '--metric', 'orders', '--baseline', '0.0003'], /unknown argument "--baseline"/],
    ['an underscore spelling', ['--preflight', '--list-size', '40000', '--metric', 'orders', '--min_lift', '20'], /unknown argument "--min_lift"/],
    ['a flag=value spelling', ['--preflight', '--min-lift=20'], /unknown argument "--min-lift=20"/],
    ['a stray word', ['--preflight', '--list-size', '2000', 'orders'], /unknown argument "orders"/],
    ['a value flag at the end with nothing after it', ['--preflight', '--list-size', '40000', '--metric', 'orders', '--min-lift'], /--min-lift needs a value after it/],
    ['a value flag followed by another flag', ['--preflight', '--baseline-rate', '--min-lift', '50'], /--baseline-rate needs a value after it/],
    ['a value flag given twice', ['--preflight', '--min-lift', '20', '--min-lift', '50'], /--min-lift is given twice/],
    ['a mode given twice', ['--check', '--check', '--file', 'x.json'], /--check is given twice/],
    ['--preflight and --check together', ['--preflight', '--check', '--file', 'x.json'], /different steps/],
    ['--preflight with a file', ['--preflight', '--file', 'x.json'], /--preflight reads no file/],
    ['a preflight flag on a check', ['--check', '--file', 'x.json', '--alpha', '0.10'], /--alpha only go with --preflight/],
    ['no file and no preflight', [], /--file is needed/],
    ['--file with no value', ['--file'], /--file needs a value after it/],
    ['an inherited property name as a flag', ['--preflight', 'toString', '1'], /unknown argument "toString"/],
  ]) {
    const r = parseArgs(argv);
    assert.equal(r.mode, undefined, why);
    assert.match(r.error ?? '', re, why);
  }
});

test('CLI: exit 0 only for WINNER; 1 for every other verdict; 2 for misuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-test-'));
  try {
    const file = (name, e) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(e)); return p; };
    const win = cli(['--file', file('win.json', exp())]);
    assert.equal(win.code, 0, win.out);
    assert.match(win.out, /VERDICT {2}WINNER — limited drop/);
    assert.match(win.out, /\$6\.0000/);
    const refusals = [
      ['NO_CLEAR_WIN', exp({ arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 120, 6000)] })],
      ['INCONCLUSIVE_DEFAULT', exp({ arms: [arm('plain email', 1500, 75, 7500), arm('limited drop', 1500, 85, 8000)] })],
      ['INSUFFICIENT_SAMPLE', exp({ preOver: { plannedPerArm: 1500 }, arms: [arm('plain email', 1430, 72, 7200), arm('limited drop', 1430, 140, 9000)] })],
      ['TOO_EARLY', exp({ analysedOn: '2026-10-11' })],
      ['TOO_EARLY', exp({ arms: [arm('plain email', 1471, 75, 7500), arm('limited drop', 1500, 120, 9000)] })],
      ['INVALID_DATA', exp({ arms: [arm('plain email', 1500, '', 7500), arm('limited drop', 1500, 120, 9000)] })],
      ['NOT_PRE_REGISTERED', exp({ preOver: { decidedOn: '2026-10-05' } })],
    ];
    assert.deepEqual([...new Set(refusals.map(([v]) => v))].sort(), VERDICTS.filter((v) => v !== 'WINNER').sort(), 'every verdict but WINNER is exercised');
    refusals.forEach(([verdict, e], i) => {
      const r = cli(['--file', file(`refusal-${i}.json`, e)]);
      assert.match(r.out, new RegExp(`VERDICT {2}${verdict}\\b`), r.out);
      assert.equal(r.code, 1, `${verdict} must exit 1: ${r.out}`);
    });
    const badCheck = cli(['--check', '--file', file('bad.json', exp({ preOver: { decidedOn: '2026-10-05' } }))]);
    assert.equal(badCheck.code, 1);
    assert.match(badCheck.out, /NOT_PRE_REGISTERED/);
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    assert.equal(cli(['--file', join(dir, 'broken.json')]).code, 2);
    assert.equal(cli([]).code, 2);
    assert.equal(cli(['--file', file('win2.json', exp()), '--min-lift', '20']).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --check passes a plan whose send and read still lie ahead of today, with no arm data', () => {
  // Dated from the clock this test runs on, so the planned dates are always in the future when --check runs.
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const today = Date.now();
  const planned = exp({
    preOver: { decidedOn: ymd(today - 2 * DAY), analyseOn: ymd(today + 12 * DAY) },
    dataCollectedFrom: ymd(today + 3 * DAY),
    analysedOn: null,
    arms: [arm('plain email', null, null, null), arm('limited drop', null, null, null)],
  });
  const dir = mkdtempSync(join(tmpdir(), 'ab-test-'));
  try {
    const p = join(dir, 'planned.json');
    writeFileSync(p, JSON.stringify(planned));
    const r = cli(['--check', '--file', p]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^CHECK {2}PRE_REGISTERED$/m);
    // Read as an analysis the same file is refused: there cannot be data from the future.
    const a = cli(['--file', p]);
    assert.equal(a.code, 1);
    assert.match(a.out, /is in the future: there cannot be data yet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --check passes the shipped template, whose plannedPerArm is the figure the tool says to plan', () => {
  const t = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
  const pf = preflight({ listSize: 2000, metric: 'orders', baselineRate: String(t.preRegistered.baselineRate), minLiftPct: t.preRegistered.minLiftPct });
  assert.equal(t.preRegistered.plannedPerArm, pf.planPerArm);
  const r = cli(['--check', '--file', TEMPLATE]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CHECK {2}PRE_REGISTERED/);
  assert.match(t._read_me_first, new RegExp(`under ${(pf.planPerArm * 2).toLocaleString('en-AU')} \\(${pf.planPerArm.toLocaleString('en-AU')} per arm`));
  // 20,617 is the smallest plan, not the plan for every list: the template and RUNBOOK 2.2 say to plan half the list.
  assert.match(t._read_me_first, /set plannedPerArm to half the list being split, the number each arm will actually get/);
  assert.match(t._read_me_first, /refuses an arm more than 5% under or over plannedPerArm/);
  const runbook = readFileSync(join(HERE, '..', 'RUNBOOK.md'), 'utf8');
  assert.match(runbook, /Set `plannedPerArm` to half the list being\s+split, the number each arm will actually get/);
  assert.doesNotMatch(runbook, /to at least the plan\s+figure/);
});

test('CLI: --preflight on 2,000 orders prints TOO SMALL with 19,586 needed and 20,617 to plan, and exits 1', () => {
  const r = cli(['--preflight', '--list-size', '2000', '--metric', 'orders']);
  assert.equal(r.code, 1);
  assert.match(r.out, /19,586 per arm/);
  assert.match(r.out, /plan 20,617 per arm \(41,234 on the list\)/);
  assert.match(r.out, /TOO SMALL: do not run this as a decision\. Send the cheaper arm \(the one you would name as defaultArm\) and stop\./);
  assert.equal(cli(['--preflight', '--list-size', '41234', '--metric', 'orders']).code, 0);
  assert.equal(cli(['--preflight', '--list-size', '41232', '--metric', 'orders']).code, 1);
  assert.equal(cli(['--preflight', '--list-size', '2000']).code, 2);
  assert.equal(cli(['--preflight', '--list-size', '2000', '--metric', 'orders', '--baseline-rate', '5e-2']).code, 2);
});

test('CLI: --preflight refuses a mistyped or empty flag with exit 2, where it used to fall back to the defaults and say go', () => {
  for (const extra of [['--min_lift', '20'], ['--min-lift'], ['--baseline', '0.0003'], ['--baseline-rate', '--min-lift', '50']]) {
    const r = cli(['--preflight', '--list-size', '60000', '--metric', 'orders', ...extra]);
    assert.equal(r.code, 2, `${extra.join(' ')}: ${r.out}`);
    assert.doesNotMatch(r.out, /BIG ENOUGH/);
    assert.match(r.out, /usage:/);
  }
  // Given properly, the intended figure is the one used: a 20% lift on 40,000 is TOO SMALL, exit 1.
  assert.equal(cli(['--preflight', '--list-size', '40000', '--metric', 'orders', '--min-lift', '20']).code, 1);
});

test('the run-sheet quotes the figures the tool computes, not older ones', () => {
  const sheet = readFileSync(RUN_SHEET, 'utf8');
  const n = (x) => x.toLocaleString('en-AU');
  const orders = preflight({ listSize: 2, metric: 'orders' });
  const half = preflight({ listSize: 2, metric: 'orders', minLiftPct: 50 });
  const clicks = preflight({ listSize: 2, metric: 'clicks' });
  for (const r of [orders, half, clicks]) {
    for (const figure of [r.requiredPerArm, r.planPerArm, r.planPerArm * 2]) assert.ok(sheet.includes(n(figure)), `the run-sheet quotes ${n(figure)}`);
  }
  assert.match(sheet, /0\.74%/);
  for (const stale of ['39,000', '1,350', '130,000', '19,600']) assert.ok(!sheet.includes(stale), `the run-sheet no longer says ${stale}`);
});
