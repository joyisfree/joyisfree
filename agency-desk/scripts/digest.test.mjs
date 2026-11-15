// The homework: what the YouTube Data API returned for one creator, or what Leif pasted from one person's LinkedIn
// posts, becomes a pack of evidence items. Each test is the one mistake its rule exists to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sponsorLines, boilerplate, chapters, futureLines, seriesArc, themes, standouts, lengthKind, stats, sensitive,
  managedBy, evidencePack, fromSearch, linkedinPosts, briefInput, ENGAGEMENT_LABEL,
} from './digest.mjs';

const TODAY = '2026-11-16';
const FETCHED = '2026-11-16T01:00:00Z';
const day = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString();

// A made-up channel: 12 long videos, one every 10 days, 1,000 to 12,000 views, the newest first.
const video = (i, x = {}) => ({
  id: `vid${String(i).padStart(8, '0')}`, channelId: 'UCmadeupmadeupmadeupmade', title: `Shed build, Part ${13 - i}: step ${i}`,
  description: `Step ${i} of the shed.\nFollow along on the socials: @pineandplank\nGear I use: the usual kit`,
  publishedAt: day(i * 10), durationSec: 900, views: i * 1000, likes: i * 40, comments: i * 10, paid: false,
  tags: ['shed', 'woodworking'], lang: 'en', live: false, ...x,
});
const twelve = () => Array.from({ length: 12 }, (_, k) => video(k + 1));
const channel = { id: 'UCmadeupmadeupmadeupmade', handle: '@pineandplank', title: 'Pine and Plank', description: 'We build sheds in the hills.', country: 'AU' };

test('a sponsor line is read from the description, with the sponsor when the line names one', () => {
  const d = 'This video is sponsored by Acme Tools! Use code PLANK for 10% off.\nThanks to Northwind Paints for sponsoring today\'s video.\nWe painted the door.\n#ad';
  const got = sponsorLines(d);
  assert.deepEqual(got.map((s) => s.brand), ['Acme Tools', 'Northwind Paints', '']);
  assert.equal(got[0].text, 'This video is sponsored by Acme Tools! Use code PLANK for 10% off.', 'the line is kept word for word');
  assert.deepEqual(sponsorLines('We sponsored nothing. The door is blue.'), [], 'the word alone is not a sponsor line');
});

test('a line repeated in most descriptions is boilerplate: a standing partner, not a new deal', () => {
  const vs = twelve().map((v, k) => ({ ...v, description: `${v.description}\nGet 10% off at Acme Tools with code PLANK${k === 0 ? '\nThis video is sponsored by Fernleaf Planters.' : ''}` }));
  const standing = boilerplate(vs);
  assert.ok(standing.has('get 10% off at acme tools with code plank'));
  assert.ok(!standing.has('this video is sponsored by fernleaf planters.'));
  assert.equal(boilerplate(vs.slice(0, 2)).size, 0, 'two videos are too few to call anything boilerplate');
});

test('chapters count only as YouTube counts them: three or more, starting at 0:00', () => {
  const d = 'Intro text\n0:00 Intro\n2:15 Framing the walls\n1:02:03 Roof on\nThanks!';
  assert.deepEqual(chapters(d), [{ t: 0, label: 'Intro' }, { t: 135, label: 'Framing the walls' }, { t: 3723, label: 'Roof on' }]);
  assert.deepEqual(chapters('2:15 Framing\n3:00 Roof\n4:00 Door'), [], 'no 0:00 start');
  assert.deepEqual(chapters('0:00 Intro\n2:15 Framing'), [], 'only two');
});

test('a line about what comes next is kept as a plan', () => {
  const d = 'We framed the walls.\nNext week we pour the slab for the workshop.\nPart 2 is coming soon!\nSubscribe for more.';
  assert.deepEqual(futureLines(d), ['Next week we pour the slab for the workshop.', 'Part 2 is coming soon!']);
});

test('a numbered series is found, and the newest one is the story they are telling now', () => {
  const vs = [
    { id: 'a', title: 'Cabin rebuild, Part 3: the roof', publishedAt: day(5) },
    { id: 'b', title: 'Cabin rebuild, Part 2: the walls', publishedAt: day(15) },
    { id: 'c', title: 'Cabin rebuild - Part 1', publishedAt: day(25) },
    { id: 'd', title: 'Day 4: van life in the rain', publishedAt: day(100) },
    { id: 'e', title: 'Day 3: van life', publishedAt: day(110) },
    { id: 'f', title: 'A one-off video about paint', publishedAt: day(1) },
  ];
  const arcs = seriesArc(vs);
  assert.equal(arcs[0].name, 'cabin rebuild');
  assert.equal(arcs[0].count, 3);
  assert.equal(arcs[0].latest.id, 'a');
  assert.equal(arcs[0].latest.n, 3);
  assert.equal(arcs.length, 2, 'a one-off video is not a series');
});

test('themes are the words that keep coming back, not the words every title has', () => {
  const vs = ['Restoring the old barn roof', 'Barn doors from scrap oak', 'Why the barn floods', 'A day off at the beach'].map((title, i) => ({ id: `t${i}`, title, tags: [] }));
  const t = themes(vs);
  assert.equal(t[0].word, 'barn');
  assert.equal(t[0].count, 3);
  assert.ok(!t.some((x) => x.word === 'the' || x.word === 'from'));
});

test('a stand-out is a long video with at least twice the typical views', () => {
  const vs = twelve();
  vs[3] = { ...vs[3], views: 60_000 };
  const s = standouts(vs, 6500);
  assert.deepEqual(s.map((x) => x.id), [vs[3].id]);
  assert.equal(s[0].times, 9.2);
});

test('length decides what a video is: a Short, maybe a Short, or long', () => {
  assert.equal(lengthKind({ durationSec: 45 }), 'short');
  assert.equal(lengthKind({ durationSec: 150 }), 'maybe');
  assert.equal(lengthKind({ durationSec: 181 }), 'long');
  assert.equal(lengthKind({ durationSec: 0, live: true }), 'live');
});

test('the numbers: typical, average, best, pace, last upload and an engagement rate that says whose sum it is', () => {
  const s = stats(twelve(), TODAY, FETCHED);
  assert.equal(s.typical, 6500);
  assert.equal(s.average, 6500);
  assert.equal(s.best.views, 12000);
  assert.equal(s.n, 12);
  assert.equal(s.lastUpload.date, day(10).slice(0, 10));
  assert.equal(s.lastUpload.daysAgo, 10);
  assert.equal(s.pace.medianGapDays, 10);
  assert.equal(s.engagement.label, ENGAGEMENT_LABEL);
  assert.equal(ENGAGEMENT_LABEL, 'engagement rate (our calculation from YouTube data)');
  assert.equal(s.engagement.rate, 0.05, '(40 + 10) per 1,000 views on every video');
  assert.equal(s.refreshBy, '2026-12-16', 'YouTube data is refreshed or deleted within 30 days');
  assert.throws(() => stats(twelve(), TODAY, ''), /fetchedAt/, 'a number with no fetch date cannot be aged, so it is refused');
});

test('hidden likes or comments mean no engagement rate, never a rate built from zeros', () => {
  const s = stats(twelve().map((v) => ({ ...v, likes: null })), TODAY, FETCHED);
  assert.equal(s.engagement.rate, null);
  assert.match(s.engagement.why, /hidden|off/);
});

test('a channel that is mostly Shorts gets no typical number, and says why', () => {
  const vs = [...Array.from({ length: 45 }, (_, k) => video(k + 1, { durationSec: 40 })), ...Array.from({ length: 5 }, (_, k) => video(k + 46))];
  const s = stats(vs, TODAY, FETCHED);
  assert.equal(s.typical, null);
  assert.match(s.why, /mostly Shorts/);
});

test('health, family hardship, children, religion, politics and money troubles are never a hook', () => {
  for (const t of ['Dad is home from hospital after his surgery', 'We lost the baby', 'Why our church built this', 'Who I am voting for', 'We are in debt and may lose the house']) {
    assert.ok(sensitive(t), t);
  }
  assert.ok(!sensitive('Pouring the slab for the new workshop'));
});

test('a channel run by a management company is not ours to offer', () => {
  assert.ok(managedBy('For business enquiries: talent@bigagency.example\nManaged by Big Agency'));
  assert.ok(!managedBy('We build sheds in the hills. Email us: hello@pineandplank.example'));
});

test('the pack: every item has an id, a link, a date and an owner, and only true lines get in', () => {
  const vs = twelve();
  vs[0] = { ...vs[0], paid: true, description: `0:00 Intro\n3:10 The roof goes on\n9:45 First rain test\nThis video is sponsored by Acme Tools!\nNext week we fit the door.\nDad is home from hospital, thank you all.\n${vs[0].description}` };
  const comments = { [vs[0].id]: { disabled: false, comments: [{ text: 'The rain test had me on the edge of my seat', likes: 212, publishedAt: day(9) }], ownerReplies: [{ text: 'Ha, me too. The door is next!', publishedAt: day(9) }] } };
  const pack = evidencePack({ channel, videos: vs, comments, fetchedAt: FETCHED, today: TODAY });
  const by = (kind) => pack.items.filter((i) => i.kind === kind);
  assert.equal(by('title').length, 12);
  assert.equal(by('title')[0].link, `https://www.youtube.com/watch?v=${vs[0].id}`);
  assert.equal(by('title')[0].date, day(10).slice(0, 10));
  assert.equal(by('sponsor').length, 1);
  assert.equal(by('sponsor')[0].brand, 'Acme Tools');
  assert.equal(by('paid').length, 1, "YouTube's own paid-promotion flag is evidence of a paid deal");
  assert.equal(by('chapter').length, 3);
  assert.equal(by('chapter')[1].link, `https://www.youtube.com/watch?v=${vs[0].id}&t=190s`, 'a chapter links to its moment');
  assert.equal(by('plan').length, 1);
  assert.equal(by('fan')[0].owner, 'audience');
  assert.equal(by('reply')[0].owner, 'self');
  assert.ok(pack.items.every((i) => i.id && i.date && i.owner && i.source === 'api'));
  assert.equal(new Set(pack.items.map((i) => i.id)).size, pack.items.length, 'ids are unique');
  assert.ok(pack.items.find((i) => /hospital/.test(i.text)).never, 'a health line is marked never-a-hook');
  assert.ok(!by('sponsor').some((i) => /socials|gear i use/i.test(i.text)), 'boilerplate is not a sponsor line');
  assert.equal(pack.refreshBy, '2026-12-16');
  assert.equal(pack.who.handle, '@pineandplank');
  assert.equal(pack.summary.sponsors, '1 sponsor line in 12 descriptions');
  assert.throws(() => evidencePack({ channel, videos: vs, comments, today: TODAY }), /fetchedAt/);
});

test('what was not read is "unknown" or "not checked", never "none"', () => {
  const noDesc = twelve().map((v) => ({ ...v, description: undefined }));
  const pack = evidencePack({ channel, videos: noDesc, fetchedAt: FETCHED, today: TODAY });
  assert.equal(pack.summary.sponsors, 'unknown (no descriptions were read)');
  assert.equal(pack.summary.fans, 'not checked');
  const off = evidencePack({ channel, videos: twelve(), comments: { vid00000001: { disabled: true, comments: [], ownerReplies: [] } }, fetchedAt: FETCHED, today: TODAY });
  assert.equal(off.summary.fans, 'comments off');
});

test('a channel that is not in English has its sponsor and plan lines left unread, and says so', () => {
  const vs = twelve().map((v) => ({ ...v, lang: 'ja', description: 'This video is sponsored by Acme Tools!' }));
  const pack = evidencePack({ channel, videos: vs, fetchedAt: FETCHED, today: TODAY });
  assert.equal(pack.items.filter((i) => i.kind === 'sponsor').length, 0);
  assert.match(pack.summary.sponsors, /not in English/);
});

test('a search result is a pointer, never a quote: its text is cut short and escaped', () => {
  const items = fromSearch([{ videoId: 'abc', channelId: 'UCx', channelTitle: 'Someone', title: 'It&#39;s the Acme sander', snippet: 'We try the…', publishedAt: day(3) }], FETCHED);
  assert.equal(items[0].quotable, false);
  assert.equal(items[0].kind, 'mention');
});

const PASTE = `Feed post number 1
Maya Example
Maya Example
 • 2nd
Head of Influencer Marketing at Acme Garden
3w •

We just launched the balcony potting bench. Proud of the team.
It took two years.
…see more
41
6 comments
Like
Comment
Repost
Send
Feed post number 2
Maya Example reposted this
Tom Other
Tom Other
 • 3rd+
Founder at Elsewhere
1mo •

Hiring a designer in Leeds.
Like
Comment
Feed post number 3
Maya Example commented on this
Sam Third
 • 2nd
Writer
2d •

A thread about gardens.
Like
Feed post number 4
Maya Example
Maya Example
 • 2nd
Head of Influencer Marketing at Acme Garden
5d • Edited •

Creator briefs go out in January this year.
Like
`;

test("a pasted LinkedIn page keeps only the person's own posts: a repost and a comment are dropped as it is read", () => {
  const r = linkedinPosts(PASTE, { name: 'Maya Example', today: TODAY });
  assert.equal(r.posts.length, 2);
  assert.equal(r.posts[0].text, 'We just launched the balcony potting bench. Proud of the team.\nIt took two years.');
  assert.deepEqual(r.dropped, { reposted: 1, commented: 1, reacted: 0, notTheirs: 0, empty: 0 });
  assert.equal(r.headline, 'Head of Influencer Marketing at Acme Garden');
  assert.ok(r.posts.every((p) => p.kind === 'post' && p.owner === 'self' && p.source === 'paste' && !p.link));
  assert.equal(linkedinPosts(PASTE, { name: 'Maya Example', today: TODAY, source: 'screenshot' }).posts[0].source, 'screenshot');
});

test('a relative age becomes a date range, and the older end is the one that counts', () => {
  const r = linkedinPosts(PASTE, { name: 'Maya Example', today: TODAY });
  assert.equal(r.posts[0].date, '2026-10-20', '"3w" is 21 to 27 days ago');
  assert.equal(r.posts[0].dateTo, '2026-10-26');
  assert.equal(r.posts[0].approx, true);
  assert.equal(r.posts[1].date, '2026-11-11', '"5d" is a day');
  assert.equal(r.posts[1].approx, false);
});

test("someone else's post in the paste is not theirs, and a headline at another company is flagged", () => {
  const r = linkedinPosts(PASTE, { name: 'Tom Other', today: TODAY });
  assert.equal(r.posts.length, 0, 'his only post here arrived as her repost');
  const moved = linkedinPosts(PASTE, { name: 'Maya Example', company: 'Northwind Paints', today: TODAY });
  assert.ok(moved.flags.includes('changed job?'));
  assert.ok(!linkedinPosts(PASTE, { name: 'Maya Example', company: 'Acme Garden', today: TODAY }).flags.includes('changed job?'));
});

test('the brief input lists every item by its id, so each line of a brief can say where it came from', () => {
  const pack = evidencePack({ channel, videos: twelve(), fetchedAt: FETCHED, today: TODAY });
  const text = briefInput(pack);
  assert.match(text, /\[t:vid00000001\] \(\d{4}-\d{2}-\d{2}\) Shed build, Part 12: step 1/);
  assert.match(text, /engagement rate \(our calculation from YouTube data\)/);
  assert.ok(text.length < 40_000, 'small enough to read in one go');
});
