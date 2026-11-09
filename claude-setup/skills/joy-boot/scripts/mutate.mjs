// mutate.mjs: the pass that is meant to fail. Copies boot.mjs with two guards broken (the non-object input guard
// removed, the big threshold ten times too high) next to a copy of its tests, runs them, and exits 1 if every test
// still passes, because then the tests guard nothing. Usage: node mutate.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const here = path.dirname(new URL(import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'joy-boot-mutant-'));
let src = fs.readFileSync(path.join(here, 'boot.mjs'), 'utf8');
const cuts = [
  ["if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};", ''],
  ['big: 150_000,', 'big: 1_500_000,'],
];
for (const [a, b] of cuts) { if (!src.includes(a)) { console.log(`FAIL mutation target missing: ${a}`); process.exit(1); } src = src.replace(a, b); }
fs.writeFileSync(path.join(dir, 'boot.mjs'), src);
fs.copyFileSync(path.join(here, 'boot.test.mjs'), path.join(dir, 'boot.test.mjs'));
const r = spawnSync(process.execPath, ['--test', path.join(dir, 'boot.test.mjs')], { encoding: 'utf8' });
const n = k => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
const fail = n('fail'), pass = n('pass');
console.log(`MUTANT (${cuts.length} guards broken): ${fail} test(s) went red, ${pass} stayed green`);
console.log(fail > 0 ? 'PASS: the guards are shown to fail' : 'FAIL: every test passed against a broken hook, so the tests guard nothing');
process.exit(fail > 0 ? 0 : 1);
