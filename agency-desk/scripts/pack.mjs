#!/usr/bin/env node
// The pack: one row per Sheet1 row, in Sheet1's own order, so one IMPORTRANGE formula lines every person up with
// their note. Rows with no person stay blank; a person the team has not reached says MISSING; the key column lets
// Leif (and a formula) see at a glance that the rows still line up.
//
//   node agency-desk/scripts/pack.mjs --sheet1 <Sheet1.csv> --rows <rows.json> --out <pack.csv outside the repo>
//        [--diff <previous pack.csv>]
import { readFileSync, writeFileSync } from 'node:fs';
import { args, isMain, readTable, parseCSV, toCSV, col, personKey, assertOutsideRepo } from './lib.mjs';

// A cell that starts with = + - @ would run as a formula once the CSV is opened in Sheets (web text is untrusted).
export function safeCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export const COLUMNS = [
  ['Joy · Key (Brand | Name)', (r) => r.key],
  ['Joy · Role found', (r) => r.role],
  ['Joy · Contact order', (r) => r.contactOrder],
  ['Joy · Wave', (r) => r.wave],
  ['Joy · Route', (r) => r.route],
  ['Joy · Connection note (≤200)', (r) => r.connectionNote],
  ['Joy · DM after they accept', (r) => r.dm],
  ['Joy · Email opener', (r) => r.emailOpener],
  ['Joy · Subject', (r) => r.subject],
  ['Joy · Creator + honest number', (r) => [r.creator, r.creatorNumber].filter(Boolean).join(' · ')],
  ['Joy · Why this creator', (r) => r.whyCreator],
  ['Joy · Hook', (r) => r.hook?.text],
  ['Joy · Hook source + date', (r) => [r.hook?.source, r.hook?.date].filter(Boolean).join(' · ')],
  ["Joy · Brand's creator history", (r) => r.brandHistory],
  ['Joy · Confidence', (r) => r.confidence],
  ['Joy · Flags', (r) => (r.flags || []).join('; ')],
  ['Joy · Hook type', (r) => r.hook?.type],
  ['Joy · Consent (yes + date)', (r) => r.consent || ''],
  ['Joy · Reply', (r) => r.reply || ''],
];

// The Sheet1 people in row order: index i of the result is sheet row i + 2.
export function sheetKeys(sheet1Text) {
  const t = readTable(sheet1Text);
  let brand = '';
  return t.rows.map((r) => {
    const b = col(r, 'Brand');
    if (b) brand = b;
    const name = col(r, 'Employee Name');
    const email = col(r, 'Linked in Email');
    return name || email ? personKey(b || brand, name) : '';
  });
}

export function buildPack(keys, rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const used = new Set();
  const out = [COLUMNS.map(([h]) => h)];
  for (const k of keys) {
    if (!k) { out.push(COLUMNS.map(() => '')); continue; }
    const r = byKey.get(k);
    if (!r) { out.push(COLUMNS.map(([h]) => (h.startsWith('Joy · Key') ? k : h === 'Joy · Flags' ? 'MISSING: not researched yet' : ''))); continue; }
    used.add(k);
    out.push(COLUMNS.map(([, f]) => safeCell(f(r) ?? '')));
  }
  const orphans = rows.filter((r) => !used.has(r.key)).map((r) => r.key);
  return { table: out, orphans, missing: keys.filter((k) => k && !byKey.has(k)) };
}

// Which keys are new or changed against an earlier pack, so the next run researches only those.
export function diff(previousCsv, keys, rows) {
  const prev = parseCSV(previousCsv);
  const header = prev[0] || [];
  const ki = header.findIndex((h) => h.startsWith('Joy · Key'));
  const ni = header.findIndex((h) => h.startsWith('Joy · Connection note'));
  const before = new Map(prev.slice(1).filter((r) => r[ki]).map((r) => [r[ki], r[ni] || '']));
  const now = new Map(rows.map((r) => [r.key, r.connectionNote || '']));
  return {
    added: keys.filter((k) => k && !before.has(k)),
    changed: keys.filter((k) => k && before.has(k) && now.has(k) && before.get(k) !== now.get(k)),
    unresearched: keys.filter((k) => k && !before.get(k) && !now.get(k)),
  };
}

function main() {
  const a = args();
  if (!a.sheet1 || !a.rows) { console.error('usage: pack.mjs --sheet1 <Sheet1.csv> --rows <rows.json> --out <pack.csv> [--diff <previous pack.csv>]'); process.exit(2); }
  const keys = sheetKeys(readFileSync(a.sheet1, 'utf8'));
  const rows = JSON.parse(readFileSync(a.rows, 'utf8'));
  if (a.diff) {
    const d = diff(readFileSync(a.diff, 'utf8'), keys, rows);
    console.log(`added ${d.added.length} · changed ${d.changed.length} · unresearched ${d.unresearched.length}`);
    if (!a.out) return;
  }
  if (!a.out) { console.error('--out is required to write the pack'); process.exit(2); }
  let out;
  try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
  const { table, orphans, missing } = buildPack(keys, rows);
  writeFileSync(out, toCSV(table));
  const people = keys.filter(Boolean).length;
  console.log(`pack: ${table.length - 1} sheet rows · ${people} people · ${people - missing.length} with a note · ${missing.length} missing · ${orphans.length} rows matched no Sheet1 person`);
  if (orphans.length) process.exitCode = 1; // a row that matches nobody means the keys drifted
}

if (isMain(import.meta.url)) main();
