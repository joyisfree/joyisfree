#!/usr/bin/env node
// The rulebook crawler: fetches every official page the desk relies on, saves each as markdown with its
// URL, fetch date and hash, and keeps an index that says which pages have been read and what each means
// for claiming. Fails closed: a page that cannot be fetched is listed as MISSING, never skipped.
//
//   node galxe-desk/scripts/rulebook-crawl.mjs                 # crawl everything in rulebook/sources.json
//   node galxe-desk/scripts/rulebook-crawl.mjs --check         # counts: listed, fetched, read, missing (exit 1 if not complete)
//
// Needs network access to the hosts in sources.json. In a cloud session that blocks them, run it on the Mac.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------- pure helpers (tested) ----------

/** Markdown links in an llms.txt (Mintlify index): returns absolute URLs on the same host, deduped. */
export function parseLlmsTxt(text, base) {
  const out = new Set();
  const re = /\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g;
  let m;
  const baseHost = new URL(base).host;
  while ((m = re.exec(text))) {
    try {
      const u = new URL(m[1], base);
      u.hash = '';
      if (u.host === baseHost) out.add(u.toString().replace(/\.md$/, ''));
    } catch { /* ignore bad links */ }
  }
  return [...out];
}

/** hrefs in an HTML page, absolute, same host, filtered by a predicate on the pathname. */
export function extractLinks(html, base, keep = () => true) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  const baseHost = new URL(base).host;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      u.hash = '';
      u.search = '';
      if (u.host === baseHost && keep(u.pathname)) out.add(u.toString());
    } catch { /* ignore */ }
  }
  return [...out];
}

/** Rough but faithful text from HTML: scripts and styles dropped, headings kept as lines. */
export function htmlToText(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<(h[1-6])[^>]*>/gi, '\n\n## ').replace(/<\/(h[1-6]|p|li|tr|div|section|article)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Where a page lives on disk: pages/<host>/<path>.md */
export function pagePath(url) {
  const u = new URL(url);
  let p = u.pathname.replace(/\/+$/, '') || '/index';
  p = p.replace(/[^a-zA-Z0-9/_.-]/g, '_');
  return join('pages', u.host, `${p}.md`);
}

/** fetch with a hard deadline and a retry cap. Throws after the last failure. */
export async function fetchWithDeadline(url, { timeoutMs = 20_000, retries = 3, fetchImpl = fetch, backoffMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ac.signal, headers: { 'user-agent': 'joyisfree-galxe-desk/0.1 (rulebook crawl; contact leif@byjoyisfreestudio.com)' }, redirect: 'follow' });
      const text = await res.text();
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, status: res.status, text, finalUrl: res.url || url };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * attempt));
    }
  }
  throw lastErr;
}

/** Parse an existing INDEX.md so read-status and notes survive a re-crawl. */
export function parseIndex(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(https?:\/\/\S+)\s*\|\s*(\w+)\s*\|\s*([0-9a-f]{0,64})\s*\|\s*(\w*)\s*\|\s*(.*?)\s*\|$/);
    if (m) map.set(m[1], { status: m[2], sha: m[3], read: m[4] || '', note: m[5] || '' });
  }
  return map;
}

export function renderIndex(rows, when) {
  const lines = [
    `# Rulebook index (crawled ${when})`,
    '',
    'Status is the crawler\'s (FETCHED or MISSING). "read" and the note are the Rules Counsel\'s and survive re-crawls: set read to `yes` and write one line on what the page means for claiming.',
    '',
    '| url | status | sha256 | read | means for claiming |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) lines.push(`| ${r.url} | ${r.status} | ${r.sha || ''} | ${r.read || ''} | ${r.note || ''} |`);
  lines.push('');
  return lines.join('\n');
}

export function counts(rows) {
  const listed = rows.length;
  const fetched = rows.filter((r) => r.status === 'FETCHED').length;
  const missing = rows.filter((r) => r.status === 'MISSING').length;
  const read = rows.filter((r) => r.status === 'FETCHED' && /^y(es)?$/i.test(r.read || '')).length;
  return { listed, fetched, missing, read, unread: fetched - read, complete: missing === 0 && fetched === listed && read === fetched };
}

// ---------- the crawl ----------

/**
 * sources = { llms: [indexUrl...], helpCentres: [rootUrl...], blogs: [{ index, pathIncludes }], pages: [url...] }
 * Returns { rows, changes } and writes pages/, INDEX.md and CHANGES.md under outDir.
 */
export async function crawl(sources, { outDir, timeoutMs = 20_000, retries = 3, fetchImpl = fetch, now = new Date(), log = () => {}, backoffMs = 500 } = {}) {
  const opts = { timeoutMs, retries, fetchImpl, backoffMs };
  const when = now.toISOString();
  const urls = new Set();
  const get = (u) => fetchWithDeadline(u, opts);

  // 1. discover
  for (const idx of sources.llms || []) {
    try {
      const r = await get(idx);
      for (const u of parseLlmsTxt(r.text, idx)) urls.add(u);
      log(`index ${idx}: ${urls.size} pages`);
    } catch (e) { log(`index MISSING ${idx}: ${e.message}`); urls.add(idx); }
  }
  for (const root of sources.helpCentres || []) {
    try {
      const r = await get(root);
      const collections = extractLinks(r.text, root, (p) => /\/collections\/\d+/.test(p));
      for (const c of collections) {
        try {
          const cr = await get(c);
          for (const a of extractLinks(cr.text, c, (p) => /\/articles\/\d+/.test(p))) urls.add(a);
        } catch (e) { log(`collection MISSING ${c}: ${e.message}`); urls.add(c); }
      }
      log(`help centre ${root}: ${collections.length} collections`);
    } catch (e) { log(`help centre MISSING ${root}: ${e.message}`); urls.add(root); }
  }
  for (const b of sources.blogs || []) {
    try {
      const r = await get(b.index);
      for (const u of extractLinks(r.text, b.index, (p) => p.includes(b.pathIncludes || '/blog/') && p !== new URL(b.index).pathname)) urls.add(u);
    } catch (e) { log(`blog MISSING ${b.index}: ${e.message}`); urls.add(b.index); }
  }
  for (const u of sources.pages || []) urls.add(u);

  // 2. fetch and save, fail closed
  const previous = existsSync(join(outDir, 'INDEX.md')) ? parseIndex(readFileSync(join(outDir, 'INDEX.md'), 'utf8')) : new Map();
  const rows = [];
  const changes = [];
  for (const url of [...urls].sort()) {
    const prev = previous.get(url);
    let row = { url, status: 'MISSING', sha: '', read: prev?.read || '', note: prev?.note || '' };
    try {
      let text;
      let title = url;
      let r = null;
      const isDocs = (sources.llms || []).some((i) => url.startsWith(new URL(i).origin));
      if (isDocs) { try { r = await get(`${url}.md`); } catch { r = null; } }
      if (!r) r = await get(url);
      const looksHtml = /<html|<body|<div|<p[ >]/i.test(r.text.slice(0, 4000));
      text = looksHtml ? htmlToText(r.text) : r.text;
      const t = r.text.match(/<title[^>]*>([^<]*)<\/title>/i) || text.match(/^(?:#+\s*)?(.+)$/m);
      if (t) title = t[1].trim();
      const sha = sha256(text);
      const file = join(outDir, pagePath(url));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `---\nurl: ${url}\ntitle: ${title.replace(/\n/g, ' ')}\nfetched: ${when}\nsha256: ${sha}\n---\n\n${text}\n`);
      row = { ...row, status: 'FETCHED', sha, title };
      if (!prev) changes.push(`${when} | NEW | ${url}`);
      else if (prev.sha && prev.sha !== sha) changes.push(`${when} | CHANGED | ${url}`);
    } catch (e) {
      changes.push(`${when} | MISSING | ${url} | ${e.message}`);
      log(`MISSING ${url}: ${e.message}`);
    }
    rows.push(row);
  }
  for (const [url] of previous) if (!urls.has(url)) changes.push(`${when} | GONE | ${url}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'INDEX.md'), renderIndex(rows, when));
  if (changes.length) appendFileSync(join(outDir, 'CHANGES.md'), changes.join('\n') + '\n');
  return { rows, changes, counts: counts(rows) };
}

export function check(outDir) {
  const idx = join(outDir, 'INDEX.md');
  if (!existsSync(idx)) return { listed: 0, fetched: 0, missing: 0, read: 0, unread: 0, complete: false, note: 'no INDEX.md yet: the crawl has not run' };
  const rows = [...parseIndex(readFileSync(idx, 'utf8')).entries()].map(([url, r]) => ({ url, ...r }));
  return counts(rows);
}

function pagesOnDisk(outDir) {
  const root = join(outDir, 'pages');
  if (!existsSync(root)) return 0;
  let n = 0;
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : (n += f.endsWith('.md') ? 1 : 0); } };
  walk(root);
  return n;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'galxe-desk/rulebook';
  if (process.argv.includes('--check')) {
    const c = check(outDir);
    console.log(`listed ${c.listed}, fetched ${c.fetched}, read ${c.read}, unread ${c.unread}, missing ${c.missing}, pages on disk ${pagesOnDisk(outDir)}${c.note ? ` (${c.note})` : ''}`);
    process.exitCode = c.complete ? 0 : 1;
  } else {
    const sources = JSON.parse(readFileSync(join(outDir, 'sources.json'), 'utf8'));
    const r = await crawl(sources, { outDir, log: (m) => console.log(m) });
    console.log(`listed ${r.counts.listed}, fetched ${r.counts.fetched}, missing ${r.counts.missing}; ${r.changes.length} change lines`);
    process.exitCode = r.counts.missing === 0 ? 0 : 1;
  }
}
