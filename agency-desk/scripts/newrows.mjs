#!/usr/bin/env node
// Who gets a draft next: everyone on the sheets with a name and an email who has no draft and no email from Leif yet.
// The automatic run drafts only for them, so nobody is drafted twice.
//
// "Seen" is any address, or any "Brand | Name" in a column headed Key, found in the files given to --seen: the
// Drafts log, a dump of Gmail drafts and sent mail, the pack. The sheet's own Contacted or Replied column counts too.
// A stop in the tracker is final. A creator who declined (or asked far above our budget) waits for a real brief.
// A brand person's address came from LinkedIn, so their draft waits On hold until they say yes there (Spam Act),
// unless the tracker already holds that yes. The newest rows come first, and one person per brand per run.
//
//   node agency-desk/scripts/newrows.mjs --li <dir> --ima <dir> --seen <file>[,<file>...] --out <newrows.json>
//        [--log <private events.jsonl>] [--max-creators 5] [--max-brands 3]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { args, isMain, assertOutsideRepo, readTable, parseCSV, col, emailDomain, registrable, brandKey, personKey, WEBMAIL } from './lib.mjs';
import { people } from './audit.mjs';
import { parseLog } from './tracker.mjs';

const ADDRESS = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const DECLINED = /(declin|not interested|no thanks|not for (me|us)|pass(ed)? on|wants? \$?\d|too (low|small)|budget)/i;
const norm = (k) => String(k || '').replace(/\s+/g, ' ').trim().toLowerCase();
const firstAddress = (s) => (String(s || '').match(ADDRESS) || [''])[0].toLowerCase();

// Every address in every text, and every value of a CSV column headed "Key".
export function seenFrom(texts) {
  const emails = new Set();
  const keys = new Set();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(ADDRESS)) emails.add(m[0].toLowerCase());
    const rows = parseCSV(String(t || ''));
    const k = (rows[0] || []).findIndex((h) => /^key$|key \(brand \| name\)/i.test(h.trim())); // the pack's own header too
    if (k >= 0) for (const r of rows.slice(1)) if (r[k] && r[k].includes(' | ')) keys.add(norm(r[k]));
  }
  return { emails, keys };
}

export function newRows(data, { seen = { emails: new Set(), keys: new Set() }, events = [], maxCreators = 5, maxBrands = 3 } = {}) {
  const stopped = new Set(events.filter((e) => e.event === 'stop').map((e) => norm(e.key)));
  const consented = new Set(events.filter((e) => e.event === 'yes' && !stopped.has(norm(e.key))).map((e) => norm(e.key)));
  const skipped = [];
  const used = new Set(); // one address is one person, however often it is listed
  let seenCount = 0;
  const isSeen = (key, email) => seen.emails.has(email) || seen.keys.has(norm(key));

  const creators = [];
  const infRows = data.influencers ? [...data.influencers.rows].reverse() : []; // the bottom of the tab is newest
  for (const r of infRows) {
    const name = col(r, 'Name').replace(/\s+/g, ' ').trim();
    const email = firstAddress(col(r, 'Email'));
    if (!name || !email || used.has(email)) continue;
    used.add(email);
    const key = personKey('Creator', name);
    const replied = col(r, 'Replied');
    if (stopped.has(norm(key))) { skipped.push({ key, why: 'said stop: never emailed again' }); continue; }
    if (isSeen(key, email)) { seenCount++; continue; }
    if (DECLINED.test(replied)) { skipped.push({ key, why: 'declined our budget: no email until a real brief at their price' }); continue; }
    if (col(r, 'Contacted') || replied) { seenCount++; continue; }
    const header = data.influencers.header;
    const detail = header.map((h, i) => (/^personalisation key word/i.test(h) ? (r._cells[i] || '').trim() : '')).filter(Boolean);
    creators.push({
      kind: 'creator', key, name, email, row: r._row, niche: col(r, 'Niche'), detail,
      folder: 'Ready to send', why: 'creator: the address they publish for business (a US creator waits for the postal line)',
    });
  }

  const brands = [];
  const ppl = data.sheet1 ? people(data.sheet1).reverse() : [];
  for (const p of ppl) {
    const email = firstAddress(p.email);
    if (!p.name || !email || used.has(email)) continue;
    used.add(email);
    if (stopped.has(norm(p.key))) { skipped.push({ key: p.key, why: 'said stop: never emailed again' }); continue; }
    if (isSeen(p.key, email) || p.contacted) { seenCount++; continue; }
    if (WEBMAIL.has(registrable(emailDomain(email)))) { skipped.push({ key: p.key, why: 'personal webmail found on LinkedIn: never used' }); continue; }
    const yes = consented.has(norm(p.key));
    brands.push({
      kind: 'brand', key: p.key, brand: p.brand, name: p.name, email, row: p.row, consent: yes,
      folder: yes ? 'Ready to send' : 'On hold',
      why: yes ? 'said yes on LinkedIn: their address may be emailed' : 'LinkedIn-found address: send only after they say yes on LinkedIn (Spam Act)',
    });
  }
  brands.sort((a, b) => Number(b.consent) - Number(a.consent)); // stable, so newest first within each group

  const pickedBrands = [];
  const brandsToday = new Set();
  for (const b of brands) {
    const k = brandKey(b.brand);
    if (pickedBrands.length < maxBrands && !brandsToday.has(k)) { pickedBrands.push(b); brandsToday.add(k); }
  }
  const pickedCreators = creators.slice(0, maxCreators);
  const waiting = creators.length - pickedCreators.length + brands.length - pickedBrands.length;
  return {
    creators: pickedCreators, brands: pickedBrands, skipped,
    counts: {
      creators: pickedCreators.length, brands: pickedBrands.length, consented: pickedBrands.filter((b) => b.consent).length,
      seen: seenCount, skipped: skipped.length, waiting,
    },
  };
}

export function summary({ counts, skipped }) {
  const n = counts.creators + counts.brands;
  if (!n) return `nothing new · already drafted or emailed ${counts.seen} · skipped ${counts.skipped}`;
  const s = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const why = skipped.reduce((m, x) => { const w = x.why.split(':')[0]; m[w] = (m[w] || 0) + 1; return m; }, {});
  return [
    `new: ${s(counts.creators, 'creator', 'creators')} · ${s(counts.brands, 'brand person', 'brand people')} (${counts.consented} with a yes, ${counts.brands - counts.consented} On hold for one)`,
    `${counts.waiting} more wait for the next runs · already drafted or emailed ${counts.seen} · skipped ${counts.skipped}${counts.skipped ? ` (${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`,
  ].join('\n');
}

function main() {
  const a = args();
  if (!a.li || !a.seen || !a.out) {
    console.error('usage: newrows.mjs --li <dir> --ima <dir> --seen <file>[,<file>...] --out <newrows.json> [--log <events.jsonl>] [--max-creators 5] [--max-brands 3]');
    process.exit(2);
  }
  let out;
  try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
  const table = (p) => (existsSync(p) ? readTable(readFileSync(p, 'utf8')) : null);
  const data = { sheet1: table(join(a.li, 'Sheet1.csv')), influencers: a.ima ? table(join(a.ima, 'Influencers.csv')) : null };
  const seen = seenFrom(String(a.seen).split(',').filter(Boolean).map((f) => readFileSync(f, 'utf8')));
  const events = a.log && existsSync(a.log) ? parseLog(readFileSync(a.log, 'utf8')) : [];
  const result = newRows(data, { seen, events, maxCreators: Number(a['max-creators'] || 5), maxBrands: Number(a['max-brands'] || 3) });
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(summary(result));
}

if (isMain(import.meta.url)) main();
