// The reach recorder (plan 20, step A2). mutate.mjs passes this file to a test run through NODE_OPTIONS
// (--import=<its file URL>) and never otherwise. In each node process of the run it records what the process loads,
// reads, stats, lists, copies and starts, under the test file that owns the process, so that --since selects a
// mutation by what its tests really read, and --cache reuses a kill only when those inputs are byte-identical.
//
// The harness sets these in the run's environment, and nowhere else:
//   REACH_DIR    where each process appends its record (inside the run's throwaway folder)
//   REACH_ROOT   the copy of the repo the run tests: a path inside it is stored repo-relative
//   REACH_TMP    the run's own TMPDIR: a path inside it (a test's fixture) is dropped
//   REACH_WORK   the run's throwaway folder, which holds the three above: a path in it outside the copy is dropped
//   REACH_OWNER  empty, so that a test file's own process names itself
// A test file's process (NODE_TEST_CONTEXT set, REACH_OWNER empty) sets REACH_OWNER to its argv[1], repo-relative,
// and every process it starts inherits it, so a CLI a test spawns records for that test file. A process with no owner
// (the test runner's own) records nothing. Any other path is kept absolute, for --cache to hash.
//
// It fails closed. What it cannot see makes its owner OPAQUE, and --since then keeps today's rules for that suite:
// no module hooks (module.registerHooks, Node 22.15 and later); a node child started without this recorder; a child
// that is not node and whose working folder, an argument or a variable reaches the repo copy; a worker thread; a glob.
// Each line is appended with the original appendFileSync before the read it names happens, so a process killed by a
// deadline leaves a record complete up to the kill, and a torn last line is ignored. A wrapper records, then calls
// the original with the same `this` and arguments; it never throws an error of its own.

import module from 'node:module';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECORDER_VARS = ['REACH_DIR', 'REACH_ROOT', 'REACH_TMP', 'REACH_WORK', 'REACH_OWNER'];
export const PRELOAD_URL = import.meta.url;
const INSTALLED = Symbol.for('joyisfree.reach.installed');
// A path read as a file, listed as a folder, or copied (or listed) with everything under it.
export const KIND_RANK = { file: 1, dir: 2, tree: 3 };

const tokens = (options) => String(options ?? '').split(/\s+/).filter(Boolean);
const unquote = (s) => (/^(["']).*\1$/.test(s) ? s.slice(1, -1) : s);

/** The --import preloads a NODE_OPTIONS string names, in order (`--import=x` or `--import x`). */
export function importsOf(options) {
  const t = tokens(options);
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].startsWith('--import=')) out.push(unquote(t[i].slice('--import='.length)));
    else if (t[i] === '--import' && i + 1 < t.length) out.push(unquote(t[++i]));
  }
  return out;
}

const isReachPreload = (u) => /(^|\/)reach\.mjs$/.test(u.split(/[?#]/)[0]);

/**
 * The variables a recorded run gets on top of its own environment: this preload last in NODE_OPTIONS (every other
 * option kept, and any earlier reach preload dropped, so a harness run inside another one records only for itself),
 * where to record, the repo copy, the run's temp folder and its throwaway folder, and an empty owner for a test
 * file's process to fill in.
 */
export function recorderEnv({ dir, root, tmp, work = '', preload = PRELOAD_URL, nodeOptions = process.env.NODE_OPTIONS } = {}) {
  const t = tokens(nodeOptions);
  const kept = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].startsWith('--import=') && isReachPreload(unquote(t[i].slice('--import='.length)))) continue;
    if (t[i] === '--import' && i + 1 < t.length && isReachPreload(unquote(t[i + 1]))) { i++; continue; }
    kept.push(t[i]);
  }
  return { NODE_OPTIONS: [...kept, `--import=${preload}`].join(' '), REACH_DIR: dir, REACH_ROOT: root, REACH_TMP: tmp, REACH_WORK: work, REACH_OWNER: '' };
}

/**
 * Every process's record in `dir`, merged by owner: { [owner]: { processes, paths: { path: kind }, opaque: [why] } }.
 * A file without a whole start line is no record. Its last piece is ignored when it does not end in a line break (a
 * process killed mid-write); a line in the middle that cannot be read makes the owner OPAQUE, never a shorter record.
 */
export function readRecords(dir) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort(); } catch { return out; }
  for (const name of names) {
    let text;
    try { text = fs.readFileSync(join(dir, name), 'utf8'); } catch { continue; }
    const lines = text.split('\n').slice(0, -1); // a torn last line, or the empty piece after the last break
    let rec = null;
    for (const [i, line] of lines.entries()) {
      let o;
      try { o = JSON.parse(line); } catch { o = null; }
      if (i === 0) {
        if (!o || o.start !== 1 || typeof o.owner !== 'string' || !o.owner) break; // no start line: no record
        rec = out[o.owner] ?? (out[o.owner] = { processes: 0, paths: {}, opaque: [] });
        rec.processes++;
      } else if (o && typeof o.opaque === 'string') {
        if (!rec.opaque.includes(o.opaque)) rec.opaque.push(o.opaque);
      } else if (o && typeof o.p === 'string' && Object.hasOwn(KIND_RANK, o.k)) {
        if (!rec.paths[o.p] || KIND_RANK[o.k] > KIND_RANK[rec.paths[o.p]]) rec.paths[o.p] = o.k;
      } else if (!rec.opaque.includes('a line of its record could not be read')) rec.opaque.push('a line of its record could not be read');
    }
  }
  for (const rec of Object.values(out)) rec.opaque.sort();
  return out;
}

// ------------------------------------------------------------------------------------------------- the preload

/**
 * The module hooks the preload registers: every file: URL loaded through import or require is noted (and, for a .js
 * file, the package.json files that say how it is read), and so is the path a relative or file import looked for when
 * it resolved to nothing. Neither hook changes what it is handed. (On Node 22.22 the loader also reads each module
 * through the public fs.openSync, which the wrappers note too; the hooks do not depend on that.)
 */
export function moduleHooks({ note, scopes }) {
  return {
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (err) {
        try { if (/^(\.{1,2}\/|\/|file:)/.test(specifier) && String(context?.parentURL).startsWith('file:')) note(new URL(specifier, context.parentURL)); } catch { /* not a path */ }
        throw err;
      }
    },
    load(url, context, nextLoad) {
      try {
        if (url.startsWith('file:')) {
          note(url);
          if (url.endsWith('.js')) scopes(fileURLToPath(url));
        }
      } catch { /* recording never changes what a load does */ }
      return nextLoad(url, context);
    },
  };
}

function install() {
  const env = process.env;
  if (!env.REACH_DIR || !env.REACH_ROOT || globalThis[INSTALLED]) return;
  if (!importsOf(env.NODE_OPTIONS).includes(PRELOAD_URL)) return; // imported as a library, not loaded as the preload
  globalThis[INSTALLED] = true;
  const append = fs.appendFileSync;
  const real = fs.realpathSync;
  const bases = (p) => { if (!p) return []; const a = resolve(p); let b = a; try { b = real(a); } catch { /* not there */ } return [...new Set([a, b])]; };
  const ROOTS = bases(env.REACH_ROOT);
  const DROP = [...bases(env.REACH_TMP), ...bases(env.REACH_DIR), ...bases(env.REACH_WORK)];
  const inside = (p, b) => p === b || p.startsWith(b + sep);
  // The key a path is stored under: repo-relative inside the copy, null (dropped) in the run's own folders, else absolute.
  const keyOf = (abs) => {
    for (const r of ROOTS) if (inside(abs, r)) return relative(r, abs).split(sep).join('/');
    for (const d of DROP) if (inside(abs, d)) return null;
    return abs;
  };
  if (env.NODE_TEST_CONTEXT && !env.REACH_OWNER) env.REACH_OWNER = process.argv[1] ? keyOf(resolve(process.argv[1])) ?? resolve(process.argv[1]) : '(no file)';
  const owner = env.REACH_OWNER;
  if (!owner) return; // the test runner's own process, or one outside any test file: nothing to record
  const file = join(env.REACH_DIR, `${encodeURIComponent(owner)}.${process.pid}-${process.hrtime.bigint()}.jsonl`);
  // A line that cannot be written is a record that is not whole: the process then exits red, so the run is not green.
  const write = (o) => { try { append(file, `${JSON.stringify(o)}\n`); } catch { process.exitCode = 70; } };
  write({ start: 1, owner, pid: process.pid, node: process.version });
  const seen = new Set();
  const toAbs = (raw) => {
    if (typeof raw === 'number') return null; // a file descriptor: its open was recorded
    let s = raw;
    if (s instanceof URL) s = s.protocol === 'file:' ? fileURLToPath(s) : null;
    else if (Buffer.isBuffer(s)) s = s.toString();
    else if (typeof s === 'string' && s.startsWith('file:')) s = fileURLToPath(s);
    return typeof s === 'string' && s !== '' ? resolve(s) : null;
  };
  const note = (raw, k = 'file') => {
    const abs = toAbs(raw);
    if (!abs) return;
    const p = keyOf(abs);
    if (p === null || seen.has(`${k}\0${p}`)) return;
    seen.add(`${k}\0${p}`);
    write({ p, k });
  };
  const opaqued = new Set();
  const opaque = (why) => { if (!opaqued.has(why)) { opaqued.add(why); write({ opaque: why }); } };

  if (typeof module.registerHooks !== 'function') {
    opaque('no module hooks: module.registerHooks needs Node 22.15 or later');
    return; // no wrappers either, so the record is empty and its suite keeps today's rules exactly
  }
  module.registerHooks(moduleHooks({ note, scopes }));
  // A .js file is a module or not by the nearest package.json above it, so each one up to the copy's root is a read.
  function scopes(abs) {
    for (let d = dirname(abs); ; d = dirname(d)) {
      const k = keyOf(d);
      if (k === null || k.startsWith('/')) return;
      note(join(d, 'package.json'));
      if (k === '') return;
    }
  }

  const keep = (orig, wrapped) => {
    for (const k of Reflect.ownKeys(orig)) {
      if (['length', 'name', 'prototype', 'arguments', 'caller'].includes(k)) continue;
      try { Object.defineProperty(wrapped, k, Object.getOwnPropertyDescriptor(orig, k)); } catch { /* not copyable */ }
    }
    return wrapped;
  };
  const wrap = (obj, name, record) => {
    const orig = obj?.[name];
    if (typeof orig !== 'function') return;
    const wrapped = keep(orig, function (...args) {
      try { record(args); } catch { /* recording never changes what the call does */ }
      return orig.apply(this, args);
    });
    try { obj[name] = wrapped; } catch { /* read-only */ }
  };
  const first = (k) => (args) => note(args[0], k);
  const listed = (args) => note(args[0], args[1] && typeof args[1] === 'object' && args[1].recursive ? 'tree' : 'dir');
  const copied = (args) => note(args[0], args[2] && typeof args[2] === 'object' && args[2].recursive ? 'tree' : 'file');
  const FILE = ['readFileSync', 'readFile', 'openSync', 'open', 'openAsBlob', 'createReadStream', 'existsSync', 'exists', 'statSync', 'stat', 'lstatSync', 'lstat', 'accessSync', 'access', 'copyFileSync', 'copyFile', 'readlinkSync', 'readlink', 'realpathSync', 'realpath'];
  const P_FILE = ['readFile', 'open', 'stat', 'lstat', 'access', 'copyFile', 'readlink', 'realpath'];
  for (const n of FILE) wrap(fs, n, first('file'));
  wrap(fs.realpathSync, 'native', first('file'));
  wrap(fs.realpath, 'native', first('file'));
  for (const n of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) wrap(fs, n, listed);
  for (const n of ['cpSync', 'cp']) wrap(fs, n, copied);
  for (const n of ['globSync', 'glob']) wrap(fs, n, () => opaque('a glob, which reads folders it does not name'));
  const P = fs.promises;
  for (const n of P_FILE) wrap(P, n, first('file'));
  for (const n of ['readdir', 'opendir']) wrap(P, n, listed);
  wrap(P, 'cp', copied);
  wrap(P, 'glob', () => opaque('a glob, which reads folders it does not name'));

  // Child processes. A node child must carry this recorder (or, for a harness test, a recorder of its own on a fixture
  // outside the repo); any other child must not reach the repo copy through its folder, arguments or variables.
  const isNode = (cmd) => typeof cmd === 'string' && (cmd === process.execPath || /^node(\.exe)?$/i.test(basename(cmd)));
  const optionsOf = (o) => (o && typeof o === 'object' ? o : {});
  const split = (a, b) => (Array.isArray(a) ? [a, optionsOf(b)] : [[], optionsOf(a)]);
  const ours = (k, v) => (RECORDER_VARS.includes(k) || k === 'NODE_OPTIONS') && v === env[k];
  // What of a child reaches the repo copy, said with the copy's path written <repo>, or null when nothing does.
  const shown = (s) => { let t = String(s); for (const r of ROOTS) t = t.split(r).join('<repo>'); return t.length > 120 ? `${t.slice(0, 117)}...` : t; };
  const reaches = (cwd, args, vars) => {
    const has = (s) => ROOTS.some((r) => String(s).includes(r));
    if (has(resolve(cwd))) return `working folder (${shown(resolve(cwd))})`;
    const arg = args.find(has);
    if (arg !== undefined) return `arguments (${shown(arg)})`;
    for (const [k, v] of Object.entries(vars ?? {})) if (!ours(k, v) && has(v)) return `variable ${k}`;
    return null;
  };
  const check = (how, file, args, o, node) => {
    const vars = o.env ?? process.env;
    const cwd = o.cwd == null ? process.cwd() : o.cwd instanceof URL ? fileURLToPath(o.cwd) : String(o.cwd);
    if (node) {
      const imports = importsOf(vars.NODE_OPTIONS);
      if (RECORDER_VARS.every((k) => vars[k] === env[k]) && imports.includes(PRELOAD_URL)) return; // it records for this owner
      if (vars.REACH_DIR && imports.length) { // a harness test's run on a fixture, recorded by a recorder of its own
        for (const u of imports) note(u);
        const why = reaches(cwd, args, Object.fromEntries(Object.entries(vars).filter(([k]) => k !== 'NODE_OPTIONS')));
        if (why) opaque(`${how}: a node child with a recorder of its own reaches the repo through its ${why}`);
        return;
      }
      opaque(`${how}: a node child started without the recorder`);
      return;
    }
    const why = reaches(cwd, [file, ...args], vars);
    if (why) opaque(`${how}: ${String(file).trim().split(/\s+/)[0]} is not node, and its ${why} reaches the repo`);
  };
  const viaFile = (how) => ([file, a, b]) => { const [args, o] = split(a, b); check(how, file, args.map(String), o, isNode(file) && !o.shell); };
  for (const n of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) wrap(childProcess, n, viaFile(n));
  for (const n of ['exec', 'execSync']) wrap(childProcess, n, ([command, o]) => check(n, command, [], optionsOf(o), false));
  wrap(childProcess, 'fork', ([path, a, b]) => {
    const [args, o] = split(a, b);
    const exe = o.execPath ?? process.execPath;
    check('fork', exe, [String(path), ...args.map(String)], o, isNode(exe));
  });
  const Worker = workerThreads.Worker;
  if (typeof Worker === 'function') {
    try {
      workerThreads.Worker = class RecordedWorker extends Worker {
        constructor(...args) {
          try { opaque('a worker thread, which this recorder does not follow'); } catch { /* never */ }
          super(...args);
        }
      };
    } catch { /* read-only */ }
  }
  module.syncBuiltinESMExports(); // so `import { readFileSync } from 'node:fs'` gets the wrapped one too
}

install();
