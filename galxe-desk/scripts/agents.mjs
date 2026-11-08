#!/usr/bin/env node
// The reader/writer firewall from CLAUDE.md, as a check instead of a promise: an agent that can read outside content
// (WebFetch, WebSearch or any MCP tool) may not also write, edit, run code or spawn agents, and may not carry
// `memory: project`, which in some builds silently grants Write and Edit. An agent with no explicit `tools` line
// inherits every tool, so it fails too.
//
//   node galxe-desk/scripts/agents.mjs     # names each breach in .claude/agents and exits 1 if there is one

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const AGENTS_DIR = join(REPO, '.claude', 'agents');

export const isWeb = (t) => t === 'WebFetch' || t === 'WebSearch' || t.startsWith('mcp__');
export const WRITE = new Set(['Write', 'Edit', 'Bash', 'NotebookEdit', 'Agent', 'Task']);

/** The key: value lines between the opening and closing `---`. Returns null when there is no frontmatter. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

/** Every way one agent file breaks the firewall, as plain sentences. Empty means it holds. */
export function breaches(text) {
  const fm = frontmatter(text);
  if (!fm) return ['no frontmatter, so its tools cannot be checked'];
  if (!fm.tools) return ['no explicit tools line, so it inherits every tool'];
  const tools = fm.tools.split(',').map((t) => t.trim()).filter(Boolean);
  const web = tools.filter(isWeb);
  const write = tools.filter((t) => WRITE.has(t));
  const memory = String(fm.memory ?? '').trim();
  const out = [];
  if (web.length && write.length) out.push(`reads outside content (${web.join(', ')}) and can also act (${write.join(', ')})`);
  if (web.length && memory === 'project') out.push(`reads outside content (${web.join(', ')}) and carries memory: project`);
  return out;
}

export function scan(dir = AGENTS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => ({ file, breaches: breaches(readFileSync(join(dir, file), 'utf8')) }));
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const results = scan();
  const bad = results.filter((r) => r.breaches.length);
  for (const r of bad) for (const b of r.breaches) console.log(`BREACH ${r.file}: ${b}`);
  console.log(bad.length ? `${bad.length} of ${results.length} agents break the firewall` : `all ${results.length} agents hold the firewall`);
  process.exitCode = bad.length ? 1 : 0;
}
