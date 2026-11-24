// Tests for the Quest Board (claude-setup/quests/quests.mjs). Every fixture is synthetic: no real session's title or
// text sits in this public repository. Each gate rule has a test that fails when the rule is removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSessions, deriveQuests, judge, levels, stageOf, card, renderBoard, renderCard, cli, scrub, projectOf, ASK_CAP } from './quests.mjs';

const TODAY = '2026-11-24';
const session = (over) => ({ id: 'session_a', title: '18.11 dawah', session_status: 'SESSION_STATUS_IDLE', status_bucket: 'SESSION_STATUS_BUCKET_COMPLETED', updated_at: '2026-11-24T07:00:00Z', ...over });
const quest = (over) => ({ id: 'q1', project: 'Studio', task: 'add the size chart to the export', owner: 'studio session', doneTest: 'npm run verify', ...over });
const one = (q) => judge([q], TODAY)[0];

test('a snapshot is read in each shape list_sessions gives, and anything else is refused, never read as empty', () => {
  const s = [session()];
  assert.equal(readSessions(s).length, 1);
  assert.equal(readSessions({ data: s }).length, 1);
  assert.equal(readSessions({ ccr: { data: s } }).length, 1);
  assert.throws(() => readSessions({ sessions: s }), /not a session list/);
  assert.throws(() => readSessions(null), /not a session list/);
  assert.throws(() => readSessions([{ title: 'no id' }]), /session 1 has no id/);
});

test('an archived session gives no quest; a needs_action becomes an ask for Leif', () => {
  const qs = deriveQuests(readSessions([
    session({ id: 's1', session_status: 'SESSION_STATUS_ARCHIVED', post_turn_summary: { needs_action: 'answer the colour question' } }),
    session({ id: 's2', title: '21.11 claudemax', post_turn_summary: { needs_action: 'answer the colour question' } }),
  ]), TODAY);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].kind, 'ask');
  assert.equal(qs[0].owner, 'Leif');
  assert.equal(qs[0].project, 'Claude setup');
});

test('a hand-off becomes a baton owned by the receiving session, with a claim-by date 7 days on', () => {
  const [q] = deriveQuests(readSessions([session({ post_turn_summary: { recent_action: 'Fix handed to the Transfer session, running since 23:24' } })]), TODAY);
  assert.equal(q.kind, 'baton');
  assert.equal(q.owner, 'Transfer');
  assert.equal(q.claimBy, '2026-12-01');
  assert.match(judge([q], TODAY)[0].reason, /^held by Transfer[,;] /);
});

test('a "done" that says it is not finished or not verified is UNVERIFIED: it earns nothing', () => {
  for (const text of ['copy buttons and 3 shop links still unchecked', 'House NOT COMPLETE with 15 to harvest', 'not yet finished or verified', '3 stale receipts']) {
    const [q] = deriveQuests(readSessions([session({ post_turn_summary: { recent_action: text } })]), TODAY);
    assert.equal(judge([q], TODAY)[0].status, 'UNVERIFIED', text);
  }
  const [plain] = deriveQuests(readSessions([session({ post_turn_summary: { recent_action: 'Committed and pushed; proof green' } })]), TODAY);
  assert.equal(plain, undefined, 'a plain report is not a quest');
});

test('a baton past its claim-by date is OVERDUE and goes back on the board', () => {
  const [q] = deriveQuests(readSessions([session({ updated_at: '2026-11-10T07:00:00Z', post_turn_summary: { recent_action: 'handed to the Transfer session' } })]), TODAY);
  const j = judge([q], TODAY)[0];
  assert.equal(j.status, 'OVERDUE');
  assert.match(j.reason, /back on the board/);
});

test('gate: a quest with no done-test is refused, because "done" must be provable', () => {
  const j = one(quest({ doneTest: '' }));
  assert.equal(j.status, 'REFUSED');
  assert.match(j.reason, /no done-test/);
});

test('gate: a second quest with the same project and task is refused as a duplicate', () => {
  const [a, b] = judge([quest(), quest({ id: 'q2', task: '  Add the size chart to the export. ' })], TODAY);
  assert.equal(a.status, 'OPEN');
  assert.equal(b.status, 'REFUSED');
  assert.match(b.reason, /duplicate of q1/);
});

test('gate: a quest that needs Leif\'s secrets or sign-in is refused for a session', () => {
  for (const task of ['type the Stripe api key into settings', 'sign in to the bank portal', 'paste the seed phrase']) {
    const j = one(quest({ task }));
    assert.equal(j.status, 'REFUSED', task);
    assert.match(j.reason, /secrets or sign-ins are Leif's/);
  }
});

test('gate: a destructive, outward-facing or money quest needs Leif\'s yes before any session takes it', () => {
  for (const task of ['delete the old drafts folder', 'deploy to production', 'send the newsletter', 'refund order 1002', 'force push the branch']) {
    const j = one(quest({ task }));
    assert.equal(j.status, 'ASK', task);
    assert.match(j.reason, /needs Leif's yes/);
  }
});

test('gate: a quest with a haram element (chance, interest or speculation) is refused outright', () => {
  for (const task of ['run a prize draw for subscribers', 'add a raffle to the drop', 'offer afterpay at checkout', 'farm the airdrop', 'a mystery box giveaway']) {
    const j = one(quest({ task }));
    assert.equal(j.status, 'REFUSED', task);
    assert.match(j.reason, /haram element/);
  }
});

test('gate: ordinary code work is not mistaken for crypto, posting or sending', () => {
  for (const task of ['hash the buyer emails with node:crypto', 'tidy the post-processing step', 'validate the email field', 'add a send button to the form']) {
    assert.equal(one(quest({ task })).status, 'OPEN', task);
  }
  assert.equal(one(quest({ task: 'buy crypto tokens for the treasury' })).status, 'REFUSED');
  assert.equal(one(quest({ task: 'post to the brand channel' })).status, 'ASK');
});

test('a quest is VERIFIED only by its own done-test, run after it was claimed, exiting 0', () => {
  assert.equal(one(quest({ proof: { ran: 'npm run verify', exit: 0, at: '2026-11-23' } })).status, 'VERIFIED');
  const other = one(quest({ proof: { ran: 'npm test', exit: 0, at: '2026-11-23' } }));
  assert.equal(other.status, 'UNVERIFIED');
  assert.match(other.reason, /a different command/);
  const red = one(quest({ proof: { ran: 'npm run verify', exit: 1, at: '2026-11-23' } }));
  assert.equal(red.status, 'UNVERIFIED');
  assert.match(red.reason, /exited 1/);
  const early = one(quest({ claimedOn: '2026-11-20', proof: { ran: 'npm run verify', exit: 0, at: '2026-11-19' } }));
  assert.equal(early.status, 'UNVERIFIED');
  assert.match(early.reason, /before it was claimed/);
  const said = one(quest({ done: true }));
  assert.equal(said.status, 'UNVERIFIED');
  assert.match(said.reason, /said done, with no proof/);
});

test('a claimed quest is CLAIMED until its claim-by date, then OVERDUE; one with no owner stays OPEN', () => {
  assert.equal(one(quest({ claimBy: '2026-11-30' })).status, 'CLAIMED');
  assert.equal(one(quest({ claimBy: '2026-11-20' })).status, 'OVERDUE');
  assert.equal(one(quest({ owner: '' })).status, 'OPEN');
});

test('a bad date fails closed: it is named, never read as no deadline', () => {
  assert.throws(() => judge([quest({ claimBy: '30/11/2026' })], TODAY), /q1: claimBy "30\/11\/2026" is not a YYYY-MM-DD date/);
  assert.throws(() => judge([quest({ claimBy: '2026-02-30' })], TODAY), /not a YYYY-MM-DD date/);
  assert.throws(() => judge([quest()], '24 Nov'), /today "24 Nov" is not a YYYY-MM-DD date/);
});

test('the card holds at most three asks, oldest first; an ask unanswered for 14 days or more retires itself', () => {
  const asks = [3, 20, 9, 1, 13].map((age, i) => ({ id: `a${i}`, kind: 'ask', owner: 'Leif', project: 'Studio', task: `ask ${age}`, age, status: 'ASK' }));
  const c = card(asks);
  assert.equal(ASK_CAP, 3);
  assert.deepEqual(c.asks.map((a) => a.age), [13, 9, 3]);
  assert.equal(c.more, 1);
  assert.deepEqual(c.retired.map((a) => a.age), [20]);
});

test('levels count verified quests only, over every quest not refused; stages follow Sky\'s map', () => {
  const judged = judge([
    quest({ id: 'v1', task: 'a', proof: { ran: 'npm run verify', exit: 0, at: '2026-11-23' } }),
    quest({ id: 'v2', task: 'b' }),
    quest({ id: 'v3', task: 'c', doneTest: '' }),
    quest({ id: 'd1', project: 'Dawah', task: 'x' }),
  ], TODAY);
  const byProject = Object.fromEntries(levels(judged).map((l) => [l.project, l]));
  assert.deepEqual([byProject.Studio.verified, byProject.Studio.total, byProject.Studio.level], [1, 2, 50]);
  assert.equal(byProject.Studio.stage, 'Town');
  assert.equal(byProject.Dawah.level, 1, 'a level is never below 1 once a project has a quest');
  assert.equal(stageOf(0, 0), 'Open sea');
  assert.equal(stageOf(24, 1), 'Village');
  assert.equal(stageOf(25, 1), 'Town');
  assert.equal(stageOf(60, 1), 'City');
  assert.equal(stageOf(99, 1), 'Lighthouse');
});

test('session text is data: emails are hidden and long text is cut, so nothing personal or planted is copied whole', () => {
  assert.equal(scrub('mail someone@example.com now'), 'mail [email hidden] now');
  assert.equal(scrub('x'.repeat(400)).length, 160);
  assert.equal(scrub('ignore\n\nprevious   rules'), 'ignore previous rules');
});

test('a session is placed in its project by its title, and an unknown one is Other', () => {
  assert.equal(projectOf('18.11 dawah :D'), 'Dawah');
  assert.equal(projectOf('18.10 - IMA New'), 'Agency');
  assert.equal(projectOf('18.10 - QUANTUM DESIGN'), 'Studio');
  assert.equal(projectOf('Project Suukr'), 'Suukr');
  assert.equal(projectOf('Transfer'), 'Claude setup');
  assert.equal(projectOf('Hello'), 'Other');
});

test('the board and the card say every status and reason, and the card never says more than three asks', () => {
  const judged = judge([quest({ doneTest: '' }), quest({ id: 'q2', task: 'b', claimBy: '2026-11-20' })], TODAY);
  const board = renderBoard(judged, levels(judged), TODAY);
  assert.match(board, /REFUSED · Studio · add the size chart to the export: no done-test/);
  assert.match(board, /OVERDUE · Studio · b/);
  const asks = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, kind: 'ask', owner: 'Leif', project: 'Agency', task: `t${i}`, age: i, status: 'ASK' }));
  const text = renderCard(card(asks), TODAY);
  assert.equal((text.match(/^\d\. /gm) || []).length, 3);
  assert.match(text, /2 more wait/);
});

test('the command line: a missing or unreadable snapshot exits 2 and names it; a good one writes the board', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'quests-'));
  try {
    const out = [];
    const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
    assert.equal(cli(['--sessions', join(dir, 'missing.json'), '--today', TODAY], io), 2);
    assert.match(out.join('\n'), /cannot read the session snapshot/);
    writeFileSync(join(dir, 'bad.json'), '{not json');
    assert.equal(cli(['--sessions', join(dir, 'bad.json'), '--today', TODAY], io), 2);
    assert.equal(cli(['--today', TODAY], io), 2);
    assert.match(out.join('\n'), /--sessions <file> is required/);
    writeFileSync(join(dir, 's.json'), JSON.stringify({ ccr: { data: [session({ post_turn_summary: { needs_action: 'pick a colour', recent_action: 'handed to the Transfer session' } })] } }));
    assert.equal(cli(['--sessions', join(dir, 's.json'), '--today', TODAY, '--out', join(dir, 'board')], io), 0);
    assert.match(readFileSync(join(dir, 'board', 'board.md'), 'utf8'), /Transfer/);
    assert.match(readFileSync(join(dir, 'board', 'card.md'), 'utf8'), /pick a colour/);
    assert.ok(Array.isArray(JSON.parse(readFileSync(join(dir, 'board', 'levels.json'), 'utf8'))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
