#!/usr/bin/env node
// The work list: one entry per real company (autofill duplicates merged), its people, what the engine and the IMA
// sheet already know, whether it is warm, and a tier for the order of work. Emails are reduced to how their domain
// relates to the brand; the addresses themselves stay in the sheet.
//
//   node agency-desk/scripts/worklist.mjs --li <dir> --ima <dir> --out <worklist.json outside the repo>
//        [--skip-keys <file with one "Brand | Name" per line>] [--rules <private rules.json>]
//        [--connections <LinkedIn export Connections.csv>]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { args, isMain, col, brandKey, relation, hostOf, registrable, stem, token, assertOutsideRepo, parseCSV } from './lib.mjs';
import { loadSheets, people, groupBrands } from './audit.mjs';

const CORE = /(mow|lawn|garden|grow|plant|irrigat|sprinkler|hose|tool|saw|drill|lumber|deck|wood|outdoor|yard|soil|seed|mushroom|hydropon|pond|green roof|trimmer|blower|chainsaw|workbench|glue|ladder|glove|compost|fire ?pit|planter|tunnel|turf|prun|freeze dr|preserv|homestead|harvest|pest|mosquito|weed)/i;
const HOME = /(home|furniture|bed|sofa|kitchen|floor|bath|desk|vacuum|mop|smart|projector|camera|doorbell|security|fan|air|water filter|cookware|linen|throw|mattress|sleep|pet|spa|pool|light|power station|battery|solar|outlet)/i;

// What a brand already answered decides how (and whether) it is approached again.
export function autoRule(text) {
  const t = String(text || '');
  if (/not accepting|no longer accepting|not working with (agencies|creators)/i.test(t)) return { route: 'park', why: 'said no for now' };
  if (/affiliate (only|program)|only (an )?affiliate/i.test(t)) return { route: 'affiliate-only', why: 'affiliate terms only' };
  if (/\b(us|usa|united states)[ -]?(based )?(only|creators)|only (in )?(the )?us\b|us (and|\/|&) ?canada|primarily based in the us/i.test(t)) return { route: 'us-only', why: 'wants US creators' };
  return null;
}

// LinkedIn's own export ("Get a copy of your data" → Connections): current title and company for each connection.
export function parseConnections(text) {
  const lines = parseCSV(text);
  const start = lines.findIndex((r) => (r[0] || '').trim() === 'First Name');
  if (start < 0) return new Map();
  const h = lines[start].map((x) => x.trim());
  const at = (r, k) => (r[h.indexOf(k)] || '').trim();
  const map = new Map();
  for (const r of lines.slice(start + 1)) {
    const full = `${at(r, 'First Name')} ${at(r, 'Last Name')}`.trim();
    if (full) map.set(token(full), { company: at(r, 'Company'), position: at(r, 'Position'), connectedOn: at(r, 'Connected On') });
  }
  return map;
}

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function buildWorklist(data, { skipKeys = new Set(), rules = {}, connections = new Map() } = {}) {
  const ppl = people(data.sheet1);
  const groups = groupBrands(ppl);
  const outreach = new Map();
  for (const r of data.outreach.rows) { const k = brandKey(col(r, 'Brand')); if (k && !outreach.has(k)) outreach.set(k, r); }
  const ima = new Map();
  for (const r of data.imaBrands.rows) { const k = brandKey(col(r, 'Brand Name')); if (k && !ima.has(k)) ima.set(k, r); }
  const warmTab = data.brandsInterested || { rows: [] };
  const warm = new Map();
  for (const r of warmTab.rows) {
    const cells = r._cells || [];
    const k = brandKey(cells[0]);
    if (k) warm.set(k, clip(cells.filter(Boolean).slice(2).join(' · '), 400));
  }

  const brands = [];
  for (const [k, g] of groups) {
    const o = outreach.get(k);
    const m = ima.get(k);
    const label = [...g.labels][0];
    const facts = o ? col(o, 'Facts') : '';
    // The lines Leif already wrote name the products ("pruning saw", "robot mower"), so they count towards the tier.
    const text = [label, facts, m ? col(m, 'Product Type') : '', ...g.people.map((p) => p.line)].join(' ');
    const k2 = stem(g.domain); // a typo in the label ("Acmme" for "Acme") still finds the brand by its domain
    const warmNote = warm.get(k) || (k2 && warm.get(k2));
    const isWarm = Boolean(warmNote) || /already talking/i.test(o ? col(o, 'Status') : '') || Boolean(m && col(m, 'Replied'));
    const tier = isWarm ? 'warm' : CORE.test(text) ? 'core' : HOME.test(text) ? 'home' : 'other';
    const ppl2 = g.people.filter((p) => !skipKeys.has(p.key)).map((p) => {
      const c = connections.get(token(p.name));
      const co = c ? token(c.company) : '';
      const bk = brandKey(label);
      const st = stem(g.domain);
      // A blank or tiny company field must never count as a match ("".includes is always true).
      const companyMatch = co.length >= 3 && ((bk.length >= 3 && (co.includes(bk) || bk.includes(co))) || (st.length >= 3 && co.includes(st)));
      return {
        row: p.row, key: p.key, name: p.name,
        address: p.domain ? relation(g.domain, p.domain, p.brand) : 'none',
        addressDomain: p.domain ? registrable(p.domain) : '',
        validity: p.validity, line: clip(p.line, 220), subject: clip(p.subject, 80), followUp: p.followUp,
        connection: c ? { ...c, match: companyMatch ? 'confirmed' : 'name only: check' } : null,
      };
    });
    if (!ppl2.length) continue;
    const answered = [m && col(m, 'Replied'), m && col(m, 'Notes'), m && col(m, 'Status'), warmNote].filter(Boolean).join(' ');
    const rule = rules[k] || rules[label] || autoRule(answered);
    brands.push({
      id: k, label, labels: [...g.labels], domain: g.domain, tier: rule && ['park', 'exclude'].includes(rule.route) ? 'hold' : tier, warm: isWarm, rule,
      warmNotes: warmNote || (m ? clip([col(m, 'Replied'), col(m, 'Notes')].filter(Boolean).join(' · '), 400) : ''),
      engine: o ? {
        status: col(o, 'Status'), sendTo: col(o, 'Send to'), sendToRole: col(o, 'Role'), addressSource: col(o, 'Address source'),
        otherPublished: clip(col(o, 'Other published'), 400), siteFacts: clip(facts, 500), creator: col(o, 'Creator'), note: col(o, 'Note'),
      } : null,
      ima: m ? {
        productType: col(m, 'Product Type'), website: hostOf(col(m, 'Website')), publishedContacts: clip(col(m, 'Email/Contact'), 200),
        sponsor: col(m, 'Source'), status: col(m, 'Status'), notes: clip(col(m, 'Notes'), 300),
      } : null,
      people: ppl2,
    });
  }
  const order = { warm: 0, core: 1, home: 2, other: 3, hold: 4 };
  brands.sort((a, b) => order[a.tier] - order[b.tier] || a.people[0].row - b.people[0].row);
  return brands;
}

function main() {
  const a = args();
  if (!a.li || !a.out) { console.error('usage: worklist.mjs --li <dir> --ima <dir> --out <worklist.json> [--skip-keys <file>]'); process.exit(2); }
  let out;
  try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
  const data = loadSheets({ li: a.li, ima: a.ima });
  const interested = `${a.li}/Brands_interested.csv`;
  if (existsSync(interested)) {
    // This tab has no header row: its first row is already a brand, so it is read as raw cells.
    data.brandsInterested = { rows: parseCSV(readFileSync(interested, 'utf8')).map((cells) => ({ _cells: cells })) };
  }
  const skipKeys = a['skip-keys'] ? new Set(readFileSync(a['skip-keys'], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) : new Set();
  const rules = a.rules ? JSON.parse(readFileSync(a.rules, 'utf8')) : {};
  const connections = a.connections ? parseConnections(readFileSync(a.connections, 'utf8')) : new Map();
  const brands = buildWorklist(data, { skipKeys, rules, connections });
  writeFileSync(out, JSON.stringify(brands, null, 2));
  const n = brands.reduce((s, b) => s + b.people.length, 0);
  const tiers = brands.reduce((m, b) => ((m[b.tier] = (m[b.tier] || 0) + 1), m), {});
  console.log(`work list: ${brands.length} brands · ${n} people · ${Object.entries(tiers).map(([t, c]) => `${t} ${c}`).join(' · ')}`);
}

if (isMain(import.meta.url)) main();
