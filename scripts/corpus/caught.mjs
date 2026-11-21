// What prove's scanners must catch, and what they are known to miss, built at runtime from pieces: no secret-shaped
// text, seed or command ever sits in this file, so the repo's own secrets and leif-pages checks stay clean while the
// tests in scripts/prove.test.mjs run every case. Each case is { name, kind, file, text }, where kind is the secret
// kind secretHits must report ('bip39-seed', 'stripe', ...) or 'terminal-step' for a page terminalSteps must flag.
//
//   positives()          one or more per seed spelling prove catches, a session cookie, every SECRET_SHAPES kind
//                        and a terminal step on a page Leif reads: each must be caught
//   KNOWN_MISSES         the gaps already recorded, each asserted still missed, so the gap is written in code: when a
//                        scanner change catches one, its test goes red and the case moves to positives()
//   KNOWN_FALSE_ALARMS   owner-shaped text the scanners still flag (galxe-desk/docs/errors.md, 9 Nov 2026, "Known and
//                        left"), asserted still flagged for the same reason
import { createHash } from 'node:crypto';
import { BIP39_WORDS } from '../prove.mjs';

const j = (...parts) => parts.join('');

// Fixed pseudo-random characters, so a case looks like a real key (mixed case and digits) and never changes.
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
const B58 = ALNUM.split('').filter((c) => !'0OIl'.includes(c)).join('');
const B64 = ALNUM + '+/';
const URLSAFE = ALNUM + '_-';

/** n BIP39 words spread over the list, all different, starting from a different place for each `from`. */
export const seedWords = (n, from = 0) => Array.from({ length: n }, (_, i) => BIP39_WORDS[(i * 173 + from * 31 + 600) % 2048]);

/** The BIP39 mnemonic of `entropy` (16 to 32 bytes): its bits and the first checksum bits of its sha256, 11 to a word. */
export function mnemonic(entropy) {
  const bits = (bytes) => [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('');
  const all = bits(entropy) + bits(createHash('sha256').update(entropy).digest()).slice(0, (entropy.length * 8) / 32);
  return Array.from({ length: all.length / 11 }, (_, i) => BIP39_WORDS[parseInt(all.slice(i * 11, i * 11 + 11), 2)]);
}

/** Words in groups of `size`, the groups joined by ", ". */
const grouped = (words, size) => Array.from({ length: Math.ceil(words.length / size) }, (_, i) => words.slice(i * size, i * size + size).join(' ')).join(', ');

const AUTH = j('auth', '_token');
const CT0 = j('ct', '0');
const COOKIE_EXPORT = (name, value) => ['[', '  {', '    "domain": ".x.com",', '    "hostOnly": false,', '    "httpOnly": true,', `    "name": "${name}",`, '    "path": "/",', '    "secure": true,', `    "value": "${value}"`, '  }', ']'].join('\n');

/** One case for every shape on prove's SECRET_SHAPES list, and the 0x key it tests apart. */
function shapeCases() {
  const one = (kind, text) => ({ name: `the ${kind} shape`, kind, file: 'notes.txt', text });
  return [
    one('private-key-pem', j('-----BEGIN ', 'RSA PRIVATE', ' KEY-----')),
    one('jwt', j('SESSION=', 'ey', 'J', chars(URLSAFE, 20, 101), '.', 'ey', 'J', chars(URLSAFE, 40, 102), '.', chars(URLSAFE, 43, 103))),
    one('stripe', j('STRIPE_SECRET=', 'sk', '_live_', chars(ALNUM, 24, 104))),
    one('github', j('token: ', 'gh', 'p_', chars(ALNUM, 36, 105))),
    one('slack', j('SLACK=', 'xo', 'xb-', chars(DIGITS, 12, 106), '-', chars(DIGITS, 13, 107), '-', chars(ALNUM, 24, 108))),
    one('aws-access-key-id', j('AK', 'IA', chars(UPPER + DIGITS, 16, 109))),
    one('aws-secret-key', j('aws_secret', '_access_key = ', chars(B64, 40, 110))),
    one('google-api-key', j('MAPS=', 'AI', 'za', chars(URLSAFE, 35, 111))),
    one('shopify', j('SHOPIFY=', 'shp', 'at_', chars(HEX, 32, 112))),
    one('klaviyo', j('KLAVIYO=', 'pk', '_', chars(LOWER + DIGITS, 34, 113))),
    one('anthropic', j('KEY=', 'sk', '-ant-', 'api03-', chars(URLSAFE, 93, 114))),
    one('openai', j('KEY=', 'sk', '-proj-', chars(URLSAFE, 48, 115))),
    one('supabase-secret', j('SUPABASE=', 'sb', '_secret_', chars(URLSAFE, 32, 116))),
    one('cloudinary-url', j('CLOUDINARY_URL=cloud', 'inary://', chars(DIGITS, 15, 117), ':', chars(URLSAFE, 27, 118), '@studio')),
    one('x-session-cookie', j('cookie: ', AUTH, '=', chars(HEX, 40, 119))),
    one('solana-base58-key', j('wallet: ', chars(B58, 88, 120))),
    one('keypair-byte-array', `[${Array.from({ length: 64 }, (_, i) => (i * 41 + 7) % 256).join(',')}]`),
    one('labelled-hex-key', j('PRIVATE', '_KEY=', chars(HEX, 64, 121))),
    one('labelled-seed', j('mnem', 'onic: ', seedWords(12, 1).join(' '))),
    one('labelled-secret', j('api', '_key=', 'A1', chars(ALNUM, 30, 122))),
    one('extended-private-key', j('xp', 'rv', chars(B58, 107, 123))),
    one('wif-key', j('wif: ', 'K', chars(B58, 51, 124))),
    one('url-password', j('DATABASE_URL=postgres', 'ql://app:', 'a1', chars(ALNUM, 20, 125), '@db.example.com:5432/app')),
    one('bearer-token', j('Authorization: ', 'Bearer ', 'a1', chars(HEX, 40, 126))),
    one('npm-token', j('np', 'm_', chars(ALNUM, 36, 127))),
    one('telegram-bot-token', j('TG=', chars('123456789', 9, 128), ':A', 'A', chars(URLSAFE, 33, 129))),
    one('webhook-secret', j('wh', 'sec_', chars(ALNUM, 32, 130))),
    one('google-oauth-secret', j('GOC', 'SPX-', chars(URLSAFE, 28, 131))),
    one('0x-hex-key', j('wallet key ', '0', 'x', chars(HEX, 64, 132))),
  ];
}

/** Everything the scanners must catch, built fresh on each call. */
export function positives() {
  const w = seedWords(12, 2);
  const seed = (name, text, file = 'wallet-backup.txt') => ({ name, kind: 'bip39-seed', file, text });
  const missingComma = [w[0], w[1], `${w[2]} ${w[3]}`, ...w.slice(4)].join(', ');
  return [
    seed('a seed on one line', w.join(' ')),
    seed('a seed numbered down a page', w.map((x, i) => `${i + 1}. ${x}`).join('\n')),
    seed('a seed one word to a line', w.join('\n')),
    seed('a seed as a comma list', w.join(', ')),
    seed('a seed as a comma list with no spaces', w.join(','), 'wallet-backup.csv'),
    seed('a seed cut in two by one comma (two items are not a list)', `${w.slice(0, 6).join(' ')}, ${w.slice(6).join(' ')}`),
    seed('a seed as a comma list with one comma missing (a list of phrases has no single word)', missingComma),
    { name: 'an X session cookie in a Netscape cookies.txt', kind: 'x-session-cookie', file: 'cookies.txt', text: ['# Netscape HTTP Cookie File', ['.x.com', 'TRUE', '/', 'TRUE', '1790000000', AUTH, chars(HEX, 40, 133)].join('\t')].join('\n') },
    { name: 'an X session cookie in a browser extension\'s JSON export', kind: 'x-session-cookie', file: 'x-cookies.json', text: COOKIE_EXPORT(CT0, chars(HEX, 160, 134)) },
    ...shapeCases(),
    { name: 'a terminal step on a page Leif reads', kind: 'terminal-step', file: 'docs/leif.md', text: j('# Your sitting\n\nOpen a terminal, type ', 'npm', ' run prove and press Enter.\n') },
    { name: 'a shell code block on a draft Leif reads', kind: 'terminal-step', file: 'agency/drafts/launch.md', text: j('Paste this:\n\n```', 'bash', '\ncd ~/Desktop/joyisfree\n```\n') },
  ];
}

const miss = (name, why, text) => ({ name, why, kind: 'bip39-seed', file: 'wallet-backup.txt', text });

/** The gaps already recorded, each built fresh; scripts/prove.test.mjs asserts each is still missed. */
export const KNOWN_MISSES = [
  miss('a seed as comma-separated pairs', 'a comma list of three or more phrases is prose, read phrase by phrase (prove.mjs seedParts, 21 Nov 2026)', grouped(seedWords(12, 4), 2)),
  miss('a seed as comma-separated threes', 'the same prose rule: four phrases of three words', grouped(seedWords(12, 5), 3)),
  miss('a seed as comma-separated fours', 'the same prose rule: three phrases of four words', grouped(seedWords(12, 6), 4)),
  miss('a seed as comma-separated pairs over two lines', 'each line is a prose comma list, whose phrases are never a row of seed words down a page (prove.mjs seedEnds); found by the round-2 verifier, 21 Nov 2026', (() => { const s = seedWords(12, 8); return [grouped(s.slice(0, 6), 2), grouped(s.slice(6), 2)].join('\n'); })()),
  miss('a seed as a comma list that ends with "and"', 'a word not on the BIP39 list breaks a run (prove.mjs seedRunIn) and "and" is not on it, so the list reads as eleven words and one; an English list of twelve colours ends the same way, so it is left (round-2 verifier, 21 Nov 2026)', (() => { const s = seedWords(12, 9); return `${s.slice(0, 11).join(', ')} and ${s[11]}`; })()),
  miss('a seed with three of its twelve words repeated', 'a run with three repeats reads as a stock list; about 4 in a million real seeds have them (prove.mjs seedLike, 9 Nov 2026)', (() => { const s = seedWords(12, 7); return [...s.slice(0, 9), s[1], s[4], s[8]].join(' '); })()),
  miss('the published BIP39 test vector from all-zero entropy', 'patterned entropy repeats its words by design, and the vector is public, so it guards nothing (prove.mjs seedLike)', mnemonic(Buffer.alloc(16, 0)).join(' ')),
  miss('the published BIP39 test vector from 0x7f entropy', 'eight words said one and a half times: the same public, patterned case', mnemonic(Buffer.alloc(16, 0x7f)).join(' ')),
];

// Two lists of six, each after a word not on the BIP39 list, so this file's own lines never hold the run of twelve.
const WARM = ['black', 'cream', 'olive', 'sand', 'coral', 'ivory'];
const COOL = ['stone', 'ocean', 'gold', 'silver', 'forest', 'lemon'];

/** Owner-shaped text the scanners are recorded as still flagging; scripts/prove.test.mjs asserts each still is. */
export const KNOWN_FALSE_ALARMS = [
  { name: 'a caption of twelve colour hashtags', why: 'twelve BIP39 colours in a row read as a seed by the one-line rule; no comma list of phrases to read apart', kind: 'bip39-seed', file: 'caption.md', text: `New this drop: ${[...WARM, ...COOL].map((c) => `#${c}`).join(' ')}` },
  { name: 'a sentence where a tool word takes a dash', why: 'export followed by a dash and a letter reads as a flag (prove.mjs PROSE_TOOL)', kind: 'terminal-step', file: 'docs/leif.md', text: j('Claude can ', 'export', ' -GST totals for the quarter.') },
];
