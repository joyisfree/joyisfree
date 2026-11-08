// The pack, the work list and the privacy gate, on made-up data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toCSV, parseCSV, REPO_ROOT } from './lib.mjs';
import { sheetKeys, buildPack, diff, COLUMNS, safeCell } from './pack.mjs';
import { buildWorklist, autoRule, parseConnections } from './worklist.mjs';
import { loadSheets } from './audit.mjs';
import { scanText } from './privacy-gate.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const at = (local, domain) => [local, domain].join('@');
const S1 = ['Brand', 'Employee Name', 'Linked in Email', 'Contacted', '', 'Personalisation', 'Website', 'Email 1', 'Valid Email?', 'Subject Used'];
const sheet1 = toCSV([S1,
  ['Acme', 'Ava Sample', at('ava', 'acme.test'), '', '', '', '', '', 'Valid', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['Acme', 'Ben Sample', at('ben', 'acme.test'), '', '', '', '', '', 'Valid', ''],
  ['Gizmo', 'Cal Sample', at('cal', 'gizmo.test'), '', '', '', '', '', 'Unknown', ''],
]);
const row = (key, note) => ({ key, route: 'linkedin-dm', connectionNote: note, dm: 'Mind if I email you a one-pager?', creator: 'Jay', creatorNumber: '24k a video', hook: { type: 'season', text: 'spring', source: 'https://a.example', date: '2026-10-01' }, confidence: 'Medium', flags: [] });

test('the pack keeps Sheet1 row order, blank rows blank, and flags people not yet researched', () => {
  const keys = sheetKeys(sheet1);
  assert.deepEqual(keys, ['Acme | Ava Sample', '', 'Acme | Ben Sample', 'Gizmo | Cal Sample']);
  const { table, missing, orphans } = buildPack(keys, [row('Acme | Ava Sample', 'n1'), row('Gizmo | Cal Sample', 'n3')]);
  assert.equal(table.length, 5); // header + 4 sheet rows
  assert.equal(table[0].length, COLUMNS.length);
  assert.equal(table[1][0], 'Acme | Ava Sample');
  assert.ok(table[2].every((c) => c === ''), 'the blank sheet row stays blank');
  assert.equal(table[3][0], 'Acme | Ben Sample');
  assert.match(table[3][COLUMNS.findIndex(([h]) => h === 'Joy · Flags')], /MISSING/);
  assert.deepEqual(missing, ['Acme | Ben Sample']);
  assert.deepEqual(orphans, []);
});

test('web text that looks like a formula is defused before it reaches Sheets', () => {
  assert.equal(safeCell('=IMPORTXML("x")'), `'=IMPORTXML("x")`);
  assert.equal(safeCell('@handle'), "'@handle");
  assert.equal(safeCell('plain'), 'plain');
  const r = row('Acme | Ava Sample', '=HYPERLINK("bad")');
  const { table } = buildPack(sheetKeys(sheet1), [r]);
  assert.ok(table[1].every((c) => !/^[=+@]/.test(c)));
});

test('a row that matches no Sheet1 person is reported as an orphan', () => {
  const { orphans } = buildPack(sheetKeys(sheet1), [row('Acme | Ava Smaple', 'typo')]);
  assert.deepEqual(orphans, ['Acme | Ava Smaple']);
});

test('the diff names only new or changed people', () => {
  const keys = sheetKeys(sheet1);
  const prev = toCSV(buildPack(keys, [row('Acme | Ava Sample', 'n1')]).table);
  const d = diff(prev, keys, [row('Acme | Ava Sample', 'n1 changed'), row('Gizmo | Cal Sample', 'n3')]);
  // An edited note and a note written for the first time both count as changed; the rest are left alone.
  assert.deepEqual(d.changed, ['Acme | Ava Sample', 'Gizmo | Cal Sample']);
  assert.deepEqual(d.added, []);
  assert.ok(d.unresearched.includes('Acme | Ben Sample'));
});

test('the pack CLI refuses to write inside the repository and writes outside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-pack-'));
  const s1 = join(dir, 'Sheet1.csv'); writeFileSync(s1, sheet1);
  const rows = join(dir, 'rows.json'); writeFileSync(rows, JSON.stringify([row('Acme | Ava Sample', 'n1')]));
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'pack.mjs'), '--sheet1', s1, '--rows', rows, '--out', join(REPO_ROOT, 'pack.csv')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.ok(!existsSync(join(REPO_ROOT, 'pack.csv')));
  const out = join(dir, 'pack.csv');
  execFileSync(process.execPath, [join(here, 'pack.mjs'), '--sheet1', s1, '--rows', rows, '--out', out], { stdio: 'pipe' });
  assert.equal(parseCSV(readFileSync(out, 'utf8')).filter((r) => r.length > 1).length, 5);
});

test('the work list merges autofill labels, puts warm brands first and never carries an address', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-wl-'));
  const li = join(dir, 'li'); mkdirSync(li);
  writeFileSync(join(li, 'Sheet1.csv'), toCSV([S1,
    ['Gizmo 360', 'Eve Sample', at('eve', 'gizmo360.test'), '', '', '', '', '', 'Valid', ''],
    ['Gizmo 361', 'Fay Sample', at('fay', 'gizmo360.test'), '', '', '', '', '', 'Valid', ''],
    ['Acme Mowers', 'Ava Sample', at('ava', 'acmemowers.test'), '', '', 'the robot mower', '', '', 'Valid', ''],
    ['Warmco', 'Wes Sample', at('wes', 'warmco.test'), '', '', '', '', '', 'Valid', ''],
  ]));
  const data = loadSheets({ li });
  data.brandsInterested = { rows: [{ _cells: ['Warmco', at('wes', 'warmco.test'), '', 'Wants US creators'] }] };
  const brands = buildWorklist(data);
  assert.equal(brands[0].label, 'Warmco');
  assert.equal(brands[0].tier, 'warm');
  assert.equal(brands.find((b) => b.id === 'gizmo').people.length, 2, 'Gizmo 360 and Gizmo 361 are one brand');
  assert.equal(brands.find((b) => b.label === 'Acme Mowers').tier, 'core');
  assert.ok(!JSON.stringify(brands).includes('@'), 'no address leaves the sheet');
  const skipped = buildWorklist(data, { skipKeys: new Set(['Acme Mowers | Ava Sample']) });
  assert.ok(!skipped.some((b) => b.label === 'Acme Mowers'), 'already-done people are skipped');
});

test('a brand that said no is held, and earlier answers become routing rules', () => {
  assert.equal(autoRule('Not accepting creators at the moment').route, 'park');
  assert.equal(autoRule('We only run an affiliate program').route, 'affiliate-only');
  assert.equal(autoRule('Wants creators whose audience is primarily based in the US').route, 'us-only');
  assert.equal(autoRule('Happy to look at your roster'), null);
});

test('the LinkedIn export joins by name and confirms the company', () => {
  const text = 'Notes:\n"When exporting your connection data, some emails may be missing"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nAva,Sample,https://x.example/in/ava,,Acme Mowers Inc,Influencer Marketing Manager,01 Nov 2026\n';
  const map = parseConnections(text);
  assert.equal(map.size, 1);
  const dir = mkdtempSync(join(tmpdir(), 'agency-conn-'));
  const li = join(dir, 'li'); mkdirSync(li);
  writeFileSync(join(li, 'Sheet1.csv'), toCSV([S1, ['Acme Mowers', 'Ava Sample', at('ava', 'acmemowers.test'), '', '', '', '', '', 'Valid', '']]));
  const [brand] = buildWorklist(loadSheets({ li }), { connections: map });
  assert.equal(brand.people[0].connection.position, 'Influencer Marketing Manager');
  assert.equal(brand.people[0].connection.match, 'confirmed');
});

test('the privacy gate passes reserved domains and catches real addresses and sheet names', () => {
  assert.deepEqual(scanText(`write to ${at('team', 'example.com')} or ${at('a', 'acme.test')}`), []);
  const hits = scanText(`contact ${at('jane.doe', 'realbrand.com')} now`, { names: ['Jane Doe', 'Jo'] });
  assert.equal(hits.filter((h) => h.kind === 'address').length, 1);
  assert.equal(scanText('a note about Jane Doe', { names: ['Jane Doe'] }).length, 1);
  assert.equal(scanText('a note about Jo', { names: ['Jo'] }).length, 0, 'a short first name alone is not identifying');
  assert.equal(scanText('pitched Acmemow today', { terms: ['Acmemow'] }).length, 1);
  assert.equal(scanText('pitched Acmemowers today', { terms: ['Acmemow'] }).length, 0, 'whole words only');
});
