#!/usr/bin/env node
// Measure a creator through the YouTube Data API (youtube-api.mjs, the only door to YouTube): the median views of
// their recent long videos, the best of those, and the date. Left out: anything of 3 minutes or less (it may be a
// Short), live and upcoming videos, and videos under 7 days old, whose views are still climbing. The output is dated
// overrides for roster.mjs --extra, so a number is quotable for 30 days after it was measured and then must be
// measured again.
//
//   NODE_USE_ENV_PROXY=1 node agency-desk/scripts/measure.mjs --channels <private channels.json> --today YYYY-MM-DD \
//        --out <measured.json> --ledger <ledger.json>
//        channels.json: { "<creator as in the Creators tab>": "<@handle, channel link, or channel id starting UC>" }
//   The key is never here: the session's proxy adds it from Leif's saved secret, and Node's fetch only goes through
//   the proxy with NODE_USE_ENV_PROXY=1. About 3 units a creator, counted in --ledger. --out is written after every
//   creator and a creator already measured today is skipped, so after a stop (exit 3, with the plain reason) the
//   same command carries on where it stopped.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { args, isMain, assertOutsideRepo } from './lib.mjs';
import { ApiStop, createLedger, channel, uploads, videos, nextChunk } from './youtube-api.mjs';

const DAY = 86_400_000;
const SHORT_MAX_SEC = 180;

// A channel may be given as its id (UC...), a /channel/UC... link, an @handle or a youtube.com/@handle link.
// Ids are used as they are; handles are looked up through the API.
export function channelRef(value) {
  const v = String(value || '').trim();
  const id = v.match(/^(UC[\w-]{20,})$/) || v.match(/youtube\.com\/channel\/(UC[\w-]{20,})/);
  if (id) return { id: id[1] };
  const handle = v.match(/^@([\w.-]{3,})$/) || v.match(/youtube\.com\/@([\w.-]{3,})/);
  if (handle) return { handle: handle[1] };
  return { error: 'not a channel id, a channel link or an @handle' };
}

// API videos -> the entries measure() reads. The API has no Shorts flag and a Short can now run 3 minutes, so a video
// of 180 seconds or less, or of unknown length, counts as short and stays out of the long-video median: fail closed.
// A live or upcoming video is left out entirely, because its views are not settled.
export function entriesFromVideos(vids) {
  return vids.filter((v) => !v.live).map((v) => ({
    link: `https://www.youtube.com/watch?v=${v.id}`,
    published: v.publishedAt,
    views: v.views,
    title: v.title,
    short: !(v.durationSec > SHORT_MAX_SEC),
  }));
}

// The videos a measurement is taken from: the newest n long ones that are at least minAgeDays old. Exported so
// that any other sum over a creator's videos (an average, an engagement rate) uses the very same ones.
export function recentLong(entries, today, { n = 12, minAgeDays = 7 } = {}) {
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error('measure needs --today YYYY-MM-DD');
  return entries
    .filter((e) => !e.short && Number.isFinite(e.views) && !Number.isNaN(Date.parse(e.published)) && (now - Date.parse(e.published)) / DAY >= minAgeDays)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .slice(0, n);
}

export function measure(entries, today, { n = 12, minAgeDays = 7, minVideos = 6 } = {}) {
  const long = recentLong(entries, today, { n, minAgeDays });
  // The newest long video is the true detail a note can open with, whatever its age.
  const newest = entries.filter((e) => !e.short && !Number.isNaN(Date.parse(e.published))).sort((a, b) => Date.parse(b.published) - Date.parse(a.published))[0];
  const latest = newest ? { title: newest.title || '', link: newest.link, published: String(newest.published).slice(0, 10) } : null;
  if (long.length < minVideos) return { ok: false, latest, why: `only ${long.length} long videos at least ${minAgeDays} days old in the last 50 uploads (need ${minVideos})` };
  const v = long.map((e) => e.views).sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const typical = v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  return { ok: true, latest, measured: { n: long.length, typical, best: v[v.length - 1], at: today, method: `YouTube Data API: median of the last ${long.length} long videos, each at least ${minAgeDays} days old` } };
}

// One creator: the channel, its last 50 uploads, those videos, the measurement. Three units.
async function measureOne(value, today, api) {
  const ref = channelRef(value);
  if (ref.error) return { error: ref.error };
  const ch = await channel(ref, api);
  if (!ch) return { error: 'no channel with this id or handle' };
  const who = { id: ch.id, title: ch.title, country: ch.country };
  const ups = ch.uploads ? await uploads(ch.uploads, { max: 50 }, api) : [];
  const m = measure(entriesFromVideos(await videos(ups.map((u) => u.videoId), api)), today);
  if (!m.ok) return { error: m.why, latest: m.latest, channel: who };
  return { measured: { ...m.measured, fetchedAt: api.now().toISOString() }, latest: m.latest, channel: who };
}

// Every creator, saved as each one lands. An ApiStop ends the run with what is saved left in place, and the next
// launch skips whoever is already measured today: a resume is just a fresh launch. api is youtube-api.mjs's ctx.
export async function measureAll(channels, today, { out: file, now = () => new Date(), ...api }) {
  const out = assertOutsideRepo(file);
  const result = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  const todo = nextChunk(Object.entries(channels), { isSaved: ([creator]) => result[creator]?.measured?.at === today });
  for (const [creator, value] of todo) {
    try {
      result[creator] = await measureOne(value, today, { now, ...api });
    } catch (e) {
      if (e instanceof ApiStop) throw e;
      result[creator] = { error: `could not measure: ${e.message}` };
    }
    writeFileSync(out, JSON.stringify(result, null, 2));
  }
  return result;
}

async function main() {
  const a = args();
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(String(a.today)) && !Number.isNaN(Date.parse(a.today));
  if (!a.channels || !dated || !a.out || !a.ledger) { console.error('usage: measure.mjs --channels <channels.json> --today YYYY-MM-DD --out <measured.json> --ledger <ledger.json>'); process.exit(2); }
  let out;
  let ledger;
  try { out = assertOutsideRepo(a.out); ledger = createLedger(a.ledger); } catch (e) { console.error(e.message); process.exit(2); }
  const channels = JSON.parse(readFileSync(a.channels, 'utf8'));
  const total = Object.keys(channels).length;
  const measuredToday = (result) => Object.keys(channels).filter((c) => result[c]?.measured?.at === a.today).length;
  try {
    const ok = measuredToday(await measureAll(channels, a.today, { out, ledger }));
    console.log(`measured ${ok} of ${total} creators (YouTube Data API); merge the "measured" entries into the roster overrides (--extra)`);
    process.exit(ok ? 0 : 1);
  } catch (e) {
    if (!(e instanceof ApiStop)) throw e;
    const ok = measuredToday(existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {});
    console.error(`${e.message}\nstopped with ${ok} of ${total} creators measured and saved; the same command carries on from there`);
    process.exit(3);
  }
}

if (isMain(import.meta.url)) main();
