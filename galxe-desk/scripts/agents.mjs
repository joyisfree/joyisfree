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

// The two keys the firewall reads. The agent loader reads them as YAML, so `memory: "project"`, `memory: project # x`
// and `tools: [Read, WebFetch, Write]` are read the way YAML reads them, and a value still holding YAML this check
// does not follow (a quote, bracket, brace, # or backslash, or a tag, anchor, alias or block scalar) fails closed.
const READ = new Set(['tools', 'memory']);
const UNPLAIN = /["'#[\]{}\\]|^[!&*|>%@`]/;

/** One value as YAML reads it: a trailing ` # comment` and one pair of matching quotes removed. */
function scalar(raw) {
  let v = raw.trim();
  const hash = v.search(/(^|\s)#/);
  if (hash !== -1) v = v.slice(0, hash).trim();
  const quoted = /^(["'])(.*)\1$/.exec(v);
  return quoted ? quoted[2].trim() : v;
}

/** A tools value as a list of names, written `Read, Grep` or as the flow list `[Read, Grep]`. */
function list(raw) {
  const v = scalar(raw);
  const flow = /^\[(.*)\]$/.exec(v);
  return (flow ? flow[1] : v).split(',').map(scalar).filter(Boolean);
}

/**
 * The key: value lines between the opening and closing `---`, as { fields, problems }: tools is a list, memory a
 * string, and problems names every line that cannot be read plainly (not key: value, indented under tools or memory,
 * a key set twice, a tools or memory value that is not plain). Returns null when there is no frontmatter.
 */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fields = {};
  const problems = [];
  let key = null;
  m[1].split(/\r?\n/).forEach((line, i) => {
    const at = `frontmatter line ${i + 2}`;
    if (!line.trim() || line.trim().startsWith('#')) return;
    if (/^\s/.test(line)) {
      if (key === null || READ.has(key)) problems.push(`${at} is indented under ${key ?? 'no key'}, which this check cannot read`);
      return;
    }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) problems.push(`${at} is not a plain key: value line, so the agent cannot be checked`);
    key = kv ? kv[1] : null;
    if (!key) return;
    if (Object.hasOwn(fields, key)) problems.push(`${key} is set twice, so which one the loader reads cannot be known`);
    const raw = (kv[2] ?? '').trim();
    fields[key] = key === 'tools' ? list(raw) : key === 'memory' ? scalar(raw) : raw;
    if (READ.has(key) && [].concat(fields[key]).some((v) => UNPLAIN.test(v))) problems.push(`${key} is not written plainly (${raw}), so it cannot be checked`);
  });
  return { fields, problems };
}

/** Every way one agent file breaks the firewall, as plain sentences. Empty means it holds. */
export function breaches(text) {
  const fm = frontmatter(text);
  if (!fm) return ['no frontmatter, so its tools cannot be checked'];
  if (fm.problems.length) return fm.problems;
  const { tools = [], memory = '' } = fm.fields;
  if (!tools.length) return ['no explicit tools line, so it inherits every tool'];
  const web = tools.filter(isWeb);
  const write = tools.filter((t) => WRITE.has(t));
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
