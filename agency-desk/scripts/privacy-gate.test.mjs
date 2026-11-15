// The public-repo gate, on made-up names: the files as they stand, every line the history ever added, the shape of
// an API key, and the private terms list. The history tests commit to throwaway repositories under the OS temp
// directory, never to this one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib.mjs';
import { scanText, appendTerms } from './privacy-gate.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const at = (local, domain) => [local, domain].join('@'); // built at run time so the privacy gate sees no address

// git's own variables are dropped, so a run from inside a git hook cannot aim these commands at the real repository.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const run = (argv, extra = {}) => {
  const r = spawnSync(process.execPath, [join(here, 'privacy-gate.mjs'), ...argv], { encoding: 'utf8', env: { ...env, ...extra } });
  return { code: r.status, out: r.stdout + r.stderr };
};

// Every folder made here is removed when the run ends: a suite that runs often would otherwise leave thousands.
const made = [];
const temp = (prefix) => made[made.push(mkdtempSync(join(tmpdir(), prefix))) - 1];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// A throwaway repository with its private lists beside it, outside it. Every command carries its own identity and
// signing switch, so no machine's settings matter. commit() writes one file and returns the commit's short hash.
function repo() {
  const dir = temp('agency-gate-');
  const root = join(dir, 'repo');
  mkdirSync(root);
  const git = (...argv) => execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...argv], { encoding: 'utf8', env }).trim();
  git('init', '-q');
  writeFileSync(join(dir, 'names.txt'), 'Jane Doe\n');
  writeFileSync(join(dir, 'terms.txt'), 'Acmemow\n');
  const commit = (file, text, ...identity) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
    git('add', '-A');
    git(...identity, 'commit', '-q', '-m', 'a change');
    return git('rev-parse', '--short=7', 'HEAD');
  };
  const gate = (argv = [], extra) => run(['--root', root, '--names', join(dir, 'names.txt'), '--terms', join(dir, 'terms.txt'), ...argv], extra);
  return { root, git, commit, gate };
}
const hitLine = (hash, file, kind) => new RegExp(`^${hash} ${file.replaceAll('.', '\\.')} ${kind}$`, 'm');

test('the privacy gate refuses to run without its names and terms lists', () => {
  let code = 0;
  try { execFileSync(process.execPath, [join(here, 'privacy-gate.mjs')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2);
  execFileSync(process.execPath, [join(here, 'privacy-gate.mjs'), '--emails-only'], { stdio: 'pipe' });
});

test('the privacy gate passes reserved domains and catches real addresses and sheet names', () => {
  assert.deepEqual(scanText(`write to ${at('team', 'example.com')} or ${at('a', 'acme.test')}`), []);
  const hits = scanText(`contact ${at('jane.doe', 'realbrand.com')} now`, { names: ['Jane Doe', 'Jo'] });
  assert.equal(hits.filter((h) => h.kind === 'address').length, 1);
  assert.equal(scanText('a note about Jane Doe', { names: ['Jane Doe'] }).length, 1);
  assert.equal(scanText('a note about Jo', { names: ['Jo'] }).length, 0, 'a short first name alone is not identifying');
  assert.equal(scanText('pitched Acmemow today', { terms: ['Acmemow'] }).length, 1);
  assert.equal(scanText('pitched Acmemowers today', { terms: ['Acmemow'] }).length, 0, 'whole words only');
  assert.equal(scanText("{ name: 'Zola', numbers: ['80k'] }", { terms: ['Zola'] }).length, 1, 'a four-letter creator name is caught');
  for (const leak of ['see youtube.com/@zola', 'const zola = {}', 'ZOLA RATES']) {
    assert.equal(scanText(leak, { terms: ['Zola'] }).length, 1, `a short name in a handle, a variable or capitals is caught: ${leak}`);
  }
  assert.equal(scanText('pitched Zolander today', { terms: ['Zola'] }).length, 0, 'still whole words only');
});

test('a term committed and then deleted passes the files as they stand and fails --history, which names the commit and the file but never the term', () => {
  const { commit, gate } = repo();
  const first = commit('agency-desk/docs/notes.md', 'pitched Acmemow today\n');
  commit('agency-desk/docs/notes.md', 'pitched nobody today\n');
  assert.equal(gate().code, 0, 'the tree scan sees only the files as they are now');
  const { code, out } = gate(['--history']);
  assert.equal(code, 1);
  assert.match(out, hitLine(first, 'agency-desk/docs/notes.md', 'term'));
  assert.doesNotMatch(out, /acmemow/i, 'printing the term would repeat the leak in a log');
});

test('--known lists an old commit as known and passes, and a hit in any other commit still fails', () => {
  const { git, commit, gate } = repo();
  const first = commit('agency-desk/docs/notes.md', 'pitched Acmemow today\n');
  commit('agency-desk/docs/notes.md', 'pitched nobody today\n');
  const one = gate(['--history', '--known', first]);
  assert.equal(one.code, 0, one.out);
  assert.match(one.out, hitLine(first, 'agency-desk/docs/notes.md', 'term \\(known\\)'));
  const near = first.slice(0, 6) + (first[6] === 'a' ? 'b' : 'a');
  assert.equal(gate(['--history', '--known', near]).code, 1, 'a hash one character off excuses nothing');
  const second = commit('agency-desk/docs/more.md', 'Acmemow again\n');
  commit('agency-desk/docs/more.md', 'nobody again\n');
  const two = gate(['--history', '--known', first]);
  assert.equal(two.code, 1, 'a commit that is not on the list still fails the gate');
  assert.match(two.out, hitLine(second, 'agency-desk/docs/more.md', 'term'));
  assert.match(two.out, hitLine(first, 'agency-desk/docs/notes.md', 'term \\(known\\)'));
  assert.equal(gate(['--history', '--known', `${first}, ${git('rev-parse', second)}`]).code, 0, 'a full hash is taken as well as a short one');
});

test('--known is refused without --history, and when it is not a list of commit hashes', () => {
  const { commit, gate } = repo();
  const first = commit('agency-desk/docs/notes.md', 'nothing private\n');
  assert.equal(gate(['--known', first]).code, 2, 'without --history nothing in the past would be read');
  for (const bad of [[], [''], ['abc12'], ['everything']]) {
    assert.equal(gate(['--history', '--known', ...bad]).code, 2, `--known ${bad}: a short or empty entry would excuse commits nobody named`);
  }
});

test("an author's name and address in a commit header are not hits", () => {
  const { commit, gate } = repo();
  commit('agency-desk/docs/notes.md', 'nothing private\n', '-c', 'user.name=Jane Doe', '-c', `user.email=${at('jane.doe', 'realbrand.com')}`);
  const { code, out } = gate(['--history']);
  assert.match(out, / history: 1 commits /, 'the history was read');
  assert.equal(code, 0, out);
});

test('an API key shape is a secret hit in a file and in the history, and is never printed', () => {
  const key = `AIza${'aB3-_'.repeat(7)}`; // built at run time so this file holds no key shape
  assert.deepEqual(scanText(`const KEY = '${key}';`), [{ kind: 'secret' }], 'the hit carries no value, so nothing can print it');
  assert.deepEqual(scanText(key.slice(0, -1)), [], 'one character short is not the shape');
  const { root, commit, gate } = repo();
  const first = commit('agency-desk/scripts/config.mjs', `const KEY = '${key}';\n`);
  const tree = gate();
  assert.equal(tree.code, 1);
  assert.match(tree.out, /^agency-desk\/scripts\/config\.mjs: secret /m);
  assert.equal(run(['--root', root, '--emails-only']).code, 1, 'the check is on even when only addresses were asked for');
  commit('agency-desk/scripts/config.mjs', 'const KEY = process.env.KEY;\n');
  assert.equal(gate().code, 0);
  const past = gate(['--history']);
  assert.equal(past.code, 1);
  assert.match(past.out, hitLine(first, 'agency-desk/scripts/config.mjs', 'secret'));
  for (const r of [tree, past]) assert.doesNotMatch(r.out, /aB3-_/, 'a key in a log is a second leak');
});

test('appendTerms adds only new terms to the private list, one per line, and refuses a path inside the repository', () => {
  const file = join(temp('agency-terms-'), 'terms.txt');
  assert.deepEqual(appendTerms(file, ['Acmemow', '  Zola ', 'ACMEMOW', '', 'Acme   Mowers']), ['Acmemow', 'Zola', 'Acme Mowers']);
  assert.equal(readFileSync(file, 'utf8'), 'Acmemow\nZola\nAcme Mowers\n');
  assert.deepEqual(appendTerms(file, ['zola', 'Gizmo']), ['Gizmo'], 'a term already on the list, in any case, is not added twice');
  writeFileSync(file, 'Acmemow\nZola'); // a list edited by hand, left without its last newline
  assert.deepEqual(appendTerms(file, 'Gizmo'), ['Gizmo'], 'one term may come as a string');
  assert.equal(readFileSync(file, 'utf8'), 'Acmemow\nZola\nGizmo\n');
  assert.deepEqual(appendTerms(file, ['@Acmebot', '@acmemow', '@Zo']), ['Acmebot', '@Zo'], 'a handle is kept without its @, unless the gate would skip what is left');
  assert.equal(scanText('a video by Acmebot', { terms: readFileSync(file, 'utf8').split('\n') }).length, 1, 'so the bare name is caught too');
  const inside = join(REPO_ROOT, 'agency-desk', 'terms.txt');
  assert.throws(() => appendTerms(inside, ['Zola']), /refusing to write inside the repository/);
  assert.ok(!existsSync(inside));
});

test('the history scan reads every branch, a side branch whose change was thrown away, and a line a merge adds itself', () => {
  const { root, git, commit, gate } = repo();
  const trunk = git('symbolic-ref', '--short', 'HEAD');
  commit('agency-desk/docs/a.md', 'one\n');
  commit('agency-desk/docs/b.md', 'one\n');
  git('checkout', '-q', '-b', 'side');
  const thrown = commit('agency-desk/docs/a.md', 'one\npitched Acmemow\n');
  git('checkout', '-q', trunk);
  commit('agency-desk/docs/c.md', 'meanwhile\n');
  git('merge', '-q', '-s', 'ours', '-m', 'keep ours', 'side'); // the side's line never reaches the files
  git('branch', '-q', '-D', 'side');
  git('checkout', '-q', '-b', 'side');
  const kept = commit('agency-desk/docs/b.md', 'one\nside line Acmemow\n');
  git('checkout', '-q', trunk);
  commit('agency-desk/docs/b.md', 'one\nmain line\n');
  git('merge', '-q', '-s', 'ours', '--no-commit', 'side');
  writeFileSync(join(root, 'agency-desk/docs/b.md'), 'one\nmain line\nside line Acmemow\n'); // both sides' lines, nothing new
  const merge = commit('agency-desk/docs/d.md', 'the merge adds Acmemow itself\n');
  commit('agency-desk/docs/b.md', 'one\nmain line\n');
  commit('agency-desk/docs/d.md', 'gone\n');
  git('checkout', '-q', '-b', 'apart');
  const apart = commit('agency-desk/docs/e.md', 'Acmemow on a branch that is never merged\n');
  git('checkout', '-q', trunk);
  assert.equal(gate().code, 0);
  const { code, out } = gate(['--history']);
  assert.equal(code, 1);
  assert.match(out, hitLine(thrown, 'agency-desk/docs/a.md', 'term'));
  assert.match(out, hitLine(kept, 'agency-desk/docs/b.md', 'term'));
  assert.match(out, hitLine(merge, 'agency-desk/docs/d.md', 'term'));
  assert.match(out, hitLine(apart, 'agency-desk/docs/e.md', 'term'));
  assert.equal(out.match(/ term$/gm).length, 4, 'a merge is charged only with the lines neither side already had');
});

test("the history is read the same under a machine's own git settings", () => {
  const { commit, gate } = repo();
  const first = commit('agency-desk/docs/notes.md', 'pitched Acmemow today\n'); // the first commit of all
  commit('.gitattributes', '*.md diff=hush\n*.csv -diff\n');
  const sheet = commit('agency-desk/docs/sheet.csv', 'Brand\nAcmemow\n'); // git is told not to show this file's lines
  const later = commit('agency-desk/docs/later.md', 'Acmemow once more\n');
  const plain = gate(['--history']);
  assert.match(plain.out, hitLine(first, 'agency-desk/docs/notes.md', 'term'));
  assert.match(plain.out, hitLine(sheet, 'agency-desk/docs/sheet.csv', 'term'));
  assert.match(plain.out, hitLine(later, 'agency-desk/docs/later.md', 'term'));
  // Settings a machine may carry: no first commit shown, colour codes, four-letter hashes, a filter over .md files.
  const settings = Object.entries({ 'log.showRoot': 'false', 'color.ui': 'always', 'core.abbrev': '4', 'diff.hush.textconv': 'true' });
  const machine = { GIT_CONFIG_COUNT: String(settings.length) };
  settings.forEach(([key, value], i) => { machine[`GIT_CONFIG_KEY_${i}`] = key; machine[`GIT_CONFIG_VALUE_${i}`] = value; });
  assert.equal(gate(['--history'], machine).out, plain.out);
});

test('a path given straight after --history is the path that is scanned', () => {
  const { commit, gate } = repo();
  commit('agency-desk/docs/notes.md', 'nothing private\n');
  const first = commit('other/notes.md', 'pitched Acmemow today\n');
  commit('other/notes.md', 'pitched nobody today\n');
  assert.equal(gate(['--history']).code, 0, 'the hit is outside the default paths');
  const { code, out } = gate(['--history', 'other']);
  assert.equal(code, 1, 'the flag must not swallow the path and scan the default paths instead');
  assert.match(out, hitLine(first, 'other/notes.md', 'term'));
});

test('a mistyped flag or path is refused, so a scan of nothing cannot pass as a clean one', () => {
  const { git, commit, gate } = repo();
  commit('agency-desk/docs/notes.md', 'pitched Acmemow today\n');
  commit('agency-desk/docs/notes.md', 'pitched nobody today\n');
  assert.equal(gate(['--history']).code, 1);
  assert.equal(gate(['--histroy']).code, 2, 'a flag the gate does not know would be dropped, and the history never read');
  assert.equal(gate(['agency-dsk']).code, 2, 'no file under the path');
  assert.equal(gate(['--history', 'agency-dsk']).code, 2, 'no file and no commit under the path');
  git('rm', '-q', 'agency-desk/docs/notes.md');
  git('commit', '-q', '-m', 'the file goes');
  assert.equal(gate(['--history']).code, 1, 'with every file gone, the history is still there to read');
});

test('when git fails part-way, the gate fails without printing what it had read', () => {
  const { root, git, commit, gate } = repo();
  commit('agency-desk/docs/old.md', 'an old line\n');
  commit('agency-desk/docs/notes.md', 'pitched Acmemow today\n');
  commit('agency-desk/docs/notes.md', 'pitched nobody today\n');
  // Break the stored copy of the oldest file: git prints the newer commits, then stops.
  const blob = git('rev-parse', 'HEAD~2:agency-desk/docs/old.md');
  rmSync(join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
  const { code, out } = gate(['--history']);
  assert.notEqual(code, 0);
  assert.match(out, /git log failed/);
  assert.doesNotMatch(out, /acmemow/i);
});

test('a file whose name git would put in quotes is still scanned', () => {
  const { commit, gate } = repo();
  commit('agency-desk/docs/café notes.md', 'pitched Acmemow today\n');
  const { code, out } = gate();
  assert.equal(code, 1, 'git quotes a name with an accent, and a file not found under the quoted name was skipped');
  assert.match(out, /^agency-desk\/docs\/café notes\.md: term /m);
  assert.doesNotMatch(out, /acmemow/i, 'a private name or term is never printed, from a file either');
});
