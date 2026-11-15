// The desk's specialists read third-party text (video descriptions, comments, pasted posts, web pages), so none of
// them may hold a tool that writes, edits or runs code, or a project memory (which in some builds grants Write and
// Edit). The repo's CLAUDE.md says the same in words; this test makes it a check that fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS = fileURLToPath(new URL('../../.claude/agents/', import.meta.url));
const SKILL = fileURLToPath(new URL('../../.claude/skills/agency-personalise/SKILL.md', import.meta.url));
const FORBIDDEN = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);

export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export function problems(text) {
  const fm = frontmatter(text);
  if (!fm) return ['no frontmatter'];
  const found = [];
  if (!fm.tools) found.push('no explicit tools list');
  for (const t of String(fm.tools || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (FORBIDDEN.has(t)) found.push(`holds ${t}`);
  }
  if ('memory' in fm) found.push('has a project memory');
  return found;
}

const agencyAgents = () => readdirSync(AGENTS).filter((f) => /^agency-.*\.md$/.test(f));

test('the check itself catches a writer, an editor, a shell, a memory and a missing tools list', () => {
  const doc = (fm) => `---\nname: x\n${fm}\n---\nbody`;
  assert.deepEqual(problems(doc('tools: Read, Grep, Glob')), []);
  assert.deepEqual(problems(doc('tools: Read, Write')), ['holds Write']);
  assert.deepEqual(problems(doc('tools: Read, Edit, Bash')), ['holds Edit', 'holds Bash']);
  assert.deepEqual(problems(doc('tools: Read\nmemory: project')), ['has a project memory']);
  assert.deepEqual(problems(doc('model: sonnet')), ['no explicit tools list']);
});

test('no agency specialist can write, edit, run code or keep a memory', () => {
  const files = agencyAgents();
  assert.ok(files.length >= 5, `expected the five agency specialists, found ${files.length}`);
  const bad = files.flatMap((f) => problems(readFileSync(join(AGENTS, f), 'utf8')).map((p) => `${f}: ${p}`));
  assert.deepEqual(bad, [], 'a specialist that reads untrusted text must not be able to write or act');
});

// Rules Leif has since replaced. A specialist that still reads the old rule will follow it, so the old wording may
// not survive in any specialist's brief or in the routine. Each entry: the retired phrase, and what replaced it.
export const RETIRED = [
  ['with the honest number', 'the creator and the numbers go in the one-pager after a yes, never in a first message'],
  ['gives the website', "Leif's emails carry no links"],
  ['is the number believable', 'a first message carries no number'],
  ['automatic run', 'nothing drafts itself'],
  ['need no permission', 'a draft is made only when Leif says so'],
  ['youtube-transcriber', "no video is watched through Leif's signed-in browser"],
];

export function retired(text) {
  const lower = String(text).toLowerCase();
  return RETIRED.filter(([phrase]) => lower.includes(phrase)).map(([phrase, now]) => `"${phrase}" (now: ${now})`);
}

test('the retired-rule check catches each old phrase, in any case', () => {
  assert.deepEqual(retired('One question, then the opt-out.'), []);
  for (const [phrase] of RETIRED) assert.equal(retired(`x ${phrase.toUpperCase()} y`).length, 1, phrase);
});

test('no specialist brief and no routine still carries a retired rule', () => {
  const files = [...agencyAgents().map((f) => join(AGENTS, f)), SKILL];
  const bad = files.flatMap((f) => retired(readFileSync(f, 'utf8')).map((p) => `${f.split('/').slice(-1)[0]}: ${p}`));
  assert.deepEqual(bad, []);
});

test('the reader is told never to fetch youtube.com pages', () => {
  const reader = readFileSync(join(AGENTS, 'agency-reader.md'), 'utf8');
  assert.match(reader, /never (fetch|open|read)[^.]*youtube\.com/i, "YouTube's terms ban scripts on its pages: only the Data API is used");
});
