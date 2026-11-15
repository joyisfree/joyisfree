// The finishing pass on made-up brands and creators: no first message names a creator or quotes a number, a row that
// fails becomes an honest role check, a Canadian or unknown-country row waits, nothing that must not be messaged
// looks ready, and Today takes only rows with nothing blocking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib.mjs';
import { lint } from './lint-lines.mjs';
import { finalise, roleCheck, pickToday, firstName, MAX_PER_BRAND } from './finalise.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const today = '2026-11-09';
const roster = { creators: [
  { name: 'Jay', numbers: ['24k', '190k'], phrase: 'Jay (about 24k views on a typical video, 190k on the best of the last 12)', numberSource: 'measured', measuredAt: '2026-11-01', yesAt: '2026-11-02', describe: 'an outdoor build channel' },
  { name: 'Rex', numbers: ['12k'], phrase: 'Rex (about 12k views a video)', numberSource: 'measured', measuredAt: '2026-11-01' },
  { name: 'Moss', numbers: ['40k'], phrase: 'Moss (about 40k views a video)', numberSource: 'roster sheet, not re-measured', yesAt: '2026-11-02', describe: 'a gardening channel' },
] };
const person = (brand, n, extra = {}) => ({ key: `${brand} | ${n} Sample`, address: 'same', ...extra });
// Every brand's country is on file except Mistco's, so only the rows a test means to hold are held.
const worklist = [
  { id: 'acme', label: 'Acme Mowers', tier: 'core', country: 'Australia', people: [person('Acme Mowers', 'Ava'), person('Acme Mowers', 'Ben')] },
  { id: 'gizmo', label: 'Gizmo', tier: 'home', country: 'Australia', people: [person('Gizmo', 'Cal', { address: 'other' })] },
  { id: 'warmco', label: 'Warmco', tier: 'warm', country: 'Australia', people: [person('Warmco', 'Wes')] },
  { id: 'twin', label: 'Twinco', tier: 'core', country: 'Australia', people: [person('Twinco', 'Tia')] },
  { id: 'quiet', label: 'Quietco', tier: 'other', country: 'Australia', rule: { route: 'park', why: 'said no for now' }, people: [person('Quietco', 'Qin')] },
  { id: 'big', label: 'Bigco', tier: 'home', country: 'Australia', people: ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7'].map((n) => person('Bigco', n)) },
  { id: 'maple', label: 'Mapleco', tier: 'home', country: 'Canada', people: [person('Mapleco', 'Mia')] },
  { id: 'mist', label: 'Mistco', tier: 'home', people: [person('Mistco', 'Uma')] },
];
const OUT = "If this isn't your area, just say and I won't follow up. Leif, Joyisfree Studio";
// What the team writes for one person: one true detail about the brand, one question that is also the consent ask,
// the way out and the sender. "creator" is the matchmaker's pick, which never reaches the message.
const teamRow = (key, creator, extra = {}) => ({
  key, route: 'linkedin-dm', creator, contactOrder: 1, wave: 1,
  connectionNote: 'Hi there, saw your brand backed a lawn channel for spring. Are creator partnerships yours? No worries if not.',
  dm: `Thanks for connecting. Saw your brand backed a lawn channel for spring. If creator partnerships are yours, want a one-pager here or by email? ${OUT}`,
  subject: 'Spring + a lawn channel?', emailOpener: 'Saw the spring campaign.',
  hook: { type: 'sponsor', text: 'sponsored a lawn video', source: 'https://video.example/watch?v=1', date: '2026-09-20' }, confidence: 'Medium', ...extra,
});
// What the team used to write: the creator by name, with a number.
const naming = (key, creator, extra = {}) => teamRow(key, creator, {
  connectionNote: `Hi there, saw your brand backed a lawn channel for spring. I manage ${creator} (24k a video). Worth a chat?`,
  dm: `Thanks for connecting. ${creator} builds outdoor projects. Want the one-pager here or by email? If this isn't your area, just say and I won't follow up.`,
  ...extra,
});
const find = (out, key) => out.rows.find((r) => r.key === key);
const sent = (r) => `${r.connectionNote} ${r.dm} ${r.subject} ${r.emailOpener}`;
// The five role checks five colleagues would get, as rows ready for an invite with a note.
const five = (label, { rule = '', from = 0, name = (i) => `${['Ava', 'Ben', 'Cal', 'Dee', 'Eli'][i]} Sample` } = {}) => [0, 1, 2, 3, 4].map((i) => roleCheck(
  { key: `${label} | ${name(i)}`, brand: label, name: name(i), route: 'linkedin-dm', country: 'Australia', nextStep: 'Invite + note', flags: [] },
  { label }, from + i, { rule },
));

test('a first name comes from the person, and a blank one becomes "there"', () => {
  assert.equal(firstName('Ava Sample'), 'Ava');
  assert.equal(firstName('  '), 'there');
});

test('every role-check DM has exactly one ?, which is the consent ask, and ends with the opt-out and the sender', () => {
  for (const rule of ['', 'us-only']) {
    for (const rc of five('Acme Mowers', { rule })) {
      assert.equal((rc.dm.match(/\?/g) || []).length, 1, rc.dm);
      assert.match(rc.dm.split(/(?<=[.?])\s+/).find((s) => s.endsWith('?')), /one-pager/, rc.dm);
      assert.ok(rc.dm.endsWith(OUT), rc.dm);
    }
  }
});

test('the role check names no creator and quotes no number, whatever the matchmaker picked', () => {
  const row = { key: 'Acme Mowers | Ava Sample', name: 'Ava Sample', route: 'linkedin-dm', fit: 'Jay', flags: [] };
  for (let i = 0; i < 5; i++) {
    // Handed a creator who said yes and was measured last week, the way the old fallback was: still not named.
    const rc = roleCheck(row, { label: 'Acme Mowers' }, i, { creator: roster.creators[0], state: { named: true, fresh: true } });
    assert.ok(!/Jay|Rex|Moss|\d/.test(sent(rc)), sent(rc));
    assert.ok(!('creator' in rc) && !('creatorNumber' in rc));
    assert.equal(rc.fit, 'Jay', 'the pick stays, privately');
    assert.equal(rc.subject, 'For Acme Mowers: our creator one-pager');
  }
});

test('the role check keeps the US-only line, the opener number and the flags that still matter', () => {
  const row = { key: 'Acme Mowers | Ava Sample', name: 'Ava Sample', route: 'linkedin-dm', flags: ['guardian: check the title', 'honest role check (an earlier pass)', 'rewritten: note-empty', 'address at another company: check'] };
  const rc = roleCheck(row, { label: 'Acme Mowers' }, 7, { rule: 'us-only', noHonestFit: 'makes pool pumps; nobody on the roster covers pools' });
  assert.match(rc.dm, /I'm adding US creators for spring and will only come back with one who fits\./);
  assert.deepEqual(rc.hook, { type: 'none', text: 'role check, opener 3' });
  assert.equal(rc.confidence, 'Low');
  assert.deepEqual(rc.flags, ['address at another company: check', 'no honest fit: makes pool pumps; nobody on the roster covers pools', 'honest role check (no dated hook to stand on yet)']);
  assert.ok(!/US creators/.test(roleCheck(row, { label: 'Acme Mowers' }, 7).dm));
});

test('the five role checks pass every rule for any brand and first name, with the note inside 200 characters', () => {
  const long = 'The Sample Outdoor Living, Garden Furniture and Barbecue Company of Greater Western Sydney';
  const names = [undefined, () => '  ', () => 'Maximiliana-Alexandrina Wolfeschlegelstein Sample', () => "D'Arcy O'Neil-Smythe"];
  for (const label of ['Acme Mowers', 'Spear & Jayson', "Gran's Garden Co.", long, `${long}, ${long} and ${long}`]) {
    for (const rule of ['', 'us-only']) {
      for (const name of names) {
        const rows = five(label, { rule, ...(name ? { name } : {}) });
        for (const rc of rows) {
          assert.deepEqual(lint([rc], roster, { today }).errors, [], `${label} / ${rc.name}: ${rc.connectionNote} ${rc.dm}`);
          assert.ok(rc.connectionNote.length > 0 && rc.connectionNote.length <= 200, `${rc.connectionNote.length}: ${rc.connectionNote}`);
        }
      }
    }
  }
  assert.match(five('Acme Mowers')[0].connectionNote, /Acme Mowers/, 'a brand that fits is named');
  assert.ok(!five(long)[0].connectionNote.includes(long) && five(long)[0].dm.includes(long), 'a brand too long for the note is left out of the note only');
});

test('five colleagues at one brand get five different notes and DMs, and pass the colleague checks', () => {
  for (const label of ['Bigco', 'The Sample Outdoor Living, Garden Furniture and Barbecue Company of Greater Western Sydney']) {
    for (const rule of ['', 'us-only']) {
      for (const from of [0, 3]) {
        const rows = five(label, { rule, from });
        assert.deepEqual(lint(rows, roster, { today }).errors, [], `${label} ${rule} from opener ${from + 1}`);
        assert.equal(new Set(rows.map((r) => r.dm)).size, 5);
        assert.equal(new Set(rows.map((r) => r.connectionNote)).size, 5);
        assert.equal(new Set(rows.map((r) => r.hook.text)).size, 5);
      }
    }
  }
  // Through the finishing pass: all five fail as the team wrote them, and all five are rewritten.
  const rows = worklist[5].people.slice(0, 5).map((p, i) => naming(p.key, 'Jay', { contactOrder: i + 1, nextStep: 'Invite + note' }));
  const out = finalise({ rows, worklist, roster, today });
  const big = out.rows.filter((r) => r.brand === 'Bigco' && r.route !== 'skip');
  assert.equal(out.stats.rewritten, 5);
  assert.deepEqual(out.lint.errors, []);
  assert.equal(new Set(big.map((r) => r.dm)).size, 5);
  assert.equal(new Set(big.map((r) => r.connectionNote)).size, 5);
});

test('a note or DM naming a creator becomes a role check, even a creator who said yes', () => {
  const key = 'Acme Mowers | Ava Sample';
  const cases = [
    teamRow(key, 'Jay', { connectionNote: 'Hi there, Jay films lawn builds your team would like. Are creator partnerships yours? No worries if not.' }),
    teamRow(key, 'Jay', { dm: teamRow(key).dm.replace('for spring.', 'for spring. Jay builds outdoor projects.') }),
    naming(key, 'Rex'),
  ];
  for (const row of cases) {
    const out = finalise({ rows: [row], worklist, roster, today });
    const ava = find(out, key);
    assert.ok(ava.flags.some((f) => /^rewritten: .*creator-in-message/.test(f)), ava.flags.join('; '));
    assert.ok(ava.flags.includes('honest role check (no dated hook to stand on yet)'));
    assert.ok(!/Jay|Rex|\d/.test(sent(ava)), sent(ava));
    assert.ok(!('creator' in ava) && !('creatorNumber' in ava), 'no creator field in the output');
    assert.equal(ava.fit, row.creator, 'the pick is kept for the brand tab, out of the message');
    assert.deepEqual(out.lint.errors, []);
  }
});

test('a row with a passing brand detail is kept as the team wrote it', () => {
  const row = teamRow('Acme Mowers | Ava Sample', 'Jay', { creatorNumber: '24k a video' });
  const out = finalise({ rows: [row], worklist, roster, today });
  const ava = find(out, row.key);
  assert.equal(ava.connectionNote, row.connectionNote);
  assert.equal(ava.dm, row.dm);
  assert.deepEqual(ava.hook, row.hook);
  assert.deepEqual(ava.flags, []);
  assert.equal(out.stats.rewritten, 0);
  assert.ok(!('creator' in ava) && !('creatorNumber' in ava), 'no creator field in the output');
  assert.equal(ava.fit, 'Jay');
  assert.ok(!('nextStep' in ava) && !('hold' in ava), 'not held: the next step is left for a later step to assign');
  assert.deepEqual(out.lint.errors, []);
  assert.deepEqual(out.lint.holds, []);
  assert.deepEqual(pickToday(out.rows, worklist).map((r) => r.key), [row.key]);
});

test('a generic subject is replaced without naming the creator, and the rest of the row is kept', () => {
  const row = teamRow('Acme Mowers | Ava Sample', 'Jay', { subject: 'Creators for Acme Mowers' });
  const out = finalise({ rows: [row], worklist, roster, today });
  const ava = find(out, row.key);
  assert.equal(ava.subject, 'For Acme Mowers: one creator idea');
  assert.equal(ava.dm, row.dm);
  assert.deepEqual([out.stats.subjects, out.stats.rewritten], [1, 0]);
  assert.deepEqual(out.lint.errors, []);
});

test("a row takes its country from the person, else the brand in the private config, else the work list, else blank", () => {
  const rows = [teamRow('Acme Mowers | Ava Sample'), teamRow('Gizmo | Cal Sample'), teamRow('Bigco | A1 Sample'), teamRow('Mapleco | Mia Sample'), teamRow('Mistco | Uma Sample', 'Jay', { country: 'Australia' })];
  const config = { personCountry: { 'Acme Mowers | Ava Sample': 'Canada' }, country: { acme: 'New Zealand', gizmo: 'United States' } };
  const out = finalise({ rows, worklist, roster, today, config });
  assert.equal(find(out, 'Acme Mowers | Ava Sample').country, 'Canada', 'the person, when Leif has said where they are');
  assert.equal(find(out, 'Gizmo | Cal Sample').country, 'United States', 'then the brand in the private config');
  assert.equal(find(out, 'Bigco | A1 Sample').country, 'Australia', 'then the work list');
  assert.equal(find(out, 'Mapleco | Mia Sample').country, 'Canada');
  assert.equal(find(out, 'Mistco | Uma Sample').country, '', 'a country the team wrote into its own row is not evidence');
  assert.deepEqual(out.lint.holds.map((h) => h.key).sort(), ['Acme Mowers | Ava Sample', 'Mapleco | Mia Sample', 'Mistco | Uma Sample']);
});

test('a held Canadian row is not rewritten: a bare invite with no note, or "Wait" when already connected', () => {
  const row = teamRow('Mapleco | Mia Sample', 'Jay');
  const out = finalise({ rows: [row], worklist, roster, today });
  const mia = find(out, row.key);
  assert.equal(mia.dm, row.dm, 'the DM waits as the team wrote it');
  assert.deepEqual(mia.hook, row.hook);
  assert.deepEqual(mia.flags, []);
  assert.equal(out.stats.rewritten, 0);
  assert.equal(mia.nextStep, 'Invite');
  assert.equal(mia.connectionNote, '', 'a bare invite carries no message');
  assert.match(mia.hold, /CASL/);
  assert.deepEqual(out.lint.errors, [], 'a hold is not an error');
  assert.deepEqual(out.lint.holds.map((h) => h.key), [row.key]);
  assert.deepEqual(pickToday(out.rows, worklist), [], 'nothing to paste today');
  const connected = find(finalise({ rows: [row], worklist, roster, today, connected: new Set([row.key]) }), row.key);
  assert.deepEqual([connected.nextStep, connected.connectionNote, connected.dm], ['Wait', '', row.dm]);
  const already = find(finalise({ rows: [{ ...row, nextStep: 'DM now' }], worklist, roster, today }), row.key);
  assert.equal(already.nextStep, 'Wait', '"DM now" means connected: the message still waits');
  // A country nobody knows waits the same way.
  const uma = find(finalise({ rows: [teamRow('Mistco | Uma Sample', 'Jay', { nextStep: 'Invite + note' })], worklist, roster, today }), 'Mistco | Uma Sample');
  assert.deepEqual([uma.nextStep, uma.connectionNote], ['Invite', '']);
  assert.match(uma.hold, /country/);
});

test('a held row whose copy fails still becomes a role check, and still waits', () => {
  const out = finalise({ rows: [naming('Mapleco | Mia Sample', 'Jay')], worklist, roster, today });
  const mia = find(out, 'Mapleco | Mia Sample');
  assert.ok(mia.flags.includes('honest role check (no dated hook to stand on yet)'));
  assert.deepEqual([mia.nextStep, mia.connectionNote], ['Invite', '']);
  assert.match(mia.hold, /CASL/);
  assert.deepEqual(out.lint.errors, []);
});

test('the postal line releases a Canadian row that carries it', () => {
  const postal = 'PO Box 1, Sample NSW 2000';
  const key = 'Mapleco | Mia Sample';
  const row = teamRow(key, 'Jay');
  const both = { ...row, dm: `${row.dm} ${postal}`, connectionNote: `${row.connectionNote} ${postal}` };
  const out = finalise({ rows: [both], worklist, roster, today, postal });
  assert.deepEqual(out.lint.holds, []);
  assert.deepEqual(out.lint.errors, []);
  assert.equal(find(out, key).connectionNote, both.connectionNote);
  assert.ok(!('hold' in find(out, key)) && !('nextStep' in find(out, key)));
  assert.match(find(finalise({ rows: [both], worklist, roster, today }), key).hold, /CASL/, 'a line nobody passed in releases nothing');
  // The line in the DM only: the note cannot go, so the invite is bare, and the DM is free to follow it.
  const dmOnly = find(finalise({ rows: [{ ...row, dm: both.dm }], worklist, roster, today, postal }), key);
  assert.deepEqual([dmOnly.nextStep, dmOnly.connectionNote, dmOnly.dm], ['Invite', '', both.dm]);
  assert.ok(!('hold' in dmOnly));
});

test('a note stays only on an "Invite + note" row, and on a row with no next step yet', () => {
  const rows = [
    teamRow('Acme Mowers | Ava Sample', 'Jay', { nextStep: 'Invite' }),
    teamRow('Gizmo | Cal Sample', 'Jay', { nextStep: 'DM now' }),
    teamRow('Twinco | Tia Sample', 'Jay', { nextStep: 'Invite + note' }),
    teamRow('Bigco | A1 Sample', 'Jay'),
    naming('Bigco | B2 Sample', 'Jay', { nextStep: 'Invite', contactOrder: 2 }),
    naming('Bigco | C3 Sample', 'Jay', { nextStep: 'Invite + note', contactOrder: 3 }),
  ];
  const out = finalise({ rows, worklist, roster, today });
  const note = (key) => find(out, key).connectionNote;
  assert.equal(note('Acme Mowers | Ava Sample'), '', 'a bare invite');
  assert.equal(note('Gizmo | Cal Sample'), '', 'already connected');
  assert.equal(note('Twinco | Tia Sample'), rows[2].connectionNote);
  assert.equal(note('Bigco | A1 Sample'), rows[3].connectionNote);
  assert.ok(!('nextStep' in find(out, 'Bigco | A1 Sample')));
  assert.equal(note('Bigco | B2 Sample'), '', 'a role check for a bare invite has no note either');
  assert.match(note('Bigco | C3 Sample'), /No worries|not your area|leave it/i, 'a role check for an invite with a note has its own');
  assert.deepEqual(rows.map((r) => find(out, r.key).nextStep), ['Invite', 'DM now', 'Invite + note', undefined, 'Invite', 'Invite + note']);
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

test("the CLI's summary counts held rows, names no creator, and --postal reaches the lint", () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-final-'));
  const w = join(dir, 'worklist.json'); writeFileSync(w, JSON.stringify(worklist));
  const ro = join(dir, 'roster.json'); writeFileSync(ro, JSON.stringify(roster));
  const postal = 'PO Box 1, Sample NSW 2000';
  const row = teamRow('Mapleco | Mia Sample', 'Jay');
  const rw = join(dir, 'rows.json'); writeFileSync(rw, JSON.stringify([{ ...row, dm: `${row.dm} ${postal}` }]));
  const out = join(dir, 'out.json');
  const run = (...more) => execFileSync(process.execPath, [join(here, 'finalise.mjs'), '--rows', rw, '--worklist', w, '--roster', ro, '--today', today, '--out', out, ...more], { stdio: 'pipe' }).toString();
  const people = worklist.reduce((n, b) => n + b.people.length, 0);
  assert.match(run(), new RegExp(`^rows ${people} · live 1 · skip ${people - 1} · rewritten 0 · subjects fixed 0 · held 1\\n`));
  assert.match(run(), /\nchecked \d+ rows · 0 errors · 0 warnings · 1 held/);
  assert.ok(!/naming a creator/.test(run()));
  assert.match(run('--postal', postal), / · held 0\n/);
  assert.ok(!readFileSync(out, 'utf8').includes('"creator"'));
});
