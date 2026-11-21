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
// trunk 0 (0412 345 678, (02) 9876 5432, 020 7946 0958, 0412345678); and the North American shape ((555) 123-4567,
// 555-123-4567). A date (2026-11-01, 01-11-2026), a time zone (+1100), a price (178.00) and a SKU are none of these.
const PHONES = [
  { re: /(?<![\w+])\+\d[\d ().-]{6,}\d/g, min: 8, max: 15 },
  { re: /(?<![\w.+-])(?:\(0[1-9]\d{0,3}\)|0[1-9]\d{0,3})(?:[ -]?\d{3,4}){1,3}(?![\w-]|\.\d)/g, min: 9, max: 11 },
  { re: /(?<![\w.+-])(?:\(\d{3}\) ?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-]|\.\d)/g, min: 10, max: 10 },
];

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
  for (const { re, min, max } of PHONES) {
    for (const m of s.matchAll(re)) {
      const n = digits(m[0]);
      if (n >= min && n <= max) return 'a phone number';
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
