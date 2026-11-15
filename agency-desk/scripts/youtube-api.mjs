#!/usr/bin/env node
// The only door to YouTube. YouTube's terms ban scripts reading its pages, and its robots.txt disallows the search
// page and the feed, so the desk reads the official YouTube Data API v3 and nothing else. Every other desk script
// reads through this file, and a test fails if a network call appears in any of them.
//
// The key is never here: not in code, files, logs or links. Leif saves it as a network secret for
// www.googleapis.com (header X-Goog-Api-Key) and the session's HTTPS proxy adds that header by itself, so this code
// makes plain requests. Node's fetch only goes through the proxy when run with NODE_USE_ENV_PROXY=1.
//
//   NODE_USE_ENV_PROXY=1 node agency-desk/scripts/youtube-api.mjs --check --ledger <ledger.json outside the repo>
//        one 1-unit call: prints "key works · 1 unit", or the plain reason it stopped (exit 3)
import { readFileSync, writeFileSync, existsSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { args, isMain, assertOutsideRepo } from './lib.mjs';

export const BASE = 'https://www.googleapis.com/youtube/v3/';
const KEY_PARAM = /^(key|api_key|access_token)$/i;
const KEY_SHAPE = /AIza[\w-]{30,}/; // how a Google API key looks

// A link under BASE and nowhere else, with no key in it: links end up in logs, errors and shell history.
export function apiUrl(path, params = {}) {
  // One resource name ("videos", "i18nRegions") and nothing more, so no scheme, host, slash, dot or query rides in.
  if (typeof path !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(path)) throw new Error('apiUrl takes one YouTube Data API resource name such as "videos", never a link or a path');
  const url = new URL(path, BASE);
  for (const [name, value] of Object.entries(params)) {
    if (KEY_PARAM.test(name)) throw new Error(`the key never goes in a link (param "${name}"): the proxy adds it as a header`);
    // The API bills a request it refuses, so a call without its id or its query is stopped here.
    if (value === undefined || value === null || value === '') throw new Error(`param "${name}" has no value`);
    url.searchParams.set(name, String(value));
  }
  if (KEY_SHAPE.test(url.href)) throw new Error('something in this link looks like a Google key: the key never goes in a link');
  return url.href;
}

// Why a run stopped, in plain words: Leif reads these. Midnight Pacific is 7pm in Sydney from November to March and
// up to two hours earlier the rest of the year, so "after 7pm" holds all year.
const SAY = {
  redirect: "YouTube's API answered with a redirect, and a redirect is never followed",
  'key-missing': "the YouTube key is missing or not valid for this API: it is saved in this environment's settings as a network secret for www.googleapis.com (header X-Goog-Api-Key), never typed into a chat or a file",
  'api-not-enabled': "the key arrived but the API is switched off: turn on YouTube Data API v3 for the key's project",
  quota: "today's YouTube allowance is used up: it resumes after 7pm Sydney (midnight Pacific)",
  'quota-local': "the desk's own daily cap is reached (90 searches or 9,000 units): it resumes after 7pm Sydney (midnight Pacific)",
  rate: 'YouTube says too many requests came at once: wait a minute, then launch again',
  network: 'could not reach www.googleapis.com: check that the environment allows that host and that the run starts with NODE_USE_ENV_PROXY=1',
  server: "YouTube's API failed on its side twice in a row: try again later",
};

// A stop ends the whole run (exit 3), unlike one creator's "not found". `reason` is one of the names above.
export class ApiStop extends Error {
  constructor(reason, detail) {
    super(detail ? `${SAY[reason]} (${detail})` : SAY[reason]);
    this.name = 'ApiStop';
    this.reason = reason;
  }
}

// The unit ledger, a private file outside the repo: { "<Pacific day>": { "units": n, "searches": n } }. YouTube gives
// a project 10,000 units a day and starts again at midnight Pacific. A search costs 100 units and any other call 1,
// and the desk stops itself at 90 searches or 9,000 units, so a slip in the count never reaches YouTube's own limit.
export const LIMITS = { units: 9_000, searches: 90 };

export function pacificDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// What the day has used so far. A ledger that cannot be read stops the call (a count is never guessed as zero), and
// so does one that could not be written afterwards.
function readLedger(file, day) {
  try { accessSync(dirname(file), constants.W_OK); } catch { throw new Error(`the unit ledger's folder cannot be written (${dirname(file)}): a call that cannot be counted is not made`); }
  let all = {};
  try { if (existsSync(file)) all = JSON.parse(readFileSync(file, 'utf8')); } catch { all = null; }
  const sound = all && typeof all === 'object' && !Array.isArray(all);
  const used = sound && Object.hasOwn(all, day) ? all[day] : { units: 0, searches: 0 };
  const whole = (n) => Number.isInteger(n) && n >= 0;
  if (!sound || !whole(used?.units) || !whole(used?.searches)) {
    throw new Error(`the unit ledger at ${file} cannot be read: mend it or delete it by hand, it is never counted as zero`);
  }
  return { all, units: used.units, searches: used.searches };
}

// The ledger a run counts in, checked before the run starts: outside the repo and readable. It hands back the
// file's path, which is what ctx.ledger takes.
export function createLedger(file) {
  const path = assertOutsideRepo(file);
  readLedger(path, pacificDay(new Date()));
  return path;
}

function spend(file, day, cost, search) {
  const { all, units, searches } = readLedger(file, day);
  all[day] = { units: units + cost, searches: searches + search };
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}

// One request, with a deadline that also covers reading the answer. It is never followed anywhere, and it carries
// no header at all: the proxy adds the key, so a credential written here could only ever be a leak.
async function ask(url, fetch, timeoutMs) {
  let res;
  let text;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) {
    throw new ApiStop('network', e?.name === 'TimeoutError' ? `no answer in ${timeoutMs / 1000} seconds` : e?.cause?.code || e?.cause?.message || e?.message);
  }
  if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') throw new ApiStop('redirect', `status ${res.status}`);
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: there is nothing to read from it */ }
  return { status: res.status, body };
}

// One counted call. ctx is { ledger, fetch, now, cost, timeoutMs, retryMs }: the ledger is required, the rest are
// for tests. Returns the answer's JSON; throws an ApiStop when the run must end, and a plain error (with `status`
// and `reason`) for an answer about this one request, such as a 404, which a reader may turn into "not found".
export async function apiGet(path, params = {}, { fetch = globalThis.fetch, ledger, cost = path === 'search' ? 100 : 1, now = () => new Date(), timeoutMs = 15_000, retryMs = 1_000 } = {}) {
  const url = apiUrl(path, params);
  if (!ledger) throw new Error('apiGet needs a ledger file: a call that cannot be counted is not made');
  const file = assertOutsideRepo(ledger);
  const day = pacificDay(now());
  const search = path === 'search' ? 1 : 0;
  const used = readLedger(file, day);
  if (used.searches + search > LIMITS.searches || used.units + cost > LIMITS.units) throw new ApiStop('quota-local');

  let res = await ask(url, fetch, timeoutMs);
  if (res.status >= 500) { // often a blip: one more try a moment later, and no more
    await new Promise((r) => { setTimeout(r, retryMs); });
    res = await ask(url, fetch, timeoutMs);
    if (res.status >= 500) throw new ApiStop('server', `status ${res.status}`);
  }
  if (res.status >= 400) {
    // Google names the reason in errors[].reason, in details[].reason or in status, depending on the error's age.
    const error = res.body?.error;
    const reasons = [].concat(error?.errors || [], error?.details || [], { reason: error?.status }).map((x) => x?.reason).filter((r) => typeof r === 'string' && /^\w+$/.test(r));
    const has = (...names) => names.some((n) => reasons.includes(n));
    const keyRefused = reasons.some((r) => r.startsWith('API_KEY_')); // not valid, expired, or blocked by its own restrictions
    if (res.status === 401 || keyRefused || /unregistered callers|API key not valid|missing a valid API key/i.test(String(error?.message))) throw new ApiStop('key-missing');
    if (has('accessNotConfigured', 'SERVICE_DISABLED')) throw new ApiStop('api-not-enabled');
    if (has('quotaExceeded', 'dailyLimitExceeded')) throw new ApiStop('quota');
    if (res.status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded')) throw new ApiStop('rate');
    spend(file, day, cost, search); // the API bills a request it refuses, too
    const err = new Error(`YouTube's API answered ${res.status}${reasons[0] ? ` (${reasons[0]})` : ''}`);
    err.status = res.status;
    err.reason = reasons[0];
    throw err;
  }
  spend(file, day, cost, search);
  if (!res.body || typeof res.body !== 'object') throw new Error("YouTube's API answered, but not in JSON");
  return res.body;
}

// API counts arrive as strings. One that is not there is null, never 0: "hidden" and "none" are different facts.
const count = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.isInteger(v) ? v : null);
// A page size the API will take: a whole number from 1 up to the most one call returns.
const pageSize = (max, most) => Math.min(Math.max(Math.trunc(max) || 1, 1), most);

// ref is what channelRef() in measure.mjs returns: { id } or { handle }. null when YouTube has no such channel.
export async function channel(ref, ctx) {
  const who = ref?.id ? { id: ref.id } : ref?.handle ? { forHandle: `@${ref.handle}` } : null;
  if (!who) throw new Error('channel() takes what channelRef() returns: { id } or { handle }');
  const c = (await apiGet('channels', { part: 'snippet,contentDetails,statistics', ...who }, ctx)).items?.[0];
  if (!c) return null;
  const hidden = c.statistics?.hiddenSubscriberCount === true;
  return {
    id: c.id,
    handle: c.snippet?.customUrl || null, // as YouTube writes it, with the @
    title: c.snippet?.title || '',
    description: c.snippet?.description || '',
    country: c.snippet?.country || null,
    uploads: c.contentDetails?.relatedPlaylists?.uploads || null,
    subscribers: hidden ? null : count(c.statistics?.subscriberCount), // YouTube rounds it down to three figures
    hiddenSubscribers: hidden,
    videoCount: count(c.statistics?.videoCount),
  };
}

// The newest uploads of a channel's uploads list, in one call (the API gives at most 50 a call).
export async function uploads(playlistId, { max = 50 } = {}, ctx) {
  let body;
  try {
    body = await apiGet('playlistItems', { part: 'contentDetails', playlistId, maxResults: pageSize(max, 50) }, ctx);
  } catch (e) {
    if (e.reason === 'playlistNotFound') return []; // a channel with no public uploads
    throw e;
  }
  return (body.items || []).filter((i) => i.contentDetails?.videoId)
    .map((i) => ({ videoId: i.contentDetails.videoId, publishedAt: i.contentDetails.videoPublishedAt || null }));
}

// The length as YouTube writes it: PT12M34S, PT1H2M3S, P1DT2H for a day-long stream, P0D while a video is live.
export function durationSec(iso) {
  const m = /^P(?=\d|T\d)(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x || 0));
  return ((d * 24 + h) * 60 + min) * 60 + s;
}

// Videos by id, 50 a call, with the full and exact title and description: the only place a quote may come from.
// The API has no Shorts flag, so durationSec is what tells a long video; `live` is true while a video is live or
// still to come, when its views and its length mean nothing yet.
export async function videos(ids, ctx) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await apiGet('videos', { part: 'snippet,contentDetails,statistics,paidProductPlacementDetails', id: ids.slice(i, i + 50).join(',') }, ctx);
    for (const v of body.items || []) {
      out.push({
        id: v.id,
        channelId: v.snippet?.channelId || null,
        title: v.snippet?.title || '',
        description: v.snippet?.description || '',
        publishedAt: v.snippet?.publishedAt || null,
        durationSec: durationSec(v.contentDetails?.duration),
        views: count(v.statistics?.viewCount),
        likes: count(v.statistics?.likeCount), // null when the creator hides likes
        comments: count(v.statistics?.commentCount), // null when comments are off
        paid: v.paidProductPlacementDetails?.hasPaidProductPlacement ?? null, // the creator's own "paid promotion" tick
        tags: v.snippet?.tags || [],
        lang: v.snippet?.defaultAudioLanguage || null,
        live: ['live', 'upcoming'].includes(v.snippet?.liveBroadcastContent),
      });
    }
  }
  return out;
}

// What viewers wrote and what the creator answered: words, likes and dates only. Who wrote a comment is never
// returned or kept, by name or by channel id; an author's id is read once, to tell the creator's own replies apart.
// A thread carries only a few of its replies, so ownerReplies is a sample and never a count.
export async function topComments(videoId, { max = 20 } = {}, ctx) {
  let body;
  try {
    body = await apiGet('commentThreads', { part: 'snippet,replies', videoId, order: 'relevance', textFormat: 'plainText', maxResults: pageSize(max, 100) }, ctx);
  } catch (e) {
    if (e.reason === 'commentsDisabled') return { disabled: true, comments: [], ownerReplies: [] };
    throw e;
  }
  const words = (s) => s.textOriginal ?? s.textDisplay ?? '';
  const comments = [];
  const ownerReplies = [];
  for (const t of body.items || []) {
    const top = t.snippet?.topLevelComment?.snippet;
    if (top) comments.push({ text: words(top), likes: count(top.likeCount), publishedAt: top.publishedAt || null });
    for (const r of t.replies?.comments || []) {
      const by = r.snippet?.authorChannelId?.value;
      if (by && by === t.snippet?.channelId) ownerReplies.push({ text: words(r.snippet), publishedAt: r.snippet.publishedAt || null });
    }
  }
  return { disabled: false, comments, ownerReplies };
}

// Videos that mention a brand, newest first. A search costs 100 units. The titles and snippets it returns are
// HTML-escaped (&amp;, &#39;) and cut short, so nothing is ever quoted from them: a quote comes from videos().
export async function searchMentions(query, { max = 25, publishedAfter } = {}, ctx) {
  // A date that is not one throws here, before it can cost 100 units.
  const after = publishedAfter ? { publishedAfter: new Date(publishedAfter).toISOString() } : {};
  const body = await apiGet('search', { part: 'snippet', type: 'video', order: 'date', q: query, maxResults: pageSize(max, 50), ...after }, ctx);
  return (body.items || []).filter((i) => i.id?.videoId).map((i) => ({
    videoId: i.id.videoId,
    channelId: i.snippet?.channelId || null,
    channelTitle: i.snippet?.channelTitle || '',
    title: i.snippet?.title || '',
    snippet: i.snippet?.description || '',
    publishedAt: i.snippet?.publishedAt || null,
  }));
}

// The next `limit` items that are not saved yet (all of them when there is no limit). A long job runs as short
// launches: each launch takes one chunk and saves as it goes, so a resume is just a fresh launch.
export function nextChunk(items, { limit, isSaved }) {
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error('limit must be a whole number above 0');
  const todo = items.filter((x) => !isSaved(x));
  return limit === undefined ? todo : todo.slice(0, limit);
}

async function main() {
  const a = args();
  if (!a.check || typeof a.ledger !== 'string') { console.error('usage: youtube-api.mjs --check --ledger <ledger.json outside the repo>'); process.exit(2); }
  let ledger;
  try { ledger = createLedger(a.ledger); } catch (e) { console.error(e.message); process.exit(2); }
  try {
    // The cheapest call there is, and it names no creator and no brand: the list of regions.
    const body = await apiGet('i18nRegions', { part: 'snippet' }, { ledger });
    if (!String(body.kind).startsWith('youtube#')) throw new Error('the answer did not come from the YouTube Data API');
    console.log('key works · 1 unit');
  } catch (e) {
    console.error(e.message);
    process.exit(e instanceof ApiStop ? 3 : 1);
  }
}

if (isMain(import.meta.url)) main();
