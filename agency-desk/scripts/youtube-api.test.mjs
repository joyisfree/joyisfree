// The only door to YouTube, on made-up channels, videos and viewers. No network anywhere: every call goes to a fake
// fetch, and the command-line runs get theirs from a preloaded file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO_ROOT } from './lib.mjs';
import {
  BASE, LIMITS, ApiStop, apiUrl, apiGet, pacificDay, createLedger, durationSec, channel, uploads, videos, topComments,
  searchMentions, nextChunk,
} from './youtube-api.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const NOON = new Date('2026-11-15T20:00:00Z'); // midday on 15 Nov in California
const TODAY = '2026-11-15';
const CH = 'UC' + 'a1B2c3D4e5F6g7H8i9J0kL';
const UPLOADS = 'UU' + 'a1B2c3D4e5F6g7H8i9J0kL';
const RAW = 'RAW-ANSWER-7731'; // rides in every fake error: no stop may ever repeat it

const tmp = () => mkdtempSync(join(tmpdir(), 'agency-yt-'));
// A path inside the repository, where nothing may ever be written. If a guard breaks, the test still removes it.
const inRepo = (t, name) => { const p = join(REPO_ROOT, name); t.after(() => rmSync(p, { force: true })); return p; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const apiError = (code, reason, message = RAW) => json({ error: { code, message, errors: [{ reason, message }] } }, code);

// A fake fetch: it answers from a table keyed by the API resource and keeps every request it was given.
function fake(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    const call = { url, init, resource: u.pathname.split('/').pop(), params: Object.fromEntries(u.searchParams) };
    calls.push(call);
    const route = routes[call.resource] ?? routes['*'];
    if (!route) throw new Error(`the fake has no answer for ${call.resource}`);
    const answer = route(call.params, calls.length);
    return answer instanceof Response ? answer : json(answer);
  };
  return { fetch, calls };
}
const ctx = (f, more = {}) => ({ fetch: f.fetch, ledger: join(tmp(), 'ledger.json'), now: () => NOON, retryMs: 0, ...more });
const ledgerOf = (c) => JSON.parse(readFileSync(c.ledger, 'utf8'));
const stop = (reason, says = /./) => (e) => {
  assert.ok(e instanceof ApiStop, `expected an ApiStop, got ${e?.name}: ${e?.message}`);
  assert.equal(e.reason, reason);
  assert.match(e.message, says);
  assert.ok(!e.message.includes(RAW), 'a stop is written in plain words, never the raw answer');
  return true;
};

test('a link is built under the one base, and a param with no value is refused', () => {
  assert.equal(BASE, 'https://www.googleapis.com/youtube/v3/');
  assert.equal(apiUrl('videos', { part: 'snippet,statistics', id: 'aaaaaaaaaa1,aaaaaaaaaa2' }), `${BASE}videos?part=snippet%2Cstatistics&id=aaaaaaaaaa1%2Caaaaaaaaaa2`);
  assert.equal(apiUrl('i18nRegions'), `${BASE}i18nRegions`);
  for (const empty of [undefined, null, '']) {
    assert.throws(() => apiUrl('videos', { part: 'snippet', id: empty }), /"id" has no value/, 'a call without its id is a wasted unit');
  }
});

test('a key never rides in a link: a key param and a key-shaped value both throw', () => {
  for (const name of ['key', 'KEY', 'Key', 'api_key', 'API_KEY', 'access_token', 'Access_Token']) {
    assert.throws(() => apiUrl('videos', { part: 'snippet', [name]: 'made-up' }), /never goes in a link/, name);
  }
  const keyLike = `AIza${'Sy'.padEnd(35, 'x')}`; // the shape only, built here so no key-shaped text sits in the repo
  for (const params of [{ q: keyLike }, { q: `acme garden ${keyLike} bench` }, { [keyLike]: 'x' }]) {
    assert.throws(() => apiUrl('search', params), (e) => /looks like a Google key/.test(e.message) && !e.message.includes(keyLike));
  }
  assert.throws(() => apiUrl(keyLike), /looks like a Google key/, 'not as the resource name either');
  assert.ok(apiUrl('search', { q: `AIza${'x'.repeat(29)}` }), 'a shorter run of letters is not a key');
});

test('another host is impossible: the path is one resource name and nothing else', () => {
  const hostile = [
    'https://example.com/x', '//example.com/x', '/youtube/v3/videos', '../../oauth2/v1/tokeninfo', 'videos/../../../upload',
    'videos/', 'videos?part=id', 'videos#x', '\\\\example.com\\x', '@example.com', 'x:y', 'videos\n', ' videos', '',
    undefined, null, 42, ['videos'], { toString: () => 'videos' },
  ];
  for (const path of hostile) assert.throws(() => apiUrl(path, { part: 'id' }), /one YouTube Data API resource name/, String(path));
  for (const path of ['channels', 'playlistItems', 'videos', 'commentThreads', 'search', 'i18nRegions']) {
    const u = new URL(apiUrl(path, { part: 'id' }));
    assert.deepEqual([u.origin, u.pathname, u.username, u.password], ['https://www.googleapis.com', `/youtube/v3/${path}`, '', '']);
  }
});

test('no request ever carries a credential: no header at all, only a deadline and the no-redirect rule', async () => {
  const f = fake({ '*': () => ({ items: [] }) });
  const c = ctx(f);
  await apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, c);
  await channel({ handle: 'JaySample' }, c);
  await uploads(UPLOADS, {}, c);
  await videos(['aaaaaaaaaa1'], c);
  await topComments('aaaaaaaaaa1', {}, c);
  await searchMentions('Acme Garden', {}, c);
  assert.equal(f.calls.length, 6, 'the plain call and each of the five readers made one request');
  for (const { url, init } of f.calls) {
    assert.equal(typeof url, 'string', 'a plain link, never a Request that could carry headers');
    assert.ok(url.startsWith(BASE), url);
    assert.doesNotMatch(url, /[?&](key|api_key|access_token)=/i);
    assert.deepEqual(Object.keys(init).sort(), ['redirect', 'signal'], 'no headers, no method, no body: the proxy adds the key by itself');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test('every request has a 15-second deadline, and no answer by then is a network stop', async () => {
  const asked = [];
  const real = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => { asked.push(ms); return real.call(AbortSignal, ms); };
  try {
    await apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, ctx(fake({ videos: () => ({ items: [] }) })));
  } finally { AbortSignal.timeout = real; }
  assert.deepEqual(asked, [15_000]);
  // A request that never answers. A real one holds a socket open, which keeps the process alive; so does this timer.
  const hang = (url, { signal }) => new Promise((_, reject) => {
    const socket = setInterval(() => {}, 1_000);
    signal.addEventListener('abort', () => { clearInterval(socket); reject(signal.reason); });
  });
  const c = ctx({ fetch: hang }, { timeoutMs: 30 });
  const t0 = Date.now();
  await assert.rejects(apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, c), stop('network', /no answer in 0\.03 seconds/));
  assert.ok(Date.now() - t0 < 5_000, 'must not wait forever');
  assert.ok(!existsSync(c.ledger), 'nothing was read, so nothing is counted');
});

test('a 302 is a redirect stop: it is never followed, whatever it points to', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const f = fake({ videos: () => new Response(null, { status, headers: { location: 'https://www.youtube.com/watch?v=aaaaaaaaaa1' } }) });
    const c = ctx(f);
    await assert.rejects(apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, c), stop('redirect', new RegExp(`never followed.*status ${status}`)));
    assert.equal(f.calls.length, 1, 'one request, and no second one to the new place');
    assert.equal(f.calls[0].init.redirect, 'manual', 'fetch itself is told not to follow');
    assert.ok(!existsSync(c.ledger));
  }
});

test('a missing or refused key is a key-missing stop: it says where the key is saved, never what it is', async () => {
  const answers = [
    () => apiError(401, 'required', `Login Required. ${RAW}`),
    () => apiError(403, 'forbidden', `Method doesn't allow unregistered callers (callers without established identity). ${RAW}`),
    () => apiError(400, 'badRequest', `API key not valid. Please pass a valid API key. ${RAW}`),
    () => json({ error: { code: 400, message: `API key expired. ${RAW}`, details: [{ reason: 'API_KEY_INVALID' }] } }, 400),
    () => json({ error: { code: 403, message: `Requests to this API are blocked. ${RAW}`, status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }] } }, 403),
  ];
  for (const answer of answers) {
    const c = ctx(fake({ channels: answer }));
    await assert.rejects(channel({ handle: 'JaySample' }, c), stop('key-missing', /network secret for www\.googleapis\.com/));
    assert.ok(!existsSync(c.ledger));
  }
});

test('the API switched off is an api-not-enabled stop that says what to turn on', async () => {
  const answers = [
    () => apiError(403, 'accessNotConfigured', `YouTube Data API v3 has not been used in project 000 before or it is disabled. ${RAW}`),
    () => json({ error: { code: 403, message: RAW, status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }, 403),
  ];
  for (const answer of answers) {
    const c = ctx(fake({ channels: answer }));
    await assert.rejects(channel({ handle: 'JaySample' }, c), stop('api-not-enabled', /turn on YouTube Data API v3 for the key's project/));
    assert.ok(!existsSync(c.ledger));
  }
});

test('a used-up day is a quota stop: it says when the day resumes and leaves the ledger file as it was', async () => {
  for (const reason of ['quotaExceeded', 'dailyLimitExceeded']) {
    const c = ctx(fake({ search: () => apiError(403, reason, `The request cannot be completed because you have exceeded your quota. ${RAW}`) }));
    const before = `${JSON.stringify({ [TODAY]: { units: 4321, searches: 7 } }, null, 2)}\n`;
    writeFileSync(c.ledger, before);
    await assert.rejects(searchMentions('Acme Garden', {}, c), stop('quota', /resumes after 7pm Sydney \(midnight Pacific\)/));
    assert.equal(readFileSync(c.ledger, 'utf8'), before);
  }
});

test('too many requests at once is a rate stop', async () => {
  const answers = [
    () => apiError(403, 'rateLimitExceeded'), () => apiError(403, 'userRateLimitExceeded'), () => apiError(429, 'rateLimitExceeded'),
    () => new Response(`Too Many Requests ${RAW}`, { status: 429 }),
  ];
  for (const answer of answers) {
    const c = ctx(fake({ videos: answer }));
    await assert.rejects(videos(['aaaaaaaaaa1'], c), stop('rate', /wait a minute/));
    assert.ok(!existsSync(c.ledger));
  }
});

test('a fetch that throws is a network stop that says what to check', async () => {
  const refused = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }) }); };
  const c = ctx({ fetch: refused });
  await assert.rejects(apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, c), stop('network', /could not reach www\.googleapis\.com.*NODE_USE_ENV_PROXY=1.*ECONNREFUSED/));
  assert.ok(!existsSync(c.ledger));
});

test('a 5xx is tried once more: twice is a server stop, and a blip is forgiven and counted once', async () => {
  const down = fake({ videos: () => new Response(`Service Unavailable ${RAW}`, { status: 503 }) });
  const c = ctx(down);
  await assert.rejects(videos(['aaaaaaaaaa1'], c), stop('server', /status 503/));
  assert.equal(down.calls.length, 2, 'one retry and no more');
  assert.ok(!existsSync(c.ledger));
  const blip = fake({ videos: (p, n) => (n === 1 ? new Response('Bad Gateway', { status: 502 }) : { items: [] }) });
  const c2 = ctx(blip);
  assert.deepEqual(await apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, c2), { items: [] });
  assert.equal(blip.calls.length, 2);
  assert.deepEqual(ledgerOf(c2), { [TODAY]: { units: 1, searches: 0 } });
});

test('a 404, comments switched off and any other refusal are answers, not stops, and each still costs its unit', async () => {
  const f = fake({
    playlistItems: () => apiError(404, 'playlistNotFound'), commentThreads: () => apiError(403, 'commentsDisabled'),
    videos: () => apiError(403, 'forbidden'), channels: () => new Response('<html>not the API</html>', { status: 200 }),
  });
  const c = ctx(f);
  for (const [path, status, reason] of [['playlistItems', 404, 'playlistNotFound'], ['commentThreads', 403, 'commentsDisabled'], ['videos', 403, 'forbidden']]) {
    await assert.rejects(apiGet(path, { part: 'id' }, c), (e) => {
      assert.ok(!(e instanceof ApiStop), 'the run goes on to the next creator');
      assert.deepEqual([e.status, e.reason], [status, reason]);
      assert.equal(e.message, `YouTube's API answered ${status} (${reason})`);
      return true;
    });
  }
  await assert.rejects(apiGet('channels', { part: 'id' }, c), (e) => !(e instanceof ApiStop) && /not in JSON/.test(e.message));
  assert.deepEqual(ledgerOf(c), { [TODAY]: { units: 4, searches: 0 } }, 'the API bills every request it answers');
});

test("the ledger's day is the Pacific day, winter and summer", () => {
  assert.equal(pacificDay(new Date('2026-11-16T07:59:59Z')), '2026-11-15'); // a second before midnight in California
  assert.equal(pacificDay(new Date('2026-11-16T08:00:00Z')), '2026-11-16'); // 7pm in Sydney
  assert.equal(pacificDay(new Date('2026-07-01T06:59:59Z')), '2026-06-30'); // summer time: an hour earlier
  assert.equal(pacificDay(new Date('2026-07-01T07:00:00Z')), '2026-07-01');
});

test('the ledger counts 100 for a search and 1 otherwise, refuses the 91st search, and yesterday does not count today', async () => {
  assert.deepEqual(LIMITS, { units: 9000, searches: 90 });
  const f = fake({ search: () => ({ items: [] }), channels: () => ({ items: [] }) });
  const mixed = ctx(f);
  await searchMentions('Acme Garden', {}, mixed);
  assert.deepEqual(ledgerOf(mixed), { [TODAY]: { units: 100, searches: 1 } });
  await channel({ handle: 'JaySample' }, mixed);
  assert.deepEqual(ledgerOf(mixed), { [TODAY]: { units: 101, searches: 1 } });

  const g = fake({ search: () => ({ items: [] }), channels: () => ({ items: [] }) });
  const c = ctx(g);
  for (let i = 0; i < 90; i++) await searchMentions('Acme Garden', {}, c);
  assert.deepEqual(ledgerOf(c), { [TODAY]: { units: 9000, searches: 90 } });
  const local = stop('quota-local', /desk's own daily cap.*resumes after 7pm Sydney \(midnight Pacific\)/);
  await assert.rejects(searchMentions('Acme Garden', {}, c), local);
  await assert.rejects(channel({ handle: 'JaySample' }, c), local, '90 searches are the whole 9,000 units');
  c.now = () => new Date('2026-11-16T07:59:59Z'); // still 15 Nov in California
  await assert.rejects(searchMentions('Acme Garden', {}, c), local);
  assert.equal(g.calls.length, 90, 'a refused call is never sent');
  c.now = () => new Date('2026-11-16T08:00:00Z'); // midnight Pacific: a new day
  await searchMentions('Acme Garden', {}, c);
  assert.equal(g.calls.length, 91);
  assert.deepEqual(ledgerOf(c), { [TODAY]: { units: 9000, searches: 90 }, '2026-11-16': { units: 100, searches: 1 } });
});

test('each cap bites on its own: 90 searches, and 9,000 units', async () => {
  const f = fake({ search: () => ({ items: [] }), channels: () => ({ items: [] }) });
  const at = (units, searches) => { const c = ctx(f); writeFileSync(c.ledger, JSON.stringify({ [TODAY]: { units, searches } })); return c; };
  await assert.rejects(searchMentions('Acme Garden', {}, at(90, 90)), stop('quota-local'));
  assert.equal(await channel({ handle: 'JaySample' }, at(90, 90)), null, 'a 1-unit call is still allowed');
  await assert.rejects(channel({ handle: 'JaySample' }, at(9000, 0)), stop('quota-local'));
  await assert.rejects(searchMentions('Acme Garden', {}, at(8999, 0)), stop('quota-local'), '8,999 + 100 is past the cap');
  const last = at(8999, 0);
  await channel({ handle: 'JaySample' }, last);
  assert.deepEqual(ledgerOf(last), { [TODAY]: { units: 9000, searches: 0 } });
  assert.equal(f.calls.length, 2);
});

test('no call is made that cannot be counted: no ledger, one inside the repository, one in a folder that is not there, one that cannot be read', async (t) => {
  const f = fake({ videos: () => ({ items: [] }) });
  const get = (ledger) => apiGet('videos', { part: 'id', id: 'aaaaaaaaaa1' }, { fetch: f.fetch, now: () => NOON, ledger });
  const inside = inRepo(t, 'never-counted-here.json');
  await assert.rejects(get(undefined), /needs a ledger/);
  await assert.rejects(get(inside), /refusing to write inside the repository/);
  assert.ok(!existsSync(inside));
  await assert.rejects(get(join(tmp(), 'no-such-folder', 'ledger.json')), /folder.*cannot be written/);
  const damaged = join(tmp(), 'ledger.json');
  const texts = [
    '{"2026-11-15":', '[]', 'null', '{"2026-11-15":null}', '{"2026-11-15":{"units":3}}',
    '{"2026-11-15":{"units":"12","searches":0}}', '{"2026-11-15":{"units":-5,"searches":0}}',
  ];
  for (const text of texts) {
    writeFileSync(damaged, text);
    await assert.rejects(get(damaged), /cannot be read.*never counted as zero/, text);
    assert.equal(readFileSync(damaged, 'utf8'), text);
  }
  assert.equal(f.calls.length, 0);
});

test('createLedger checks the ledger before a run starts and hands back its path', async (t) => {
  const file = join(tmp(), 'ledger.json');
  assert.equal(createLedger(file), file, 'a ledger that is not there yet starts at zero');
  writeFileSync(file, JSON.stringify({ [TODAY]: { units: 12, searches: 0 } }));
  const f = fake({ videos: () => ({ items: [] }) });
  await videos(['aaaaaaaaaa1'], { fetch: f.fetch, ledger: createLedger(file), now: () => NOON });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { [TODAY]: { units: 13, searches: 0 } });
  assert.throws(() => createLedger(inRepo(t, 'never-counted-here-2.json')), /refusing to write inside the repository/);
  writeFileSync(file, 'not a ledger');
  assert.throws(() => createLedger(file), /cannot be read.*never counted as zero/);
  assert.throws(() => createLedger(undefined));
});

const channelItem = (over = {}) => ({
  id: CH,
  snippet: { title: 'Jay Sample Builds', description: 'A made-up channel about mending an old farmhouse.', customUrl: '@jaysample', country: 'AU' },
  contentDetails: { relatedPlaylists: { uploads: UPLOADS } },
  statistics: { viewCount: '1234567', subscriberCount: '45600', hiddenSubscriberCount: false, videoCount: '210' },
  ...over,
});

test('a channel is found by id or by @handle and read into plain fields', async () => {
  const f = fake({ channels: () => ({ items: [channelItem()] }) });
  const c = ctx(f);
  assert.deepEqual(await channel({ id: CH }, c), {
    id: CH, handle: '@jaysample', title: 'Jay Sample Builds', description: 'A made-up channel about mending an old farmhouse.',
    country: 'AU', uploads: UPLOADS, subscribers: 45600, hiddenSubscribers: false, videoCount: 210,
  });
  await channel({ handle: 'JaySample' }, c);
  assert.deepEqual(f.calls.map((x) => [x.resource, x.params]), [
    ['channels', { part: 'snippet,contentDetails,statistics', id: CH }],
    ['channels', { part: 'snippet,contentDetails,statistics', forHandle: '@JaySample' }],
  ]);
});

test('a channel that is not there is null, and a count that is not there is null, never 0', async () => {
  const bare = channelItem({ snippet: { title: 'Jay Sample Builds' }, statistics: { hiddenSubscriberCount: true, subscriberCount: '0' } });
  const f = fake({ channels: (p) => (p.id === CH ? { items: [bare] } : { kind: 'youtube#channelListResponse' }) });
  const c = ctx(f);
  assert.equal(await channel({ handle: 'NobodySample' }, c), null);
  const hidden = await channel({ id: CH }, c);
  assert.deepEqual([hidden.subscribers, hidden.hiddenSubscribers, hidden.videoCount, hidden.country, hidden.handle], [null, true, null, null, null]);
  await assert.rejects(channel({ error: 'not a channel id, a channel link or an @handle' }, c), /what channelRef\(\) returns/);
  assert.equal(f.calls.length, 2, 'a ref that is not one never reaches the API');
});

test('uploads are one call of up to 50, each with its exact date, and a missing list is empty', async () => {
  const f = fake({
    playlistItems: (p) => (p.playlistId === UPLOADS ? {
      items: [
        { contentDetails: { videoId: 'aaaaaaaaaa1', videoPublishedAt: '2026-11-01T08:00:00Z' } },
        { contentDetails: { videoId: 'aaaaaaaaaa2', videoPublishedAt: '2026-10-20T21:30:05Z' } },
        { contentDetails: { videoId: 'aaaaaaaaaa3' } },
      ],
      nextPageToken: 'made-up-token',
    } : apiError(404, 'playlistNotFound')),
  });
  const c = ctx(f);
  assert.deepEqual(await uploads(UPLOADS, {}, c), [
    { videoId: 'aaaaaaaaaa1', publishedAt: '2026-11-01T08:00:00Z' },
    { videoId: 'aaaaaaaaaa2', publishedAt: '2026-10-20T21:30:05Z' },
    { videoId: 'aaaaaaaaaa3', publishedAt: null },
  ]);
  await uploads(UPLOADS, { max: 5 }, c);
  await uploads(UPLOADS, { max: 500 }, c);
  assert.deepEqual(await uploads('UU' + 'nobody0000000000000000', {}, c), []);
  assert.deepEqual(f.calls.map((x) => x.params.maxResults), ['50', '5', '50', '50'], 'one page each: the next page is never asked for');
  assert.deepEqual(f.calls[0].params, { part: 'contentDetails', playlistId: UPLOADS, maxResults: '50' });
});

const videoItem = (id, { snippet = {}, duration = 'PT12M34S', statistics = { viewCount: '50123', likeCount: '2100', commentCount: '87' }, paid = { hasPaidProductPlacement: false } } = {}) => ({
  id,
  snippet: {
    publishedAt: '2026-10-01T08:00:00Z', channelId: CH, title: 'Painting the old door', description: 'A made-up description.\nSecond line.',
    tags: ['farmhouse', 'door'], defaultAudioLanguage: 'en-AU', liveBroadcastContent: 'none', ...snippet,
  },
  contentDetails: { duration },
  statistics,
  ...(paid ? { paidProductPlacementDetails: paid } : {}),
});

test('videos are read 50 ids a call into plain fields', async () => {
  const f = fake({ videos: (p) => ({ items: p.id.split(',').map((id) => videoItem(id)) }) });
  const c = ctx(f);
  const ids = Array.from({ length: 120 }, (_, i) => `v${String(i).padStart(10, '0')}`);
  const out = await videos(ids, c);
  assert.deepEqual(out.map((v) => v.id), ids);
  assert.deepEqual(f.calls.map((x) => x.params.id.split(',').length), [50, 50, 20]);
  assert.deepEqual(Object.keys(f.calls[0].params).sort(), ['id', 'part']);
  assert.equal(f.calls[0].params.part, 'snippet,contentDetails,statistics,paidProductPlacementDetails');
  assert.deepEqual(out[0], {
    id: ids[0], channelId: CH, title: 'Painting the old door', description: 'A made-up description.\nSecond line.', publishedAt: '2026-10-01T08:00:00Z',
    durationSec: 754, views: 50123, likes: 2100, comments: 87, paid: false, tags: ['farmhouse', 'door'], lang: 'en-AU', live: false,
  });
  assert.deepEqual(await videos([], c), []);
  assert.equal(f.calls.length, 3, 'no ids, no call');
  assert.deepEqual(ledgerOf(c), { [TODAY]: { units: 3, searches: 0 } });
});

test('a video keeps what YouTube hides as null: likes off, comments off, no paid flag, no language; live and upcoming are marked', async () => {
  const items = [
    videoItem('aaaaaaaaaa1', { statistics: { viewCount: '900' }, paid: null, snippet: { tags: undefined, defaultAudioLanguage: undefined } }),
    videoItem('aaaaaaaaaa2', { statistics: { likeCount: '0', commentCount: '0' }, paid: { hasPaidProductPlacement: true } }),
    videoItem('aaaaaaaaaa3', { duration: 'P0D', snippet: { liveBroadcastContent: 'live' } }),
    videoItem('aaaaaaaaaa4', { duration: 'P0D', snippet: { liveBroadcastContent: 'upcoming' } }),
  ];
  const [hidden, zero, live, soon] = await videos(items.map((v) => v.id), ctx(fake({ videos: () => ({ items }) })));
  assert.deepEqual([hidden.views, hidden.likes, hidden.comments, hidden.paid, hidden.tags, hidden.lang], [900, null, null, null, [], null]);
  assert.deepEqual([zero.views, zero.likes, zero.comments, zero.paid], [null, 0, 0, true], 'a real zero stays a zero');
  assert.deepEqual([live.live, live.durationSec, soon.live, soon.durationSec, hidden.live], [true, 0, true, 0, false]);
});

test('a length is read from ISO 8601, and P0D is 0', () => {
  const cases = { PT12M34S: 754, PT1H2M3S: 3723, PT45S: 45, PT3M: 180, PT1H: 3600, P1DT2H3M4S: 93784, P1D: 86400, P0D: 0, PT0S: 0 };
  for (const [iso, sec] of Object.entries(cases)) assert.equal(durationSec(iso), sec, iso);
  for (const junk of ['', undefined, null, '12:34', 'P', 'PT', 'PT5', 'T5M', 'PT1H2M3S and more']) assert.equal(durationSec(junk), null, String(junk));
});

const VIEWER_1 = 'UC' + 'viewer0000000000000001';
const VIEWER_2 = 'UC' + 'viewer0000000000000002';
const comment = (text, name, id, more = {}) => ({
  snippet: { textOriginal: text, textDisplay: text, publishedAt: '2026-10-02T03:00:00Z', authorDisplayName: name, authorChannelId: { value: id }, authorChannelUrl: `http://www.youtube.com/channel/${id}`, authorProfileImageUrl: 'https://example.com/made-up.jpg', ...more },
});
const thread = (top, replies = []) => ({
  snippet: { channelId: CH, videoId: 'aaaaaaaaaa1', topLevelComment: top, totalReplyCount: replies.length },
  ...(replies.length ? { replies: { comments: replies } } : {}),
});

test('top comments keep the words, the likes and the date, and never who wrote them', async () => {
  const f = fake({
    commentThreads: () => ({
      items: [
        thread(comment('The door colour is perfect', '@viewer-one-sample', VIEWER_1, { likeCount: 41 }), [
          comment('Thank you, it took three coats', '@jaysample', CH, { publishedAt: '2026-10-03T04:00:00Z' }),
          comment('Which paint was it?', '@viewer-two-sample', VIEWER_2),
        ]),
        thread(comment('Watching from a made-up town', '@viewer-two-sample', VIEWER_2, { likeCount: 0, textOriginal: undefined })),
      ],
    }),
  });
  const c = ctx(f);
  const out = await topComments('aaaaaaaaaa1', {}, c);
  assert.deepEqual(out, {
    disabled: false,
    comments: [
      { text: 'The door colour is perfect', likes: 41, publishedAt: '2026-10-02T03:00:00Z' },
      { text: 'Watching from a made-up town', likes: 0, publishedAt: '2026-10-02T03:00:00Z' },
    ],
    ownerReplies: [{ text: 'Thank you, it took three coats', publishedAt: '2026-10-03T04:00:00Z' }],
  });
  const kept = JSON.stringify(out) + readFileSync(c.ledger, 'utf8');
  for (const who of ['viewer-one-sample', 'viewer-two-sample', 'jaysample', VIEWER_1, VIEWER_2, CH, 'author', 'example.com']) {
    assert.ok(!kept.includes(who), `${who} must not be returned or stored`);
  }
  assert.deepEqual(f.calls[0].params, { part: 'snippet,replies', videoId: 'aaaaaaaaaa1', order: 'relevance', textFormat: 'plainText', maxResults: '20' });
});

test('comments switched off is said plainly, no comments yet is an empty list, and a video that is gone is an error', async () => {
  const f = fake({
    commentThreads: (p) => (p.videoId === 'aaaaaaaaaa1' ? apiError(403, 'commentsDisabled') : p.videoId === 'aaaaaaaaaa2' ? { items: [] } : apiError(404, 'videoNotFound')),
  });
  const c = ctx(f);
  assert.deepEqual(await topComments('aaaaaaaaaa1', {}, c), { disabled: true, comments: [], ownerReplies: [] });
  assert.deepEqual(await topComments('aaaaaaaaaa2', {}, c), { disabled: false, comments: [], ownerReplies: [] });
  await assert.rejects(topComments('aaaaaaaaaa3', {}, c), (e) => !(e instanceof ApiStop) && e.reason === 'videoNotFound', 'unknown is never said as none');
});

test('a search for mentions returns videos only, newest first, and costs 100 units', async () => {
  const f = fake({
    search: () => ({
      items: [
        { id: { kind: 'youtube#video', videoId: 'aaaaaaaaaa7' }, snippet: { publishedAt: '2026-11-10T09:00:00Z', channelId: CH, channelTitle: 'Jay Sample Builds', title: 'Acme Garden&#39;s bench &amp; a wet weekend', description: 'We put the made-up balcony potting bench together and ...' } },
        { id: { kind: 'youtube#channel', channelId: CH }, snippet: { title: 'Jay Sample Builds' } },
      ],
    }),
  });
  const c = ctx(f);
  assert.deepEqual(await searchMentions('Acme Garden', { publishedAfter: '2026-10-01' }, c), [{
    videoId: 'aaaaaaaaaa7', channelId: CH, channelTitle: 'Jay Sample Builds', title: 'Acme Garden&#39;s bench &amp; a wet weekend',
    snippet: 'We put the made-up balcony potting bench together and ...', publishedAt: '2026-11-10T09:00:00Z',
  }]);
  assert.deepEqual(f.calls[0].params, { part: 'snippet', type: 'video', order: 'date', q: 'Acme Garden', maxResults: '25', publishedAfter: '2026-10-01T00:00:00.000Z' });
  await searchMentions('Acme Garden', { max: 500 }, c);
  assert.deepEqual(f.calls[1].params, { part: 'snippet', type: 'video', order: 'date', q: 'Acme Garden', maxResults: '50' });
  assert.deepEqual(ledgerOf(c), { [TODAY]: { units: 200, searches: 2 } });
  await assert.rejects(searchMentions('Acme Garden', { publishedAfter: 'last month' }, c), RangeError, 'a date that is not one must not cost 100 units');
  assert.equal(f.calls.length, 2);
});

test('nextChunk hands out the next unsaved items: with limit 1 over 3 items and 1 saved, exactly 1', () => {
  const saved = new Set(['a']);
  const isSaved = (x) => saved.has(x);
  assert.deepEqual(nextChunk(['a', 'b', 'c'], { limit: 1, isSaved }), ['b']);
  saved.add('b'); // that launch saved its work, so the next launch is just a fresh call
  assert.deepEqual(nextChunk(['a', 'b', 'c'], { limit: 1, isSaved }), ['c']);
  saved.add('c');
  assert.deepEqual(nextChunk(['a', 'b', 'c'], { limit: 1, isSaved }), []);
  assert.deepEqual(nextChunk(['a', 'b', 'c'], { limit: 2, isSaved: () => false }), ['a', 'b']);
  assert.deepEqual(nextChunk(['a', 'b', 'c'], { isSaved: (x) => x === 'b' }), ['a', 'c'], 'no limit: everything not saved yet');
  for (const limit of [0, -1, 1.5, NaN, '2']) assert.throws(() => nextChunk(['a'], { limit, isSaved }), /limit/, String(limit));
});

test('no other desk script talks to the network: the one fetch call is in youtube-api.mjs', () => {
  const lines = (f) => readFileSync(join(here, f), 'utf8').split('\n').map((line, i) => [`${f}:${i + 1}`, line]).filter(([, line]) => line.includes('fetch(')).map(([at]) => at);
  const files = readdirSync(here, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.endsWith('.test.mjs') && d.name !== 'youtube-api.mjs').map((d) => d.name);
  assert.ok(files.includes('measure.mjs') && files.includes('lib.mjs'), 'the scan must be looking at the desk scripts');
  assert.deepEqual(files.flatMap(lines), [], 'YouTube is read through youtube-api.mjs and nothing else');
  assert.equal(lines('youtube-api.mjs').length, 1, 'one door, one call');
});

// The command line runs in its own process, so it gets its fetch from a preloaded file: still no network.
function cli(argv, answer) {
  const dir = tmp();
  const pre = join(dir, 'fake-fetch.mjs');
  writeFileSync(pre, `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(answer.body))}, { status: ${answer.status} });\n`);
  const ledger = join(dir, 'ledger.json');
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(pre).href, join(here, 'youtube-api.mjs'), ...argv(ledger)], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, said: r.stdout + r.stderr, ledger };
}
const regions = { status: 200, body: { kind: 'youtube#i18nRegionListResponse', items: [{ id: 'AU' }] } };

test('--check makes one 1-unit call and says the key works, and nothing else', () => {
  const r = cli((ledger) => ['--check', '--ledger', ledger], regions);
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'key works · 1 unit\n', '']);
  assert.deepEqual(Object.values(JSON.parse(readFileSync(r.ledger, 'utf8'))), [{ units: 1, searches: 0 }]);
});

test('--check on a stop prints the plain reason and exits 3, never the raw answer', () => {
  const noKey = { status: 403, body: { error: { code: 403, message: `Method doesn't allow unregistered callers. ${RAW}`, errors: [{ reason: 'forbidden' }] } } };
  const r = cli((ledger) => ['--check', '--ledger', ledger], noKey);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /the YouTube key is missing or not valid/);
  assert.ok(!r.said.includes(RAW) && !r.said.includes('key works'), r.said);
  assert.ok(!existsSync(r.ledger));
});

test('--check never says the key works on an answer that is not the API, without a ledger, or with one inside the repository', (t) => {
  const odd = cli((ledger) => ['--check', '--ledger', ledger], { status: 200, body: { hello: 'not the API' } });
  assert.equal(odd.status, 1);
  assert.ok(!odd.said.includes('key works'), odd.said);
  const ledger = inRepo(t, 'never-counted-here-3.json');
  const inside = cli(() => ['--check', '--ledger', ledger], regions);
  assert.equal(inside.status, 2);
  assert.match(inside.stderr, /refusing to write inside the repository/);
  assert.ok(!existsSync(ledger));
  const damaged = join(tmp(), 'ledger.json');
  writeFileSync(damaged, 'not a ledger');
  const r2 = cli(() => ['--check', '--ledger', damaged], regions);
  assert.equal(r2.status, 2);
  assert.match(r2.stderr, /cannot be read/);
  for (const argv of [['--check'], ['--ledger', join(tmp(), 'ledger.json')], []]) {
    const r = cli(() => argv, regions);
    assert.equal(r.status, 2, argv.join(' '));
    assert.match(r.stderr, /^usage: /);
  }
});
