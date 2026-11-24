// Tests for the mutation harness itself (mutate.mjs). It is judged by this file alone (SUITE_FOR), so the desk's
// mutations never pay for it. Every test runs on a small fixture repo in a temp folder; a real child process, real
// git and a real copy are used where the behaviour lives there, and fakes are injected where a test needs a crash,
// a timeout or a git failure on demand. The fixture holds no real data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  MUTATIONS, SUITES, SUITE_FOR, READS, SELF_REL, MAX_BUFFER, DEFAULT_JOBS, DEFAULT_TIMEOUT_MS,
  parseCli, selectOnly, changedSince, selectSince, importGraph, closure, selfChanges, classify, baselineProblem,
  runAll, runPool, missingSlots, summarise, validateLines, insertLines, addLines, main, prepare, suiteOf,
  spawnNode, copyRepo, gitRun, relPath, configSpans, twinsOf, CONFIG,
} from './mutate.mjs';
// What plan 20 added is read through the namespace, so a test of a missing piece fails alone, not the whole file.
import * as harness from './mutate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MUTATE = join(HERE, 'mutate.mjs');
const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const write = (root, rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The fixture: two suite folders, a helper folder no suite owns, a script no test imports, a folder with no suite,
// data files beside them, and a small harness file with its own MUTATIONS list for --add to write into.
const HARNESS = [
  '// a fixture harness',
  'export const limit = 3;',
  'export const MUTATIONS = [',
  '  ["a refuses a negative", "pkg/scripts/a.mjs", "if (x < 0) return \'refused\';", "if (false) return \'refused\';"],',
  '];',
  '',
].join('\n');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mutate-fixture-'));
  roots.push(root);
  write(root, 'pkg/scripts/a.mjs', "import { b } from './b.mjs';\nexport function gate(x) {\n  if (x < 0) return 'refused';\n  return b(x);\n}\n");
  write(root, 'pkg/scripts/b.mjs', "import { c } from '../lib/c.mjs';\nexport const b = (x) => c(x);\n");
  write(root, 'pkg/lib/c.mjs', "import { d } from './d.mjs';\nexport const c = (x) => d(x);\n");
  write(root, 'pkg/lib/d.mjs', "export const d = (x) => (x > 0 ? 'ok' : 'zero');\n");
  write(root, 'pkg/scripts/cli.mjs', "if (process.argv[2] === '--bad') process.exitCode = 2;\n");
  write(root, 'pkg/scripts/unnamed.mjs', 'export const unnamed = 1;\n');
  write(root, 'pkg/scripts/a.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { gate } from './a.mjs';\ntest('a negative is refused', () => assert.equal(gate(-1), 'refused'));\ntest('a positive is ok', () => assert.equal(gate(2), 'ok'));\n");
  write(root, 'pkg/RUNBOOK.md', 'how to run it\n');
  write(root, 'other/scripts/z.mjs', 'export const z = (x) => (x ? 1 : 0);\n');
  write(root, 'other/scripts/z.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { z } from './z.mjs';\ntest('z', () => assert.equal(z(1), 1));\n");
  write(root, 'other/notes.md', 'notes\n');
  write(root, 'loose/x.mjs', 'export const x = 1;\n');
  write(root, 'harness/list.mjs', HARNESS);
  write(root, 'harness/list.test.mjs', "import { test } from 'node:test';\ntest('present', () => {});\n");
  return root;
}
const SUITES_FX = { 'pkg/scripts': ['a.test.mjs'], 'other/scripts': ['z.test.mjs'], harness: ['list.test.mjs'] };
const LIST_FX = [
  ['a refuses a negative', 'pkg/scripts/a.mjs', "if (x < 0) return 'refused';", "if (false) return 'refused';"],
  ['a cosmetic change', 'pkg/scripts/a.mjs', 'return b(x);', 'return b(x) ;'],
  ['cli bad flag', 'pkg/scripts/cli.mjs', 'process.exitCode = 2;', 'process.exitCode = 0;'],
  ['z one', 'other/scripts/z.mjs', '(x ? 1 : 0)', '(x ? 0 : 0)'],
];
const HARNESS_LIST = [LIST_FX[0]];
const FX = fixture();
const FXO = { root: FX, suites: SUITES_FX, suiteFor: {} };

// A fake child process: what a suite run returns, decided from the copy it runs in.
const tap = (pass, fail) => `TAP version 13\n# tests ${pass + fail}\n# pass ${pass}\n# fail ${fail}\n`;
const GREEN = { code: 0, signal: null, stdout: tap(2, 0) };
const RED = { code: 1, signal: null, stdout: tap(1, 1) };
const variant = (root, cwd) => {
  for (const [name, file, , to] of LIST_FX) {
    const was = readFileSync(join(root, file), 'utf8');
    const now = readFileSync(join(cwd, file), 'utf8');
    if (was !== now && now.includes(to)) return name;
  }
  return 'baseline';
};
const fakeSpawn = (decide) => async (args, o) => decide(o.cwd, args);
const killedAll = async (batch) => ({ results: batch.map((m) => ({ name: m[0], status: 'KILLED' })) });

// Real git on the fixture, without any GIT_* variable of the outer process and without global hooks or signing.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const fxGit = (args, o = {}) => gitRun(args, { ...o, env: GIT_ENV });
const gitIn = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
function gitFixture() {
  const root = fixture();
  gitIn(root, 'init', '-q');
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-qm', 'base');
  return root;
}

// ---- B1: --only --------------------------------------------------------------------------------------------

test('a term in --only that selects nothing is refused, so a typo is never "every guard bites"', () => {
  const r = spawnSync(process.execPath, [MUTATE, '--only', 'nosuchthing'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
  assert.doesNotMatch(r.stdout, /every guard bites/);
  assert.match(r.stdout, /"nosuchthing" selects no mutation/);
});

test('one term of --only that selects nothing refuses the whole run before anything runs', async () => {
  let ran = false;
  const out = [];
  const code = await main(['--only', 'pkg, nosuchthing'], { mutations: LIST_FX, run: async () => { ran = true; return { results: [] }; }, print: (l) => out.push(l) });
  assert.equal(code, 1);
  assert.equal(ran, false);
  assert.match(out.join('\n'), /"nosuchthing" selects no mutation/);
  assert.deepEqual(selectOnly(LIST_FX, ['pkg', 'nosuchthing']).unmatched, ['nosuchthing']);
});

test('--only takes a comma list, trimmed, empty terms dropped, chosen in list order; a list of nothing is refused', () => {
  assert.deepEqual(parseCli(['--only', ' pkg , ,other ']).only, ['pkg', 'other']);
  assert.deepEqual(parseCli(['--only', 'a', '--only', 'b']).only, ['a', 'b']);
  assert.match(parseCli(['--only', ' , ']).errors.join(), /names no term/);
  assert.match(parseCli(['--only']).errors.join(), /needs a value/);
  const sel = selectOnly(LIST_FX, ['z.mjs', 'cli']);
  assert.deepEqual(sel.chosen.map((m) => m[0]), ['cli bad flag', 'z one']);
  assert.deepEqual(sel.unmatched, []);
});

test('an unknown argument is refused, so a misspelt flag never runs every mutation', async () => {
  assert.match(parseCli(['--onyl', 'agency']).errors.join(), /unknown argument "--onyl"/);
  let ran = false;
  assert.equal(await main(['--onyl', 'agency'], { mutations: LIST_FX, run: async () => { ran = true; return { results: [] }; }, print: () => {} }), 1);
  assert.equal(ran, false);
});

test('a run of nothing is refused: 0 of 0 is never "every guard bites"', async () => {
  const s = summarise([], 0);
  assert.equal(s.code, 1);
  assert.doesNotMatch(s.lines.join('\n'), /every guard bites/);
  const out = [];
  assert.equal(await main([], { mutations: [], run: async () => ({ results: [] }), print: (l) => out.push(l) }), 1);
  assert.match(out.at(-1), /nothing ran, so nothing is proven/);
});

// ---- B2: what counts as a kill -----------------------------------------------------------------------------

test('only an exit of 1 with a failed test is a kill: a timeout, a signal, an overflow or a bare exit 1 never is', () => {
  assert.equal(classify({ code: 1, signal: null, stdout: tap(1, 2) }), 'KILLED');
  assert.equal(classify({ code: 0, signal: null, stdout: tap(3, 0) }), 'SURVIVED');
  assert.equal(classify({ code: null, signal: 'SIGKILL', timedOut: true, stdout: tap(1, 1) }), 'TIMEOUT');
  assert.equal(classify({ code: 1, signal: null, timedOut: true, stdout: tap(1, 1) }), 'TIMEOUT');
  assert.equal(classify({ code: 1, signal: 'SIGTERM', stdout: tap(1, 1) }), 'CRASHED');
  assert.equal(classify({ code: 1, signal: null, overflow: true, stdout: tap(1, 1) }), 'CRASHED');
  assert.equal(classify({ code: 1, signal: null, stdout: tap(3, 0) }), 'CRASHED');
  assert.equal(classify({ code: 1, signal: null, stdout: '' }), 'CRASHED');
  assert.equal(classify({ code: 2, signal: null, stdout: tap(1, 1) }), 'CRASHED');
  assert.equal(classify({ code: null, signal: null, stdout: tap(1, 1) }), 'CRASHED');
  assert.equal(classify({ code: 1, signal: null, stdout: '  # fail 1\n' }), 'CRASHED');
  assert.equal(classify({}), 'CRASHED');
});

test('a baseline is green only with exit 0, at least one pass and no failure', () => {
  assert.equal(baselineProblem({ code: 0, signal: null, stdout: tap(3, 0) }), null);
  const red = [
    { code: 0, signal: null, stdout: tap(0, 0) },
    { code: 0, signal: null, stdout: tap(3, 1) },
    { code: 1, signal: null, stdout: tap(3, 0) },
    { code: 0, signal: null, stdout: '' },
    { code: 0, signal: 'SIGTERM', stdout: tap(3, 0) },
    { code: 0, signal: null, timedOut: true, stdout: tap(3, 0) },
    { code: 0, signal: null, overflow: true, stdout: tap(3, 0) },
    { status: 'CRASHED', detail: 'the worker threw: disk full' },
    undefined,
  ];
  for (const r of red) assert.notEqual(baselineProblem(r), null, JSON.stringify(r));
  assert.match(baselineProblem(red[7]), /disk full/);
});

test('a suite that is not green before any mutation makes each of its mutations BASELINE_RED, never KILLED', async () => {
  const bases = [
    RED,
    { code: 0, signal: null, stdout: tap(0, 0) },
    { code: null, signal: 'SIGKILL', stdout: '' },
    { code: null, signal: 'SIGKILL', timedOut: true, stdout: '' },
  ];
  for (const base of bases) {
    let baselines = 0;
    const spawn = fakeSpawn((cwd, args) => {
      if (variant(FX, cwd) !== 'baseline') return RED;
      baselines++;
      return args.some((a) => a.endsWith('z.test.mjs')) ? GREEN : base;
    });
    const { results } = await runAll(LIST_FX, { ...FXO, jobs: 2, spawn });
    assert.deepEqual(results.map((r) => r.status), ['BASELINE_RED', 'BASELINE_RED', 'BASELINE_RED', 'KILLED'], JSON.stringify(base));
    assert.match(results[0].detail, /is not green before any mutation/);
    assert.equal(baselines, 2, 'one baseline per suite, not per mutation');
  }
});

test('a mutation whose run hangs, is signalled or overflows is reported as such and fails the run', async () => {
  const outcomes = { 'a refuses a negative': { code: null, signal: 'SIGKILL', timedOut: true, stdout: '' }, 'a cosmetic change': { code: null, signal: 'SIGSEGV', stdout: '' }, 'cli bad flag': { code: null, signal: 'SIGKILL', overflow: true, stdout: '' }, 'z one': RED };
  const spawn = fakeSpawn((cwd) => outcomes[variant(FX, cwd)] ?? GREEN);
  const { results } = await runAll(LIST_FX, { ...FXO, jobs: 3, spawn, timeoutMs: 50 });
  assert.deepEqual(results.map((r) => r.status), ['TIMEOUT', 'CRASHED', 'CRASHED', 'KILLED']);
  assert.match(results[0].detail, /50 ms deadline/);
  const s = summarise(results, 4);
  assert.equal(s.code, 1);
  assert.equal(s.lines.at(-1), 'killed 1 of 4 mutations, 3 not killed');
});

test('only KILLED counts: every other status fails the run', () => {
  for (const status of ['SURVIVED', 'TIMEOUT', 'CRASHED', 'BASELINE_RED', 'NO_MATCH', 'AMBIGUOUS', 'NO_SUITE']) {
    const s = summarise([{ name: 'a', status: 'KILLED' }, { name: 'b', status, detail: 'why' }], 2);
    assert.equal(s.code, 1, status);
    assert.equal(s.lines.at(-1), 'killed 1 of 2 mutations, 1 not killed');
    assert.ok(s.lines.includes(`${status}: b — why`), s.lines.join('\n'));
  }
  const ok = summarise([{ name: 'a', status: 'KILLED' }], 1, { verbose: true });
  assert.deepEqual(ok, { lines: ['KILLED: a', 'killed 1 of 1 mutations (every guard bites)'], code: 0 });
});

// node:test reports a test that hits its own timeout option as cancelled, not failed, so a mutation caught only that
// way would read CRASHED. These tests race their own deadline and fail an assertion instead.
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms, 'still running').unref())]);

test('a real child that outlives its deadline is stopped and is TIMEOUT, never a kill', async () => {
  const r = await within(spawnNode(['-e', 'setTimeout(() => {}, 4000)'], { cwd: tmpdir(), timeoutMs: 300 }), 2500);
  assert.notEqual(r, 'still running', 'the deadline did not stop the child');
  assert.equal(r.timedOut, true);
  assert.equal(classify(r), 'TIMEOUT');
  assert.equal(DEFAULT_TIMEOUT_MS, 120_000);
});

test('a deadline stops the whole process group, so a hung test file cannot hold the run open', async () => {
  const code = "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'inherit' }); setTimeout(() => {}, 4000);";
  const r = await within(spawnNode(['-e', code], { cwd: tmpdir(), timeoutMs: 300 }), 2000);
  assert.notEqual(r, 'still running', 'a grandchild held the run open past its deadline');
  assert.equal(classify(r), 'TIMEOUT');
});

test('output past the buffer is CRASHED, and 2 MB of TAP under the 64 MiB default is read whole', { timeout: 10000 }, async () => {
  assert.equal(MAX_BUFFER, 64 * 1024 * 1024);
  const big = "process.stdout.write('x'.repeat(2 * 1024 * 1024) + '\\n# fail 1\\n', () => process.exit(1));";
  const over = await spawnNode(['-e', big], { cwd: tmpdir(), maxBuffer: 1024 * 1024 });
  assert.equal(over.overflow, true);
  assert.equal(classify(over), 'CRASHED');
  const whole = await spawnNode(['-e', big], { cwd: tmpdir() });
  assert.equal(whole.overflow, false);
  assert.equal(classify(whole), 'KILLED');
});

test('a suite run speaks TAP even when this file itself runs under node --test', { timeout: 30000 }, async () => {
  const { results, baselines, missing } = await runAll(LIST_FX.slice(0, 2), { ...FXO, jobs: 2 });
  assert.deepEqual(baselines.map((b) => b.problem), [null]);
  assert.deepEqual(results.map((r) => r.status), ['KILLED', 'SURVIVED']);
  assert.deepEqual(missing, []);
});

test('a mutation that stops its file from parsing is UNPARSEABLE, never a kill: a module, a JSON file and a workflow body (review-3x, 21 Nov 2026)', { timeout: 60000 }, async () => {
  const root = fixture();
  write(root, 'pkg/scripts/conf.json', '{ "limit": 3 }\n');
  // A workflow script is a function body, not a module: `export const meta`, top-level await and a top-level return.
  write(root, 'pkg/scripts/wf.js', "export const meta = { name: 'w' }\nconst x = await Promise.resolve(1)\nreturn { x }\n");
  const list = [
    ['a module that no longer parses', 'pkg/scripts/a.mjs', "if (x < 0) return 'refused';", "if (x < 0 return 'refused';"],
    ['a JSON file that no longer parses', 'pkg/scripts/conf.json', '"limit": 3', '"limit": 3,'],
    ['a workflow body that no longer parses', 'pkg/scripts/wf.js', 'return { x }', 'return { x'],
    ['a workflow body that still parses', 'pkg/scripts/wf.js', 'return { x }', 'return { y: x }'],
    ['a module that still parses', 'pkg/scripts/a.mjs', "if (x < 0) return 'refused';", "if (false) return 'refused';"],
  ];
  const { results } = await runAll(list, { root, suites: SUITES_FX, suiteFor: {}, jobs: 2 });
  assert.deepEqual(results.map((r) => r.status), ['UNPARSEABLE', 'UNPARSEABLE', 'UNPARSEABLE', 'SURVIVED', 'KILLED']);
  assert.match(results[0].detail, /pkg\/scripts\/a\.mjs no longer parses/);
  const { lines, code } = summarise(results, list.length);
  assert.equal(code, 1, 'an unparseable line is not a guard that bites');
  assert.match(lines.at(-1), /killed 1 of 5 mutations, 4 not killed/);
  assert.equal(classify({ code: 1, stdout: '# fail 1', unparseable: 'it no longer parses' }), 'UNPARSEABLE');
});

// ---- D: a suite run's temp files stay in its throwaway folder (plan 20) ------------------------------------------

test("a suite run's temp files stay inside its throwaway folder, and what a baseline left is named before the last line", { timeout: 30000 }, async () => {
  const root = fixture();
  const marker = `mutate-leak-marker-${process.pid}-${process.hrtime.bigint()}`;
  write(root, 'pkg/scripts/a.test.mjs', [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { writeFileSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import { join } from 'node:path';",
    "import { gate } from './a.mjs';",
    `writeFileSync(join(tmpdir(), ${JSON.stringify(marker)}), 'left behind');`,
    "test('a negative is refused', () => assert.equal(gate(-1), 'refused'));",
    '',
  ].join('\n'));
  const out = [];
  try {
    const code = await main(['--verbose'], { mutations: [LIST_FX[0]], root, suites: SUITES_FX, suiteFor: {}, print: (l) => out.push(l), warn: () => {} });
    assert.equal(existsSync(join(tmpdir(), marker)), false, 'the test wrote into the real temp folder, outside its throwaway folder');
    assert.equal(code, 0, out.join('\n'));
    assert.deepEqual(out, ['KILLED: a refuses a negative', `LEFTOVER: pkg/scripts/a.test.mjs left 1 entry: ${marker}`, 'killed 1 of 1 mutations (every guard bites)']);
  } finally {
    rmSync(join(tmpdir(), marker), { force: true });
  }
});

test('a LEFTOVER line says how many entries a baseline left and names at most ten; a suite that leaves nothing prints none', async () => {
  const spawn = async (args, o) => {
    const v = variant(FX, o.cwd);
    if (v === 'baseline' && args.some((a) => a.endsWith('a.test.mjs'))) {
      for (let k = 12; k >= 1; k--) writeFileSync(join(o.env.TMPDIR, `e${String(k).padStart(2, '0')}`), '');
    }
    return v === 'baseline' ? GREEN : RED;
  };
  const out = [];
  const code = await main([], { mutations: LIST_FX, ...FXO, run: (list, o) => runAll(list, { ...o, spawn }), print: (l) => out.push(l), warn: () => {} });
  assert.equal(code, 0, out.join('\n'));
  assert.deepEqual(out, ['LEFTOVER: pkg/scripts/a.test.mjs left 12 entries: e01, e02, e03, e04, e05, e06, e07, e08, e09, e10, and 2 more', 'killed 4 of 4 mutations (every guard bites)']);
});

test("a LEFTOVER line writes mkdtemp's six random characters as XXXXXX, so two runs of a leaking suite print the same bytes", () => {
  const b = { suite: ['pkg/scripts/a.test.mjs'], leftover: ['rulebook-Zz09aB', 'rulebook-empty-0aZ9bY', 'e01', 'notes.md', 'has space-AbCdEf'] };
  const again = { ...b, leftover: ['rulebook-q1W2e3', 'rulebook-empty-ZZZZZZ', 'e01', 'notes.md', 'has space-000000'] };
  const want = ['LEFTOVER: pkg/scripts/a.test.mjs left 5 entries: e01, has space-XXXXXX, notes.md, rulebook-XXXXXX, rulebook-empty-XXXXXX'];
  assert.deepEqual(harness.leftoverLines([b]), want);
  assert.deepEqual(harness.leftoverLines([again]), want);
  assert.deepEqual(harness.leftoverLines([{ suite: ['x.test.mjs'], leftover: [] }, { suite: ['y.test.mjs'] }]), []);
});

// ---- A1: a mutation runs the test files that reach it first, its whole suite as the fallback (plan 20) -------

// A suite of three test files: core.test.mjs imports core.mjs (it is that file's own test), gate.test.mjs imports
// gate.mjs, which imports core.mjs, and spawn.test.mjs imports nothing here, as a test that only starts cli.mjs would.
const MSUITES = { 'm/scripts': ['gate.test.mjs', 'core.test.mjs', 'spawn.test.mjs'] };
const MALL = MSUITES['m/scripts'].map((f) => `m/scripts/${f}`);
const [MGATE, MCORE, MSPAWN] = MALL;
const MLIST = [
  ['core refuses', 'm/scripts/core.mjs', "x > 0 ? 'ok'", "x > -9 ? 'ok'"],
  ['gate passes', 'm/scripts/gate.mjs', '=> core(x)', '=> core(-x)'],
  ['cli bad flag', 'm/scripts/cli.mjs', '? 2 : 0', '? 0 : 0'],
  ['core spacing', 'm/scripts/core.mjs', "'refused')", "'refused' )"],
];
function multiFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mutate-multi-'));
  roots.push(root);
  write(root, 'm/scripts/core.mjs', "export const core = (x) => (x > 0 ? 'ok' : 'refused');\n");
  write(root, 'm/scripts/gate.mjs', "import { core } from './core.mjs';\nexport const gate = (x) => core(x);\n");
  write(root, 'm/scripts/cli.mjs', "process.exitCode = process.argv[2] === '--bad' ? 2 : 0;\n");
  write(root, MCORE, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { core } from './core.mjs';\ntest('core', () => assert.equal(core(-1), 'refused'));\n");
  write(root, MGATE, "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { gate } from './gate.mjs';\ntest('gate', () => assert.equal(gate(1), 'ok'));\n");
  write(root, MSPAWN, "import { test } from 'node:test';\ntest('spawn', () => {});\n");
  return root;
}
const MFX = multiFixture();
const MFXO = { root: MFX, suites: MSUITES, suiteFor: {} };

// A fake suite run on that fixture that records [mutation, test files] for every call it gets. `red(name, files)`
// says which runs go red (`name` is 'baseline' for an unmutated copy); every other run is green. `wait` delays a
// mutation's runs, so a pool of four finishes them out of order.
function spyRuns(list, red, wait = {}) {
  const calls = [];
  const spawn = async (args, o) => {
    const files = args.filter((a) => a.endsWith('.test.mjs')).map((a) => relative(o.cwd, a).split(sep).join('/'));
    let name = 'baseline';
    for (const [n, file, , to] of list) {
      const now = readFileSync(join(o.cwd, file), 'utf8');
      if (now !== readFileSync(join(MFX, file), 'utf8') && now.includes(to)) name = n;
    }
    calls.push([name, files]);
    await delay(wait[name] ?? 0);
    return red(name, files) ? RED : GREEN;
  };
  return { calls, spawn, of: (name) => calls.filter((c) => c[0] === name).map((c) => c[1]) };
}
const reachMisses = (warned) => warned.filter((l) => l.startsWith('REACH_MISS: '));

test('narrowFor: the test files whose imports reach the mutated file and are green alone, its own test first; none without a green set', () => {
  const graph = importGraph(MFX, ['m/scripts']);
  const p = prepare(MLIST[0], MFXO);
  assert.deepEqual(harness.narrowFor(p, graph, { green: new Set(MALL) }), [MCORE, MGATE]);
  assert.deepEqual(harness.narrowFor(p, graph, { green: new Set([MGATE, MSPAWN]) }), [MGATE]);
  assert.deepEqual(harness.narrowFor(p, graph), [], 'no file is green alone until its own baseline says so');
  assert.deepEqual(harness.narrowFor(prepare(MLIST[2], MFXO), graph, { green: new Set(MALL) }), [], 'no test imports cli.mjs');
});

test('a narrowed file that does not kill while another file of its suite does still reports KILLED, through the whole suite, as REACH_MISS', async () => {
  const s = spyRuns(MLIST, (name, files) => name === 'core refuses' && files.length === 3);
  const warned = [];
  const { results } = await runAll([MLIST[0]], { ...MFXO, jobs: 1, spawn: s.spawn, warn: (l) => warned.push(l) });
  assert.deepEqual(results.map((r) => r.status), ['KILLED']);
  assert.deepEqual(s.of('core refuses'), [[MCORE], [MGATE], MALL], 'its own test, then the other file that imports it, then the whole suite');
  assert.equal(reachMisses(warned).length, 1, warned.join('\n'));
  assert.match(reachMisses(warned)[0], /^REACH_MISS: core refuses — /);
});

test('nothing kills: SURVIVED, decided by the whole suite run after the narrowed files', async () => {
  const s = spyRuns(MLIST, () => false);
  const warned = [];
  const { results } = await runAll([MLIST[0]], { ...MFXO, jobs: 1, spawn: s.spawn, warn: (l) => warned.push(l) });
  assert.deepEqual(results, [{ name: 'core refuses', status: 'SURVIVED', detail: 'the suite stayed green with this guard removed' }]);
  assert.deepEqual(s.of('core refuses'), [[MCORE], [MGATE], MALL]);
  assert.deepEqual(warned, []);
});

test('a file no test imports has an empty narrowed set, so only its whole suite runs', async () => {
  const s = spyRuns(MLIST, (name, files) => name === 'cli bad flag' && files.length === 3);
  const warned = [];
  const { results } = await runAll([MLIST[2]], { ...MFXO, jobs: 1, spawn: s.spawn, warn: (l) => warned.push(l) });
  assert.deepEqual(results.map((r) => r.status), ['KILLED']);
  assert.deepEqual(s.of('cli bad flag'), [MALL]);
  assert.match(reachMisses(warned).join('\n'), /^REACH_MISS: cli bad flag — /);
});

test('a test file red alone while its suite is green is never used narrowed, and is named NOT_GREEN_ALONE', async () => {
  const alone = (files) => files.length === 1 && files[0] === MCORE;
  const s = spyRuns(MLIST, (name, files) => (name === 'baseline' || name === 'core refuses') && alone(files));
  const warned = [];
  const { results } = await runAll([MLIST[0]], { ...MFXO, jobs: 1, spawn: s.spawn, warn: (l) => warned.push(l) });
  assert.deepEqual(results.map((r) => r.status), ['SURVIVED'], 'core.test.mjs alone goes red with or without the guard, so its red proves nothing');
  assert.deepEqual(s.of('core refuses'), [[MGATE], MALL]);
  assert.deepEqual(warned.filter((l) => l.startsWith('NOT_GREEN_ALONE: ')).map((l) => l.split(' — ')[0]), [`NOT_GREEN_ALONE: ${MCORE}`]);
});

test("the mutated file's own test file runs first, and the run stops at the first KILLED", async () => {
  const s = spyRuns(MLIST, (name, files) => name !== 'baseline' && files.length === 1);
  const warned = [];
  const { results } = await runAll(MLIST.slice(0, 2), { ...MFXO, jobs: 1, spawn: s.spawn, warn: (l) => warned.push(l) });
  assert.deepEqual(results.map((r) => r.status), ['KILLED', 'KILLED']);
  assert.deepEqual(s.of('core refuses'), [[MCORE]], 'core.test.mjs is second in suite order but first for core.mjs');
  assert.deepEqual(s.of('gate passes'), [[MGATE]]);
  assert.deepEqual(warned, []);
});

test('--no-narrow makes exactly the calls of a run before narrowing: one baseline per suite, one whole-suite run per mutation', async () => {
  const red = (name) => name !== 'baseline';
  const plain = spyRuns(MLIST, red);
  const warned = [];
  await runAll(MLIST, { ...MFXO, jobs: 1, spawn: plain.spawn, narrow: false, warn: (l) => warned.push(l) });
  assert.deepEqual(plain.calls, [['baseline', MALL], ...MLIST.map((m) => [m[0], MALL])]);
  assert.deepEqual(warned, []);
  const narrowed = spyRuns(MLIST, red);
  await runAll(MLIST, { ...MFXO, jobs: 1, spawn: narrowed.spawn, warn: (l) => warned.push(l) });
  assert.deepEqual(narrowed.of('baseline'), [MALL, [MGATE], [MCORE], [MSPAWN]], 'narrowed, each file of a suite of two or more also gets a baseline alone');
  assert.equal(parseCli(['--no-narrow']).narrow, false);
  assert.equal(parseCli([]).narrow, true);
  for (const [argv, narrow] of [[['--no-narrow'], false], [[], true]]) {
    let seen;
    await main(argv, { mutations: LIST_FX, run: async (list, o) => { seen = o; return killedAll(list); }, print: () => {} });
    assert.equal(seen.narrow, narrow, argv.join(' '));
  }
});

test('narrowed and --no-narrow print the same verdicts, with --jobs 1 and --jobs 4, and narrowed runs fewer test files', async () => {
  const red = (name, files) => (name === 'core refuses' && files.includes(MCORE)) || (name === 'gate passes' && files.includes(MGATE)) || (name === 'cli bad flag' && files.length === 3);
  const wait = { 'core refuses': 40, 'gate passes': 25, 'cli bad flag': 10, 'core spacing': 0 };
  const seen = [];
  for (const narrow of [true, false]) {
    for (const jobs of [1, 4]) {
      const s = spyRuns(MLIST, red, wait);
      const { results } = await runAll(MLIST, { ...MFXO, jobs, narrow, spawn: s.spawn, warn: () => {} });
      const mutated = s.calls.filter((c) => c[0] !== 'baseline').reduce((n, c) => n + c[1].length, 0);
      seen.push({ narrow, jobs, mutated, lines: summarise(results, MLIST.length, { verbose: true }).lines.join('\n') });
    }
  }
  for (const s of seen) assert.equal(s.lines, seen[0].lines, `narrow ${s.narrow}, --jobs ${s.jobs}`);
  assert.equal(seen[0].lines, ['KILLED: core refuses', 'KILLED: gate passes', 'KILLED: cli bad flag', 'SURVIVED: core spacing — the suite stayed green with this guard removed', 'killed 3 of 4 mutations, 1 not killed'].join('\n'));
  assert.deepEqual(seen.map((s) => s.mutated), [10, 10, 12, 12], 'narrowed: 1 + 1 + 3 + (2 narrowed + 3 whole); --no-narrow: 4 x 3');
});

test('a mutation that stops its file parsing is UNPARSEABLE before any narrowed file runs', { timeout: 30000 }, async () => {
  const list = [['core broken', 'm/scripts/core.mjs', "x > 0 ? 'ok'", "x > 0 ? 'ok"], MLIST[0]];
  const s = spyRuns(list, (name) => name !== 'baseline');
  const { results } = await runAll(list, { ...MFXO, jobs: 1, spawn: s.spawn, warn: () => {} });
  assert.deepEqual(results.map((r) => r.status), ['UNPARSEABLE', 'KILLED']);
  assert.deepEqual(s.of('core broken'), [], 'a file that no longer parses is never run, narrowed or whole');
  assert.deepEqual(s.of('core refuses'), [[MCORE]]);
});

// ---- --jobs and the pool -----------------------------------------------------------------------------------

test('--jobs is a whole number from 1 to 16, and defaults to four or the CPUs if fewer', () => {
  for (const bad of ['0', '17', '2.5', 'four', '-1', '']) assert.ok(parseCli(['--jobs', bad]).errors.length, JSON.stringify(bad));
  assert.match(parseCli(['--jobs']).errors.join(), /needs a value/);
  assert.equal(parseCli(['--jobs', '1']).jobs, 1);
  assert.equal(parseCli(['--jobs', '16']).jobs, 16);
  assert.equal(parseCli([]).jobs, Math.min(4, availableParallelism()));
  assert.equal(DEFAULT_JOBS, Math.min(4, availableParallelism()));
});

test('--timeout-ms is a positive whole number, and it and --jobs reach the run', async () => {
  assert.equal(parseCli([]).timeoutMs, 120_000);
  assert.equal(parseCli(['--timeout-ms', '500']).timeoutMs, 500);
  for (const bad of ['0', '1.5', 'soon']) assert.ok(parseCli(['--timeout-ms', bad]).errors.length, bad);
  let seen;
  const code = await main(['--timeout-ms', '500', '--jobs', '2'], { mutations: LIST_FX, run: async (list, o) => { seen = o; return killedAll(list); }, print: () => {} });
  assert.equal(code, 0);
  assert.equal(seen.timeoutMs, 500);
  assert.equal(seen.jobs, 2);
});

test('results keep list order whatever finishes first, so --jobs 1 and --jobs 4 print the same bytes', async () => {
  const slowFirst = (i) => delay((6 - i) * 15).then(() => ({ name: `m${i}`, status: 'KILLED' }));
  assert.deepEqual((await runPool([0, 1, 2, 3, 4, 5], 4, slowFirst)).map((r) => r.name), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  const wait = { 'a refuses a negative': 80, 'a cosmetic change': 50, 'cli bad flag': 20, 'z one': 0 };
  const spawn = fakeSpawn(async (cwd) => {
    const v = variant(FX, cwd);
    if (v === 'baseline') return GREEN;
    await delay(wait[v]);
    return v === 'a cosmetic change' ? GREEN : RED;
  });
  const print = async (jobs) => summarise((await runAll(LIST_FX, { ...FXO, jobs, spawn })).results, LIST_FX.length, { verbose: true }).lines.join('\n');
  const one = await print(1);
  assert.equal(await print(4), one);
  assert.equal(one, ['KILLED: a refuses a negative', 'SURVIVED: a cosmetic change — the suite stayed green with this guard removed', 'KILLED: cli bad flag', 'KILLED: z one', 'killed 3 of 4 mutations, 1 not killed'].join('\n'));
});

test('the pool runs --jobs workers at once, never more and never fewer', async () => {
  let active = 0;
  let peak = 0;
  const w = async () => { active++; peak = Math.max(peak, active); await delay(20); active--; return { status: 'KILLED' }; };
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, w);
  assert.equal(peak, 3);
  peak = 0;
  await runPool([1, 2], 8, w);
  assert.equal(peak, 2);
});

test('a worker that throws is CRASHED in its own slot and the others keep their places', async () => {
  const r = await runPool(['a', 'b', 'c'], 2, async (x) => { if (x === 'b') throw new Error('disk full'); return { name: x, status: 'KILLED' }; });
  assert.deepEqual(r.map((x) => x.status), ['KILLED', 'CRASHED', 'KILLED']);
  assert.match(r[1].detail, /disk full/);
  let n = 0;
  const copy = (src, work) => { if (n++ === 3) throw new Error('disk full'); copyRepo(src, work); };
  const spawn = fakeSpawn((cwd) => (variant(FX, cwd) === 'baseline' ? GREEN : RED));
  const { results, missing } = await runAll(LIST_FX, { ...FXO, jobs: 1, spawn, copy });
  assert.deepEqual(results.map((x) => x.status), ['KILLED', 'CRASHED', 'KILLED', 'KILLED']);
  assert.equal(results[1].name, 'a cosmetic change');
  assert.match(results[1].detail, /disk full/);
  assert.deepEqual(missing, []);
});

test('a result that never came back fails the run, never a shorter one', async () => {
  const holey = new Array(3);
  holey[0] = { name: 'a', status: 'KILLED' };
  holey[2] = { name: 'c', status: 'KILLED' };
  assert.deepEqual(missingSlots(holey, 3), [1]);
  const s = summarise(holey, 3);
  assert.equal(s.code, 1);
  assert.match(s.lines.join('\n'), /MISSING: result 2 of 3 never came back/);
  assert.equal(s.lines.at(-1), 'killed 2 of 3 mutations, 1 not killed');
  const lossy = async (items, jobs, worker, crashed) => { const out = await runPool(items, jobs, worker, crashed); if (items.length > 2) delete out[1]; return out; };
  const spawn = fakeSpawn((cwd) => (variant(FX, cwd) === 'baseline' ? GREEN : RED));
  const { missing } = await runAll(LIST_FX, { ...FXO, jobs: 2, spawn, pool: lossy });
  assert.deepEqual(missing, [1]);
});

// ---- --since -----------------------------------------------------------------------------------------------

const sel = (files, extra = {}) => selectSince(LIST_FX, files, { ...FXO, reads: {}, ...extra }).selected.map((m) => m[0]);
const PKG = ['a refuses a negative', 'a cosmetic change', 'cli bad flag'];

test('a revision that does not verify is refused, and git is never handed an option', () => {
  const root = gitFixture();
  assert.match(changedSince('nosuchrev', { root, git: fxGit }).error, /does not verify/);
  const calls = [];
  const spy = (args) => { calls.push(args); return { code: 0, stdout: '' }; };
  assert.match(changedSince('--output=/tmp/x', { root, git: spy }).error, /needs a revision/);
  assert.match(changedSince('-x', { root, git: spy }).error, /needs a revision/);
  assert.match(changedSince('', { root, git: spy }).error, /needs a revision/);
  assert.equal(calls.length, 0);
  const revParse = (r) => (args) => (args[0] === 'rev-parse' ? r : { code: 0, stdout: '' });
  assert.match(changedSince('HEAD', { root, git: revParse({ code: 0, stdout: 'garbage\n' }) }).error, /does not verify/);
  assert.match(changedSince('HEAD', { root, git: revParse({ code: 1, stdout: '' }) }).error, /does not verify/);
});

test('a git failure is never "nothing changed": it refuses the run', async () => {
  const sha = 'a'.repeat(40);
  const failing = (step) => (args) => {
    if (args[0] === step) return { code: 128, stdout: '', stderr: 'fatal' };
    return args[0] === 'rev-parse' ? { code: 0, stdout: `${sha}\n` } : { code: 0, stdout: '' };
  };
  assert.match(changedSince('HEAD', { root: FX, git: failing('diff') }).error, /git diff against HEAD failed/);
  assert.match(changedSince('HEAD', { root: FX, git: failing('ls-files') }).error, /git ls-files failed/);
  assert.deepEqual(changedSince('HEAD', { root: FX, git: failing('none') }), { sha, files: [] });
  const trees = (args) => (args[0] === 'rev-parse' ? { code: 0, stdout: `${sha}\n` } : { code: 0, stdout: args[0] === 'ls-files' ? '.claude/worktrees/wf_1/\0new.md\0' : '' });
  assert.deepEqual(changedSince('HEAD', { root: FX, git: trees }).files, ['new.md'], 'another worktree is never a change here');
  let ran = false;
  const run = async () => { ran = true; return { results: [] }; };
  const out = [];
  assert.equal(await main(['--since', 'HEAD'], { mutations: LIST_FX, ...FXO, git: failing('diff'), run, print: (l) => out.push(l) }), 1);
  assert.doesNotMatch(out.join('\n'), /nothing to judge/);
  const selfFails = (args) => {
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${sha}\n` };
    if (args[0] === 'diff' && args.includes('-U0')) return { code: 128, stdout: '' };
    return { code: 0, stdout: args[0] === 'diff' ? `${SELF_REL}\0` : '' };
  };
  assert.equal(await main(['--since', 'HEAD'], { mutations: LIST_FX, ...FXO, git: selfFails, run, print: (l) => out.push(l) }), 1);
  assert.equal(ran, false);
});

test('what changed since a commit includes edits, deletions and untracked files, names with spaces whole', () => {
  const root = gitFixture();
  const head = fxGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
  write(root, 'pkg/lib/d.mjs', "export const d = () => 'ok';\n");
  rmSync(join(root, 'other/notes.md'));
  write(root, 'pkg/scripts/new.mjs', 'export const n = 1;\n');
  write(root, 'with space/odd name.md', 'x\n');
  const r = changedSince('HEAD', { root, git: fxGit });
  assert.equal(r.sha, head);
  assert.deepEqual(r.files, ['other/notes.md', 'pkg/lib/d.mjs', 'pkg/scripts/new.mjs', 'with space/odd name.md']);
});

test('a change three imports deep, through a folder no suite owns, selects the guards whose suite reaches it', () => {
  assert.deepEqual(sel(['pkg/lib/d.mjs']), PKG);
  assert.deepEqual(sel(['pkg/lib/c.mjs']), PKG);
  assert.deepEqual(sel(['loose/x.mjs']), []);
  const g = importGraph(FX, ['pkg/scripts']);
  assert.ok(closure(g, 'pkg/scripts/a.mjs').has('pkg/lib/d.mjs'));
  assert.ok(!closure(g, 'pkg/scripts/cli.mjs').has('pkg/lib/d.mjs'));
});

test('a script no test imports is still selected when it changes itself', () => {
  assert.deepEqual(sel(['pkg/scripts/cli.mjs']), ['cli bad flag']);
});

test('a changed test file selects every guard its suite judges, and nothing else', () => {
  assert.deepEqual(sel(['pkg/scripts/a.test.mjs']), PKG);
  assert.deepEqual(sel(['other/scripts/z.test.mjs']), ['z one']);
});

test("a data file under the same top-level folder, or one READS lists, selects that folder's guards", () => {
  assert.deepEqual(sel(['pkg/RUNBOOK.md']), PKG);
  assert.deepEqual(sel(['other/notes.md']), ['z one']);
  assert.deepEqual(sel(['docs/elsewhere.md']), []);
  assert.deepEqual(sel(['data/table.json'], { reads: { 'other/scripts': ['data/table.json'] } }), ['z one']);
  assert.deepEqual(sel(['data/table.jsonl'], { reads: { 'other/scripts': ['data/table.json'] } }), []);
  assert.deepEqual(READS, { '.claude/skills/joy-revise/scripts': ['galxe-desk/docs/decision-2026-10-31.json'], 'galxe-desk/scripts': ['.claude/agents/'] });
});

test('a READS entry ending in "/" covers every file under that folder, so a changed agent file reruns the firewall guards', () => {
  const reads = { 'other/scripts': ['cfg/agents/'] };
  assert.deepEqual(sel(['cfg/agents/reader.md'], { reads }), ['z one']);
  assert.deepEqual(sel(['cfg/agents-old/reader.md'], { reads }), []);
  const real = selectSince(MUTATIONS, ['.claude/agents/galxe-reader.md'], { reads: READS }).selected;
  assert.ok(real.some((m) => m[1] === 'agents.mjs'), 'the agents.mjs firewall guards are selected');
});

test('a changed script in a suite folder that no mutation names is reported UNGUARDED', () => {
  const r = selectSince(LIST_FX, ['pkg/scripts/unnamed.mjs', 'pkg/scripts/a.test.mjs', 'loose/x.mjs', 'pkg/scripts/a.mjs', 'pkg/scripts/gone.mjs'], { ...FXO, reads: {} });
  assert.deepEqual(r.unguarded, ['pkg/scripts/unnamed.mjs']);
});

// mutate.mjs itself, as a fixture: lines 2 to 8 are the list, line 9 is code, lines 10 to 19 are its config blocks
// (SUITES 10-13, SUITE_FOR 14, READS 15-17, relPath 18, SKIP 19) and line 20 is code again.
const SELF_FX = 'pkg/scripts/self.mjs';
const SELF_CONFIG = [
  'export const SUITES = {',
  "  'pkg/scripts': ['a.test.mjs'],",
  "  'other/scripts': ['z.test.mjs'],",
  '};',
  "export const SUITE_FOR = { 'pkg/scripts/cli.mjs': ['pkg/scripts/a.test.mjs'] };",
  'export const READS = {',
  "  'other/scripts': ['data/table.json'],",
  '};',
  "export const relPath = (file) => (file.includes('/') ? file : `pkg/scripts/${file}`);",
  "const SKIP = ['.git', 'node_modules'];",
];
const SELF_SRC = [
  '// the harness',
  'export const MUTATIONS = [',
  '  ["a refuses a negative", "pkg/scripts/a.mjs", "x", "y"],',
  '  ["\\"quoted\\" name", "pkg/scripts/a.mjs", "x", "y"],',
  '  ...[',
  "    ['it\\'s grouped', 'p', 'q'],",
  "  ].map(([name, from, to]) => [name, 'pkg/scripts/cli.mjs', from, to]),",
  '];',
  'export function run() {}',
  ...SELF_CONFIG,
  'export function after() {}',
  '',
].join('\n');
const LIST_SELF = [...LIST_FX, ['"quoted" name', 'pkg/scripts/a.mjs', 'x', 'y'], ["it's grouped", 'pkg/scripts/cli.mjs', 'p', 'q'], ['own guard', SELF_FX, 'run()', 'skip()']];
const hunk = (head, ...body) => `diff --git a/s b/s\n--- a/s\n+++ b/s\n${head}\n${body.join('\n')}\n`;
const sinceSelf = (diff, src = SELF_SRC) => selectSince(LIST_SELF, [SELF_FX], { ...FXO, reads: {}, self: SELF_FX, selfDiff: diff, selfSrc: src });
const selSelf = (diff, src) => sinceSelf(diff, src).selected.map((m) => m[0]);
const ALL_SELF = LIST_SELF.map((m) => m[0]);

test('a changed mutate.mjs selects only the lines it added, however their names are quoted', () => {
  assert.deepEqual(selSelf(hunk('@@ -3,0 +4 @@', '+  ["\\"quoted\\" name", "pkg/scripts/a.mjs", "x", "y"],')), ['"quoted" name']);
  assert.deepEqual(selSelf(hunk('@@ -5,0 +6 @@', "+    ['it\\'s grouped', 'p', 'q'],")), ["it's grouped"]);
  assert.deepEqual(selSelf(hunk('@@ -2,0 +3 @@', '+  ["a refuses a negative", "pkg/scripts/a.mjs", "x", "y"],')), ['a refuses a negative']);
  assert.deepEqual(selSelf(hunk('@@ -4 +3,0 @@', '-  ["gone", "pkg/scripts/a.mjs", "x", "y"],')), []);
  assert.deepEqual(selSelf(hunk('@@ -3,0 +4 @@', '+  // a note')), []);
});

test('a hunk of mutate.mjs outside MUTATIONS selects its own guards, and one inside does not', () => {
  assert.deepEqual(selSelf(hunk('@@ -9 +9 @@', '-export function run() {}', '+export function run() { return 1; }')), ['own guard']);
  assert.deepEqual(selSelf(hunk('@@ -1 +1 @@', '-// old', '+// the harness')), ['own guard']);
  assert.equal(selfChanges(hunk('@@ -2 +2 @@', '-export const LIST = [', '+export const MUTATIONS = ['), SELF_SRC).outside, true);
  assert.equal(selfChanges(hunk('@@ -3,0 +4 @@', '+  ["x", "y", "z", "w"],'), SELF_SRC).outside, false);
});

test('a line of mutate.mjs that names no mutation selects by its path, else every mutation', () => {
  assert.deepEqual(selSelf(hunk('@@ -7 +7 @@', '-  ].map(old),', "+  ].map(([name, from, to]) => [name, 'pkg/scripts/cli.mjs', from, to]),")), ['cli bad flag', "it's grouped"]);
  assert.deepEqual(selSelf(hunk('@@ -3,0 +4 @@', '+  something no one can read,')), LIST_SELF.map((m) => m[0]));
});

test('mutate.mjs changed with no hunk to say how selects every mutation', () => {
  assert.deepEqual(selSelf(''), LIST_SELF.map((m) => m[0]));
});

test('a hunk of mutate.mjs in SUITES, SUITE_FOR, READS, relPath or SKIP selects every mutation, so an edited suite never passes unseen', () => {
  const cases = [
    ['SUITES', hunk('@@ -12 +12 @@', "-  'other/scripts': ['z.test.mjs', 'y.test.mjs'],", "+  'other/scripts': ['z.test.mjs'],")],
    ['SUITES', hunk('@@ -11 +10,0 @@', "-  'agency/scripts': ['ab-test.test.mjs'],")], // its first entry deleted, right after the marker
    ['SUITES', hunk('@@ -13,2 +12,0 @@', "-  'gone/scripts': ['g.test.mjs'],", "-  'more/scripts': ['m.test.mjs'],")], // two entries cut at its end
    ['SUITES', hunk('@@ -8,3 +8,3 @@', '-];', '-export function run() { }', '-export const SUITES = {', '+];', '+export function run() {}', '+export const SUITES = {')],
    ['SUITE_FOR', hunk('@@ -14 +14 @@', '-export const SUITE_FOR = {};', `+${SELF_CONFIG[4]}`)],
    ['READS', hunk('@@ -16 +16 @@', "-  'other/scripts': [],", `+${SELF_CONFIG[6]}`)],
    ['relPath', hunk('@@ -18 +18 @@', '-export const relPath = (file) => file;', `+${SELF_CONFIG[8]}`)],
    ['SKIP', hunk('@@ -19 +19 @@', "-const SKIP = ['.git'];", `+${SELF_CONFIG[9]}`)],
  ];
  for (const [block, diff] of cases) {
    const r = sinceSelf(diff);
    assert.deepEqual(r.selected.map((m) => m[0]), ALL_SELF, diff);
    assert.equal(r.everything, `${SELF_FX} changed ${block}, so every mutation is selected`, diff);
  }
  assert.equal(sinceSelf(hunk('@@ -11,2 +11,2 @@', '-a', '-b', "+  'pkg/scripts': ['a.test.mjs'],", '+x')).everything, `${SELF_FX} changed SUITES, so every mutation is selected`);
  assert.equal(sinceSelf(hunk('@@ -12,4 +12,4 @@', '-a', '-b', '-c', '-d', '+a', '+b', '+c', '+d')).everything, `${SELF_FX} changed SUITES and SUITE_FOR and READS, so every mutation is selected`);
  for (const diff of [hunk('@@ -9 +9 @@', '-export function run() { }', '+export function run() {}'), hunk('@@ -20 +20 @@', '-export function after() { }', '+export function after() {}')]) {
    assert.deepEqual(selSelf(diff), ['own guard'], 'code outside the config still selects only its own guards');
    assert.equal(sinceSelf(diff).everything, null);
  }
  assert.equal(selectSince(LIST_FX, ['pkg/scripts/a.mjs'], { ...FXO, reads: {} }).everything, null);
  assert.deepEqual(configSpans(SELF_SRC), [
    { name: 'SUITES', start: 10, end: 13 }, { name: 'SUITE_FOR', start: 14, end: 14 }, { name: 'READS', start: 15, end: 17 },
    { name: 'relPath', start: 18, end: 18 }, { name: 'SKIP', start: 19, end: 19 },
  ]);
  assert.deepEqual(CONFIG.map((b) => b[0]), ['SUITES', 'SUITE_FOR', 'READS', 'relPath', 'SKIP']);
});

test('a mutate.mjs whose config blocks cannot each be found once, or one that never closes, selects every mutation', () => {
  const without = (name) => SELF_SRC.split('\n').filter((l, i) => !(i >= 9 && i <= 12 && name === 'SUITES') && !(name === 'SKIP' && l.startsWith('const SKIP = '))).join('\n');
  const code = hunk('@@ -9 +9 @@', '-export function run() { }', '+export function run() {}');
  const sources = {
    'no SUITES': without('SUITES'),
    'no SKIP': without('SKIP'),
    'SUITES twice': SELF_SRC.split('export function after() {}').join("export const SUITES = { 'x/scripts': [] };"),
    'SKIP never closes': SELF_SRC.split(SELF_CONFIG[9]).join("const SKIP = [\n  '.git',").split('export function after() {}\n').join(''),
    'no file at all': '',
  };
  for (const [what, src] of Object.entries(sources)) {
    const r = sinceSelf(code, src);
    assert.deepEqual(r.selected.map((m) => m[0]), ALL_SELF, what);
    assert.match(r.everything, /changed, and its SUITES, SUITE_FOR, READS, relPath, SKIP cannot each be found once, so every mutation is selected$/, what);
    assert.equal(configSpans(src), null, what);
  }
  const unclosed = sources['SKIP never closes'];
  assert.ok(unclosed.trimEnd().endsWith("'.git',"), 'the fixture really ends inside SKIP');
  // A comment that ends in ";" inside a block does not close it: only "};" or "];" (or the marker's own line) does.
  const commented = SELF_SRC.split("  'other/scripts': ['z.test.mjs'],\n").join("  // the folders, each with its tests;\n  'other/scripts': ['z.test.mjs'],\n");
  assert.deepEqual(selSelf(hunk('@@ -13 +13 @@', "-  'other/scripts': [],", "+  'other/scripts': ['z.test.mjs'],"), commented), ALL_SELF);
  assert.deepEqual(configSpans(commented)[0], { name: 'SUITES', start: 10, end: 14 });
});

test("the verifier's case: one changed line in the real file's SUITES selects all of MUTATIONS, not only mutate.mjs's own", () => {
  const real = readFileSync(MUTATE, 'utf8');
  const lines = real.split('\n');
  const lineOf = (prefix) => {
    const at = lines.findIndex((l) => l.startsWith(prefix));
    assert.ok(at >= 0 && lines.findIndex((l, i) => i > at && l.startsWith(prefix)) < 0, prefix);
    return at + 1;
  };
  const cases = [
    ['SUITES', "  'agency/scripts': ["], ['SUITES', "  '.claude/skills/joy-revise/scripts': ['worth-it"], ['SUITE_FOR', "  'galxe-desk/scripts/mutate.mjs': ["],
    ['READS', "  'galxe-desk/scripts': ['.claude/agents/'],"], ['relPath', 'export const relPath = '], ['SKIP', 'const SKIP = '],
  ];
  const own = MUTATIONS.filter((m) => relPath(m[1]) === SELF_REL).length;
  for (const [block, prefix] of cases) {
    const n = lineOf(prefix);
    const r = selectSince(MUTATIONS, [SELF_REL], { selfDiff: hunk(`@@ -${n} +${n} @@`, `-${lines[n - 1]} // was`, `+${lines[n - 1]}`), selfSrc: real });
    assert.equal(r.selected.length, MUTATIONS.length, `${block} via ${prefix}: ${r.selected.length} of ${MUTATIONS.length}, mutate.mjs's own ${own}`);
    assert.equal(r.everything, `${SELF_REL} changed ${block}, so every mutation is selected`);
  }
  const code = lineOf('export function classify(');
  assert.equal(selectSince(MUTATIONS, [SELF_REL], { selfDiff: hunk(`@@ -${code} +${code} @@`, '-x', `+${lines[code - 1]}`), selfSrc: real }).selected.length, own);
  assert.deepEqual(configSpans(real).map((s) => s.name), ['SUITES', 'SUITE_FOR', 'READS', 'relPath', 'SKIP']);
});

test('main prints one NOTE saying why every mutation is selected, and runs them all', async () => {
  const sha = 'b'.repeat(40);
  const git = (args) => {
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${sha}\n` };
    if (args[0] === 'diff' && args.includes('-U0')) return { code: 0, stdout: hunk('@@ -3 +3 @@', '-x', '+y') };
    return { code: 0, stdout: args[0] === 'diff' ? `${SELF_REL}\0` : '' };
  };
  let ran = null;
  const out = [];
  // FX holds no galxe-desk/scripts/mutate.mjs, so its config blocks cannot be found: every mutation is selected.
  const code = await main(['--since', 'HEAD'], { mutations: LIST_FX, ...FXO, reads: {}, git, run: async (list) => { ran = list.map((m) => m[0]); return killedAll(list); }, print: (l) => out.push(l) });
  assert.equal(code, 0);
  assert.deepEqual(ran, LIST_FX.map((m) => m[0]));
  assert.equal(out.filter((l) => l.startsWith('NOTE: ')).length, 1);
  assert.match(out[0], /^NOTE: galxe-desk\/scripts\/mutate\.mjs changed, and its SUITES, .* cannot each be found once, so every mutation is selected$/);
  assert.equal(out.at(-1), 'killed 4 of 4 selected since HEAD, 0 not run (every selected guard bites)');
});

test('nothing selected since a commit is the one honest 0 of 0, and a selection runs only what it picked', async () => {
  const root = gitFixture();
  let ran = null;
  const run = async (list) => { ran = list.map((m) => m[0]); return killedAll(list); };
  let out = [];
  const opts = { mutations: LIST_FX, root, suites: SUITES_FX, suiteFor: {}, reads: {}, git: fxGit, run, print: (l) => out.push(l) };
  assert.equal(await main(['--since', 'HEAD'], opts), 0);
  assert.deepEqual(out, ['killed 0 of 0 selected since HEAD: nothing to judge']);
  assert.equal(ran, null);
  write(root, 'other/notes.md', 'changed\n');
  write(root, 'pkg/scripts/unnamed.mjs', 'export const unnamed = 2;\n');
  out = [];
  assert.equal(await main(['--since', 'HEAD'], opts), 0);
  assert.deepEqual(ran, ['z one']);
  assert.deepEqual(out, ['UNGUARDED: pkg/scripts/unnamed.mjs changed and no mutation names it', 'killed 1 of 1 selected since HEAD, 3 not run (every selected guard bites)']);
});

// ---- --add -------------------------------------------------------------------------------------------------

const GOOD = ['a positive passes through', 'pkg/scripts/a.mjs', 'return b(x);', "return 'ok';"];
const GOOD2 = ['a second guard', 'pkg/scripts/a.mjs', 'if (x < 0)', 'if (x < -1)'];
const VOPTS = { mutations: HARNESS_LIST, root: FX, group: 'fixture batch', suites: SUITES_FX, suiteFor: {} };

test('--add refuses the whole batch, saying why per line, before anything runs', () => {
  assert.deepEqual(validateLines([GOOD, GOOD2], VOPTS), []);
  const cases = [
    [['same', 'pkg/scripts/a.mjs', 'return b(x);', 'return b(x);'], /from and to are the same/],
    [['a refuses a negative', 'pkg/scripts/a.mjs', 'return b(x);', 'return 0;'], /the name is taken/],
    [['abs', '/pkg/scripts/a.mjs', 'return b(x);', 'return 0;'], /absolute/],
    [['dots', 'pkg/scripts/../scripts/a.mjs', 'return b(x);', 'return 0;'], /contains "\.\."/],
    [['gone', 'pkg/scripts/nope.mjs', 'x', 'y'], /does not exist/],
    [['no suite', 'loose/x.mjs', 'export const x = 1;', 'export const x = 2;'], /no suite to judge it/],
    [['absent', 'pkg/scripts/a.mjs', 'not in the file', 'y'], /is not found/],
    [['twice', 'pkg/scripts/a.mjs', 'x', 'y'], /occurs more than once/],
    [['empty from', 'pkg/scripts/a.mjs', '', 'y'], /from is empty/],
    [['short', 'pkg/scripts/a.mjs', 'x'], /four strings/],
    [['number', 'pkg/scripts/a.mjs', 1, 'y'], /four strings/],
  ];
  for (const [line, re] of cases) {
    const problems = validateLines([GOOD, line], VOPTS);
    assert.equal(problems.length, 1, `${JSON.stringify(line)}: ${problems.join(' | ')}`);
    assert.match(problems[0], re);
    assert.match(problems[0], /^line 2/);
  }
  assert.match(validateLines([GOOD, GOOD], VOPTS).join(), /line 2 .*the name is taken/);
  for (const group of ['two\nlines', 'a\rb', 'a\u2028b', '', '   ', undefined]) assert.ok(validateLines([GOOD], { ...VOPTS, group }).length, JSON.stringify(group));
  for (const batch of [[], {}, 'x', null]) assert.ok(validateLines(batch, VOPTS).length, JSON.stringify(batch));
});

test('a line that is an existing guard under a new name is refused, so N of N never counts one guard twice', () => {
  const twin = /is the same guard as "a refuses a negative": it leaves pkg\/scripts\/a\.mjs byte-identical/;
  const copy = ['a copy', 'pkg/scripts/a.mjs', "if (x < 0) return 'refused';", "if (false) return 'refused';"];
  const wider = ['the same cut, spelt shorter', 'pkg/scripts/a.mjs', 'if (x < 0) return', 'if (false) return'];
  for (const line of [copy, wider]) {
    const problems = validateLines([GOOD, line], VOPTS);
    assert.equal(problems.length, 1, problems.join(' | '));
    assert.match(problems[0], /^line 2 /);
    assert.match(problems[0], twin);
  }
  const again = ['a positive passes again', 'pkg/scripts/a.mjs', '  return b(x);', "  return 'ok';"];
  const inBatch = validateLines([GOOD, GOOD2, again], VOPTS);
  assert.equal(inBatch.length, 1, inBatch.join(' | '));
  assert.match(inBatch[0], /^line 3 .*is the same guard as "a positive passes through"/);
  // A bare name and the full path are the same file.
  const root = fixture();
  write(root, 'galxe-desk/scripts/r.mjs', 'export const r = (x) => (x > 1 ? 1 : 0);\n');
  write(root, 'galxe-desk/scripts/r.test.mjs', "import { test } from 'node:test';\ntest('r', () => {});\n");
  const ropts = { ...VOPTS, root, suites: { ...SUITES_FX, 'galxe-desk/scripts': ['r.test.mjs'] }, mutations: [['r gate', 'r.mjs', 'x > 1', 'x > 2']] };
  assert.match(validateLines([['r gate, by its path', 'galxe-desk/scripts/r.mjs', '(x > 1 ?', '(x > 2 ?']], ropts).join(), /same guard as "r gate": it leaves galxe-desk\/scripts\/r\.mjs byte-identical/);
  assert.deepEqual(validateLines([['r gate, the other way', 'galxe-desk/scripts/r.mjs', 'x > 1', 'x < 1']], ropts), []);
  // A listed line whose match is gone is the run's NO_MATCH, not a reason to refuse or to throw.
  assert.deepEqual(validateLines([GOOD], { ...VOPTS, mutations: [...HARNESS_LIST, ['stale', 'pkg/scripts/a.mjs', 'no longer here', 'y']] }), []);
});

test('no two listed mutations leave their file byte-identical, so killed N of N counts each guard once', () => {
  assert.deepEqual(twinsOf(MUTATIONS), []);
  const wider = ['the same cut, spelt shorter', 'pkg/scripts/a.mjs', 'if (x < 0) return', 'if (false) return'];
  const list = [...HARNESS_LIST, GOOD, wider, ['z one, by a longer from', 'other/scripts/z.mjs', '(x ? 1 : 0);', '(x ? 0 : 0);'], LIST_FX[3], ['gone', 'pkg/scripts/none.mjs', 'a', 'b']];
  assert.deepEqual(twinsOf(list, { root: FX }), [['a refuses a negative', 'the same cut, spelt shorter'], ['z one, by a longer from', 'z one']]);
  assert.deepEqual(twinsOf(LIST_FX, { root: FX }), []);
});

test("a line for the harness file itself is refused when its from would also match its own written line", () => {
  const opts = { ...VOPTS, target: 'harness/list.mjs', targetSrc: HARNESS };
  assert.match(validateLines([['own', 'harness/list.mjs', 'export const limit = 3;', 'export const limit = 4;']], opts).join(), /would also match its own line/);
  assert.deepEqual(validateLines([['own', 'harness/list.mjs', 'export const limit = 3;\n', 'export const limit = 4;\n']], opts), []);
});

test('a harness with two closing "];" lines is refused, because where to write is unknown', () => {
  const src = 'export const MUTATIONS = [\n  ["a", "b", "c", "d"],\n];\nconst other = [\n  1,\n];\n';
  assert.match(insertLines(src, [GOOD], 'g').error, /one line "\];"/);
  assert.match(validateLines([GOOD], { ...VOPTS, target: 'harness/list.mjs', targetSrc: src }).join(), /one line "\];"/);
  assert.ok(insertLines('export const MUTATIONS = [\n];\n', [GOOD], 'g').text);
});

test('--add writes one group just before the closing "];", by slicing, and a "$" in a line stays literal', async () => {
  const root = fixture();
  const target = join(root, 'harness/list.mjs');
  const line = ['a $& and $1 guard', 'pkg/scripts/a.mjs', "if (x < 0) return 'refused';", "if (false) return '$&';"];
  const r = await addLines([line, GOOD], { group: 'fixture batch', root, target, mutations: HARNESS_LIST, suites: SUITES_FX, suiteFor: {}, run: killedAll });
  assert.deepEqual(r, { ok: true, problems: [] });
  const expected = HARNESS.split('\n];\n').join(`\n  // fixture batch (added by mutate --add)\n  ${JSON.stringify(line)},\n  ${JSON.stringify(GOOD)},\n];\n`);
  assert.equal(readFileSync(target, 'utf8'), expected);
  assert.deepEqual(readdirSync(join(root, 'harness')).filter((f) => f.endsWith('.tmp')), []);
});

test('a batch with any line not KILLED writes nothing', async () => {
  const root = fixture();
  const target = join(root, 'harness/list.mjs');
  for (const status of ['SURVIVED', 'TIMEOUT', 'CRASHED', 'BASELINE_RED', undefined]) {
    const run = async (b) => ({ results: [{ name: b[0][0], status: 'KILLED' }, status && { name: b[1][0], status }] });
    const r = await addLines([GOOD, GOOD2], { group: 'g', root, target, mutations: HARNESS_LIST, suites: SUITES_FX, suiteFor: {}, run });
    assert.equal(r.ok, false, String(status));
    assert.match(r.problems.join(), /line 2 .* was not killed/);
    assert.equal(readFileSync(target, 'utf8'), HARNESS);
  }
});

test('a written file that does not re-import ending with the batch gets its old bytes back', async () => {
  const root = fixture();
  const target = join(root, 'harness/list.mjs');
  const base = { group: 'g', root, target, mutations: HARNESS_LIST, suites: SUITES_FX, suiteFor: {}, run: killedAll };
  for (const load of [async () => [], async () => { throw new SyntaxError('broken'); }, async () => [['other', 'x', 'y', 'z']]]) {
    const r = await addLines([GOOD], { ...base, load });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /old bytes are back/);
    assert.equal(readFileSync(target, 'utf8'), HARNESS);
  }
  const noComma = HARNESS.split('],\n];').join(']\n];');
  write(root, 'harness/list.mjs', noComma);
  const r = await addLines([GOOD], base);
  assert.equal(r.ok, false);
  assert.equal(readFileSync(target, 'utf8'), noComma);
});

test('--add needs --group, takes no --only, --since or --list, and reads its batch as JSON', async () => {
  assert.match(parseCli(['--add', 'x.json']).errors.join(), /needs --group/);
  assert.match(parseCli(['--group', 'g']).errors.join(), /goes with --add/);
  assert.ok(parseCli(['--add', 'x.json', '--group', 'g', '--only', 'a']).errors.length);
  assert.ok(parseCli(['--add', 'x.json', '--group', 'g', '--since', 'HEAD']).errors.length);
  let called = false;
  const out = [];
  const add = async () => { called = true; return { ok: true, problems: [] }; };
  assert.equal(await main(['--add', join(FX, 'no-such.json'), '--group', 'g'], { add, print: (l) => out.push(l) }), 1);
  assert.equal(called, false);
  assert.match(out.join(), /not readable JSON/);
});

// ---- the list itself, its suites, and the folded-in claude-setup guard -----------------------------------------

test("a file's own suite beats its folder's, and a listed suite not yet written is NO_SUITE, never the folder's", () => {
  assert.deepEqual(suiteOf('pkg/scripts/a.mjs', FXO), ['pkg/scripts/a.test.mjs']);
  const suiteFor = { 'pkg/scripts/cli.mjs': ['other/scripts/z.test.mjs'], 'pkg/scripts/a.mjs': ['pkg/scripts/not-yet.test.mjs'] };
  assert.deepEqual(suiteOf('pkg/scripts/cli.mjs', { ...FXO, suiteFor }), ['other/scripts/z.test.mjs']);
  assert.deepEqual(suiteOf('pkg/scripts/a.mjs', { ...FXO, suiteFor }), []);
  assert.equal(prepare(LIST_FX[0], { ...FXO, suiteFor }).status, 'NO_SUITE');
  assert.deepEqual(SUITE_FOR, {
    'galxe-desk/scripts/mutate.mjs': ['galxe-desk/scripts/mutate.test.mjs'],
    '.claude/hooks/guard.mjs': ['.claude/hooks/guard.test.mjs'],
    '.claude/workflows/fix-verify.js': ['scripts/workflows.test.mjs'],
    '.claude/workflows/review-3x.js': ['scripts/workflows.test.mjs'],
    'scripts/corpus/corpus.mjs': ['scripts/prove.test.mjs'],
    '.claude/settings.json': ['.claude/hooks/guard.test.mjs'],
    '.gitignore': ['.claude/hooks/guard.test.mjs'],
  });
  assert.equal(relPath('.gitignore'), '.gitignore', 'a dotfile is a root file, not a desk script');
  assert.equal(relPath('rank.mjs'), 'galxe-desk/scripts/rank.mjs');
  assert.ok(!SUITES['galxe-desk/scripts'].includes('mutate.test.mjs'), 'the desk suite never pays for this file');
});

test('every listed mutation is four strings with a unique name, a real change, one match and a suite', () => {
  const names = new Set();
  for (const m of MUTATIONS) {
    assert.equal(m.length, 4, JSON.stringify(m));
    assert.ok(m.every((x) => typeof x === 'string'), m[0]);
    assert.ok(!names.has(m[0]), `${m[0]} is listed twice`);
    names.add(m[0]);
    assert.notEqual(m[2], m[3], m[0]);
    // mutate.mjs's own lines are checked by the run itself: in a mutated copy of this file their match is gone.
    if (relPath(m[1]) === SELF_REL) continue;
    const p = prepare(m);
    assert.equal(p.status, undefined, `${m[0]}: ${p.detail}`);
  }
});

test("claude-setup's two boot.mjs guards run in the one pass, judged by its folder's suite", () => {
  assert.deepEqual(SUITES['claude-setup/skills/joy-boot/scripts'], ['boot.test.mjs']);
  const boot = 'claude-setup/skills/joy-boot/scripts/boot.mjs';
  // The two cuts claude-setup's own mutate.mjs makes at once, each listed here alone, so each must bite alone.
  for (const [from, to] of [['big: 150_000,', 'big: 1_500_000,'], ["if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};", '']]) {
    assert.ok(MUTATIONS.some((m) => m[1] === boot && m[2] === from && m[3] === to), from);
  }
  assert.equal(MUTATIONS.filter((m) => m[1] === boot).length, 2);
});
