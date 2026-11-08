// The weekly Do card: fills Leif's minutes, ending-soon first, keeps all quests inside one wallet cap, marks his clicks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  assert.match(doCard({ passed: [] }, {}, new Date(NOW)), /Nothing new clears the gate this week/);
});

// 30 Oct 2026, the adversarial review: a recorded flag (or any kill-rule stop) left the Do card building as
// usual, because nothing read the ledger. The card now refuses to list quests while the desk is stopped.
test('a kill-rule stop produces no Do card, only the stop notice', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW), { kill: 'STOP_FLAG: Bot activity detected' });
  assert.match(card, /stopped by its own kill rule: STOP_FLAG: Bot activity detected/);
  assert.doesNotMatch(card, /app\.galxe\.com/, 'no quest is listed while the desk is stopped');
  assert.match(card, /critic panel/);
});

// The claim clock: a prize already won and unclaimed outranks any new quest, and must survive a stopped desk.
test('claims due and OVERDUE are shown first on the card', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW), {
    due: [{ quest: 'W1', deadline: '2026-11-10' }],
    overdue: [{ quest: 'W0', deadline: '2026-10-20' }],
  });
  assert.match(card, /## OVERDUE[\s\S]*W0[\s\S]*## Claim first[\s\S]*W1 \*\*: claim by 2026-11-10|## OVERDUE[\s\S]*W0[\s\S]*## Claim first[\s\S]*W1/);
  // The clock comes before the week's quests.
  assert.ok(card.indexOf('OVERDUE') < card.indexOf('Fourth L2'), 'the clock is above the quest list');
});

test('a stopped desk still shows the claim clock, because a won prize is not new questing', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW), {
    kill: 'STOP_FLAG: Bot activity detected',
    overdue: [{ quest: 'W0', deadline: '2026-10-20' }],
  });
  assert.match(card, /stopped by its own kill rule/);
  assert.match(card, /## OVERDUE[\s\S]*W0/);
  assert.doesNotMatch(card, /app\.galxe\.com/, 'still no new quests while stopped');
});

test('an empty clock adds nothing to the card', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW));
  assert.doesNotMatch(card, /OVERDUE/);
  assert.doesNotMatch(card, /Claim first/);
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

// 8 Nov 2026, audit A5 and A11: the lane refused on 31 Oct must blank the card exactly as a flag does, and say so in
// words that do not send Leif to a critic panel over a subject he has closed.
const REFUSED_STOP = 'STOP_DECISION: refused 2026-10-31 (galxe-desk/docs/decision-2026-10-31-questing.md); reopens only if Leif reopens it in his own words';

test('a standing decision produces no Do card, says the lane is closed and how it reopens, and keeps the claim clock', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW), {
    kill: REFUSED_STOP,
    overdue: [{ quest: 'W0', deadline: '2026-10-20' }],
  });
  assert.doesNotMatch(card, /app\.galxe\.com/, 'no quest is listed while the lane is refused');
  assert.match(card, /closed by a standing decision: STOP_DECISION: refused 2026-10-31/);
  assert.match(card, /none until Leif reopens the lane in his own words/);
  assert.match(card, /Nothing is owed by Leif/);
  assert.doesNotMatch(card, /critic panel|a flag is cleared/, 'a refusal is not a flag waiting on a review');
  assert.match(card, /## OVERDUE[\s\S]*W0/, 'a prize already won is not new questing');
});

test('a flag that outranks the decision still names the decision on the card', () => {
  const card = doCard(shortlist(), { weeklyMinutesCap: 60, walletCapUsd: 100 }, new Date(NOW), {
    kill: 'STOP_FLAG: Bot activity detected',
    decision: REFUSED_STOP,
  });
  assert.match(card, /stopped by its own kill rule: STOP_FLAG: Bot activity detected/);
  assert.match(card, /also closed by a standing decision: STOP_DECISION: refused 2026-10-31/);
  assert.doesNotMatch(card, /app\.galxe\.com/);
  // And the decision line is not repeated when the decision is itself the stop.
  const once = doCard(shortlist(), {}, new Date(NOW), { kill: REFUSED_STOP, decision: REFUSED_STOP });
  assert.doesNotMatch(once, /also closed/);
});

// The CLI, end to end: the card builder reads the committed decision file itself, not only the ledger.
// Every temporary file lives under one folder, removed when the file finishes.
const SCRATCH = mkdtempSync(join(tmpdir(), 'do-card-test-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const scratch = (prefix) => mkdtempSync(join(SCRATCH, prefix));
const DOCARD = fileURLToPath(new URL('./do-card.mjs', import.meta.url));
const ACCOUNT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'account.json');
const oneQuest = { passed: [{ id: 'Q1', name: 'Week 1', space: 'Funded L2', url: 'https://app.galxe.com/quest/a/Q1', ev: 5, minutes: 5, endsAt: '2026-11-20', capitalUsd: 0, tasks: [{ relation: 'ALL', items: [task('Follow @FundedL2 on X', true)] }] }] };
function runCard(extra = [], { withShortlist = true } = {}) {
  const dir = scratch('card-');
  const sl = join(dir, 'shortlist.json');
  if (withShortlist) writeFileSync(sl, JSON.stringify(oneQuest));
  const out = join(dir, 'do-card.md');
  const r = spawnSync(process.execPath, [DOCARD, '--shortlist', sl, '--account', ACCOUNT, '--ledger', join(dir, 'ledger.jsonl'), '--out', out, ...extra], { encoding: 'utf8' });
  let card = '';
  try { card = readFileSync(out, 'utf8'); } catch { /* no card written: the assertions below say so */ }
  return { r, card };
}

test('desk:card on the committed decision lists no quest, even with a shortlist on disk', () => {
  const { r, card } = runCard();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /desk stopped \(STOP_DECISION: refused 2026-10-31/);
  assert.match(card, /closed by a standing decision: STOP_DECISION: refused 2026-10-31/);
  assert.doesNotMatch(card, /app\.galxe\.com/);
});

test('desk:card with a missing decision file fails closed: no quests, and the reason on the card', () => {
  const { r, card } = runCard(['--decision', join(SCRATCH, 'no-such-dir', 'gone.json')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(card, /STOP_DECISION: .*gone\.json could not be read/);
  assert.doesNotMatch(card, /app\.galxe\.com/);
});

test('desk:card on a refused lane needs no shortlist: nothing was scouted, and the stop notice is still written', () => {
  const { r, card } = runCard([], { withShortlist: false });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(card, /closed by a standing decision/);
});

test('desk:card on a well-formed reopening builds the card from the shortlist again', () => {
  const dir = scratch('decision-');
  const d = join(dir, 'decision.json');
  writeFileSync(d, JSON.stringify({ lane: 'galxe-questing', verdict: 'REOPENED', reopenedOn: '2026-11-08', leifsWords: 'reopen the Galxe questing' }));
  const { r, card } = runCard(['--decision', d]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^do card: 1 quests/);
  assert.match(card, /https:\/\/app\.galxe\.com\/quest\/a\/Q1/);
});
