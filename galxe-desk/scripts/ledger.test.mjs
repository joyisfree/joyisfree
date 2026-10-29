// The ledger's arithmetic, the claim deadlines and every kill rule, on fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger, status, validate, format } from './ledger.mjs';

const rules = { day30MinRealisedUsd: 10, minNetUsdPerHour: 15, horizonDays: 90 };
const day = (n) => Date.parse('2026-11-01T00:00:00Z') + n * 86_400_000;

const fixture = [
  { ts: '2026-11-01T09:00:00Z', quest: 'A', action: 'entered', minutes: 8, fee: 0.08 },
  { ts: '2026-11-02T09:00:00Z', quest: 'B', action: 'entered', minutes: 6, fee: 0.08 },
  { ts: '2026-11-05T09:00:00Z', quest: 'A', action: 'won', amount: 16.5, deadline: '2026-11-20' },
  { ts: '2026-11-06T09:00:00Z', quest: 'A', action: 'claimed', minutes: 2, fee: 0.08, gas: 0.02 },
  { ts: '2026-11-07T09:00:00Z', quest: 'A', action: 'realised', amount: 14.9 },
  { ts: '2026-11-08T09:00:00Z', quest: 'B', action: 'won', amount: 3, deadline: '2026-11-10' },
];

test('parses one JSON line per event', () => {
  const text = fixture.map((e) => JSON.stringify(e)).join('\n') + '\n\n';
  assert.equal(parseLedger(text).length, 6);
});

test('status adds up the money and the minutes', () => {
  const s = status(fixture, rules, day(8));
  assert.equal(s.entered, 2);
  assert.equal(s.won, 2);
  assert.equal(s.claimed, 1);
  assert.equal(s.realisedUsd, 14.9);
  assert.ok(Math.abs(s.costsUsd - 0.26) < 1e-9, `costs ${s.costsUsd}`);
  assert.ok(Math.abs(s.netUsd - 14.64) < 1e-9);
  assert.equal(s.minutes, 16);
  assert.ok(Math.abs(s.netUsdPerHour - 14.64 / (16 / 60)) < 1e-9);
  assert.equal(s.day, 9);
  assert.equal(s.kill, 'CONTINUE');
});

test('a won quest not yet claimed is due until its deadline, then OVERDUE', () => {
  const before = status(fixture, rules, day(8));
  assert.deepEqual(before.due.map((d) => d.quest), ['B']);
  assert.equal(before.overdue.length, 0);
  const after = status(fixture, rules, day(12));
  assert.deepEqual(after.overdue.map((d) => d.quest), ['B']);
  assert.match(format(after), /OVERDUE: B \(was 2026-11-10\)/);
});

test('kill rule: a flag stops the desk at once', () => {
  const s = status([...fixture, { ts: '2026-11-09T09:00:00Z', quest: 'C', action: 'flag', note: 'Bot activity detected' }], rules, day(9));
  assert.match(s.kill, /^STOP_FLAG: Bot activity detected/);
});

test('kill rule: day 30 with under $10 realised stops', () => {
  const thin = fixture.filter((e) => e.action !== 'realised');
  assert.match(status(thin, rules, day(30)).kill, /^STOP_DAY30/);
  assert.equal(status(fixture, rules, day(30)).kill, 'CONTINUE');
});

test('kill rule: day 60 below the hourly bar stops, above it continues', () => {
  const slow = [...fixture, { ts: '2026-11-20T09:00:00Z', quest: 'D', action: 'entered', minutes: 600, fee: 0 }];
  assert.match(status(slow, rules, day(60)).kill, /^STOP_RATE/);
  assert.equal(status(fixture, rules, day(60)).kill, 'CONTINUE');
  assert.match(status(fixture, rules, day(91)).kill, /^HORIZON/);
});

test('validate refuses unknown actions, missing ids and a win without its deadline', () => {
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'dance' }), /unknown action/);
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', action: 'entered' }), /quest id required/);
  assert.throws(() => validate({ ts: 'yesterday', quest: 'A', action: 'entered' }), /ISO date/);
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won' }), /claim deadline/);
  assert.ok(validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won', deadline: '2026-11-16' }));
});
