// Measuring through the YouTube Data API, and the tracker's rules, on made-up channels and people. No network: the
// API is a fake fetch, and the command-line runs get theirs from a preloaded file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO_ROOT } from './lib.mjs';
import { measure, recentLong, channelRef, entriesFromVideos, measureAll } from './measure.mjs';
import { ApiStop, videos } from './youtube-api.mjs';
import { validate, parseLog, status } from './tracker.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const TODAY = '2026-11-15';
const NOON = new Date('2026-11-15T20:00:00Z'); // midday on 15 Nov in California
const JAY = 'UC' + 'jay'.padEnd(22, '0');
const KIT = 'UC' + 'kit'.padEnd(22, '0');
// One scratch folder for the measuring tests, outside the repository, removed when the tests end.
const SCRATCH = mkdtempSync(join(tmpdir(), 'agency-measure-'));
process.on('exit', () => rmSync(SCRATCH, { recursive: true, force: true }));
const tmp = () => mkdtempSync(join(SCRATCH, 't-'));
// A path inside the repository, where nothing may ever be written. If a guard breaks, the test still removes it.
const inRepo = (t, name) => { const p = join(REPO_ROOT, name); t.after(() => rmSync(p, { force: true })); return p; };

// A video as youtube-api.mjs hands it over.
const vid = (id, publishedAt, views, durationSec = 845, live = false) => ({ id, title: `Video ${id}`, publishedAt, durationSec, views, live });

// One videos.list item as the API sends it: counts as strings, the date exact to the second, the length in ISO 8601.
const item = (id, publishedAt, views, { duration = 'PT14M5S', live = 'none' } = {}) => ({
  id,
  snippet: { publishedAt, title: `Video ${id}`, description: '', liveBroadcastContent: live },
  contentDetails: { duration },
  statistics: { viewCount: String(views), likeCount: '10', commentCount: '2' },
  paidProductPlacementDetails: { hasPaidProductPlacement: false },
});
// Eight long videos, one a day from 1 October, with 1,000 to 8,000 views.
const eight = (who) => Array.from({ length: 8 }, (_, i) => item(`${who}0000000${i}`, `2026-10-0${i + 1}T09:00:00Z`, (i + 1) * 1000));
const uploadsOf = (c) => c.id.replace(/^UC/, 'UU');
const answersFor = (c) => ({
  channels: { items: [{ id: c.id, snippet: { title: c.title, customUrl: `@${c.handle.toLowerCase()}`, country: c.country }, contentDetails: { relatedPlaylists: { uploads: uploadsOf(c) } }, statistics: { subscriberCount: '12300', videoCount: String(c.items.length) } }] },
  playlistItems: { items: c.items.map((v) => ({ contentDetails: { videoId: v.id, videoPublishedAt: v.snippet.publishedAt } })) },
  videos: { items: c.items },
});
const quotaUsedUp = { error: { code: 403, message: 'RAW-ANSWER-7731', errors: [{ reason: 'quotaExceeded' }] } };

// A fake YouTube Data API for a few made-up channels. From request number `stopAt` on, it answers "quota used up".
function fakeApi(channels, { stopAt = Infinity } = {}) {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    const params = Object.fromEntries(u.searchParams);
    const resource = u.pathname.split('/').pop();
    calls.push({ resource, params });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (calls.length >= stopAt) return reply(quotaUsedUp, 403);
    if (resource === 'channels') {
      const c = channels.find((x) => x.id === params.id || `@${x.handle}` === params.forHandle);
      return reply(c ? answersFor(c).channels : {});
    }
    if (resource === 'playlistItems') return reply(answersFor(channels.find((x) => uploadsOf(x) === params.playlistId)).playlistItems);
    if (resource === 'videos') return reply({ items: channels.flatMap((c) => c.items).filter((v) => params.id.split(',').includes(v.id)) });
    throw new Error(`the fake has no answer for ${resource}`);
  };
  return { fetch, calls };
}

test('measures from API fixtures with exact dates and leaves out a 45-second Short', async () => {
  const items = [
    item('long0000001', '2026-11-14T22:15:00Z', 50000), // a day old: the newest, and still climbing
    item('long0000002', '2026-11-08T00:00:01Z', 72000), // one second short of 7 days
    item('long0000003', '2026-11-08T00:00:00Z', 105000), // 7 days to the second
    item('long0000004', '2026-10-25T09:30:00Z', 75000),
    item('long0000005', '2026-10-18T09:30:00Z', 89000),
    item('long0000006', '2026-10-11T09:30:00Z', 84000),
    item('long0000007', '2026-10-04T09:30:00Z', 88000),
    item('long0000008', '2026-09-27T09:30:00Z', 60000, { duration: 'PT3M1S' }), // 181 seconds: a long video
    item('short000001', '2026-10-20T10:00:00Z', 900000, { duration: 'PT45S' }), // a Short
    item('short000002', '2026-10-21T10:00:00Z', 800000, { duration: 'PT2M30S' }), // 150 seconds: may be a Short
    item('short000003', '2026-10-22T10:00:00Z', 700000, { duration: 'PT3M' }), // 180 seconds: still may be one
    item('live0000001', '2026-11-14T23:00:00Z', 600000, { duration: 'P0D', live: 'live' }),
    item('soon0000001', '2026-11-14T23:30:00Z', 500000, { duration: 'PT20M', live: 'upcoming' }),
  ];
  const api = fakeApi([{ id: JAY, handle: 'JaySample', title: 'Jay Sample Builds', items }]);
  const entries = entriesFromVideos(await videos(items.map((v) => v.id), { fetch: api.fetch, ledger: join(tmp(), 'ledger.json'), now: () => NOON }));
  assert.equal(entries.length, 11, 'the live video and the one still to come are left out entirely');
  assert.deepEqual(entries[1], { link: 'https://www.youtube.com/watch?v=long0000002', published: '2026-11-08T00:00:01Z', views: 72000, title: 'Video long0000002', short: false });
  assert.deepEqual(entries.filter((e) => e.short).map((e) => e.link.slice(-11)), ['short000001', 'short000002', 'short000003']);
  const m = measure(entries, TODAY);
  assert.equal(m.ok, true);
  assert.equal(m.measured.n, 6, 'long0000003 to long0000008: 7 days to the second counts, a second less does not');
  assert.deepEqual(recentLong(entries, TODAY).map((e) => e.link.slice(-11)), ['long0000003', 'long0000004', 'long0000005', 'long0000006', 'long0000007', 'long0000008']);
  assert.equal(m.measured.typical, 86000);
  assert.equal(m.measured.best, 105000, 'no Short is the best video, however many views it has');
  assert.equal(m.measured.method, 'YouTube Data API: median of the last 6 long videos, each at least 7 days old');
  assert.deepEqual(m.latest, { title: 'Video long0000001', link: 'https://www.youtube.com/watch?v=long0000001', published: '2026-11-14' });
});

test('the typical video is the median of recent long videos: Shorts, fresh uploads and a viral hit cannot move it much', () => {
  const long = [5, 6, 4, 7, 5, 6, 8, 5, 6, 400, 5].map((k, i) => vid(`v${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00Z`, k * 1000));
  const m = measure(entriesFromVideos([...long, vid('s1', '2026-10-20T08:00:00Z', 900000, 58), vid('new', '2026-11-07T08:00:00Z', 50)]), '2026-11-09');
  assert.equal(m.ok, true);
  assert.equal(m.measured.n, 11, 'the Short and the 2-day-old upload are left out');
  assert.equal(m.measured.typical, 6000);
  assert.equal(m.measured.best, 400000);
  assert.equal(m.measured.at, '2026-11-09');
});

test('recentLong hands back the very videos the median was taken from, newest first, so other sums use the same ones', () => {
  const fourteen = Array.from({ length: 14 }, (_, i) => vid(`v${i}`, `2026-10-${String(i + 1).padStart(2, '0')}T08:00:00Z`, (i + 1) * 100));
  const entries = entriesFromVideos([...fourteen, vid('s1', '2026-10-20T08:00:00Z', 900000, 58), vid('new', '2026-11-07T08:00:00Z', 50)]);
  const ids = (list) => list.map((e) => e.link.split('=')[1]);
  const used = recentLong(entries, '2026-11-09');
  assert.deepEqual(ids(used), ['v13', 'v12', 'v11', 'v10', 'v9', 'v8', 'v7', 'v6', 'v5', 'v4', 'v3', 'v2'], 'the newest 12 long videos at least 7 days old');
  const m = measure(entries, '2026-11-09');
  assert.deepEqual([m.measured.n, m.measured.best], [12, 1400]);
  assert.deepEqual(ids(recentLong(entries, '2026-11-09', { n: 3, minAgeDays: 30 })), ['v8', 'v7', 'v6']);
  const older = measure(entries, '2026-11-09', { n: 3, minAgeDays: 30, minVideos: 3 }).measured;
  assert.deepEqual([older.n, older.typical, older.method], [3, 800, 'YouTube Data API: median of the last 3 long videos, each at least 30 days old']);
  assert.throws(() => recentLong(entries, 'yesterday'), /today/);
});

test('a channel can be given as an id, a channel link, an @handle or a handle link; anything else is refused', () => {
  const id = 'UC' + 'a1B2c3D4e5F6g7H8i9J0kL';
  assert.deepEqual(channelRef(id), { id });
  assert.deepEqual(channelRef(`https://www.youtube.com/channel/${id}/videos`), { id });
  assert.deepEqual(channelRef('@JaySample'), { handle: 'JaySample' });
  assert.deepEqual(channelRef('https://www.youtube.com/@JaySample/videos'), { handle: 'JaySample' });
  assert.ok(channelRef('Jay Sample').error);
  assert.ok(channelRef('https://video.example/@JaySample').error, 'only youtube.com links');
});

test('too few long videos means no number, never a guess: hidden views and an unknown length do not count', () => {
  const noLength = { id: 'e', title: 'Video e', publishedAt: '2026-10-05T08:00:00Z', views: 4000, live: false };
  const few = [vid('a', '2026-10-01T08:00:00Z', 1000), vid('b', '2026-10-02T08:00:00Z', 2000), vid('c', '2026-10-03T08:00:00Z', null), vid('d', '2026-10-04T08:00:00Z', 3000, null), noLength];
  const m = measure(entriesFromVideos(few), '2026-11-09');
  assert.equal(m.ok, false);
  assert.equal(m.why, 'only 2 long videos at least 7 days old in the last 50 uploads (need 6)');
});

test('each creator is measured through the API and saved as it lands: a number, the newest video and the channel', async () => {
  const dir = tmp();
  const out = join(dir, 'measured.json');
  const api = fakeApi([
    { id: JAY, handle: 'JaySample', title: 'Jay Sample Builds', country: 'AU', items: eight('jay') },
    { id: KIT, handle: 'KitSample', title: 'Kit Sample Cooks', items: eight('kit').slice(0, 2) },
  ]);
  const channels = { 'Jay Sample': '@JaySample', 'Kit Sample': `https://www.youtube.com/channel/${KIT}`, 'Lou Sample': '@LouSample', 'Mo Sample': 'not a channel' };
  const result = await measureAll(channels, TODAY, { out, fetch: api.fetch, ledger: join(dir, 'ledger.json'), now: () => NOON });
  assert.deepEqual(result, {
    'Jay Sample': {
      measured: { n: 8, typical: 4500, best: 8000, at: TODAY, method: 'YouTube Data API: median of the last 8 long videos, each at least 7 days old', fetchedAt: '2026-11-15T20:00:00.000Z' },
      latest: { title: 'Video jay00000007', link: 'https://www.youtube.com/watch?v=jay00000007', published: '2026-10-08' },
      channel: { id: JAY, title: 'Jay Sample Builds', country: 'AU' },
    },
    'Kit Sample': {
      error: 'only 2 long videos at least 7 days old in the last 50 uploads (need 6)',
      latest: { title: 'Video kit00000001', link: 'https://www.youtube.com/watch?v=kit00000001', published: '2026-10-02' },
      channel: { id: KIT, title: 'Kit Sample Cooks', country: null },
    },
    'Lou Sample': { error: 'no channel with this id or handle' },
    'Mo Sample': { error: 'not a channel id, a channel link or an @handle' },
  });
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), result);
  assert.deepEqual(api.calls.map((c) => c.resource), ['channels', 'playlistItems', 'videos', 'channels', 'playlistItems', 'videos', 'channels'], 'three units a creator, one for a channel that is not there, none for a bad name');
  assert.deepEqual(api.calls[1].params, { part: 'contentDetails', playlistId: uploadsOf({ id: JAY }), maxResults: '50' }, 'the last 50 uploads');
});

test('measurements are never saved inside the repository, whoever calls', async (t) => {
  const api = fakeApi([{ id: JAY, handle: 'JaySample', title: 'Jay Sample Builds', items: eight('jay') }]);
  const inside = inRepo(t, 'never-saved-here.json');
  await assert.rejects(measureAll({ 'Jay Sample': '@JaySample' }, TODAY, { out: inside, fetch: api.fetch, ledger: join(tmp(), 'ledger.json'), now: () => NOON }), /refusing to write inside the repository/);
  assert.ok(!existsSync(inside));
  assert.equal(api.calls.length, 0);
});

test('a stop keeps what was saved, and the next launch skips whoever is already measured today', async () => {
  const dir = tmp();
  const out = join(dir, 'measured.json');
  const made = [
    { id: JAY, handle: 'JaySample', title: 'Jay Sample Builds', country: 'AU', items: eight('jay') },
    { id: KIT, handle: 'KitSample', title: 'Kit Sample Cooks', country: 'US', items: eight('kit') },
  ];
  const channels = { 'Jay Sample': '@JaySample', 'Kit Sample': '@KitSample' };
  const ctx = (api) => ({ out, fetch: api.fetch, ledger: join(dir, 'ledger.json'), now: () => NOON });
  const first = fakeApi(made, { stopAt: 5 }); // the allowance runs out on Kit's second request
  await assert.rejects(measureAll(channels, TODAY, ctx(first)), (e) => e instanceof ApiStop && e.reason === 'quota');
  const partial = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(partial), ['Jay Sample'], 'Jay is saved; Kit, cut off half way, is not there at all');
  assert.equal(partial['Jay Sample'].measured.typical, 4500);

  const second = fakeApi(made); // a resume is just a fresh launch
  const done = await measureAll(channels, TODAY, ctx(second));
  assert.deepEqual(second.calls.map((c) => c.params.forHandle || c.resource), ['@KitSample', 'playlistItems', 'videos'], 'nothing is asked about Jay again');
  assert.deepEqual(done['Jay Sample'], partial['Jay Sample']);
  assert.equal(done['Kit Sample'].measured.at, TODAY);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), done);

  const nextDay = fakeApi(made);
  await measureAll(channels, '2026-11-16', { ...ctx(nextDay), now: () => new Date('2026-11-16T20:00:00Z') });
  assert.equal(nextDay.calls.length, 6, "yesterday's measurement is taken again");
});

test('one creator the API refuses is an error on that creator, and the run goes on', async () => {
  const dir = tmp();
  const api = fakeApi([{ id: KIT, handle: 'KitSample', title: 'Kit Sample Cooks', items: eight('kit') }]);
  const fetch = (url) => (url.includes('JaySample') ? new Response(JSON.stringify({ error: { code: 403, message: 'made-up', errors: [{ reason: 'forbidden' }] } }), { status: 403 }) : api.fetch(url));
  const result = await measureAll({ 'Jay Sample': '@JaySample', 'Kit Sample': '@KitSample' }, TODAY, { out: join(dir, 'measured.json'), fetch, ledger: join(dir, 'ledger.json'), now: () => NOON });
  assert.deepEqual(result['Jay Sample'], { error: "could not measure: YouTube's API answered 403 (forbidden)" });
  assert.equal(result['Kit Sample'].measured.n, 8);
});

// The CLI runs in its own process, so its fetch comes from a preloaded file: still no network. The file answers by
// API resource for one made-up channel and, from request number `stopAt` on, says the quota is used up.
function cli(dir, argv, { stopAt = 1e9 } = {}) {
  const answers = { ...answersFor({ id: JAY, handle: 'JaySample', title: 'Jay Sample Builds', country: 'AU', items: eight('jay') }), quota: quotaUsedUp };
  const pre = join(dir, 'fake-fetch.mjs');
  writeFileSync(pre, `const answers = ${JSON.stringify(answers)};
let n = 0;
globalThis.fetch = async (url) => {
  n += 1;
  if (n >= ${stopAt}) return new Response(JSON.stringify(answers.quota), { status: 403 });
  return new Response(JSON.stringify(answers[new URL(url).pathname.split('/').pop()]), { status: 200 });
};
`);
  return spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, join(here, 'measure.mjs'), ...argv], { encoding: 'utf8', timeout: 60_000 });
}

test('the measurer refuses to write its measurements or its ledger inside the repository, and to run half told', (t) => {
  const dir = tmp();
  const ch = join(dir, 'channels.json'); writeFileSync(ch, JSON.stringify({ Jay: 'not-an-id' }));
  const run = (today, out, ledger) => cli(dir, ['--channels', ch, '--today', today, '--out', out, ...(ledger ? ['--ledger', ledger] : [])]);
  const inside = [inRepo(t, 'never-saved-here-2.json'), inRepo(t, 'never-counted-here-4.json')];
  for (const [out, ledger] of [[inside[0], join(dir, 'ledger.json')], [join(dir, 'm.json'), inside[1]]]) {
    const r = run('2026-11-09', out, ledger);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing to write inside the repository/);
  }
  assert.ok(!existsSync(inside[0]) && !existsSync(inside[1]));
  for (const r of [run('2026-11-09', join(dir, 'm.json')), run('9 Nov', join(dir, 'm.json'), join(dir, 'ledger.json'))]) {
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^usage: measure\.mjs .*--ledger/);
  }
  writeFileSync(join(dir, 'damaged.json'), 'not a ledger');
  const damaged = run('2026-11-09', join(dir, 'm.json'), join(dir, 'damaged.json'));
  assert.equal(damaged.status, 2);
  assert.match(damaged.stderr, /cannot be read/);
  assert.ok(!existsSync(join(dir, 'm.json')), 'nothing is written about any creator');
});

test('the measurer CLI says how many it measured through the API, and a second launch the same day spends nothing', () => {
  const dir = tmp();
  const ch = join(dir, 'channels.json'); writeFileSync(ch, JSON.stringify({ 'Jay Sample': '@JaySample' }));
  const argv = ['--channels', ch, '--today', TODAY, '--out', join(dir, 'measured.json'), '--ledger', join(dir, 'ledger.json')];
  const units = () => Object.values(JSON.parse(readFileSync(join(dir, 'ledger.json'), 'utf8')));
  for (let launch = 1; launch <= 2; launch++) {
    const r = cli(dir, argv);
    assert.deepEqual([r.status, r.stderr], [0, '']);
    assert.match(r.stdout, /^measured 1 of 1 creators \(YouTube Data API\)/);
    assert.deepEqual(units(), [{ units: 3, searches: 0 }], `launch ${launch}`);
  }
  assert.equal(JSON.parse(readFileSync(join(dir, 'measured.json'), 'utf8'))['Jay Sample'].measured.typical, 4500);
});

test('the measurer CLI stops on a used-up day: the plain reason, exit 3, and what was measured is kept', () => {
  const dir = tmp();
  const ch = join(dir, 'channels.json'); writeFileSync(ch, JSON.stringify({ 'Jay Sample': '@JaySample', 'Kit Sample': '@KitSample' }));
  const out = join(dir, 'measured.json');
  const r = cli(dir, ['--channels', ch, '--today', TODAY, '--out', out, '--ledger', join(dir, 'ledger.json')], { stopAt: 4 });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /today's YouTube allowance is used up: it resumes after 7pm Sydney \(midnight Pacific\)/);
  assert.ok(!(r.stdout + r.stderr).includes('RAW-ANSWER-7731'), 'never the raw answer');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(out, 'utf8'))), ['Jay Sample']);
});

const ev = (key, event, at, extra = {}) => ({ key, event, at, ...extra });

test('the tracker refuses unknown events, bad dates and promises without a due date', () => {
  assert.throws(() => validate(ev('Acme | Ava Sample', 'blast', '2026-11-09')), /event must be/);
  assert.throws(() => validate(ev('Acme | Ava Sample', 'dm', '9 Nov')), /date/);
  assert.throws(() => validate(ev('Acme | Ava Sample', 'promise', '2026-11-09', { note: 'send names' })), /due/);
  assert.throws(() => validate(ev('Ava Sample', 'dm', '2026-11-09')), /Brand \| Name/);
  assert.throws(() => parseLog('{"key":"Acme | Ava Sample","event":"dm","at":"2026-11-09"}\nnot json'), /log line 2/);
});

test('an overdue promise, a stop and a consent are all visible; one follow-up after 7 days, and only once', () => {
  const log = [
    ev('Acme | Ava Sample', 'dm', '2026-10-30'),
    ev('Acme | Ben Sample', 'dm', '2026-10-30'), ev('Acme | Ben Sample', 'stop', '2026-10-31'),
    ev('Gizmo | Cal Sample', 'dm', '2026-11-05'),
    ev('Gizmo | Dee Sample', 'dm', '2026-10-20'), ev('Gizmo | Dee Sample', 'dm', '2026-10-28'),
    ev('Bigco | Eve Sample', 'yes', '2026-11-01'), ev('Bigco | Eve Sample', 'promise', '2026-11-01', { note: 'send two names', due: '2026-11-05' }),
    ev('Bigco | Fay Sample', 'promise', '2026-11-01', { note: 'one-pager', due: '2026-11-04' }), ev('Bigco | Fay Sample', 'done', '2026-11-03', { note: 'one-pager' }),
  ].map(validate);
  const s = status(log, '2026-11-09');
  assert.deepEqual(s.followUp, ['Acme | Ava Sample'], 'Ben said stop, Cal is not due yet, Dee already had her follow-up');
  assert.deepEqual(s.stopped, ['Acme | Ben Sample']);
  assert.deepEqual(s.consented, ['Bigco | Eve Sample']);
  assert.deepEqual(s.overdue.map((x) => x.key), ['Bigco | Eve Sample'], "Fay's promise was kept");
});

test('a stop is final, and "done" closes only the promise it names', () => {
  const log = [
    ev('Acme | Ava Sample', 'stop', '2026-11-01'), ev('Acme | Ava Sample', 'yes', '2026-11-02'),
    ev('Bigco | Eve Sample', 'promise', '2026-11-01', { note: 'one', due: '2026-11-05' }),
    ev('Bigco | Eve Sample', 'promise', '2026-11-01', { note: 'two', due: '2026-12-01' }),
    ev('Bigco | Eve Sample', 'done', '2026-11-03', { note: 'two' }),
    ev('Bigco | Eve Sample', 'done', '2026-11-04', { note: 'something else' }),
  ].map(validate);
  const s = status(log, '2026-11-09');
  assert.deepEqual(s.consented, [], 'a yes after a stop does not bring consent back');
  assert.deepEqual(s.overdue.map((x) => x.note), ['one'], 'finishing promise two never erases the overdue promise one');
  assert.throws(() => validate(ev('Bigco | Eve Sample', 'done', '2026-11-04')), /done needs --note/);
});

test('the tracker CLI appends, never edits, and will not add to someone who said stop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-track-'));
  const log = join(dir, 'events.jsonl');
  const run = (...x) => execFileSync(process.execPath, [join(here, 'tracker.mjs'), ...x, '--log', log], { stdio: 'pipe' }).toString();
  run('add', '--key', 'Acme | Ava Sample', '--event', 'dm', '--at', '2026-11-01');
  run('add', '--key', 'Acme | Ava Sample', '--event', 'stop', '--at', '2026-11-02');
  let code = 0;
  try { run('add', '--key', 'Acme | Ava Sample', '--event', 'dm', '--at', '2026-11-03'); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
  assert.match(run('status', '--today', '2026-11-09'), /stopped 1/);
  code = 0;
  try { execFileSync(process.execPath, [join(here, 'tracker.mjs'), 'status', '--today', '2026-11-09', '--log', join(REPO_ROOT, 'events.jsonl')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2, 'the log never lives in the repository');
});
