#!/usr/bin/env node
// Measure a creator from their public YouTube feed, with no key: the median views of their recent long videos, the
// best of those, and the date. Shorts are left out (the feed links them as /shorts/), and so are videos under 7 days
// old, whose views are still climbing. The output is dated overrides for roster.mjs --extra, so a number is quotable
// for 30 days after it was measured and then must be measured again.
//
//   node agency-desk/scripts/measure.mjs --channels <private channels.json> --today YYYY-MM-DD --out <measured.json>
//        channels.json: { "<creator as in the Creators tab>": "<@handle, channel link, or channel id starting UC>" }
//   Needs www.youtube.com reachable (allowed in Leif's cloud environment on 15 Nov). In the cloud, run it with
//   NODE_USE_ENV_PROXY=1 so Node's fetch goes through the proxy. The public feed answers 404 from the cloud, so the
//   channel's own Videos page is read instead: it lists long videos only, and its dates are approximate ("2w ago").
import { readFileSync, writeFileSync } from 'node:fs';
import { args, isMain, assertOutsideRepo, parseViews } from './lib.mjs';

const DAY = 86_400_000;

export function parseFeed(xml) {
  const entries = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const views = Number((e.match(/<media:statistics[^>]*views="(\d+)"/) || [])[1]);
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    entries.push({ link, published, views, title, short: /\/shorts\//.test(link) });
  }
  return entries;
}

// "1d ago", "10 days ago", "2w ago", "1mo ago", "Streamed 3 weeks ago": the age in days, or NaN.
const UNIT = [[/^(mo|months?)$/, 30], [/^(y|yrs?|years?)$/, 365], [/^(w|wks?|weeks?)$/, 7], [/^(d|days?)$/, 1], [/^(h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)$/, 0]];
export function ageDays(text) {
  const m = /(\d+)\s*([a-z]+)\s+ago/i.exec(String(text || ''));
  if (!m) return NaN;
  const u = UNIT.find(([re]) => re.test(m[2].toLowerCase()));
  return u ? Number(m[1]) * u[1] : NaN;
}

// The channel's Videos page (YouTube's lockupViewModel layout): one entry per long video with a known age.
export function parseVideosPage(html, today) {
  const s = String(html || '');
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error('parseVideosPage needs today as YYYY-MM-DD');
  const starts = [];
  for (let i = s.indexOf('"lockupViewModel"'); i >= 0; i = s.indexOf('"lockupViewModel"', i + 1)) starts.push(i);
  const entries = [];
  const seen = new Set();
  starts.forEach((start, k) => {
    const chunk = s.slice(start, starts[k + 1] ?? start + 20000);
    const id = (chunk.match(/\/vi\/([\w-]{11})\//) || [])[1];
    const title = (chunk.match(/"lockupMetadataViewModel":\{"title":\{"content":"([^"]*)"/) || [])[1];
    const parts = [...((chunk.match(/"metadataParts":\[([\s\S]*?)\]\}/) || [])[1] || '').matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]);
    const days = parts.map(ageDays).find((d) => Number.isFinite(d));
    const views = parts.map((p) => (/\bago\b/i.test(p) ? NaN : parseViews(p))).find((v) => Number.isFinite(v));
    if (!id || !title || seen.has(id) || !Number.isFinite(days) || !Number.isFinite(views)) return;
    seen.add(id);
    entries.push({ link: `https://www.youtube.com/watch?v=${id}`, published: new Date(now - days * DAY).toISOString().slice(0, 10), views, title, short: false });
  });
  return entries;
}

// A channel may be given as its id (UC...), a /channel/UC... link, an @handle or a youtube.com/@handle link.
// Ids are used as they are; handles are looked up on the channel page.
export function channelRef(value) {
  const v = String(value || '').trim();
  const id = v.match(/^(UC[\w-]{20,})$/) || v.match(/youtube\.com\/channel\/(UC[\w-]{20,})/);
  if (id) return { id: id[1] };
  const handle = v.match(/^@([\w.-]{3,})$/) || v.match(/youtube\.com\/@([\w.-]{3,})/);
  if (handle) return { handle: handle[1] };
  return { error: 'not a channel id, a channel link or an @handle' };
}

// The channel id from a channel page: the canonical link first, then the page's own metadata.
export function parseChannelId(html) {
  const s = String(html || '');
  const m = s.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/)
    || s.match(/<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{20,})"/)
    || s.match(/"externalId":"(UC[\w-]{20,})"/);
  return m ? m[1] : null;
}

export function measure(entries, today, { n = 12, minAgeDays = 7, minVideos = 6 } = {}) {
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error('measure needs --today YYYY-MM-DD');
  // The newest long video is the true detail a note can open with, whatever its age.
  const newest = entries.filter((e) => !e.short && !Number.isNaN(Date.parse(e.published))).sort((a, b) => Date.parse(b.published) - Date.parse(a.published))[0];
  const latest = newest ? { title: newest.title || '', link: newest.link, published: String(newest.published).slice(0, 10) } : null;
  const long = entries
    .filter((e) => !e.short && Number.isFinite(e.views) && !Number.isNaN(Date.parse(e.published)) && (now - Date.parse(e.published)) / DAY >= minAgeDays)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .slice(0, n);
  if (long.length < minVideos) return { ok: false, latest, why: `only ${long.length} long videos at least ${minAgeDays} days old in the feed (need ${minVideos})` };
  const v = long.map((e) => e.views).sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const typical = v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  return { ok: true, latest, measured: { n: long.length, typical, best: v[v.length - 1], at: today, method: `median of the last ${long.length} long videos, each at least ${minAgeDays} days old` } };
}

async function main() {
  const a = args();
  if (!a.channels || !a.today || !a.out) { console.error('usage: measure.mjs --channels <channels.json> --today YYYY-MM-DD --out <measured.json>'); process.exit(2); }
  let out;
  try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
  const channels = JSON.parse(readFileSync(a.channels, 'utf8'));
  const result = {};
  let ok = 0;
  for (const [creator, value] of Object.entries(channels)) {
    const ref = channelRef(value);
    if (ref.error) { result[creator] = { error: ref.error }; continue; }
    try {
      // A stalled page or feed must not hang the run: each request gets 15 seconds.
      let id = ref.id;
      if (!id) {
        const page = await fetch(`https://www.youtube.com/@${ref.handle}`, { signal: AbortSignal.timeout(15_000) });
        if (!page.ok) throw new Error(`channel page answered ${page.status}`);
        id = parseChannelId(await page.text());
        if (!id) throw new Error('no channel id on the channel page');
      }
      // The feed first; when it answers 404 (as from the cloud), the channel's Videos page.
      let entries;
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) entries = parseFeed(await res.text());
      else {
        const vp = await fetch(`https://www.youtube.com/channel/${id}/videos`, { signal: AbortSignal.timeout(15_000), headers: { 'accept-language': 'en-US,en;q=0.9' } });
        if (!vp.ok) throw new Error(`feed answered ${res.status} and the Videos page ${vp.status}`);
        entries = parseVideosPage(await vp.text(), a.today);
      }
      const m = measure(entries, a.today);
      result[creator] = m.ok ? { measured: m.measured, latest: m.latest } : { error: m.why, latest: m.latest };
      if (m.ok) ok++;
    } catch (e) {
      result[creator] = { error: `could not read the feed: ${e.message}` };
    }
  }
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`measured ${ok} of ${Object.keys(channels).length} creators; merge the "measured" entries into the roster overrides (--extra)`);
  process.exit(ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
