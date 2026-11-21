// The owner-data corpus's loader: the files in clean/, which prove's scanners must pass (scripts/corpus/README.md).
//
// It fails closed. A missing folder, fewer files than CORPUS_FLOOR, anything that is not a regular file, an extension
// outside CORPUS_EXTENSIONS, a binary or non-UTF-8 file, an email address outside the reserved example domains, a social
// handle or a phone number each throw, naming the file and line but never the text, so a test cannot pass on a corpus
// that was emptied, or that holds a person's details. This repository is public: a real address, handle or number
// copied in from a shop export would be published with the next push.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLEAN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'clean');

/** How many files clean/ holds. A file added raises it by one; it never goes down, so a lost file fails the corpus. */
export const CORPUS_FLOOR = 32;
export const CORPUS_EXTENSIONS = ['.csv', '.tsv', '.md', '.txt', '.json'];
export const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net', 'example.invalid'];

// What may stand just before an @ in an email address. Any other @ followed by a letter, a digit or _ is a handle.
const EMAIL_LOCAL = /[A-Za-z0-9._%+-]/;
const HANDLE = /^[A-Za-z0-9_]/;
// A profile page names a handle as well as an @ does: instagram.com/name, x.com/name, tiktok.com/@name.
const PROFILE_URL = /\b(?:instagram|twitter|x|tiktok|facebook|threads|youtube|linkedin|pinterest|snapchat)\.(?:com|net)\/@?[A-Za-z0-9_.]{2,}/i;

// Phone numbers, each with the count of digits it must hold: international (+61 412 345 678, +44 20 7946 0958); with a
// trunk 0, spaced, dashed, dotted or run together (0412 345 678, 0412.345.678, (02) 9876 5432, 020 7946 0958,
// 0412345678); an Australian 1300 or 1800 number (1300 975 707), its separators required so a Unix time (1800000000)
// is not one; the North American shape with a separator after its area code and its exchange ((201) 555-0123,
// 201-555-0123) or, when its area code and exchange each begin 2 to 9 as North America's always do, after its area
// code alone ((201) 5550123, 201 5550123), so an order id such as 100-1234567 is not one, either with or without a
// leading 1 and a separator after it (1-800-555-0199, 1 201 5550123); a number with the country code of the UK,
// Australia or New Zealand but no +, spaced, holding that country's count of digits after it: ten after 44
// (44 7700 900123), nine after 61 beginning 2 to 8 (61 491 570 156), eight to ten after 64 beginning 2 to 9; a 00
// international number with its separators (00 61 491 570 156); and a number in French pairs (06 39 98 12 34). A date
// (2026-11-01, 01-11-2026), a time zone (+1100), a price (178.00), a size run (44 46 48 50 52) and a SKU such as
// JIF-HH-BLK-M or 61-1001-2002 are none of these. An ABN or a run of quantities that begins 61 or 64 can read as a
// number with its country code (61 200 400 600), and is refused, so clean/ uses the ATO's example ABN (51 824 753 556).
//
// Not caught, by choice, and written down in README.md; prove.test.mjs's PHONE_KNOWN_MISSES asserts each still passes:
// - the six-digit Australian 13 number (13, then two pairs of digits), whose shape a US size run (13 14 15) shares;
// - a 00 international number run together (0061491570156), whose shape a UPC with leading zeros shares;
// - a number run together: North American (2015550123, 12015550123), or with a country code and no + (61491570156,
//   what a spreadsheet leaves of +61 491 570 156), whose shape a Unix time, an order id or a barcode shares;
// - a number run together after its leading 1 or its country code (1 2015550123, 61 491570156), whose shape a count
//   and then an id shares;
// - a local number with no area code (5550 1234, 7946 0958, 555-0123), whose shape two codes side by side share;
// - a country code and no + written with dashes or dots (61-491-570-156, 61.491.570.156), whose shape a SKU, a lot
//   number or an IP address shares;
// - a country code other than 1, 44, 61 or 64 written without its + (33 7700 900123);
// - rarer spellings, left out to keep the patterns narrow: a leading 1 run into a bracketed area code (1(201) 555-0123),
//   a UK number keeping its trunk 0 in brackets with no + (44 (0)20 7946 0958, 44 (0) 20 7946 0958), and a country code
//   with no + and the rest in pairs (44 7700 90 01 23).
const PHONES = [
  { re: /(?<![\w+])\+\d[\d ().-]{6,}\d/g, min: 8, max: 15 },
  { re: /(?<![\w.+-])(?:\(0[1-9]\d{0,3}\)|0[1-9]\d{0,3})(?:[ .-]?\d{3,4}){1,3}(?![\w-]|\.\d)/g, min: 9, max: 11 },
  { re: /(?<![\w.+-])1[38]00[ .-]\d{3}[ .-]\d{3}(?![\w-]|\.\d)/g, min: 10, max: 10 },
  { re: /(?<![\w.+-])(?:1[ .-])?(?:\(\d{3}\) ?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-]|\.\d)/g, min: 10, max: 11 },
  { re: /(?<![\w.+-])(?:1[ .-])?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[ .-])[2-9]\d{6}(?![\w-]|\.\d)/g, min: 10, max: 11 },
  { re: /(?<![\w.+-])44 [1-9]\d{0,3}(?: \d{3,6}){1,3}(?![\w-]|\.\d)/g, min: 12, max: 12 },
  { re: /(?<![\w.+-])61 [2-8]\d{0,3}(?: \d{3,6}){1,3}(?![\w-]|\.\d)/g, min: 11, max: 11 },
  { re: /(?<![\w.+-])64 [2-9]\d{0,3}(?: \d{3,6}){1,3}(?![\w-]|\.\d)/g, min: 10, max: 12 },
  { re: /(?<![\w.+-])00[ .-][1-9]\d{0,2}(?:[ .-]\d{1,4}){2,5}(?![\w-]|\.\d)/g, min: 10, max: 17 },
  { re: /(?<![\w.+-])0[1-9](?:[ .-]\d{2}){4}(?![\w-]|\.\d)/g, min: 10, max: 10, run: true },
];

// Five two-digit groups that strictly rise (01 02 03 04 05, 06 08 10 12 14) count sizes or codes; a phone's do not.
const rising = (s) => { const g = s.split(/[ .-]/).map(Number); return g.every((n, i) => i === 0 || n > g[i - 1]); };

const digits = (s) => s.split('').filter((c) => c >= '0' && c <= '9').length;
const trimDots = (s) => { let d = s; while (d.endsWith('.')) d = d.slice(0, -1); return d; };

/** Why one line cannot sit in the corpus, or null. Never the matched text itself, so a report cannot leak it. */
export function linePrivacy(line) {
  const s = String(line);
  for (let i = s.indexOf('@'); i >= 0; i = s.indexOf('@', i + 1)) {
    const after = s.slice(i + 1);
    if (i > 0 && EMAIL_LOCAL.test(s[i - 1])) {
      const domain = trimDots((/^[A-Za-z0-9.-]*/.exec(after) ?? [''])[0]).toLowerCase();
      if (!RESERVED_DOMAINS.includes(domain)) return `an email address outside ${RESERVED_DOMAINS.join(', ')}`;
    } else if (HANDLE.test(after)) return 'a social handle';
  }
  if (PROFILE_URL.test(s)) return 'a social handle (a profile address)';
  for (const { re, min, max, run } of PHONES) {
    for (const m of s.matchAll(re)) {
      const n = digits(m[0]);
      if (n >= min && n <= max && !(run && rising(m[0]))) return 'a phone number';
    }
  }
  return null;
}

/** A file's text when it is UTF-8 with no NUL byte; else why not. */
function textOf(buf) {
  if (buf.includes(0)) return { why: 'a binary file (a NUL byte)' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
  } catch {
    return { why: 'not UTF-8' };
  }
}

/**
 * Every file in `dir`, as { name, ext, text } in name order. Throws, with every reason found, on anything that makes
 * the corpus untrustworthy: see the header. `floor` is the least number of files the folder must hold.
 */
export function loadCorpus(dir, { floor = CORPUS_FLOOR } = {}) {
  if (!Number.isInteger(floor) || floor < 1) throw new Error(`the corpus floor must be a whole number of files, 1 or more, not ${floor}`);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) throw new Error(`the corpus folder ${dir} is missing, so nothing was checked`);
  const names = readdirSync(dir).sort();
  if (names.length < floor) throw new Error(`the corpus folder ${dir} holds ${names.length} file(s), below its floor of ${floor}: a file that went missing is not a corpus that passed`);
  const files = [];
  const problems = [];
  for (const name of names) {
    const path = join(dir, name);
    if (!lstatSync(path).isFile()) {
      problems.push(`${name}: not a regular file (a folder or a link)`);
      continue;
    }
    const ext = extname(name);
    if (!CORPUS_EXTENSIONS.includes(ext)) {
      problems.push(`${name}: the extension ${JSON.stringify(ext)} is not one of ${CORPUS_EXTENSIONS.join(' ')}`);
      continue;
    }
    const { text, why } = textOf(readFileSync(path));
    if (why) {
      problems.push(`${name}: ${why}`);
      continue;
    }
    text.split('\n').forEach((line, i) => {
      const found = linePrivacy(line);
      if (found) problems.push(`${name}:${i + 1}: ${found}`);
    });
    files.push({ name, ext, text });
  }
  if (problems.length) throw new Error(`the corpus at ${dir} cannot be trusted: ${problems.slice(0, 8).join('; ')}${problems.length > 8 ? `; and ${problems.length - 8} more` : ''}`);
  return files;
}
