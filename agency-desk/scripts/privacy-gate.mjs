#!/usr/bin/env node
// The public-repo gate: the joyisfree repository is public, so no real person's address or name may be committed,
// and no API key. Scans every tracked and untracked (not ignored) file under the given paths. Exit 1 on any hit.
//
//   node agency-desk/scripts/privacy-gate.mjs --names <people, one per line> --terms <brands and creators>
//                                             [--history [--known <hash,hash>]] [--root <another clone>] [paths...]
//
//   --history      also scans every line any commit ever added under the paths, on every branch: a name deleted
//                  from a file is still public in the commit that added it. A hit there is printed as
//                  "<short hash> <file> <kind>", never with its value, which would repeat the leak in a log.
//   --known        commits already known to hold old hits, by seven or more characters of their hashes. Their hits
//                  are listed as known and do not fail the gate; a hit in any other commit still does.
//   --emails-only  runs without the two lists, for addresses alone.
//   The shape of a Google API key is a hit of kind "secret" on every run, and is never printed. Exit 2 when the
//   gate cannot tell what it was asked: no lists, a flag it does not know, or nothing to read under the paths.
import { readFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { args, isMain, assertOutsideRepo, REPO_ROOT } from './lib.mjs';

// RFC 2606 / 6761 reserved names, safe for fixtures and docs.
const RESERVED = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;
const EMAIL = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
// A Google API key, which the YouTube key is: AIza and 35 more characters.
const SECRET = /AIza[0-9A-Za-z_-]{35}/g;
export const DEFAULT_PATHS = ['agency-desk', '.claude/agents', '.claude/skills/agency-personalise'];
const FLAGS = ['names', 'terms', 'emails-only', 'history', 'known', 'root'];

export function scanText(text, { names = [], terms = [] } = {}) {
  const hits = [];
  for (const m of text.matchAll(EMAIL)) {
    const domain = m[1].toLowerCase().replace(/\.$/, '');
    if (!RESERVED.test(domain) && !/^[\w.-]+\.(png|jpe?g|svg|gif|webp)$/i.test(domain)) hits.push({ kind: 'address', value: m[0] });
  }
  // A key is a hit whatever lists were given. The hit carries no value, so nothing downstream can print the key.
  (text.match(SECRET) || []).forEach(() => hits.push({ kind: 'secret' }));
  const lower = text.toLowerCase();
  for (const n of names) {
    const name = n.trim();
    if (name.split(/\s+/).length < 2 || name.length < 6) continue; // a first name alone is not identifying
    if (lower.includes(name.toLowerCase())) hits.push({ kind: 'name', value: name });
  }
  // Brand and creator names are pipeline details too: whole words of three letters or more, in any case, so a
  // handle (@name), a URL slug, a code variable or a heading in capitals is caught as well. Skipping short names
  // once let a real one reach a public test file; a false alarm costs a rename, a leak cannot be taken back.
  for (const t of terms) {
    const term = t.trim();
    if (term.length < 3) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`, 'i');
    if (re.test(text)) hits.push({ kind: 'term', value: term });
  }
  return hits;
}

export function listFiles(paths, root = REPO_ROOT) {
  // -z: git prints a name with an accent inside quotes otherwise, and a file not found under the quoted name was
  // skipped without a word.
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());
}

// Every line any commit ever added under the paths, on every branch. The options pin what git prints, so that no
// machine's settings and no shape of history can hide a line: headers of the hash alone (an author's name or address
// in a header would be a false alarm), side branches whose changes were thrown away (--full-history), the first
// commit (--root), files git calls binary (--text), no local filter (--no-textconv), no colour codes, bare file
// names (--no-prefix), and for a merge the lines neither parent had (--cc). A hit carries its commit, its file and
// its kind, never its value.
export function scanHistory(paths, lists = {}, root = REPO_ROOT) {
  let log;
  try {
    log = execFileSync('git', ['-C', root, 'log', '--all', '--full-history', '--root', '--text', '--no-textconv', '--no-color', '--no-prefix',
      '--cc', '-U0', '--abbrev=7', '--format=commit %H %h', '--', ...paths], { encoding: 'utf8', maxBuffer: 2 ** 30 });
  } catch (e) {
    // Left to itself, Node prints what git had written before it failed, which is the history's own text.
    throw new Error(`privacy gate: git log failed (${e.code || `exit ${e.status}`}), so the history was not read`);
  }
  const hits = [];
  let commits = 0;
  let commit;
  let file;
  let plus = ''; // what starts an added line inside a hunk: "+", or "++" where a merge has two parents
  let added = [];
  const flush = () => {
    for (const h of added.length ? scanText(added.join('\n'), lists) : []) hits.push({ ...commit, file, kind: h.kind });
    added = [];
  };
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) { flush(); const [, hash, short] = line.split(' '); commit = { hash, short }; commits++; plus = ''; }
    else if (line.startsWith('diff ')) { flush(); file = '(no file name)'; plus = ''; }
    else if (line.startsWith('@@')) plus = '+'.repeat(line.indexOf(' ') - 1);
    else if (!plus) { if (line.startsWith('+++ ')) file = line.slice(4).replace(/\t$/, ''); }
    else if (line.startsWith(plus)) added.push(line.slice(plus.length));
  }
  flush();
  return { commits, hits };
}

// Every creator handle or brand the desk researches goes onto the private terms list at once, so the gate knows the
// name before it can reach a public file. One term per line; a handle is kept without its @, so the bare name is
// caught as well (unless what is left is too short for the gate to match). Returns the terms that were new.
export function appendTerms(file, terms) {
  const path = assertOutsideRepo(file);
  const old = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const seen = new Set(old.split('\n').map((t) => t.trim().toLowerCase()));
  const fresh = [];
  for (const t of [terms].flat()) {
    const term = String(t ?? '').replace(/\s+/g, ' ').trim().replace(/^@+(?=.{3})/, '');
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    fresh.push(term);
  }
  if (fresh.length) appendFileSync(path, `${old && !old.endsWith('\n') ? '\n' : ''}${fresh.join('\n')}\n`);
  return fresh;
}

// What a hit in a file shows: an address as it stands there, never a private name or term, never a key.
const shown = (h) => (h.kind === 'address' ? h.value : h.kind === 'secret' ? '(the shape of an API key)' : '(a name or term from the private list)');

function main() {
  const a = args();
  // Fail closed on the command itself. A flag the gate does not know is refused: a mistyped --history would be
  // dropped and the files alone would pass. And args() hands a bare flag the word after it, so `--history docs`
  // gets its path back instead of scanning the default paths.
  const unknown = Object.keys(a).filter((k) => k !== '_' && !FLAGS.includes(k));
  if (unknown.length) {
    console.error(`privacy gate: no such flag: ${unknown.map((k) => `--${k}`).join(', ')}`);
    process.exit(2);
  }
  for (const flag of ['history', 'emails-only']) if (typeof a[flag] === 'string') a._.unshift(a[flag]);
  const names = a.names ? readFileSync(a.names, 'utf8').split('\n').filter(Boolean) : [];
  const terms = a.terms ? readFileSync(a.terms, 'utf8').split('\n').filter(Boolean) : [];
  // Fail closed: with no names and no terms the gate could only see addresses, and would pass a leaked name.
  if (!a['emails-only'] && (!names.length || !terms.length)) {
    console.error('privacy gate: refusing to run without a names list and a terms list (--names, --terms); pass --emails-only to check addresses alone');
    process.exit(2);
  }
  // Fail closed again: a listed commit is excused, so a short or empty entry would excuse commits nobody named.
  const known = a.known === undefined ? [] : String(a.known).toLowerCase().split(',').map((k) => k.trim()).filter(Boolean);
  if (a.known !== undefined && (!a.history || !known.length || known.some((k) => !/^[0-9a-f]{7,64}$/.test(k)))) {
    console.error('privacy gate: --known takes commit hashes of seven characters or more, separated by commas, and only with --history');
    process.exit(2);
  }
  const root = a.root ? resolve(a.root) : REPO_ROOT;
  const paths = a._.length ? a._ : DEFAULT_PATHS;
  const files = listFiles(paths, root);
  let total = 0;
  for (const f of files) {
    const hits = scanText(readFileSync(join(root, f), 'utf8'), { names, terms });
    for (const h of hits) { total++; console.log(`${f}: ${h.kind} ${shown(h)}`); }
  }
  const past = a.history ? scanHistory(paths, { names, terms }, root) : { commits: 0, hits: [] };
  let old = 0;
  for (const h of past.hits) {
    const excused = known.some((k) => h.hash.startsWith(k));
    if (excused) old++; else total++;
    console.log(`${h.short} ${h.file} ${h.kind}${excused ? ' (known)' : ''}`);
  }
  // Fail closed on a scan of nothing: a mistyped path has no hits either.
  if (!files.length && !past.commits) {
    console.error(`privacy gate: nothing to read under ${paths.join(', ')}`);
    process.exit(2);
  }
  console.log(`privacy gate: ${files.length} files scanned${a.history ? ` · history: ${past.commits} commits that touch these paths` : ''} · ${total} hits${old ? ` · ${old} more in known commits` : ''}${names.length ? ` · ${names.length} sheet names checked` : ''}`);
  process.exit(total ? 1 : 0);
}

if (isMain(import.meta.url)) main();
