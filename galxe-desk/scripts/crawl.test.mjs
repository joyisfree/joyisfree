// The crawler against a local server: discovery from an llms.txt and a help centre, the deadline, the
// retries, fail-closed MISSING rows, hash-based change lines, and the completeness check.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLlmsTxt, extractLinks, htmlToText, pagePath, fetchWithDeadline, crawl, check, parseIndex, renderIndex, counts } from './rulebook-crawl.mjs';

let flakyHits = 0;
let mutPhase = 'A'; // drives the /mut page: A, then 'missing' (an outage), then B (changed content)
const server = createServer((req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  switch (req.url) {
    case '/mut': return mutPhase === 'missing' ? send(503, 'text/plain', 'down') : send(200, 'text/plain', `mut ${mutPhase}`);
    case '/llms.txt': return send(200, 'text/plain', '# Docs\n- [Terms](/legal/terms)\n- [Quest](/quest/intro.md)\n- [Elsewhere](https://other.example/x)\n');
    case '/legal/terms.md': return send(200, 'text/markdown', '# Terms\n\nNo bots.\n');
    case '/quest/intro.md': return send(404, 'text/plain', 'nope');
    case '/quest/intro': return send(200, 'text/html', '<html><head><title>Quest intro</title><script>x()</script></head><body><h1>Quest</h1><p>Claim within 15 days &amp; pay $0.08.</p></body></html>');
    case '/help': return send(200, 'text/html', '<a href="/help/collections/1-rules">Rules</a><a href="/help/collections/1-rules#x">dup</a>');
    case '/help/collections/1-rules': return send(200, 'text/html', '<a href="/help/articles/11-bots">Bots</a><a href="/help/articles/12-restrictions?utm=1">R</a>');
    case '/help/articles/11-bots': return send(200, 'text/html', '<p>A bot is any automated program.</p>');
    case '/help/articles/12-restrictions': return send(200, 'text/html', '<p>Restrictions follow behaviour.</p>');
    case '/hang': return; // never answers: the deadline must fire
    case '/flaky': flakyHits += 1; return flakyHits < 3 ? send(500, 'text/plain', 'try again') : send(200, 'text/plain', 'third time lucky');
    default: return send(404, 'text/plain', 'missing');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('parseLlmsTxt keeps same-host links, strips .md and drops other hosts', () => {
  const urls = parseLlmsTxt('[a](/legal/terms) [b](/quest/intro.md) [c](https://other.example/x)', `${base}/llms.txt`);
  assert.deepEqual(urls, [`${base}/legal/terms`, `${base}/quest/intro`]);
});

test('extractLinks dedupes, drops fragments and query strings, and filters by path', () => {
  const html = '<a href="/x/collections/1#a">a</a><a href="/x/collections/1?u=2">b</a><a href="/y">c</a>';
  assert.deepEqual(extractLinks(html, `${base}/`, (p) => /collections/.test(p)), [`${base}/x/collections/1`]);
});

test('htmlToText drops scripts and keeps headings and entities', () => {
  const t = htmlToText('<script>evil()</script><h2>Claim</h2><p>Within 15 days &amp; $0.08</p>');
  assert.ok(!t.includes('evil'));
  assert.match(t, /## Claim/);
  assert.match(t, /Within 15 days & \$0.08/);
});

test('pagePath is host-scoped and safe', () => {
  assert.equal(pagePath('https://help.galxe.com/en/articles/11827806-bots'), join('pages', 'help.galxe.com', 'en/articles/11827806-bots.md'));
  assert.equal(pagePath('https://docs.galxe.com/'), join('pages', 'docs.galxe.com', 'index.md'));
});

test('fetchWithDeadline gives up on a hanging page after the deadline, every attempt', async () => {
  const t0 = Date.now();
  await assert.rejects(fetchWithDeadline(`${base}/hang`, { timeoutMs: 150, retries: 2, backoffMs: 10 }));
  assert.ok(Date.now() - t0 < 2000, 'must not wait forever');
});

test('fetchWithDeadline retries a flaky page up to the cap and then succeeds', async () => {
  flakyHits = 0;
  const r = await fetchWithDeadline(`${base}/flaky`, { timeoutMs: 1000, retries: 3, backoffMs: 5 });
  assert.equal(r.text, 'third time lucky');
  assert.equal(flakyHits, 3);
});

test('crawl discovers, saves with front-matter, fails closed on MISSING, and records changes', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'rulebook-'));
  const sources = { llms: [`${base}/llms.txt`], helpCentres: [`${base}/help`], pages: [`${base}/hang`] };
  const r = await crawl(sources, { outDir, timeoutMs: 150, retries: 1, backoffMs: 5, now: new Date('2026-10-28T00:00:00Z') });
  const byUrl = Object.fromEntries(r.rows.map((x) => [x.url, x]));
  assert.equal(byUrl[`${base}/legal/terms`].status, 'FETCHED');
  assert.equal(byUrl[`${base}/quest/intro`].status, 'FETCHED', 'falls back to the html page when .md is missing');
  assert.equal(byUrl[`${base}/help/articles/11-bots`].status, 'FETCHED');
  assert.equal(byUrl[`${base}/help/articles/12-restrictions`].status, 'FETCHED');
  assert.equal(byUrl[`${base}/hang`].status, 'MISSING', 'a page that never answers is MISSING, not skipped');
  assert.equal(r.counts.listed, 5);
  assert.equal(r.counts.missing, 1);
  const saved = readFileSync(join(outDir, pagePath(`${base}/quest/intro`)), 'utf8');
  assert.match(saved, /^---\nurl: .*\ntitle: Quest intro\nfetched: 2026-10-28T00:00:00.000Z\nsha256: [0-9a-f]{64}\n---/);
  assert.match(saved, /Claim within 15 days & pay \$0.08/);
  assert.ok(!saved.includes('x()'), 'scripts never land in the corpus');
  const changes = readFileSync(join(outDir, 'CHANGES.md'), 'utf8');
  assert.match(changes, /NEW \| .*legal\/terms/);
  assert.match(changes, /MISSING \| .*\/hang/);
  assert.equal(check(outDir).complete, false, 'not complete while anything is missing or unread');

  // The Rules Counsel marks pages read; a re-crawl keeps those marks and reports no change for same content.
  const idx = readFileSync(join(outDir, 'INDEX.md'), 'utf8').replace(/\| FETCHED \| ([0-9a-f]{64}) \|  \|  \|/g, '| FETCHED | $1 | yes | read, means X |');
  writeFileSync(join(outDir, 'INDEX.md'), idx);
  const r2 = await crawl({ llms: [`${base}/llms.txt`], helpCentres: [`${base}/help`] }, { outDir, timeoutMs: 500, retries: 1, now: new Date('2026-10-29T00:00:00Z') });
  const terms = r2.rows.find((x) => x.url === `${base}/legal/terms`);
  assert.equal(terms.read, 'yes');
  assert.equal(terms.note, 'read, means X');
  const changes2 = readFileSync(join(outDir, 'CHANGES.md'), 'utf8');
  assert.match(changes2, /GONE \| .*\/hang/);
  assert.ok(!/2026-10-29.*CHANGED/.test(changes2), 'same content is not a change');
  // The rulebook is complete only when the rule and claim files exist with no unconfirmed line, too.
  writeFileSync(join(outDir, 'RULES.md'), 'Legend: DIGEST\n§A1 confirmed. VERIFIED.\n');
  writeFileSync(join(outDir, 'CLAIMING.md'), 'Legend: RECHECK\nwindows confirmed, fetched 2026-11-02.\n');
  assert.equal(check(outDir).complete, true, 'complete once every page is fetched and read and the rule files are clean');
});

test('check reports no index as incomplete, and counts read pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rulebook-empty-'));
  assert.equal(check(dir).complete, false);
  mkdirSync(dir, { recursive: true });
  const rows = [
    { url: 'https://a/1', status: 'FETCHED', sha: 'a'.repeat(64), read: 'yes', note: 'n' },
    { url: 'https://a/2', status: 'FETCHED', sha: 'b'.repeat(64), read: '', note: '' },
    { url: 'https://a/3', status: 'MISSING', sha: '', read: '', note: '' },
  ];
  writeFileSync(join(dir, 'INDEX.md'), renderIndex(rows, 'now'));
  const c = check(dir);
  assert.deepEqual([c.listed, c.fetched, c.read, c.unread, c.missing, c.complete], [3, 2, 1, 1, 1, false]);
  assert.equal(parseIndex(renderIndex(rows, 'now')).size, 3);
  assert.equal(counts(rows).unread, 1);
  assert.ok(existsSync(join(dir, 'INDEX.md')));
});

// ---------- 30 Oct 2026: "read thoroughly" is complete only when no rule line is still waiting on the live page ----------
import { unconfirmedMarkers } from './rulebook-crawl.mjs';

test('unconfirmed rule lines are counted, the legend is not, and check stays incomplete until they are zero', () => {
  const text = 'Legend: DIGEST = search summary, RECHECK = confirm live\n§A1 a rule. help/1, DIGEST.\n§A2 another, RECHECK.\n§A3 confirmed. VERIFIED.\n';
  assert.equal(unconfirmedMarkers(text), 2);
  const dir = mkdtempSync(join(tmpdir(), 'rulebook-markers-'));
  writeFileSync(join(dir, 'INDEX.md'), renderIndex([{ url: 'https://a/1', status: 'FETCHED', sha: 'a'.repeat(64), read: 'yes', note: 'n' }], 'now'));
  writeFileSync(join(dir, 'RULES.md'), text);
  writeFileSync(join(dir, 'CLAIMING.md'), 'Legend: RECHECK\nwindow 15 days (RECHECK)\n');
  const c = check(dir);
  assert.equal(c.unconfirmed, 3);
  assert.equal(c.complete, false, 'every page read is not enough while rule lines wait on the live page');
  writeFileSync(join(dir, 'RULES.md'), 'Legend: DIGEST\n§A3 confirmed. VERIFIED.\n');
  writeFileSync(join(dir, 'CLAIMING.md'), 'Legend: RECHECK\nwindow 15 days, help/9645630, fetched 2026-11-02.\n');
  assert.equal(check(dir).complete, true);
});

// 30 Oct 2026, the adversarial review: three ways the completeness check used to pass when it should not.
test('an empty index is not complete, CRLF rows still parse, and the rule files must exist', () => {
  assert.equal(counts([]).complete, false, 'zero rows is never complete (a source that returned no links)');
  const rows = [
    { url: 'https://a/1', status: 'FETCHED', sha: 'a'.repeat(64), read: 'yes', note: 'n' },
    { url: 'https://a/2', status: 'FETCHED', sha: 'b'.repeat(64), read: 'yes', note: 'm' },
  ];
  const crlf = renderIndex(rows, 'now').replace(/\n/g, '\r\n');
  assert.equal(parseIndex(crlf).size, 2, 'CRLF line endings must not silently drop every row');
  const dir = mkdtempSync(join(tmpdir(), 'rulebook-norules-'));
  writeFileSync(join(dir, 'INDEX.md'), renderIndex([rows[0]], 'now'));
  const c = check(dir);
  assert.equal(c.complete, false, 'a read index without RULES.md and CLAIMING.md is not a read rulebook');
  assert.match(c.note || '', /RULES\.md and CLAIMING\.md/);
});

test('a page that goes MISSING and then changes is still logged as CHANGED and marked unread', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'rulebook-mut-'));
  const sources = { pages: [`${base}/mut`] };
  mutPhase = 'A';
  await crawl(sources, { outDir, timeoutMs: 300, retries: 1, backoffMs: 5, now: new Date('2026-10-28T00:00:00Z') });
  // The counsel reads it.
  const idx = readFileSync(join(outDir, 'INDEX.md'), 'utf8').replace(/\| FETCHED \| ([0-9a-f]{64}) \|  \|  \|/, '| FETCHED | $1 | yes | noted |');
  writeFileSync(join(outDir, 'INDEX.md'), idx);
  mutPhase = 'missing';
  const rMiss = await crawl(sources, { outDir, timeoutMs: 300, retries: 1, backoffMs: 5, now: new Date('2026-10-29T00:00:00Z') });
  assert.equal(rMiss.rows.find((x) => x.url === `${base}/mut`).status, 'MISSING', 'the outage is recorded as MISSING');
  mutPhase = 'B';
  const rChanged = await crawl(sources, { outDir, timeoutMs: 300, retries: 1, backoffMs: 5, now: new Date('2026-10-30T00:00:00Z') });
  const row = rChanged.rows.find((x) => x.url === `${base}/mut`);
  assert.equal(row.status, 'FETCHED');
  assert.equal(row.read, '', 'a page changed since the last good read is marked unread again');
  assert.match(readFileSync(join(outDir, 'CHANGES.md'), 'utf8'), /2026-10-30T[\d:.Z]+ \| CHANGED \| .*\/mut/);
});
