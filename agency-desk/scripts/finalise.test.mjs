// The finishing pass on made-up brands and creators: nothing that names an unconfirmed creator or quotes a stale
// number survives, nothing that must not be messaged looks ready, and Today takes only rows with nothing blocking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib.mjs';
import { finalise, roleCheck, creatorState, pickToday, firstName, MAX_PER_BRAND } from './finalise.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const today = '2026-11-09';
const roster = { creators: [
  { name: 'Jay', numbers: ['24k', '190k'], phrase: 'Jay (about 24k views on a typical video, 190k on the best of the last 12)', numberSource: 'measured', measuredAt: '2026-11-01', yesAt: '2026-11-02', describe: 'an outdoor build channel' },
  { name: 'Rex', numbers: ['12k'], phrase: 'Rex (about 12k views a video)', numberSource: 'measured', measuredAt: '2026-11-01' },
  { name: 'Moss', numbers: ['40k'], phrase: 'Moss (about 40k views a video)', numberSource: 'roster sheet, not re-measured', yesAt: '2026-11-02', describe: 'a gardening channel' },
] };
const person = (brand, n, extra = {}) => ({ key: `${brand} | ${n} Sample`, address: 'same', ...extra });
const worklist = [
  { id: 'acme', label: 'Acme Mowers', tier: 'core', people: [person('Acme Mowers', 'Ava'), person('Acme Mowers', 'Ben')] },
  { id: 'gizmo', label: 'Gizmo', tier: 'home', people: [person('Gizmo', 'Cal', { address: 'other' })] },
  { id: 'warmco', label: 'Warmco', tier: 'warm', people: [person('Warmco', 'Wes')] },
  { id: 'twin', label: 'Twinco', tier: 'core', people: [person('Twinco', 'Tia')] },
  { id: 'quiet', label: 'Quietco', tier: 'other', rule: { route: 'park', why: 'said no for now' }, people: [person('Quietco', 'Qin')] },
  { id: 'big', label: 'Bigco', tier: 'home', people: ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'].map((n) => person('Bigco', n)) },
];
const teamRow = (key, creator, extra = {}) => ({
  key, route: 'linkedin-dm', creator, contactOrder: 1, wave: 1,
  connectionNote: `Hi there, saw your brand backed a lawn channel for spring. I manage ${creator} (24k a video). Worth a chat?`,
  dm: `Thanks for connecting. ${creator} builds outdoor projects. Want the one-pager here or by email? If this isn't your area, just say and I won't follow up.`,
  subject: 'Spring + a lawn channel?', emailOpener: 'Saw the spring campaign.',
  hook: { type: 'sponsor', text: 'sponsored a lawn video', source: 'https://video.example/watch?v=1', date: '2026-09-20' }, confidence: 'Medium', ...extra,
});

test('a first name comes from the person, and a blank one becomes "there"', () => {
  assert.equal(firstName('Ava Sample'), 'Ava');
  assert.equal(firstName('  '), 'there');
});

test('a creator is nameable only after a recent yes, and quotable only when measured recently', () => {
  const [jay, rex, moss] = roster.creators;
  assert.deepEqual(creatorState(jay, today), { named: true, fresh: true });
  assert.deepEqual(creatorState(rex, today), { named: false, fresh: true });
  assert.deepEqual(creatorState(moss, today), { named: true, fresh: false });
  assert.deepEqual(creatorState(null, today), { named: false, fresh: false });
});

test('the role check never names an unconfirmed creator, and names a confirmed one without a stale number', () => {
  const b = { label: 'Acme Mowers' };
  const r = { key: 'Acme Mowers | Ava Sample', name: 'Ava Sample', flags: [] };
  const unconfirmed = roleCheck(r, b, 0, { creator: roster.creators[1], state: creatorState(roster.creators[1], today) });
  assert.equal(unconfirmed.creator, '');
  assert.ok(!/Rex/.test(unconfirmed.dm + unconfirmed.connectionNote));
  const stale = roleCheck(r, b, 0, { creator: roster.creators[2], state: creatorState(roster.creators[2], today) });
  assert.equal(stale.creator, 'Moss');
  assert.ok(!/\d+k/.test(stale.dm), 'no number when the number is not fresh');
  assert.match(stale.dm, /Moss, a gardening channel/);
});

test('team copy naming a confirmed, freshly measured creator survives as written', () => {
  const rows = [teamRow('Acme Mowers | Ava Sample', 'Jay')];
  const out = finalise({ rows, worklist, roster, today });
  const ava = out.rows.find((r) => r.key === 'Acme Mowers | Ava Sample');
  assert.equal(ava.creator, 'Jay');
  assert.match(ava.connectionNote, /lawn channel/);
  assert.ok(!out.lint.errors.some((e) => e.key === ava.key));
});

test('team copy naming a creator with no recent yes becomes a creator-free role check, and lints clean', () => {
  const rows = [teamRow('Acme Mowers | Ava Sample', 'Rex', { connectionNote: 'Hi there, I manage Rex (12k a video). Worth a chat?', dm: 'Rex builds things. Want the one-pager here or by email? If this isn\'t your area, just say and I won\'t follow up.' })];
  const out = finalise({ rows, worklist, roster, today });
  const ava = out.rows.find((r) => r.key === 'Acme Mowers | Ava Sample');
  assert.equal(ava.creator, '');
  assert.ok(!/Rex/.test(`${ava.connectionNote} ${ava.dm} ${ava.subject} ${ava.emailOpener}`));
  assert.ok(ava.flags.some((f) => /creator-not-confirmed/.test(f)));
  assert.deepEqual(out.lint.errors, []);
});

test('wrong company, warm brands, warm threads, holds and missing names become skips with a reason', () => {
  const rows = [teamRow('Twinco | Tia Sample', 'Jay'), teamRow('Warmco | Wes Sample', 'Jay')];
  const out = finalise({ rows, worklist, roster, today, config: { wrongCompany: { twin: 'these people work at a different company with the same name' }, hold: ['quiet'] } });
  const by = new Map(out.rows.map((r) => [r.key, r]));
  assert.equal(by.get('Twinco | Tia Sample').route, 'skip');
  assert.match(by.get('Twinco | Tia Sample').skipReason, /different company/);
  assert.equal(by.get('Warmco | Wes Sample').route, 'skip');
  assert.match(by.get('Quietco | Qin Sample').skipReason, /said no for now/);
  assert.match(by.get('Gizmo | Cal Sample').skipReason, /no usable name/, 'a person with no team row is never a silent gap');
  assert.equal(out.rows.length, worklist.reduce((n, b) => n + b.people.length, 0), 'every person gets exactly one row');
});

test('a held brand or a live thread stays skipped even when the team wrote a row for it', () => {
  const rows = [teamRow('Quietco | Qin Sample', 'Jay'), teamRow('Gizmo | Cal Sample', 'Jay'), teamRow('Acme Mowers | Ava Sample', 'Jay')];
  const out = finalise({ rows, worklist, roster, today, config: { hold: ['gizmo'], warmThread: { acme: 'their partnerships lead' } } });
  const by = new Map(out.rows.map((r) => [r.key, r]));
  assert.equal(by.get('Quietco | Qin Sample').route, 'skip', 'a brand the work list put on hold');
  assert.equal(by.get('Gizmo | Cal Sample').route, 'skip', 'a brand on the private hold list');
  assert.match(by.get('Acme Mowers | Ava Sample').skipReason, /live email thread/);
  assert.deepEqual(pickToday(out.rows, worklist), []);
});

test('an address at another company is flagged, and the sixth person at one brand waits', () => {
  const rows = [teamRow('Gizmo | Cal Sample', 'Jay'), ...worklist[5].people.map((p, i) => teamRow(p.key, 'Jay', { contactOrder: i + 1 }))];
  const out = finalise({ rows, worklist, roster, today });
  assert.ok(out.rows.find((r) => r.key === 'Gizmo | Cal Sample').flags.some((f) => /another company/.test(f)));
  const big = out.rows.filter((r) => r.brand === 'Bigco');
  assert.equal(big.filter((r) => r.route !== 'skip').length, MAX_PER_BRAND);
  assert.ok(big.filter((r) => r.route === 'skip').every((r) => /first 5 people/.test(r.skipReason)));
  assert.deepEqual(out.lint.errors, [], 'five colleagues rewritten at one brand still get five different notes');
});

test('Today takes one person per brand, skips anything blocked and stops at the limit', () => {
  const rows = [
    { key: 'a', brand: 'Acme Mowers', name: 'Ava', route: 'linkedin-dm', connectionNote: 'x', hook: { type: 'sponsor' }, confidence: 'Medium', contactOrder: 1, wave: 1, flags: [] },
    { key: 'b', brand: 'Acme Mowers', name: 'Ben', route: 'linkedin-dm', connectionNote: 'x', hook: { type: 'sponsor' }, confidence: 'Medium', contactOrder: 2, wave: 1, flags: [] },
    { key: 'c', brand: 'Gizmo', name: 'Cal', route: 'linkedin-dm', connectionNote: 'x', hook: { type: 'none' }, confidence: 'Low', contactOrder: 1, wave: 1, flags: ['address at another company: check'] },
    { key: 'd', brand: 'Bigco', name: 'Dee', route: 'linkedin-dm', connectionNote: 'x', hook: { type: 'none' }, confidence: 'Low', contactOrder: 1, wave: 1, flags: [] },
    { key: 'e', brand: 'Twinco', name: 'Eve', route: 'skip', connectionNote: 'x', flags: [] },
  ];
  assert.deepEqual(pickToday(rows, worklist).map((r) => r.key), ['a', 'd']);
  assert.deepEqual(pickToday(rows, worklist, { max: 1 }).map((r) => r.key), ['a']);
});

test('a lane that waits for the right creator stays in the pack but out of Today, and so does a row the team held', () => {
  const rows = [teamRow('Acme Mowers | Ava Sample', 'Jay'), teamRow('Gizmo | Cal Sample', 'Jay', { flags: ['confirm creator first'] }), teamRow('Bigco | A1 Sample', 'Jay', { flags: ['security notices: check them before pitching'] })];
  const out = finalise({ rows, worklist, roster, today, config: { waitFor: { acme: 'mower brands wait for a mower creator' } } });
  const ava = out.rows.find((r) => r.key === 'Acme Mowers | Ava Sample');
  assert.equal(ava.route, 'linkedin-dm', 'still ready in the pack');
  assert.ok(ava.flags.includes('waits: mower brands wait for a mower creator'));
  const picked = pickToday(out.rows, worklist).map((r) => r.key);
  assert.ok(!picked.includes('Acme Mowers | Ava Sample'));
  assert.ok(!picked.includes('Gizmo | Cal Sample'));
  assert.ok(!picked.includes('Bigco | A1 Sample'), 'a check the team asked for before pitching keeps the row out of Today');
});

test('the CLI refuses to write inside the repository and needs a date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-final-'));
  const w = join(dir, 'worklist.json'); writeFileSync(w, JSON.stringify(worklist));
  const ro = join(dir, 'roster.json'); writeFileSync(ro, JSON.stringify(roster));
  const rw = join(dir, 'rows.json'); writeFileSync(rw, JSON.stringify([teamRow('Acme Mowers | Ava Sample', 'Jay')]));
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'finalise.mjs'), '--rows', rw, '--worklist', w, '--roster', ro, '--today', today, '--out', join(REPO_ROOT, 'rows.json')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.ok(!existsSync(join(REPO_ROOT, 'rows.json')));
  execFileSync(process.execPath, [join(here, 'finalise.mjs'), '--rows', rw, '--worklist', w, '--roster', ro, '--today', today, '--out', join(dir, 'out.json'), '--today-csv', join(dir, 'today.csv')], { stdio: 'pipe' });
  assert.ok(existsSync(join(dir, 'today.csv')));
  assert.throws(() => finalise({ rows: [], worklist, roster }), /--today/);
});
