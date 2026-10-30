// The weekly Do card: fills Leif's minutes, cash first, marks his clicks, lists what is left for next week.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doCard, plan } from './do-card.mjs';

const task = (text, onX = false, onChain = false, done = false) => ({ text, onX, onChain, done });
const shortlist = {
  passed: [
    { id: 'C1', name: 'Week 1', space: 'Funded L2', url: 'https://app.galxe.com/quest/a/C1', ev: 4.9, minutes: 6, claimBy: '2026-11-25', tasks: [{ relation: 'ALL', items: [task('Follow @FundedL2 on X', true), task('Visit the docs page', false, false, true)] }] },
    { id: 'C2', name: 'Bridge week', space: 'Other L2', url: 'https://app.galxe.com/quest/b/C2', ev: 30, minutes: 20, claimBy: '2026-11-30', tasks: [{ relation: 'ALL', items: [task('Bridge $10', false, true)] }] },
  ],
  voyage: [
    { id: 'V1', name: 'Voyage week 3', space: 'PreToken L2', url: 'https://app.galxe.com/quest/c/V1', ev: 46.5, minutes: 8, claimBy: '2027-03-31', tasks: [{ relation: 'ANY', items: [task('Repost on X', true), task('Complete the quiz')] }] },
  ],
};

test('fills the week cash first by value per minute, and leaves what does not fit for next week', () => {
  const p = plan(shortlist, { weeklyMinutesCap: 30 });
  assert.deepEqual(p.picked.map((x) => x.id), ['C2', 'C1']);
  assert.deepEqual(p.skipped.map((x) => x.id), ['V1']);
  assert.equal(p.used, 26);
  const p2 = plan(shortlist, { weeklyMinutesCap: 40 });
  assert.deepEqual(p2.picked.map((x) => x.id), ['C2', 'C1', 'V1']);
});

test('the card gives the exact URL, marks X clicks and on-chain signatures as his, and ANY groups as one-of', () => {
  const card = doCard(shortlist, { weeklyMinutesCap: 40 }, new Date('2026-11-02T00:00:00Z'));
  assert.match(card, /^# Do card, week of 2026-11-02/);
  assert.match(card, /about 34 of your 40 minutes/);
  assert.match(card, /https:\/\/app\.galxe\.com\/quest\/b\/C2/);
  assert.match(card, /Follow @FundedL2 on X \(on X: your click\)/);
  assert.match(card, /Bridge \$10 \(on-chain: sign only this exact transaction\)/);
  assert.match(card, /Visit the docs page \(already done\)/);
  assert.match(card, /Do one of:\n   - Repost on X \(on X: your click\)\n   - Complete the quiz/);
  assert.match(card, /Voyage position, about 8 min, the project's cut-off 2027-03-31/);
  assert.match(card, /Refuse any approval, Permit or unlimited allowance/);
});

test('an empty week says so plainly', () => {
  assert.match(doCard({ passed: [], voyage: [] }, {}, new Date('2026-11-02T00:00:00Z')), /Nothing clears the gate this week/);
});
