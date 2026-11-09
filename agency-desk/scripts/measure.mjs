#!/usr/bin/env node
// Measure a creator from their public YouTube feed, with no key: the median views of their recent long videos, the
// best of those, and the date. Shorts are left out (the feed links them as /shorts/), and so are videos under 7 days
// old, whose views are still climbing. The output is dated overrides for roster.mjs --extra, so a number is quotable
// for 30 days after it was measured and then must be measured again.
//
//   node agency-desk/scripts/measure.mjs --channels <private channels.json> --today YYYY-MM-DD --out <measured.json>
//        channels.json: { "<creator as in the Creators tab>": "<channel id, starts with UC>" }
//   Needs www.youtube.com allowed in the environment's network settings. Check one creator by hand on the first run:
//   if a feed ever links a Short as /watch, that Short would be counted.
import { readFileSync, writeFileSync } from 'node:fs';
import { args, isMain, assertOutsideRepo } from './lib.mjs';

const DAY = 86_400_000;

export function parseFeed(xml) {
  const entries = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    const views = Number((e.match(/<media:statistics[^>]*views="(\d+)"/) || [])[1]);
    entries.push({ link, published, views, short: /\/shorts\//.test(link) });
  }
  return entries;
}

export function measure(entries, today, { n = 12, minAgeDays = 7, minVideos = 6 } = {}) {
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error('measure needs --today YYYY-MM-DD');
  const long = entries
    .filter((e) => !e.short && Number.isFinite(e.views) && !Number.isNaN(Date.parse(e.published)) && (now - Date.parse(e.published)) / DAY >= minAgeDays)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .slice(0, n);
  if (long.length < minVideos) return { ok: false, why: `only ${long.length} long videos at least ${minAgeDays} days old in the feed (need ${minVideos})` };
  const v = long.map((e) => e.views).sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const typical = v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  return { ok: true, measured: { n: long.length, typical, best: v[v.length - 1], at: today, method: `median of the last ${long.length} long videos in the public feed, each at least ${minAgeDays} days old` } };
}

async function main() {
  const a = args();
  if (!a.channels || !a.today || !a.out) { console.error('usage: measure.mjs --channels <channels.json> --today YYYY-MM-DD --out <measured.json>'); process.exit(2); }
  let out;
  try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
  const channels = JSON.parse(readFileSync(a.channels, 'utf8'));
  const result = {};
  let ok = 0;
  for (const [creator, id] of Object.entries(channels)) {
    if (!/^UC[\w-]{20,}$/.test(String(id))) { result[creator] = { error: 'not a channel id (starts with UC)' }; continue; }
    try {
      // A stalled feed must not hang the run: each request gets 15 seconds.
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`feed answered ${res.status}`);
      const m = measure(parseFeed(await res.text()), a.today);
      result[creator] = m.ok ? { measured: m.measured } : { error: m.why };
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
