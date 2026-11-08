// `npm run prove` is the repo's one "is it true?" command, and each of its checks is itself a guard, so each is shown
// to catch what it should: on fixture repos in temp dirs, with a fixed clock and a stand-in for git, never the real
// repo, the real studio or the machine's own clock.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BIP39_WORDS, CHECKS, KNOWN_FAKES, LEIF_PAGES, SECRET_SHAPES, SEED_WORDS,
  bip39Intact, dayNumber, decisions, facts, firstInstruction, historyLines, leifPages, lineCount, markOf, runChecks,
  secretHits, secretKinds, secrets, state, studio, studioVerdict, sydneyDay, terminalSteps, withoutKnownFakes,
} from './prove.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
/** A temp dir this run removes when it ends. */
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };
const line = (text, where = 'f:1') => ({ where, text });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// The fixtures are assembled at runtime from pieces, so this file's own source never contains a secret shape and
// `npm run prove`'s scan of the repo stays clean. 8 Nov 2026: written as literals, they made prove flag itself, and
// two of those literals are still in history (KNOWN_FAKES).
const j = (...parts) => parts.join('');

// Fixed pseudo-random characters, so a fixture looks like a real key (mixed case and digits) and never changes.
function chars(alphabet, n, seed) {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out += alphabet[(s >>> 16) % alphabet.length];
  }
  return out;
}
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = UPPER.toLowerCase();
const DIGITS = '0123456789';
const ALNUM = UPPER + LOWER + DIGITS;
const HEX = DIGITS + 'abcdef';
const B58 = ALNUM.replace(/[0OIl]/g, '');
const B64 = ALNUM + '+/';
const URLSAFE = ALNUM + '_-';
/** n BIP39 words spread over the list, starting from a different place for each `from`. */
const seedWords = (n, from = 0) => Array.from({ length: n }, (_, i) => BIP39_WORDS[(i * 173 + from * 31) % 2048]);
const JWT_HEAD = j('ey', 'J', 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');

// ------------------------------------------------------------------------------------------------- secret shapes

// The thirteen shapes the 8 Nov task named.
const TASK_SHAPES = [
  ['bip39-seed', seedWords(12).join(' ')],
  ['labelled-hex-key', j('PRIVATE', '_KEY=', chars(HEX, 64, 1))],
  ['private-key-pem', j('-----BEGIN ', 'EC PRIVATE', ' KEY-----')],
  ['jwt', j('Authorization: Bearer ', JWT_HEAD, '.', 'ey', 'J', chars(URLSAFE, 40, 2), '.', chars(URLSAFE, 43, 3))],
  ['stripe', j('const k = "', 'sk', '_live_', chars(ALNUM, 24, 4), '"')],
  ['github', j('token: ', 'gh', 'p_', chars(ALNUM, 36, 5))],
  ['slack', j('SLACK=', 'xo', 'xb-', chars(DIGITS, 12, 6), '-', chars(DIGITS, 13, 7), '-', chars(ALNUM, 24, 8))],
  ['aws-access-key-id', j('AK', 'IA', chars(UPPER + DIGITS, 16, 9))],
  ['aws-secret-key', j('aws_secret', '_access_key = ', chars(B64, 40, 10))],
  ['google-api-key', j('key=', 'AI', 'za', chars(URLSAFE, 35, 11))],
  ['shopify', j('shp', 'at_', chars(HEX, 32, 12))],
  ['klaviyo', j('KLAVIYO=', 'pk', '_', chars(LOWER + DIGITS, 34, 13))],
  ['labelled-secret', j('api', '_key=', chars(ALNUM, 32, 14))],
];

// The thirteen samples the 8 Nov audit missed with the old scanner (it caught none of them).
const AUDIT_SHAPES = [
  ['bip39-seed', seedWords(12, 5).join(' ')],
  ['labelled-seed', j('seed', ' phrase: ', [...seedWords(10, 9), 'qwertz', 'zyxwv'].join(' '))],
  ['labelled-hex-key', j('wallet private', ' key: ', chars(HEX, 64, 15))],
  ['solana-base58-key', j('solana: ', chars(B58, 88, 16))],
  ['x-session-cookie', j('cookie: auth', '_token=', chars(HEX, 40, 17))],
  ['anthropic', j('sk', '-ant-', 'api03-', chars(URLSAFE, 93, 18))],
  ['openai', j('sk', '-proj-', chars(URLSAFE, 48, 19))],
  ['shopify', j('shp', 'ss_', chars(HEX, 32, 20))],
  ['klaviyo', j('pk', '_', chars(LOWER + DIGITS, 34, 21))],
  ['stripe', j('rk', '_live_', chars(ALNUM, 24, 22))],
  ['jwt', j('SUPABASE_SERVICE_ROLE=', JWT_HEAD, '.', 'ey', 'J', 'pc3MiOiJzdXBhYmFzZSIs', chars(URLSAFE, 60, 23), '.', chars(URLSAFE, 43, 24))],
  ['cloudinary-url', j('CLOUDINARY_URL=cloud', 'inary://', chars(DIGITS, 15, 25), ':', chars(URLSAFE, 27, 26), '@joyisfree')],
  ['labelled-secret', j('VERCEL', '_TOKEN=', chars(ALNUM, 24, 27))],
];

// The rest of the list, so every shape has a fixture of its own.
const MORE_SHAPES = [
  ['github', j('gith', 'ub_pat_', chars(ALNUM + '_', 82, 28))],
  ['slack', j('https://hooks.', 'slack.com/services/', 'T', chars(UPPER + DIGITS, 8, 29), '/B', chars(UPPER + DIGITS, 10, 30), '/', chars(ALNUM, 24, 31))],
  ['supabase-secret', j('sb', '_secret_', chars(URLSAFE, 32, 32))],
  ['keypair-byte-array', `[${Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256).join(',')}]`],
  ['0x-hex-key', j('wallet key ', '0', 'x', chars(HEX, 64, 33))],
  ['aws-access-key-id', j('AS', 'IA', chars(UPPER + DIGITS, 16, 34))],
  ['stripe', j('sk', '_test_', chars(ALNUM, 24, 35))],
  ['private-key-pem', j('-----BEGIN OPENSSH ', 'PRIVATE', ' KEY-----')],
  ['private-key-pem', j('-----BEGIN PGP ', 'PRIVATE', ' KEY BLOCK-----')],
  ['bip39-seed', j('1.', seedWords(12, 2).join(' 2.'))],
  ['bip39-seed', seedWords(12, 3).join(',')],
  ['bip39-seed', JSON.stringify({ words: seedWords(12, 4).map((w) => w.toUpperCase()) })],
];

test('13 of 13 of the shapes the task named are caught, each by its own name', () => {
  assert.equal(TASK_SHAPES.length, 13);
  for (const [kind, t] of TASK_SHAPES) assert.ok(secretKinds(t).includes(kind), `${kind} missed`);
});

test('13 of 13 of the samples the audit found missed are caught, each by its own name', () => {
  assert.equal(AUDIT_SHAPES.length, 13);
  for (const [kind, t] of AUDIT_SHAPES) assert.ok(secretKinds(t).includes(kind), `${kind} missed`);
});

test('the other spellings are caught too: github_pat_, Slack webhooks, sb_secret_, keypair files, ASIA, sk_test_, PGP, numbered seeds', () => {
  for (const [kind, t] of MORE_SHAPES) assert.ok(secretKinds(t).includes(kind), `${kind} missed in fixture ${MORE_SHAPES.findIndex((m) => m[1] === t)}`);
});

test('every shape on the one list has a fixture named for it, and no shape is a stateful /g or /y regex', () => {
  const named = new Set([...TASK_SHAPES, ...AUDIT_SHAPES, ...MORE_SHAPES].map(([kind]) => kind));
  for (const { name, re } of SECRET_SHAPES) {
    assert.ok(named.has(name), `${name} has no fixture`);
    assert.ok(!re.global && !re.sticky, `${name} would skip lines with lastIndex`);
  }
  assert.ok(named.has('0x-hex-key') && named.has('bip39-seed'));
});

test('a hit names where and which shape, as many lines as hold one, never the secret text itself', () => {
  const secret = AUDIT_SHAPES[6][1];
  const hits = secretHits([line('fine', 'a.md:1'), line(secret, 'a.md:2'), line('fine too', 'a.md:3')]);
  assert.deepEqual(hits, [{ where: 'a.md:2', kinds: ['openai'] }]);
  assert.ok(!JSON.stringify(hits).includes(secret.slice(8)));
});

test('ordinary text, prefixes, checksums, env-var names and short passwords are not flagged', () => {
  for (const t of [
    'the gate refuses unknowns',
    'sk_ is a prefix, not a key',
    j('pk', '_live_', chars(ALNUM, 24, 40)), // Stripe publishable keys are public by design
    j('sha256: ', chars(HEX, 64, 41)), // a checksum is not a key
    j('commit ', chars(HEX, 40, 42)),
    'the gift guide goes out to every past buyer on the list before the cut-off',
    seedWords(SEED_WORDS - 1).join(' '),
    'const seed = 42; seed: 7',
    'token: process.env.SHOPIFY_TOKEN',
    'password: hunter2',
    'No keys, seed phrases, API tokens or session cookies in any file, log or commit.',
    `[GP-25](https://dao.galxe.com/#/proposal/0x${'8d3f'.repeat(16)})`,
  ]) assert.deepEqual(secretKinds(t), [], t);
});

test('a 0x key on the same line as an allowed DAO URL is still caught; the URL alone is not', () => {
  const url = `https://dao.galxe.com/#/proposal/0x${'a'.repeat(64)}`;
  assert.deepEqual(secretKinds(url), []);
  assert.deepEqual(secretKinds(`${url} and also 0x${chars(HEX, 64, 43)}`), ['0x-hex-key']);
});

test('prove.mjs and this file do not flag themselves, the BIP39 list included', () => {
  for (const f of ['prove.mjs', 'prove.test.mjs']) {
    const lines = readFileSync(join(HERE, f), 'utf8').split('\n').map((text, i) => line(text, `${f}:${i + 1}`));
    assert.deepEqual(secretHits(lines), [], f);
  }
});

// ---------------------------------------------------------------------------------------------------- seed phrase

test('the BIP39 list is the published one: 2048 words, in order, unique in their first four letters, hash pinned', () => {
  assert.equal(BIP39_WORDS.length, 2048);
  assert.equal(BIP39_WORDS[0], 'abandon');
  assert.equal(BIP39_WORDS[2047], 'zoo');
  assert.deepEqual([...BIP39_WORDS].sort(), BIP39_WORDS);
  assert.equal(new Set(BIP39_WORDS.map((w) => w.slice(0, 4))).size, 2048);
  assert.equal(bip39Intact(BIP39_WORDS), true);
});

test('a list with one word changed, dropped or added is not the published one', () => {
  const swapped = [...BIP39_WORDS];
  swapped[1000] = 'joyisfree';
  assert.equal(bip39Intact(swapped), false);
  assert.equal(bip39Intact(BIP39_WORDS.slice(1)), false);
  assert.equal(bip39Intact([...BIP39_WORDS, 'extra']), false);
  assert.equal(bip39Intact('abandon'), false);
});

test('12 seed words on one line are a seed, 11 are not', () => {
  assert.ok(secretKinds(seedWords(SEED_WORDS, 7).join(' ')).includes('bip39-seed'));
  assert.ok(!secretKinds(seedWords(SEED_WORDS - 1, 7).join(' ')).includes('bip39-seed'));
});

test('a seed written down a page is caught: one word to a line, numbered, or four to a line', () => {
  const words = seedWords(SEED_WORDS, 8);
  const oneEach = words.map((w, i) => line(`${i + 1}. ${w}`, `backup.txt:${i + 3}`));
  assert.deepEqual(secretHits(oneEach), [{ where: 'backup.txt:3', kinds: ['bip39-seed'] }]);
  const rows = [0, 4, 8].map((k, i) => line(words.slice(k, k + 4).join('  '), `wallet.md:${i + 1}`));
  assert.deepEqual(secretHits(rows), [{ where: 'wallet.md:1', kinds: ['bip39-seed'] }]);
  const bullets = words.map((w, i) => line(`- "${w}",`, `seed.json:${i + 1}`));
  assert.equal(secretHits(bullets).length, 1);
});

test('rows of seed words are not joined across a prose line, a gap, or two files', () => {
  const words = seedWords(SEED_WORDS, 9);
  const half = (k, file, start) => words.slice(k, k + 6).map((w, i) => line(w, `${file}:${start + i}`));
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), line('and the rest is prose', 'a.md:7'), ...half(6, 'a.md', 8)]), []);
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), ...half(6, 'a.md', 9)]), []);
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), ...half(6, 'b.md', 7)]), []);
  assert.deepEqual(secretHits(words.slice(0, SEED_WORDS - 1).map((w, i) => line(w, `a.md:${i + 1}`))), []);
});

test('one seed on one line is reported once, not again as rows', () => {
  assert.deepEqual(secretHits([line(seedWords(SEED_WORDS, 10).join(' '), 'x.txt:4'), line(BIP39_WORDS[5], 'x.txt:5')]), [{ where: 'x.txt:4', kinds: ['bip39-seed'] }]);
});

// --------------------------------------------------------------------------------------------- history, then the check

const LOG = [
  `commit ${'1'.repeat(40)}`,
  'Author: Claude <noreply@example.com>',
  'Date:   Sun Nov 8 05:00:00 2026 +0000',
  '',
  '    the first commit',
  '',
  'diff --git a/notes.txt b/notes.txt',
  'new file mode 100644',
  'index 0000000..1111111',
  '--- /dev/null',
  '+++ b/notes.txt',
  '@@ -0,0 +1,3 @@',
  '+hello',
  '+++ b/looks-like-a-header.txt',
  '+third',
  `commit ${'2'.repeat(40)}`,
  'Author: Claude <noreply@example.com>',
  'Date:   Sun Nov 8 06:00:00 2026 +0000',
  '',
  '    the second commit',
  '',
  'diff --git a/notes.txt b/notes.txt',
  'index 1111111..2222222 100644',
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -1,3 +1,3 @@',
  ' hello',
  '-++ b/looks-like-a-header.txt',
  '+changed',
  ' third',
  '\\ No newline at end of file',
  '',
].join('\n');

/** One more commit that adds `text` to old.txt, or puts it in the message. */
const withCommit = (log, sha, text, { inMessage = false } = {}) => [
  log.trimEnd(),
  `commit ${sha.repeat(40)}`,
  'Author: Claude <noreply@example.com>',
  '',
  `    ${inMessage ? text : 'a later commit'}`,
  '',
  'diff --git a/old.txt b/old.txt',
  '--- /dev/null',
  '+++ b/old.txt',
  '@@ -0,0 +1 @@',
  `+${inMessage ? 'nothing to see' : text}`,
  '',
].join('\n');

test('history is read as every added line and every message line, with commit, path and line', () => {
  const { lines, commits, added } = historyLines(LOG);
  assert.equal(commits, 2);
  assert.equal(added, 4);
  assert.deepEqual(lines, [
    { where: '1111111:message:1', text: 'the first commit' },
    { where: '1111111:notes.txt:1', text: 'hello' },
    { where: '1111111:notes.txt:2', text: '++ b/looks-like-a-header.txt' },
    { where: '1111111:notes.txt:3', text: 'third' },
    { where: '2222222:message:1', text: 'the second commit' },
    { where: '2222222:notes.txt:2', text: 'changed' },
  ]);
});

/** A fixture repo: each key a path, each value its text. */
function repo(files) {
  const root = tempDir('prove-');
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

/** A stand-in for git that answers ls-files and log, and records what it was asked. */
function scanGit({ files = ['a.txt'], log = LOG, lsFails = false, logFails = false } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'ls-files') {
      if (lsFails) throw new Error('fatal: not a git repository');
      return files.map((f) => `${f}\0`).join('');
    }
    if (args[0] === 'log') {
      if (logFails) throw new Error('fatal: your current branch does not have any commits yet');
      return log;
    }
    throw new Error(`no stand-in for git ${args.join(' ')}`);
  };
  return { git, calls };
}

const clean = () => repo({ 'a.txt': 'nothing secret here\n', 'b/c.md': '# notes\n' });

test('secrets: a clean tree and a clean history pass, and the scan asks git for untracked files and all of history', () => {
  const { git, calls } = scanGit({ files: ['a.txt', 'b/c.md'] });
  const r = secrets({ root: clean(), git });
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /2 file\(s\) in the tree and 6 committed line\(s\) over 2 commit\(s\)/);
  const [ls, log] = calls;
  for (const a of ['--cached', '--others', '--exclude-standard']) assert.ok(ls.includes(a), a);
  for (const a of ['-p', '--all', '--dst-prefix=b/']) assert.ok(log.includes(a), a);
});

test('secrets: a secret in the tree fails, naming the file, the line and the shape, not the secret', () => {
  const secret = TASK_SHAPES[4][1];
  const root = repo({ 'a.txt': `fine\n${secret}\n` });
  const r = secrets({ root, git: scanGit().git });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /a\.txt:2 \(stripe\)/);
  assert.ok(!r.detail.includes(secret.slice(12)));
});

test('secrets: a secret only in history fails, by commit, path and line', () => {
  const r = secrets({ root: clean(), git: scanGit({ log: withCommit(LOG, '3', TASK_SHAPES[5][1]) }).git });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /3333333:old\.txt:1 \(github/);
});

test('secrets: a secret in a commit message fails', () => {
  const r = secrets({ root: clean(), git: scanGit({ log: withCommit(LOG, '4', AUDIT_SHAPES[5][1], { inMessage: true }) }).git });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /4444444:message:1 \(anthropic/);
});

test('secrets: unread is never clean (git fails, no commit, no file read, a path that cannot be read)', () => {
  assert.match(secrets({ root: clean(), git: scanGit({ lsFails: true }).git }).detail, /tree was not read/);
  assert.equal(secrets({ root: clean(), git: scanGit({ lsFails: true }).git }).status, 'FAIL');
  assert.match(secrets({ root: clean(), git: scanGit({ logFails: true }).git }).detail, /history was not read/);
  assert.equal(secrets({ root: clean(), git: scanGit({ logFails: true }).git }).status, 'FAIL');
  assert.match(secrets({ root: clean(), git: scanGit({ log: '' }).git }).detail, /no commit/);
  const messagesOnly = LOG.split('\n').filter((l) => !/^[+@ -]|^diff|^\\/.test(l) || l.startsWith('    ')).join('\n');
  assert.match(secrets({ root: clean(), git: scanGit({ log: messagesOnly }).git }).detail, /no added line/);
  assert.match(secrets({ root: clean(), git: scanGit({ files: ['gone.txt'] }).git }).detail, /no file was read/);
  const root = clean();
  mkdirSync(join(root, 'sub'));
  const r = secrets({ root, git: scanGit({ files: ['a.txt', 'sub'] }).git });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /could not read sub/);
});

test('secrets: a BIP39 list that is not the published one fails the whole check closed', () => {
  const swapped = [...BIP39_WORDS];
  swapped[7] = 'joyisfree';
  const r = secrets({ root: clean(), git: scanGit().git, words: swapped });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /BIP39/);
});

test('a known fake in history is let through only at its commit, path and line, and only with its exact text', () => {
  const fake = TASK_SHAPES[7][1];
  const fakes = [{ where: '5555555:old.txt:1', sha256: sha256(fake) }];
  const pass = secrets({ root: clean(), git: scanGit({ log: withCommit(LOG, '5', fake) }).git, fakes });
  assert.equal(pass.status, 'PASS', pass.detail);
  assert.match(pass.detail, /1 known fake/);
  assert.equal(secrets({ root: clean(), git: scanGit({ log: withCommit(LOG, '6', fake) }).git, fakes }).status, 'FAIL');
  const other = j('AK', 'IA', chars(UPPER + DIGITS, 16, 44));
  assert.equal(secrets({ root: clean(), git: scanGit({ log: withCommit(LOG, '5', other) }).git, fakes }).status, 'FAIL');
  const kept = withoutKnownFakes([line(fake, '5555555:old.txt:1'), line(fake, '5555555:old.txt:2')], fakes);
  assert.equal(kept.allowed, 1);
  assert.deepEqual(kept.lines.map((l) => l.text === ''), [true, false]);
});

test('the two pinned fakes are the first prove.test.mjs lines exactly, and each would be caught without its pin', () => {
  const texts = [j("    '-----BEGIN OPENSSH ", 'PRIVATE', " KEY-----',"), j("    '", 'AK', 'IA', 'ABCDEFGHIJKLMNOP', "',")];
  assert.deepEqual(KNOWN_FAKES.map((f) => f.sha256), texts.map(sha256));
  for (const t of texts) assert.equal(secretKinds(t).length, 1, t);
});

// ----------------------------------------------------------------------------------------------------------- studio

const studioDir = () => {
  const d = tempDir('studio-');
  mkdirSync(join(d, '.git'));
  return d;
};

/** A stand-in for git inside the studio. It answers for-each-ref only with the ref families it was asked for. */
function studioGit(dir, { branch = 'main', head = 'abc1234', dirty = '', refs = ['refs/heads/main', 'refs/remotes/origin/main'] } = {}) {
  return (args) => {
    assert.deepEqual(args.slice(0, 2), ['-C', dir]);
    const [cmd, ...rest] = args.slice(2);
    if (cmd === 'rev-parse' && rest.includes('--abbrev-ref')) return `${branch}\n`;
    if (cmd === 'rev-parse' && rest.includes('--short')) return `${head}\n`;
    if (cmd === 'status') return dirty;
    if (cmd === 'for-each-ref') return refs.filter((r) => rest.some((p) => r.startsWith(`${p}/`))).join('\n');
    throw new Error(`no stand-in for git ${cmd}`);
  };
}

test('studio: absent is a NOTE, never a PASS', () => {
  const r = studio({ studio: join(tmpdir(), 'no-such-studio-here'), git: () => { throw new Error('not called'); } });
  assert.equal(r.status, 'NOTE');
  assert.match(r.detail, /not a pass/);
  assert.equal(studioVerdict({ present: false }).status, 'NOTE');
});

test('studio: clean, with no claude/galxe-* branch, passes and says where its HEAD is', () => {
  const dir = studioDir();
  const r = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/main', 'refs/heads/next', 'refs/heads/claude/studio-fix', 'refs/remotes/origin/main'] }) });
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /HEAD abc1234 on main/);
});

test('studio: a claude/galxe-* branch fails, local or only on the remote', () => {
  const dir = studioDir();
  const local = studio({ studio: dir, git: studioGit(dir, { branch: 'claude/galxe-x', refs: ['refs/heads/main', 'refs/heads/claude/galxe-x'] }) });
  assert.equal(local.status, 'FAIL');
  assert.match(local.detail, /refs\/heads\/claude\/galxe-x/);
  const remote = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/main', 'refs/remotes/origin/claude/galxe-automation-strategy-770t1f'] }) });
  assert.equal(remote.status, 'FAIL');
  assert.match(remote.detail, /refs\/remotes\/origin\/claude\/galxe-automation-strategy-770t1f/);
});

test('studio: uncommitted changes fail as "cause unknown", and a git error fails', () => {
  const dir = studioDir();
  const dirty = studio({ studio: dir, git: studioGit(dir, { dirty: ' M src/App.tsx\n' }) });
  assert.equal(dirty.status, 'FAIL');
  assert.match(dirty.detail, /cause unknown: M src\/App\.tsx/);
  assert.equal(studio({ studio: dir, git: () => { throw new Error('fatal: bad object HEAD'); } }).status, 'FAIL');
});

// -------------------------------------------------------------------------------------------------------- the clock

const NOW = Date.parse('2026-11-08T03:00:00Z'); // 2 pm on Sunday 8 Nov in Sydney
const noGit = () => { throw new Error('this check must not call git'); };
const at = (root, now = NOW) => ({ root, now, git: noGit });

test('sydneyDay is the date in Sydney, not in UTC, in summer time and in winter', () => {
  assert.equal(sydneyDay(NOW), '2026-11-08');
  assert.equal(sydneyDay(Date.parse('2026-11-07T13:30:00Z')), '2026-11-08'); // 00:30 on the 8th in Sydney, the 7th in UTC
  assert.equal(sydneyDay(Date.parse('2026-11-07T12:59:00Z')), '2026-11-07');
  assert.equal(sydneyDay(Date.parse('2026-07-01T13:59:00Z')), '2026-07-01');
  assert.equal(sydneyDay(Date.parse('2026-07-01T14:00:00Z')), '2026-07-02');
  assert.throws(() => sydneyDay(NaN));
});

test('dayNumber takes only a real YYYY-MM-DD', () => {
  assert.equal(dayNumber('2026-11-08') - dayNumber('2026-11-07'), 1);
  for (const v of ['2026-11-8', '8/11/2026', '2026-02-30', '2026-11-08T00:00:00Z', 20261108, '', null, undefined, 'Nov 8']) assert.equal(dayNumber(v), null, String(v));
});

// -------------------------------------------------------------------------------------------------------- decisions

const item = (o = {}) => ({ id: 'D1', date: '2026-11-15', what: 'Approve the three drafts as pre-filled', whose: 'Leif', kind: 'decision', status: 'open', lapsesIf: 'not answered at the 15 Nov sitting', ...o });
const calendar = (content) => repo({ 'agency/calendar.json': typeof content === 'string' ? content : JSON.stringify(content) });

test('decisions: open items dated today or later pass, and the soonest is named', () => {
  const r = decisions(at(calendar([item({ id: 'D2', date: '2026-11-20' }), item({ id: 'D1', date: '2026-11-08' }), item({ id: 'old', date: '2026-11-01', status: 'decided' })])));
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /2 open, none lapsed; next D1 by 2026-11-08/);
});

test('decisions: an open item dated before today in Sydney fails, by id and date', () => {
  const r = decisions(at(calendar([item(), item({ id: '#9', date: '2026-11-07' })])));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /LAPSED.*#9 \(was 2026-11-07\)/);
});

test('decisions: the day turns at midnight in Sydney, hours before it does in UTC', () => {
  const root = calendar([item({ date: '2026-11-07' })]);
  assert.equal(decisions(at(root, Date.parse('2026-11-07T12:59:00Z'))).status, 'PASS');
  assert.equal(decisions(at(root, Date.parse('2026-11-07T13:30:00Z'))).status, 'FAIL');
});

test('decisions: past items already decided or recorded as lapsed do not fail', () => {
  assert.equal(decisions(at(calendar([item({ date: '2026-11-01', status: 'decided' }), item({ id: '#9', date: '2026-11-07', status: 'lapsed' })]))).status, 'PASS');
});

test('decisions: a missing, unreadable, empty or misshapen calendar fails', () => {
  assert.match(decisions(at(repo({}))).detail, /missing/);
  assert.match(decisions(at(calendar('{ not json'))).detail, /not valid JSON/);
  assert.match(decisions(at(calendar({ items: [] }))).detail, /array/);
  assert.match(decisions(at(calendar([]))).detail, /empty/);
  for (const f of ['id', 'what', 'whose', 'lapsesIf']) {
    const r = decisions(at(calendar([item({ [f]: '  ' })])));
    assert.equal(r.status, 'FAIL', f);
    assert.match(r.detail, new RegExp(`has no ${f}`));
  }
  for (const date of ['2026-11-9', '9/11/2026', '2026-02-30', 20261115, undefined]) assert.match(decisions(at(calendar([item({ date })]))).detail, /not a real YYYY-MM-DD/, String(date));
  assert.match(decisions(at(calendar([item({ kind: 'deadline' })]))).detail, /kind/);
  assert.match(decisions(at(calendar([item({ status: 'pending' })]))).detail, /status/);
  assert.match(decisions(at(calendar([item(), item()]))).detail, /repeats an id/);
  assert.match(decisions(at(calendar([item(), 'D2']))).detail, /not an object/);
});

// ------------------------------------------------------------------------------------------------------------ state

const STATE_15 = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const CLAUDE_OK = '# Joyisfree: orientation for Claude\n\n<!-- read me first -->\nStart with [`docs/state.md`](./docs/state.md), then the rest.\n';

test('state: 15 lines or fewer, named by CLAUDE.md\'s first instruction, passes', () => {
  const r = state(at(repo({ 'docs/state.md': STATE_15, 'CLAUDE.md': CLAUDE_OK })));
  assert.equal(r.status, 'PASS', r.detail);
  assert.equal(state(at(repo({ 'docs/state.md': STATE_15.trimEnd(), 'CLAUDE.md': CLAUDE_OK }))).status, 'PASS');
});

test('state: 16 lines, a missing or empty file, or no CLAUDE.md fails', () => {
  assert.match(state(at(repo({ 'docs/state.md': `${STATE_15}one more\n`, 'CLAUDE.md': CLAUDE_OK }))).detail, /16 lines, over 15/);
  assert.match(state(at(repo({ 'CLAUDE.md': CLAUDE_OK }))).detail, /missing/);
  assert.match(state(at(repo({ 'docs/state.md': '', 'CLAUDE.md': CLAUDE_OK }))).detail, /empty/);
  assert.match(state(at(repo({ 'docs/state.md': STATE_15 }))).detail, /CLAUDE\.md is missing/);
});

test('state: galxe-desk/docs/state.md is not the root one, and a pointer below the first instruction does not count', () => {
  const galxe = '# Title\n\nStart with [`galxe-desk/README.md`](./galxe-desk/README.md) and `galxe-desk/docs/state.md`.\n';
  assert.equal(state(at(repo({ 'docs/state.md': STATE_15, 'CLAUDE.md': galxe }))).status, 'FAIL');
  const second = '# Title\n\nRead the README first.\nThen `docs/state.md`.\n';
  assert.equal(state(at(repo({ 'docs/state.md': STATE_15, 'CLAUDE.md': second }))).status, 'FAIL');
  assert.equal(state(at(repo({ 'docs/state.md': STATE_15, 'CLAUDE.md': 'See ../docs/state.md first.\n' }))).status, 'FAIL');
});

test('lineCount counts as wc -l does, plus a last line with no newline; firstInstruction skips headings and comments', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(firstInstruction(CLAUDE_OK), 'Start with [`docs/state.md`](./docs/state.md), then the rest.');
  assert.equal(firstInstruction('# only a heading\n\n'), null);
});

// ------------------------------------------------------------------------------------------------------- leif-pages

const PAGES_OK = {
  'docs/leif.md': '# Your sitting\n\nNode 22 is not your problem. Say yes to D1 and Claude does the rest.\n',
  'agency/RUN-drop-vs-email.md': 'Open `agency/experiments/drop-vs-email.json` and read the `--metric clicks` note.\n',
  'agency/drafts/care-email.md': '```\nHi {first_name}, thank you for your order.\n```\n',
};

test('leif-pages lists Leif\'s pages, the drafts by pattern', () => {
  assert.deepEqual(LEIF_PAGES, ['docs/leif.md', 'agency/RUN-drop-vs-email.md', 'agency/drafts/*.md']);
});

test('leif-pages: plain pages pass', () => {
  const r = leifPages(at(repo(PAGES_OK)));
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /3 page\(s\)/);
});

test('leif-pages: "npm run", a node command or a shell command in backticks fails, by file and line', () => {
  const cases = [
    ['Claude runs this: then npm run orders on the export.', '"npm run"'],
    ['Then node agency/scripts/orders.mjs --file orders.csv', 'a node command'],
    ['When ready, type `git push origin main`.', 'a shell command in backticks'],
    ['Or `$ cd agency` first.', 'a shell command in backticks'],
  ];
  for (const [text, why] of cases) {
    const r = leifPages(at(repo({ ...PAGES_OK, 'docs/leif.md': `# Sitting\n\n${text}\n` })));
    assert.equal(r.status, 'FAIL', text);
    assert.ok(r.detail.includes(`docs/leif.md:3 (${why})`), r.detail);
  }
});

test('leif-pages: a shell code block fails at its fence, and a command in any code block fails', () => {
  const steps = terminalSteps('x.md', 'Copy this:\n```bash\nhello there\n```\nAnd this:\n```\n$ ls -la\ngit status\n```\n');
  assert.deepEqual(steps, [
    { where: 'x.md:2', why: 'a bash code block' },
    { where: 'x.md:7', why: 'a command in a code block' },
    { where: 'x.md:8', why: 'a command in a code block' },
  ]);
});

test('leif-pages: a draft with a step fails by name, and a missing page or an empty drafts folder fails', () => {
  const draft = leifPages(at(repo({ ...PAGES_OK, 'agency/drafts/zz.md': 'ok\nnpm run ab:test -- --check\n' })));
  assert.match(draft.detail, /agency\/drafts\/zz\.md:2/);
  const { 'docs/leif.md': _, ...noLeif } = PAGES_OK;
  assert.match(leifPages(at(repo(noLeif))).detail, /missing: docs\/leif\.md/);
  const { 'agency/drafts/care-email.md': __, ...noDrafts } = PAGES_OK;
  const r = leifPages(at(repo({ ...noDrafts, 'agency/drafts/notes.txt': 'not a page' })));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /agency\/drafts\/\*\.md \(matches nothing\)/);
  assert.match(leifPages(at(repo(PAGES_OK)), ['docs/**/*.md']).detail, /only dir\/\*\.ext/);
});

// ------------------------------------------------------------------------------------------------------------ facts

const fact = (o = {}) => ({ key: 'orders_90d', value: 41, unit: 'orders', source: 'store order export, 90 days', date: '2026-11-08', ...o });
const factsRepo = (doc) => repo({ 'agency/facts.json': typeof doc === 'string' ? doc : JSON.stringify(doc) });

test('facts: every fact sourced and dated passes; "unknown" is an honest value', () => {
  const r = facts(at(factsRepo({ asOf: '2026-11-08', facts: [fact(), fact({ key: 'payment_route', value: 'unknown', unit: '' })] })));
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /2 fact\(s\), each sourced and dated, as of 2026-11-08/);
});

test('facts: asOf 14 days old passes, 15 days old is a NOTE, never a PASS', () => {
  assert.equal(facts(at(factsRepo({ asOf: '2026-10-25', facts: [fact({ date: '2026-10-25' })] }))).status, 'PASS');
  const r = facts(at(factsRepo({ asOf: '2026-10-24', facts: [fact({ date: '2026-10-24' })] })));
  assert.equal(r.status, 'NOTE');
  assert.match(r.detail, /15 days old/);
});

test('facts: a missing, unreadable or empty file fails', () => {
  assert.match(facts(at(repo({}))).detail, /missing/);
  assert.match(facts(at(factsRepo('nope'))).detail, /not valid JSON/);
  assert.match(facts(at(factsRepo([fact()]))).detail, /must be an object/);
  assert.match(facts(at(factsRepo({ asOf: '2026-11-08', facts: [] }))).detail, /non-empty list/);
  assert.match(facts(at(factsRepo({ asOf: '2026-11-08' }))).detail, /non-empty list/);
});

test('facts: a fact with no source, no real date, a future date, no key, no value or a bare number fails', () => {
  const bad = [
    [{ source: '' }, /has no source/],
    [{ source: '   ' }, /has no source/],
    [{ source: undefined }, /has no source/],
    [{ date: '8 Nov 2026' }, /not a real YYYY-MM-DD/],
    [{ date: '2026-11-31' }, /not a real YYYY-MM-DD/],
    [{ date: '2026-11-09' }, /after today/],
    [{ key: '' }, /has no key/],
    [{ value: null }, /has no value/],
    [{ value: undefined }, /has no value/],
    [{ unit: '' }, /a number with no unit/],
    [{ unit: undefined }, /no unit field/],
  ];
  for (const [o, why] of bad) {
    const r = facts(at(factsRepo({ asOf: '2026-11-08', facts: [fact(), fact(o)] })));
    assert.equal(r.status, 'FAIL', JSON.stringify(o));
    assert.match(r.detail, why);
  }
  const loose = facts(at(factsRepo({ asOf: '2026-11-8', facts: [fact()] })));
  assert.equal(loose.status, 'FAIL');
  assert.match(loose.detail, /asOf "2026-11-8" is not a real YYYY-MM-DD date/);
  assert.match(facts(at(factsRepo({ asOf: '2026-11-09', facts: [fact()] }))).detail, /asOf 2026-11-09 is after today/);
});

// -------------------------------------------------------------------------------------------------------------- run

test('a result prints as its status; anything unknown is a FAIL on a required check and a NOTE otherwise', () => {
  assert.equal(markOf({ status: 'PASS' }, true), 'PASS');
  assert.equal(markOf({ status: 'NOTE' }, true), 'NOTE');
  assert.equal(markOf({ status: 'FAIL' }, true), 'FAIL');
  assert.equal(markOf({ ok: true }, true), 'FAIL');
  assert.equal(markOf(undefined, true), 'FAIL');
  assert.equal(markOf({ status: 'FAIL' }, false), 'NOTE');
  assert.equal(markOf({ status: 'PASS' }, false), 'PASS');
});

test('a check that throws is a FAIL with its message, and the checks after it still run', () => {
  const { rows, failed } = runChecks({}, [
    ['boom', () => { throw new Error('kaboom\nsecond line'); }, true],
    ['fine', () => ({ status: 'PASS', detail: 'ok' }), true],
    ['quiet', () => ({ status: 'NOTE', detail: 'absent' }), true],
  ]);
  assert.equal(failed, 1);
  assert.deepEqual(rows.map((r) => [r.name, r.mark]), [['boom', 'FAIL'], ['fine', 'PASS'], ['quiet', 'NOTE']]);
  assert.match(rows[0].detail, /threw: kaboom$/);
});

test('prove runs every check, and all but the rulebook are required', () => {
  assert.deepEqual(CHECKS.map(([name, , required]) => [name, required]), [
    ['tests', true], ['mutations', true], ['secrets', true], ['privacy', true], ['studio', true],
    ['decisions', true], ['state', true], ['leif-pages', true], ['facts', true], ['rulebook', false],
  ]);
});
