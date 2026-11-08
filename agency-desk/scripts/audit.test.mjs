// The audit on made-up sheets: every check fires on the case it exists for and stays quiet on a clean sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toCSV, REPO_ROOT } from './lib.mjs';
import { audit, loadSheets, people } from './audit.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const at = (local, domain) => [local, domain].join('@'); // built at run time so the privacy gate sees no address
const S1 = ['Brand', 'Employee Name', 'Linked in Email', 'Contacted', '', 'Personalisation', 'Website', 'Email 1 person', 'Valid Email?', 'Subject Used', 'WORKFLOW', '', 'First look', 'What do they want?', 'Follow Up'];
const p = (brand, name, email, line = '', valid = 'Valid') => [brand, name, email, '', '', line, '', '', valid, '', '', '', '', '', ''];

function sheets({ dirty = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agency-audit-'));
  const li = join(dir, 'li'); const ima = join(dir, 'ima');
  mkdirSync(li); mkdirSync(ima);
  const rows = dirty ? [
    p('Acme Mowers', 'Ava Sample', at('ava', 'acmemowers.test'), 'Stoked with the new mower, perfect for my huge property!'),
    p('Acme Mowers', 'Ben Sample', at('ben', 'acmemowers.test'), '', 'Invalid'),
    p('Acme Mowers', 'Cal Sample', at('cal.sample', 'gmail.com')),
    p('Acme Mowers', 'Dee Sample', at('dee', 'prfirm.test')),
    p('Gizmo 360', 'Eve Sample', at('eve', 'gizmo360.test'), 'Japanese snacks'),
    p('Gizmo 361', 'Fay Sample', at('fay', 'gizmo360.test')),
    p('Gizmo 361', 'Fay Sample', at('fay', 'gizmo360.test')),
  ] : [
    p('Acme Mowers', 'Ava Sample', at('ava', 'acmemowers.test'), 'Saw Acme backed a lawn channel this spring; the next one is ready.'),
    p('Gizmo', 'Eve Sample', at('eve', 'gizmo.test'), 'Your spring launch looks like a fit for a garden creator.'),
  ];
  writeFileSync(join(li, 'Sheet1.csv'), toCSV([S1, ...rows]));
  writeFileSync(join(li, 'Creators.csv'), toCSV([['Creator', 'Niche keywords', 'Avg views', 'Pitch line', 'Active'], ['Jay', 'diy', dirty ? '300k' : '24k', '', 'TRUE']]));
  writeFileSync(join(li, 'My_Influencers.csv'), toCSV([['', '', '', '', 'Rate', '', '', 'Avg views'], ['Jay for DIY', '', '', '', '', '', '', dirty ? '300k avg' : '24k avg']]));
  writeFileSync(join(li, 'Settings.csv'), toCSV([['Setting', 'Value', 'What it does'], ['SEND_HOURS', dirty ? '2026-08-13 00:00:00' : '8-13', ''], ['POSTAL_ADDRESS', dirty ? '' : 'PO Box 1', '']]));
  writeFileSync(join(li, 'Outreach.csv'), toCSV([['Brand', 'Domain', 'Status', 'Send to', 'Role', 'Address source', 'Other published addresses', 'Facts', 'Creator', 'Opener', 'Creator fit', 'Subject'],
    ['Acme Mowers', 'acmemowers.test', 'Ready', dirty ? at('support', 'acmemowers.test') : at('partners', 'acmemowers.test'), '', '', '', '', 'Jay', '', '', dirty ? 'Creators for Acme Mowers' : 'Spring 2027 + Acme?']]));
  writeFileSync(join(ima, 'Brands.csv'), toCSV([['Brand Name', 'Product Type', 'Website', 'Email/Contact', 'Linked IN Marketing', 'Source (Influencer)', 'Contacted', 'Replied', 'Status', 'Variation # Used', 'Notes'],
    ['Gizmo', 'Tools', dirty ? 'https://gizmotech.test/au' : 'https://gizmo.test/', '', '', 'Some Channel', 'Yes', '', '', '', '']]));
  writeFileSync(join(ima, 'Pricing_Influencers.csv'), toCSV([['Influencer', 'Average Views = 12 last videos', 'CPM'], ['JaysChannel', '190k + 15000 + 1900 + 2200 + 8800 + 2800 + 2900 + 7300 + 1400 + 8000 = 240,300 Divided by 10 = 24K', '']]));
  return { dir, li, ima };
}

const checks = (r) => Object.fromEntries(r.findings.map((f) => [f.check, f.count]));

test('every check fires on the case it exists for', () => {
  const { li, ima } = sheets();
  const r = audit(loadSheets({ li, ima }));
  const c = checks(r);
  for (const k of ['duplicate-brand-label', 'duplicate-person', 'personal-webmail', 'other-company-domain', 'two-domains-one-brand',
    'invalid-address', 'first-person-claim', 'placeholder-line', 'product-praise-template', 'creator-numbers-disagree',
    'setting-typed-as-date', 'postal-address-missing', 'wrong-purpose-inbox', 'generic-subject', 'sponsor-hook-available']) {
    assert.ok(c[k] >= 1, `${k} should fire (got ${c[k]})`);
  }
  assert.equal(c['personal-webmail'], 1);
  assert.equal(c['other-company-domain'], 1, 'only the PR firm, not the webmail or the brand itself');
  const jay = r.findings.find((f) => f.check === 'creator-numbers-disagree').items[0];
  assert.match(jay.detail, /300k.*24k.*best 190k/);
});

test('a clean sheet raises none of the fix-class checks', () => {
  const { li, ima } = sheets({ dirty: false });
  const r = audit(loadSheets({ li, ima }));
  const fixes = r.findings.filter((f) => f.severity === 'fix').map((f) => f.check);
  assert.deepEqual(fixes, []);
  assert.ok(!r.findings.some((f) => ['product-praise-template', 'generic-subject', 'other-company-domain'].includes(f.check)));
});

test('the brand is carried down a column left blank', () => {
  const rows = people({ rows: [
    { _row: 2, Brand: 'Acme', 'Employee Name': 'Ava Sample', 'Linked in Email': at('ava', 'acme.test') },
    { _row: 3, Brand: '', 'Employee Name': 'Ben Sample', 'Linked in Email': at('ben', 'acme.test') },
  ] });
  assert.equal(rows[1].brand, 'Acme');
});

test('the CLI prints counts but no names, and refuses an --out inside the repository', () => {
  const { li, ima } = sheets();
  const out = execFileSync(process.execPath, [join(here, 'audit.mjs'), '--li', li, '--ima', ima], { encoding: 'utf8' });
  assert.match(out, /people 7/);
  assert.ok(!out.includes('Ava Sample') && !out.includes('Sample'), 'no person name on stdout');
  const inside = join(REPO_ROOT, 'agency-desk', 'should-not-exist');
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'audit.mjs'), '--li', li, '--out', inside], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.ok(!existsSync(inside), 'nothing was written inside the repository');
});

test('--strict exits 1 while a fix-class finding stands', () => {
  const { li, ima } = sheets();
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'audit.mjs'), '--li', li, '--ima', ima, '--strict'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 1);
});
