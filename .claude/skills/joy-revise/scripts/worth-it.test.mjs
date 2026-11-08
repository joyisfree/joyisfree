// The verdict is shown to refuse what it should: a named unknown, a field quietly treated as zero, a plan with
// no stop and a plan with no decisive test. Every guard here has a case that goes red without it.
//
// Every judgement stands on a fixed day (`now` is injected), so these tests do not start failing when the calendar
// moves past a kill date. NOW is midday on Sunday 8 Nov 2026 in Sydney.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  worthIt, format, strictDate, dayText, sydneyDay, checkHourlyBar, readHourlyBar, CONFIG_FILE, MAX_KILL_DAYS,
} from './worth-it.mjs';

const NOW = Date.parse('2026-11-08T01:00:00Z');
const judge = (d, opts = {}) => worthIt(d, { now: NOW, ...opts });
const SCRIPT = fileURLToPath(new URL('./worth-it.mjs', import.meta.url));

// A complete, honest decision: small payoff, long odds, cheap to try.
const good = (over = {}) => ({
  name: 'a bounded try',
  payoff: 500,
  probability: 0.2,
  haircut: 0.5,
  costs: 5,
  capitalAtRisk: 0,
  hours: 1,
  hourlyBar: 15,
  unknowns: [],
  cheapestTest: 'email the existing list first',
  killRule: { metric: 'realised dollars', number: 100, by: '2026-12-31' },
  ...over,
});
const killBy = (by) => ({ killRule: { metric: 'realised dollars', number: 100, by } });

test('a plan that clears the bar is PURSUE, with the arithmetic shown', () => {
  const r = judge(good());
  assert.equal(r.verdict, 'PURSUE');
  // 500 x 0.2 x 0.5 = 50 expected; minus 5 costs and 15 of time = 30 net.
  assert.ok(Math.abs(r.evUsd - 50) < 1e-9, `ev ${r.evUsd}`);
  assert.ok(Math.abs(r.netUsd - 30) < 1e-9, `net ${r.netUsd}`);
  assert.ok(r.reasons.some((x) => /net \$30\.00/.test(x)));
  assert.deepEqual(r.notes, []);
  assert.match(format(good(), r), /KILL RULE/);
});

test('the hours are a real cost: the same plan at 10 hours is REFUSE', () => {
  const r = judge(good({ hours: 10 }));
  assert.equal(r.verdict, 'REFUSE');
  assert.ok(r.netUsd < 0);
  assert.ok(r.reasons.some((x) => /the hours are the largest cost/.test(x)));
});

test('the haircut bites: no haircut on the same plan can flip the verdict', () => {
  assert.equal(judge(good({ hours: 5, haircut: 0.5 })).verdict, 'REFUSE'); // 50 - 5 - 75 < 0
  assert.equal(judge(good({ hours: 5, haircut: 1 })).verdict, 'PURSUE');   // 100 - 5 - 75 > 0
});

test('capital at risk is counted in full, not discounted', () => {
  const r = judge(good({ capitalAtRisk: 100 }));
  assert.equal(r.verdict, 'REFUSE');
  assert.ok(r.reasons.some((x) => /100\.00 at risk/.test(x)));
});

const refusals = [
  ['a named unknown refuses the whole thing', { unknowns: ['the pool size'] }, /unknown: the pool size/],
  ['two unknowns are both named', { unknowns: ['pool size', 'the odds'] }, /unknown: the odds/],
  ['unknowns must be an explicit list', { unknowns: undefined }, /unknowns must be a list/],
  ['a missing payoff is not zero', { payoff: undefined }, /payoff is not a number/],
  ['"unknown" as a payoff is not zero', { payoff: 'unknown' }, /payoff is not a number/],
  ['a missing probability is not certainty', { probability: undefined }, /probability is not a number/],
  ['a probability above 1 is refused', { probability: 1.5 }, /between 0 and 1/],
  ['a negative probability is refused', { probability: -0.2 }, /cannot be negative/],
  ['missing costs are not zero', { costs: undefined }, /costs is not a number/],
  ['missing hours are not zero', { hours: undefined }, /hours is not a number/],
  ['a missing hourly bar is refused when no default is offered', { hourlyBar: undefined }, /hourlyBar is not a number/],
  ['an hourly bar of 0 is refused: his time is never free', { hourlyBar: 0 }, /hourlyBar is 0/],
  ['a haircut above 1 is refused', { haircut: 2 }, /haircut must be between 0 and 1/],
  ['"unknown" capital at risk is not zero', { capitalAtRisk: 'unknown' }, /capitalAtRisk is not a number/],
  ['no cheapest test is refused', { cheapestTest: '' }, /cheapestTest is missing/],
  ['no kill rule is refused', { killRule: {} }, /killRule needs a metric, a number and a date/],
  ['a kill rule with no number is refused', { killRule: { metric: 'dollars', by: '2026-12-31' } }, /killRule needs/],
  ['a kill rule with no date is refused', { killRule: { metric: 'dollars', number: 10 } }, /killRule needs/],
  ['a kill rule whose date is not a date is refused', killBy('soon'), /killRule.by must be a date/],
];

for (const [name, over, re] of refusals) {
  test(`CANNOT_VALUE: ${name}`, () => {
    const r = judge(good(over));
    assert.equal(r.verdict, 'CANNOT_VALUE', `expected CANNOT_VALUE, got ${r.verdict}`);
    assert.equal(r.evUsd, null, 'an unpriceable decision gets no number');
    assert.ok(r.reasons.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(r.reasons)}`);
  });
}

test('CANNOT_VALUE beats a would-be PURSUE: an unpriceable decision is not a cheap one', () => {
  // These numbers would clear easily, but one unknown is named.
  const r = judge(good({ payoff: 100000, unknowns: ['whether the project exists'] }));
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.match(format(good({ unknowns: ['x'] }), r), /not a cheap decision/);
});

test('an empty decision refuses everything rather than returning zero', () => {
  const r = judge({});
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.ok(r.reasons.length >= 5, `expected several gaps named, got ${JSON.stringify(r.reasons)}`);
  assert.equal(worthIt().verdict, 'CANNOT_VALUE');
});

// ------------------------------------------------------------------ nothing typed is read as zero (wave 0)

// Number() reads ' ', '\t', [] and [''] as 0 and [500] as 500. Each must refuse in every field, by that field's name.
const NOT_NUMBERS = [' ', '\t', [], [''], [500], '0x10'];
const FIELD_GAP = [
  ['payoff', /^payoff is not a number/], ['probability', /^probability is not a number/], ['costs', /^costs is not a number/],
  ['hours', /^hours is not a number/], ['hourlyBar', /^hourlyBar is not a number/], ['haircut', /^haircut must be between 0 and 1/],
  ['capitalAtRisk', /^capitalAtRisk is not a number/], ['daysToFirstDollar', /^daysToFirstDollar must be a whole number/],
];

test('a blank, a tab, a list or a hex string is never read as a number, in any field', () => {
  for (const v of NOT_NUMBERS) {
    for (const [key, re] of FIELD_GAP) {
      const r = judge(good({ [key]: v }));
      assert.equal(r.verdict, 'CANNOT_VALUE', `${key} = ${JSON.stringify(v)} gave ${r.verdict}`);
      assert.ok(r.reasons.some((x) => re.test(x)), `${key} = ${JSON.stringify(v)}: ${JSON.stringify(r.reasons)}`);
    }
    const k = judge(good({ killRule: { metric: 'realised dollars', number: v, by: '2026-12-31' } }));
    assert.equal(k.verdict, 'CANNOT_VALUE', `killRule.number = ${JSON.stringify(v)} gave ${k.verdict}`);
    assert.ok(k.reasons.some((x) => /killRule needs a metric, a number and a date/.test(x)), JSON.stringify(k.reasons));
  }
  // A number written out, padded or with an exponent, is still read.
  assert.equal(judge(good({ costs: ' 5 ', payoff: '5e2' })).netUsd, 30);
});

test('hours of 0 are refused like a bar of 0: either one makes the time cost vanish', () => {
  for (const h of [0, '0', '0.0']) {
    const r = judge(good({ hours: h }));
    assert.equal(r.verdict, 'CANNOT_VALUE', JSON.stringify(h));
    assert.ok(r.reasons.some((x) => /^hours is 0: every plan takes some of his time/.test(x)), JSON.stringify(r.reasons));
  }
  assert.equal(judge(good({ hours: 0.1 })).verdict, 'PURSUE');
});

test('a 0 typed as a number is a real 0 where it can be: no cash, nothing at risk, no payoff', () => {
  // Costs and capital of 0 are genuine (a play with no cash out); a 0 payoff, chance or haircut can only refuse.
  assert.equal(judge(good({ costs: 0 })).netUsd, 35);
  assert.equal(judge(good({ capitalAtRisk: '0' })).verdict, 'PURSUE');
  for (const key of ['payoff', 'probability', 'haircut']) assert.equal(judge(good({ [key]: 0 })).verdict, 'REFUSE', key);
});

test('the per-hour return is reported against the bar', () => {
  const r = judge(good({ hours: 2 }));
  // (50 - 5 - 0) / 2 = 22.50 an hour against a $15 bar.
  assert.ok(Math.abs(r.perHourUsd - 22.5) < 1e-9, `per hour ${r.perHourUsd}`);
  assert.ok(r.reasons.some((x) => /\$22\.50 an hour against a \$15 bar/.test(x)));
});

// ------------------------------------------------------------------ strict dates (audit C5)

test('strictDate takes YYYY-MM-DD only, as a day number, and refuses everything else', () => {
  assert.equal(strictDate('2026-11-08'), Date.parse('2026-11-08T00:00:00Z') / 86_400_000);
  assert.equal(dayText(strictDate('2026-11-08')), '2026-11-08');
  for (const v of ['2026-11-31', '2026-02-29', '2026-13-01', '1', 'Nov 9', '2026-11-08T00:00:00Z', 20261108, new Date(NOW), null, undefined]) {
    assert.equal(strictDate(v), null, `${String(v)} must be refused`);
  }
});

for (const [why, by] of [
  ['a bare number (Date.parse reads "1" as 1 Jan 2001)', '1'],
  ['a number, not a string', 20261130],
  ['a month name', 'Nov 30 2026'],
  ['an Australian slash date', '30/11/2026'],
  ['an American slash date', '11/30/2026'],
  ['a single-digit month', '2026-1-05'],
  ['a timestamp', '2026-11-30T00:00:00Z'],
  ['a padded date', ' 2026-11-30'],
  ['a day that does not exist (31 Nov would roll into December)', '2026-11-31'],
  ['day 32 (would roll into January)', '2026-12-32'],
  ['month 13 (would roll into January)', '2026-13-01'],
]) {
  test(`CANNOT_VALUE: a kill date that is ${why}`, () => {
    const r = judge(good(killBy(by)));
    assert.equal(r.verdict, 'CANNOT_VALUE');
    assert.ok(r.reasons.some((x) => /killRule\.by must be a date written YYYY-MM-DD/.test(x)), JSON.stringify(r.reasons));
  });
}

test('the kill date must be after today in Sydney: tomorrow passes, today and yesterday do not', () => {
  assert.equal(judge(good(killBy('2026-11-09'))).verdict, 'PURSUE');
  for (const by of ['2026-11-08', '2026-11-07', '2001-01-01']) {
    const r = judge(good(killBy(by)));
    assert.equal(r.verdict, 'CANNOT_VALUE', by);
    assert.ok(r.reasons.some((x) => /is not after 2026-11-08, today in Sydney/.test(x)), JSON.stringify(r.reasons));
  }
  // With no `now` injected the real clock is used, and 2001 is in the past on any day this runs.
  assert.equal(worthIt(good(killBy('2001-01-02'))).verdict, 'CANNOT_VALUE');
});

test("today is Sydney's calendar day, not UTC's: 00:30 on 9 Nov in Sydney is still 8 Nov in UTC", () => {
  const lateSat = Date.parse('2026-11-08T12:30:00Z'); // 23:30 on 8 Nov in Sydney (AEDT, +11)
  const earlySun = Date.parse('2026-11-08T13:30:00Z'); // 00:30 on 9 Nov in Sydney
  assert.equal(dayText(sydneyDay(lateSat)), '2026-11-08');
  assert.equal(dayText(sydneyDay(earlySun)), '2026-11-09');
  assert.equal(worthIt(good(killBy('2026-11-09')), { now: lateSat }).verdict, 'PURSUE');
  const r = worthIt(good(killBy('2026-11-09')), { now: earlySun });
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.ok(r.reasons.some((x) => /not after 2026-11-09, today in Sydney/.test(x)), JSON.stringify(r.reasons));
});

test('a clock that cannot be read refuses rather than skipping the date check', () => {
  assert.equal(sydneyDay(NaN), null);
  const r = worthIt(good(), { now: NaN });
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.ok(r.reasons.some((x) => /today's date in Sydney could not be read/.test(x)));
});

test(`a kill date more than ${MAX_KILL_DAYS} days out is refused; ${MAX_KILL_DAYS} exactly is allowed`, () => {
  assert.equal(judge(good(killBy('2027-05-07'))).verdict, 'PURSUE'); // 180 days after 8 Nov 2026
  const r = judge(good(killBy('2027-05-08')));
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.ok(r.reasons.some((x) => /181 days after 2026-11-08, today in Sydney, more than 180/.test(x)), JSON.stringify(r.reasons));
});

test('decidedOn is a strict date and never in the future', () => {
  const loose = judge(good({ decidedOn: '8 Nov 2026' }));
  assert.equal(loose.verdict, 'CANNOT_VALUE');
  assert.ok(loose.reasons.some((x) => /decidedOn must be a date written YYYY-MM-DD/.test(x)), JSON.stringify(loose.reasons));
  // Dated tomorrow, a decision would move its own window forward; it is refused, not judged from tomorrow.
  const future = judge(good({ decidedOn: '2026-11-09', ...killBy('2026-11-20') }));
  assert.equal(future.verdict, 'CANNOT_VALUE');
  assert.ok(future.reasons.some((x) => /decidedOn 2026-11-09 is after today in Sydney \(2026-11-08\)/.test(x)), JSON.stringify(future.reasons));
  assert.equal(judge(good({ decidedOn: '2026-11-08', ...killBy('2026-11-20') })).verdict, 'PURSUE');
});

test('a past decision is judged on the day it was decided: its kill date is measured from decidedOn', () => {
  assert.equal(judge(good({ decidedOn: '2026-10-31', ...killBy('2026-11-29') })).verdict, 'PURSUE');
  const same = judge(good({ decidedOn: '2026-10-31', ...killBy('2026-10-31') }));
  assert.equal(same.verdict, 'CANNOT_VALUE');
  assert.ok(same.reasons.some((x) => /not after 2026-10-31, the day it was decided/.test(x)), JSON.stringify(same.reasons));
  const far = judge(good({ decidedOn: '2026-10-31', ...killBy('2027-04-30') })); // 181 days after 31 Oct
  assert.equal(far.verdict, 'CANNOT_VALUE');
  assert.ok(far.reasons.some((x) => /181 days after 2026-10-31, the day it was decided/.test(x)), JSON.stringify(far.reasons));
});

test('once its kill date has gone, a past decision can still say no but never yes', () => {
  const stale = { decidedOn: '2026-10-01', ...killBy('2026-10-31') }; // stop passed 8 days before NOW
  const yes = judge(good(stale));
  assert.equal(yes.verdict, 'CANNOT_VALUE', 'a would-be PURSUE on a passed stop is not approved again');
  assert.equal(yes.evUsd, null);
  assert.ok(yes.reasons.some((x) => /has passed .*never approved again/.test(x)), JSON.stringify(yes.reasons));
  const no = judge(good({ ...stale, hours: 10 }));
  assert.equal(no.verdict, 'REFUSE');
  assert.ok(no.notes.some((x) => /reproduces the verdict of 2026-10-01; its kill date 2026-10-31 has passed/.test(x)), JSON.stringify(no.notes));
});

test('the committed 31 Oct record still reproduces REFUSE at net -$97.50 long after its kill date', () => {
  const record = JSON.parse(readFileSync(new URL('../../../../galxe-desk/docs/decision-2026-10-31.json', import.meta.url), 'utf8'));
  const r = worthIt(record, { now: Date.parse('2027-06-01T00:00:00Z') });
  assert.equal(r.verdict, 'REFUSE', JSON.stringify(r.reasons));
  assert.equal(r.netUsd.toFixed(2), '-97.50');
  assert.ok(r.notes.some((x) => /reproduces the verdict of 2026-10-31/.test(x)), JSON.stringify(r.notes));
});

// ------------------------------------------------------------------ the cheapest test, and the first dollar

test('a cheapest test needs four words, or a named command', () => {
  for (const t of ['x', 'check the list', '— — — —', 12345, ['email', 'the', 'list', 'first']]) {
    const r = judge(good({ cheapestTest: t }));
    assert.equal(r.verdict, 'CANNOT_VALUE', JSON.stringify(t));
    assert.ok(r.reasons.some((x) => /under 4 words and names no command/.test(x)), JSON.stringify(r.reasons));
  }
  for (const t of ['email the list first', 'npm run orders', '`node agency/scripts/orders.mjs`', 'npm test']) {
    assert.equal(judge(good({ cheapestTest: t })).verdict, 'PURSUE', t);
  }
});

test('a repeated word, a run of dashes or digits alone is not four words', () => {
  for (const t of ['TBD TBD TBD TBD', 'x x x x', 'list list List LIST', 'n/a n/a n/a n/a', '- -- --- ----', 'check -- --- ----', '1 2 3 4']) {
    const r = judge(good({ cheapestTest: t }));
    assert.equal(r.verdict, 'CANNOT_VALUE', t);
    assert.ok(r.reasons.some((x) => /under 4 words and names no command/.test(x)), JSON.stringify(r.reasons));
  }
  // Digits still count beside words, and a word said twice is one word, not zero.
  for (const t of ['check 20 abandoned checkouts', 'email the email list first']) assert.equal(judge(good({ cheapestTest: t })).verdict, 'PURSUE', t);
});

test('an obvious placeholder is not a test, however many words it has', () => {
  for (const t of ['to be decided later', 'no test needed here', 'TBD: email the list first', 'email the list, details to be confirmed', 'N/A for this one plan', 'todo write the real test']) {
    const r = judge(good({ cheapestTest: t }));
    assert.equal(r.verdict, 'CANNOT_VALUE', t);
    assert.ok(r.reasons.some((x) => /is a placeholder, not a test/.test(x)), JSON.stringify(r.reasons));
  }
  // Narrow: "no" or "test" inside a real check is not a placeholder.
  for (const t of ['count the checkouts with no email', 'test one send to the list']) assert.equal(judge(good({ cheapestTest: t })).verdict, 'PURSUE', t);
});

test('a short command counts only when it is the whole test and is real here', () => {
  for (const t of ['npm run nothing-here', 'node x.mjs', '`node agency/scripts/missing.mjs`', 'maybe npm test', 'npm install']) {
    const r = judge(good({ cheapestTest: t }));
    assert.equal(r.verdict, 'CANNOT_VALUE', t);
    assert.ok(r.reasons.some((x) => /under 4 words and names no command/.test(x)), JSON.stringify(r.reasons));
  }
  for (const t of ['npm run orders', 'npm test', 'npm run worth-it -- --file x.json', '`node agency/scripts/orders.mjs`']) {
    assert.equal(judge(good({ cheapestTest: t })).verdict, 'PURSUE', t);
  }
});

test('a kill rule that can never fire is refused: a number of 0 or below, or a placeholder for a metric', () => {
  for (const number of [0, '0', -1, -0.5]) {
    const r = judge(good({ killRule: { metric: 'realised dollars', number, by: '2026-12-31' } }));
    assert.equal(r.verdict, 'CANNOT_VALUE', JSON.stringify(number));
    assert.ok(r.reasons.some((x) => /^killRule\.number is -?[\d.]+: "realised dollars under -?[\d.]+" can never fire/.test(x)), JSON.stringify(r.reasons));
  }
  for (const metric of ['x', '?', '1', 'TBD', 'n/a', 'metric to be decided']) {
    const r = judge(good({ killRule: { metric, number: 100, by: '2026-12-31' } }));
    assert.equal(r.verdict, 'CANNOT_VALUE', metric);
    assert.ok(r.reasons.some((x) => /^killRule\.metric .* is a placeholder/.test(x)), JSON.stringify(r.reasons));
  }
  assert.equal(judge(good({ killRule: { metric: 'orders', number: 1, by: '2026-12-31' } })).verdict, 'PURSUE');
});

test('daysToFirstDollar is optional, a whole number, and reported as stated', () => {
  const none = judge(good());
  assert.equal(none.daysToFirstDollar, null);
  assert.ok(!none.reasons.some((x) => /first realised dollar/.test(x)));
  for (const [given, n] of [[14, 14], ['14', 14], [0, 0], [1, 1]]) {
    const r = judge(good({ daysToFirstDollar: given }));
    assert.equal(r.verdict, 'PURSUE');
    assert.equal(r.daysToFirstDollar, n);
    assert.ok(r.reasons.some((x) => x.includes(`first realised dollar expected in ${n} day`)), JSON.stringify(r.reasons));
  }
  for (const bad of ['soon', 'unknown', '', null, 2.5, -1, true]) {
    const r = judge(good({ daysToFirstDollar: bad }));
    assert.equal(r.verdict, 'CANNOT_VALUE', JSON.stringify(bad));
    assert.ok(r.reasons.some((x) => /daysToFirstDollar must be a whole number/.test(x)), JSON.stringify(r.reasons));
  }
});

// ------------------------------------------------------------------ the stored hourly bar (audit C9)

test("the committed config stores the bar once: A$25, labelled a default and not Leif's choice", () => {
  const { bar, error } = readHourlyBar(CONFIG_FILE);
  assert.equal(error, undefined, error);
  assert.deepEqual(
    { amount: bar.amount, currency: bar.currency, status: bar.status, why: bar.why },
    { amount: 25, currency: 'AUD', status: "default, not Leif's choice", why: 'about the Australian adult minimum wage; Leif has never set his own' },
  );
});

test('with no bar given the stored default is used, and the verdict says it is a default', () => {
  const defaultBar = readHourlyBar(CONFIG_FILE);
  const r = judge(good({ hourlyBar: undefined }), { defaultBar });
  assert.equal(r.verdict, 'PURSUE');
  assert.equal(r.timeCostUsd, 25); // 1 h at A$25
  assert.ok(r.notes.some((x) => /hourly bar AUD 25\/h, read from joy\.config\.json \(default, not Leif's choice; about the Australian/.test(x)), JSON.stringify(r.notes));
  assert.match(format(good({ hourlyBar: undefined }), r), /note hourly bar AUD 25\/h/);
});

test('a bar that is given wins, and a broken default is then never consulted', () => {
  const r = judge(good(), { defaultBar: { error: 'joy.config.json could not be read (ENOENT)' } });
  assert.equal(r.verdict, 'PURSUE');
  assert.deepEqual(r.notes, []);
  assert.equal(r.timeCostUsd, 15);
});

test('the default bar refuses a decision in another currency rather than mixing them', () => {
  const defaultBar = readHourlyBar(CONFIG_FILE);
  const usd = judge(good({ hourlyBar: undefined, currency: 'USD' }), { defaultBar });
  assert.equal(usd.verdict, 'CANNOT_VALUE');
  assert.ok(usd.reasons.some((x) => /stored default is in AUD while this decision is in USD/.test(x)), JSON.stringify(usd.reasons));
  assert.equal(judge(good({ hourlyBar: undefined, currency: 'AUD' }), { defaultBar }).verdict, 'PURSUE');
});

test('a stored bar that cannot be read refuses, never falls back to zero', () => {
  const missing = readHourlyBar('/nonexistent/joy.config.json');
  assert.match(missing.error, /could not be read/);
  const r = judge(good({ hourlyBar: undefined }), { defaultBar: missing });
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.ok(r.reasons.some((x) => /stored default cannot be used/.test(x)), JSON.stringify(r.reasons));
});

const amountOk = { amount: 25, currency: 'AUD', status: "default, not Leif's choice", why: 'the floor' };
for (const [why, cfg, re] of [
  ['no hourlyBar at all', {}, /has no hourlyBar object/],
  ['a bare number for hourlyBar', { hourlyBar: 25 }, /has no hourlyBar object/],
  ['an amount written as a string', { hourlyBar: { ...amountOk, amount: '25' } }, /not a positive number/],
  ['an amount of 0', { hourlyBar: { ...amountOk, amount: 0 } }, /not a positive number/],
  ['no currency', { hourlyBar: { ...amountOk, currency: undefined } }, /three-letter code/],
  ['a currency symbol, not a code', { hourlyBar: { ...amountOk, currency: 'A$' } }, /three-letter code/],
  ['a lower-case code', { hourlyBar: { ...amountOk, currency: 'aud' } }, /three-letter code/],
  ['no status saying whose number it is', { hourlyBar: { ...amountOk, status: '  ' } }, /whose number it is/],
  ['no reason why', { hourlyBar: { ...amountOk, why: undefined } }, /whose number it is/],
]) {
  test(`the stored bar is refused with ${why}`, () => {
    const res = checkHourlyBar(cfg, '/repo/joy.config.json');
    assert.equal(res.bar, undefined);
    assert.match(res.error, re);
    assert.equal(judge(good({ hourlyBar: undefined }), { defaultBar: res }).verdict, 'CANNOT_VALUE');
  });
}

// ------------------------------------------------------------------ the command itself

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const live = () => {
  // A kill date 30 days after today in Sydney, so the command can be judged by the real clock.
  const by = dayText(sydneyDay(Date.now()) + 30);
  return ['--payoff', '500', '--probability', '0.2', '--haircut', '0.5', '--costs', '5', '--hours', '1',
    '--cheapest-test', 'email the existing list first', '--kill-metric', 'realised dollars', '--kill-number', '100', '--kill-by', by];
};

test('the command: --kill-by 1 exits non-zero and names the bad date', () => {
  const p = run(...live().slice(0, -1), '1', '--hourly-bar', '25');
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /VERDICT {2}CANNOT_VALUE/);
  assert.match(p.stdout, /killRule\.by must be a date written YYYY-MM-DD \(got "1"\)/);
});

test('the command: with no --hourly-bar it uses the stored A$25 and prints that it is a default', () => {
  const p = run(...live());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.match(p.stdout, /VERDICT {2}PURSUE/);
  assert.match(p.stdout, /1 h at \$25\/h/);
  assert.match(p.stdout, /default, not Leif's choice/);
  const given = run(...live(), '--hourly-bar', '25');
  assert.equal(given.status, 0, given.stdout + given.stderr);
  assert.doesNotMatch(given.stdout, /default, not Leif's choice/);
});

test('the command: --hourly-bar with no value is refused, not quietly replaced by the default', () => {
  const p = run('--hourly-bar', ...live());
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /hourlyBar is not a number/);
  assert.doesNotMatch(p.stdout, /default, not Leif's choice/);
});

test('the command: --unknowns given empty is not a list of none', () => {
  const p = run(...live(), '--hourly-bar', '25', '--unknowns');
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /unknowns must be a list/);
});

// The live arguments with one flag's value swapped out.
const withArg = (flag, value) => { const a = live(); return a.map((x, i) => (a[i - 1] === flag ? value : x)); };

test('the command: --hours " " is not 0 hours', () => {
  const p = run(...withArg('--hours', ' '));
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /hours is not a number/);
  assert.doesNotMatch(p.stdout, /0 h at/);
});

test('the command: a TBD test and a kill number of 0 are refused, not approved', () => {
  const p = run(...withArg('--cheapest-test', 'TBD TBD TBD TBD').map((x, i, a) => (a[i - 1] === '--kill-number' ? '0' : x)));
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /VERDICT {2}CANNOT_VALUE/);
  assert.match(p.stdout, /cheapestTest "TBD TBD TBD TBD" is under 4 words/);
  assert.match(p.stdout, /killRule\.number is 0/);
});

test('the command: an unreadable stored bar refuses', () => {
  const p = run(...live(), '--config', '/nonexistent/joy.config.json');
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /stored default cannot be used: joy\.config\.json could not be read/);
});
