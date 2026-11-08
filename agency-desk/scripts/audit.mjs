#!/usr/bin/env node
// The agency audit: reads the two sheets (one CSV per tab) and lists what would cost a reply or a deal.
// Counts go to stdout; names go only to --out, which must be outside the repository (the repo is public).
//
//   node agency-desk/scripts/audit.mjs --li <dir with Sheet1.csv, Outreach.csv, ...> --ima <dir with Brands.csv, ...>
//        [--out <dir outside the repo>] [--strict]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readTableFile, col, emailDomain, hostOf, registrable, relation, brandKey, token, parseViews, pricingStats, fmtViews,
  assertOutsideRepo, args, personKey, isMain,
} from './lib.mjs';

const FIRST_PERSON = /\b(my|mine|our|we're|we are|we've|i've been|i always|i bought|i use|i own|wife|husband|kid'?s|kids|mum'?s|dad'?s|back at home|back in recruitment)\b/i;
const PRODUCT_PRAISE = /^(stoked|really (like|liking|love|loving)|love (the|what|how)|loving|in love with|excited for|been looking for|like (the|how)|we appreciate|i like|i thought|absolutely love|the [a-z0-9 ]+ (is|on|looks))/i;
const WRONG_PURPOSE_INBOX = /^(support|service|services|help|customer|customerservice|care|orders?|sales|commercial|dealer|dealers|legal|returns|warranty|onlinestore|international|b2b|golf)[^@]*@|@support\./i;
const SETTING_AS_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const GENERIC_SUBJECT = /^(creators (and influencers )?for |question about creator content for |quick one for whoever handles|curious who oversees creator)/i;

export function normValidity(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return 'blank';
  if (s === 'yes' || s === 'valid') return 'valid';
  if (s.startsWith('invalid')) return 'invalid';
  if (s.startsWith('accept')) return 'accept-all';
  if (s.startsWith('unknown')) return 'unknown';
  return 'other';
}

function load(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readTableFile(p) : { header: [], rows: [] };
}

export function loadSheets({ li, ima }) {
  return {
    sheet1: load(li, 'Sheet1.csv'),
    outreach: load(li, 'Outreach.csv'),
    creators: load(li, 'Creators.csv'),
    settings: load(li, 'Settings.csv'),
    myInfluencers: load(li, 'My_Influencers.csv'),
    imaBrands: ima ? load(ima, 'Brands.csv') : { header: [], rows: [] },
    pricing: ima ? load(ima, 'Pricing_Influencers.csv') : { header: [], rows: [] },
  };
}

// People from Sheet1, with the brand carried down when a row leaves it blank.
export function people(sheet1) {
  const out = [];
  let brand = '';
  for (const r of sheet1.rows) {
    const b = col(r, 'Brand');
    if (b) brand = b;
    const name = col(r, 'Employee Name').replace(/\s+/g, ' ').trim();
    const email = col(r, 'Linked in Email').replace(/[<>]/g, '').trim();
    if (!name && !email) continue;
    out.push({
      row: r._row, brand: b || brand, name, email, domain: emailDomain(email),
      validity: normValidity(col(r, 'Valid Email')), line: col(r, 'Personalisation'),
      subject: col(r, 'Subject Used'), followUp: col(r, 'Follow Up'), contacted: col(r, 'Contacted'),
      key: personKey(b || brand, name),
    });
  }
  return out;
}

export function groupBrands(ppl) {
  const byBrand = new Map();
  for (const p of ppl) {
    const k = brandKey(p.brand);
    if (!byBrand.has(k)) byBrand.set(k, { labels: new Set(), counts: new Map(), people: [] });
    const g = byBrand.get(k);
    g.labels.add(p.brand);
    g.people.push(p);
    const reg = registrable(p.domain);
    if (reg && relation(reg, reg) !== 'webmail') g.counts.set(reg, (g.counts.get(reg) || 0) + 1);
  }
  for (const g of byBrand.values()) {
    let best = '';
    let n = 0;
    for (const [d, c] of g.counts) if (c > n) { best = d; n = c; }
    g.domain = best;
  }
  return byBrand;
}

function creatorTruth(data) {
  const names = data.creators.rows.map((r) => col(r, 'Creator')).filter(Boolean);
  const same = (a, b) => { const x = token(a); const y = token(b); return x && y && (x.startsWith(y) || y.startsWith(x)); };
  return names.map((name) => {
    const values = [];
    const c = data.creators.rows.find((r) => col(r, 'Creator') === name);
    const cv = parseViews(col(c, 'Avg views'));
    if (Number.isFinite(cv)) values.push({ where: 'Creators tab', views: cv });
    const mi = data.myInfluencers.rows.find((r) => same((r._cells[0] || '').split(' for ')[0], name));
    const mv = mi ? parseViews(col(mi, 'Avg views')) : NaN;
    if (Number.isFinite(mv)) values.push({ where: 'My Influencers tab', views: mv });
    const pr = data.pricing.rows.find((r) => same(r._cells[0] || '', name));
    const ps = pr ? pricingStats(pr._cells[1] || '') : null;
    if (ps) values.push({ where: 'Pricing tab (mean of the listed videos)', views: ps.mean, median: ps.median, best: ps.max });
    return { name, values };
  });
}

export function audit(data) {
  const ppl = people(data.sheet1);
  const brands = groupBrands(ppl);
  const findings = [];
  const add = (check, severity, items, why) => { if (items.length) findings.push({ check, severity, count: items.length, why, items }); };

  // 1. One brand typed several ways (autofill "Gizmo 360, Gizmo 361 ..."; "Acmebot" and "AcmeBot").
  add('duplicate-brand-label', 'fix',
    [...brands.values()].filter((g) => g.labels.size > 1).map((g) => ({ brand: [...g.labels].join(' / '), detail: `${g.people.length} people under ${g.labels.size} labels` })),
    'One company is listed under several labels, so it can be pitched twice in one day.');

  // 2. The same address on two rows.
  const seen = new Map();
  for (const p of ppl) if (p.email) { const k = p.email.toLowerCase(); seen.set(k, [...(seen.get(k) || []), p]); }
  add('duplicate-person', 'fix',
    [...seen.values()].filter((v) => v.length > 1).map((v) => ({ row: v.map((p) => p.row).join(', '), brand: v.map((p) => p.brand).join(' / '), name: v[0].name })),
    'One person listed twice would get two different first notes.');

  // 3-4. Addresses that are not at the brand.
  const webmail = [];
  const other = [];
  const check = [];
  for (const p of ppl) {
    if (!p.domain) continue;
    const g = brands.get(brandKey(p.brand));
    const rel = relation(g.domain, p.domain, p.brand);
    if (rel === 'webmail') webmail.push({ row: p.row, brand: p.brand, name: p.name, detail: p.domain });
    else if (rel === 'other') other.push({ row: p.row, brand: p.brand, name: p.name, detail: `${p.domain} is not ${g.domain}` });
    else if (rel === 'check') check.push({ row: p.row, brand: p.brand, name: p.name, detail: `${p.domain} beside ${g.domain}` });
  }
  add('personal-webmail', 'fix', webmail, 'A personal mailbox: never emailed, whatever the consent.');
  add('other-company-domain', 'check', other, "Another company's domain: an agency, a parent, a distributor or the wrong person. Confirm before any note.");
  add('related-domain', 'check', check, 'A second domain that shares the name; usually the same company, sometimes not.');

  // 5. The brand's website in the IMA sheet is a different domain from the LinkedIn addresses (a same-name company).
  const mismatch = [];
  for (const r of data.imaBrands.rows) {
    const label = col(r, 'Brand Name');
    const host = hostOf(col(r, 'Website'));
    if (!label || !host) continue;
    const g = brands.get(brandKey(label));
    if (!g || !g.domain) continue;
    const rel = relation(g.domain, host, label);
    if (rel === 'check' || rel === 'other') mismatch.push({ brand: label, detail: `IMA website ${registrable(host)} vs LinkedIn addresses at ${g.domain}` });
  }
  add('two-domains-one-brand', 'check', mismatch, 'The IMA website and the LinkedIn addresses are different domains: a reseller or store page (fine), or a different company from the one being praised (a same-name company: fix).');

  // 6. Address validity.
  add('invalid-address', 'fix', ppl.filter((p) => p.validity === 'invalid').map((p) => ({ row: p.row, brand: p.brand, name: p.name })),
    'Marked Invalid: never emailed.');

  // 7. Who has a line, and what kind of line.
  const noLine = ppl.filter((p) => !p.line);
  add('no-line', 'info', noLine.map((p) => ({ row: p.row, brand: p.brand, name: p.name })), 'No personalisation yet.');
  const brandOnly = [...brands.values()].filter((g) => g.people.length > 1 && g.people.filter((p) => p.line).length === 1);
  add('one-line-per-brand', 'info', brandOnly.map((g) => ({ brand: [...g.labels][0], detail: `${g.people.length} people, 1 line` })),
    'Only the first person at the brand has a line; colleagues get nothing personal.');
  add('product-praise-template', 'check', ppl.filter((p) => p.line && PRODUCT_PRAISE.test(p.line)).map((p) => ({ row: p.row, brand: p.brand, name: p.name, detail: p.line.slice(0, 80) })),
    'Opens by praising a product feature, the line every agency sends.');
  add('first-person-claim', 'fix', ppl.filter((p) => p.line && FIRST_PERSON.test(p.line)).map((p) => ({ row: p.row, brand: p.brand, name: p.name, detail: p.line.slice(0, 100) })),
    'Says Leif owns or uses something. Keep only if true.');
  add('placeholder-line', 'fix', ppl.filter((p) => p.line && p.line.length < 25).map((p) => ({ row: p.row, brand: p.brand, name: p.name, detail: p.line })),
    'Too short to be a line: a note to self that would go out as written.');
  add('not-a-person', 'check', ppl.filter((p) => !p.name || p.name === '?' || p.name.split(' ').length >= 5 || /linked ?in|send |\?/i.test(p.name)).map((p) => ({ row: p.row, brand: p.brand, detail: p.name || '(blank)' })),
    'The name cell holds a note or nothing, not a person.');

  // 8. Validity counts (info).
  const validity = {};
  for (const p of ppl) validity[p.validity] = (validity[p.validity] || 0) + 1;

  // 9. Creator numbers that disagree between tabs by more than double.
  const truth = creatorTruth(data);
  add('creator-numbers-disagree', 'fix', truth.filter((t) => {
    const v = t.values.map((x) => x.views).filter((n) => n > 0);
    return v.length > 1 && Math.max(...v) / Math.min(...v) > 2;
  }).map((t) => ({ creator: t.name, detail: t.values.map((x) => `${x.where} ${fmtViews(x.views)}${x.median ? ` (median ${fmtViews(x.median)}, best ${fmtViews(x.best)})` : ''}`).join(' · ') })),
    'A pitched number that the sheet itself contradicts; the first brand that checks the channel stops trusting the roster.');
  add('creator-without-views', 'info', truth.filter((t) => !t.values.length).map((t) => ({ creator: t.name })), 'No view count yet, so this creator cannot be pitched with a number.');

  // 10. The engine's settings.
  const setting = (k) => data.settings.rows.find((r) => col(r, 'Setting') === k);
  add('setting-typed-as-date', 'fix', data.settings.rows.filter((r) => SETTING_AS_DATE.test(col(r, 'Value'))).map((r) => ({ detail: `${col(r, 'Setting')} = ${col(r, 'Value')}` })),
    'The sheet turned a value such as "8-13" into a date; the engine may read the wrong hours.');
  const postal = setting('POSTAL_ADDRESS');
  add('postal-address-missing', 'info', postal && !col(postal, 'Value') ? [{ detail: 'POSTAL_ADDRESS is empty, so LIVE stays off (correct until it is filled).' }] : [], 'CAN-SPAM needs a postal address in emails to US brands.');

  // 11. The engine's chosen inboxes and subjects.
  add('wrong-purpose-inbox', 'fix', data.outreach.rows.filter((r) => WRONG_PURPOSE_INBOX.test(col(r, 'Send to'))).map((r) => ({ brand: col(r, 'Brand'), detail: col(r, 'Send to') })),
    'The send-to address is for customers, orders or service, not partnerships.');
  add('generic-subject', 'check', data.outreach.rows.filter((r) => GENERIC_SUBJECT.test(col(r, 'Subject'))).map((r) => ({ brand: col(r, 'Brand'), detail: col(r, 'Subject') })),
    'A template subject, the kind that reads as a sequence.');
  const assigned = {};
  for (const r of data.outreach.rows) { const c = col(r, 'Creator'); if (c) assigned[c] = (assigned[c] || 0) + 1; }
  add('creator-assignment', 'info', Object.entries(assigned).map(([creator, n]) => ({ creator, detail: `${n} brands` })), 'Which creator the engine pitched where.');
  add('skipped-or-note-row', 'check', data.outreach.rows.filter((r) => /skipped/i.test(col(r, 'Status')) || col(r, 'Brand').split(' ').length >= 4).map((r) => ({ brand: col(r, 'Brand'), detail: col(r, 'Note') })),
    'A brand without a domain, or a note typed into the brand column.');

  // 12. Strengths already in the sheets.
  add('sponsor-hook-available', 'info', data.imaBrands.rows.filter((r) => col(r, 'Brand Name') && col(r, 'Source')).map((r) => ({ brand: col(r, 'Brand Name'), creator: col(r, 'Source') })),
    "The brand's own creator history: the strongest true opener.");

  const counts = {
    people: ppl.length,
    brandLabels: new Set(ppl.map((p) => p.brand)).size,
    brands: brands.size,
    withLine: ppl.length - noLine.length,
    validity,
    outreachRows: data.outreach.rows.length,
    imaBrandRows: data.imaBrands.rows.filter((r) => col(r, 'Brand Name')).length,
  };
  return { counts, findings, truth };
}

export function summary({ counts, findings }) {
  const lines = [`people ${counts.people} · brands ${counts.brands} (${counts.brandLabels} labels) · with a line ${counts.withLine}`,
    `validity ${Object.entries(counts.validity).map(([k, v]) => `${k} ${v}`).join(' · ')}`];
  for (const f of findings) lines.push(`${f.severity.padEnd(5)} ${f.check.padEnd(26)} ${String(f.count).padStart(4)}  ${f.why}`);
  return lines.join('\n');
}

export function markdown(result) {
  const out = ['# Agency audit (names included: keep out of the repository)', '', '```', summary(result), '```', ''];
  for (const f of result.findings) {
    out.push(`## ${f.check} (${f.severity}, ${f.count})`, '', f.why, '');
    for (const i of f.items) out.push(`- ${[i.row && `row ${i.row}`, i.brand, i.name, i.creator, i.detail].filter(Boolean).join(' · ')}`);
    out.push('');
  }
  return out.join('\n');
}

function main() {
  const a = args();
  if (!a.li) { console.error('usage: audit.mjs --li <dir> [--ima <dir>] [--out <dir outside the repo>] [--strict]'); process.exit(2); }
  const result = audit(loadSheets({ li: a.li, ima: a.ima }));
  console.log(summary(result));
  if (a.out) {
    let out;
    try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'audit.json'), JSON.stringify(result, null, 2));
    writeFileSync(join(out, 'audit.md'), markdown(result));
    console.log(`details (with names) written to ${out}`);
  }
  if (a.strict && result.findings.some((f) => f.severity === 'fix')) process.exit(1);
}

if (isMain(import.meta.url)) main();
