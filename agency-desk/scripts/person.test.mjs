// The one command behind "personalise …": the identity gate, the creator run on a fake API (no network), the
// LinkedIn paste run, the 30-day prune and forget. Every write lands in a temp folder outside the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug, identity, creatorRun, personRun, prune, forget, brandCountry, handleGuesses, channelMatch, confirmMention, doFirst, brandRun } from './person.mjs';

// A real key never rides in a test: if this machine holds one, this process and the ones it starts forget it here.
delete process.env.YOUTUBE_API_KEY;

const TODAY = '2026-11-16';
const NOW = '2026-11-16T01:00:00Z';
const day = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString();
const scratch = () => mkdtempSync(join(tmpdir(), 'agency-person-'));
const here = fileURLToPath(new URL('.', import.meta.url));

const channel = (x = {}) => ({ id: 'UCmadeupmadeupmadeupmade', handle: '@pineandplank', title: 'Pine and Plank', description: 'We build sheds in the hills.\nhello@pineandplank.example', country: 'AU', uploads: 'UUmadeupmadeupmadeupmade', ...x });
const video = (i, x = {}) => ({
  id: `vid${String(i).padStart(8, '0')}`, channelId: 'UCmadeupmadeupmadeupmade', title: `Shed build, Part ${13 - i}: step ${i}`,
  description: `Step ${i} of the shed.\nThis video is sponsored by Acme Tools!`, publishedAt: day(i * 10), durationSec: 900,
  views: i * 1000, likes: i * 40, comments: i * 10, paid: false, tags: [], lang: 'en', live: false, ...x,
});
const videos = () => Array.from({ length: 12 }, (_, k) => video(k + 1));
function fakeApi(x = {}) {
  const calls = { channel: 0, uploads: 0, videos: 0, topComments: [] };
  return {
    calls,
    channel: async () => { calls.channel++; return 'channel' in x ? x.channel : channel(); },
    uploads: async () => { calls.uploads++; return videos().map((v) => ({ videoId: v.id, publishedAt: v.publishedAt })); },
    videos: async () => { calls.videos++; return x.videos || videos(); },
    topComments: async (id) => {
      calls.topComments.push(id);
      if (x.stopAtComments) throw Object.assign(new Error('quota used up: resumes after 7pm Sydney (midnight Pacific)'), { name: 'ApiStop', reason: 'quota' });
      return { disabled: false, comments: [{ text: 'Loved the roof part', likes: 9, publishedAt: day(3) }], ownerReplies: [] };
    },
  };
}

test('a folder name is plain and short, whatever the name holds', () => {
  assert.equal(slug('@Pine & Plank!'), 'pine-plank');
  assert.equal(slug('  Maya Example / Acme Garden  '), 'maya-example-acme-garden');
});

test('the identity gate: an exact handle from Leif, the sheet email, its domain, or niche plus country; a name alone is nobody', () => {
  const vs = videos();
  assert.equal(identity(channel(), { given: true }, vs).matched, 'handle');
  assert.equal(identity(channel(), { email: 'Hello@PineAndPlank.example' }, vs).matched, 'email');
  assert.equal(identity(channel({ description: 'Shop: www.pineandplank.example/shop' }), { domain: 'pineandplank.example' }, vs).matched, 'domain');
  assert.equal(identity(channel({ description: 'Sheds.' }), { niche: ['shed', 'build'], country: 'Australia' }, vs).matched, 'niche+country');
  assert.equal(identity(channel({ description: 'Sheds.' }), { niche: ['shed', 'build'], country: 'Canada' }, vs).matched, '');
  // Built at run time: the privacy gate reads this file too, and a webmail address written out would look real to it.
  const webmail = ['someone', 'gmail.com'].join('@');
  assert.equal(identity(channel({ description: `Sheds. ${webmail.split('@')[1]}` }), { email: webmail }, vs).matched, '', 'a webmail domain proves nothing');
  assert.equal(identity(channel({ description: 'Sheds.' }), {}, vs).matched, '');
});

test('a channel found by name that someone else manages is the wrong person; a handle Leif gave is flagged, not refused', () => {
  const managed = channel({ description: 'Managed by Big Agency.\nhello@pineandplank.example' });
  const byName = identity(managed, { email: 'hello@pineandplank.example' }, videos());
  assert.equal(byName.matched, '');
  assert.match(byName.why, /managed/);
  const given = identity(managed, { given: true }, videos());
  assert.equal(given.matched, 'handle');
  assert.equal(given.managed, true);
});

test('a creator run writes the evidence and the brief input outside the repo, and adds the names to the private terms list', async () => {
  const out = scratch();
  const termsFile = join(out, 'terms.txt');
  const api = fakeApi();
  const r = await creatorRun({ ref: { handle: 'pineandplank' }, expected: { given: true }, today: TODAY, now: NOW, api, out, termsFile });
  assert.equal(r.ok, true);
  const pack = JSON.parse(readFileSync(join(r.dir, 'evidence.json'), 'utf8'));
  assert.equal(pack.who.handle, '@pineandplank');
  assert.equal(pack.identity, 'handle');
  assert.equal(pack.fetchedAt, NOW);
  assert.equal(pack.refreshBy, '2026-12-16');
  assert.equal(pack.stats.typical, 6500);
  assert.match(readFileSync(join(r.dir, 'brief-input.md'), 'utf8'), /\[t:vid00000001\]/);
  assert.equal(api.calls.topComments.length, 6, 'comments are read for the newest five long videos and the best one, no more');
  const terms = readFileSync(termsFile, 'utf8').split('\n').filter(Boolean);
  assert.ok(terms.includes('pineandplank') && terms.includes('Pine and Plank') && terms.includes('Acme Tools'));
  await assert.rejects(creatorRun({ ref: { handle: 'pineandplank' }, expected: { given: true }, today: TODAY, now: NOW, api, out: join(here, 'x'), termsFile }), /inside the repository/i);
});

test('no match, no card: nothing is written for a channel that fails the identity gate, or that does not exist', async () => {
  const out = scratch();
  const r = await creatorRun({ ref: { handle: 'pineandplank' }, expected: { email: 'other@elsewhere.example' }, today: TODAY, now: NOW, api: fakeApi(), out, termsFile: join(out, 'terms.txt') });
  assert.equal(r.ok, false);
  assert.match(r.why, /could not be matched/);
  assert.deepEqual(readdirSync(out), []);
  const none = await creatorRun({ ref: { handle: 'nobody' }, expected: { given: true }, today: TODAY, now: NOW, api: fakeApi({ channel: null }), out, termsFile: join(out, 'terms.txt') });
  assert.equal(none.ok, false);
  assert.match(none.why, /not found/);
});

test('a quota stop while reading comments keeps what was read, and says the comments were not checked', async () => {
  const out = scratch();
  const r = await creatorRun({ ref: { handle: 'pineandplank' }, expected: { given: true }, today: TODAY, now: NOW, api: fakeApi({ stopAtComments: true }), out, termsFile: join(out, 'terms.txt') });
  assert.equal(r.ok, true);
  const pack = JSON.parse(readFileSync(join(r.dir, 'evidence.json'), 'utf8'));
  assert.equal(pack.summary.fans, 'not checked');
  assert.match(pack.stopped, /quota/);
});

const PASTE = `Feed post number 1
Maya Example
Maya Example
 • 2nd
Head of Influencer Marketing at Acme Garden
3w •

We just launched the balcony potting bench.
Like
Feed post number 2
Maya Example reposted this
Tom Other
1mo •

Hiring a designer.
Like
`;

test("a LinkedIn paste run keeps only her own posts, deletes the pasted file, and adds her name to the private terms list", () => {
  const out = scratch();
  const paste = join(out, 'paste.txt');
  writeFileSync(paste, PASTE);
  const termsFile = join(out, 'terms.txt');
  const r = personRun({ brand: 'Acme Garden', person: 'Maya Example', pasteFile: paste, today: TODAY, now: NOW, out, termsFile });
  assert.equal(r.ok, true);
  assert.equal(r.posts, 1);
  assert.equal(r.dropped.reposted, 1);
  assert.ok(!existsSync(paste), 'the raw paste does not stay on disk');
  const pack = JSON.parse(readFileSync(join(r.dir, 'evidence.json'), 'utf8'));
  assert.deepEqual(pack.who, { kind: 'person', name: 'Maya Example', brand: 'Acme Garden' });
  assert.equal(pack.items.length, 1);
  assert.equal(pack.items[0].source, 'paste');
  assert.ok(!JSON.stringify(pack).includes('Hiring a designer'), 'a repost never reaches the evidence');
  const terms = readFileSync(termsFile, 'utf8');
  assert.ok(terms.includes('Maya Example') && terms.includes('Acme Garden'));
  writeFileSync(paste, PASTE);
  const shot = personRun({ brand: 'Acme Garden', person: 'Maya Example', pasteFile: paste, source: 'screenshot', today: TODAY, now: NOW, out, termsFile });
  assert.equal(JSON.parse(readFileSync(join(shot.dir, 'evidence.json'), 'utf8')).items[0].source, 'screenshot');
});

test('the prune: evidence 30 days old is deleted, 25 days old is listed for a refresh, and a yes outlives its numbers', () => {
  const out = scratch();
  const put = (name, days) => { const d = join(out, 'people', name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'evidence.json'), JSON.stringify({ who: { handle: `@${name}` }, fetchedAt: day(days) })); };
  put('old', 31); put('soon', 26); put('fresh', 3);
  const overridesFile = join(out, 'overrides.json');
  writeFileSync(overridesFile, JSON.stringify({
    'Old Creator': { yesAt: '2026-09-01', measured: { typical: 5000, at: day(31).slice(0, 10) }, latest: { title: 'x' } },
    'Fresh Creator': { measured: { typical: 7000, at: day(29).slice(0, 10) } },
  }));
  const r = prune({ out, today: TODAY, overridesFile });
  assert.deepEqual(r.deleted, ['old']);
  assert.deepEqual(r.refreshSoon, ['soon']);
  assert.ok(!existsSync(join(out, 'people', 'old')));
  assert.ok(existsSync(join(out, 'people', 'soon')) && existsSync(join(out, 'people', 'fresh')));
  const o = JSON.parse(readFileSync(overridesFile, 'utf8'));
  assert.deepEqual(o['Old Creator'], { yesAt: '2026-09-01' }, 'the numbers go, the yes stays');
  assert.equal(o['Fresh Creator'].measured.typical, 7000);
  assert.deepEqual(r.numbersDropped, ['Old Creator']);
});

test('forget removes what the script can reach, and names the copies it cannot', () => {
  const out = scratch();
  const d = join(out, 'people', 'maya-example-acme-garden');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'evidence.json'), '{}');
  const r = forget({ out, name: 'Maya Example / Acme Garden' });
  assert.equal(r.removed, true);
  assert.ok(!existsSync(d));
  const rest = r.alsoClear.join(' ');
  assert.match(rest, /Desk doc/);
  assert.match(rest, /history/);
  assert.match(rest, /chat/);
  assert.equal(forget({ out, name: 'Nobody Here' }).removed, false);
});

// ---- Round 2: brands ----
const brand = (x = {}) => ({ id: 'acmegarden', label: 'Acme Garden', domain: 'acmegarden.example', tier: 'core', ima: null, warmNotes: '', people: [], ...x });

test("a brand's country comes from its domain's ending or its proved channel, and stays unknown otherwise", () => {
  assert.deepEqual(brandCountry(brand({ domain: 'acmegarden.com.au' })), { country: 'AU', from: 'domain' });
  assert.deepEqual(brandCountry(brand({ domain: 'acmegarden.ca' })), { country: 'CA', from: 'domain' });
  assert.deepEqual(brandCountry(brand({ domain: 'acmegarden.com' }), { country: 'US' }, 'domain'), { country: 'US', from: 'channel' });
  assert.deepEqual(brandCountry(brand({ domain: 'acmegarden.com' }), { country: 'US' }, ''), { country: '', from: '' }, 'an unproved channel says nothing');
  assert.deepEqual(brandCountry(brand({ domain: 'acmegarden.com' })), { country: '', from: '' });
});

test("a guessed handle counts as the brand's channel only on a domain or handle match", () => {
  assert.deepEqual(handleGuesses(brand()), ['acmegarden']);
  assert.deepEqual(handleGuesses(brand({ label: 'Acme', domain: 'acmegarden.example' })), ['acmegarden', 'acme']);
  assert.equal(channelMatch({ handle: '@whatever', title: 'Acme Garden', description: 'Shop at www.acmegarden.example' }, brand()), 'domain');
  assert.equal(channelMatch({ handle: '@acmegarden', title: 'Acme Garden Official', description: 'Garden things.' }, brand()), 'handle');
  assert.equal(channelMatch({ handle: '@acmegarden', title: 'Some fan channel', description: 'I love gardens.' }, brand()), '', 'the handle alone is somebody else');
  assert.equal(channelMatch(null, brand()), '');
});

test('a video counts as naming the brand only on the whole word plus its domain, its handle or a sponsor line', () => {
  const birch = brand({ id: 'birch', label: 'Birch', domain: 'birchbeds.example' });
  assert.equal(confirmMention({ title: 'Splitting birch logs for winter', description: 'Firewood day.' }, birch).confirmed, false, 'a common word is not the brand');
  assert.equal(confirmMention({ title: 'Our new bed', description: 'Thanks to Birch for sponsoring this video!' }, birch).confirmed, true);
  assert.equal(confirmMention({ title: 'Our new bed', description: 'Thanks to Birch for sponsoring this video!' }, birch).paid, true);
  const featured = confirmMention({ title: 'Trying the Birch mattress', description: 'Found at birchbeds.example', paid: false }, birch);
  assert.deepEqual([featured.confirmed, featured.paid], [true, false], 'named and linked, but nobody said it was paid: "featured"');
  assert.equal(confirmMention({ title: 'Trying the Birch mattress', description: 'Found at birchbeds.example', paid: true }, birch).paid, true, "YouTube's paid flag is proof of a paid deal");
  assert.equal(confirmMention({ title: 'Birchwood cabin tour', description: 'birchbeds.example' }, birch).confirmed, false, 'part of another word is not the name');
});

test('brands already paying creators are read first; warm and held brands are not read at all', () => {
  const list = [brand({ id: 'a', tier: 'other' }), brand({ id: 'b', tier: 'core' }), brand({ id: 'c', tier: 'home', ima: { sponsor: 'Some Creator' } }), brand({ id: 'd', tier: 'warm' }), brand({ id: 'e', tier: 'hold' })];
  assert.deepEqual(doFirst(list).map((b) => b.id), ['c', 'b', 'a']);
});

test('a brand run keeps its own uploads only from a proved channel, and creator videos only when they really name it', async () => {
  const out = scratch();
  const termsFile = join(out, 'terms.txt');
  const own = { id: 'UCbrandbrandbrandbrandbr', handle: '@acmegarden', title: 'Acme Garden', description: 'acmegarden.example', country: 'AU', uploads: 'UUbrand' };
  const api = {
    channel: async () => own,
    uploads: async () => [{ videoId: 'own00000001', publishedAt: day(4) }],
    videos: async (ids) => ids.map((id) => ({
      own00000001: video(1, { id, title: 'The new balcony potting bench', description: 'Out now.', channelId: own.id, publishedAt: day(4) }),
      cre00000001: video(2, { id, title: 'Small balcony makeover', description: 'This video is sponsored by Acme Garden!', channelId: 'UCcreator1' }),
      cre00000002: video(3, { id, title: 'My acme of gardening', description: 'Nothing to do with them.', channelId: 'UCcreator2' }),
    }[id])),
    searchMentions: async () => [
      { videoId: 'cre00000001', channelId: 'UCcreator1', channelTitle: 'Balcony Bea', title: 'Small balcony…', snippet: '', publishedAt: day(20) },
      { videoId: 'cre00000002', channelId: 'UCcreator2', channelTitle: 'Someone Else', title: 'My acme…', snippet: '', publishedAt: day(30) },
      { videoId: 'own00000001', channelId: own.id, channelTitle: 'Acme Garden', title: 'The new…', snippet: '', publishedAt: day(4) },
    ],
  };
  const r = await brandRun({ brand: brand({ ima: { sponsor: 'Balcony Bea', notes: '' } }), today: TODAY, now: NOW, api, out, termsFile });
  const pack = JSON.parse(readFileSync(join(r.dir, 'evidence.json'), 'utf8'));
  assert.equal(pack.who.kind, 'brand');
  assert.equal(pack.who.matched, 'domain');
  assert.deepEqual([pack.who.country, pack.who.countryFrom], ['AU', 'channel']);
  assert.deepEqual(pack.items.map((i) => i.id), ['t:own00000001', 'm:cre00000001', 'sheet:sponsor']);
  const m = pack.items[1];
  assert.deepEqual([m.confirmed, m.paid, m.by, m.text], [true, true, 'Balcony Bea', 'Small balcony makeover'], 'the exact title comes from the video itself, not the search result');
  assert.match(pack.summary.mentions, /1 creator video named the brand \(1 paid\) · 1 search results did not/);
  assert.ok(r.dir.endsWith(join('brands', 'acmegarden')));
  assert.ok(readFileSync(termsFile, 'utf8').includes('Balcony Bea'));
  const stranger = { ...api, channel: async () => ({ ...own, description: 'A fan channel', title: 'Fans of gardens' }) };
  const r2 = await brandRun({ brand: brand(), today: TODAY, now: NOW, api: stranger, out, termsFile });
  assert.equal(r2.pack.who.matched, '');
  assert.ok(!r2.pack.items.some((i) => i.kind === 'title'), "an unproved channel's uploads are not the brand's");
  assert.match(r2.pack.rejected[0], /does not name/);
});
