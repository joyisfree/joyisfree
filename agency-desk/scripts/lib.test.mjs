// The shared helpers: CSV, domains, views, and the refusal to write inside the public repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCSV, toCSV, readTable, col, registrable, stem, relation, brandKey, parseViews, pricingStats, fmtViews,
  assertOutsideRepo, REPO_ROOT, personKey, hostOf,
} from './lib.mjs';

test('CSV round-trips quotes, commas and newlines inside a cell', () => {
  const rows = [['a', 'b,c', 'say "hi"'], ['line\none', '', 'x']];
  assert.deepEqual(parseCSV(toCSV(rows)).slice(0, 2), rows);
  assert.deepEqual(parseCSV('﻿h1,h2\r\n1,2\r\n'), [['h1', 'h2'], ['1', '2']]);
});

test('a table is read by header prefix, with the sheet row number', () => {
  const t = readTable('Brand,"Valid Email?\nnote",Follow Up\nAcme,Valid,Bumped\n');
  assert.equal(col(t.rows[0], 'Valid Email'), 'Valid');
  assert.equal(t.rows[0]._row, 2);
});

test('registrable domains keep two-part suffixes', () => {
  assert.equal(registrable('shop.acme.co.uk'), 'acme.co.uk');
  assert.equal(registrable('au.store.acme.com'), 'acme.com');
  assert.equal(registrable('www.acme.com.au'), 'acme.com.au');
  assert.equal(stem('acme-tools.co.uk'), 'acmetools');
});

test('relation tells a storefront from another company', () => {
  assert.equal(relation('acme.com', 'global.acme.com'), 'same');
  assert.equal(relation('acme.com', 'acmepower.com.au'), 'alias'); // another storefront
  assert.equal(relation('acme.de', 'acme.us'), 'alias');
  assert.equal(relation('acmeio.com', 'acme.io'), 'alias'); // the extra letters are the TLD
  assert.equal(relation('acme.com', 'acmetech.com'), 'check'); // same start, maybe another company
  assert.equal(relation('acme.com', 'gmail.com'), 'webmail');
  assert.equal(relation('acme.com', 'prfirm.com'), 'other');
  assert.equal(relation('acmetools.com', 'acmetech.com', 'Acme'), 'check');
});

test('autofill copies of a label share one brand key', () => {
  assert.equal(brandKey('Gizmo 360'), brandKey('Gizmo 363'));
  assert.equal(brandKey('Qx1'), brandKey('Qx3'));
  assert.equal(brandKey('AcmeBot'), brandKey('Acmebot'));
  assert.notEqual(brandKey('70gizmo'), brandKey('Acme'));
});

test('views parse with units, and the Pricing tab sums give mean and median', () => {
  assert.equal(parseViews('300k avg'), 300000);
  assert.equal(parseViews('1.83m'), 1830000);
  assert.equal(parseViews('2,780,000 views'), 2780000);
  assert.ok(Number.isNaN(parseViews('no number')));
  const s = pricingStats('190k + 15000 + 1900 + 2200 + 8800 + 2800 + 2900 + 7300 + 1400 + 8000 = 240,300 Divided by 10 = 24K');
  assert.equal(s.n, 10);
  assert.equal(Math.round(s.mean), 24030);
  assert.equal(s.max, 190000);
  assert.equal(s.median, 5100);
  assert.equal(fmtViews(24030), '24k');
});

test('writing inside the repository is refused; the scratchpad is allowed', () => {
  assert.throws(() => assertOutsideRepo(join(REPO_ROOT, 'agency-desk', 'out')), /refusing to write inside the repository/);
  assert.throws(() => assertOutsideRepo(REPO_ROOT), /refusing/);
  assert.ok(assertOutsideRepo(join(tmpdir(), 'agency-out')));
});

test('keys and hosts are normalised', () => {
  assert.equal(personKey(' Acme ', 'Ava   Sample\r'), 'Acme | Ava Sample');
  assert.equal(hostOf('acme.com/au/sale'), 'acme.com');
  assert.equal(hostOf(''), '');
});
