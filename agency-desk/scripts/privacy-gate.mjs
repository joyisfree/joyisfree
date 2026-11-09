#!/usr/bin/env node
// The public-repo gate: the joyisfree repository is public, so no real person's address or name may be committed.
// Scans every tracked and untracked (not ignored) file under the given paths. Exit 1 on any hit.
//
//   node agency-desk/scripts/privacy-gate.mjs [--names <people, one per line>] [--terms <brands and creators>] [paths...]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { args, isMain, REPO_ROOT } from './lib.mjs';

// RFC 2606 / 6761 reserved names, safe for fixtures and docs.
const RESERVED = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;
const EMAIL = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
export const DEFAULT_PATHS = ['agency-desk', '.claude/agents', '.claude/skills/agency-personalise'];

export function scanText(text, { names = [], terms = [] } = {}) {
  const hits = [];
  for (const m of text.matchAll(EMAIL)) {
    const domain = m[1].toLowerCase().replace(/\.$/, '');
    if (!RESERVED.test(domain) && !/^[\w.-]+\.(png|jpe?g|svg|gif|webp)$/i.test(domain)) hits.push({ kind: 'address', value: m[0] });
  }
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
  const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...paths], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());
}

function main() {
  const a = args();
  const names = a.names ? readFileSync(a.names, 'utf8').split('\n').filter(Boolean) : [];
  const terms = a.terms ? readFileSync(a.terms, 'utf8').split('\n').filter(Boolean) : [];
  // Fail closed: with no names and no terms the gate could only see addresses, and would pass a leaked name.
  if (!a['emails-only'] && (!names.length || !terms.length)) {
    console.error('privacy gate: refusing to run without a names list and a terms list (--names, --terms); pass --emails-only to check addresses alone');
    process.exit(2);
  }
  const paths = a._.length ? a._ : DEFAULT_PATHS;
  const files = listFiles(paths);
  let total = 0;
  for (const f of files) {
    const hits = scanText(readFileSync(join(REPO_ROOT, f), 'utf8'), { names, terms });
    for (const h of hits) { total++; console.log(`${f}: ${h.kind} ${h.kind === 'address' ? h.value : '(a name or term from the private list)'}`); }
  }
  console.log(`privacy gate: ${files.length} files scanned · ${total} hits${names.length ? ` · ${names.length} sheet names checked` : ''}`);
  process.exit(total ? 1 : 0);
}

if (isMain(import.meta.url)) main();
