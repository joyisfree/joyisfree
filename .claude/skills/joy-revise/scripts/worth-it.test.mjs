// The verdict is shown to refuse what it should: a named unknown, a field quietly treated as zero, a plan with
// no stop and a plan with no decisive test. Every guard here has a case that goes red without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worthIt, format } from './worth-it.mjs';

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

test('a plan that clears the bar is PURSUE, with the arithmetic shown', () => {
  const r = worthIt(good());
  assert.equal(r.verdict, 'PURSUE');
  // 500 x 0.2 x 0.5 = 50 expected; minus 5 costs and 15 of time = 30 net.
  assert.ok(Math.abs(r.evUsd - 50) < 1e-9, `ev ${r.evUsd}`);
  assert.ok(Math.abs(r.netUsd - 30) < 1e-9, `net ${r.netUsd}`);
  assert.ok(r.reasons.some((x) => /net \$30\.00/.test(x)));
  assert.match(format(good(), r), /KILL RULE/);
});

test('the hours are a real cost: the same plan at 10 hours is REFUSE', () => {
  const r = worthIt(good({ hours: 10 }));
  assert.equal(r.verdict, 'REFUSE');
  assert.ok(r.netUsd < 0);
  assert.ok(r.reasons.some((x) => /the hours are the largest cost/.test(x)));
});

test('the haircut bites: no haircut on the same plan can flip the verdict', () => {
  assert.equal(worthIt(good({ hours: 5, haircut: 0.5 })).verdict, 'REFUSE'); // 50 - 5 - 75 < 0
  assert.equal(worthIt(good({ hours: 5, haircut: 1 })).verdict, 'PURSUE');   // 100 - 5 - 75 > 0
});

test('capital at risk is counted in full, not discounted', () => {
  const r = worthIt(good({ capitalAtRisk: 100 }));
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
  ['a missing hourly bar is refused', { hourlyBar: undefined }, /hourlyBar is not a number/],
  ['a haircut above 1 is refused', { haircut: 2 }, /haircut must be between 0 and 1/],
  ['"unknown" capital at risk is not zero', { capitalAtRisk: 'unknown' }, /capitalAtRisk is not a number/],
  ['no cheapest test is refused', { cheapestTest: '' }, /cheapestTest is missing/],
  ['no kill rule is refused', { killRule: {} }, /killRule needs a metric, a number and a date/],
  ['a kill rule with no number is refused', { killRule: { metric: 'dollars', by: '2026-12-31' } }, /killRule needs/],
  ['a kill rule with no date is refused', { killRule: { metric: 'dollars', number: 10 } }, /killRule needs/],
  ['a kill rule whose date is not a date is refused', { killRule: { metric: 'dollars', number: 10, by: 'soon' } }, /killRule.by must be a date/],
];

for (const [name, over, re] of refusals) {
  test(`CANNOT_VALUE: ${name}`, () => {
    const r = worthIt(good(over));
    assert.equal(r.verdict, 'CANNOT_VALUE', `expected CANNOT_VALUE, got ${r.verdict}`);
    assert.equal(r.evUsd, null, 'an unpriceable decision gets no number');
    assert.ok(r.reasons.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(r.reasons)}`);
  });
}

test('CANNOT_VALUE beats a would-be PURSUE: an unpriceable decision is not a cheap one', () => {
  // These numbers would clear easily, but one unknown is named.
  const r = worthIt(good({ payoff: 100000, unknowns: ['whether the project exists'] }));
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.match(format(good({ unknowns: ['x'] }), r), /not a cheap decision/);
});

test('an empty decision refuses everything rather than returning zero', () => {
  const r = worthIt({});
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.ok(r.reasons.length >= 5, `expected several gaps named, got ${JSON.stringify(r.reasons)}`);
  assert.equal(worthIt().verdict, 'CANNOT_VALUE');
});

test('the per-hour return is reported against the bar', () => {
  const r = worthIt(good({ hours: 2 }));
  // (50 - 5 - 0) / 2 = 22.50 an hour against a $15 bar.
  assert.ok(Math.abs(r.perHourUsd - 22.5) < 1e-9, `per hour ${r.perHourUsd}`);
  assert.ok(r.reasons.some((x) => /\$22\.50 an hour against a \$15 bar/.test(x)));
});
