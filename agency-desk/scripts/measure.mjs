#!/usr/bin/env node
// Measure a creator from their public YouTube feed, with no key: the median views of their recent long videos, the
// best of those, and the date. Shorts are left out (the feed links them as /shorts/), and so are videos under 7 days
// old, whose views are still climbing. The output is dated overrides for roster.mjs --extra, so a number is quotable
// for 30 days after it was measured and then must be measured again.
//
//   node agency-desk/scripts/measure.mjs --channels <private channels.json> --today YYYY-MM-DD --out <measured.json>
//        channels.json: { "<creator as in the Creators tab>": "<@handle, channel link, or channel id starting UC>" }
//   Needs www.youtube.com reachable: run it on a machine with internet (a Mac session) when the cloud environment
//   blocks it, and save the output to the Drive folder. Check one creator by hand on the first run:
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
