// Tests for the reach recorder (reach.mjs), its own suite (SUITE_FOR). Each test writes a small fixture repo into a
// scratch folder this file removes when it ends, runs `node --test` on it with the recorder in NODE_OPTIONS (as the
// harness does), and reads back what each test file of the fixture loaded, read, listed and started. The fixture runs
// with this process's environment minus any recorder or test-runner context this file itself runs under, so a run of
// this file under the harness records only for the fixture. The fixtures hold no real data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PRELOAD_URL, RECORDER_VARS, KIND_RANK, importsOf, moduleHooks, readRecords, recorderEnv } from './reach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), 'reach-test-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const lines = (...l) => `${l.join('\n')}\n`;
const HEAD = ["import { test } from 'node:test';", "import assert from 'node:assert/strict';"];

// A throwaway run folder laid out as the harness lays one out: repo (the copy), tmp (its TMPDIR) and reach (records).
function fixture(files) {
  const work = mkdtempSync(join(SCRATCH, 'run-'));
  const t = { work, root: join(work, 'repo'), tmp: join(work, 'tmp'), dir: join(work, 'reach') };
  for (const d of [t.root, t.tmp, t.dir]) mkdirSync(d, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(t.root, rel)), { recursive: true });
    writeFileSync(join(t.root, rel), text);
  }
  return t;
}
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT' && k !== 'NODE_OPTIONS' && !RECORDER_VARS.includes(k)));
// `node --test` on `tests` (repo-relative) in the fixture, recorded; the run's TAP and the records it left.
function record(t, tests, { nodeOptions = '', env = {}, work = t.work } = {}) {
  const vars = { ...clean(), ...recorderEnv({ dir: t.dir, root: t.root, tmp: t.tmp, work, nodeOptions }), TMPDIR: t.tmp, ...env };
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd: t.root, env: vars, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, records: readRecords(t.dir) };
}
const green = (r) => assert.equal(r.status, 0, r.out);

test('a test file records, repo-relative and under its own name, what it imports, requires, reads, stats and lists', () => {
  const t = fixture({
    'package.json': '{ "type": "module" }\n',
    'pkg/a.test.mjs': lines(
      ...HEAD,
      "import fs, { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';",
      "import { readFile } from 'node:fs/promises';",
      "import { createRequire } from 'node:module';",
      "import { helper } from './lib.mjs';",
      "import { legacy } from './legacy.js';",
      'const require = createRequire(import.meta.url);',
      "test('reads', () => {",
      "  assert.equal(helper(), 'deep');",
      "  assert.equal(legacy, 'js');",
      "  assert.equal(JSON.parse(readFileSync('pkg/data.json', 'utf8')).n, 1);",
      "  assert.equal(existsSync('pkg/missing.json'), false);",
      "  assert.deepEqual(readdirSync('pkg/folder'), ['x.txt']);",
      "  assert.throws(() => statSync('pkg/gone.json'));",
      "  assert.equal(fs.readFileSync(new URL('./other.txt', import.meta.url), 'utf8'), 'other');",
      "  assert.equal(require('./c.cjs'), 3);",
      '});',
      "test('reads that wait', async () => {",
      "  assert.equal(await readFile('pkg/p.txt', 'utf8'), 'p');",
      "  await assert.rejects(import('./absent.mjs'));",
      '});',
    ),
    'pkg/p.txt': 'p',
    'pkg/lib.mjs': "import { deep } from './deep.mjs';\nexport const helper = () => deep;\n",
    'pkg/deep.mjs': "export const deep = 'deep';\n",
    'pkg/legacy.js': "export const legacy = 'js';\n",
    'pkg/data.json': '{ "n": 1 }\n',
    'pkg/folder/x.txt': 'x\n',
    'pkg/other.txt': 'other',
    'pkg/c.cjs': 'module.exports = 3;\n',
  });
  const r = record(t, ['pkg/a.test.mjs']);
  green(r);
  assert.deepEqual(Object.keys(r.records), ['pkg/a.test.mjs'], 'one owner, the test file: the runner records nothing');
  const rec = r.records['pkg/a.test.mjs'];
  assert.deepEqual(rec.opaque, []);
  assert.equal(rec.processes, 1);
  const want = {
    'pkg/a.test.mjs': 'file', 'pkg/lib.mjs': 'file', 'pkg/deep.mjs': 'file', // imports, however deep
    'pkg/legacy.js': 'file', 'pkg/package.json': 'file', 'package.json': 'file', // a .js file and what says how it is read
    'pkg/data.json': 'file', // a named import of readFileSync
    'pkg/missing.json': 'file', 'pkg/gone.json': 'file', // a miss, and a stat that threw
    'pkg/folder': 'dir', 'pkg/other.txt': 'file', 'pkg/c.cjs': 'file',
    'pkg/p.txt': 'file', // through fs/promises
    'pkg/absent.mjs': 'file', // an import that found nothing
  };
  for (const [p, k] of Object.entries(want)) assert.equal(rec.paths[p], k, `${p}: ${JSON.stringify(rec.paths)}`);
  for (const p of Object.keys(rec.paths)) assert.ok(!p.startsWith('/') && !p.startsWith('..'), `${p} is not repo-relative`);
});

test('a CLI a test file starts records under that test file, and a child killed in the middle of a read still left it', () => {
  const t = fixture({
    'pkg/b.test.mjs': lines(
      ...HEAD,
      "import { openSync, closeSync, constants } from 'node:fs';",
      "import { spawn, spawnSync } from 'node:child_process';",
      "test('a CLI', () => assert.equal(spawnSync(process.execPath, ['pkg/cli.mjs'], { encoding: 'utf8' }).stdout, 'cli read 2\\n'));",
      "test('a child killed while it is blocked reading a pipe', async () => {",
      "  const c = spawn(process.execPath, ['pkg/hang.mjs'], { stdio: 'ignore' });",
      '  let fd = null;',
      '  // the pipe opens for writing only once the child holds it open to read, so the child is inside its read now',
      '  for (let i = 0; i < 400 && fd === null; i++) { try { fd = openSync(\'pkg/pipe\', constants.O_WRONLY | constants.O_NONBLOCK); } catch { await new Promise((r) => setTimeout(r, 25)); } }',
      "  assert.notEqual(fd, null, 'the child never opened the pipe');",
      "  c.kill('SIGKILL');",
      "  await new Promise((r) => c.once('close', r));",
      '  closeSync(fd);',
      '});',
    ),
    'pkg/cli.mjs': "import { readFileSync } from 'node:fs';\nconsole.log(`cli read ${JSON.parse(readFileSync('pkg/cli.json', 'utf8')).n}`);\n",
    'pkg/cli.json': '{ "n": 2 }\n',
    'pkg/hang.mjs': "import { readFileSync } from 'node:fs';\nreadFileSync('pkg/pipe');\n",
  });
  const made = spawnSync('mkfifo', [join(t.root, 'pkg/pipe')], { cwd: SCRATCH, encoding: 'utf8' });
  assert.equal(made.status, 0, `mkfifo: ${made.stderr}`);
  const r = record(t, ['pkg/b.test.mjs']);
  green(r);
  assert.deepEqual(Object.keys(r.records), ['pkg/b.test.mjs'], 'a child keeps its test file as its owner');
  const rec = r.records['pkg/b.test.mjs'];
  assert.equal(rec.processes, 3, 'the test file, the CLI and the killed child');
  assert.deepEqual(rec.opaque, []);
  for (const p of ['pkg/cli.mjs', 'pkg/cli.json', 'pkg/hang.mjs']) assert.equal(rec.paths[p], 'file', p);
  assert.equal(rec.paths['pkg/pipe'], 'file', 'the read the child was killed inside was written down before it began');
});

test('a node child started without the recorder makes its owner OPAQUE; a node child that carries it does not', () => {
  const t = fixture({
    'pkg/c.test.mjs': lines(...HEAD, "import { spawnSync } from 'node:child_process';", "test('bare', () => assert.equal(spawnSync(process.execPath, ['-e', '0'], { env: { PATH: process.env.PATH } }).status, 0));"),
    'pkg/d.test.mjs': lines(
      ...HEAD,
      "import { spawnSync, execFileSync, fork } from 'node:child_process';",
      "test('inherits', async () => {",
      "  assert.equal(spawnSync(process.execPath, ['-e', '0']).status, 0);",
      "  assert.equal(spawnSync(process.execPath, ['-e', '0'], { env: { ...process.env, EXTRA: '1' } }).status, 0);",
      "  execFileSync('node', ['-e', '0']);",
      "  await new Promise((r) => fork('pkg/kid.mjs').once('exit', r));",
      '});',
    ),
    'pkg/kid.mjs': 'process.exitCode = 0;\n',
  });
  const r = record(t, ['pkg/c.test.mjs', 'pkg/d.test.mjs']);
  green(r);
  assert.deepEqual(r.records['pkg/c.test.mjs'].opaque, ['spawnSync: a node child started without the recorder']);
  assert.deepEqual(r.records['pkg/d.test.mjs'].opaque, []);
  assert.equal(r.records['pkg/d.test.mjs'].paths['pkg/kid.mjs'], 'file', 'a forked child records too');
});

test('a node child with a recorder of its own (a harness test on a fixture) has its preload recorded, and is OPAQUE only when it reaches the repo', () => {
  const own = (name, where) => [`pkg/${name}.test.mjs`, lines(
    ...HEAD,
    "import { spawnSync } from 'node:child_process';",
    "import { mkdtempSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import { join } from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    `test('${name}', () => {`,
    "  const dir = mkdtempSync(join(tmpdir(), 'nested-'));",
    "  const env = { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(join(process.cwd(), 'pkg', 'noop.mjs')).href}`, REACH_DIR: dir, REACH_ROOT: dir, REACH_OWNER: '' };",
    `  assert.equal(spawnSync(process.execPath, ['-e', '0'], { env${where} }).status, 0);`,
    '});',
  )];
  const cases = [own('away', ', cwd: tmpdir()'), own('here', '')];
  const t = fixture({ ...Object.fromEntries(cases), 'pkg/noop.mjs': '' });
  const r = record(t, cases.map(([f]) => f));
  green(r);
  assert.deepEqual(r.records['pkg/away.test.mjs'].opaque, []);
  assert.equal(r.records['pkg/away.test.mjs'].paths['pkg/noop.mjs'], 'file', 'the preload it names is a read');
  assert.deepEqual(r.records['pkg/here.test.mjs'].opaque, ['spawnSync: a node child with a recorder of its own reaches the repo through its working folder (<repo>)']);
});

test('a child that is not node makes its owner OPAQUE when its folder, an argument or a variable reaches the repo, and only then', () => {
  const sh = (name, call) => [`pkg/${name}.test.mjs`, lines(...HEAD, "import { spawnSync, execSync } from 'node:child_process';", "import { tmpdir } from 'node:os';", "import { join } from 'node:path';", `test('${name}', () => { ${call}; });`)];
  const cases = [
    sh('env', "spawnSync('sh', ['-c', 'true'], { cwd: tmpdir(), env: { ...process.env, PROJECT: process.cwd() } })"),
    sh('cwd', "spawnSync('sh', ['-c', 'true'])"),
    sh('arg', "execSync(`cat ${JSON.stringify(join(process.cwd(), 'pkg', 'data.txt'))}`, { cwd: tmpdir() })"),
    sh('none', "spawnSync('sh', ['-c', 'true'], { cwd: tmpdir() })"),
  ];
  const t = fixture({ ...Object.fromEntries(cases), 'pkg/data.txt': 'x\n' });
  const r = record(t, cases.map(([f]) => f));
  green(r);
  const why = (n) => r.records[`pkg/${n}.test.mjs`].opaque;
  assert.deepEqual(why('env'), ['spawnSync: sh is not node, and its variable PROJECT reaches the repo']);
  assert.deepEqual(why('cwd'), ['spawnSync: sh is not node, and its working folder (<repo>) reaches the repo']);
  assert.deepEqual(why('arg'), ['execSync: cat is not node, and its arguments (cat "<repo>/pkg/data.txt") reaches the repo']);
  assert.deepEqual(why('none'), [], "the recorder's own variables, which name the repo, do not count");
});

test("a path outside the repo copy is kept absolute, and one in the run's own temp or throwaway folder is dropped", () => {
  const t = fixture({
    'pkg/i.test.mjs': lines(
      ...HEAD,
      "import { readFileSync, writeFileSync, statSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      "test('outside', () => {",
      "  assert.equal(readFileSync(process.env.OUTSIDE, 'utf8'), 'out');",
      "  assert.equal(readFileSync(join(process.cwd(), '..', 'beside.txt'), 'utf8'), 'beside');",
      "  assert.ok(statSync(join(process.cwd(), '..')).isDirectory());",
      "  writeFileSync(join(tmpdir(), 'mine.txt'), 'x');",
      "  assert.equal(readFileSync(join(tmpdir(), 'mine.txt'), 'utf8'), 'x');",
      '});',
    ),
  });
  const outside = join(mkdtempSync(join(SCRATCH, 'outside-')), 'outside.txt');
  writeFileSync(outside, 'out');
  writeFileSync(join(t.work, 'beside.txt'), 'beside');
  const r = record(t, ['pkg/i.test.mjs'], { env: { OUTSIDE: outside } });
  green(r);
  const paths = r.records['pkg/i.test.mjs'].paths;
  assert.equal(paths[outside], 'file');
  assert.deepEqual(Object.keys(paths).filter((p) => p.startsWith('/') && p !== outside), [], JSON.stringify(paths));
  // With no throwaway folder named, what is beside the copy is outside it, and the temp folder is still dropped.
  const bare = fixture({ 'pkg/i.test.mjs': readFileSync(join(t.root, 'pkg/i.test.mjs'), 'utf8') });
  writeFileSync(join(bare.work, 'beside.txt'), 'beside');
  const b = record(bare, ['pkg/i.test.mjs'], { env: { OUTSIDE: outside }, work: '' });
  green(b);
  assert.deepEqual(Object.keys(b.records['pkg/i.test.mjs'].paths).filter((p) => p.startsWith('/')).sort(), [outside, bare.work, join(bare.work, 'beside.txt')].sort());
});

test('with no module hooks the record says OPAQUE and holds nothing else, so its suite keeps the old rules exactly', () => {
  const t = fixture({ 'pkg/j.test.mjs': lines(...HEAD, "import { readFileSync } from 'node:fs';", "test('j', () => assert.ok(readFileSync('pkg/j.test.mjs', 'utf8')));") });
  const strip = join(t.work, 'strip.mjs');
  writeFileSync(strip, "import m from 'node:module';\ndelete m.registerHooks;\n");
  const r = record(t, ['pkg/j.test.mjs'], { nodeOptions: `--import=${pathToFileURL(strip).href}` });
  green(r);
  assert.deepEqual(r.records, { 'pkg/j.test.mjs': { processes: 1, paths: {}, opaque: ['no module hooks: module.registerHooks needs Node 22.15 or later'] } });
});

test('a folder copied or listed with everything under it is a tree, and a copied file is a file', () => {
  const t = fixture({
    'pkg/k.test.mjs': lines(
      ...HEAD,
      "import { cpSync, copyFileSync, readdirSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      "test('k', () => {",
      "  cpSync('pkg/tree', join(tmpdir(), 'copy'), { recursive: true });",
      "  assert.deepEqual(readdirSync('pkg/tree2', { recursive: true }).sort(), ['in', 'in/y.txt']);",
      "  copyFileSync('pkg/one.txt', join(tmpdir(), 'one.txt'));",
      '});',
    ),
    'pkg/tree/x.txt': 'x\n',
    'pkg/tree2/in/y.txt': 'y\n',
    'pkg/one.txt': '1\n',
  });
  const r = record(t, ['pkg/k.test.mjs']);
  green(r);
  const paths = r.records['pkg/k.test.mjs'].paths;
  assert.deepEqual([paths['pkg/tree'], paths['pkg/tree2'], paths['pkg/one.txt']], ['tree', 'tree', 'file']);
});

test('a worker thread or a glob makes its owner OPAQUE', () => {
  const t = fixture({
    'pkg/w.test.mjs': lines(...HEAD, "import { Worker } from 'node:worker_threads';", "test('w', async () => { await new Promise((r) => new Worker('0', { eval: true }).once('exit', r)); });"),
    'pkg/g.test.mjs': lines(...HEAD, "import { globSync } from 'node:fs';", "test('g', () => assert.ok(Array.isArray(globSync('pkg/*.mjs'))));"),
  });
  const r = record(t, ['pkg/w.test.mjs', 'pkg/g.test.mjs']);
  green(r);
  assert.deepEqual(r.records['pkg/w.test.mjs'].opaque, ['a worker thread, which this recorder does not follow']);
  assert.deepEqual(r.records['pkg/g.test.mjs'].opaque, ['a glob, which reads folders it does not name']);
});

test('a record that cannot be written turns its run red, never a shorter record', () => {
  const t = fixture({ 'pkg/n.test.mjs': lines(...HEAD, "test('n', () => {});") });
  const notADir = join(t.work, 'not-a-folder');
  writeFileSync(notADir, '');
  const r = record(t, ['pkg/n.test.mjs'], { env: { REACH_DIR: notADir } });
  assert.notEqual(r.status, 0, r.out);
});

test('imported as a library the recorder installs nothing, and loaded twice it records once', () => {
  const t = fixture({ 'pkg/o.test.mjs': lines(...HEAD, "test('o', () => {});") });
  // A preload that is not this one, so NODE_OPTIONS names a preload, just never reach.mjs.
  const noop = join(t.work, 'noop.mjs');
  writeFileSync(noop, '');
  // The recorder's own bytes, copied beside the fixture, so the child's arguments name no file of the repo.
  const copy = join(t.work, 'reach.mjs');
  writeFileSync(copy, readFileSync(join(HERE, 'reach.mjs')));
  const vars = { ...clean(), NODE_OPTIONS: `--import=${pathToFileURL(noop).href}`, REACH_DIR: t.dir, REACH_ROOT: t.root, REACH_TMP: t.tmp, NODE_TEST_CONTEXT: 'child-v8' };
  const lib = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(copy).href)});`], { cwd: t.work, env: vars, encoding: 'utf8' });
  assert.equal(lib.status, 0, lib.stderr);
  assert.deepEqual(readdirSync(t.dir), [], 'a library import wrote a record');
  // Set by hand: recorderEnv itself would drop the first of the two.
  const r = record(t, ['pkg/o.test.mjs'], { env: { NODE_OPTIONS: `--import=${PRELOAD_URL}?again --import=${PRELOAD_URL}` } });
  green(r);
  assert.equal(r.records['pkg/o.test.mjs'].processes, 1, 'two copies of the preload, one record');
});

test('the module hooks note every file: URL loaded, the package scopes of a .js file, and an import that found nothing, and change none of them', () => {
  // Called directly: on Node 22.22 the loader's own read of each module is also seen through fs.openSync, so a real
  // process cannot show the hooks missing; these are what still sees a load where that read goes elsewhere.
  const seen = [];
  const h = moduleHooks({ note: (u) => seen.push(String(u)), scopes: (abs) => seen.push(`scopes of ${abs}`) });
  const loaded = { format: 'module', source: 'x' };
  assert.equal(h.load('file:///r/a.mjs', {}, () => loaded), loaded);
  assert.equal(h.load('node:fs', {}, () => loaded), loaded);
  h.load('file:///r/b.js', {}, () => loaded);
  const found = { url: 'file:///r/c.mjs' };
  assert.equal(h.resolve('./c.mjs', { parentURL: 'file:///r/a.mjs' }, () => found), found);
  const lost = new Error('Cannot find module');
  assert.throws(() => h.resolve('./gone.mjs', { parentURL: 'file:///r/a.mjs' }, () => { throw lost; }), (e) => e === lost);
  assert.throws(() => h.resolve('some-package', { parentURL: 'file:///r/a.mjs' }, () => { throw lost; }), (e) => e === lost);
  assert.deepEqual(seen, ['file:///r/a.mjs', 'file:///r/b.js', 'scopes of /r/b.js', 'file:///r/gone.mjs']);
});

test('readRecords: a torn last line is ignored, a file with no start line is no record, and a line it cannot read is OPAQUE', () => {
  const dir = mkdtempSync(join(SCRATCH, 'records-'));
  const start = (owner) => JSON.stringify({ start: 1, owner, pid: 1, node: process.version });
  writeFileSync(join(dir, 'a.1-1.jsonl'), `${start('a.test.mjs')}\n${JSON.stringify({ p: 'x.mjs', k: 'file' })}\n{"p":"torn`);
  writeFileSync(join(dir, 'a.2-2.jsonl'), `${start('a.test.mjs')}\n${JSON.stringify({ p: 'x.mjs', k: 'tree' })}\n${JSON.stringify({ p: 'x.mjs', k: 'dir' })}\n`);
  writeFileSync(join(dir, 'b.3-3.jsonl'), `${JSON.stringify({ p: 'y.mjs', k: 'file' })}\n`);
  writeFileSync(join(dir, 'c.4-4.jsonl'), `${start('c.test.mjs')}\nnot json\n${JSON.stringify({ p: 'z.mjs', k: 'sideways' })}\n${JSON.stringify({ opaque: 'why' })}\n`);
  writeFileSync(join(dir, 'notes.txt'), 'not a record\n');
  assert.deepEqual(readRecords(dir), {
    'a.test.mjs': { processes: 2, paths: { 'x.mjs': 'tree' }, opaque: [] },
    'c.test.mjs': { processes: 1, paths: {}, opaque: ['a line of its record could not be read', 'why'] },
  });
  assert.deepEqual(readRecords(join(dir, 'none')), {});
  assert.deepEqual(Object.keys(KIND_RANK), ['file', 'dir', 'tree']);
});

test('recorderEnv: the preload last in NODE_OPTIONS, other options kept, an earlier reach preload dropped, and an empty owner', () => {
  const env = recorderEnv({ dir: '/r/reach', root: '/r/repo', tmp: '/r/tmp', work: '/r', preload: 'file:///h/reach.mjs', nodeOptions: '--max-old-space-size=512 --import=file:///old/reach.mjs --import file:///old2/reach.mjs --import=file:///other.mjs' });
  assert.deepEqual(env, { NODE_OPTIONS: '--max-old-space-size=512 --import=file:///other.mjs --import=file:///h/reach.mjs', REACH_DIR: '/r/reach', REACH_ROOT: '/r/repo', REACH_TMP: '/r/tmp', REACH_WORK: '/r', REACH_OWNER: '' });
  assert.deepEqual(importsOf('--import=a --x --import b --import="c"'), ['a', 'b', 'c']);
  assert.equal(PRELOAD_URL, pathToFileURL(join(HERE, 'reach.mjs')).href);
  assert.ok(readFileSync(join(HERE, 'reach.mjs'), 'utf8').includes('module.registerHooks'));
});
