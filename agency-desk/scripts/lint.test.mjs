// The copy gate: a good row passes, and every rule is shown to fail on the one change it exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint } from './lint-lines.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const roster = { creators: [
  { name: 'Jay', aliases: ['Jays Channel'], numbers: ['24k', '190k'] },
  { name: 'Gala', numbers: ['100k'] },
] };
const today = '2026-11-05';
const good = () => ({
  key: 'Acme Mowers | Ava Sample', brand: 'Acme Mowers', name: 'Ava Sample', role: 'Influencer Marketing Manager',
  route: 'linkedin-dm', creator: 'Jay',
  connectionNote: 'Hi Ava, saw Acme backed a lawn channel for spring. I manage Jay (24k a video, 190k on his best). Worth a chat for 2027?',
  dm: 'Thanks for connecting, Ava. Jay builds outdoor projects for a US and AU audience. Mind if I email you a one-pager? If this isn\'t your area, just say and I won\'t follow up.',
  emailOpener: 'Saw Acme backed a lawn channel this spring.', subject: 'Spring 2027 + Acme?',
  hook: { type: 'sponsor', text: 'Acme sponsored a lawn video', source: 'https://video.example/watch?v=1', date: '2026-09-20' },
  confidence: 'High',
});

test('a good row passes with no errors', () => {
  const r = lint([good()], roster, { today });
  assert.deepEqual(r.errors, []);
});

const cases = [
  ['note-too-long', (r) => { r.connectionNote = 'x'.repeat(201) + '?'; }],
  ['note-empty', (r) => { r.connectionNote = ''; }],
  ['link-in-note', (r) => { r.connectionNote = 'Hi Ava, have a look at https://site.example? Worth a chat?'; }],
  ['dm-empty', (r) => { r.dm = ''; }],
  ['dm-no-consent-ask', (r) => { r.dm = 'Thanks for connecting. Here is our deck. If this isn\'t your area, just say and I won\'t follow up.'; }],
  ['dm-too-long', (r) => { r.dm = 'Mind if I email you a one-pager? ' + 'y'.repeat(600); }],
  ['banned-phrase', (r) => { r.emailOpener = 'Stoked with the new mower, a total game changer.'; }],
  ['unconfirmed-claim', (r) => { r.emailOpener = 'Perfect for my huge property.'; }],
  ['number-not-in-roster', (r) => { r.connectionNote = 'Hi Ava, Jay averages 300k a video. Worth a chat?'; }],
  ['two-creators', (r) => { r.dm = 'Jay and Gala both fit. Mind if I email you a one-pager? If not your area, just say and I won\'t follow up.'; }],
  ['number-without-creator', (r) => { r.creator = ''; r.connectionNote = 'Hi Ava, our creator does 50k a video. Worth a chat?'; r.dm = 'Mind if I email you a one-pager?'; }],
  ['hook-without-source', (r) => { r.hook.source = ''; }],
  ['hook-without-date', (r) => { r.hook.date = 'recently'; }],
  ['hook-stale', (r) => { r.hook = { type: 'launch', text: 'a launch', source: 'https://news.example/a', date: '2026-03-01' }; }],
  ['hook-source-not-allowed', (r) => { r.hook.source = 'https://www.linkedin.com/in/someone'; }],
  ['dm-no-opt-out', (r) => { r.dm = 'Thanks for connecting. Mind if I email you a one-pager?'; }],
  ['link-in-dm', (r) => { r.dm += ' https://deck.example/x'; }],
  ['note-has-handle-or-price', (r) => { r.connectionNote = 'Hi Ava, rates from $500. Worth a chat?'; }],
  ['no-hook-not-low', (r) => { r.hook = { type: 'none' }; r.confidence = 'High'; }],
  ['route-unknown', (r) => { r.route = 'blast'; }],
  ['published-without-source', (r) => { r.route = 'email-published'; r.publishedAddress = ['partners', 'acme.test'].join('@'); r.publishedSource = ''; }],
  ['webmail-address', (r) => { r.route = 'email-published'; r.publishedAddress = ['acme.team', 'gmail.com'].join('@'); r.publishedSource = 'https://acme.example/contact'; }],
  ['email-without-consent', (r) => { r.route = 'email-consented'; r.consent = ''; }],
  ['subject-too-long', (r) => { r.subject = 'A'.repeat(61); }],
  ['generic-subject', (r) => { r.subject = 'Creators for Acme Mowers'; }],
];

for (const [rule, mutate] of cases) {
  test(`rule ${rule} fails on its case`, () => {
    const row = good();
    mutate(row);
    const r = lint([row], roster, { today });
    assert.ok(r.errors.some((e) => e.rule === rule), `${rule} did not fire; got ${JSON.stringify(r.errors.map((e) => e.rule))}`);
  });
}

test('a sponsorship stays quotable for 18 months, a launch for 6', () => {
  const row = good();
  row.hook.date = '2025-09-01'; // 14 months: fine for a sponsorship
  assert.ok(!lint([row], roster, { today }).errors.some((e) => e.rule === 'hook-stale'));
  row.hook.type = 'launch';
  assert.ok(lint([row], roster, { today }).errors.some((e) => e.rule === 'hook-stale'));
});

test('the consent ask can offer the one-pager in the chat', () => {
  const row = good();
  row.dm = 'Thanks for connecting. Want the one-pager here or by email? If this isn\'t your area, just say and I won\'t follow up.';
  assert.deepEqual(lint([row], roster, { today }).errors, []);
});

test('describing the roster is not a claim about Leif; a house with four words in between still is', () => {
  const row = good();
  row.emailOpener = 'My roster is home and garden YouTubers. Our creators are home, garden and DIY channels. I run my home and garden creators.';
  assert.ok(!lint([row], roster, { today }).errors.some((e) => e.rule === 'unconfirmed-claim'));
  row.emailOpener = 'It suits my 250 year old heritage house.';
  assert.ok(lint([row], roster, { today }).errors.some((e) => e.rule === 'unconfirmed-claim'));
  row.emailOpener = 'Perfect for my home.';
  assert.ok(lint([row], roster, { today }).errors.some((e) => e.rule === 'unconfirmed-claim'));
});

test('a calendar claim needs a sourced season, launch or news hook; an idea hook needs no source', () => {
  const row = good();
  row.hook = { type: 'value', text: 'an idea' };
  row.confidence = 'Medium';
  assert.deepEqual(lint([row], roster, { today }).errors, []);
  row.dm = 'Thanks for connecting. UK garden brands plan spring creators about now. Mind if I email you a one-pager? If this isn\'t your area, just say and I won\'t follow up.';
  assert.ok(lint([row], roster, { today }).errors.some((e) => e.rule === 'unsourced-timing-claim'));
  row.hook = { type: 'season', text: 'spring planning', source: 'https://brand.example/news', date: '2026-10-20' };
  assert.ok(!lint([row], roster, { today }).errors.some((e) => e.rule === 'unsourced-timing-claim'));
  row.hook = { type: 'value', text: 'an idea' }; row.confidence = 'High'; row.dm = good().dm;
  assert.ok(lint([row], roster, { today }).errors.some((e) => e.rule === 'idea-hook-high'));
});

test('a confirmed claim passes', () => {
  const row = good();
  row.emailOpener = 'Perfect for my huge property.';
  row.confirmedClaims = ['my huge property'];
  assert.ok(!lint([row], roster, { today }).errors.some((e) => e.rule === 'unconfirmed-claim'));
});

test('two colleagues at one brand never get the same note', () => {
  const a = good();
  const b = { ...good(), key: 'Acme Mowers | Ben Sample', name: 'Ben Sample' };
  const r = lint([a, b], roster, { today });
  assert.ok(r.errors.some((e) => e.rule === 'same-note-as-colleague' && e.key === b.key));
  b.connectionNote = 'Hi Ben, your spring social calendar could use reusable garden footage. Jay films it weekly. Open to a look?';
  assert.ok(!lint([a, b], roster, { today }).errors.some((e) => e.rule === 'same-note-as-colleague'));
});

test('a creator name inside a brand name is not a second creator', () => {
  const row = good();
  row.brand = 'Spear & Jayson'; // contains "Jay" only as part of a word
  row.connectionNote = 'Hi Ava, saw Spear & Jayson backed a garden channel. Gala (100k a video) fits. Worth a chat?';
  row.creator = 'Gala';
  row.dm = 'Mind if I email you a one-pager? If this isn\'t your area, just say and I won\'t follow up.';
  assert.deepEqual(lint([row], roster, { today }).errors, []);
});

test('skip rows are not linted, and the age check needs a date', () => {
  assert.deepEqual(lint([{ key: 'x', route: 'skip' }], roster, { today }).errors, []);
  assert.throws(() => lint([], roster, {}), /--today/);
});

test('the CLI exits 1 on an error and 0 when clean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-lint-'));
  const rosterPath = join(dir, 'roster.json');
  writeFileSync(rosterPath, JSON.stringify(roster));
  const okPath = join(dir, 'ok.json');
  writeFileSync(okPath, JSON.stringify([good()]));
  execFileSync(process.execPath, [join(here, 'lint-lines.mjs'), '--rows', okPath, '--roster', rosterPath, '--today', today], { stdio: 'pipe' });
  const bad = good(); bad.subject = 'Creators for Acme';
  const badPath = join(dir, 'bad.json');
  writeFileSync(badPath, JSON.stringify([bad]));
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'lint-lines.mjs'), '--rows', badPath, '--roster', rosterPath, '--today', today], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});
