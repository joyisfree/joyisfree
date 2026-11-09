// Tests for boot.mjs: every verdict, every guard, the one-second budget. Run: node --test claude-setup/skills/joy-boot/scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeTranscript, verdict, boot, hide, findState, stateCandidates, findOwnTranscript, daysOld, isPlainFile, excerpt, LIMITS, FOCUS } from './boot.mjs';
import { spawn, spawnSync } from 'node:child_process';

// Fake keys are written with § inside each key shape and joined at runtime, so no line in this file looks like a key
// to the repo's secret scan (scripts/prove.mjs) or to GitHub's push protection; r() removes the marks before use.
const r = s => s.replaceAll('§', '');
const BOOT = new URL('./boot.mjs', import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'joy-boot-'));
const row = (type, extra = {}) => JSON.stringify({ type, isSidechain: false, message: { role: type, content: 'hi' }, ...extra });
const user = (text = 'please continue') => row('user', { message: { role: 'user', content: text } });
const assistant = ctx => row('assistant', { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: ctx - 1010, output_tokens: 5 } } });
const compact = () => row('user', { isCompactSummary: true, message: { role: 'user', content: 'summary' } });
const toolResult = () => row('user', { message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } });
const side = () => JSON.stringify({ type: 'assistant', isSidechain: true, message: { usage: { input_tokens: 999999 } } });

/** A transcript: `turnsAfter` human turns after an optional compaction, ending at `ctx` tokens of context. */
function transcript({ ctx = 20_000, compactAgo = null, loop = false, turnsBefore = 5 } = {}) {
  const lines = [];
  for (let i = 0; i < turnsBefore; i++) lines.push(user(), assistant(ctx));
  if (loop) { lines.push(compact(), user(), assistant(ctx), toolResult(), compact(), user(), assistant(ctx)); return lines.join('\n') + '\n'; }
  if (compactAgo != null) { lines.push(compact()); for (let i = 0; i < compactAgo; i++) lines.push(user(), assistant(ctx)); }
  lines.push(side());
  return lines.join('\n') + '\n';
}
const run = (args, input) => execFileSync(process.execPath, [BOOT, ...args], { encoding: 'utf8', input });
const dry = (obj, ...flags) => run(['--dry', JSON.stringify(obj), ...flags]);

test('analyzeTranscript reads the context from the last main-chain assistant line and ignores side chains', () => {
  const a = analyzeTranscript(transcript({ ctx: 123_456 }));
  assert.equal(a.context, 123_456);
  assert.equal(a.sinceCompact, null);
  assert.equal(a.compactions, 0);
});

test('turns since compaction counts human turns, not tool results', () => {
  const a = analyzeTranscript(transcript({ ctx: 50_000, compactAgo: 3 }));
  assert.equal(a.sinceCompact, 3);
  assert.equal(a.compactions, 1);
});

test('verdicts: small continues, middle warns, big compacts, recent compaction continues, loop relaunches', () => {
  assert.equal(verdict(analyzeTranscript(transcript({ ctx: 20_000 })), 'resume').kind, 'continue');
  const mid = verdict(analyzeTranscript(transcript({ ctx: 100_000 })), 'resume');
  assert.equal(mid.kind, 'continue'); assert.match(mid.line, /next task break/);
  const big = verdict(analyzeTranscript(transcript({ ctx: 190_000 })), 'resume');
  assert.equal(big.kind, 'compact'); assert.ok(big.line.includes(`/compact ${FOCUS}`));
  const recent = verdict(analyzeTranscript(transcript({ ctx: 100_000, compactAgo: 3 })), 'resume');
  assert.equal(recent.kind, 'continue'); assert.match(recent.line, /compacted 3 turn/);
  const thrash = verdict(analyzeTranscript(transcript({ ctx: 190_000, compactAgo: 3 })), 'resume');
  assert.equal(thrash.kind, 'fresh'); assert.match(thrash.line, /already at ≈190K/);
  assert.equal(verdict(analyzeTranscript(transcript({ ctx: 190_000 })), 'fork').kind, 'compact', 'a fork inherits the context and gets a verdict');
  const loop = verdict(analyzeTranscript(transcript({ ctx: 190_000, loop: true })), 'resume');
  assert.equal(loop.kind, 'fresh'); assert.match(loop.line, /\/fresh/);
});

test('an old compaction no longer counts as recent', () => {
  const a = analyzeTranscript(transcript({ ctx: 190_000, compactAgo: LIMITS.recent + 1 }));
  assert.equal(verdict(a, 'resume').kind, 'compact');
});

test('no verdict unless the session is a resume; unknown context continues', () => {
  assert.equal(verdict(analyzeTranscript(transcript({ ctx: 190_000 })), 'startup'), null);
  assert.equal(verdict(analyzeTranscript(transcript({ ctx: 190_000 })), 'clear'), null);
  assert.equal(verdict(null, 'resume').kind, 'continue');
  assert.equal(verdict(analyzeTranscript(''), 'resume').kind, 'continue');
});

test('hide masks keys, tokens and key=value pairs', () => {
  assert.equal(hide(r('key sk§-abcdefghijklmnopqrstuvwxyz here')), 'key [HIDDEN] here');
  assert.equal(hide('api_key = supersecretvalue123'), 'api_key = [HIDDEN]');
  assert.equal(hide(r('ghp§_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234')), '[HIDDEN]');
  assert.equal(hide('plain words stay'), 'plain words stay');
  assert.equal(hide('password: hunter2'), 'password: [HIDDEN]');
  // the .env spellings the refuters leaked
  // Fixture values are deliberately too short to be real keys (GitHub's push protection reads them too); the filter's minimums are lower.
  for (const line of [r('AWS_SECRET_ACCESS_KEY§=wJalrXUtnFEMI/K7MDENG/EXAMPLE'), r('DB_PASSWORD§=hunter22hunter22'), r('OPENAI_API_KEY§=AI§zaSyD-9tSrke72PouQMnMX-a7eZSW0jk'),
    r('STRIPE_SECRET_KEY§=sk§_live_51HabcDEFghiJ'), r('GITHUB_TOKEN§=abcdef0123456789abcdef0123456789abcd'), r('secret_key§ = qwertyuiop1234'), r('token: Bearer§ zx9v8b7n6m5a4s3d2f1g'),
    'password: "p@ss,word-rest-of-it"', r('Set in Vercel: STRIPE_SECRET_KEY§=sk§_live_abcdefghij1234'), r('RESEND_API_KEY§=re§_AbCdEf123456789012345xyz'), r('NPM_TOKEN§=npm§_abcdefghijklmnopqrstuvwxyz012345')]) {
    const h = hide(line); const value = line.split(/[:=]\s*(?:Bearer\s+)?/).pop().replace(/"/g, '');
    assert.ok(!h.includes(value.slice(-8)), `${line} → ${h}`);
    assert.ok(h.includes('[HIDDEN]'), h);
  }
  assert.equal(hide('the token budget is 5000 words'), 'the token budget is 5000 words', 'prose stays');
});

test('excerpt: a NUL inside a key header, a token cut by the 16 KB read, and a folder symlinked out of the repo all stay hidden', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'goal\n-----\u0000BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAbody\n-----END RSA PRIVATE KEY-----\nafter\n');
  const nul = excerpt(path.join(d, 'HANDOFF.md')).join('\n');
  assert.ok(!nul.includes('MIIEow'), nul); assert.match(nul, /goal/);
  const pad = 'x'.repeat(2000) + '\n';
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), pad.repeat(8) + 'y'.repeat(LIMITS.excerptBytes - 8 * 2001 - 10) + r(' ghp§_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123\nnext line\n'));
  const cut = excerpt(path.join(d, 'HANDOFF.md')).join('\n');
  assert.ok(!cut.includes('ghp_'), 'a token straddling the read boundary never shows its head');
  const outside = tmp(); fs.writeFileSync(path.join(outside, 'state.md'), r('sk§-abcdefghijklmnopqrstuvwxyz'));
  const repo = tmp(); fs.symlinkSync(outside, path.join(repo, 'docs'));
  assert.equal(findState(repo), null, 'docs/ symlinked out of the repo is never read');
  assert.equal(isPlainFile(path.join(repo, 'docs/state.md')), true, 'without a root the plain-file check alone passes');
  assert.equal(isPlainFile(path.join(repo, 'docs/state.md'), repo), false);
  const strings = analyzeTranscript(row('assistant', { message: { role: 'assistant', content: [], usage: { input_tokens: '1e297', cache_creation_input_tokens: 'LEAK', cache_read_input_tokens: 50_000 } } }) + '\n');
  assert.equal(strings.context, 50_000, 'string usage fields count as zero');
});

test('secrets are hidden before a line is cut, and a multi-line key never prints, even when cut off', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'x'.repeat(170) + r(' sk§-abcdefghijklmnopqrstuvwxyz\n-----BEGIN§ RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAbase64bodyline\n-----END RSA PRIVATE KEY-----\nafter the key\n'));
  const lines = excerpt(path.join(d, 'HANDOFF.md'));
  const text = lines.join('\n');
  assert.ok(!text.includes('sk-ab'), text); assert.ok(!text.includes('MIIEow'), text); assert.ok(text.includes('after the key'));
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), r('goal\n-----BEGIN§ RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAcutoffnoend\n'));
  const cut = excerpt(path.join(d, 'HANDOFF.md')).join('\n');
  assert.ok(!cut.includes('MIIEow'), cut); assert.match(cut, /goal/); assert.match(cut, /\[HIDDEN\]/);
  const big = path.join(d, 'PROGRESS.md'); fs.writeFileSync(big, 'line\n'.repeat(400_000));
  const t0 = Date.now(); assert.equal(excerpt(big).length, LIMITS.excerpt); assert.ok(Date.now() - t0 < 200, 'only the head is read');
});

test('transcript edge cases: synthetic zero usage, one compaction written as two markers, injected lines, a 1M model', () => {
  const synthetic = transcript({ ctx: 120_000 }) + row('assistant', { message: { role: 'assistant', model: '<synthetic>', content: [], usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }) + '\n';
  assert.equal(analyzeTranscript(synthetic).context, 120_000);
  const twoMarkers = transcript({ ctx: 50_000 }) + [JSON.stringify({ type: 'system', subtype: 'compact_boundary', isSidechain: false }), row('user', { isMeta: true, message: { role: 'user', content: 'attachment' } }), compact(), user(), assistant(50_000)].join('\n') + '\n';
  const a = analyzeTranscript(twoMarkers);
  assert.equal(a.compactions, 1, 'two markers for one compaction count once'); assert.equal(a.sinceCompact, 1);
  const injected = transcript({ ctx: 50_000, compactAgo: 0 }) + [row('user', { message: { role: 'user', content: '<command-name>/compact</command-name>' } }), row('user', { isMeta: true, message: { role: 'user', content: 'skill text' } }), assistant(50_000)].join('\n') + '\n';
  assert.equal(analyzeTranscript(injected).sinceCompact, 0, 'command echoes and injected skills are not turns');
  const oneM = transcript({ ctx: 190_000 }).replace(/"usage"/g, '"model":"claude-opus-4-1[1m]","usage"');
  const b = analyzeTranscript(oneM); assert.equal(b.scale, 5);
  assert.equal(verdict(b, 'resume').kind, 'continue', '190K is small on a 1M window');
});

test('the hook runs through a symlinked path, and exits on its own when stdin is never closed', async () => {
  const d = tmp(); const link = path.join(d, 'joy-boot.mjs'); fs.symlinkSync(BOOT, link);
  assert.match(execFileSync(process.execPath, [link, '--dry', JSON.stringify({ source: 'clear', cwd: d })], { encoding: 'utf8' }), /^JOY BOOT · clear/);
  const t0 = Date.now();
  const out = await new Promise(resolve => { const c = spawn(process.execPath, [BOOT], { cwd: d }); let s = ''; c.stdout.on('data', x => { s += x; }); c.on('close', () => resolve(s)); /* stdin left open on purpose */ });
  assert.match(out, /^JOY BOOT · startup/); assert.ok(Date.now() - t0 < LIMITS.deadline + 1000, 'gave up waiting for stdin');
});

test('findState follows the order and picks the newest dated handoff', () => {
  const d = tmp();
  assert.equal(findState(d), null);
  fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs/handoff-2026-10-19.md'), 'old');
  fs.writeFileSync(path.join(d, 'docs/handoff-2026-10-21.md'), 'new');
  assert.equal(path.basename(findState(d)), 'handoff-2026-10-21.md');
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'h');
  assert.equal(path.basename(findState(d)), 'HANDOFF.md');
  fs.writeFileSync(path.join(d, 'docs/state.md'), 's');
  assert.equal(findState(d), path.join(d, 'docs/state.md'));
  const e = tmp(); fs.mkdirSync(path.join(e, 'STATUS')); fs.writeFileSync(path.join(e, 'STATUS/progress.md'), 'p');
  assert.equal(findState(e), path.join(e, 'STATUS/progress.md'));
});

test('the newest state file wins; a fresh clone (all mtimes alike) keeps the order; an old file is flagged', () => {
  const d = tmp(); fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs/state.md'), 'state'); fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'handoff');
  assert.deepEqual(stateCandidates(d).map(f => path.basename(f)), ['state.md', 'HANDOFF.md']);
  assert.equal(path.basename(findState(d)), 'state.md', 'written together: list order');
  const later = new Date(Date.now() + 10_000); fs.utimesSync(path.join(d, 'HANDOFF.md'), later, later);
  assert.equal(path.basename(findState(d)), 'HANDOFF.md', 'the newer file wins');
  const old = new Date(Date.now() - 30 * 864e5); fs.utimesSync(path.join(d, 'HANDOFF.md'), old, old); fs.utimesSync(path.join(d, 'docs/state.md'), old, old);
  assert.match(dry({ source: 'startup', cwd: d }), /\(\d{4}-\d{2}-\d{2}, ⚠ (29|30|31) days old\)/);
  assert.equal(daysOld('not a date'), null); assert.equal(daysOld(new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)), 3);
});

test('--self finds this folder\'s own transcript first, the newest anywhere otherwise, and infers resume vs startup', () => {
  const cfg = tmp(); const root = path.join(cfg, 'projects'); fs.mkdirSync(path.join(root, 'p1'), { recursive: true }); fs.mkdirSync(path.join(root, 'p2', 'subagents'), { recursive: true });
  const older = path.join(root, 'p1', 'a.jsonl'), newer = path.join(root, 'p2', 'b.jsonl');
  fs.writeFileSync(older, transcript({ ctx: 20_000 })); fs.writeFileSync(newer, transcript({ ctx: 190_000 }));
  const past = new Date(Date.now() - 60_000); fs.utimesSync(older, past, past);
  const d = tmp();
  assert.equal(findOwnTranscript(root, d), newer, 'no folder of its own: the newest anywhere');
  assert.equal(findOwnTranscript(path.join(cfg, 'nowhere'), d), null);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
  const out = execFileSync(process.execPath, [BOOT, '--self'], { encoding: 'utf8', cwd: d, env });
  assert.match(out, /^JOY BOOT · resume · context ≈ 190K/); assert.match(out, /Verdict: compact first/);
  // This folder's own project directory wins over a newer transcript of another folder.
  const ownDir = path.join(root, d.replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(ownDir); const own = path.join(ownDir, 'c.jsonl');
  fs.writeFileSync(own, transcript({ ctx: 12_000, turnsBefore: 3 })); fs.utimesSync(own, past, past);
  assert.equal(findOwnTranscript(root, d), own);
  assert.match(execFileSync(process.execPath, [BOOT, '--self'], { encoding: 'utf8', cwd: d, env }), /^JOY BOOT · resume · context ≈ 12K/);
  // A brand-new session: Leif's first message is already in the transcript when Claude runs this. Still a startup.
  fs.writeFileSync(own, user('Bismillah') + '\n' + assistant(5_000) + '\n');
  assert.match(execFileSync(process.execPath, [BOOT, '--self'], { encoding: 'utf8', cwd: d, env }), /^JOY BOOT · startup/, 'one human turn: a new session');
  fs.writeFileSync(own, user('Bismillah') + '\n' + assistant(5_000) + '\n' + user('continue') + '\n' + assistant(6_000) + '\n');
  assert.match(execFileSync(process.execPath, [BOOT, '--self'], { encoding: 'utf8', cwd: d, env }), /^JOY BOOT · resume/, 'two human turns: a resume');
  assert.equal(execFileSync(process.execPath, [BOOT, '--self'], { encoding: 'utf8', cwd: d, env: { ...env, JOY_BOOT_OFF: '1' } }), '', 'JOY_BOOT_OFF silences the hook');
  // A long session whose last 256 KB is all tool output: one human line in the tail, but the size says it is old.
  fs.writeFileSync(own, user('Bismillah') + '\n' + assistant(5_000) + '\n' + row('user', { message: { role: 'user', content: [{ type: 'tool_result', content: 'z'.repeat(LIMITS.tail + 1000) }] } }) + '\n' + user('go on') + '\n' + assistant(90_000) + '\n');
  assert.match(execFileSync(process.execPath, [BOOT, '--self'], { encoding: 'utf8', cwd: d, env }), /^JOY BOOT · resume · context ≈ 90K/, 'bigger than the tail: not a new session');
});

test('an endless or enormous stdin cannot crash the hook: it stops reading, prints the line, exits 0', () => {
  const t0 = Date.now();
  const r = spawnSync('sh', ['-c', `yes | ${JSON.stringify(process.execPath)} ${JSON.stringify(BOOT)}`], { encoding: 'utf8', timeout: 8000 });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /^JOY BOOT · startup/); assert.ok(Date.now() - t0 < 3000, 'gave up on stdin quickly');
  const z = spawnSync('sh', ['-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(BOOT)} </dev/zero`], { encoding: 'utf8', timeout: 8000 });
  assert.equal(z.status, 0, z.stderr); assert.match(z.stdout, /^JOY BOOT · startup/);
});

test('a hanging git never holds the hook past its budget', () => {
  const d = tmp(); const bin = path.join(d, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
  fs.mkdirSync(path.join(d, 'docs')); fs.writeFileSync(path.join(d, 'docs/state.md'), 'state');
  const t0 = Date.now();
  const out = execFileSync(process.execPath, [BOOT, '--dry', JSON.stringify({ source: 'startup', cwd: d })], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const ms = Date.now() - t0;
  assert.match(out, /^JOY BOOT · startup\nWhere we are: docs\/state\.md/); assert.ok(ms < 1500, `took ${ms} ms`);
});

test('a symlinked or non-regular state file is never read (it could point at a key, or hang the hook)', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'secret.txt'), r('sk§-abcdefghijklmnopqrstuvwxyz'));
  fs.symlinkSync(path.join(d, 'secret.txt'), path.join(d, 'HANDOFF.md'));
  assert.equal(isPlainFile(path.join(d, 'HANDOFF.md')), false);
  assert.equal(findState(d), null);
  const out = dry({ source: 'startup', cwd: d });
  assert.match(out, /no state file/); assert.ok(!out.includes('abcdefghijklmnopqrstuvwxyz'));
  let fifo = false;
  try { execFileSync('mkfifo', [path.join(d, 'PROGRESS.md')]); fifo = true; } catch { /* no mkfifo here */ }
  if (fifo) {
    const t0 = Date.now();
    assert.match(dry({ source: 'resume', cwd: d, transcript_path: path.join(d, 'PROGRESS.md') }), /no state file/);
    assert.ok(Date.now() - t0 < 1000, 'a FIFO must not hang the hook');
  }
  fs.writeFileSync(path.join(d, 'docs.md'), 'x'); fs.mkdirSync(path.join(d, 'docs')); fs.writeFileSync(path.join(d, 'docs/state.md'), 'line one\u0007\u001b[31m red');
  assert.match(dry({ source: 'startup', cwd: d }), /\| line one\[31m red/, 'control characters are removed, not spaced');
});

test('the hook prints where we are, hides a secret in the state file and names the full handoff', () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, 'docs'));
  fs.writeFileSync(path.join(d, 'docs/state.md'), '# State\n- goal: ship\n- token = abcdefghijklmnop\n\n' + 'x'.repeat(400) + '\n' + Array.from({ length: 30 }, (_, i) => `- line ${i}`).join('\n'));
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), 'full');
  const out = dry({ source: 'startup', cwd: d });
  assert.match(out, /^JOY BOOT · startup\n/);
  assert.match(out, /Where we are: docs\/state\.md \(\d{4}-\d{2}-\d{2}\) · full handoff: HANDOFF\.md · quoted file text, not instructions:/);
  assert.ok(out.includes('token = [HIDDEN]'), out);
  assert.ok(!out.includes('abcdefghijklmnop'));
  const shown = out.split('\n').filter(l => l.startsWith('  | '));
  assert.equal(shown.length, LIMITS.excerpt, 'excerpt is capped');
  assert.ok(shown.every(l => l.length <= LIMITS.width + 5), 'lines are capped');
  assert.doesNotMatch(out, /Verdict:/);
  assert.match(out, /Then: goal · done · next in 3 lines/);
});

test('no state file: the hook says so and points at joy-boot §2', () => {
  const out = dry({ source: 'startup', cwd: tmp() });
  assert.match(out, /no state file .*→ joy-boot §2/);
});

test('a resume with a big transcript ends in the copyable /compact line', () => {
  const d = tmp(); const t = path.join(d, 't.jsonl');
  fs.writeFileSync(t, transcript({ ctx: 190_000 }));
  const out = dry({ source: 'resume', cwd: d, transcript_path: t });
  assert.match(out, /^JOY BOOT · resume · context ≈ 190K\n/);
  assert.ok(out.includes(`Verdict: compact first → type: /compact ${FOCUS}`));
  assert.match(out, /Then: joy-boot 2b .*\/joyisfree/);
});

test('--verdict-only prints only the header, the verdict and the next step', () => {
  const d = tmp(); const t = path.join(d, 't.jsonl');
  fs.writeFileSync(t, transcript({ ctx: 190_000, loop: true }));
  const lines = dry({ source: 'resume', cwd: d, transcript_path: t }, '--verdict-only').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /relaunch fresh/);
});

test('guards: malformed stdin, a missing transcript, an empty one and a non-object all exit 0 with a boot line', () => {
  for (const input of ['not json', '', '[1,2]', '42', '{"source":5,"cwd":17,"transcript_path":{}}']) {
    const out = run([], input);
    assert.match(out, /^JOY BOOT · startup/, `input ${JSON.stringify(input)}`);
    assert.match(out, /Then: .*\/joyisfree/);
  }
  const d = tmp();
  const missing = dry({ source: 'resume', cwd: d, transcript_path: path.join(d, 'nope.jsonl') });
  assert.match(missing, /Verdict: continue \(context size unknown\)/);
  fs.writeFileSync(path.join(d, 'empty.jsonl'), '');
  assert.match(dry({ source: 'resume', cwd: d, transcript_path: path.join(d, 'empty.jsonl') }), /context size unknown/);
  fs.writeFileSync(path.join(d, 'garbage.jsonl'), 'not\njson\n{"type":"user"}\n');
  assert.match(dry({ source: 'resume', cwd: d, transcript_path: path.join(d, 'garbage.jsonl') }), /context size unknown/);
});

test('a 30 MB transcript is read from its tail and answers inside the one-second budget', () => {
  const d = tmp(); const t = path.join(d, 'big.jsonl');
  const pad = 'p'.repeat(50_000);
  const fd = fs.openSync(t, 'w');
  for (let i = 0; i < 700; i++) fs.writeSync(fd, row('user', { message: { role: 'user', content: pad } }) + '\n' + assistant(80_000) + '\n');
  fs.writeSync(fd, transcript({ ctx: 170_000 }));
  fs.closeSync(fd);
  assert.ok(fs.statSync(t).size > 30 * 1024 * 1024, 'fixture is over 30 MB');
  const t0 = Date.now();
  const out = dry({ source: 'resume', cwd: d, transcript_path: t });
  const ms = Date.now() - t0;
  assert.match(out, /context ≈ 170K/);
  assert.ok(ms < 1000, `took ${ms} ms`);
});

test('a huge tool result at the very end does not hide the context: the hook reads more once', () => {
  const d = tmp(); const t = path.join(d, 't.jsonl');
  fs.writeFileSync(t, transcript({ ctx: 170_000 }) + row('user', { message: { role: 'user', content: [{ type: 'tool_result', content: 'z'.repeat(LIMITS.tail + 10) }] } }) + '\n');
  assert.match(dry({ source: 'resume', cwd: d, transcript_path: t }), /context ≈ 170K/);
});

test('git: unpushed commits are counted with and without an upstream, and uncommitted files are counted', () => {
  const d = tmp();
  const remote = path.join(d, 'remote.git'); const work = path.join(d, 'work');
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g(d, 'init', '--bare', '-q', remote);
  g(d, 'clone', '-q', remote, work);
  g(work, 'config', 'user.email', 't@t'); g(work, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a'); g(work, 'add', 'a.txt'); g(work, 'commit', '-q', '-m', 'one');
  g(work, 'push', '-q', '-u', 'origin', 'HEAD');
  assert.doesNotMatch(dry({ source: 'startup', cwd: work }), /Unpushed/);
  fs.writeFileSync(path.join(work, 'b.txt'), 'b'); g(work, 'add', 'b.txt'); g(work, 'commit', '-q', '-m', 'two');
  fs.writeFileSync(path.join(work, 'c.txt'), 'c');
  const out = dry({ source: 'startup', cwd: work });
  assert.match(out, /⬆️ Unpushed: 1 commit\(s\) on \S+ → git push\n/);
  assert.match(out, /✎ 1 uncommitted file\(s\)/);
  g(work, 'checkout', '-q', '-b', 'feature');
  assert.match(dry({ source: 'startup', cwd: work }), /Unpushed: 1 commit\(s\) on feature → git push -u origin feature/);
});

test('boot() as a function returns the same lines the CLI prints', () => {
  const d = tmp();
  const lines = boot({ source: 'clear', cwd: d });
  assert.equal(lines[0], 'JOY BOOT · clear');
  assert.equal(lines.at(-1), 'Then: goal · done · next in 3 lines, then /joyisfree sized to the open job.');
});

test('vendor formats from the Maxx audit are hidden: Google OAuth, Cloudinary URL, Supabase tokens, names ending in KEY', () => {
  const samples = [
    [r('GOOGLE_CLIENT=GOCSPX§-abcdefghijklmnopqrstuvwx'), r('GOCSPX§-abcdefghijklmnopqrstuvwx')],
    [r('see GOCSPX§-abcdefghijklmnopqrstuvwx in the console'), r('GOCSPX§-abcdefghijklmnopqrstuvwx')],
    [r('CLOUDINARY_URL=cloudinary:§//123456789012345:AbCdEfGhIjKlMnOpQrStUv@joyisfree'), 'AbCdEfGhIjKlMnOpQrStUv'],
    [r('cloudinary:§//123456789012345:AbCdEfGhIjKlMnOpQrStUv@joyisfree'), 'AbCdEfGhIjKlMnOpQrStUv'],
    ['token sbp_0123456789abcdef01234567', 'sbp_0123456789abcdef'],
    [r('sb§_secret_0123456789abcdefghij'), r('sb§_secret_0123456789')],
    ['SUPABASE_KEY=eyJabc', 'eyJabc'],
    ['SERVICE_KEY=abcdefghijklmnop', 'abcdefghijklmnop'],
    ['FOO_KEY=abcdefgh', 'abcdefgh'],
  ];
  for (const [line, secret] of samples) { const h = hide(line); assert.ok(!h.includes(secret), `${line} → ${h}`); assert.ok(h.includes('[HIDDEN]'), h); }
});

test('the third review\'s leaks are hidden: URL passwords, Basic auth, whsec_, rk_live_, sb_publishable_, other Slack prefixes, a key block with no END, quoted values with spaces, pwd', () => {
  const samples = [
    [r('DATABASE_URL=postgresql:§//postgres:hunter2pass@db.example.com:5432/postgres'), 'hunter2pass'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZDEyMw==', 'dXNlcjpwYXNz'],
    ['STRIPE_WEBHOOK=whsec_abcdefghij0123456789', 'whsec_abcdefghij'],
    [r('rk§_live_abcdefghij0123'), r('rk§_live_abcdefghij')],
    ['PUBLIC=sb_publishable_abcdefghij012345', 'sb_publishable_abcd'],
    [r('xox§e-1234567890-abcdef'), r('xox§e-1234567890')],
    [r('-----BEGIN§ PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\nno end line here'), 'MIIEvQIBADAN'],
    ['API_KEY="abcd EFGH1234 ijklMNOP"', 'ijklMNOP'],
    ["password: 'two words here'", 'two words'],
    ['db_pwd: hunter2pass', 'hunter2pass'],
  ];
  for (const [line, secret] of samples) { const h = hide(line); assert.ok(!h.includes(secret), `${line} → ${h}`); assert.ok(h.includes('[HIDDEN]'), h); }
  assert.equal(hide('see https://example.com/a:b and localhost:3000/x'), 'see https://example.com/a:b and localhost:3000/x', 'a URL without credentials stays');
  assert.equal(hide('pass: 12 tests, auth flows reviewed'), 'pass: 12 tests, auth flows reviewed', 'bare pass and auth are not keywords');
});

test("one truth: transfer's embedded digest uses exactly the same SECRET and KEYVAL lines as boot.mjs", () => {
  const src = fs.readFileSync(BOOT, 'utf8');
  const skill = fs.readFileSync(new URL('../../transfer/SKILL.md', import.meta.url), 'utf8');
  const pick = (text, re) => { const m = text.match(re); assert.ok(m, `pattern block missing: ${re}`); return m[0].replace(/\s+/g, ' ').trim(); };
  const SECRET_RE = /const SECRET = \[[\s\S]*?\];/, KEYVAL_RE = /const KEYVAL = .*;/;
  assert.equal(pick(skill, SECRET_RE), pick(src, SECRET_RE));
  assert.equal(pick(skill, KEYVAL_RE), pick(src, KEYVAL_RE));
});
