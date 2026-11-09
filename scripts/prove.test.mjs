// `npm run prove` is the repo's one "is it true?" command, and each of its checks is itself a guard, so each is shown
// to catch what it should: on fixture repos in temp dirs, with a fixed clock and a stand-in for git, never the real
// repo, the real studio or the machine's own clock. Where only git itself can show the case (what the index holds,
// how it prints a blob it calls binary), a real git repo is made in a temp dir and thrown away.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BIP39_WORDS, CHECKS, KNOWN_FAKES, LEIF_PAGES, SECRET_SHAPES, SEED_REPEATS, SEED_WORDS,
  bip39Intact, countOf, dayNumber, decisions, decodeText, facts, firstInstruction, historyLines, leifPages, lineCount,
  markOf, runChecks, secretHits, secretKinds, secrets, seedEnds, seedLike, state, studio, studioVerdict, sydneyDay, terminalSteps,
  treeLines, withoutKnownFakes,
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

// The realistic layouts the second 8 Nov audit found passing end to end (wave0 finding 2), one fixture each.
const SECOND_AUDIT_SHAPES = [
  ['labelled-hex-key', j('const wallet', 'PrivateKey = "', chars(HEX, 64, 50), '";')],
  ['labelled-hex-key', j('eth', 'PrivateKey: \'', chars(HEX, 64, 51), "'")],
  ['labelled-hex-key', j('priv', 'key=', chars(HEX, 64, 52))],
  ['labelled-hex-key', j('P', 'K=', chars(HEX, 64, 53))],
  ['labelled-hex-key', j('DEPLOYER', '_PK=', chars(HEX, 64, 54))],
  ['extended-private-key', j('xp', 'rv9s21ZrQH143K', chars(B58, 97, 55))],
  ['extended-private-key', j('zp', 'rv', chars(B58, 107, 56))],
  ['wif-key', j('K', chars(B58, 51, 57))],
  ['wif-key', j('wif: 5', 'H', chars(B58, 49, 58))],
  ['url-password', j('DATABASE_URL=postgres', 'ql://postgres:', chars(ALNUM, 20, 59), '@db.', chars(LOWER, 20, 60), '.supabase.co:5432/postgres')],
  ['bearer-token', j('curl -H "Authorization: ', 'Bearer ', chars(HEX, 40, 61), '" https://api.postiz.com/public/v1/posts')],
  ['labelled-secret', j('Postiz API', ' key: ', chars(HEX, 32, 62))],
  ['npm-token', j('np', 'm_', chars(ALNUM, 36, 63))],
  ['telegram-bot-token', j('TG=', chars(DIGITS, 9, 64), ':A', 'A', chars(URLSAFE, 33, 65))],
  ['webhook-secret', j('wh', 'sec_', chars(ALNUM, 32, 66))],
  ['google-oauth-secret', j('GOC', 'SPX-', chars(URLSAFE, 28, 67))],
];

test('the second audit\'s key and token layouts are caught, each by its own name', () => {
  for (const [kind, t] of SECOND_AUDIT_SHAPES) assert.ok(secretKinds(t).includes(kind), `${kind} missed in fixture ${SECOND_AUDIT_SHAPES.findIndex((m) => m[1] === t)}`);
});

test('the new shapes stay narrow: public and cache keys, placeholders and plain words are not flagged', () => {
  for (const t of [
    j('publicKey: ', chars(HEX, 64, 70)), // a public key is public
    j('cacheKey: "', chars(HEX, 64, 71), '"'), // a hash used as a key
    j('privacy policy sha256: ', chars(HEX, 64, 72)),
    j('pkg sha256 ', chars(HEX, 64, 73)),
    'postgres://user:password@localhost:5432/app',
    'postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghijklmnop.supabase.co:5432/postgres',
    j('postgres://app:', '$', '{DB_PASSWORD_V2}@db:5432/app'),
    j('https://x-access-token:', '$', '{GITHUB_TOKEN}@github.com/joyisfree/desk.git'),
    j("fastURI.parse('uri://us", '\\', 'xA0er:pa', '\\', "uD7FFss@example.com:123/one')"), // escapes in a test string
    j('integrity sha512-', chars(ALNUM, 20, 74), '+K', chars(B58, 51, 75), '/', chars(ALNUM, 10, 76), '=='), // base64, not WIF
    'Authorization: Bearer <token>',
    'Bearer YOUR_ACCESS_TOKEN_GOES_HERE',
    'Bearer tokens go in the Authorization header',
    'npm_config_registry=https://registry.npmjs.org/',
    'the bot id is 123456789 and the chat is 42',
    'the API key: see the Postiz settings page',
  ]) assert.deepEqual(secretKinds(t), [], t);
});

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
  const named = new Set([...TASK_SHAPES, ...AUDIT_SHAPES, ...MORE_SHAPES, ...SECOND_AUDIT_SHAPES].map(([kind]) => kind));
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

test('rows of seed words are not joined across a prose line, a gap, two blank lines, or two files', () => {
  const words = seedWords(SEED_WORDS, 9);
  const half = (k, file, start) => words.slice(k, k + 6).map((w, i) => line(w, `${file}:${start + i}`));
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), line('and the rest is prose', 'a.md:7'), ...half(6, 'a.md', 8)]), []);
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), ...half(6, 'a.md', 9)]), []);
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), line('', 'a.md:7'), line('  ', 'a.md:8'), ...half(6, 'a.md', 9)]), []);
  assert.deepEqual(secretHits([...half(0, 'a.md', 1), ...half(6, 'b.md', 7)]), []);
  assert.deepEqual(secretHits(words.slice(0, SEED_WORDS - 1).map((w, i) => line(w, `a.md:${i + 1}`))), []);
});

/** Lines of one file, numbered from 1. */
const page = (file, texts) => texts.map((text, i) => line(text, `${file}:${i + 1}`));

test('a seed in the layouts the second audit found is caught: tables, (1) #1 and "1": numbering, wrapped, two blocks', () => {
  const s = seedWords(SEED_WORDS, 3);
  const layouts = {
    'wrapped prose': [`Recovery phrase for the hot wallet is ${s.slice(0, 7).join(' ')}`, `${s.slice(7).join(' ')}, keep it safe.`],
    'a label, then the rest on the next line': [`seed: ${s.slice(0, 6).join(' ')}`, s.slice(6).join(' ')],
    'a 3 by 4 markdown table': ['| 1-4 | 5-8 | 9-12 |', '|---|---|---|', ...[0, 1, 2, 3].map((i) => `| ${s[i]} | ${s[i + 4]} | ${s[i + 8]} |`)],
    'a markdown table, one word to a row': ['| # | word |', '|---|---|', ...s.map((w, i) => `| ${i + 1} | ${w} |`)],
    '(1) numbering': s.map((w, i) => `(${i + 1}) ${w}`),
    '#1 numbering': s.map((w, i) => `#${i + 1} ${w}`),
    'a JSON object keyed "1":': ['{', ...s.map((w, i) => `  "${i + 1}": "${w}",`), '}'],
    'two blocks of six, one blank line between': [...s.slice(0, 6), '', ...s.slice(6)],
  };
  for (const [name, texts] of Object.entries(layouts)) {
    const hits = secretHits(page('n.md', texts));
    assert.equal(hits.length, 1, `${name}: ${JSON.stringify(hits)}`);
    assert.deepEqual(hits[0].kinds, ['bip39-seed'], name);
  }
});

test('a wrapped seed is joined only by the words that end one line and lead the next', () => {
  const s = seedWords(SEED_WORDS, 11);
  // 7 + 5 = 12 across the break: a seed. With the run broken by a word not on the list, 7 + 4 is not.
  assert.equal(secretHits(page('w.md', [`it is ${s.slice(0, 7).join(' ')}`, `${s.slice(7).join(' ')} and that is all`])).length, 1);
  assert.deepEqual(secretHits(page('w.md', [`it is ${s.slice(0, 7).join(' ')}`, `${s.slice(7, 11).join(' ')} and ${s[11]}`])), []);
  assert.deepEqual(secretHits(page('w.md', [`it is ${s.slice(0, 7).join(' ')} // ok`, `${s.slice(7).join(' ')}`])), []);
  assert.deepEqual(seedEnds('| 1 | abandon |'), { lead: ['abandon'], trail: ['abandon'], words: ['abandon'], nums: [1] });
  assert.deepEqual(seedEnds('the cat sat on abandon ability'), { lead: [], trail: ['abandon', 'ability'], words: [], nums: [] });
  assert.deepEqual(seedEnds('## Next step'), { lead: [], trail: ['next', 'step'], words: [], nums: [] });
});

test('one seed on one line is reported once, not again as rows', () => {
  assert.deepEqual(secretHits([line(seedWords(SEED_WORDS, 10).join(' '), 'x.txt:4'), line(BIP39_WORDS[5], 'x.txt:5')]), [{ where: 'x.txt:4', kinds: ['bip39-seed'] }]);
});

// 9 Nov 2026, the R2 adversary review: a seed saved as a spreadsheet, or numbered 1st, w1 or word1, passed.
const nth = (n) => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`;
const SPREADSHEET_SEEDS = (s) => ({
  'a CSV, a header then 1,word': ['n,word', ...s.map((w, i) => `${i + 1},${w}`)],
  'a CSV with quoted cells': s.map((w, i) => `"${i + 1}","${w}"`),
  'a CSV with semicolons': s.map((w, i) => `${i + 1};${w}`),
  '1st: numbering': s.map((w, i) => `${nth(i + 1)}: ${w}`),
  'a JSON object keyed "w1":': ['{', ...s.map((w, i) => `  "w${i + 1}": "${w}",`), '}'],
  'Word1: labels': s.map((w, i) => `Word${i + 1}: ${w}`),
  'a JSON object keyed "word_1":': ['{', ...s.map((w, i) => `  "word_${i + 1}": "${w}",`), '}'],
  'word-1 labels': s.map((w, i) => `word-${i + 1} ${w}`),
  'Word 1: labels, a space before the number': s.map((w, i) => `Word ${i + 1}: ${w}`),
  'Seed word #1: labels, two to a line': [0, 2, 4, 6, 8, 10].map((k) => `Seed word #${k + 1}: ${s[k]}   Seed word #${k + 2}: ${s[k + 1]}`),
});

test('a seed saved as a CSV, or numbered 1st, w1, Word1 or word_1, is caught once (R2 adversary, 9 Nov 2026)', () => {
  for (const [name, texts] of Object.entries(SPREADSHEET_SEEDS(seedWords(SEED_WORDS, 15)))) {
    const hits = secretHits(page('wallet-backup.csv', texts));
    assert.equal(hits.length, 1, `${name}: ${JSON.stringify(hits)}`);
    assert.deepEqual(hits[0].kinds, ['bip39-seed'], name);
  }
  assert.deepEqual(secretHits(page('w.csv', seedWords(SEED_WORDS - 1, 15).map((w, i) => `${i + 1},${w}`))), [], '11 rows are not a seed');
  assert.deepEqual(seedEnds('12,abandon'), { lead: ['abandon'], trail: ['abandon'], words: ['abandon'], nums: [12] });
});

// An X session cookie as the browser extensions export it: one JSON object per cookie, its name and value six lines
// apart. The names are built from pieces, so this file never holds a name beside a value.
const AUTH = j('auth', '_token');
const CT0 = j('ct', '0');
const editorCookie = (name, value) => ['    {', '        "domain": ".x.com",', '        "expirationDate": 1790000000.5,', '        "hostOnly": false,', '        "httpOnly": true,', `        "name": "${name}",`, '        "path": "/",', '        "sameSite": "no_restriction",', '        "secure": true,', '        "session": false,', '        "storeId": "0",', `        "value": "${value}"`, '    },'];

test('an X session cookie in a Cookie-Editor JSON export or a Netscape cookies.txt is caught (R2 adversary, 9 Nov 2026)', () => {
  const exported = page('x-cookies.json', ['[', ...editorCookie(AUTH, chars(HEX, 40, 90)), ...editorCookie(CT0, chars(HEX, 160, 91)), ...editorCookie('guest_id', chars(HEX, 32, 92)), ']']);
  assert.deepEqual(secretHits(exported), [{ where: 'x-cookies.json:13', kinds: ['x-session-cookie'] }, { where: 'x-cookies.json:26', kinds: ['x-session-cookie'] }]);
  assert.deepEqual(secretHits([line(JSON.stringify([{ domain: '.x.com', name: AUTH, value: chars(HEX, 40, 93) }]), 'c.json:1')]), [{ where: 'c.json:1', kinds: ['x-session-cookie'] }]);
  for (const [name, n] of [[AUTH, 40], [CT0, 160]]) assert.deepEqual(secretKinds(['.x.com', 'TRUE', '/', 'TRUE', '1790000000', name, chars(HEX, n, 94)].join('\t')), ['x-session-cookie'], name);
});

test('a cookie name pairs only with a hex value a few lines below it in the same file', () => {
  const name = `        "name": "${AUTH}",`;
  const value = `        "value": "${chars(HEX, 40, 95)}"`;
  const far = Array.from({ length: 20 }, (_, i) => `        "field${i}": ${i},`);
  assert.deepEqual(secretHits(page('a.json', [name, ...far, value])), [], 'twenty lines apart');
  assert.deepEqual(secretHits([line(name, 'a.json:1'), line(value, 'b.json:2')]), [], 'two files');
  assert.deepEqual(secretHits(page('a.json', [name, '        "value": "<your auth token>"'])), [], 'a placeholder');
  assert.deepEqual(secretHits(page('a.md', [`The ${AUTH} and ${CT0} cookies are Leif's and never leave his browser.`])), []);
});

test('secrets: a cookie export, a cookies.txt and a seed saved as a CSV in the tree all fail, by file and line', () => {
  const cookiesTxt = ['# Netscape HTTP Cookie File', ['.x.com', 'TRUE', '/', 'TRUE', '1790000000', AUTH, chars(HEX, 40, 96)].join('\t'), ''].join('\n');
  const csv = `${SPREADSHEET_SEEDS(seedWords(SEED_WORDS, 16))['a CSV, a header then 1,word'].join('\n')}\n`;
  const root = repo({ 'x-cookies.json': `${['[', ...editorCookie(AUTH, chars(HEX, 40, 97)), ']'].join('\n')}\n`, 'cookies.txt': cookiesTxt, 'wallet-backup.csv': csv });
  const r = secrets({ root, git: scanGit({ files: ['x-cookies.json', 'cookies.txt', 'wallet-backup.csv'] }).git });
  assert.equal(r.status, 'FAIL');
  for (const at of ['x-cookies.json:13 (x-session-cookie)', 'cookies.txt:2 (x-session-cookie)', 'wallet-backup.csv:1 (bip39-seed)']) assert.ok(r.detail.includes(at), `${at} not in: ${r.detail}`);
});

// 9 Nov 2026, the R2 verifier: once commas and semicolons separated seed words, a stock CSV of colours, sizes and
// quantities failed as a seed. This label's CSVs and pages are full of BIP39 colour and size words (black, small,
// large, green, blue, brown, cream, cotton, wool, silk), and a check that fails on them is one the next session
// weakens.
const COLOURS = ['black', 'green', 'blue', 'brown', 'cream', 'olive'];
const SIZES = ['small', 'large', 'short', 'long'];
const STOCK_LISTS = {
  'the stock CSV the verifier committed, colour,size,qty': ['colour,size,qty', 'black,small,2', 'black,large,1', 'green,small,3', 'green,large,2', 'blue,small,1', 'blue,large,4'],
  'a fabric CSV with semicolons': ['fabric;colour;qty', 'cotton;black;12', 'cotton;green;8', 'wool;black;3', 'wool;blue;5', 'silk;black;2', 'silk;cream;1'],
  'the same stock as a markdown table': ['| colour | size | qty |', '|---|---|---|', '| black | small | 2 |', '| black | large | 1 |', '| green | small | 3 |', '| green | large | 2 |', '| blue | small | 1 |', '| blue | large | 4 |'],
  'the quantity first, qty,colour,size': ['qty,colour,size', ...COLOURS.flatMap((c, i) => SIZES.map((z, k) => `${(i + k) % 9 + 1},${c},${z}`))],
  'no quantity, sorted by colour': ['colour,size', ...COLOURS.flatMap((c) => SIZES.map((z) => `${c},${z}`))],
  'no quantity, sorted by size': ['colour;size', ...SIZES.flatMap((z) => COLOURS.map((c) => `${c};${z}`))],
  'twelve pieces named for BIP39 words, each with its count': ['piece,left', ...seedWords(SEED_WORDS, 23).map((w, i) => `${w},${i % 7 + 1}`)],
};

test('a stock or fabric CSV of BIP39 colours, sizes and counts is not a seed, as CSV, semicolons or a table (R2 verifier, 9 Nov 2026)', () => {
  for (const [name, texts] of Object.entries(STOCK_LISTS)) assert.deepEqual(secretHits(page('stock.csv', texts)), [], name);
  const files = { 'stock.csv': `${STOCK_LISTS['the stock CSV the verifier committed, colour,size,qty'].join('\n')}\n`, 'fabric.csv': `${STOCK_LISTS['a fabric CSV with semicolons'].join('\n')}\n`, 'stock.md': `${STOCK_LISTS['the same stock as a markdown table'].join('\n')}\n` };
  const r = secrets({ root: repo(files), git: scanGit({ files: Object.keys(files) }).git });
  assert.equal(r.status, 'PASS', r.detail);
});

// Round 2 of the R2 verifier, 9 Nov 2026: a count first in each row ("4,black,dress", "12;dress") read as seed
// numbering, and a wholesale order, a restock list, a pop-up kit or an ink order failed prove as a seed phrase. A
// seed's numbers run on, 1, 2, 3, so a numbered row joins the run only on the number after the last one.
const COUNT_FIRST = {
  'a wholesale order, count first': [
    'qty,colour,item', '4,black,dress', '2,cream,dress',
    '6,olive,jacket', '3,black,jacket', '5,sand,hat',
    '2,stone,hat', '8,black,sock', '6,cream,sock',
    '1,coral,bag', '4,ivory,bag',
  ],
  'a restock list with semicolons': [
    'count;item', '12;dress', '8;jacket',
    '20;hat', '6;sock', '3;bag',
    '9;skirt', '4;belt', '7;glove',
    '2;shoe', '5;label', '11;ladder',
    '10;lamp',
  ],
  'a pop-up kit': [
    'qty,item', '2,table', '4,chair',
    '1,mirror', '3,lamp', '6,basket',
    '2,rack', '1,carpet', '8,cable',
    '3,box', '5,bag', '60,card',
    '1,tape',
  ],
  'a screen-print ink order': [
    'qty,ink', '2,black', '1,cream',
    '3,olive', '4,coral', '1,ivory',
    '2,sand', '5,stone', '1,ocean',
    '3,green', '2,blue', '4,gold',
    '1,silver',
  ],
};

test('a count first in each row is not seed numbering: a numbered row joins only on the next number (R2 verifier, round 2, 9 Nov 2026)', () => {
  for (const [name, rows] of Object.entries(COUNT_FIRST)) assert.deepEqual(secretHits(page('order.csv', rows)), [], name);
  const s = seedWords(SEED_WORDS, 23);
  assert.deepEqual(secretHits(page('w.csv', s.map((w, i) => `${i + 1},${w}`))), [{ where: 'w.csv:1', kinds: ['bip39-seed'] }], 'a seed saved as index,word');
  assert.deepEqual(secretHits(page('w.csv', ['index,word', ...s.map((w, i) => `${i + 1};${w}`)])), [{ where: 'w.csv:1', kinds: ['bip39-seed'] }], 'with a header and semicolons (index and word are BIP39 words, so the run starts there)');
  const t = seedWords(24, 29);
  const twoColumns = t.slice(0, 12).map((w, i) => `${i + 1}. ${w}   ${i + 13}. ${t[i + 12]}`);
  assert.ok(secretHits(page('w.md', twoColumns)).some((h) => h.kinds.includes('bip39-seed')), 'a 24-word seed in two numbered columns');
  const blocks = [...s.slice(0, 6).map((w, i) => `${i + 1}. ${w}`), '', ...s.slice(6).map((w, i) => `${i + 7}. ${w}`)];
  assert.deepEqual(secretHits(page('w.md', blocks)), [{ where: 'w.md:1', kinds: ['bip39-seed'] }], 'two numbered blocks of six across a blank line');
  assert.deepEqual(seedEnds('4,black,dress').nums, [4]);
  assert.deepEqual(seedEnds('5. ocean 3. ladder').words, [], "numbers that fall within one line are not a seed's");
});

test('leif-pages: a tilde before a number, a path after a word that is also a tool, and a yarn install at a gallery are prose (R2 verifier, round 2, 9 Nov 2026)', () => {
  for (const ok of ['We export ~ 200 pieces a season to the UK and NZ.', 'Claude will export /collections/summer/ as a PDF for the lookbook.', 'The yarn install at the gallery opens Friday (a knitted wall piece).', 'The cat /dog/ prints sold out by noon.', 'The bobcat -print tee is back.', 'The cd /vinyl bundle ships with the tee.']) {
    assert.deepEqual(terminalSteps('docs/leif.md', ok), [], ok);
  }
  for (const step of ['cd ~', 'cd ~/Desktop/joyisfree', 'cp ./notes.txt /Users/leif/old/', 'chmod +x ./setup.sh', 'mkdir ~/Desktop/drop', 'cat ./notes.txt']) {
    assert.equal(terminalSteps('docs/leif.md', step).length, 1, step);
  }
});

test('a number is numbering only when a word follows it; after its words it is a count and breaks the row', () => {
  assert.deepEqual(seedEnds('black,small,2'), { lead: ['black', 'small'], trail: [], words: [], nums: [] });
  assert.deepEqual(seedEnds('2,black,small'), { lead: ['black', 'small'], trail: ['black', 'small'], words: ['black', 'small'], nums: [2] });
  assert.deepEqual(seedEnds('| 3 | ocean | 4 |'), { lead: ['ocean'], trail: [], words: [], nums: [3] });
  assert.deepEqual(seedEnds('Seed word 1: rifle').words, ['rifle'], 'the words before a number are its label');
  assert.deepEqual(seedEnds('5. word 6. zoo').words, ['word', 'zoo'], 'a numbered word is never a label');
});

test('a seed may repeat a word or two in any twelve in a row; a run with three repeats is a list, not a seed', () => {
  const s = seedWords(SEED_WORDS, 17);
  const twoRepeats = [...s.slice(0, 10), s[2], s[7]];
  const threeRepeats = [...s.slice(0, 9), s[1], s[4], s[8]];
  assert.equal(SEED_REPEATS, 2);
  assert.equal(seedLike(s), true);
  assert.equal(seedLike(twoRepeats), true, 'two repeats, as about 4 in 10,000 twelve-word seeds have');
  assert.equal(seedLike(threeRepeats), false, 'three repeats in twelve');
  assert.equal(seedLike(s.slice(0, SEED_WORDS - 1)), false, 'eleven words');
  assert.equal(seedLike([...threeRepeats, ...s]), true, 'any twelve in a row, not only the first');
  assert.equal(seedLike([...Array(11).fill(BIP39_WORDS[0]), BIP39_WORDS[3]]), false, 'a published test vector made from all-zero entropy is public, and repeats by design');
  assert.ok(secretKinds(twoRepeats.join(' ')).includes('bip39-seed'), 'on one line');
  assert.deepEqual(secretKinds(threeRepeats.join(' ')), [], 'on one line');
  assert.deepEqual(secretHits(page('w.txt', twoRepeats.map((w, i) => `${i + 1}. ${w}`))), [{ where: 'w.txt:1', kinds: ['bip39-seed'] }]);
  assert.deepEqual(secretHits(page('w.txt', threeRepeats.map((w, i) => `${i + 1}. ${w}`))), []);
  const stockThenSeed = [...STOCK_LISTS['no quantity, sorted by colour'].slice(1), s.slice(0, 6).join(','), s.slice(6).join(',')];
  assert.deepEqual(secretHits(page('mixed.csv', stockThenSeed)), [{ where: 'mixed.csv:1', kinds: ['bip39-seed'] }], 'a seed pasted under stock rows');
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

/** A stand-in for git that answers ls-files, log and diff --cached, and records what it was asked. */
function scanGit({ files = ['a.txt'], log = LOG, staged = '', lsFails = false, logFails = false, diffFails = false } = {}) {
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
    if (args[0] === 'diff' && args.includes('--cached')) {
      if (diffFails) throw new Error('fatal: unable to read index file');
      return staged;
    }
    throw new Error(`no stand-in for git ${args.join(' ')}`);
  };
  return { git, calls };
}

/** What `git diff --cached -U0` prints for one new file staged with these lines. */
const stagedDiff = (path, texts) => [
  `diff --git a/${path} b/${path}`,
  'new file mode 100644',
  'index 0000000..1234567',
  '--- /dev/null',
  `+++ b/${path}`,
  `@@ -0,0 +1${texts.length === 1 ? '' : `,${texts.length}`} @@`,
  ...texts.map((t) => `+${t}`),
  '',
].join('\n');

const clean = () => repo({ 'a.txt': 'nothing secret here\n', 'b/c.md': '# notes\n' });

test('a staged diff is read like history, under "staged", and a UTF-16 line printed by --text reads as its letters', () => {
  const nul = (s) => s.split('').join('\u0000');
  const { lines, commits } = historyLines(stagedDiff('w.txt', [nul('seed phrase: abandon'), nul('two')]), 'staged');
  assert.equal(commits, 0);
  assert.deepEqual(lines, [{ where: 'staged:w.txt:1', text: 'seed phrase: abandon' }, { where: 'staged:w.txt:2', text: 'two' }]);
});

test('secrets: a clean tree, index and history pass, and the scan asks git for untracked files, the index and all of history, as text', () => {
  const { git, calls } = scanGit({ files: ['a.txt', 'b/c.md'], staged: stagedDiff('d.txt', ['still fine']) });
  const r = secrets({ root: clean(), git });
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /2 file\(s\) read in the tree, 0 binary file\(s\) not read; 1 staged line\(s\) not yet committed; 6 committed line\(s\) over 2 commit\(s\)/);
  const [ls, log, diff] = calls;
  for (const a of ['--cached', '--others', '--exclude-standard']) assert.ok(ls.includes(a), a);
  for (const a of ['-p', '--all', '--text', '--dst-prefix=b/']) assert.ok(log.includes(a), a);
  for (const a of ['--cached', '--text', '--no-ext-diff', '--dst-prefix=b/']) assert.ok(diff.includes(a), a);
});

test('secrets: a secret staged for the next commit fails, as "staged" with its path and line, though the disk is clean', () => {
  const secret = TASK_SHAPES[4][1];
  const r = secrets({ root: clean(), git: scanGit({ staged: stagedDiff('leak.env.txt', ['fine', secret]) }).git });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /staged:leak\.env\.txt:2 \(stripe\)/);
  assert.ok(!r.detail.includes(secret.slice(12)));
});

test('the tree reader decodes UTF-16 by its BOM, either byte order, and names each binary file it does not read', () => {
  const text = 'seed phrase: here\nline two\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
  assert.equal(decodeText(le), text);
  assert.equal(decodeText(be), text);
  assert.equal(decodeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])), null);
  const root = repo({ 'le.txt': '', 'be.txt': '', 'img.bin': '', 'plain.txt': 'plain\n' });
  writeFileSync(join(root, 'le.txt'), le);
  writeFileSync(join(root, 'be.txt'), be);
  writeFileSync(join(root, 'img.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const t = treeLines(root, ['le.txt', 'be.txt', 'img.bin', 'plain.txt']);
  assert.equal(t.files, 3);
  assert.deepEqual(t.binary, ['img.bin']);
  assert.deepEqual(t.lines.filter((l) => l.text === 'seed phrase: here').map((l) => l.where), ['le.txt:1', 'be.txt:1']);
});

test('secrets: a seed saved as UTF-16 on disk fails, and a binary file not read is counted and named in the PASS', () => {
  const root = clean();
  const seed = j('seed', ' phrase: ', seedWords(SEED_WORDS, 12).join(' '));
  writeFileSync(join(root, 'wallet-backup.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${seed}\r\n`, 'utf16le')]));
  const r = secrets({ root, git: scanGit({ files: ['a.txt', 'wallet-backup.txt'] }).git });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /wallet-backup\.txt:1 \(labelled-seed, bip39-seed\)/);
  writeFileSync(join(root, 'wallet-backup.txt'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const p = secrets({ root, git: scanGit({ files: ['a.txt', 'wallet-backup.txt'] }).git });
  assert.equal(p.status, 'PASS', p.detail);
  assert.match(p.detail, /1 file\(s\) read in the tree, 1 binary file\(s\) not read: wallet-backup\.txt;/);
});

/**
 * A real git repo in a temp dir, for what only git itself shows: the index, and how it prints a blob it calls binary.
 * Every GIT_* variable is dropped first: run from a git hook, GIT_DIR or GIT_INDEX_FILE would point these commands at
 * the outer repo's index.
 */
function realGit() {
  const root = tempDir('prove-git-');
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const env = { ...base, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe', env, maxBuffer: 64 * 1024 * 1024 });
  git(['init', '-q']);
  writeFileSync(join(root, 'readme.txt'), 'hello\n');
  git(['add', 'readme.txt']);
  git(['commit', '-qm', 'init']);
  return { root, git };
}
const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

test('secrets, with real git: a key staged and then deleted or edited back on disk fails before it is committed', () => {
  const { root, git } = realGit();
  const key = j('sk', '_live_', chars(ALNUM, 24, 80));
  writeFileSync(join(root, 'leak.env.txt'), `STRIPE=${key}\n`);
  writeFileSync(join(root, 'wallet.txt'), utf16(j('seed', ' phrase: ', seedWords(SEED_WORDS, 13).join(' '), '\n')));
  git(['add', 'leak.env.txt', 'wallet.txt']);
  unlinkSync(join(root, 'leak.env.txt'));
  unlinkSync(join(root, 'wallet.txt'));
  appendFileSync(join(root, 'readme.txt'), `key: ${key}\n`);
  git(['add', 'readme.txt']);
  writeFileSync(join(root, 'readme.txt'), 'hello\n');
  const r = secrets({ root, git });
  assert.equal(r.status, 'FAIL', r.detail);
  for (const at of ['staged:leak.env.txt:1 (stripe)', 'staged:readme.txt:2 (stripe)', 'staged:wallet.txt:1 (labelled-seed, bip39-seed)']) assert.ok(r.detail.includes(at), `${at} not in: ${r.detail}`);
});

test('secrets, with real git: a seed committed as UTF-16 fails on disk, and in history once the file is gone', () => {
  const { root, git } = realGit();
  writeFileSync(join(root, 'wallet-backup.txt'), utf16(j('seed', ' phrase: ', seedWords(SEED_WORDS, 14).join(' '), '\n')));
  git(['add', 'wallet-backup.txt']);
  git(['commit', '-qm', 'backup']);
  assert.match(secrets({ root, git }).detail, /(?:^|; | at )wallet-backup\.txt:1 \(labelled-seed, bip39-seed\)/);
  git(['rm', '-q', 'wallet-backup.txt']);
  git(['commit', '-qm', 'gone']);
  const r = secrets({ root, git });
  assert.equal(r.status, 'FAIL', r.detail);
  assert.match(r.detail, /[0-9a-f]{7}:wallet-backup\.txt:1 \(labelled-seed, bip39-seed\)/);
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
  assert.match(secrets({ root: clean(), git: scanGit({ diffFails: true }).git }).detail, /next commit would record was not read/);
  assert.equal(secrets({ root: clean(), git: scanGit({ diffFails: true }).git }).status, 'FAIL');
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

/**
 * A stand-in for git inside the studio. It answers for-each-ref only with the ref families it was asked for, and
 * `rev-list --count <base>..<ref>` from `ahead`, keyed "<base>..<ref>" or by the ref alone; a count it was not given
 * is an error, never a quiet 0.
 */
function studioGit(dir, { branch = 'main', head = 'abc1234', dirty = '', refs = ['refs/heads/main', 'refs/remotes/origin/main'], ahead = {} } = {}) {
  return (args) => {
    assert.deepEqual(args.slice(0, 2), ['-C', dir]);
    const [cmd, ...rest] = args.slice(2);
    if (cmd === 'rev-parse' && rest.includes('--abbrev-ref')) return `${branch}\n`;
    if (cmd === 'rev-parse' && rest.includes('--short')) return `${head}\n`;
    if (cmd === 'status') return dirty;
    if (cmd === 'for-each-ref') return refs.filter((r) => rest.some((p) => r.startsWith(`${p}/`))).join('\n');
    if (cmd === 'rev-list' && rest[0] === '--count') {
      const range = rest[1];
      const n = ahead[range] ?? ahead[range.split('..')[1]];
      if (n === undefined) throw new Error(`no count for ${range}`);
      return `${n}\n`;
    }
    throw new Error(`no stand-in for git ${cmd}`);
  };
}
const GALXE = 'refs/heads/claude/galxe-automation-strategy-770t1f';
const GALXE_REMOTE = 'refs/remotes/origin/claude/galxe-automation-strategy-770t1f';

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

test('studio: a claude/galxe-* branch holding a commit main lacks fails, local or only on the remote', () => {
  const dir = studioDir();
  const local = studio({ studio: dir, git: studioGit(dir, { branch: 'claude/galxe-x', refs: ['refs/heads/main', 'refs/heads/claude/galxe-x'], ahead: { 'refs/heads/claude/galxe-x': 2 } }) });
  assert.equal(local.status, 'FAIL');
  assert.match(local.detail, /holds commits refs\/heads\/main does not: refs\/heads\/claude\/galxe-x \(2\)/);
  const remote = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/main', 'refs/remotes/origin/main', GALXE_REMOTE], ahead: { [GALXE_REMOTE]: 1 } }) });
  assert.equal(remote.status, 'FAIL');
  assert.match(remote.detail, /refs\/remotes\/origin\/claude\/galxe-automation-strategy-770t1f \(1\)/);
});

test('studio: an empty claude/galxe-* branch, as the cloud harness checks out at every start, passes and is named', () => {
  const dir = studioDir();
  const refs = ['refs/heads/main', 'refs/remotes/origin/main', GALXE, GALXE_REMOTE];
  const r = studio({ studio: dir, git: studioGit(dir, { branch: 'claude/galxe-automation-strategy-770t1f', refs, ahead: { [GALXE]: 0, [GALXE_REMOTE]: 0 } }) });
  assert.equal(r.status, 'PASS', r.detail);
  assert.match(r.detail, /no commit beyond refs\/remotes\/origin\/main: refs\/heads\/claude\/galxe-automation-strategy-770t1f, refs\/remotes\/origin\/claude\/galxe-automation-strategy-770t1f/);
  const dirty = studio({ studio: dir, git: studioGit(dir, { refs, dirty: ' M src/App.tsx\n', ahead: { [GALXE]: 0, [GALXE_REMOTE]: 0 } }) });
  assert.equal(dirty.status, 'FAIL');
});

test('studio: commits are counted against origin/main, else main, and with neither the check fails closed', () => {
  const dir = studioDir();
  const both = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/main', 'refs/remotes/origin/main', GALXE], ahead: { [`refs/remotes/origin/main..${GALXE}`]: 3, [`refs/heads/main..${GALXE}`]: 0 } }) });
  assert.equal(both.status, 'FAIL', 'a commit on the galxe branch that only local main holds has not been through the studio\'s remote main');
  const local = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/main', GALXE], ahead: { [`refs/heads/main..${GALXE}`]: 0 } }) });
  assert.equal(local.status, 'PASS', local.detail);
  assert.match(local.detail, /beyond refs\/heads\/main/);
  const none = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/trunk', GALXE] }) });
  assert.equal(none.status, 'FAIL');
  assert.match(none.detail, /no main to measure it against: refs\/heads\/claude\/galxe-automation-strategy-770t1f/);
});

test('studio: a commit count git did not print as a number is unknown, and unknown is not zero', () => {
  const dir = studioDir();
  const r = studio({ studio: dir, git: studioGit(dir, { refs: ['refs/heads/main', GALXE], ahead: { [GALXE]: '' } }) });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /galxe-automation-strategy-770t1f \(count unknown\)/);
  assert.equal(studioVerdict({ present: true, refs: [GALXE], base: 'refs/heads/main', ahead: {} }).status, 'FAIL');
  for (const [s, n] of [['0\n', 0], ['3', 3], [' 12 ', 12]]) assert.equal(countOf(s), n, JSON.stringify(s));
  for (const s of ['', '-1', '1e2', '2 3', 'fatal']) assert.ok(Number.isNaN(countOf(s)), JSON.stringify(s));
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

test('leif-pages: npm, npx or git in prose, <code>, a script, and the Windows and platform tools fail (wave0 finding 5)', () => {
  const cases = [
    ['When it says done, type npm test and press Enter.', 'an npm, npx or git command'],
    ['Open a terminal, type npm install, then press Enter.', 'an npm, npx or git command'],
    ['If it asks, run npx prove.', 'an npm, npx or git command'],
    ['Open a terminal and type git pull, then press Enter.', 'an npm, npx or git command'],
    ['Or <code>npm install</code>.', 'a shell command in <code>'],
    ['Press <kbd>cd agency</kbd> then Enter.', 'a shell command in <code>'],
    ['Once: paste `powercfg /change standby-timeout-ac 0` into PowerShell.', 'a shell command in backticks'],
    ['Then run `./setup.sh`.', 'a shell command in backticks'],
    ['Double-click `scripts\\keep-awake-undo.ps1` to undo it.', 'a shell command in backticks'],
    ['Paste `winget install OpenJS.NodeJS.LTS`.', 'a shell command in backticks'],
    ['Run `nvm install 22` first.', 'a shell command in backticks'],
    ['Run `vercel --prod`.', 'a shell command in backticks'],
    ['Run `supabase db push`.', 'a shell command in backticks'],
  ];
  for (const [text, why] of cases) assert.deepEqual(terminalSteps('docs/leif.md', `# Sitting\n\n${text}\n`), [{ where: 'docs/leif.md:3', why }], text);
});

test('leif-pages: a command in a block indented 4 spaces or a tab after a blank line fails, and a pwsh fence fails', () => {
  const steps = terminalSteps('x.md', 'Then:\n\n    git pull\n\tnpm install\n\n- a list item\n    export the CSV from the store\n\n```pwsh\nSet-Location agency\n```\n');
  assert.deepEqual(steps, [
    { where: 'x.md:3', why: 'a command in an indented code block' },
    { where: 'x.md:4', why: 'a command in an indented code block' },
    { where: 'x.md:9', why: 'a pwsh code block' },
  ]);
});

test('leif-pages: plain English that shares a word with a tool, and paths in backticks, still pass', () => {
  const text = [
    '# Your page',
    '',
    'The git history keeps every version, and the app has zero npm packages.',
    'A yarn test for pilling comes before the linen order.',
    'Read `agency/docs/23-ways.md`, and a `.cmd` file is never sent.',
    '',
    '```',
    'make sure the parcel is with you before the first wash,',
    'open the care label and start with a cold wash.',
    '```',
  ].join('\n');
  assert.deepEqual(terminalSteps('docs/leif.md', text), []);
});

test('leif-pages: a command bare in prose, or as a list or quote item, fails by an argument shaped like a command (R2 adversary, 9 Nov 2026)', () => {
  const tool = 'a terminal tool with an argument';
  const script = 'a script run by its path';
  const cases = [
    // the adversary's eight
    ['1. brew install node', tool],
    ['brew install node', tool],
    ['> brew install gh', tool],
    ['- cd ~/Desktop/joyisfree', tool],
    ['2. claude --resume', tool],
    ['Then open PowerShell and type powercfg /change standby-timeout-ac 0 and press Enter.', tool],
    ['Paste this into Terminal: curl -fsSL https://example.com/install.sh | bash', tool],
    ['* python3 -m http.server', tool],
    // each argument that makes a tool a step, alone on its line
    ['Open Terminal and type cd ../joyisfree, then press Enter.', tool],
    ['Open Terminal and type cd /Users/leif/joyisfree, then press Enter.', tool],
    ['In PowerShell, type cd C:\\Users\\leif\\joyisfree and press Enter.', tool],
    ['Then type choco install nodejs-lts and press Enter.', tool],
    ['- yarn install', tool],
    ['Then type winget install OpenJS.NodeJS.LTS and press Enter.', tool],
    ['- nvm install 22', tool],
    ['Type docker run hello-world and press Enter.', tool],
    ['2) gh auth login', tool],
    ['> gh auth login', tool],
    ['Then type sudo mkdir backups and press Enter.', tool],
    ['Then paste curl https://example.com/install.sh into Terminal.', tool],
    ['Then paste wget https://example.com/fonts.zip into Terminal.', tool],
    ['1. ./setup.sh', script],
    ['Then run .\\keep-awake-undo.ps1 in PowerShell.', script],
  ];
  for (const [text, why] of cases) assert.deepEqual(terminalSteps('docs/leif.md', `# Sitting\n\n${text}\n`), [{ where: 'docs/leif.md:3', why }], text);
});

test('leif-pages: plain English that names a tool, a colour or a coffee passes outside code (R2 verifier, 9 Nov 2026)', () => {
  const text = [
    '# Your page, Leif',
    '',
    'The choco brown hoodie sold out first, and no sudo is needed for any of this: Claude keeps the passwords and the',
    'ssh key in your password manager.',
    '',
    '- ssh key: in your password manager',
    '- gh token: in your password manager',
    '> ls is short for list.',
    '- rm stands for remove, if you ever see it.',
    '- cp is the copy command Claude uses.',
    'sed quis custodiet ipsos custodes',
    "grep for the price in the PDF is Claude's job.",
    "The export /import step is Claude's.",
    'The cold brew update on the menu is Thursday.',
    'Brew a coffee, then curl up with the draft.',
    '- cd and vinyl bundle',
    'Machine wash ~ 30 degrees, inside out.',
    'keep-awake.ps1 is the file Claude runs to stop the PC sleeping, and setup.sh is its Mac twin.',
    'The [undo script](./keep-awake-undo.ps1) is there if you want to read it.',
  ].join('\n');
  assert.deepEqual(terminalSteps('docs/leif.md', text), []);
  const r = leifPages(at(repo({ ...PAGES_OK, 'docs/leif.md': `${text}\n` })));
  assert.equal(r.status, 'PASS', r.detail);
});

test('leif-pages: prose that shares a word with a tool, or names one as a noun, still passes outside code', () => {
  const text = [
    '# Your page',
    '',
    'Claude can export the CSV from the store, and the edges curl after the first wash.',
    'export the orders first, and the cold brew tap can wait.',
    '- export the CSV from the store',
    '- cat ~40 kg of linen, and the export / import of orders is Claude\'s.',
    'The studio cat - a tabby - sleeps on the linen.',
    'Claude keeps the ssh key and the gh token in your password manager.',
    'Cold wash /hang dry, inside out.',
  ].join('\n');
  assert.deepEqual(terminalSteps('docs/leif.md', text), []);
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
