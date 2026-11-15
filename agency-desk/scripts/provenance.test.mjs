// Check 1 of the two checks on every brief: is each line really this person's, word for word? A clean brief passes,
// and every rule fails on the one mistake it exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBrief, ticks } from './provenance.mjs';

const item = (id, kind, text, x = {}) => ({ id, kind, text, link: 'https://www.youtube.com/watch?v=v1', date: '2026-11-06', owner: 'self', source: 'api', ...x });
const pack = () => ({
  who: { kind: 'creator', handle: '@pineandplank', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Pine and Plank' },
  items: [
    item('t:v1', 'title', 'Shed build, Part 12: the roof goes on'),
    item('t:v2', 'title', 'Painting the door (it went wrong)'),
    item('s:v1:1', 'sponsor', 'This video is sponsored by Acme Tools!', { brand: 'Acme Tools' }),
    item('p:v2', 'paid', 'Painting the door (it went wrong)'),
    item('f:v1:1', 'plan', 'Next week we fit the door.'),
    item('a:v1:1', 'fan', 'The rain test had me on the edge of my seat', { owner: 'audience' }),
    item('d:v1:1', 'description', 'Dad is home from hospital, thank you all.', { never: true }),
    item('m:x1', 'mention', 'It&#39;s the Acme sander', { owner: 'other', quotable: false }),
  ],
});
const line = (text, cites, x = {}) => ({ section: 'brief', text, cites, ...x });
const brief = (lines, x = {}) => ({ who: { handle: '@pineandplank', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' }, lines, ...x });
const rules = (b, p = pack()) => checkBrief(b, p).errors.map((e) => e.rule);

const clean = () => brief([
  line('Right now they are on "Shed build, Part 12: the roof goes on".', ['t:v1']),
  line('Next up is the door: "Next week we fit the door."', ['f:v1:1']),
  line('They have taken a sponsor before: Acme Tools partnered on the roof video.', ['s:v1:1']),
  line('Viewers said "The rain test had me on the edge of my seat".', ['a:v1:1'], { audience: true }),
  line('My read: the shed series is winding up, so a new project is close.', ['t:v1', 'f:v1:1'], { read: true }),
  line('Open to brand deals in the new year?', [], { ask: true }),
]);

test('a brief whose every line is cited and quoted word for word passes, and earns the second tick only from the guardian', () => {
  const r = checkBrief(clean(), pack());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 6);
  assert.equal(ticks(r), '✓', 'the script is one check');
  assert.equal(ticks(r, 'pass'), '✓✓');
  assert.equal(ticks(r, 'veto'), '✗');
});

test('an invented quote, and a real one with a single letter changed, both fail', () => {
  assert.deepEqual(rules(brief([line('They said "we are moving to Portugal next spring".', ['t:v1'])])), ['quote-not-found']);
  assert.deepEqual(rules(brief([line('Right now: "Shed build, Part 12: the roof goes in".', ['t:v1'])])), ['quote-not-found']);
  assert.deepEqual(rules(brief([line('Right now: "shed build, part 12:  the roof goes on".', ['t:v1'])])), [], 'capitals and spacing are not words');
  assert.deepEqual(rules(brief([line('Right now it is the roof.', ['t:v1'], { quotes: ['the roof goes off'] })])), ['quote-not-found'], 'a listed quote is checked too');
});

test("another channel's words are not this person's: an id from elsewhere, or a brief written for someone else", () => {
  assert.deepEqual(rules(brief([line('They posted "Van life, day 40".', ['t:zz9'])])), ['unknown-id', 'quote-not-found']);
  const other = { ...clean(), who: { handle: '@someoneelse', channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb' } };
  assert.deepEqual(rules(other), ['wrong-person']);
});

test('a line with no evidence id fails, and so does an interpretation that is not labelled', () => {
  assert.deepEqual(rules(brief([line('They love cedar.', [])])), ['no-evidence']);
  assert.deepEqual(rules(brief([line('They seem ready for a new project.', ['t:v1'])])), ['unlabelled-read']);
  assert.deepEqual(rules(brief([line('The series is winding up.', ['t:v1'], { read: true })])), ['unlabelled-read']);
  assert.deepEqual(rules(brief([line('My read: the series is winding up.', ['t:v1'])])), ['unlabelled-read'], 'the label and the flag go together');
});

test('"partnered" needs a sponsor line or YouTube\'s paid flag; otherwise the word is "featured"', () => {
  assert.deepEqual(rules(brief([line('Acme Tools partnered with them on the roof.', ['t:v1'])])), ['partnered-without-proof']);
  assert.deepEqual(rules(brief([line('Acme Tools sponsored the roof video.', ['s:v1:1'])])), []);
  assert.deepEqual(rules(brief([line('The door video was a paid partnership.', ['p:v2'])])), []);
  assert.deepEqual(rules(brief([line('The roof video featured an Acme sander.', ['t:v1'])])), []);
});

test("a fan's words are never passed off as the creator's, and a search result is never quoted", () => {
  assert.deepEqual(rules(brief([line('They wrote "The rain test had me on the edge of my seat".', ['a:v1:1'])])), ['fan-quoted-as-theirs']);
  assert.deepEqual(rules(brief([line('A creator posted "It&#39;s the Acme sander".', ['m:x1'])])), ['not-quotable', 'mention-unconfirmed']);
});

test('a health line can inform Leif, but it is never a hook or a line for a message', () => {
  assert.deepEqual(rules(brief([line('Go gently: a parent has been in hospital.', ['d:v1:1'])])), []);
  assert.deepEqual(rules(brief([line('Glad your dad is home.', ['d:v1:1'], { section: 'hook' })])), ['never-a-hook']);
  assert.deepEqual(rules(brief([line('Glad your dad is home.', ['d:v1:1'], { section: 'block' })])), ['never-a-hook']);
});

test('an engagement rate always says whose sum it is, and figures come from the script, not from the writer', () => {
  assert.deepEqual(rules(brief([line('Their engagement rate is strong.', ['t:v1'])])), ['engagement-unlabelled']);
  assert.deepEqual(rules(brief([line('Their engagement rate (our calculation from YouTube data) is above the roster.', ['t:v1'])])), []);
  assert.deepEqual(rules(brief([line('The roof video did 60K views.', ['t:v1'])])), ['figure-in-line']);
  assert.deepEqual(rules(brief([line('Part 12 of the shed build came out in 2026.', ['t:v1'])])), [], 'a part number and a year are not figures');
});

const person = (source = 'paste') => ({
  who: { kind: 'person', name: 'Maya Example', brand: 'Acme Garden' },
  items: [{ id: 'li:1', kind: 'post', text: 'We just launched the balcony potting bench. Proud of the team.\nIt took two years.', date: '2026-10-20', dateTo: '2026-10-26', approx: true, owner: 'self', source }],
});
const forMaya = (lines, x = {}) => ({ who: { name: 'Maya Example' }, lines, ...x });

test('a LinkedIn post is referred to by topic and never quoted, and a repost was never in the pack to cite', () => {
  assert.deepEqual(checkBrief(forMaya([line('She posted about the launch of a balcony potting bench.', ['li:1'])]), person()).errors, []);
  assert.deepEqual(checkBrief(forMaya([line('She wrote "Proud of the team."', ['li:1'])]), person()).errors.map((e) => e.rule), ['post-quoted']);
  assert.deepEqual(checkBrief(forMaya([line('She says they just launched the balcony potting bench and is proud.', ['li:1'])]), person()).errors.map((e) => e.rule), ['post-quoted'], 'six of her words in a row is a quote');
  assert.deepEqual(checkBrief(forMaya([line('She is hiring a designer in Leeds.', ['li:2'])]), person()).errors.map((e) => e.rule), ['unknown-id']);
});

test('a detail seen only in a screenshot gets one tick at most, whatever the guardian says', () => {
  const r = checkBrief(forMaya([line('She posted about the launch of a balcony potting bench.', ['li:1'])]), person('screenshot'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.canDoubleTick, false);
  assert.equal(ticks(r, 'pass'), '✓');
  assert.deepEqual(checkBrief(forMaya([line('She posted about the launch.', ['li:1'])], { ticks: '✓✓' }), person('screenshot')).errors.map((e) => e.rule), ['screenshot-double-tick']);
});

test("a brand's channel counts only when it matches the brand's own domain or handle, and a mention only once the video names the brand", () => {
  const brand = (matched) => ({
    who: { kind: 'brand', name: 'Acme Garden', channelId: 'UCcccccccccccccccccccccc', matched },
    items: [item('t:b1', 'title', 'The new balcony potting bench'), item('m:c1', 'mention', 'We try the Acme Garden bench', { owner: 'other', quotable: false, confirmed: true })],
  });
  const b = { who: { name: 'Acme Garden' }, lines: [line('Their channel just showed the new balcony potting bench.', ['t:b1'])] };
  assert.deepEqual(checkBrief(b, brand('domain')).errors, []);
  assert.deepEqual(checkBrief(b, brand('')).errors.map((e) => e.rule), ['brand-channel-unmatched']);
  const m = { who: { name: 'Acme Garden' }, lines: [line('A creator featured the bench in a recent video.', ['m:c1'])] };
  assert.deepEqual(checkBrief(m, brand('')).errors, [], 'a confirmed mention stands on its own video, not on the brand channel');
});
