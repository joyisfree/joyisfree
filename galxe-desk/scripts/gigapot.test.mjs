// The Gigapot calculator: it refuses to value the lottery on public information, and prices a ticket honestly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ggCostUsd, gigapotEv, format, TICKET_GG } from './gigapot.mjs';

test('GG is priced at what it really costs: claim fees, not a made-up token value', () => {
  // +30 GG per qualified claim at the $0.08 fee, so 30 GG costs $0.08 and a 50 GG ticket about $0.13.
  assert.ok(Math.abs(ggCostUsd(30) - 0.08) < 1e-9);
  assert.ok(Math.abs(ggCostUsd(TICKET_GG) - 0.1333333) < 1e-5, `50 GG = ${ggCostUsd(TICKET_GG)}`);
  assert.equal(ggCostUsd(0), 0);
  assert.equal(ggCostUsd('unknown'), null, 'a non-number is never priced as zero');
  assert.equal(ggCostUsd(-5), null);
});

test('on public information the lottery CANNOT be valued, and the desk refuses it', () => {
  const r = gigapotEv({});
  assert.equal(r.verdict, 'CANNOT_VALUE');
  assert.equal(r.evUsd, null);
  assert.match(r.reason, /pool size and no tickets sold/);
  assert.ok(r.costUsd > 0, 'the cost is still known even when the return is not');
  assert.match(format(r), /CANNOT_VALUE/);
  assert.match(format(r), /does not buy tickets/);
});

test('a missing pool or a missing ticket count each alone still cannot be valued', () => {
  assert.equal(gigapotEv({ poolUsd: 5000 }).verdict, 'CANNOT_VALUE');
  assert.equal(gigapotEv({ ticketsSold: 40000 }).verdict, 'CANNOT_VALUE');
  assert.equal(gigapotEv({ poolUsd: 'unknown', ticketsSold: 'unknown' }).verdict, 'CANNOT_VALUE');
  assert.equal(gigapotEv({ poolUsd: 0, ticketsSold: 10 }).verdict, 'CANNOT_VALUE', 'a zero pool is not a valuation');
});

test('with the caller\'s own estimates it computes a ticket and labels the basis as an estimate', () => {
  // A $5,000 pot over 40,000 tickets: half to one winner, half split 1,000 ways.
  const r = gigapotEv({ poolUsd: 5000, ticketsSold: 40000 });
  const grand = 2500 / 40000;             // 0.0625
  const split = (2500 / 1000) * (1000 / 40000); // 0.0625
  assert.ok(Math.abs(r.evUsd - (grand + split)) < 1e-9, `ev ${r.evUsd}`);
  assert.equal(r.verdict, 'NEGATIVE_EV', 'about $0.125 back on $0.133 of fees');
  assert.match(r.basis, /estimate/);
  assert.match(format(r), /NEGATIVE_EV/);
});

test('a pot big enough relative to tickets sold does clear the bar, so the guard is not a rigged "no"', () => {
  const r = gigapotEv({ poolUsd: 50000, ticketsSold: 40000 });
  assert.equal(r.verdict, 'POSITIVE_EV');
  assert.ok(r.netUsd > 0);
});

test('ten tickets cost ten tickets and are valued as ten', () => {
  const one = gigapotEv({ poolUsd: 5000, ticketsSold: 40000, tickets: 1 });
  const ten = gigapotEv({ poolUsd: 5000, ticketsSold: 40000, tickets: 10 });
  assert.ok(Math.abs(ten.costUsd - one.costUsd * 10) < 1e-9);
  assert.ok(Math.abs(ten.evUsd - one.evUsd * 10) < 1e-9);
});

test('the 7-day flip deadline is always stated, because a win that is not flipped is void', () => {
  assert.match(format(gigapotEv({})), /within 7 days/);
});
