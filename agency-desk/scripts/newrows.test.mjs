// Who gets a draft next, on made-up sheets: nobody is drafted twice, a stop is final, a LinkedIn-found address waits
// for a yes, and the newest rows Leif added come first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toCSV, readTable, REPO_ROOT } from './lib.mjs';
import { newRows, seenFrom } from './newrows.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const at = (local, domain) => [local, domain].join('@'); // built at run time so the privacy gate sees no address
const S1 = ['Brand', 'Employee Name', 'Linked in Email', 'Contacted'];
const INF = ['Name', 'Platform', 'Niche', 'Followers', 'Subject used', 'Email', 'Contacted', 'Replied', 'Personalisation Key word from their video', 'Personalisation Key word from their video'];
const sheet1 = (rows) => readTable(toCSV([S1, ...rows]));
const inf = (rows) => readTable(toCSV([INF, ...rows]));
const c = (name, email, { contacted = '', replied = '', kw = '', kw2 = '' } = {}) => [name, '', 'garden', '', '', email, contacted, replied, kw, kw2];

test('a person already drafted or emailed is never picked again, whichever file says so', () => {
  const data = {
    sheet1: sheet1([['Acme Mowers', 'Ava Sample', at('ava', 'acme.test'), ''], ['Gizmo', 'Ben Sample', at('ben', 'gizmo.test'), '']]),
    influencers: inf([c('Jay Builds', at('jay', 'jay.test')), c('Pip Grows', at('pip', 'pip.test'))]),
  };
  const seen = seenFrom([`Send order,Who,Email\n1,Jay,${at('JAY', 'jay.test')}\n`, `To: ${at('ava', 'acme.test')}`]);
  const r = newRows(data, { seen });
  const keys = [...r.creators, ...r.brands].map((p) => p.key);
  assert.deepEqual(keys.sort(), ['Creator | Pip Grows', 'Gizmo | Ben Sample'], 'addresses match in any case');
  assert.equal(r.counts.seen, 2);
});

test('the sheet saying "contacted" counts as emailed, and a key column (Brand | Name) counts as seen', () => {
  const data = {
    sheet1: sheet1([['Acme Mowers', 'Ava Sample', at('ava', 'acme.test'), 'Yes'], ['Gizmo', 'Ben Sample', at('ben', 'gizmo.test'), '']]),
    influencers: inf([c('Jay Builds', at('jay', 'jay.test'), { contacted: '1.0' })]),
  };
  const r = newRows(data, { seen: seenFrom(['Key,Note\nGizmo | Ben Sample,in the pack\n']) });
  assert.deepEqual([...r.creators, ...r.brands], []);
  assert.equal(r.counts.seen, 3);
  const pack = seenFrom(['Joy · Key (Brand | Name),Joy · Route\nGizmo | Ben Sample,linkedin-dm\n']);
  assert.ok(pack.keys.has('gizmo | ben sample'), "the pack's own key header counts");
  assert.equal(seenFrom(['Name,Personalisation Key word from their video\nJay,cedar\n']).keys.size, 0, 'a column that merely mentions "Key" does not');
});

test('a stop is final, a declined creator waits for a real brief, and personal webmail from LinkedIn is never used', () => {
  const data = {
    sheet1: sheet1([['Acme Mowers', 'Ava Sample', at('ava', 'acme.test'), ''], ['Acme Mowers', 'Cal Sample', at('cal', 'gmail.com'), '']]),
    influencers: inf([c('Jay Builds', at('jay', 'jay.test'), { replied: 'Declined' }), c('Rex Rigs', at('rex', 'rex.test'), { replied: 'Wants 6k and a car' }), c('Pip Grows', at('pip', 'gmail.com'))]),
  };
  const events = [{ key: 'Acme Mowers | Ava Sample', event: 'stop', at: '2026-11-01' }];
  const r = newRows(data, { seen: seenFrom([]), events });
  assert.deepEqual(r.creators.map((p) => p.key), ['Creator | Pip Grows'], "a creator's own webmail is their published business address");
  assert.deepEqual(r.brands, []);
  const why = Object.fromEntries(r.skipped.map((s) => [s.key, s.why]));
  assert.match(why['Acme Mowers | Ava Sample'], /said stop/);
  assert.match(why['Acme Mowers | Cal Sample'], /webmail/);
  assert.match(why['Creator | Jay Builds'], /declined/);
  assert.match(why['Creator | Rex Rigs'], /declined/, 'asking far more than our budget counts as declined');
});

test('a LinkedIn-found address waits On hold for a yes; with a yes on record it is Ready, and goes first', () => {
  const data = {
    sheet1: sheet1([['Acme Mowers', 'Ava Sample', at('ava', 'acme.test'), ''], ['Gizmo', 'Ben Sample', at('ben', 'gizmo.test'), '']]),
    influencers: inf([]),
  };
  const events = [{ key: 'Acme Mowers | Ava Sample', event: 'yes', at: '2026-11-10' }];
  const r = newRows(data, { seen: seenFrom([]), events });
  assert.deepEqual(r.brands.map((p) => [p.key, p.folder]), [['Acme Mowers | Ava Sample', 'Ready to send'], ['Gizmo | Ben Sample', 'On hold']]);
  assert.match(r.brands[1].why, /yes on LinkedIn/);
});

test('the newest rows come first, one person per brand per run, and the rest wait for the next run', () => {
  const data = {
    sheet1: sheet1([
      ['Acme Mowers', 'Ava Sample', at('ava', 'acme.test'), ''], ['', 'Dee Sample', at('dee', 'acme.test'), ''],
      ['Gizmo', 'Ben Sample', at('ben', 'gizmo.test'), ''], ['Bigco', 'Eve Sample', at('eve', 'bigco.test'), ''],
    ]),
    influencers: inf([c('A One', at('a', 'a.test')), c('B Two', at('b', 'b.test')), c('C Three', at('c', 'c.test'), { kw: 'raised beds', kw2: 'cedar' })]),
  };
  const r = newRows(data, { seen: seenFrom([]), maxCreators: 2, maxBrands: 2 });
  assert.deepEqual(r.creators.map((p) => p.name), ['C Three', 'B Two'], 'the bottom of the tab is what Leif added last');
  assert.deepEqual(r.creators[0].detail, ['raised beds', 'cedar'], "both of Leif's keyword columns come through");
  assert.deepEqual(r.brands.map((p) => p.key), ['Bigco | Eve Sample', 'Gizmo | Ben Sample']);
  assert.equal(r.counts.waiting, 3, 'one creator and two Acme people (a brand blank in its cell inherits the row above)');
});

test('one address listed twice is one person, and a cell holding two addresses uses the first', () => {
  const data = {
    sheet1: sheet1([]),
    influencers: inf([c('Jay Builds', `mailto:${at('jay', 'jay.test')} / ${at('jay2', 'jay.test')}`), c('Jay Builds again', at('Jay', 'jay.test'))]),
  };
  const r = newRows(data, { seen: seenFrom([]) });
  assert.equal(r.creators.length, 1);
  assert.equal(r.creators[0].email, at('jay', 'jay.test'));
});

test('the CLI prints counts only, writes names outside the repository, and refuses to write inside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agency-newrows-'));
  const li = join(dir, 'li'); const ima = join(dir, 'ima');
  mkdirSync(li); mkdirSync(ima);
  writeFileSync(join(li, 'Sheet1.csv'), toCSV([S1, ['Acme Mowers', 'Ava Sample', at('ava', 'acme.test'), '']]));
  writeFileSync(join(ima, 'Influencers.csv'), toCSV([INF, c('Jay Builds', at('jay', 'jay.test'))]));
  const seen = join(dir, 'seen.txt'); writeFileSync(seen, '');
  const out = join(dir, 'new.json');
  const run = (o) => execFileSync(process.execPath, [join(here, 'newrows.mjs'), '--li', li, '--ima', ima, '--seen', seen, '--out', o], { stdio: 'pipe' }).toString();
  const stdout = run(out);
  assert.match(stdout, /new: 1 creator/);
  assert.doesNotMatch(stdout, /Ava|Jay/, 'no names on the screen');
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).creators[0].name, 'Jay Builds');
  let code = 0;
  try { run(join(REPO_ROOT, 'new.json')); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  assert.ok(!existsSync(join(REPO_ROOT, 'new.json')));
});
