// The email voice check: a friend-text email passes, and every rule fails on the one change it exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintEmail, lintEmails } from './lint-lines.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const body = [
  'Hey Jay,',
  '',
  'Your cedar raised bed build was so tidy, the hinge lid especially. Some home and garden brands are asking us for creators for spring.',
  '',
  'Are you open to paid brand deals next year? :)',
  '',
  "Just say if you'd rather I stop.",
  'Leif, Joyisfree Studio',
].join('\n');
const good = (x = {}) => ({ key: 'Creator | Jay Builds', subject: 'That hinge lid though', body, first: true, us: false, ...x });
const rules = (r) => r.errors.map((e) => e.rule);

test('a short friend-text email with one true detail, one question, an opt-out and "Leif" is Ready to send', () => {
  const r = lintEmail(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.folder, 'Ready to send');
});

test('too long, no question or two questions, no opt-out, no sender: each one fails', () => {
  const long = body.replace('Your cedar', `${'Really '.repeat(40)}your cedar`);
  assert.ok(rules(lintEmail(good({ body: long }))).includes('too-long'));
  assert.ok(rules(lintEmail(good({ body: body.replace('next year? :)', 'next year :)') }))).includes('no-question'));
  assert.ok(rules(lintEmail(good({ body: body.replace('spring.', 'spring. Got a minute?') }))).includes('more-than-one-question'));
  assert.ok(rules(lintEmail(good({ body: body.replace("Just say if you'd rather I stop.", '') }))).includes('no-opt-out'));
  assert.ok(rules(lintEmail(good({ body: body.replace('Leif, Joyisfree Studio', '') }))).includes('no-sender'));
  assert.ok(rules(lintEmail(good({ body: body.replace('Leif, Joyisfree Studio', 'Leif') }))).includes('first-email-no-studio'));
  assert.deepEqual(rules(lintEmail(good({ first: false, subject: 'Re: brand deals', body: body.replace('Leif, Joyisfree Studio', 'Leif') }))), [], 'a reply in a thread may sign "Leif" alone');
});

test('no signature block, link, phone number, banned phrase or subject tag', () => {
  assert.ok(rules(lintEmail(good({ body: body.replace('Leif, Joyisfree Studio', 'Kind regards,\nLeif, Joyisfree Studio') }))).includes('signature'));
  assert.ok(rules(lintEmail(good({ body: body.replace('for spring.', 'for spring (see www.studio.test).') }))).includes('link'));
  assert.ok(rules(lintEmail(good({ body: body.replace('Joyisfree Studio', 'Joyisfree Studio, +61 400 000 000') }))).includes('phone-number'));
  assert.ok(rules(lintEmail(good({ body: body.replace('Your cedar', 'Hope this email finds you well. Your cedar') }))).includes('banned-phrase'));
  assert.ok(rules(lintEmail(good({ subject: '[WAIT] That hinge lid though' }))).includes('subject-tag'));
  const long = 'That hinge lid though, and the cedar, and the whole tidy build you did';
  assert.ok(rules(lintEmail(good({ subject: long }))).includes('subject-too-long'));
  assert.deepEqual(rules(lintEmail(good({ subject: `Re: ${long}`, first: false }))), [], "a reply keeps its thread's subject, however long");
});

test('a number needs a fresh measurement, and a line claiming something of Leif\'s needs his yes', () => {
  assert.ok(rules(lintEmail(good({ body: body.replace('for spring.', 'for spring. Your videos get 24k views.') }))).includes('number-not-fresh'));
  assert.deepEqual(rules(lintEmail(good({ body: body.replace('for spring.', 'for spring. Your videos get 24k views.'), allowNumbers: ['24k'] }))), []);
  assert.ok(rules(lintEmail(good({ body: body.replace('Your cedar', 'My backyard needs one. Your cedar') }))).includes('unconfirmed-claim'));
});

test('a US recipient waits On hold for the postal line; an unknown country waits too; extra holds are kept', () => {
  assert.equal(lintEmail(good({ us: true })).folder, 'On hold');
  assert.match(lintEmail(good({ us: true })).hold.join(' '), /postal/);
  assert.equal(lintEmail(good({ us: true }), { postal: 'PO Box 1, Sample NSW 2000' }).folder, 'On hold', 'the line must be in the email, not just known');
  assert.equal(lintEmail(good({ us: true, body: body.replace('Leif, Joyisfree Studio', 'Leif, Joyisfree Studio\nPO Box 1, Sample NSW 2000') }), { postal: 'PO Box 1, Sample NSW 2000' }).folder, 'Ready to send');
  assert.match(lintEmail(good({ us: undefined })).hold.join(' '), /country/);
  assert.equal(lintEmail(good({ holds: ['needs their yes on LinkedIn'] })).folder, 'On hold');
  assert.equal(lintEmail(good({ subject: '[CHECK] x' })).folder, 'Fix first', 'an error never files as ready');
});

test('a promised date and haggling are warnings for Leif to see', () => {
  const w = (b) => lintEmail(good({ body: b })).warnings.map((x) => x.rule);
  assert.ok(w(body.replace('for spring.', "for spring. I'll send names by Friday.")).includes('date-promise'));
  assert.ok(w(body.replace('for spring.', 'for spring. Could you drop your rate a bit?')).includes('haggle-before-brief'));
  assert.ok(w(body.replace('Your cedar raised bed build was so tidy, the hinge lid especially. ', '')).includes('short'));
});

test('across one run: no copy-paste middle line, and no subject formula twice', () => {
  const a = good();
  const b = good({ key: 'Creator | Pip Grows', subject: 'Those tomato cages', body: body.replace('Hey Jay,', 'Hey Pip,')
    .replace('Your cedar raised bed build was so tidy, the hinge lid especially.', 'Those tomato cages from offcuts were clever, and cheap too.')
    .replace('Some home and garden brands are asking us for creators for spring.', 'A few garden and outdoor brands want creators for next season, which is why I thought of you.') });
  const ok = lintEmails([a, b]);
  assert.deepEqual(ok.errors, [], 'the same question and the same opt-out may repeat: they are the ask and the legal line');
  const d = good({ key: 'Creator | Dee Digs', subject: 'Compost bins', body: b.body.replace('Hey Pip,', 'Hey Dee,').replace('Those tomato cages from offcuts were clever, and cheap too.', 'Your compost bins from pallets were clever, and cheap too.') });
  assert.ok(lintEmails([b, d]).errors.some((e) => e.rule === 'copy-paste-line' && e.key === 'Creator | Dee Digs'), 'a shared middle sentence is the copy-paste line');
  const c = good({ key: 'Creator | Rex Rigs', subject: 'That hinge lid though!', body: body.replace('Hey Jay,', 'Hey Rex,') });
  const r = lintEmails([a, c]);
  assert.ok(r.errors.some((e) => e.rule === 'copy-paste-line' && e.key === 'Creator | Rex Rigs'));
  assert.ok(r.warnings.some((e) => e.rule === 'same-subject-formula'));
});

test('the CLI checks an emails file and exits 1 while any error remains', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-email-'));
  const f = join(dir, 'emails.json');
  const run = () => execFileSync(process.execPath, [join(here, 'lint-lines.mjs'), '--emails', f], { stdio: 'pipe' }).toString();
  writeFileSync(f, JSON.stringify([good()]));
  assert.match(run(), /checked 1 emails · 0 errors/);
  writeFileSync(f, JSON.stringify([good({ subject: '[WAIT] x' })]));
  let code = 0;
  try { run(); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});
