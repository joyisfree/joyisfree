#!/usr/bin/env node
// The one command behind "personalise …". Leif names a creator, or pastes one brand person's own LinkedIn posts;
// this reads what there is to read (the YouTube Data API for a creator, the paste for a person), checks it is the
// right person, and writes the evidence and the page a brief is written from. Private files only: every path is
// refused inside this public repository, and every name it researches joins the private terms list.
//
//   node agency-desk/scripts/person.mjs --creator @handle --today YYYY-MM-DD --out <private dir> --ledger <file> --terms <private terms.txt>
//        [--found-by-name --email a@b --domain b.com --niche shed,garden --country AU] [--overrides <private overrides.json>]
//   node agency-desk/scripts/person.mjs --person "Name" --brand "Brand" --paste <file> [--screenshot] --today … --out … --terms …
//   node agency-desk/scripts/person.mjs --brands <worklist.json> --limit 40 --today … --out … --ledger … --terms …
//   node agency-desk/scripts/person.mjs --prune --today YYYY-MM-DD --out <private dir> [--overrides <private overrides.json>]
//   node agency-desk/scripts/person.mjs --forget "Name / Brand" --out <private dir>
//
// Run with NODE_USE_ENV_PROXY=1: the session's proxy adds the saved YouTube key, which this code never sees.
// Every run starts with the prune: YouTube data is refreshed or deleted within 30 days.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { args, isMain, assertOutsideRepo, registrable, emailDomain, stem, token, WEBMAIL } from './lib.mjs';
import { evidencePack, linkedinPosts, briefInput, closeRead, managedBy, sponsorLines, lengthKind, REFRESH_DAYS } from './digest.mjs';
import { channelRef } from './measure.mjs';
import { appendTerms } from './privacy-gate.mjs';

const DAY = 86_400_000;
const WARN_DAYS = 25;
const COUNTRY = { australia: 'AU', 'united states': 'US', usa: 'US', america: 'US', 'united kingdom': 'GB', uk: 'GB', england: 'GB', canada: 'CA', 'new zealand': 'NZ', japan: 'JP', spain: 'ES', germany: 'DE', france: 'FR', ireland: 'IE' };
const iso2 = (c) => { const s = String(c || '').trim(); return /^[a-z]{2}$/i.test(s) ? s.toUpperCase().replace('UK', 'GB') : COUNTRY[s.toLowerCase()] || ''; };

export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Is this channel the person Leif means? An exact handle from Leif is its own proof. A channel found by name must
// carry the sheet's address or its domain, or match on niche and country; a same-name channel once turned out to
// be another agency's talent, so a channel someone else manages is never accepted on a name.
export function identity(channel, expected = {}, videos = []) {
  const desc = String(channel?.description || '').toLowerCase();
  const managed = managedBy(channel?.description);
  if (expected.given) return { matched: 'handle', managed, why: 'the exact channel Leif gave' };
  if (managed) return { matched: '', managed, why: 'this channel is managed by someone else, so it is not accepted as the person on the sheet' };
  const email = String(expected.email || '').trim().toLowerCase();
  if (email && desc.includes(email)) return { matched: 'email', managed, why: 'the sheet address is on the channel' };
  const domain = registrable(expected.domain || emailDomain(email));
  if (domain && !WEBMAIL.has(domain) && desc.includes(domain)) return { matched: 'domain', managed, why: `the channel names ${domain}` };
  const want = iso2(expected.country);
  const hay = [channel?.title, channel?.description, ...videos.map((v) => v.title)].join(' ').toLowerCase();
  const niche = [...new Set((expected.niche || []).map((w) => String(w).trim().toLowerCase()).filter((w) => w.length >= 3))];
  if (want && iso2(channel?.country) === want && niche.filter((w) => hay.includes(w)).length >= 2) return { matched: 'niche+country', managed, why: 'the niche and the country both match the sheet' };
  return { matched: '', managed, why: 'this channel could not be matched to the person on the sheet (no address, no domain, and no niche-and-country match)' };
}

function save(root, name, pack, group = 'people') {
  const dir = join(root, group, slug(name));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(pack, null, 1));
  writeFileSync(join(dir, 'brief-input.md'), briefInput(pack));
  return dir;
}

// `api` is the four YouTube Data API readers (channel, uploads, videos, topComments), passed in so a test can
// stand in for the network. Nothing is written unless the channel exists and passes the identity gate.
export async function creatorRun({ ref, expected = {}, today, now = new Date().toISOString(), api, out, termsFile }) {
  const root = assertOutsideRepo(out);
  const channel = await api.channel(ref);
  if (!channel) return { ok: false, why: 'channel not found: check the handle' };
  const ups = channel.uploads ? await api.uploads(channel.uploads, { max: 50 }) : [];
  const videos = ups.length ? await api.videos(ups.map((u) => u.videoId)) : [];
  const id = identity(channel, expected, videos);
  if (!id.matched) return { ok: false, why: id.why };
  // Comments cost a call each, so only the closely-read videos get them. A stop here (the day's quota) keeps what
  // was read: the pack then says the comments were not checked, never that there were none.
  let comments = {};
  let stopped = '';
  for (const vid of closeRead(videos)) {
    try { comments[vid] = await api.topComments(vid, { max: 20 }); } catch (e) {
      if (e?.name !== 'ApiStop') throw e;
      stopped = e.message;
      break;
    }
  }
  if (stopped && !Object.keys(comments).length) comments = undefined;
  const pack = { ...evidencePack({ channel, videos, comments, fetchedAt: now, today }), identity: id.matched, ...(stopped ? { stopped } : {}) };
  const dir = save(root, channel.handle || ref.handle || channel.id, pack);
  const brands = pack.items.filter((i) => (i.kind === 'sponsor' || i.kind === 'standing') && i.brand).map((i) => i.brand);
  if (termsFile) appendTerms(termsFile, [String(channel.handle || '').replace(/^@/, ''), channel.title, ...brands]);
  return { ok: true, dir, pack };
}

// One brand person's own LinkedIn posts, from the text Leif pasted (or Claude typed out from his screenshots).
// The pasted file is deleted once it has been read; the chat it came through still holds it.
export function personRun({ brand, person, pasteFile, source = 'paste', today, now = new Date().toISOString(), out, termsFile }) {
  const root = assertOutsideRepo(out);
  const read = linkedinPosts(readFileSync(pasteFile, 'utf8'), { name: person, company: brand, today, source });
  unlinkSync(pasteFile);
  if (!read.posts.length) return { ok: false, why: `none of ${person}'s own posts were found in the paste`, dropped: read.dropped, flags: read.flags };
  const pack = {
    who: { kind: 'person', name: person, brand }, fetchedAt: now, refreshBy: new Date(Date.parse(now) + REFRESH_DAYS * DAY).toISOString().slice(0, 10),
    headline: read.headline, flags: read.flags, dropped: read.dropped, items: read.posts,
  };
  const dir = save(root, `${person} / ${brand}`, pack);
  if (termsFile) appendTerms(termsFile, [person, brand]);
  return { ok: true, dir, posts: read.posts.length, dropped: read.dropped, flags: read.flags, headline: read.headline };
}

// ---- Round 2: the homework for a brand, all through the YouTube Data API ----

const ENDINGS = [['.com.au', 'AU'], ['.net.au', 'AU'], ['.au', 'AU'], ['.co.uk', 'GB'], ['.uk', 'GB'], ['.co.nz', 'NZ'], ['.nz', 'NZ'], ['.ca', 'CA'], ['.us', 'US'], ['.de', 'DE'], ['.fr', 'FR'], ['.ie', 'IE'], ['.es', 'ES'], ['.it', 'IT'], ['.nl', 'NL'], ['.jp', 'JP']];
// Where a brand's people most likely are, from what is already held: the domain's ending, then the country of its
// matched channel. Unknown stays unknown: Canada's law covers a LinkedIn message, so a guess is never made.
export function brandCountry(brand, channel, matched) {
  const d = String(brand.domain || '').toLowerCase();
  const hit = ENDINGS.find(([end]) => d.endsWith(end));
  if (hit) return { country: hit[1], from: 'domain' };
  if (matched && iso2(channel?.country)) return { country: iso2(channel.country), from: 'channel' };
  return { country: '', from: '' };
}

// At most two guesses at a brand's own handle (one unit each): its domain's name, then its label.
export function handleGuesses(brand) {
  return [...new Set([stem(brand.domain), token(brand.label)].filter((h) => h && h.length >= 3))].slice(0, 2);
}

// A channel is the brand's own only when it names the brand's domain, or when its handle is the domain's name and
// its title carries the brand's name. A guessed handle that fails both is somebody else's channel.
export function channelMatch(channel, brand) {
  if (!channel) return '';
  const domain = registrable(brand.domain);
  if (domain && String(channel.description || '').toLowerCase().includes(domain)) return 'domain';
  const handle = String(channel.handle || '').replace(/^@/, '').toLowerCase();
  const name = token(brand.label);
  if (handle && handle === stem(brand.domain) && name.length >= 3 && token(channel.title).includes(name)) return 'handle';
  return '';
}

const wholeWord = (word, text) => new RegExp(`(^|[^a-z0-9])${String(word).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}($|[^a-z0-9])`).test(String(text || '').toLowerCase());
// Does a creator's video really name this brand? Its own title or description must carry the name as a whole word,
// plus one more sign that it is this brand and not a common word: the brand's domain, its handle, or a sponsor
// line that names it. "Partnered" is said only on a sponsor line or YouTube's paid flag; otherwise "featured".
export function confirmMention(video, brand, handle = '') {
  const text = `${video.title || ''}\n${video.description || ''}`;
  if (!wholeWord(brand.label, text)) return { confirmed: false, paid: false, why: "the video's own text does not name the brand" };
  const domain = registrable(brand.domain);
  const low = String(video.description || '').toLowerCase();
  const sponsor = sponsorLines(video.description).some((s) => wholeWord(brand.label, s.text));
  const sign = sponsor || (domain && low.includes(domain)) || (handle && low.includes(`@${String(handle).replace(/^@/, '').toLowerCase()}`));
  if (!sign) return { confirmed: false, paid: false, why: 'named, but with no domain, handle or sponsor line to show it is this brand' };
  return { confirmed: true, paid: sponsor || video.paid === true, why: sponsor ? 'a sponsor line names the brand' : 'the description carries the brand\'s domain or handle' };
}

// Brands already paying creators go first (the sheet's own "Source" column), then the core niche, then the rest.
// Warm brands have a live thread and held brands wait, so neither is researched here.
export function doFirst(worklist) {
  const order = { core: 1, home: 2, other: 3 };
  return worklist.filter((b) => order[b.tier]).sort((a, b) => Number(Boolean(b.ima?.sponsor)) - Number(Boolean(a.ima?.sponsor)) || order[a.tier] - order[b.tier]);
}

// One brand: its own channel (if one can be proved), its latest uploads, and creators' videos that really name it.
// About 104 units, almost all of it the one search.
export async function brandRun({ brand, today, now = new Date().toISOString(), api, out, termsFile }) {
  const root = assertOutsideRepo(out);
  let channel = null;
  let matched = '';
  const rejected = [];
  for (const h of handleGuesses(brand)) {
    const c = await api.channel({ handle: h });
    const m = channelMatch(c, brand);
    if (m) { channel = c; matched = m; break; }
    if (c) rejected.push(`@${h}: a channel exists, but it does not name ${registrable(brand.domain) || 'the brand'}`);
  }
  const items = [];
  const date = (v) => String(v.publishedAt || '').slice(0, 10);
  const link = (v) => `https://www.youtube.com/watch?v=${v.id}`;
  if (channel?.uploads) {
    const ups = await api.uploads(channel.uploads, { max: 10 });
    const own = ups.length ? await api.videos(ups.map((u) => u.videoId)) : [];
    own.filter((v) => lengthKind(v) === 'long').slice(0, 5).forEach((v) => items.push({ id: `t:${v.id}`, kind: 'title', text: v.title, link: link(v), date: date(v), owner: 'self', source: 'api' }));
  }
  const since = new Date(Date.parse(today) - 365 * DAY).toISOString();
  const found = (await api.searchMentions(`"${brand.label}"`, { max: 25, publishedAfter: since })).filter((r) => r.channelId !== channel?.id);
  const full = found.length ? await api.videos(found.map((r) => r.videoId)) : [];
  let unconfirmed = 0;
  for (const v of full) {
    const c = confirmMention(v, brand, channel?.handle);
    if (!c.confirmed) { unconfirmed++; continue; }
    const by = found.find((r) => r.videoId === v.id)?.channelTitle || '';
    items.push({ id: `m:${v.id}`, kind: 'mention', text: v.title, link: link(v), date: date(v), owner: 'other', source: 'api', confirmed: true, paid: c.paid, by, why: c.why });
  }
  const where = brandCountry(brand, channel, matched);
  [['sheet:sponsor', brand.ima?.sponsor], ['sheet:notes', brand.ima?.notes], ['sheet:warm', brand.warmNotes]].filter(([, text]) => text)
    .forEach(([id, text]) => items.push({ id, kind: 'sheet', text, link: '', date: today, owner: 'leif', source: 'sheet' }));
  const mentions = items.filter((i) => i.kind === 'mention');
  const pack = {
    who: { kind: 'brand', name: brand.label, id: brand.id, domain: brand.domain || '', channelId: channel?.id || '', handle: channel?.handle || '', matched, country: where.country, countryFrom: where.from },
    fetchedAt: now, refreshBy: new Date(Date.parse(now) + REFRESH_DAYS * DAY).toISOString().slice(0, 10), rejected,
    summary: {
      channel: matched ? `its own channel, matched by ${matched}` : rejected.length ? 'no channel could be proved to be the brand\'s' : 'no channel found',
      mentions: `${mentions.length} creator video${mentions.length === 1 ? '' : 's'} named the brand (${mentions.filter((i) => i.paid).length} paid) · ${unconfirmed} search results did not`,
    },
    items,
  };
  const dir = save(root, brand.id, pack, 'brands');
  if (termsFile) appendTerms(termsFile, [brand.label, ...mentions.map((i) => i.by)]);
  return { ok: true, dir, pack };
}

// Evidence is deleted 30 days after it was read and listed for a refresh at 25, and a measured number in the
// private roster overrides goes the same way (a creator's yes stays). A pack with no readable date is deleted too.
export function prune({ out, today, overridesFile }) {
  const root = assertOutsideRepo(out);
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error('prune needs --today YYYY-MM-DD');
  const deleted = [];
  const refreshSoon = [];
  for (const group of ['people', 'brands']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const file = join(base, name, 'evidence.json');
      if (!existsSync(file)) continue;
      let at = NaN;
      try { at = Date.parse(JSON.parse(readFileSync(file, 'utf8')).fetchedAt); } catch { /* unreadable: treated as too old */ }
      const age = (now - at) / DAY;
      if (!(age < REFRESH_DAYS)) { rmSync(join(base, name), { recursive: true, force: true }); deleted.push(name); } else if (age >= WARN_DAYS) refreshSoon.push(name);
    }
  }
  const numbersDropped = [];
  if (overridesFile && existsSync(overridesFile)) {
    const file = assertOutsideRepo(overridesFile);
    const all = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, v] of Object.entries(all)) {
      if (!v?.measured) continue;
      const age = (now - Date.parse(v.measured.fetchedAt || v.measured.at || '')) / DAY;
      if (!(age < REFRESH_DAYS)) { delete v.measured; delete v.latest; numbersDropped.push(name); }
    }
    if (numbersDropped.length) writeFileSync(file, JSON.stringify(all, null, 2));
  }
  return { deleted, refreshSoon, numbersDropped };
}

// Forget removes what this script can reach. The copies it cannot reach are named, so nobody is told "erased"
// when it is not true.
export function forget({ out, name }) {
  const root = assertOutsideRepo(out);
  let removed = false;
  for (const group of ['people', 'brands']) {
    const dir = join(root, group, slug(name));
    if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); removed = true; }
  }
  return {
    removed,
    alsoClear: [
      "their tab and their Board row in the Desk doc (Claude removes them in the session; the doc's history still holds the old text, and only a fresh doc erases it)",
      'any Gmail draft to them (only Leif can delete a draft)',
      'this chat, which keeps whatever was pasted into it',
      'the private terms list keeps their name on purpose, so it can never slip into a public file later',
    ],
  };
}

async function main() {
  const a = args();
  const need = (k) => { if (!a[k] || a[k] === true) { console.error(`missing --${k}`); process.exit(2); } return a[k]; };
  try {
    if (a.forget) {
      const r = forget({ out: need('out'), name: a.forget });
      console.log(r.removed ? 'removed the saved evidence' : 'no saved evidence under that name');
      for (const x of r.alsoClear) console.log(`  still to clear: ${x}`);
      return;
    }
    const today = need('today');
    const out = need('out');
    const p = prune({ out, today, overridesFile: a.overrides === true ? undefined : a.overrides });
    console.log(`prune: ${p.deleted.length} deleted · ${p.refreshSoon.length} due for a refresh soon · ${p.numbersDropped.length} old numbers dropped`);
    for (const n of p.refreshSoon) console.log(`  refresh soon: ${n}`);
    for (const n of p.deleted) console.log(`  deleted (30 days): ${n} — clear or refresh their tab in the Desk doc`);
    if (a.prune) return;
    if (a.person) {
      const r = personRun({ brand: need('brand'), person: a.person, pasteFile: need('paste'), source: a.screenshot ? 'screenshot' : 'paste', today, out, termsFile: need('terms') });
      if (!r.ok) { console.log(`no card: ${r.why}${r.flags?.length ? ` (${r.flags.join('; ')})` : ''}`); process.exit(1); }
      console.log(`${r.posts} of their own posts kept · dropped: ${Object.entries(r.dropped).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}${r.flags.length ? ` · ${r.flags.join('; ')}` : ''}`);
      console.log(`evidence: ${r.dir}`);
      return;
    }
    const yt = await import('./youtube-api.mjs');
    const ctx = { ledger: yt.createLedger(need('ledger')) };
    const api = {
      channel: (r) => yt.channel(r, ctx), uploads: (pl, o) => yt.uploads(pl, o, ctx), videos: (ids) => yt.videos(ids, ctx),
      topComments: (id, o) => yt.topComments(id, o, ctx), searchMentions: (q, o) => yt.searchMentions(q, o, ctx),
    };
    if (a.brands) {
      // Short launches: the next brands that have no saved evidence yet. A stop keeps everything already saved.
      const list = doFirst(JSON.parse(readFileSync(a.brands, 'utf8')));
      const saved = (b) => existsSync(join(assertOutsideRepo(out), 'brands', slug(b.id), 'evidence.json'));
      const todo = yt.nextChunk(list, { limit: Number(a.limit) || 40, isSaved: saved });
      let hooks = 0;
      for (const brand of todo) {
        const r = await brandRun({ brand, today, api, out, termsFile: need('terms') });
        if (r.pack.items.some((i) => i.kind === 'mention' || i.kind === 'title')) hooks++;
      }
      const left = list.filter((b) => !saved(b)).length;
      console.log(`brands: ${todo.length} read this launch · ${hooks} with something true to open with · ${left} still to read of ${list.length}`);
      return;
    }
    const ref = channelRef(need('creator'));
    if (ref.error) { console.error(ref.error); process.exit(2); }
    const expected = {
      given: !a['found-by-name'], email: a.email === true ? '' : a.email, domain: a.domain === true ? '' : a.domain,
      niche: typeof a.niche === 'string' ? a.niche.split(',') : [], country: a.country === true ? '' : a.country,
    };
    const r = await creatorRun({ ref, expected, today, api, out, termsFile: need('terms') });
    if (!r.ok) { console.log(`no card: ${r.why}`); process.exit(1); }
    const s = r.pack.stats;
    console.log(`identity: ${r.pack.identity}${r.pack.managed ? ' · MANAGED BY SOMEONE ELSE' : ''} · ${r.pack.items.length} evidence items · refresh by ${r.pack.refreshBy}`);
    console.log(s.typical === null ? `no typical number: ${s.why}` : `typical ${s.typical} · best ${s.best.views} · ${s.engagement.rate === null ? 'engagement not available' : `${(s.engagement.rate * 100).toFixed(1)}% ${s.engagement.label}`}`);
    console.log(`sponsors: ${r.pack.summary.sponsors} · fans: ${r.pack.summary.fans}${r.pack.stopped ? ` · stopped early: ${r.pack.stopped}` : ''}`);
    console.log(`evidence: ${r.dir}`);
  } catch (e) {
    if (e?.name !== 'ApiStop') throw e;
    console.log(`stopped: ${e.message}`);
    process.exit(3);
  }
}

if (isMain(import.meta.url)) main();
