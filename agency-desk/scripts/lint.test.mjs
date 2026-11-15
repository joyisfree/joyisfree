// The copy gate: a good row passes, and every rule is shown to fail on the one change it exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lint, creatorStatus, countryLaw } from './lint-lines.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
// Made-up creators. Jay and Pip said yes recently and were measured recently; Rex never said yes again; Moss said
// yes but was measured too long ago; Lark's only figure is the sheet's own.
const fresh = { numberSource: 'measured', measuredAt: '2026-10-20', yesAt: '2026-10-20' };
const roster = { creators: [
  { name: 'Jay', aliases: ['Jays Channel'], numbers: ['24k', '190k'], ...fresh },
  { name: 'Pip', numbers: ['80k'], ...fresh },
  { name: 'Rex', numbers: ['12k'], numberSource: 'measured', measuredAt: '2026-10-20' },
  { name: 'Moss', numbers: ['40k'], numberSource: 'measured', measuredAt: '2026-08-01', yesAt: '2026-10-20' },
  { name: 'Lark', numbers: ['90k'], numberSource: 'roster sheet, not re-measured', yesAt: '2026-10-20' },
] };
const today = '2026-11-05';
const OUT = "If this isn't your area, just say and I won't follow up. Leif, Joyisfree Studio";
// A first message: one true detail about the brand, one question that is also the consent ask, the way out and the
// sender. No creator and no number. "fit" is the matchmaker's private pick, which the lint never reads.
const good = () => ({
  key: 'Acme Mowers | Ava Sample', brand: 'Acme Mowers', name: 'Ava Sample', role: 'Influencer Marketing Manager',
  route: 'linkedin-dm', country: 'Australia', fit: 'Jay',
  connectionNote: 'Hi Ava, saw Acme backed a lawn channel for spring. Worth a chat about creators for 2027? No worries if not.',
  dm: `Thanks for connecting, Ava. Saw Acme backed a lawn channel for spring. If creator partnerships are yours, want a one-pager here or by email? ${OUT}`,
  emailOpener: 'Saw Acme backed a lawn channel this spring.', subject: 'Spring 2027 + Acme?',
  hook: { type: 'sponsor', text: 'Acme sponsored a lawn video', source: 'https://video.example/watch?v=1', date: '2026-09-20' },
  confidence: 'High',
});
// A colleague of Ava's with a detail, a note and a DM of his own.
const colleague = (patch = {}) => ({
  ...good(), key: 'Acme Mowers | Ben Sample', name: 'Ben Sample',
  connectionNote: 'Hi Ben, your spring catalogue leads with the new battery range. Is creator work part of your patch? No worries if not.',
  dm: `Good to connect, Ben. Your spring catalogue leads with the new battery range. Mind if I send you a one-pager on creators who suit it? ${OUT}`,
  hook: { type: 'launch', text: 'the spring catalogue leads with a battery range', source: 'https://acme.example/catalogue', date: '2026-10-10' },
  ...patch,
});
const rules = (rows, opts) => lint(rows, roster, { today, ...opts }).errors.map((e) => e.rule);

test('a good row passes with no errors', () => {
  const r = lint([good()], roster, { today });
  assert.deepEqual(r.errors, []);
});

const cases = [
  ['note-too-long', (r) => { r.connectionNote = 'x'.repeat(201) + '?'; }],
  ['note-empty', (r) => { r.connectionNote = ''; }],
  ['link-in-note', (r) => { r.connectionNote = 'Hi Ava, have a look at https://site.example? Worth a chat?'; }],
  ['note-no-opt-out', (r) => { r.connectionNote = r.connectionNote.replace(' No worries if not.', ''); }],
  ['dm-empty', (r) => { r.dm = ''; }],
  ['dm-no-consent-ask', (r) => { r.dm = 'Thanks for connecting. Here is our deck. If this isn\'t your area, just say and I won\'t follow up.'; }],
  ['dm-too-long', (r) => { r.dm = 'Mind if I email you a one-pager? ' + 'y'.repeat(600); }],
  ['dm-questions', (r) => { r.dm = r.dm.replace('for spring.', 'for spring. Do you look after creator partnerships?'); }],
  ['dm-no-sender', (r) => { r.dm = r.dm.replace(' Leif, Joyisfree Studio', ''); }],
  ['banned-phrase', (r) => { r.emailOpener = 'Stoked with the new mower, a total game changer.'; }],
  ['unconfirmed-claim', (r) => { r.emailOpener = 'Perfect for my huge property.'; }],
  ['number-in-message', (r) => { r.connectionNote = 'Hi Ava, one channel I work with gets 24k a video. Worth a chat? No worries if not.'; }],
  ['creator-in-message', (r) => { r.dm = r.dm.replace('for spring.', 'for spring. Jay builds outdoor projects.'); }],
  ['hook-without-source', (r) => { r.hook.source = ''; }],
  ['hook-without-date', (r) => { r.hook.date = 'recently'; }],
  ['hook-stale', (r) => { r.hook = { type: 'launch', text: 'a launch', source: 'https://news.example/a', date: '2026-03-01' }; }],
  ['hook-source-not-allowed', (r) => { r.hook.source = 'https://www.linkedin.com/in/someone'; }],
  ['dm-no-opt-out', (r) => { r.dm = 'Thanks for connecting. Mind if I email you a one-pager?'; }],
  ['link-in-dm', (r) => { r.dm += ' https://deck.example/x'; }],
  ['note-has-handle-or-price', (r) => { r.connectionNote = 'Hi Ava, rates from $500. Worth a chat?'; }],
  ['no-hook-not-low', (r) => { r.hook = { type: 'none' }; r.confidence = 'High'; }],
  ['route-unknown', (r) => { r.route = 'blast'; }],
  ['next-step-unknown', (r) => { r.nextStep = 'Blast'; }],
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

test('a YouTube search page, a channel search page and a feed are not sources; a watch link is', () => {
  const at = (source) => { const row = good(); row.hook.source = source; return rules([row]); };
  for (const page of [
    'https://www.youtube.com/results?search_query=acme+mower',
    'https://m.youtube.com/results?search_query=acme+mower',
    'https://www.youtube.com/@samplechannel/search?query=acme',
    'https://www.youtube.com/channel/UC0000/search?query=acme',
    'https://www.youtube.com/feeds/videos.xml?channel_id=UC0000',
  ]) assert.deepEqual(at(page), ['hook-source-not-allowed'], page);
  for (const video of ['https://www.youtube.com/watch?v=abc123', 'https://youtu.be/abc123', 'https://www.youtube.com/watch?v=abc123&t=search']) assert.deepEqual(at(video), [], video);
});

test('the consent ask can offer the one-pager in the chat', () => {
  const row = good();
  row.dm = `Thanks for connecting. Want the one-pager here or by email? ${OUT}`;
  assert.deepEqual(lint([row], roster, { today }).errors, []);
});

test('the DM asks exactly one question, and that question is the consent ask', () => {
  const row = good();
  row.dm = row.dm.replace('for spring.', 'for spring. Do you look after creator partnerships?');
  assert.deepEqual(rules([row]), ['dm-questions'], 'two asks read like a template');
  row.dm = good().dm.replace('want a one-pager here or by email?', 'I can send a one-pager here or by email.');
  assert.deepEqual(rules([row]), ['dm-questions', 'dm-no-consent-ask'], 'no question at all');
  // One question, but the wrong one: the consent wording sits in a statement, and the question asks something else.
  row.dm = `Thanks for connecting, Ava. I can send a one-pager here or by email. Do you look after creator partnerships? ${OUT}`;
  assert.deepEqual(rules([row]), ['dm-no-consent-ask']);
});

test('the DM names the sender: Leif, and Joyisfree Studio', () => {
  const row = good();
  row.dm = row.dm.replace('Leif, Joyisfree Studio', 'Leif');
  assert.deepEqual(rules([row]), ['dm-no-sender']);
  row.dm = good().dm.replace('Leif, Joyisfree Studio', 'Joyisfree Studio');
  assert.deepEqual(rules([row]), ['dm-no-sender']);
});

test('a note, when there is one, carries an easy way out', () => {
  const row = good();
  row.connectionNote = 'Hi Ava, saw Acme backed a lawn channel for spring. Worth a chat about creators for 2027?';
  assert.deepEqual(rules([row]), ['note-no-opt-out']);
  row.connectionNote = 'Hi Ava, saw Acme backed a lawn channel for spring. Is creator work yours? Happy to leave it if not.';
  assert.deepEqual(rules([row]), []);
});

test('a note is needed only on an "Invite + note" row, or while no next step is set', () => {
  const bare = (nextStep) => { const row = good(); row.connectionNote = ''; if (nextStep) row.nextStep = nextStep; return rules([row]); };
  assert.deepEqual(bare('Invite'), [], 'a bare invite carries no message');
  assert.deepEqual(bare('DM now'), [], 'already connected: there is no invite to write a note for');
  assert.deepEqual(bare('Wait'), []);
  assert.deepEqual(bare('Invite + note'), ['note-empty']);
  assert.deepEqual(bare(), ['note-empty']);
  const row = good(); row.nextStep = 'Invite + note';
  assert.deepEqual(rules([row]), []);
});

test('no view, subscriber, follower, percentage or money figure in a message; a year, a quarter and a plain count pass', () => {
  const dm = (line) => { const row = good(); row.dm = row.dm.replace('for spring.', `for spring. ${line}`); return rules([row]); };
  for (const figure of [
    'One channel gets 24k a video.', 'It has 1.2m subscribers.', 'A typical video gets about 24,000.', 'They reach 190 thousand people.',
    'Half a million followers watch it.', 'It has 800 subscribers so far.', 'Engagement sits at 12%.', 'Rates start at $500.',
  ]) assert.deepEqual(dm(figure), ['number-in-message'], figure);
  for (const fine of ['Worth a look for spring 2027.', 'Happy to share three ideas in Q1.', 'I have 3 ideas for the new 40V mower.']) assert.deepEqual(dm(fine), [], fine);
  // Every field Leif would send, not only the DM.
  for (const field of ['connectionNote', 'bump', 'emailOpener', 'subject']) {
    const row = good();
    row[field] = `${row[field] || ''} 24k views`.trim();
    assert.deepEqual(rules([row]), ['number-in-message'], field);
  }
});

test('no roster creator or alias in a message, even one who said yes; the private fit is not a message', () => {
  const dm = (line) => { const row = good(); row.dm = row.dm.replace('for spring.', `for spring. ${line}`); return rules([row]); };
  assert.deepEqual(dm('Pip films garden builds.'), ['creator-in-message'], 'Pip said yes and was measured: still not in a first message');
  assert.deepEqual(dm('Have you seen Jays Channel lately.'), ['creator-in-message'], 'an alias counts');
  assert.deepEqual(dm('Rex films garden builds.'), ['creator-in-message']);
  for (const field of ['connectionNote', 'bump', 'emailOpener', 'subject']) {
    const row = good();
    row[field] = `${row[field] || ''} Jay`.trim();
    assert.deepEqual(rules([row]), ['creator-in-message'], field);
  }
  const row = good(); row.fit = 'Pip';
  assert.deepEqual(rules([row]), [], 'the pick lives in the brand tab, for Leif only');
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

test('two colleagues at one brand never get the same DM, once the shared opt-out and sign-off are set aside', () => {
  const a = good();
  assert.deepEqual(rules([a, colleague()]), [], 'a detail of his own, and the same way out and sender: fine');
  const twin = colleague({ dm: a.dm.replace('Ava', 'Ben') });
  const r = lint([a, twin], roster, { today });
  assert.deepEqual(r.errors.map((e) => [e.key, e.rule]), [[twin.key, 'same-dm-as-colleague']], 'only the name changed');
  assert.deepEqual(rules([a, { ...twin, brand: 'Gizmo', key: 'Gizmo | Ben Sample' }]), [], 'another brand: not a colleague');
  assert.deepEqual(rules([a, { ...twin, route: 'skip' }]), [], 'a skipped colleague gets no message at all');
  // Two short DMs whose own words differ. Most of their words are the shared opt-out and sign-off, which do not count.
  const terse = (first, ask) => `${first}, ${ask} ${OUT}`;
  assert.deepEqual(rules([{ ...a, dm: terse('Ava', 'shall I email?') }, colleague({ dm: terse('Ben', 'can I email?') })]), []);
});

test('two colleagues never stand on the same detail: the same evidence id, or failing that the same link', () => {
  const pair = (mine, his) => { const a = good(); Object.assign(a.hook, mine); return lint([a, colleague({ hook: { ...colleague().hook, ...his } })], roster, { today }).errors.map((e) => [e.key, e.rule]); };
  const shared = [['Acme Mowers | Ben Sample', 'same-hook-as-colleague']];
  assert.deepEqual(pair({ evidence: 'e1' }, { evidence: 'e1' }), shared);
  assert.deepEqual(pair({ evidence: 'e1' }, { evidence: 'e2' }), []);
  const link = 'https://acme.example/spring';
  assert.deepEqual(pair({ evidence: 'e1', source: link }, { evidence: 'e2', source: link }), [], 'two details from one page, each with its own id');
  assert.deepEqual(pair({ source: link }, { source: link }), shared, 'no ids: the link decides');
  assert.deepEqual(pair({ evidence: 'e1', source: link }, { source: link }), shared, 'one id is not two');
  assert.deepEqual(pair({}, {}), []);
});

test('a creator name inside a brand name is not a creator in the message', () => {
  const row = good();
  row.brand = 'Spear & Jayson'; // contains "Jay" only as part of a word
  row.connectionNote = 'Hi Ava, saw Spear & Jayson backed a garden channel. Worth a chat? No worries if not.';
  row.dm = `Saw Spear & Jayson backed a garden channel. Mind if I email you a one-pager? ${OUT}`;
  assert.deepEqual(lint([row], roster, { today }).errors, []);
});

test('a Canadian or unknown-country LinkedIn row is held, not failed; a US row goes; the postal line releases it', () => {
  const held = (patch, opts) => {
    const r = lint([{ ...good(), ...patch }], roster, { today, ...opts });
    assert.deepEqual(r.errors, [], 'a hold is not an error');
    return r.holds;
  };
  assert.deepEqual(held({ country: 'Australia' }), []);
  assert.deepEqual(held({ country: 'United States' }), [], 'CAN-SPAM covers email, not a LinkedIn message');
  for (const country of ['Canada', 'CA', ' canada ', '', undefined, 'unknown', '?']) {
    assert.deepEqual(held({ country }).map((h) => [h.key, h.rule]), [['Acme Mowers | Ava Sample', 'country-hold']], `country: ${country}`);
  }
  assert.match(held({ country: 'Canada' })[0].detail, /CASL/);
  assert.match(held({ country: '' })[0].detail, /country/);
  assert.deepEqual(held({ country: 'Canada', route: 'email-consented', consent: 'yes' }), [], 'an email is held by the email check, on the email itself');
  const postal = 'PO Box 1, Sample NSW 2000';
  const { dm, connectionNote } = good();
  assert.equal(held({ country: 'Canada' }, { postal }).length, 1, 'the line must be in the DM, not just known');
  assert.equal(held({ country: 'Canada', dm: `${dm} ${postal}` }, { postal }).length, 1, 'and in the note, when there is a note');
  assert.equal(held({ country: 'Canada', dm: `${dm} ${postal}`, connectionNote: `${connectionNote} ${postal}` }).length, 1, 'a line the caller never passed proves nothing');
  assert.deepEqual(held({ country: 'Canada', dm: `${dm} ${postal}`, connectionNote: `${connectionNote} ${postal}` }, { postal }), []);
  assert.deepEqual(held({ country: '', dm: `${dm} ${postal}`, connectionNote: '', nextStep: 'Invite' }, { postal }), [], 'a bare invite has no note to carry it');
});

test('the email check and the row check read a country the same way', () => {
  assert.equal(countryLaw('Canada'), 'CASL');
  assert.equal(countryLaw(' ca '), 'CASL');
  assert.equal(countryLaw('USA'), 'CAN-SPAM');
  assert.equal(countryLaw('United States of America'), 'CAN-SPAM');
  assert.equal(countryLaw('Australia'), '');
  assert.equal(countryLaw(''), '');
  assert.equal(countryLaw(undefined), '');
});

// Ava's own LinkedIn post, which Leif pasted: it has no link, so it carries a topic and is never quoted.
const post = (patch = {}) => ({
  ...good(), confidence: 'Medium',
  connectionNote: 'Hi Ava, enjoyed your post about the spring range. Are creator partnerships yours? No worries if not.',
  dm: `Thanks for connecting, Ava. Your post about the spring range caught my eye. If creator partnerships are yours, want a one-pager here or by email? ${OUT}`,
  hook: { type: 'post', topic: 'the spring range', text: 'Proud of the team: our spring range lands in stores next week after two years of work.', source: 'paste', date: '2026-10-20', ...patch },
});

test('a LinkedIn post hook is pasted or a screenshot, never a link, with a date and a topic', () => {
  assert.deepEqual(rules([post()]), []);
  assert.deepEqual(rules([post({ source: 'screenshot' })]), []);
  assert.deepEqual(rules([post({ source: 'https://www.linkedin.com/posts/sample' })]), ['hook-source-not-allowed']);
  assert.deepEqual(rules([post({ source: 'https://brand.example/news' })]), ['hook-source-not-allowed'], 'never a link, whatever the site');
  assert.deepEqual(rules([post({ source: '' })]), ['hook-without-source']);
  assert.deepEqual(rules([post({ date: '' })]), ['hook-without-date']);
  assert.deepEqual(rules([post({ topic: '' })]), ['hook-without-topic']);
});

test('a post hook goes stale after 183 days, and a screenshot is never High confidence', () => {
  assert.deepEqual(rules([post({ date: '2026-05-06' })]), [], '183 days');
  assert.deepEqual(rules([post({ date: '2026-05-05' })]), ['hook-stale'], '184 days');
  assert.deepEqual(rules([{ ...post({ source: 'screenshot' }), confidence: 'High' }]), ['screenshot-hook-high'], 'a screenshot cannot be checked twice');
  assert.deepEqual(rules([{ ...post(), confidence: 'High' }]), []);
});

test('a post is referred to by topic: six of its words in a row, in the note, DM or bump, is a quote', () => {
  const lifted = 'our spring range lands in stores next week';
  for (const field of ['connectionNote', 'dm', 'bump']) {
    const row = post();
    row[field] = field === 'dm' ? row.dm.replace('Your post about the spring range caught my eye.', `Loved "${lifted}".`) : `Loved "${lifted}". No worries if not.`;
    assert.deepEqual(rules([row]), ['post-quoted'], field);
  }
  const row = post();
  row.dm = row.dm.replace('caught my eye.', 'caught my eye, and so did hearing the spring range lands in stores soon.');
  assert.deepEqual(rules([row]), [], 'five words in a row is still her topic, in our words');
  row.dm = post().dm.replace('caught my eye.', 'caught my eye: OUR SPRING RANGE, lands in stores next week!');
  assert.deepEqual(rules([row]), ['post-quoted'], 'capitals and punctuation do not hide a quote');
});

test('a date read from a relative age ("3w") names no month in the note, DM or bump', () => {
  const approx = () => post({ approx: true });
  assert.deepEqual(rules([approx()]), []);
  for (const field of ['connectionNote', 'dm', 'bump']) {
    const row = approx();
    row[field] = field === 'dm' ? row.dm.replace('Your post about', 'Your October post about') : 'Your post in Oct about the spring range stuck with me. No worries if not.';
    assert.deepEqual(rules([row]), ['month-from-relative-age'], field);
  }
  const exact = post();
  exact.dm = exact.dm.replace('Your post about', 'Your October post about');
  assert.deepEqual(rules([exact]), [], 'an exact date may name its month');
  // "may" the verb is not the month; "May" inside a sentence is.
  const row = approx();
  row.bump = 'This may not be your area, so no worries if not.';
  assert.deepEqual(rules([row]), []);
  row.bump = 'Your post in May stuck with me. No worries if not.';
  assert.deepEqual(rules([row]), ['month-from-relative-age']);
});

test('the two example messages from the plan pass every check, each with a note that follows the same rules', () => {
  const maya = {
    key: 'Acme Garden | Maya Sample', brand: 'Acme Garden', name: 'Maya Sample', route: 'linkedin-dm', nextStep: 'Invite + note', country: 'Australia',
    connectionNote: 'Hi Maya, saw Acme Garden just launched its balcony potting bench. Are creator partnerships yours? No worries if not.',
    dm: "Thanks for connecting, Maya. Saw Acme Garden just launched its balcony potting bench. I match home and garden YouTube creators with brands. If creator partnerships are yours, want a one-pager here or by email? If this isn't your area, just say and I won't follow up. Leif, Joyisfree Studio",
    hook: { type: 'launch', text: 'Acme Garden launched a balcony potting bench', source: 'https://acmegarden.example/news/potting-bench', date: '2026-10-20', evidence: 'e1' }, confidence: 'Medium',
  };
  const tom = {
    key: 'Acme Herbs | Tom Sample', brand: 'Acme Herbs', name: 'Tom Sample', route: 'linkedin-dm', nextStep: 'Invite + note', country: 'United States',
    connectionNote: "Hi Tom, Acme Herbs' spring page leads with its indoor herb kits. Is creator work your area? No worries if not.",
    dm: "Thanks for connecting, Tom. Acme Herbs' spring page leads with its indoor herb kits. I help home and garden brands find YouTube creators who fit. Mind if I email you a one-pager? No worries if not, and I won't follow up. Leif, Joyisfree Studio",
    hook: { type: 'season', text: "Acme Herbs' spring page leads with indoor herb kits", source: 'https://acmeherbs.example/spring', date: '2026-10-28', evidence: 'e2' }, confidence: 'Medium',
  };
  const r = lint([maya, tom], roster, { today });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.holds, []);
});

// The row lint no longer lets a creator or a number into a first message at all. The two date rules stay for the
// one-pager and the emails, so they are checked here on the function itself.
test('a creator is named only after a yes in the last 90 days', () => {
  const named = (yesAt) => creatorStatus({ ...roster.creators[0], yesAt }, today).named;
  assert.equal(named('2026-07-01'), false, '127 days ago is too old');
  assert.equal(named(undefined), false, 'no yes on record fails closed');
  assert.equal(named('2026-09-01'), true);
  assert.equal(named('2027-11-02'), false, 'a date in the future is a typo and fails closed');
});

test('a number counts only when measured in the last 30 days, and a sheet figure never does', () => {
  const quotable = (patch) => creatorStatus({ ...roster.creators[0], ...patch }, today).fresh;
  assert.equal(quotable({}), true);
  assert.equal(quotable({ measuredAt: '2026-09-20' }), false, '46 days is too old');
  assert.equal(quotable({ measuredAt: undefined }), false, 'no date fails closed');
  assert.equal(quotable({ numberSource: 'roster sheet, not re-measured' }), false);
});

test('a creator is nameable only after a recent yes, and quotable only when measured recently', () => {
  const [jay, , rex, moss, lark] = roster.creators;
  assert.deepEqual(creatorStatus(jay, today), { named: true, fresh: true });
  assert.deepEqual(creatorStatus(rex, today), { named: false, fresh: true });
  assert.deepEqual(creatorStatus(moss, today), { named: true, fresh: false });
  assert.deepEqual(creatorStatus(lark, today), { named: true, fresh: false });
  assert.deepEqual(creatorStatus(null, today), { named: false, fresh: false });
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

test('the CLI counts held rows without failing, and --postal releases a row that carries the line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-lint-'));
  const rosterPath = join(dir, 'roster.json');
  writeFileSync(rosterPath, JSON.stringify(roster));
  const postal = 'PO Box 1, Sample NSW 2000';
  const row = { ...good(), country: 'Canada', nextStep: 'Invite', connectionNote: '' };
  row.dm = `${row.dm} ${postal}`;
  const rowsPath = join(dir, 'rows.json');
  writeFileSync(rowsPath, JSON.stringify([row]));
  const run = (...more) => execFileSync(process.execPath, [join(here, 'lint-lines.mjs'), '--rows', rowsPath, '--roster', rosterPath, '--today', today, ...more], { stdio: 'pipe' }).toString();
  assert.match(run(), /checked 1 rows · 0 errors · 0 warnings · 1 held/);
  assert.match(run('--postal', postal), /checked 1 rows · 0 errors · 0 warnings · 0 held/);
});
