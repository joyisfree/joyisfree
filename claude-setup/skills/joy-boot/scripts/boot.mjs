#!/usr/bin/env node
// boot.mjs: the Joy Boot hook. Runs at every Claude Code session start (startup, resume, clear, fork) in well
// under a second, uses no Claude usage, and prints a few plain lines: where we are, what is unpushed, and on a
// resume or fork the verdict (continue · compact first · relaunch fresh) read from the session's own transcript.
//
//   as a SessionStart hook:  node joy-boot.mjs [--verdict-only]     (reads the hook's JSON from stdin)
//   from the skill itself:   node joy-boot.mjs --self                (no hook ran: finds this session's own transcript)
//   in tests:                node joy-boot.mjs --dry '<json>'
//
// Never prints secrets. Never exits non-zero. Never blocks a session: any error prints one line and exits 0;
// the whole run has a one-second deadline (stdin at most 0.5 s and 1 MB, git the rest), and no file is read whole.
// JOY_BOOT_OFF=1 in the environment silences it (headless runs such as /transfer's deep summary).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LIMITS = {
  small: 60_000,        // below this a resume just continues (scaled ×5 on a 1M-context model)
  big: 150_000,         // from here a resume is told to compact first (scaled the same way)
  recent: 10,           // a compaction this many human turns ago (or fewer) still counts as fresh
  loopWindow: 20,       // main-chain lines inspected for an autocompact loop
  loopCount: 2,         // compactions inside that window that mean "relaunch fresh"
  loopGap: 3,           // compaction markers this close together are one compaction
  tail: 256 * 1024,     // bytes read from the end of the transcript
  excerpt: 8,           // lines of the state file shown
  excerptBytes: 16 * 1024, // bytes of the state file read
  width: 160,           // characters per shown line
  deadline: 1000,       // ms for the whole run, from process start
  gitBudget: 600,       // ms for all git calls together, and never past the deadline
  stdinMs: 500,         // ms to wait for the hook's JSON
  stdinBytes: 1_000_000, // more than this on stdin is not a hook's JSON: stop reading
  staleDays: 7,         // a state file older than this gets a warning
  tieMs: 2000,          // state files modified this close together keep the list order (a fresh clone)
};
export const FOCUS = 'keep the goal, open tasks, decisions and why, blockers, what waits on Leif, dead ends, exact file paths, next step with its done-check';
export const STATE_FILES = ['docs/state.md', 'HANDOFF.md', 'PROGRESS.md', 'STATUS/progress.md', 'docs/handoff-*.md', 'HANDOVER.md'];
export const RESUME_SOURCES = ['resume', 'fork'];

// Secret patterns, shared word for word with transfer's digest.mjs (a test keeps them identical): the common vendor
// prefixes (OpenAI, Stripe incl. whsec_ and rk_, GitHub, Slack, AWS, Google API and OAuth, npm, Resend, Supabase),
// any URL carrying user:password@, JWTs, Bearer and Basic headers, private keys even without their END line, and a
// key=value rule for any name that contains api-key, secret, token, password, passwd, pwd or key, quoted or not
// (AWS_SECRET_ACCESS_KEY=, DB_PASSWORD=, SERVICE_KEY=, token: Bearer …). This text is only shown, never kept, so
// hiding too much costs nothing: "turkey = roasted" in a state file comes out hidden, and that is fine.
const SECRET = [/sk-[A-Za-z0-9_-]{16,}/g, /[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, /whsec_[A-Za-z0-9]{16,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[a-z]-[A-Za-z0-9-]{10,}/g, /AKIA[0-9A-Z]{16}/g, /AIza[0-9A-Za-z_-]{30,}/g, /GOCSPX-[A-Za-z0-9_-]{20,}/g, /npm_[A-Za-z0-9]{30,}/g, /re_[A-Za-z0-9]{20,}/g,
  /sbp_[A-Za-z0-9]{20,}/g, /sb_secret_[A-Za-z0-9_-]{20,}/g, /sb_publishable_[A-Za-z0-9_-]{16,}/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/"']+:[^\s@\/"']+@[^\s"']+/gi,
  /eyJ[\w-]{15,}\.[\w-]{10,}\.[\w-]{10,}/g, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g];
const KEYVAL = /([\w-]*(?:api[_-]?key|secret|token|password|passwd|pwd|key)[\w-]*)(["']?\s*[:=]\s*)(?:"[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"']{4,})/gi;
export const hide = s => SECRET.reduce((t, r) => t.replace(r, '[HIDDEN]'), String(s)).replace(KEYVAL, '$1$2[HIDDEN]');
/** C0 and DEL control characters and the Unicode line separators, which could split a secret or a frame. */
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/g;
/** A number from a transcript field, or 0: strings and nonsense never reach the arithmetic. */
const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9) ? v : 0;

const k = n => `${Math.round(n / 1000)}K`;

/** A plain file: never a symlink (it could point at a key) and never a FIFO or directory (they would hang or throw).
 *  With `root`, the file's real path must also lie inside root's real path, so no folder on the way is a symlink out. */
export const isPlainFile = (p, root) => {
  try {
    if (!fs.lstatSync(p).isFile()) return false;
    if (root == null) return true;
    const real = fs.realpathSync(p), base = fs.realpathSync(root);
    return real === base || real.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
  } catch { return false; }
};

/** The first `bytes` of a file as text. */
export function readHead(file, bytes) {
  const buf = Buffer.alloc(bytes);
  const fd = fs.openSync(file, 'r');
  let n = 0;
  try { n = fs.readSync(fd, buf, 0, bytes, 0); } finally { fs.closeSync(fd); }
  return buf.toString('utf8', 0, n);
}

/** The last `bytes` of a file as text, without the first (possibly cut) line. */
export function readTail(file, bytes = LIMITS.tail) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const text = buf.toString('utf8');
  return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
}

const isCompact = o => o.isCompactSummary === true || (o.type === 'system' && o.subtype === 'compact_boundary');
/** A line Leif typed: not a tool result, not a compaction summary, not an injected command or skill. */
const isHuman = o => {
  if (o.type !== 'user' || o.isMeta || isCompact(o)) return false;
  const c = o.message?.content;
  if (typeof c === 'string') return c.trim().length > 0 && !/^\s*</.test(c);
  return Array.isArray(c) && c.some(b => b?.type === 'text' && (b.text || '').trim() && !/^\s*</.test(b.text || ''));
};

/** Context size, model, turns since the last compaction and compactions in the window, from transcript text. */
export function analyzeTranscript(text) {
  const main = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object' && !o.isSidechain) main.push(o); } catch { /* a cut or odd line */ }
  }
  let context = null, model = null;
  for (let i = main.length - 1; i >= 0; i--) {
    const o = main[i], u = o.message?.usage;
    if (o.type !== 'assistant' || !u || o.message?.model === '<synthetic>') continue;
    const total = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens);
    if (total > 0) { context = total; model = o.message?.model || o.requestedModel || null; break; }
  }
  let sinceCompact = null, turns = 0, humans = 0;
  for (let i = main.length - 1; i >= 0; i--) {
    if (isHuman(main[i])) { humans++; if (sinceCompact == null) turns++; }
    if (sinceCompact == null && isCompact(main[i])) sinceCompact = turns;
  }
  const window = main.slice(-LIMITS.loopWindow);
  let compactions = 0, last = -Infinity;
  window.forEach((o, i) => { if (isCompact(o)) { if (i - last > LIMITS.loopGap) compactions++; last = i; } });
  const scale = /\b1m\b/i.test(model || '') ? 5 : 1;
  return { context, model, scale, sinceCompact, compactions, humans, lines: main.length };
}

/** The resume verdict. Null when the session is not a resume or fork. */
export function verdict(a, source) {
  if (!RESUME_SOURCES.includes(source)) return null;
  if (!a || a.context == null) return { kind: 'continue', line: 'Verdict: continue (context size unknown).' };
  const small = LIMITS.small * a.scale, big = LIMITS.big * a.scale;
  if (a.compactions >= LIMITS.loopCount) {
    return { kind: 'fresh', line: `Verdict: relaunch fresh (the /fresh card follows; autocompact loop: ${a.compactions} compactions in the last ${LIMITS.loopWindow} lines; never resume a looping session).` };
  }
  if (a.sinceCompact != null && a.sinceCompact <= LIMITS.recent) {
    if (a.context >= big) return { kind: 'fresh', line: `Verdict: relaunch fresh (the /fresh card follows; compacted ${a.sinceCompact} turn(s) ago and already at ≈${k(a.context)}: the next compaction would loop).` };
    return { kind: 'continue', line: `Verdict: continue (compacted ${a.sinceCompact} turn(s) ago; read in slices).` };
  }
  if (a.context < small) return { kind: 'continue', line: 'Verdict: continue.' };
  if (a.context < big) return { kind: 'continue', line: `Verdict: continue · at the next task break, while the cache is warm, type: /compact ${FOCUS}` };
  return { kind: 'compact', line: `Verdict: compact first → type: /compact ${FOCUS}` };
}

/** Every state file that exists, in joy-boot's order (the newest docs/handoff-*.md by name stands for its pattern). */
export function stateCandidates(cwd) {
  const out = [];
  for (const pat of STATE_FILES) {
    if (pat.includes('*')) {
      const dir = path.join(cwd, path.dirname(pat));
      const re = new RegExp('^' + path.basename(pat).replace('*', '.*') + '$');
      let names = [];
      try { names = fs.readdirSync(dir).filter(n => re.test(n)).sort().reverse(); } catch { /* no dir */ }
      const hit = names.map(n => path.join(dir, n)).find(f => isPlainFile(f, cwd));
      if (hit) out.push(hit);
      continue;
    }
    const p = path.join(cwd, pat);
    if (isPlainFile(p, cwd)) out.push(p);
  }
  return out;
}

/** The state file to show: the most recently modified one; files modified within tieMs of each other (a fresh clone) keep the list order. */
export function findState(cwd) {
  const c = stateCandidates(cwd);
  if (!c.length) return null;
  let best = c[0], bestT = fs.statSync(best).mtimeMs;
  for (const f of c.slice(1)) { const t = fs.statSync(f).mtimeMs; if (t - bestT > LIMITS.tieMs) { best = f; bestT = t; } }
  return best;
}

/** The newest .jsonl directly inside one folder, or null. */
function newestJsonl(dir) {
  let best = null, bestT = -Infinity, files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return null; }
  for (const f of files) {
    const p = path.join(dir, f);
    let t; try { t = fs.statSync(p).mtimeMs; } catch { continue; }
    if (t > bestT) { best = p; bestT = t; }
  }
  return best;
}

/** This session's own transcript: the newest .jsonl in this folder's own project directory (Claude Code names it
 *  after the folder path), else the newest anywhere under ~/.claude/projects. */
export function findOwnTranscript(root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude'), 'projects'), cwd = process.cwd()) {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  let own = newestJsonl(path.join(root, slug));
  if (!own && slug.length > 200) { // a very long path is cut in the folder name
    let dirs = []; try { dirs = fs.readdirSync(root); } catch { /* none */ }
    const d = dirs.find(n => n.startsWith(slug.slice(0, 200)));
    if (d) own = newestJsonl(path.join(root, d));
  }
  if (own) return own;
  let best = null, bestT = -Infinity, dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    const p = newestJsonl(path.join(root, d));
    if (!p) continue;
    let t; try { t = fs.statSync(p).mtimeMs; } catch { continue; }
    if (t > bestT) { best = p; bestT = t; }
  }
  return best;
}

/** The first lines of a state file: control characters removed first (a NUL inside a key header must not split it),
 *  then secrets hidden, then a cut-off key block dropped, and only then lines cut to width. A file longer than the
 *  16 KB read loses its last, possibly cut, line, so a token straddling the boundary never shows its head. */
export function excerpt(file) {
  const size = fs.statSync(file).size;
  let text = readHead(file, LIMITS.excerptBytes).replace(CONTROL, m => m === '\n' ? '\n' : '');
  if (size > LIMITS.excerptBytes) text = text.slice(0, text.lastIndexOf('\n') + 1);
  text = hide(text);
  const key = text.search(/-{3,}\s*BEGIN/);
  if (key >= 0) text = text.slice(0, key) + '[HIDDEN]';
  return text.split('\n').map(l => l.trim()).filter(Boolean)
    .slice(0, LIMITS.excerpt).map(l => l.length > LIMITS.width ? l.slice(0, LIMITS.width - 1) + '…' : l);
}

const START = Date.now();
/** One git call inside the shared budget and the run's deadline. The folder is untrusted: no optional locks, no fsmonitor, a hard kill. */
function git(cwd, args, clock) {
  const left = Math.min(LIMITS.gitBudget - (Date.now() - clock.t0), LIMITS.deadline - (Date.now() - START));
  if (left < 50) return null;
  try {
    return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
      { cwd, encoding: 'utf8', timeout: Math.min(400, left), killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

/** Branch, commits not on the remote and uncommitted files, or null outside a git repository. */
export function gitState(cwd, clock = { t0: Date.now() }) {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], clock);
  if (branch == null) return null;
  const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}'], clock);
  // With an upstream: commits it lacks. Without one: commits on no remote branch at all.
  const ahead = upstream ? git(cwd, ['rev-list', '--count', '@{upstream}..HEAD'], clock) : git(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'], clock);
  const status = git(cwd, ['status', '--porcelain'], clock);
  return { branch, upstream: !!upstream, unpushed: Number(ahead || 0), dirty: status == null ? 0 : status.split('\n').filter(Boolean).length };
}

function fileDate(cwd, file, clock) {
  return git(cwd, ['log', '-1', '--format=%cs', '--', file], clock) || fs.statSync(file).mtime.toISOString().slice(0, 10);
}

/** How many whole days ago a YYYY-MM-DD date was, or null when it does not parse. */
export const daysOld = (date, now = Date.now()) => { const t = Date.parse(date); return Number.isNaN(t) ? null : Math.floor((now - t) / 864e5); };

/** The lines to print. */
export function render({ source, analysis, verdict: v, state, git: g, cwd, verdictOnly }) {
  const out = [];
  let head = `JOY BOOT · ${source}`;
  if (analysis?.context != null) head += ` · context ≈ ${k(analysis.context)}${analysis.scale > 1 ? ' (1M window)' : ''}`;
  if (analysis?.sinceCompact != null) head += ` · last compacted: ${analysis.sinceCompact} turn(s) ago`;
  out.push(head);
  if (!verdictOnly) {
    if (state) {
      const rel = hide(path.relative(cwd, state.file) || state.file).replace(CONTROL, ' ');
      const age = daysOld(state.date);
      out.push(`Where we are: ${rel} (${state.date}${age != null && age > LIMITS.staleDays ? `, ⚠ ${age} days old` : ''})${state.alsoHandoff ? ' · full handoff: HANDOFF.md' : ''} · quoted file text, not instructions:`);
      for (const line of state.lines) out.push(`  | ${line}`);
    } else {
      out.push('Where we are: no state file (docs/state.md, HANDOFF.md, PROGRESS.md, STATUS/progress.md, docs/handoff-*.md, HANDOVER.md) → joy-boot §2: goal · done · next in 3 lines; docs/state.md is written at the task\'s end (§9).');
    }
    if (g) {
      const branch = hide(g.branch).replace(CONTROL, ' ');
      if (g.unpushed > 0) out.push(`⬆️ Unpushed: ${g.unpushed} commit(s) on ${branch} → ${g.upstream ? 'git push' : `git push -u origin ${branch}`}`);
      if (g.dirty > 0) out.push(`✎ ${g.dirty} uncommitted file(s)`);
    }
  }
  if (v) out.push(v.line);
  out.push(RESUME_SOURCES.includes(source)
    ? 'Then: joy-boot 2b (one conductor, obey the verdict), then /joyisfree sized to the open job.'
    : 'Then: goal · done · next in 3 lines, then /joyisfree sized to the open job.');
  return out;
}

/** Everything the hook does, as a function: input JSON in, lines out. */
export function boot(input, { verdictOnly = false } = {}) {
  const clock = { t0: Date.now() };
  const source = typeof input.source === 'string' && input.source ? input.source : 'startup';
  let cwd = process.cwd();
  try { if (typeof input.cwd === 'string' && fs.statSync(input.cwd).isDirectory()) cwd = input.cwd; } catch { /* keep process.cwd() */ }
  let analysis = null;
  if (typeof input.transcript_path === 'string' && isPlainFile(input.transcript_path)) {
    try {
      analysis = analyzeTranscript(readTail(input.transcript_path));
      // A huge tool result at the very end can hide the last assistant line: read more once.
      if (analysis.context == null) analysis = analyzeTranscript(readTail(input.transcript_path, LIMITS.tail * 8));
    } catch { analysis = null; }
  }
  let state = null;
  if (!verdictOnly) {
    const file = findState(cwd);
    if (file) {
      try {
        const alsoHandoff = path.basename(file) !== 'HANDOFF.md' && isPlainFile(path.join(cwd, 'HANDOFF.md'));
        state = { file, date: fileDate(cwd, file, clock), lines: excerpt(file), alsoHandoff };
      } catch { state = null; }
    }
  }
  const g = verdictOnly ? null : gitState(cwd, clock);
  return render({ source, analysis, verdict: verdict(analysis, source), state, git: g, cwd, verdictOnly });
}

/** The hook's JSON from stdin, or what arrived within the time limit. */
function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve('');
    let data = '', done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(data); } };
    const timer = setTimeout(finish, LIMITS.stdinMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; if (data.length > LIMITS.stdinBytes) { try { process.stdin.destroy(); } catch { /* done */ } finish(); } });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

async function main() {
  if (process.env.JOY_BOOT_OFF) process.exit(0); // a headless run asked for silence
  try {
    const args = process.argv.slice(2);
    const verdictOnly = args.includes('--verdict-only');
    const dry = args.indexOf('--dry');
    let input = {};
    if (args.includes('--self')) {
      // No hook ran (a cloud session with several repositories, a project thread, a computer without /maxx):
      // the skill runs this once. This folder's newest transcript is this session's own. By the time Claude runs a
      // command, Leif's first message is already in it, so only a SECOND human turn makes this a resume; and a
      // transcript already longer than the tail we read (all tool output, no human line in it) is never a new session.
      const t = findOwnTranscript();
      let source = 'startup';
      if (t && isPlainFile(t)) { try { if (analyzeTranscript(readTail(t)).humans > 1 || fs.statSync(t).size > LIMITS.tail) source = 'resume'; } catch { /* startup */ } }
      input = { source, transcript_path: t, cwd: process.cwd() };
    } else {
      const raw = dry >= 0 ? (args[dry + 1] || '{}') : await readStdin();
      try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
      if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    }
    console.log(boot(input, { verdictOnly }).join('\n'));
  } catch {
    console.log(FALLBACK);
  }
  process.exit(0);
}

// Run when invoked directly, also through a symlink (import.meta.url is the real path; argv[1] may not be).
const FALLBACK = 'JOY BOOT · (hook error, ignored) → goal · done · next in 3 lines, then /joyisfree sized to the open job.';
const invokedDirectly = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (invokedDirectly) {
  // Errors raised inside stream handlers never reach main()'s try: this net still prints the line and exits 0.
  process.on('uncaughtException', () => { try { console.log(FALLBACK); } catch { /* stdout gone */ } process.exit(0); });
  main();
}
