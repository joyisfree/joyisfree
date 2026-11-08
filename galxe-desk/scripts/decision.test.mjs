// The 31 Oct 2026 decision, pinned two ways. First, its arithmetic: the worth-it inputs committed beside the record
// reproduce REFUSE at net -$97.50 (realistic) and -$57.50 (generous), so the verdict is a command, not a memory.
// Second, its effect: the committed galxe-desk/decision.json is that refusal, and the ledger reads it as a stop.
// When Leif reopens the lane in his own words, decision.json and this file change together, in the same commit, with
// three more tests pinned to the refusal: ledger.test.mjs "desk:status reads the committed decision" and do-card.test.mjs
// "desk:card on the committed decision lists no quest" and "desk:card on a refused lane needs no shortlist". Each is
// rewritten to the reopened case, never deleted or weakened (galxe-claim SKILL.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worthIt } from '../../.claude/skills/joy-revise/scripts/worth-it.mjs';
import { readDecision, decisionStop, DECISION_FILE } from './ledger.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const inputs = JSON.parse(readFileSync(resolve(REPO, 'galxe-desk/docs/decision-2026-10-31.json'), 'utf8'));
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('the realistic case reproduces REFUSE at net -$97.50', () => {
  const r = worthIt(inputs);
  assert.equal(r.verdict, 'REFUSE', r.reasons.join('; '));
  assert.ok(near(r.netUsd, -97.5), `net ${r.netUsd}`);
  assert.equal(r.netUsd.toFixed(2), '-97.50');
  // 50 x 0.2 x 0.5 = $5 expected; minus $5 costs and 6.5 h at $15 = $97.50 of time.
  assert.ok(near(r.evUsd, 5), `ev ${r.evUsd}`);
  assert.ok(near(r.timeCostUsd, 97.5), `time ${r.timeCostUsd}`);
});

test('the generous case is still REFUSE, at net -$57.50 and $6.15 an hour against a $15 bar', () => {
  const r = worthIt(inputs.generous);
  assert.equal(r.verdict, 'REFUSE', r.reasons.join('; '));
  assert.ok(near(r.netUsd, -57.5), `net ${r.netUsd}`);
  assert.equal(r.netUsd.toFixed(2), '-57.50');
  assert.equal(r.perHourUsd.toFixed(2), '6.15');
});

test('both cases are complete on their own: no unknown, a cheapest test and a dated kill rule', () => {
  for (const c of [inputs, inputs.generous]) {
    assert.deepEqual(c.unknowns, []);
    assert.equal(c.haircut, 0.5);
    assert.equal(c.costs, 5);
    assert.equal(c.hours, 6.5);
    assert.equal(c.hourlyBar, 15);
    assert.ok(String(c.cheapestTest).trim(), 'a cheapest test is named');
    assert.ok(!Number.isNaN(Date.parse(c.killRule.by)), 'the kill rule has a date');
    // What the file says it recorded is what worth-it computes today.
    const r = worthIt(c);
    assert.equal(r.verdict, c.recordedVerdict);
    assert.ok(near(r.netUsd, c.recordedNetUsd), `${c.name}: recorded ${c.recordedNetUsd}, computed ${r.netUsd}`);
  }
  assert.deepEqual([inputs.payoff, inputs.probability, inputs.generous.payoff, inputs.generous.probability], [50, 0.2, 300, 0.3]);
});

test('the committed decision is the 31 Oct refusal, and the record it names exists and says REFUSE', () => {
  const read = readDecision(DECISION_FILE);
  assert.equal(read.error, undefined, read.error);
  const d = read.decision;
  assert.deepEqual(
    { lane: d.lane, verdict: d.verdict, decidedOn: d.decidedOn, record: d.record, reopensOnlyIf: d.reopensOnlyIf },
    { lane: 'galxe-questing', verdict: 'REFUSED', decidedOn: '2026-10-31', record: 'galxe-desk/docs/decision-2026-10-31-questing.md', reopensOnlyIf: 'Leif reopens it in his own words' },
  );
  const record = resolve(REPO, d.record);
  assert.ok(existsSync(record), `${d.record} exists`);
  assert.match(readFileSync(record, 'utf8'), /\*\*REFUSE — questing as income\.\*\*/);
  // The arithmetic and the decision point at the same record and the same day.
  assert.equal(inputs.record, d.record);
  assert.equal(inputs.decidedOn, d.decidedOn);
});

test('the ledger reads the committed decision as STOP_DECISION, in the words desk:status prints', () => {
  assert.equal(
    decisionStop(readDecision(DECISION_FILE)),
    'STOP_DECISION: refused 2026-10-31 (galxe-desk/docs/decision-2026-10-31-questing.md); reopens only if Leif reopens it in his own words',
  );
});
