#!/usr/bin/env node
// One command that answers "is it true?" for this whole repo.
//
//   npm run prove
//
// Every summary Claude gives about this repo should be answerable by this command, and it exits 0 only when every
// required check holds. It exists because a green test suite on its own proved too little here more than once: the
// "27 of 27 guards bite" claim was a hand count until a mutation check disproved it, a test file was once missing
// entirely while `npm test` still passed, a draft with a known-wrong formula nearly went to the remote, and on
// 8 Nov 2026 the secrets line printed PASS while it caught 1 of 13 realistic secret shapes.
//
// Required (any FAIL exits 1; a NOTE is printed, does not fail the run, and is never a PASS):
//   1. tests       every *.test.mjs in the repo, run together, green, and at least one test per suite directory
//   2. mutations   every guard in the repo is removed in turn and some test goes red (galxe-desk/scripts/mutate.mjs)
//   3. secrets     no key, token, seed phrase or private-key shape in the tree (tracked, and untracked but not
//                  ignored), in what the next commit would record (the index), or in any line or message ever
//                  committed (`git log -p --all`). One list of shapes. A binary file skipped is counted in the PASS.
//   4. privacy     agency/pilot/ (customer-derived data) is ignored and nothing under it is tracked
//   5. studio      the studio repo (joyisfree1) is clean, and no claude/galxe-* branch, local or remote, holds a
//                  commit its main does not. NOTE, never PASS, when it is not on this machine.
//   6. decisions   agency/calendar.json exists, reads as a calendar, and no open item's date is before today in Sydney
//   7. state       docs/state.md exists in 15 lines or fewer, and CLAUDE.md's first instruction names it
//   8. leif-pages  Leif's pages hold no terminal step: no "npm run", npm, npx or git command, no node command, no
//                  shell command in backticks, <code> or a code block, and in prose no terminal tool with an argument
//                  shaped like a command and no script run by its path
//   9. facts       agency/facts.json: every fact has a source and a date. NOTE when its asOf is over 14 days old.
// Reported, never failed:
//  10. rulebook    `desk:check` is honestly incomplete until the live crawl runs; it is shown, not hidden
//
// Every check takes one context, { root, studio, now, git }, and reads the repo, the clock and git only through it,
// so prove.test.mjs runs each one on fixtures in a temp dir with a stand-in for git.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIRS = ['galxe-desk/scripts', 'agency/scripts', '.claude/skills/joy-revise/scripts', 'scripts'];
const DAY = 86_400_000;
const MAX_BUFFER = 256 * 1024 * 1024;

const pass = (detail) => ({ status: 'PASS', detail });
const fail = (detail) => ({ status: 'FAIL', detail });
const note = (detail) => ({ status: 'NOTE', detail });
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** The run's context. Tests pass their own root, studio path, clock and git; the command uses the real ones. */
export function context(over = {}) {
  const root = over.root ?? REPO;
  return {
    root,
    studio: resolve(root, '..', 'joyisfree1'),
    now: Date.now(),
    git: (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: MAX_BUFFER }),
    ...over,
  };
}

// ------------------------------------------------------------------------------------------------------------- dates

/** A strict calendar day, YYYY-MM-DD and real (never 2026-02-30, 9/11/2026 or a bare number), as a day count; else null. */
export function dayNumber(v) {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / DAY;
}

/**
 * Today's date in Sydney, where Leif is, as YYYY-MM-DD. Not the UTC date: for ten or eleven hours of every Sydney
 * morning the two differ. Built on each call, so a machine without the time zone fails the check that asked, not
 * the whole run.
 */
export function sydneyDay(now) {
  const t = Number(now);
  if (!Number.isFinite(t)) throw new Error(`now (${now}) is not a time`);
  const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(({ type, value }) => [type, value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  if (dayNumber(day) == null) throw new Error(`could not read the Sydney date (got ${day})`);
  return day;
}

// ----------------------------------------------------------------------------------------------------------- secrets
// The shapes never allowed in this repo: in the tree, in the index or in its history. This is the only list. The scan
// reads the files itself instead of pre-filtering with git grep, because until 8 Nov 2026 that pre-filter was a
// second, hand-copied regex and a shape added here could never fire. Each shape has a fixture in prove.test.mjs and a
// mutation in mutate.mjs. Stripe publishable keys (pk_live_, pk_test_) are public by design and are not on it.
// 8 Nov 2026, second audit: a camelCase or short label before a 64-hex key, xprv and WIF keys, a URL holding a
// password, Bearer, npm, Telegram, whsec_ and GOCSPX- tokens and "API key:" with a space all passed, and are on it now.
// A URL password and a Bearer token count only with a letter and a digit in them, as labelled-secret does, so
// placeholders such as `user:password@` and `Bearer YOUR_TOKEN` stay out. 9 Nov 2026: an X session cookie in a
// Netscape cookies.txt (name, a tab, the value) passed, and is on x-session-cookie now; one in a browser extension's
// JSON export is read across lines (COOKIE_NAME, below).
export const SECRET_SHAPES = [
  { name: 'private-key-pem', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/ },
  { name: 'stripe', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'github', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/ },
  { name: 'slack', re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{10,}/ },
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { name: 'aws-secret-key', re: /aws[\w-]{0,30}?secret[\w-]{0,30}?["'`]?\s*[:=]\s*["'`]?[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])/i },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/ },
  { name: 'shopify', re: /\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{32,}/ },
  { name: 'klaviyo', re: /\bpk_[A-Za-z0-9]{30,}/ },
  { name: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'openai', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'supabase-secret', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'cloudinary-url', re: /\bcloudinary:\/\/\d{6,}:[A-Za-z0-9_-]{16,}@/ },
  { name: 'x-session-cookie', re: /\b(?:auth_token|ct0)(?:["'`]?\s*[:=]\s*["'`]?|\t)[A-Fa-f0-9]{32,}/ },
  { name: 'solana-base58-key', re: /(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{86,88}(?![A-Za-z0-9])/ },
  { name: 'keypair-byte-array', re: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/ },
  { name: 'labelled-hex-key', re: /(?:privatekey|privkey|secretkey|(?<![A-Za-z0-9])(?:private|secret|key|(?:priv|pk)(?![a-z]))|_pk(?![a-z]))[\w ]{0,20}?["'`]?\s*[:=]?\s*["'`]?(?<![A-Fa-f0-9])[A-Fa-f0-9]{64}(?![A-Za-z0-9])/i },
  { name: 'labelled-seed', re: /\b(?:seed|mnemonic|recovery)(?:[ _-]?(?:phrase|words?))?["'`]?\s*[:=]\s*["'`]?(?:[a-z]+[\s,]+){11,}[a-z]+/i },
  { name: 'labelled-secret', re: /(?:api[ _-]?key|api[ _-]?secret|access[ _-]?key|secret[ _-]?key|client[ _-]?secret|token|secret|passw(?:or)?d)["'`]?\s*[:=]\s*["'`]?(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])[\w+/=-]{20,}/i },
  { name: 'extended-private-key', re: /\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,}/ },
  { name: 'wif-key', re: /(?<![A-Za-z0-9+/=])(?:5[HJK][1-9A-HJ-NP-Za-km-z]{49}|[KL][1-9A-HJ-NP-Za-km-z]{51})(?![A-Za-z0-9+/=])/ },
  { name: 'url-password', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:(?![$<[{%*])(?=[^\s@/\\]*\d)(?=[^\s@/\\]*[A-Za-z])[^\s@/\\]{6,}@/i },
  { name: 'bearer-token', re: /\b[Bb]earer\s+(?=[\w.~+/-]*\d)(?=[\w.~+/-]*[A-Za-z])[\w.~+/-]{20,}/ },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/ },
  { name: 'telegram-bot-token', re: /\b\d{8,10}:AA[\w-]{33}(?![\w-])/ },
  { name: 'webhook-secret', re: /\bwhsec_[A-Za-z0-9+/=]{24,}/ },
  { name: 'google-oauth-secret', re: /\bGOCSPX-[\w-]{24,}/ },
];

// A 0x-prefixed 64-hex string is a wallet's private key until shown otherwise. A public DAO proposal id inside a
// Galxe docs URL is the one known false positive (galxe-desk/rulebook/read-2026-10-30.json), so the URL is cut out
// before the line is tested. A key written beside one is still caught; until 8 Nov 2026 the whole line went through.
const HEX64 = /\b0x[a-fA-F0-9]{64}\b/;
const ALLOWED_HEX_URL = /dao\.galxe\.com\/#\/proposal\/0x[a-fA-F0-9]{64}/g;

// Two committed lines of fake fixtures in the first prove.test.mjs (commit 3978483, 8 Nov 2026), from before the
// fixtures were built from pieces at runtime (6f8f1c8): a PEM header with no key body, and an AWS key id spelt from
// the alphabet. History is not rewritten for them, so each is let through by commit, path, line and the sha256 of
// its exact text. The same text anywhere else, or other text on those lines, is still caught.
export const KNOWN_FAKES = [
  { where: '3978483:scripts/prove.test.mjs:10', sha256: 'd9533fffbf15be12d6bc1b4d091941dba5781775c3309fa0d856a75d6fae6deb' },
  { where: '3978483:scripts/prove.test.mjs:15', sha256: '745d03317cb0077e24dd0ce881f409ca2742ab56f8fa89363b6eda1b57e7670e' },
];
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

/** The lines with each known fake's text emptied, and how many were. Its place is kept, so line numbers stay true. */
export function withoutKnownFakes(lines, fakes = KNOWN_FAKES) {
  let allowed = 0;
  const out = lines.map((l) => {
    if (!fakes.some((f) => f.where === l.where && f.sha256 === sha256(l.text))) return l;
    allowed += 1;
    return { where: l.where, text: '' };
  });
  return { lines: out, allowed };
}

// The official BIP39 English list, 2048 words, eight to a line. The number after each line is the position of its
// first word, and it also keeps the line from reading as one row of a seed written down a page, so this file does
// not flag itself. BIP39_SHA256 is the hash of the published file (bitcoin/bips, bip-0039/english.txt, one word per
// line). A changed, dropped or added word fails the secrets check closed, because a wrong list misses real seeds.
const BIP39_LINES = [
  'abandon ability able about above absent absorb abstract', // 1
  'absurd abuse access accident account accuse achieve acid', // 9
  'acoustic acquire across act action actor actress actual', // 17
  'adapt add addict address adjust admit adult advance', // 25
  'advice aerobic affair afford afraid again age agent', // 33
  'agree ahead aim air airport aisle alarm album', // 41
  'alcohol alert alien all alley allow almost alone', // 49
  'alpha already also alter always amateur amazing among', // 57
  'amount amused analyst anchor ancient anger angle angry', // 65
  'animal ankle announce annual another answer antenna antique', // 73
  'anxiety any apart apology appear apple approve april', // 81
  'arch arctic area arena argue arm armed armor', // 89
  'army around arrange arrest arrive arrow art artefact', // 97
  'artist artwork ask aspect assault asset assist assume', // 105
  'asthma athlete atom attack attend attitude attract auction', // 113
  'audit august aunt author auto autumn average avocado', // 121
  'avoid awake aware away awesome awful awkward axis', // 129
  'baby bachelor bacon badge bag balance balcony ball', // 137
  'bamboo banana banner bar barely bargain barrel base', // 145
  'basic basket battle beach bean beauty because become', // 153
  'beef before begin behave behind believe below belt', // 161
  'bench benefit best betray better between beyond bicycle', // 169
  'bid bike bind biology bird birth bitter black', // 177
  'blade blame blanket blast bleak bless blind blood', // 185
  'blossom blouse blue blur blush board boat body', // 193
  'boil bomb bone bonus book boost border boring', // 201
  'borrow boss bottom bounce box boy bracket brain', // 209
  'brand brass brave bread breeze brick bridge brief', // 217
  'bright bring brisk broccoli broken bronze broom brother', // 225
  'brown brush bubble buddy budget buffalo build bulb', // 233
  'bulk bullet bundle bunker burden burger burst bus', // 241
  'business busy butter buyer buzz cabbage cabin cable', // 249
  'cactus cage cake call calm camera camp can', // 257
  'canal cancel candy cannon canoe canvas canyon capable', // 265
  'capital captain car carbon card cargo carpet carry', // 273
  'cart case cash casino castle casual cat catalog', // 281
  'catch category cattle caught cause caution cave ceiling', // 289
  'celery cement census century cereal certain chair chalk', // 297
  'champion change chaos chapter charge chase chat cheap', // 305
  'check cheese chef cherry chest chicken chief child', // 313
  'chimney choice choose chronic chuckle chunk churn cigar', // 321
  'cinnamon circle citizen city civil claim clap clarify', // 329
  'claw clay clean clerk clever click client cliff', // 337
  'climb clinic clip clock clog close cloth cloud', // 345
  'clown club clump cluster clutch coach coast coconut', // 353
  'code coffee coil coin collect color column combine', // 361
  'come comfort comic common company concert conduct confirm', // 369
  'congress connect consider control convince cook cool copper', // 377
  'copy coral core corn correct cost cotton couch', // 385
  'country couple course cousin cover coyote crack cradle', // 393
  'craft cram crane crash crater crawl crazy cream', // 401
  'credit creek crew cricket crime crisp critic crop', // 409
  'cross crouch crowd crucial cruel cruise crumble crunch', // 417
  'crush cry crystal cube culture cup cupboard curious', // 425
  'current curtain curve cushion custom cute cycle dad', // 433
  'damage damp dance danger daring dash daughter dawn', // 441
  'day deal debate debris decade december decide decline', // 449
  'decorate decrease deer defense define defy degree delay', // 457
  'deliver demand demise denial dentist deny depart depend', // 465
  'deposit depth deputy derive describe desert design desk', // 473
  'despair destroy detail detect develop device devote diagram', // 481
  'dial diamond diary dice diesel diet differ digital', // 489
  'dignity dilemma dinner dinosaur direct dirt disagree discover', // 497
  'disease dish dismiss disorder display distance divert divide', // 505
  'divorce dizzy doctor document dog doll dolphin domain', // 513
  'donate donkey donor door dose double dove draft', // 521
  'dragon drama drastic draw dream dress drift drill', // 529
  'drink drip drive drop drum dry duck dumb', // 537
  'dune during dust dutch duty dwarf dynamic eager', // 545
  'eagle early earn earth easily east easy echo', // 553
  'ecology economy edge edit educate effort egg eight', // 561
  'either elbow elder electric elegant element elephant elevator', // 569
  'elite else embark embody embrace emerge emotion employ', // 577
  'empower empty enable enact end endless endorse enemy', // 585
  'energy enforce engage engine enhance enjoy enlist enough', // 593
  'enrich enroll ensure enter entire entry envelope episode', // 601
  'equal equip era erase erode erosion error erupt', // 609
  'escape essay essence estate eternal ethics evidence evil', // 617
  'evoke evolve exact example excess exchange excite exclude', // 625
  'excuse execute exercise exhaust exhibit exile exist exit', // 633
  'exotic expand expect expire explain expose express extend', // 641
  'extra eye eyebrow fabric face faculty fade faint', // 649
  'faith fall false fame family famous fan fancy', // 657
  'fantasy farm fashion fat fatal father fatigue fault', // 665
  'favorite feature february federal fee feed feel female', // 673
  'fence festival fetch fever few fiber fiction field', // 681
  'figure file film filter final find fine finger', // 689
  'finish fire firm first fiscal fish fit fitness', // 697
  'fix flag flame flash flat flavor flee flight', // 705
  'flip float flock floor flower fluid flush fly', // 713
  'foam focus fog foil fold follow food foot', // 721
  'force forest forget fork fortune forum forward fossil', // 729
  'foster found fox fragile frame frequent fresh friend', // 737
  'fringe frog front frost frown frozen fruit fuel', // 745
  'fun funny furnace fury future gadget gain galaxy', // 753
  'gallery game gap garage garbage garden garlic garment', // 761
  'gas gasp gate gather gauge gaze general genius', // 769
  'genre gentle genuine gesture ghost giant gift giggle', // 777
  'ginger giraffe girl give glad glance glare glass', // 785
  'glide glimpse globe gloom glory glove glow glue', // 793
  'goat goddess gold good goose gorilla gospel gossip', // 801
  'govern gown grab grace grain grant grape grass', // 809
  'gravity great green grid grief grit grocery group', // 817
  'grow grunt guard guess guide guilt guitar gun', // 825
  'gym habit hair half hammer hamster hand happy', // 833
  'harbor hard harsh harvest hat have hawk hazard', // 841
  'head health heart heavy hedgehog height hello helmet', // 849
  'help hen hero hidden high hill hint hip', // 857
  'hire history hobby hockey hold hole holiday hollow', // 865
  'home honey hood hope horn horror horse hospital', // 873
  'host hotel hour hover hub huge human humble', // 881
  'humor hundred hungry hunt hurdle hurry hurt husband', // 889
  'hybrid ice icon idea identify idle ignore ill', // 897
  'illegal illness image imitate immense immune impact impose', // 905
  'improve impulse inch include income increase index indicate', // 913
  'indoor industry infant inflict inform inhale inherit initial', // 921
  'inject injury inmate inner innocent input inquiry insane', // 929
  'insect inside inspire install intact interest into invest', // 937
  'invite involve iron island isolate issue item ivory', // 945
  'jacket jaguar jar jazz jealous jeans jelly jewel', // 953
  'job join joke journey joy judge juice jump', // 961
  'jungle junior junk just kangaroo keen keep ketchup', // 969
  'key kick kid kidney kind kingdom kiss kit', // 977
  'kitchen kite kitten kiwi knee knife knock know', // 985
  'lab label labor ladder lady lake lamp language', // 993
  'laptop large later latin laugh laundry lava law', // 1001
  'lawn lawsuit layer lazy leader leaf learn leave', // 1009
  'lecture left leg legal legend leisure lemon lend', // 1017
  'length lens leopard lesson letter level liar liberty', // 1025
  'library license life lift light like limb limit', // 1033
  'link lion liquid list little live lizard load', // 1041
  'loan lobster local lock logic lonely long loop', // 1049
  'lottery loud lounge love loyal lucky luggage lumber', // 1057
  'lunar lunch luxury lyrics machine mad magic magnet', // 1065
  'maid mail main major make mammal man manage', // 1073
  'mandate mango mansion manual maple marble march margin', // 1081
  'marine market marriage mask mass master match material', // 1089
  'math matrix matter maximum maze meadow mean measure', // 1097
  'meat mechanic medal media melody melt member memory', // 1105
  'mention menu mercy merge merit merry mesh message', // 1113
  'metal method middle midnight milk million mimic mind', // 1121
  'minimum minor minute miracle mirror misery miss mistake', // 1129
  'mix mixed mixture mobile model modify mom moment', // 1137
  'monitor monkey monster month moon moral more morning', // 1145
  'mosquito mother motion motor mountain mouse move movie', // 1153
  'much muffin mule multiply muscle museum mushroom music', // 1161
  'must mutual myself mystery myth naive name napkin', // 1169
  'narrow nasty nation nature near neck need negative', // 1177
  'neglect neither nephew nerve nest net network neutral', // 1185
  'never news next nice night noble noise nominee', // 1193
  'noodle normal north nose notable note nothing notice', // 1201
  'novel now nuclear number nurse nut oak obey', // 1209
  'object oblige obscure observe obtain obvious occur ocean', // 1217
  'october odor off offer office often oil okay', // 1225
  'old olive olympic omit once one onion online', // 1233
  'only open opera opinion oppose option orange orbit', // 1241
  'orchard order ordinary organ orient original orphan ostrich', // 1249
  'other outdoor outer output outside oval oven over', // 1257
  'own owner oxygen oyster ozone pact paddle page', // 1265
  'pair palace palm panda panel panic panther paper', // 1273
  'parade parent park parrot party pass patch path', // 1281
  'patient patrol pattern pause pave payment peace peanut', // 1289
  'pear peasant pelican pen penalty pencil people pepper', // 1297
  'perfect permit person pet phone photo phrase physical', // 1305
  'piano picnic picture piece pig pigeon pill pilot', // 1313
  'pink pioneer pipe pistol pitch pizza place planet', // 1321
  'plastic plate play please pledge pluck plug plunge', // 1329
  'poem poet point polar pole police pond pony', // 1337
  'pool popular portion position possible post potato pottery', // 1345
  'poverty powder power practice praise predict prefer prepare', // 1353
  'present pretty prevent price pride primary print priority', // 1361
  'prison private prize problem process produce profit program', // 1369
  'project promote proof property prosper protect proud provide', // 1377
  'public pudding pull pulp pulse pumpkin punch pupil', // 1385
  'puppy purchase purity purpose purse push put puzzle', // 1393
  'pyramid quality quantum quarter question quick quit quiz', // 1401
  'quote rabbit raccoon race rack radar radio rail', // 1409
  'rain raise rally ramp ranch random range rapid', // 1417
  'rare rate rather raven raw razor ready real', // 1425
  'reason rebel rebuild recall receive recipe record recycle', // 1433
  'reduce reflect reform refuse region regret regular reject', // 1441
  'relax release relief rely remain remember remind remove', // 1449
  'render renew rent reopen repair repeat replace report', // 1457
  'require rescue resemble resist resource response result retire', // 1465
  'retreat return reunion reveal review reward rhythm rib', // 1473
  'ribbon rice rich ride ridge rifle right rigid', // 1481
  'ring riot ripple risk ritual rival river road', // 1489
  'roast robot robust rocket romance roof rookie room', // 1497
  'rose rotate rough round route royal rubber rude', // 1505
  'rug rule run runway rural sad saddle sadness', // 1513
  'safe sail salad salmon salon salt salute same', // 1521
  'sample sand satisfy satoshi sauce sausage save say', // 1529
  'scale scan scare scatter scene scheme school science', // 1537
  'scissors scorpion scout scrap screen script scrub sea', // 1545
  'search season seat second secret section security seed', // 1553
  'seek segment select sell seminar senior sense sentence', // 1561
  'series service session settle setup seven shadow shaft', // 1569
  'shallow share shed shell sheriff shield shift shine', // 1577
  'ship shiver shock shoe shoot shop short shoulder', // 1585
  'shove shrimp shrug shuffle shy sibling sick side', // 1593
  'siege sight sign silent silk silly silver similar', // 1601
  'simple since sing siren sister situate six size', // 1609
  'skate sketch ski skill skin skirt skull slab', // 1617
  'slam sleep slender slice slide slight slim slogan', // 1625
  'slot slow slush small smart smile smoke smooth', // 1633
  'snack snake snap sniff snow soap soccer social', // 1641
  'sock soda soft solar soldier solid solution solve', // 1649
  'someone song soon sorry sort soul sound soup', // 1657
  'source south space spare spatial spawn speak special', // 1665
  'speed spell spend sphere spice spider spike spin', // 1673
  'spirit split spoil sponsor spoon sport spot spray', // 1681
  'spread spring spy square squeeze squirrel stable stadium', // 1689
  'staff stage stairs stamp stand start state stay', // 1697
  'steak steel stem step stereo stick still sting', // 1705
  'stock stomach stone stool story stove strategy street', // 1713
  'strike strong struggle student stuff stumble style subject', // 1721
  'submit subway success such sudden suffer sugar suggest', // 1729
  'suit summer sun sunny sunset super supply supreme', // 1737
  'sure surface surge surprise surround survey suspect sustain', // 1745
  'swallow swamp swap swarm swear sweet swift swim', // 1753
  'swing switch sword symbol symptom syrup system table', // 1761
  'tackle tag tail talent talk tank tape target', // 1769
  'task taste tattoo taxi teach team tell ten', // 1777
  'tenant tennis tent term test text thank that', // 1785
  'theme then theory there they thing this thought', // 1793
  'three thrive throw thumb thunder ticket tide tiger', // 1801
  'tilt timber time tiny tip tired tissue title', // 1809
  'toast tobacco today toddler toe together toilet token', // 1817
  'tomato tomorrow tone tongue tonight tool tooth top', // 1825
  'topic topple torch tornado tortoise toss total tourist', // 1833
  'toward tower town toy track trade traffic tragic', // 1841
  'train transfer trap trash travel tray treat tree', // 1849
  'trend trial tribe trick trigger trim trip trophy', // 1857
  'trouble truck true truly trumpet trust truth try', // 1865
  'tube tuition tumble tuna tunnel turkey turn turtle', // 1873
  'twelve twenty twice twin twist two type typical', // 1881
  'ugly umbrella unable unaware uncle uncover under undo', // 1889
  'unfair unfold unhappy uniform unique unit universe unknown', // 1897
  'unlock until unusual unveil update upgrade uphold upon', // 1905
  'upper upset urban urge usage use used useful', // 1913
  'useless usual utility vacant vacuum vague valid valley', // 1921
  'valve van vanish vapor various vast vault vehicle', // 1929
  'velvet vendor venture venue verb verify version very', // 1937
  'vessel veteran viable vibrant vicious victory video view', // 1945
  'village vintage violin virtual virus visa visit visual', // 1953
  'vital vivid vocal voice void volcano volume vote', // 1961
  'voyage wage wagon wait walk wall walnut want', // 1969
  'warfare warm warrior wash wasp waste water wave', // 1977
  'way wealth weapon wear weasel weather web wedding', // 1985
  'weekend weird welcome west wet whale what wheat', // 1993
  'wheel when where whip whisper wide width wife', // 2001
  'wild will win window wine wing wink winner', // 2009
  'winter wire wisdom wise wish witness wolf woman', // 2017
  'wonder wood wool word work world worry worth', // 2025
  'wrap wreck wrestle wrist write wrong yard year', // 2033
  'yellow you young youth zebra zero zone zoo', // 2041
];
export const BIP39_WORDS = BIP39_LINES.join(' ').split(' ');
export const BIP39_SHA256 = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
const BIP39 = new Set(BIP39_WORDS);
export const SEED_WORDS = 12;
/** How many repeats twelve words in a row of a seed may hold (seedLike). */
export const SEED_REPEATS = 2;

/** True only when the list is the published one, word for word and in order. */
export function bip39Intact(words) {
  if (!Array.isArray(words) || words.length !== 2048) return false;
  return createHash('sha256').update(words.join('\n') + '\n').digest('hex') === BIP39_SHA256;
}

/**
 * True when some twelve words in a row of `words` hold at most SEED_REPEATS repeats, as a seed does: its words are
 * drawn from 2048, so a repeat is rare, while a stock list repeats its few colours and sizes ("black, small, black,
 * large"). Until 9 Nov 2026 any twelve BIP39 words were a seed, and a stock CSV of colours and sizes failed as one.
 * Measured on 9 Nov 2026 over a million random seeds of each length: 4 in a million twelve-word seeds have more than
 * two repeats in their twelve and are missed, and no 15, 18 or 24-word seed is; a stock list sorted by colour or by
 * size, over 30 BIP39 colours and 10 sizes, never holds more than 8 different words in any twelve in a row. A list in
 * no order, of six colours or more and four sizes or more, sometimes holds 10 and fails closed. Not caught, on purpose:
 * the published BIP39 test vectors made from patterned entropy (from all-zero entropy, "abandon" eleven times and
 * then "about"; from 0x7f bytes, eight words said one and a half times), which repeat by design and are public, so
 * they guard nothing.
 */
export function seedLike(words) {
  for (let end = SEED_WORDS; end <= words.length; end++) if (new Set(words.slice(end - SEED_WORDS, end)).size >= SEED_WORDS - SEED_REPEATS) return true;
  return false;
}

/**
 * True when one line holds a seed: a run of BIP39 words that seedLike reads as one. Anything but a letter separates
 * words, so numbering, commas and quotes hide nothing.
 */
export function seedRun(text) {
  let run = [];
  for (const t of String(text).split(/[^A-Za-z]+/)) {
    if (!t) continue;
    run = BIP39.has(t.toLowerCase()) ? [...run.slice(1 - SEED_WORDS), t.toLowerCase()] : [];
    if (seedLike(run)) return true;
  }
  return false;
}

// Numbering and bullets around seed words neither count nor break a row: 1  1.  1)  1:  #1  (1)  1st  w1  word1  word_1
// in any case and, once quotes are dropped, a JSON key "1": or "w1":. Anything else that is not a BIP39 word breaks it,
// `//` and `##` included. Until 9 Nov 2026 the ordinals and the w1 and word1 labels broke the row, so they hid a seed.
// A number is numbering only when a word follows it ("1,abandon", "| 1 | abandon |"); after its words it is a count, as
// in a stock CSV's "black,small,2", and breaks the row. The words just before a number are its label, not seed words:
// "Word 1: rifle" and "Seed word 1: rifle" are the word rifle, so a label said on every line is not read as repeats.
const SEED_NUMBER = /^(?:#?\d{1,2}(?:st|nd|rd|th)?[.):]?|\(\d{1,2}\)[.:]?|(?:w|word)[_-]?\d{1,2}[.):]?)$/i;
const SEED_BULLET = /^[-*•]+$/;
const NUMBERING = Symbol('numbering');

/** One token of a row: its BIP39 word in lower case; NUMBERING; '' for a bullet or nothing; null for anything else. */
function seedMark(raw) {
  const t = raw.split(/["'`]/).join('');
  if (!t || SEED_BULLET.test(t)) return '';
  if (SEED_NUMBER.test(t)) return NUMBERING;
  const w = t.replace(/^(?:#?\d{1,2}[.):]|\(\d{1,2}\))/, '').replace(/^[([{]+|[,;.:)\]}]+$/g, '').toLowerCase();
  return BIP39.has(w) ? w : null;
}

/**
 * One line read as a row of a seed: the BIP39 words that lead it, the ones that end it, and all of them when it is
 * nothing but BIP39 words, numbering, bullets, table bars and JSON punctuation (else none). Spaces, `|`, commas and
 * semicolons separate tokens, so a markdown table's cells and a CSV's columns (`1,about`, `1;about`) read as words;
 * until 9 Nov 2026 a CSV row was one token, not a word, and a seed saved as a spreadsheet passed.
 */
// A CSV row is read as cells only in the one shape a seed backup takes: two cells, its number first ("1,abandon",
// "1;abandon", "\"1\",\"abandon\""). A wider row, or one without its number first, is a product sheet's ("1,dress,black",
// "dress,black"), and its cells are never seed words: the third round of verifiers, 9 Nov 2026, found a sheet of BIP39
// pieces and colours failing as a seed when every comma and semicolon split a row.
const SEED_CELLS = /^\s*["']?(#?\d{1,2}(?:st|nd|rd|th)?|\(\d{1,2}\)|(?:w|word)[_-]?\d{1,2})["']?\s*[,;]\s*["']?([A-Za-z]+)["']?\s*[,;]?\s*$/i;

// A seed pasted as a comma list, half or more of it to a line ("abandon,ability,able,about,above,absent"), is read as
// words too: six cells or more, every one a BIP39 word. A product sheet has fewer columns, or a number or a SKU in one.
export const SEED_LIST_CELLS = 6;
/** How many words may label the next number on a line ("Seed word #2: def"); more after a numbered word is a list. */
export const SEED_LABEL_WORDS = 2;
const listCells = (s) => {
  const parts = s.split(/[,;]/).map((c) => c.trim().split(/["']/).join('').toLowerCase()).filter((c) => c !== '');
  return parts.length >= SEED_LIST_CELLS && parts.every((c) => BIP39.has(c)) ? parts : null;
};

export function seedEnds(text) {
  const cells = SEED_CELLS.exec(String(text));
  const tokens = cells ? [cells[1], cells[2]] : listCells(String(text)) ?? String(text).split(/[\s|]+/);
  const marks = tokens.map(seedMark);
  const kept = marks.map((m, i) => [m, tokens[i]]).filter(([m]) => m !== '');
  const row = [];
  const nums = []; // the numbers that number a word, in order: a seed's run on, 1, 2, 3 (secretHits joins rows by them)
  let label = 0; // where the words that may label the next number start: after the last numbered word
  let list = false; // a number that owns more than one word heads a list ("1. Jacket: black, cream, olive, sand")
  kept.forEach(([m, raw], i) => {
    if (m !== NUMBERING) row.push(m);
    else if (typeof kept[i + 1]?.[0] !== 'string') row.push(null); // a count after its words, not numbering
    else {
      const after = row.slice(label);
      if (nums.length && after.length > SEED_LABEL_WORDS && !after.includes(null)) list = true;
      if (!after.includes(null)) row.length = label; // "Word 1: rifle": the words before a number label it
      label = row.length + 1;
      nums.push(Number(/\d{1,2}/.exec(raw)[0]));
    }
  });
  if (nums.length && row.length > label && !row.slice(label).includes(null)) list = true;
  // Numbers that do not rise along one line ("5. ocean 3. ladder") are not a seed's numbering, and a numbered list of
  // several words to each number is a list: the repo's own six pieces in four colourways each failed as a seed.
  if (list || nums.some((n, i) => i > 0 && n <= nums[i - 1])) return { lead: [], trail: [], words: [], nums };
  const first = row.indexOf(null);
  if (first < 0) return { lead: row, trail: row, words: row, nums };
  return { lead: row.slice(0, first), trail: row.slice(row.lastIndexOf(null) + 1), words: [], nums };
}

/**
 * Whether a numbered row continues the run before it. A seed's numbers run on: the row's first number follows the
 * last row's last number (1. to 2.), or its first (two columns, "1. abandon  13. zoo" then "2. ability  14. ..."). A
 * row without numbers, or after a run without them, joins as before. A count first in each row ("4,black,dress",
 * "12;dress") never runs on, so a wholesale order or a restock list is not a seed (R2 verifier, round 2, 9 Nov 2026).
 */
const runsOn = (run, nums) => !nums.length || run.last == null || nums[0] === run.last + 1 || nums[0] === run.first + 1;
const numbered = (nums, run) => (nums.length ? { first: nums[0], last: nums[nums.length - 1] } : { first: run?.first ?? null, last: run?.last ?? null });

/** The secret shapes one line holds, by name. Pure, so the scanner itself is testable. */
export function secretKinds(text) {
  const s = String(text);
  const kinds = SECRET_SHAPES.filter(({ re }) => re.test(s)).map(({ name }) => name);
  if (HEX64.test(s.replace(ALLOWED_HEX_URL, ''))) kinds.push('0x-hex-key');
  if (seedRun(s)) kinds.push('bip39-seed');
  return kinds;
}

const place = (where) => {
  const m = /^(.*):(\d+)$/.exec(String(where));
  return m ? { file: m[1], n: Number(m[2]) } : { file: String(where), n: NaN };
};

// An X session cookie in a browser extension's JSON export (Cookie-Editor, EditThisCookie) is one object per cookie,
// its "name" and its "value" about six lines apart, so no one line holds the shape and until 9 Nov 2026 it passed. A
// hex "value" on the line of a "name" of auth_token or ct0, or within COOKIE_LINES lines below it in one file, is
// that cookie.
const COOKIE_NAME = /"name"\s*:\s*"(?:auth_token|ct0)"/;
const COOKIE_VALUE = /"value"\s*:\s*"[A-Fa-f0-9]{32,}"/;
export const COOKIE_LINES = 12;

/**
 * Every line that holds a secret shape, as { where, kinds }; never the text itself, so a report cannot leak it.
 * Lines arrive in order, each `where` ending in ":<line>". A run of seed words is added up down the lines of one file:
 * the words that end a line, every line that is nothing but seed words, and the words that lead the line after, and
 * it is a seed when seedLike reads it as one. So a seed written one word or four to a line, in a table, as JSON, or
 * wrapped mid-sentence onto the next line is caught, and the run may cross one blank line (two blocks of six), never
 * two. An exported cookie's name and value are read together the same way (COOKIE_NAME).
 */
export function secretHits(lines) {
  const hits = [];
  let run = null;
  let named = null; // the last line that names an X session cookie, as { file, n }
  for (const { where, text } of lines) {
    const kinds = secretKinds(text);
    const at = place(where);
    if (COOKIE_NAME.test(text)) named = at;
    if (named && named.file === at.file && at.n - named.n <= COOKIE_LINES && COOKIE_VALUE.test(text)) kinds.push('x-session-cookie');
    const next = run !== null && run.file === at.file && at.n === run.n + 1;
    if (!String(text).trim()) {
      run = next && !run.blank ? { ...run, n: at.n, blank: true } : null;
      continue;
    }
    const { lead, trail, words, nums } = seedEnds(text);
    const own = kinds.includes('bip39-seed');
    const joins = next && runsOn(run, nums);
    if (joins && !run.told && seedLike([...run.words, ...lead])) {
      if (!own) hits.push({ where: run.where, kinds: ['bip39-seed'] });
      run.told = true;
    }
    // A run keeps its last eleven words: as many as twelve in a row ending on the next line can take.
    if (joins && words.length) run = { ...run, n: at.n, words: [...run.words, ...words].slice(1 - SEED_WORDS), blank: false, ...numbered(nums, run) };
    else run = trail.length ? { where, file: at.file, n: at.n, words: trail, told: own, blank: false, ...numbered(nums, null) } : null;
    if (kinds.length) hits.push({ where, kinds });
  }
  return hits;
}

/**
 * A file's text, or null when it is binary. UTF-16 is text: Windows PowerShell 5's `>` and Notepad's "Unicode" both
 * write it, with a byte-order mark, and until 8 Nov 2026 its NUL bytes had it skipped as binary, a seed phrase and all.
 */
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2, buf.length - (buf.length % 2))).swap16().toString('utf16le');
  return buf.subarray(0, 8000).includes(0) ? null : buf.toString('utf8');
}

/**
 * The tree's lines, read from disk for each path git lists. A binary file is skipped and named in `binary`, so a PASS
 * can say what it did not read; a path that cannot be read is named in `unread`, never passed over.
 */
export function treeLines(root, paths) {
  const lines = [];
  const unread = [];
  const binary = [];
  let files = 0;
  for (const p of paths) {
    const file = join(root, p);
    // Deleted on disk but still in the index: what the index holds is read by the staged scan where it differs from
    // HEAD, and by the history scan where it does not. The disk has nothing to read.
    if (!existsSync(file)) continue;
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      unread.push(p);
      continue;
    }
    const text = decodeText(buf);
    if (text === null) {
      binary.push(p);
      continue;
    }
    files += 1;
    text.split('\n').forEach((t, i) => lines.push({ where: `${p}:${i + 1}`, text: t }));
  }
  return { lines, files, unread, binary };
}

// With --text, git prints a UTF-16 blob byte for byte, a NUL beside every ASCII letter. Dropped, the letters read as
// the text they are, so a seed committed from Notepad is caught in history as well as on disk.
const noNul = (s) => s.split('\u0000').join('');

/**
 * Every line ever added, and every commit message line, from `git log -p -m --all --text --pretty=medium`, as
 * { where: "<sha7>:<path>:<line>" or "<sha7>:message:<n>", text }. Hunk headers are counted rather than trusted to
 * a line's first character, so an added line that itself begins "++ " is read as content, not as a file header.
 * A diff with no commit header (`git diff --cached`) is read the same way, its lines placed under `label`.
 */
export function historyLines(log, label = '?') {
  const lines = [];
  let commits = 0;
  let added = 0;
  let commit = label;
  let path = '?';
  let inMessage = false;
  let msg = 0;
  let n = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of String(log).split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith('+')) {
        lines.push({ where: `${commit}:${path}:${n}`, text: noNul(raw.slice(1)) });
        added += 1;
        n += 1;
        newLeft -= 1;
      } else if (raw.startsWith('-')) oldLeft -= 1;
      else if (!raw.startsWith('\\')) {
        oldLeft -= 1;
        newLeft -= 1;
        n += 1;
      }
      continue;
    }
    let m;
    if ((m = /^commit ([0-9a-f]{7,64})\b/.exec(raw))) {
      commits += 1;
      commit = m[1].slice(0, 7);
      inMessage = true;
      msg = 0;
    } else if (raw.startsWith('diff --git ')) inMessage = false;
    else if (inMessage && raw.startsWith('    ')) lines.push({ where: `${commit}:message:${(msg += 1)}`, text: raw.slice(4) });
    else if ((m = /^\+\+\+ (?:b\/)?(.*)$/.exec(raw))) path = m[1];
    else if ((m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw))) {
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      n = Number(m[2]);
      newLeft = m[3] === undefined ? 1 : Number(m[3]);
    }
  }
  return { lines, commits, added };
}

// The three places a secret can sit: the disk, the index (what `git commit` records next, which until 8 Nov 2026 was
// never read, so a key staged and then deleted or edited back on disk passed), and history. --text on both diffs, so a
// blob git calls binary (a NUL in it, or `-diff` in .gitattributes) is printed instead of "Binary files differ".
export function secrets(ctx) {
  if (!bip39Intact(ctx.words ?? BIP39_WORDS)) return fail('the built-in BIP39 list is not the published one, so a seed phrase could pass unseen');
  let paths;
  let log;
  let staged;
  try {
    paths = ctx.git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  } catch (e) {
    return fail(`git ls-files failed, so the tree was not read: ${firstLine(e)}`);
  }
  try {
    log = ctx.git(['log', '-p', '-m', '--all', '--text', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--pretty=medium']);
  } catch (e) {
    return fail(`git log failed, so history was not read: ${firstLine(e)}`);
  }
  try {
    staged = ctx.git(['diff', '--cached', '-U0', '--text', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/']);
  } catch (e) {
    return fail(`git diff --cached failed, so what the next commit would record was not read: ${firstLine(e)}`);
  }
  const tree = treeLines(ctx.root, [...new Set(paths)]);
  const history = historyLines(log);
  const index = historyLines(staged, 'staged');
  if (tree.unread.length) return fail(`could not read ${tree.unread.slice(0, 3).join(', ')}: a file not read is not a clean file`);
  if (!tree.files) return fail('no file was read, so nothing was checked');
  if (!history.commits) return fail('git log gave no commit, so history was not checked');
  if (!history.added) return fail('git log gave commits but no added line, so the diffs were not read');
  const past = withoutKnownFakes(history.lines, ctx.fakes ?? KNOWN_FAKES);
  const hits = [...secretHits(tree.lines), ...secretHits(index.lines), ...secretHits(past.lines)];
  if (hits.length) {
    const shown = hits.slice(0, 5).map((h) => `${h.where} (${h.kinds.join(', ')})`).join('; ');
    return fail(`secret-shaped text at ${shown}${hits.length > 5 ? `; and ${hits.length - 5} more` : ''}`);
  }
  const skipped = tree.binary.length ? `: ${tree.binary.slice(0, 3).join(', ')}${tree.binary.length > 3 ? ', ...' : ''}` : '';
  const fakes = past.allowed ? `, ${past.allowed} known fake fixture line(s) let through` : '';
  return pass(`clean: ${tree.files} file(s) read in the tree, ${tree.binary.length} binary file(s) not read${skipped}; ${index.lines.length} staged line(s) not yet committed; ${history.lines.length} committed line(s) over ${history.commits} commit(s); ${SECRET_SHAPES.length + 2} shapes${fakes}`);
}

// ----------------------------------------------------------------------------------------------------------- privacy

export function privacy(ctx) {
  try {
    ctx.git(['check-ignore', '-q', 'agency/pilot/ledger.jsonl']);
  } catch {
    return fail('agency/pilot/ is NOT gitignored');
  }
  const tracked = ctx.git(['ls-files', 'agency/pilot']).trim();
  return tracked ? fail(`tracked under agency/pilot/: ${tracked.split('\n').slice(0, 3).join(', ')}`) : pass('agency/pilot/ ignored, nothing tracked');
}

// ------------------------------------------------------------------------------------------------------------ studio
// "Nothing from here enters the studio repo." A clean tree alone proved too little: this container's studio clone sat
// on this session's Galxe branch, and that branch was on the studio's remote, where a commit would land outside the
// studio's own proof and push flow. A dirty tree is reported as dirty, cause unknown: it may be Leif's own work.
// The branch itself is not the harm; a commit on it is. The cloud session harness checks out its designated branch in
// the studio clone, locally and on the remote, at every start, so an empty claude/galxe-* branch is named, not failed:
// failing it kept prove red for good here, and invited deleting a branch on the studio's remote, which faces outward.
// One holding any commit the studio's main lacks (origin/main, else main; neither is a FAIL) still fails.
export const STUDIO_BRANCH_BAN = /^refs\/(?:heads|remotes\/[^/]+)\/claude\/galxe-/;
export const STUDIO_MAINS = ['refs/remotes/origin/main', 'refs/heads/main'];

/** A count git printed, or NaN: an empty or garbled answer is never read as 0. */
export const countOf = (s) => (/^\d+$/.test(String(s).trim()) ? Number(String(s).trim()) : NaN);

/**
 * The studio verdict from what was read: `base` is the main the galxe refs were measured against (null if there is
 * none), and `ahead` maps each such ref to how many of its commits `base` lacks. Absent is a NOTE: a repo that is not
 * on this machine was not checked.
 */
export function studioVerdict({ present, dir = 'joyisfree1', branch = '?', head = '?', dirty = [], refs = [], base = null, ahead = {} }) {
  if (!present) return note(`studio repo not on this machine (${dir}), so nothing was checked: not a pass`);
  const banned = refs.filter((r) => STUDIO_BRANCH_BAN.test(r));
  const carrying = banned.filter((r) => ahead[r] !== 0);
  const problems = [];
  if (dirty.length) problems.push(`uncommitted changes, cause unknown: ${dirty.slice(0, 3).join('; ')}`);
  if (banned.length && !base) problems.push(`claude/galxe-* branch present and no main to measure it against: ${banned.join(', ')}`);
  else if (carrying.length) problems.push(`claude/galxe-* branch holds commits ${base} does not: ${carrying.map((r) => `${r} (${Number.isInteger(ahead[r]) ? ahead[r] : 'count unknown'})`).join(', ')}`);
  const at = `HEAD ${head} on ${branch}`;
  if (problems.length) return fail(`${at}; ${problems.join('; ')}`);
  return pass(banned.length ? `${at}, clean; claude/galxe-* branch with no commit beyond ${base}: ${banned.join(', ')}` : `${at}, clean, no claude/galxe-* branch`);
}

export function studio(ctx) {
  const dir = ctx.studio;
  if (!existsSync(join(dir, '.git'))) return studioVerdict({ present: false, dir });
  try {
    const g = (args) => ctx.git(['-C', dir, ...args]).trim();
    const list = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
    const refs = list(g(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']));
    const base = STUDIO_MAINS.find((m) => refs.includes(m)) ?? null;
    const ahead = {};
    if (base) for (const r of refs) if (STUDIO_BRANCH_BAN.test(r)) ahead[r] = countOf(g(['rev-list', '--count', `${base}..${r}`]));
    return studioVerdict({
      present: true,
      dir,
      branch: g(['rev-parse', '--abbrev-ref', 'HEAD']),
      head: g(['rev-parse', '--short', 'HEAD']),
      dirty: list(g(['status', '--porcelain'])),
      refs,
      base,
      ahead,
    });
  } catch (e) {
    return fail(`could not read the studio repo at ${dir}: ${firstLine(e)}`);
  }
}

// --------------------------------------------------------------------------------------------------------- decisions
// Leif's open decisions and dates, in one file, read by one clock. #9 lapsed on 7 Nov 2026 because nothing turned
// red when its date passed; this check does. It does not reuse formatDue from galxe-desk/scripts/ledger.mjs: that
// one's words are about prize claims, and it calls a deadline overdue from UTC midnight at the start of the
// deadline's own day. Here an item lapses only once its date is before today in Sydney, so it stays open all of
// its own day, Leif's day. The output keeps formatDue's shape: what is late first, then what is next.
export const CALENDAR = 'agency/calendar.json';
const KINDS = new Set(['decision', 'date']);
const STATES = new Set(['open', 'decided', 'lapsed']);
const CALENDAR_TEXT = ['id', 'what', 'whose', 'lapsesIf'];

/** Why a calendar cannot be read as one, item by item. Empty means it can. */
export function calendarProblems(items) {
  if (!Array.isArray(items)) return ['it must be a JSON array of items'];
  if (!items.length) return ['it is empty, and an empty clock cannot tell a wiped file from a quiet fortnight'];
  const problems = [];
  const seen = new Set();
  items.forEach((it, i) => {
    const label = `item ${i + 1}${isText(it?.id) ? ` (${it.id})` : ''}`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) {
      problems.push(`${label} is not an object`);
      return;
    }
    for (const f of CALENDAR_TEXT) if (!isText(it[f])) problems.push(`${label} has no ${f}`);
    if (dayNumber(it.date) == null) problems.push(`${label} date ${JSON.stringify(it.date)} is not a real YYYY-MM-DD date`);
    if (!KINDS.has(it.kind)) problems.push(`${label} kind ${JSON.stringify(it.kind)} is not "decision" or "date"`);
    if (!STATES.has(it.status)) problems.push(`${label} status ${JSON.stringify(it.status)} is not "open", "decided" or "lapsed"`);
    if (seen.has(it.id)) problems.push(`${label} repeats an id`);
    seen.add(it.id);
  });
  return problems;
}

/** The clock on its own: open items dated before today have lapsed; the rest are due, soonest first. */
export function decisionClock(items, today) {
  const t = dayNumber(today);
  if (t == null) throw new Error(`today (${today}) is not a date`);
  const open = items.filter((it) => it.status === 'open').sort((a, b) => dayNumber(a.date) - dayNumber(b.date));
  return { lapsed: open.filter((it) => dayNumber(it.date) < t), due: open.filter((it) => dayNumber(it.date) >= t) };
}

export function decisions(ctx) {
  const file = join(ctx.root, CALENDAR);
  if (!existsSync(file)) return fail(`${CALENDAR} is missing, so no date can turn this red`);
  let items;
  try {
    items = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return fail(`${CALENDAR} is not valid JSON: ${firstLine(e)}`);
  }
  const problems = calendarProblems(items);
  if (problems.length) return fail(`${CALENDAR}: ${problems.slice(0, 4).join('; ')}${problems.length > 4 ? `; and ${problems.length - 4} more` : ''}`);
  const today = sydneyDay(ctx.now);
  const { lapsed, due } = decisionClock(items, today);
  if (lapsed.length) return fail(`LAPSED, open past its date (today is ${today} in Sydney): ${lapsed.map((it) => `${it.id} (was ${it.date})`).join(', ')}`);
  return pass(due.length ? `${due.length} open, none lapsed; next ${due[0].id} by ${due[0].date} (today is ${today} in Sydney)` : `nothing open (today is ${today} in Sydney)`);
}

// ------------------------------------------------------------------------------------------------------------- state
// The front door. A fresh session read about 12.6 KB across two files before it knew where things stood; one short
// file, named by CLAUDE.md's first instruction, is the whole read. The root docs/state.md, not galxe-desk's.
export const STATE_FILE = 'docs/state.md';
export const STATE_MAX_LINES = 15;
const NAMES_STATE = /(?:^|[^\w./-])(?:\.\/)?docs\/state\.md\b/;

/** Lines as `wc -l` would count them, plus a last line with no newline. */
export function lineCount(text) {
  const s = String(text);
  if (s === '') return 0;
  return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
}

/** CLAUDE.md's first instruction: its first line that is not blank, a heading or an HTML comment. */
export function firstInstruction(text) {
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('<!--')) continue;
    return line;
  }
  return null;
}

export function state(ctx) {
  const file = join(ctx.root, STATE_FILE);
  if (!existsSync(file)) return fail(`${STATE_FILE} is missing`);
  const n = lineCount(readFileSync(file, 'utf8'));
  if (n === 0) return fail(`${STATE_FILE} is empty`);
  if (n > STATE_MAX_LINES) return fail(`${STATE_FILE} is ${n} lines, over ${STATE_MAX_LINES}`);
  const claude = join(ctx.root, 'CLAUDE.md');
  if (!existsSync(claude)) return fail('CLAUDE.md is missing, so nothing points a fresh session at the state file');
  const first = firstInstruction(readFileSync(claude, 'utf8'));
  if (first == null || !NAMES_STATE.test(first)) return fail(`CLAUDE.md's first instruction does not name ${STATE_FILE}: "${String(first ?? '').trim().slice(0, 90)}"`);
  return pass(`${STATE_FILE} is ${n} line(s), and CLAUDE.md's first instruction points to it`);
}

// -------------------------------------------------------------------------------------------------------- leif-pages
// Leif's pages are read by Leif, who does not use a terminal. A command on one is a step handed to the one person
// who cannot take it, so it belongs in a runbook only Claude uses. 8 Nov 2026: "type npm install", "npx prove",
// "git pull", a 4-space code block, <code>, `./setup.sh` and the Windows and platform tools (`powercfg` is the PC-sleep
// step this account's session-lifeline skill hands Leif) all passed. Words that are also plain English (open, start,
// make, code, yarn) are left off the lists, because a fenced email draft starts lines with them.
export const LEIF_PAGES = ['docs/leif.md', 'agency/RUN-drop-vs-email.md', 'agency/drafts/*.md'];
const SHELL = 'npm|npx|node|git|gh|cd|ls|cat|curl|wget|bash|sh|zsh|python3?|pip3?|brew|rm|mv|cp|mkdir|chmod|sudo|export|echo|yarn|pnpm|bun|deno|ssh|scp|docker|grep|sed|awk|claude|powershell|pwsh|winget|choco|powercfg|nvm|fnm|vercel|supabase|netlify';
const NPM_RUN = /\bnpm\s+run\b/;
const PROSE_COMMAND = /\b(?:npm|pnpm)\s+(?:install|i|ci|test|t|start|exec|update|init)\b|\bnpx\s+[\w@.-]|\bgit\s+(?:pull|push|clone|commit|checkout|switch|status|add|fetch|reset|stash|merge|rebase|log|diff|init|restore)\b/i;
const NODE_COMMAND = /\bnode\s+(?:--?[a-z]|[\w./-]*\.[cm]?js\b|[\w.-]*\/)/i;
const SCRIPT = '(?:\\.{1,2}[\\\\/]|~[\\\\/])?[\\w.\\\\/-]*\\w\\.(?:sh|ps1|bat|cmd|command)\\b';
const SHELL_START = new RegExp(`^\\s*(?:\\$\\s*)?(?:(?:${SHELL})\\s+\\S|${SCRIPT})`);
// Outside code, 9 Nov 2026: "1. brew install node", "- cd ~/Desktop/joyisfree", a bare "brew install node" and "type
// powercfg /change standby-timeout-ac 0" all passed, because SHELL_START was tried only on code. The first fix counted
// some tools before any word, and others at the start of any line or list item, and the same day it failed plain
// English: "the choco brown hoodie", "no sudo is needed", "ssh key" opening a wrapped line, "> ls is short for list.",
// "grep for the price", "the export /import step", "the cold brew update". This label's pages say colours, coffee
// and the names of tools, so in prose a tool counts only with an argument no sentence puts after a word (PROSE_ARG): a
// flag, the home folder, a path that starts ./ or ../, an absolute path of two parts or more (/Users/leif, never
// "/import"), or a drive. Beyond those: install or uninstall after an installer whose name is a word (brew, choco, yarn,
// bun); a subcommand after a tool no sentence names (nvm install 22, pip list, gh auth login); a command after sudo;
// powercfg's /switch; and curl's or wget's URL. A script counts when it is run by its path (./setup.sh, .\undo.ps1);
// its bare name is a file named and a markdown link to it is a link, not a step. npm, npx, git and node have their own.
// Round 2, the same day: "We export ~ 200 pieces", "Claude will export /collections/summer/ as a PDF" and "the yarn
// install at the gallery" failed too. So the home folder is a ~ that leads a path or ends the line, never one before a
// number; an absolute path counts only after a tool whose name is not also an English word (PATH_SHELL: export, cat,
// echo, yarn and the rest say things in a sentence, and "/collections/summer/" is a web path), while ./, ~/ and a drive
// are paths after any tool; and yarn, a knitting word, installs only when nothing but a flag follows ("- yarn install").
const STEP_ARG = [
  '--?[A-Za-z]', // a flag: -m, --resume, -fsSL; never a dash in a sentence ("cat - a tabby")
  '~(?:[\\\\/]|$)', // the home folder: ~/Desktop, or a bare ~ that ends the line; never "~ 200" or "~40 kg"
  '\\.{1,2}[\\\\/]', // a relative path: ./setup.sh, ..\joyisfree
  '[A-Za-z]:\\\\', // a drive: C:\Users
].join('|');
const ABSOLUTE_PATH = '[\\\\/][\\w.~-]+[\\\\/]'; // two parts or more: /Users/leif, \Users\leif; never "export /import"
const SAID_IN_PROSE = new Set(['cat', 'export', 'echo', 'yarn', 'bun', 'brew', 'choco', 'claude', 'docker', 'sed', 'awk']);
const PATH_SHELL = SHELL.split('|').filter((w) => !SAID_IN_PROSE.has(w)).join('|');
const CLI = 'winget|pnpm|pip3?|nvm|fnm|deno|docker|gh';
const SUBCOMMAND = '(?:un|re)?install|upgrade|update|list|search|run|auth\\s+login';
const PROSE_TOOL = new RegExp(`(?<![\\w./-])(?:(?:${SHELL})\\s+(?:${STEP_ARG})|(?:${PATH_SHELL})\\s+${ABSOLUTE_PATH}|(?:brew|choco|bun)\\s+(?:un|re)?install\\b|yarn\\s+(?:un|re)?install(?=\\s*(?:$|--?[A-Za-z]))|(?:${CLI})\\s+(?:${SUBCOMMAND})\\b|sudo\\s+(?:${SHELL})\\b|powercfg\\s+\\/[A-Za-z]|(?:curl|wget)\\s+https?:\\/\\/)`);
const RUN_SCRIPT = new RegExp(`(?<![\\w.~/\\\\(-])(?=\\.{1,2}[\\\\/]|~[\\\\/])${SCRIPT}`);
const INLINE_CODE = /`([^`\n]+)`/g;
const HTML_CODE = /<(?:code|kbd)>([^<\n]+)<\/(?:code|kbd)>/gi;
const FENCE = /^\s*(?:`{3,}|~{3,})\s*([\w+-]*)/;
const SHELL_FENCE = /^(?:sh|bash|zsh|shell|console|terminal|shell-session|powershell|pwsh|ps1?|cmd|bat)$/i;
const INDENTED = /^(?: {4}|\t)/;

/** Lines on one page that hand Leif a terminal step, as { where: "file:line", why }. */
export function terminalSteps(file, text) {
  const hits = [];
  let fenced = false;
  let indented = false; // inside a markdown code block made by indenting: 4 spaces or a tab, after a blank line
  let blank = true;
  String(text).split('\n').forEach((line, i) => {
    let why = null;
    const f = FENCE.exec(line);
    indented = !fenced && !f && INDENTED.test(line) && (blank || indented);
    if (f) {
      fenced = !fenced;
      if (fenced && SHELL_FENCE.test(f[1])) why = `a ${f[1]} code block`;
    } else if (fenced && (/^\s*\$\s/.test(line) || SHELL_START.test(line))) why = 'a command in a code block';
    else if (indented && (/^\s*\$\s/.test(line) || SHELL_START.test(line))) why = 'a command in an indented code block';
    if (!why && NPM_RUN.test(line)) why = '"npm run"';
    if (!why && NODE_COMMAND.test(line)) why = 'a node command';
    if (!why && [...line.matchAll(INLINE_CODE)].some((m) => SHELL_START.test(m[1]))) why = 'a shell command in backticks';
    if (!why && [...line.matchAll(HTML_CODE)].some((m) => SHELL_START.test(m[1]))) why = 'a shell command in <code>';
    if (!why && PROSE_COMMAND.test(line)) why = 'an npm, npx or git command';
    if (!why && PROSE_TOOL.test(line)) why = 'a terminal tool with an argument';
    if (!why && RUN_SCRIPT.test(line)) why = 'a script run by its path';
    if (why) hits.push({ where: `${file}:${i + 1}`, why });
    blank = !line.trim();
  });
  return hits;
}

/** The pages a list names. Only "dir/*.ext" is understood as a pattern; a name or pattern that finds nothing is missing, never skipped. */
export function expandPages(root, patterns) {
  const files = [];
  const missing = [];
  for (const p of patterns) {
    if (!p.includes('*')) {
      (existsSync(join(root, p)) ? files : missing).push(p);
      continue;
    }
    const m = /^([^*]+)\/\*(\.\w+)$/.exec(p);
    if (!m) {
      missing.push(`${p} (only dir/*.ext is understood)`);
      continue;
    }
    const dir = join(root, m[1]);
    const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(m[2])).sort().map((f) => `${m[1]}/${f}`) : [];
    if (found.length) files.push(...found);
    else missing.push(`${p} (matches nothing)`);
  }
  return { files, missing };
}

export function leifPages(ctx, pages = LEIF_PAGES) {
  const { files, missing } = expandPages(ctx.root, pages);
  const hits = files.flatMap((f) => terminalSteps(f, readFileSync(join(ctx.root, f), 'utf8')));
  const problems = [];
  if (missing.length) problems.push(`missing: ${missing.join(', ')}`);
  if (hits.length) problems.push(`${hits.length} terminal step(s): ${hits.slice(0, 6).map((h) => `${h.where} (${h.why})`).join(', ')}${hits.length > 6 ? `, and ${hits.length - 6} more` : ''}`);
  return problems.length ? fail(problems.join('; ')) : pass(`${files.length} page(s), no terminal step`);
}

// ------------------------------------------------------------------------------------------------------------- facts
// The numbers the plan rests on, each with where it came from and when. A number without a source is a guess, and a
// guess was what the first-dollar estimates rested on until 8 Nov 2026.
export const FACTS = 'agency/facts.json';
export const FACTS_STALE_DAYS = 14;

/** Why a facts file cannot be trusted, fact by fact. Empty means it can. */
export function factProblems(doc, today) {
  const t = dayNumber(today);
  if (t == null) throw new Error(`today (${today}) is not a date`);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['it must be an object: { asOf, facts: [...] }'];
  const problems = [];
  const asOf = dayNumber(doc.asOf);
  if (asOf == null) problems.push(`asOf ${JSON.stringify(doc.asOf)} is not a real YYYY-MM-DD date`);
  else if (asOf > t) problems.push(`asOf ${doc.asOf} is after today (${today} in Sydney)`);
  if (!Array.isArray(doc.facts) || !doc.facts.length) {
    problems.push('facts must be a non-empty list: no fact is not a checked fact');
    return problems;
  }
  doc.facts.forEach((f, i) => {
    const label = `fact ${i + 1}${isText(f?.key) ? ` (${f.key})` : ''}`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      problems.push(`${label} is not an object`);
      return;
    }
    if (!isText(f.key)) problems.push(`${label} has no key`);
    if (!isText(f.source)) problems.push(`${label} has no source`);
    const d = dayNumber(f.date);
    if (d == null) problems.push(`${label} date ${JSON.stringify(f.date)} is not a real YYYY-MM-DD date`);
    else if (d > t) problems.push(`${label} is dated ${f.date}, after today`);
    if (f.value === undefined || f.value === null || f.value === '') problems.push(`${label} has no value (write "unknown" when it is not known)`);
    if (typeof f.unit !== 'string') problems.push(`${label} has no unit field`);
    else if (typeof f.value === 'number' && !f.unit.trim()) problems.push(`${label} is a number with no unit`);
  });
  return problems;
}

export function facts(ctx) {
  const file = join(ctx.root, FACTS);
  if (!existsSync(file)) return fail(`${FACTS} is missing, so no number on the plan is sourced`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return fail(`${FACTS} is not valid JSON: ${firstLine(e)}`);
  }
  const today = sydneyDay(ctx.now);
  const problems = factProblems(doc, today);
  if (problems.length) return fail(`${FACTS}: ${problems.slice(0, 4).join('; ')}${problems.length > 4 ? `; and ${problems.length - 4} more` : ''}`);
  const age = dayNumber(today) - dayNumber(doc.asOf);
  const told = `${doc.facts.length} fact(s), each sourced and dated`;
  if (age > FACTS_STALE_DAYS) return note(`${told}, but asOf ${doc.asOf} is ${age} days old (over ${FACTS_STALE_DAYS}): re-check them`);
  return pass(`${told}, as of ${doc.asOf}`);
}

// ------------------------------------------------------------------------------------------- tests, mutations, rulebook

const sh = (ctx, cmd, args) => execFileSync(cmd, args, { cwd: ctx.root, encoding: 'utf8', stdio: 'pipe', maxBuffer: MAX_BUFFER });

export function tests(ctx) {
  const files = [];
  const empty = [];
  for (const d of TEST_DIRS) {
    const dir = join(ctx.root, d);
    const found = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f)) : [];
    if (!found.length) empty.push(d);
    files.push(...found);
  }
  if (empty.length) return fail(`no test file in ${empty.join(', ')}`);
  try {
    const out = sh(ctx, process.execPath, ['--test', ...files]);
    const passed = Number((out.match(/^# pass (\d+)/m) || [])[1] ?? NaN);
    const failed = Number((out.match(/^# fail (\d+)/m) || [])[1] ?? NaN);
    return failed === 0 && passed > 0 ? pass(`${passed} passed, ${failed} failed across ${files.length} files`) : fail(`${passed} passed, ${failed} failed across ${files.length} files`);
  } catch (e) {
    const out = String(e.stdout || '');
    return fail(`red: ${(out.match(/^# fail (\d+)/m) || ['', '?'])[1]} failed`);
  }
}

export function mutations(ctx) {
  try {
    return pass(sh(ctx, process.execPath, [join(ctx.root, 'galxe-desk/scripts/mutate.mjs')]).trim().split('\n').pop());
  } catch (e) {
    return fail(String(e.stdout || '').trim().split('\n').slice(-4).join(' | '));
  }
}

export function rulebook(ctx) {
  try {
    return pass(sh(ctx, process.execPath, [join(ctx.root, 'galxe-desk/scripts/rulebook-crawl.mjs'), '--check']).trim());
  } catch (e) {
    return note(`incomplete, as expected until the live crawl: ${String(e.stdout || '').trim()}`);
  }
}

// --------------------------------------------------------------------------------------------------------------- run

export const CHECKS = [
  ['tests', tests, true],
  ['mutations', mutations, true],
  ['secrets', secrets, true],
  ['privacy', privacy, true],
  ['studio', studio, true],
  ['decisions', decisions, true],
  ['state', state, true],
  ['leif-pages', leifPages, true],
  ['facts', facts, true],
  ['rulebook', rulebook, false],
];

const MARKS = new Set(['PASS', 'FAIL', 'NOTE']);

/** What a result prints as. On a required check anything but a known status is a FAIL: unknown is never a pass. */
export function markOf(result, required) {
  const s = MARKS.has(result?.status) ? result.status : 'FAIL';
  return required || s === 'PASS' ? s : 'NOTE';
}

/** Run the checks in order. A check that throws is a FAIL carrying its message, never a crash that hides the rest. */
export function runChecks(ctx, checks = CHECKS) {
  const rows = [];
  for (const [name, fn, required] of checks) {
    let r;
    try {
      r = fn(ctx);
    } catch (e) {
      r = fail(`the check itself threw: ${firstLine(e)}`);
    }
    rows.push({ name, mark: markOf(r, required), detail: String(r?.detail ?? '') });
  }
  return { rows, failed: rows.filter((r) => r.mark === 'FAIL').length };
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const { rows, failed } = runChecks(context());
  for (const r of rows) console.log(`${r.mark.padEnd(4)}  ${r.name.padEnd(10)}  ${r.detail}`);
  const notes = rows.filter((r) => r.mark === 'NOTE').length;
  console.log(failed ? `\nNOT PROVEN: ${failed} required check(s) failed.` : `\nPROVEN: every required check holds${notes ? `; the ${notes} NOTE line(s) above are not passes` : ''}.`);
  process.exitCode = failed ? 1 : 0;
}
