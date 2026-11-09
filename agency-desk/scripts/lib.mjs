// Shared helpers for the agency desk scripts. No dependencies on purpose (Node 22 alone).
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';

// The repository root, found from this file's own location so a symlink or a space in a path does not move it.
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF, an optional BOM.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCSV(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

// A table keyed by header name. Header cells are trimmed and their newlines folded, so a long header still matches.
export function readTable(text) {
  const raw = parseCSV(text);
  const header = (raw[0] || []).map((h) => h.replace(/\s+/g, ' ').trim());
  const rows = raw.slice(1).map((cells, i) => {
    const o = { _row: i + 2 }; // the sheet's own row number (row 1 is the header)
    header.forEach((h, j) => { if (h && !(h in o)) o[h] = (cells[j] ?? '').trim(); });
    o._cells = cells;
    return o;
  });
  return { header, rows };
}

export function readTableFile(path) {
  return readTable(readFileSync(path, 'utf8'));
}

// The first header that starts with the given words, case-insensitive (sheet headers carry long explanations).
export function col(row, ...prefixes) {
  for (const p of prefixes) {
    const want = p.toLowerCase();
    for (const k of Object.keys(row)) if (!k.startsWith('_') && k.toLowerCase().startsWith(want)) return row[k] ?? '';
  }
  return '';
}

export const WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'zoho.com',
  'bigpond.com', 'optusnet.com.au',
]);

const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.cn', 'co.za', 'com.sg',
  'com.hk', 'com.mx', 'co.in', 'co.kr',
]);

export function emailDomain(email) {
  const m = /@([^@\s<>]+?)>?\s*$/.exec(String(email || '').trim());
  return m ? m[1].toLowerCase() : '';
}

export function hostOf(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try { return new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return ''; }
}

// The part of a domain a company registers: shop.acme.co.uk -> acme.co.uk, au.store.acme.com -> acme.com.
export function registrable(domain) {
  const parts = String(domain || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return MULTI_SUFFIX.has(last2) ? parts.slice(-3).join('.') : last2;
}

// The registrable name without its public suffix, letters and digits only: acme-tools.co.uk -> acmetools.
export function stem(domain) {
  const reg = registrable(domain);
  const parts = reg.split('.');
  const last2 = parts.slice(-2).join('.');
  const name = MULTI_SUFFIX.has(last2) ? parts.slice(0, -2).join('') : parts.slice(0, -1).join('');
  return name.replace(/[^a-z0-9]/g, '');
}

export function token(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

// "Gizmo 361" and "Gizmo 360" are one brand typed down a column by autofill: drop trailing digits from labels
// that carry spaces before them, and letters-then-digits labels like "Qx2".
export function brandKey(label) {
  const t = String(label || '').trim().toLowerCase();
  const stripped = t.replace(/[\s-]*\d+$/, '');
  return token(stripped || t);
}

// Suffixes that usually mark one company's other storefront (acmepower, acmestore), not a different company.
const STOREFRONT_SUFFIXES = ['power', 'store', 'shop', 'official', 'online', 'global', 'usa', 'us', 'au', 'uk', 'home', 'hq', 'group', 'direct'];

// How an address's domain relates to a brand's main domain:
//   same     one registrable domain
//   alias    another storefront of the same company (acme.com and acmepower.com.au, acme.io and acmeio.com)
//   check    shares the name but adds something else (acme.com and acmetech.com): could be another company
//   webmail  a personal mailbox
//   other    an unrelated company (an agency, a distributor, a wrong person)
export function relation(brandDomain, otherDomain, brandLabel = '') {
  const a = registrable(brandDomain);
  const b = registrable(otherDomain);
  if (!b) return 'other';
  if (WEBMAIL.has(b)) return 'webmail';
  if (a && a === b) return 'same';
  const sa = stem(a);
  const sb = stem(b);
  const bt = brandKey(brandLabel);
  if (sa && sa === sb) return 'alias'; // acme.de and acme.us
  const aLonger = sa.length >= sb.length;
  const longer = aLonger ? sa : sb;
  const shorter = aLonger ? sb : sa;
  if (shorter.length >= 4 && longer.startsWith(shorter)) {
    const extra = longer.slice(shorter.length);
    const shorterTld = (aLonger ? b : a).split('.').at(-1); // acme.io and acmeio.com: the extra is the TLD
    if (STOREFRONT_SUFFIXES.includes(extra) || extra === shorterTld) return 'alias';
    return 'check';
  }
  if (bt.length >= 4 && sb.length >= 4) {
    if (sb === bt) return 'alias';
    if (sb.includes(bt) || bt.includes(sb)) return 'check'; // acmetools.com and acmetech.com under "Acme"
  }
  return 'other';
}

// "300k" -> 300000, "1.83m" -> 1830000, "24K avg" -> 24000, "2,780,000" -> 2780000. NaN when there is no number.
export function parseViews(s) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([km])?(?![a-z])/i.exec(String(s || ''));
  if (!m) return NaN;
  const n = Number(m[1].replaceAll(',', ''));
  const unit = (m[2] || '').toLowerCase();
  return unit === 'k' ? n * 1e3 : unit === 'm' ? n * 1e6 : n;
}

// The Pricing tab writes its sums as "a + b + c = total Divide by 10 = average": the mean and median of the terms.
export function pricingStats(expr) {
  const lhs = String(expr || '').split('=')[0];
  const terms = lhs.split('+').map((t) => parseViews(t)).filter((n) => Number.isFinite(n));
  if (!terms.length) return null;
  const sorted = [...terms].sort((x, y) => x - y);
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = terms.reduce((x, y) => x + y, 0) / terms.length;
  return { n: terms.length, mean, median, max: sorted.at(-1), min: sorted[0] };
}

export function fmtViews(n) {
  if (!Number.isFinite(n)) return '?';
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}m`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

// Refuse to write personal data inside the repository: the joyisfree repo is public.
export function assertOutsideRepo(path, root = REPO_ROOT) {
  const abs = resolve(path);
  const rel = relative(root, abs);
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (inside) {
    const err = new Error(`refusing to write inside the repository (${abs}); personal data belongs in the scratchpad or Drive`);
    err.code = 'INSIDE_REPO';
    throw err;
  }
  return abs;
}

export function personKey(brand, name) {
  return `${String(brand || '').trim()} | ${String(name || '').replace(/\s+/g, ' ').trim()}`;
}

// "Am I being run as a CLI?", comparing real paths so a space or a symlink in the path still works (as galxe-desk).
export function isMain(metaUrl) {
  try { return metaUrl === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

// Command-line flags: --name value, --flag (true).
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
