// The reader/writer firewall is judged on fixtures first, so each rule is shown to fail, then on the real agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breaches, scan } from './agents.mjs';

const agent = (front) => `---\nname: x\ndescription: y\n${front}\n---\nbody\n`;

test('a web reader that can also write is a breach', () => {
  assert.equal(breaches(agent('tools: Read, WebFetch, Write')).length, 1);
  assert.equal(breaches(agent('tools: WebSearch, Bash')).length, 1);
  assert.equal(breaches(agent('tools: WebSearch, Agent')).length, 1);
});

test('an MCP tool counts as outside content', () => {
  assert.equal(breaches(agent('tools: mcp__Context7__query-docs, Edit')).length, 1);
});

test('a web reader with project memory is a breach', () => {
  assert.equal(breaches(agent('tools: Read, WebFetch\nmemory: project')).length, 1);
});

test('an agent with no tools line inherits every tool and fails closed', () => {
  assert.equal(breaches(agent('model: sonnet')).length, 1);
  assert.equal(breaches('no frontmatter at all').length, 1);
});

test('a read-only web reader and a writer with no web tool both hold', () => {
  assert.deepEqual(breaches(agent('tools: WebSearch, ToolSearch, mcp__Context7__query-docs')), []);
  assert.deepEqual(breaches(agent('tools: Read, Grep, Glob, WebFetch')), []);
  assert.deepEqual(breaches(agent('tools: Read, Grep, Glob, Write\nmemory: project')), []);
});

test('every agent in .claude/agents holds the firewall', () => {
  const bad = scan().filter((r) => r.breaches.length).map((r) => `${r.file}: ${r.breaches.join('; ')}`);
  assert.deepEqual(bad, []);
});
