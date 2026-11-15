// The desk's specialists read third-party text (video descriptions, comments, pasted posts, web pages), so none of
// them may hold a tool that writes, edits or runs code, or a project memory (which in some builds grants Write and
// Edit). The repo's CLAUDE.md says the same in words; this test makes it a check that fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS = fileURLToPath(new URL('../../.claude/agents/', import.meta.url));
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
