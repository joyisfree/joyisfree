// The weekly Do card: fills Leif's minutes, ending-soon first, keeps all quests inside one wallet cap, marks his clicks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doCard, plan, safeTaskText } from './do-card.mjs';

const NOW = Date.parse('2026-11-02T00:00:00Z');
const task = (text, onX = false, onChain = false, done = false) => ({ text, onX, onChain, done });
const shortlist = () => ({
  passed: [
    { id: 'C1', name: 'Week 1', space: 'Funded L2', url: 'https://app.galxe.com/quest/a/C1', ev: 4.9, minutes: 6, endsAt: '2026-11-20', claimBy: '2026-12-05', capitalUsd: 0, tasks: [{ relation: 'ALL', items: [task('Follow @FundedL2 on X', true), task('Visit the docs page', false, false, true)] }] },
    { id: 'C2', name: 'Bridge week', space: 'Other L2', url: 'https://app.galxe.com/quest/b/C2', ev: 30, minutes: 12, endsAt: '2026-11-25', claimBy: '2026-12-10', capitalUsd: 20, tasks: [{ relation: 'ALL', items: [task('Bridge $20', false, true)] }] },
    { id: 'C3', name: 'Swap week', space: 'Third L2', url: 'https://app.galxe.com/quest/c/C3', ev: 25, minutes: 5, endsAt: '2026-11-28', claimBy: '2026-12-13', capitalUsd: 10, tasks: [{ relation: 'ANY', items: [task('Swap $10', false, true), task('Hold $10 for a week', false, true)] }] },
    { id: 'C4', name: 'Closing soon', space: 'Fourth L2', url: 'https://app.galxe.com/quest/d/C4', ev: 2.5, minutes: 4, endsAt: '2026-11-05', claimBy: '2026-11-20', capitalUsd: 0, tasks: [{ relation: 'ALL', items: [task('Repost on X', true)] }] },
  ],
});

test('quests ending before next week go first, then best value per minute', () => {
  const p = plan(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, NOW);
  assert.deepEqual(p.picked.map((x) => x.id), ['C4', 'C3', 'C2', 'C1']);
  assert.equal(p.picked[0].urgent, true);
});

test('all quests share one wallet cap: money tied up at once never exceeds it', () => {
  const p = plan(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 25 }, NOW);
  assert.deepEqual(p.picked.map((x) => x.id), ['C4', 'C3', 'C1']);
  assert.equal(p.capital, 10);
  assert.deepEqual(p.skipped.map((x) => [x.id, x.why]), [['C2', 'the $25 wallet cap is already in use']]);
});

test('the week fills to the minutes cap and leaves the rest for next week', () => {
  const p = plan(shortlist(), { weeklyMinutesCap: 10, walletCapUsd: 100 }, NOW);
  assert.deepEqual(p.picked.map((x) => x.id), ['C4', 'C3']);
  assert.equal(p.used, 9);
  assert.ok(p.skipped.every((x) => x.why === 'the minutes ran out'));
});

test('the card gives the exact URL, marks X clicks and on-chain signatures as his, and ANY groups as one-of', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 25 }, new Date(NOW));
  assert.match(card, /^# Do card, week of 2026-11-02/);
  assert.match(card, /about 15 of your 60 minutes/);
  assert.match(card, /Money tied up at once: \$10 of your \$25 wallet cap\./);
  assert.match(card, /1\. \*\*Fourth L2 \/ Closing soon\*\* .*ends 2026-11-05, claim by 2026-11-20\) \*\*ends before next week\*\*/);
  assert.match(card, /https:\/\/app\.galxe\.com\/quest\/c\/C3/);
  assert.match(card, /Follow @FundedL2 on X \(on X: your click\)/);
  assert.match(card, /Visit the docs page \(already done\)/);
  assert.match(card, /Do one of:\n   - Swap \$10 \(on-chain: sign only this exact transaction\)\n   - Hold \$10 for a week \(on-chain: sign only this exact transaction\)/);
  assert.match(card, /Other L2 \/ Bridge week \(about 12 min\): the \$25 wallet cap is already in use/);
  assert.match(card, /Refuse any unlimited allowance, blind Permit or setApprovalForAll/);
});

test('an empty week says so plainly', () => {
  assert.match(doCard({ passed: [] }, {}, new Date(NOW)), /Nothing clears the gate this week/);
});

// 30 Oct 2026, the adversarial review: a recorded flag (or any kill-rule stop) left the Do card building as
// usual, because nothing read the ledger. The card now refuses to list quests while the desk is stopped.
test('a kill-rule stop produces no Do card, only the stop notice', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW), { kill: 'STOP_FLAG: Bot activity detected' });
  assert.match(card, /stopped by its own kill rule: STOP_FLAG: Bot activity detected/);
  assert.doesNotMatch(card, /app\.galxe\.com/, 'no quest is listed while the desk is stopped');
  assert.match(card, /critic panel/);
});

// A link in untrusted task text to anywhere but app.galxe.com is removed from the card.
test('task text cannot smuggle a non-Galxe link onto the card', () => {
  assert.equal(safeTaskText('Claim at https://galxe-claim.app/drain now'), 'Claim at [external link removed — open only app.galxe.com] now');
  assert.equal(safeTaskText('Verify on https://app.galxe.com/quest/x'), 'Verify on https://app.galxe.com/quest/x');
  const evil = () => ({ passed: [{ id: 'E', space: 'S', url: 'https://app.galxe.com/quest/a/E', ev: 5, minutes: 3, endsAt: '2026-11-20', capitalUsd: 0, tasks: [{ relation: 'ALL', items: [task('Go to https://airdrop-galxe.one/claim')] }] }] });
  const card = doCard(evil(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW));
  assert.doesNotMatch(card, /airdrop-galxe\.one/);
  assert.match(card, /external link removed/);
});
