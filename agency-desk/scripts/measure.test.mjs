// Measuring from the public feed, and the tracker's rules, on made-up channels and people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib.mjs';
import { parseFeed, measure, channelRef, parseChannelId } from './measure.mjs';
import { validate, parseLog, status } from './tracker.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const entry = (id, published, views, short = false) => `<entry><id>yt:video:${id}</id>
  <link rel="alternate" href="https://www.youtube.com/${short ? 'shorts/' : 'watch?v='}${id}"/>
  <published>${published}T08:00:00+00:00</published>
  <media:group><media:community><media:starRating count="9" average="5.00" min="1" max="5"/><media:statistics views="${views}"/></media:community></media:group></entry>`;
const feed = (entries) => `<?xml version="1.0"?><feed xmlns:media="http://search.yahoo.com/mrss/">${entries.join('\n')}</feed>`;

test('the feed parser reads link, date and views, and spots Shorts by their link', () => {
  const e = parseFeed(feed([entry('a1', '2026-10-01', 1200), entry('s1', '2026-10-02', 99000, true)]));
  assert.equal(e.length, 2);
  assert.deepEqual([e[0].views, e[0].short, e[1].short], [1200, false, true]);
});

test('the typical video is the median of recent long videos: Shorts, fresh uploads and a viral hit cannot move it much', () => {
  const long = [5, 6, 4, 7, 5, 6, 8, 5, 6, 400, 5].map((k, i) => entry(`v${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, k * 1000));
  const xml = feed([...long, entry('s1', '2026-10-20', 900000, true), entry('new', '2026-11-07', 50)]);
  const m = measure(parseFeed(xml), '2026-11-09');
  assert.equal(m.ok, true);
  assert.equal(m.measured.n, 11, 'the Short and the 2-day-old upload are left out');
  assert.equal(m.measured.typical, 6000);
  assert.equal(m.measured.best, 400000);
  assert.equal(m.measured.at, '2026-11-09');
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

test('the channel id comes from the page itself, or nothing does', () => {
  const id = 'UC' + 'a1B2c3D4e5F6g7H8i9J0kL';
  assert.equal(parseChannelId(`<html><link rel="canonical" href="https://www.youtube.com/channel/${id}"></html>`), id);
  assert.equal(parseChannelId(`<meta itemprop="identifier" content="${id}">`), id);
  assert.equal(parseChannelId('{"metadata":{"externalId":"' + id + '"}}'), id);
  assert.equal(parseChannelId('<html>no id here</html>'), null);
});

test('too few long videos means no number, never a guess', () => {
  const m = measure(parseFeed(feed([entry('a', '2026-10-01', 1000), entry('b', '2026-10-02', 2000)])), '2026-11-09');
  assert.equal(m.ok, false);
  assert.match(m.why, /only 2 long videos/);
});

test('the measurer refuses to write inside the repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-measure-'));
  const ch = join(dir, 'channels.json'); writeFileSync(ch, JSON.stringify({ Jay: 'not-an-id' }));
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'measure.mjs'), '--channels', ch, '--today', '2026-11-09', '--out', join(REPO_ROOT, 'm.json')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.ok(!existsSync(join(REPO_ROOT, 'm.json')));
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
