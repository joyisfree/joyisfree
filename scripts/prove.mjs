#!/usr/bin/env node
// One command that answers "is it true?" for this whole repo.
//
//   npm run prove
//
// Every summary Claude gives about this repo should be answerable by this command, and it exits 0 only when every
// required check holds. It exists because a green test suite on its own proved too little here more than once: the
// "27 of 27 guards bite" claim was a hand count until a mutation check disproved it, a test file was once missing
// entirely while `npm test` still passed, and a draft with a known-wrong formula nearly went to the remote.
//
// Required (any FAIL exits 1):
//   1. tests      every *.test.mjs in the repo, run together, green, and at least one test per suite directory
//   2. mutations  every guard in the repo is removed in turn and some test goes red (galxe-desk/scripts/mutate.mjs)
//   3. secrets    no key, token or private-key shape anywhere in tracked or untracked files
//   4. privacy    agency/pilot/ (customer-derived data) is ignored and nothing under it is tracked
//   5. studio     the studio repo (joyisfree1) has no uncommitted change made from here
// Reported, never failed:
//   6. rulebook   `desk:check` is honestly incomplete until the live crawl runs; it is shown, not hidden

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO = resolve(REPO, '..', 'joyisfree1');
const TEST_DIRS = ['galxe-desk/scripts', 'agency/scripts', '.claude/skills/joy-revise/scripts', 'scripts'];

// Shapes that are never allowed in this repo. A public DAO proposal id inside a quoted Galxe docs URL is the one known
// 0x-hex false positive (galxe-desk/rulebook/read-2026-10-30.json), so 0x hex is only flagged outside such a URL.
export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(live|test)_[A-Za-z0-9]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];
const HEX64 = /\b0x[a-fA-F0-9]{64}\b/;
const ALLOWED_HEX_CONTEXT = /dao\.galxe\.com\/#\/proposal\/0x[a-fA-F0-9]{64}/;

/** Lines of text that look like a secret. Pure, so the scanner itself is testable. */
export function secretHits(lines) {
  const hits = [];
  for (const { where, text } of lines) {
    if (SECRET_PATTERNS.some((re) => re.test(text))) { hits.push(where); continue; }
    if (HEX64.test(text) && !ALLOWED_HEX_CONTEXT.test(text)) hits.push(where);
  }
  return hits;
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024, ...opts });

function tests() {
  const files = [];
  const empty = [];
  for (const d of TEST_DIRS) {
    const dir = join(REPO, d);
    const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f)) : [];
    if (!found.length) empty.push(d);
    files.push(...found);
  }
  if (empty.length) return { ok: false, detail: `no test file in ${empty.join(', ')}` };
  try {
    const out = sh(process.execPath, ['--test', ...files]);
    const pass = Number((out.match(/^# pass (\d+)/m) || [])[1] ?? NaN);
    const fail = Number((out.match(/^# fail (\d+)/m) || [])[1] ?? NaN);
    return { ok: fail === 0 && pass > 0, detail: `${pass} passed, ${fail} failed across ${files.length} files` };
  } catch (e) {
    const out = String(e.stdout || '');
    return { ok: false, detail: `red: ${(out.match(/^# fail (\d+)/m) || ['', '?'])[1]} failed` };
  }
}

function mutations() {
  try {
    const out = sh(process.execPath, [join(REPO, 'galxe-desk/scripts/mutate.mjs')]);
    return { ok: true, detail: out.trim().split('\n').pop() };
  } catch (e) {
    const lines = String(e.stdout || '').trim().split('\n');
    return { ok: false, detail: lines.slice(-4).join(' | ') };
  }
}

function secrets() {
  let out = '';
  try {
    out = sh('git', ['grep', '-nI', '--untracked', '-E', '(PRIVATE KEY|sk_live_|sk_test_|gh[pousr]_|github_pat_|xox[baprs]-|AKIA|AIza|0x[a-fA-F0-9]{64})', '--', '.']);
  } catch (e) {
    if (e.status === 1) return { ok: true, detail: 'no secret-shaped text found' };
    return { ok: false, detail: `git grep failed: ${String(e.message).split('\n')[0]}` };
  }
  const lines = out.split('\n').filter(Boolean).map((l) => {
    const m = l.match(/^([^:]+:\d+):(.*)$/);
    return m ? { where: m[1], text: m[2] } : { where: l.slice(0, 80), text: l };
  });
  const hits = secretHits(lines);
  return hits.length ? { ok: false, detail: `secret-shaped text at ${hits.slice(0, 5).join(', ')}` } : { ok: true, detail: `clean (${lines.length} candidate line(s) checked, all allowed)` };
}

function privacy() {
  try {
    sh('git', ['check-ignore', '-q', 'agency/pilot/ledger.jsonl']);
  } catch {
    return { ok: false, detail: 'agency/pilot/ is NOT gitignored' };
  }
  const tracked = sh('git', ['ls-files', 'agency/pilot']).trim();
  return tracked ? { ok: false, detail: `tracked under agency/pilot/: ${tracked.split('\n').slice(0, 3).join(', ')}` } : { ok: true, detail: 'agency/pilot/ ignored, nothing tracked' };
}

function studio() {
  if (!existsSync(join(STUDIO, '.git'))) return { ok: true, detail: 'studio repo not present on this machine' };
  const dirty = sh('git', ['-C', STUDIO, 'status', '--porcelain']).trim();
  return dirty ? { ok: false, detail: `joyisfree1 has uncommitted changes: ${dirty.split('\n').slice(0, 3).join('; ')}` } : { ok: true, detail: 'joyisfree1 clean' };
}

function rulebook() {
  try {
    return { ok: true, detail: sh(process.execPath, [join(REPO, 'galxe-desk/scripts/rulebook-crawl.mjs'), '--check']).trim() };
  } catch (e) {
    return { ok: true, detail: `incomplete, as expected until the live crawl: ${String(e.stdout || '').trim()}` };
  }
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const checks = [
    ['tests', tests, true],
    ['mutations', mutations, true],
    ['secrets', secrets, true],
    ['privacy', privacy, true],
    ['studio', studio, true],
    ['rulebook', rulebook, false],
  ];
  let failed = 0;
  for (const [name, fn, required] of checks) {
    const r = fn();
    const mark = r.ok ? 'PASS' : required ? 'FAIL' : 'NOTE';
    if (!r.ok && required) failed += 1;
    console.log(`${mark.padEnd(4)}  ${name.padEnd(9)}  ${r.detail}`);
  }
  console.log(failed ? `\nNOT PROVEN: ${failed} required check(s) failed.` : '\nPROVEN: every required check holds.');
  process.exitCode = failed ? 1 : 0;
}
