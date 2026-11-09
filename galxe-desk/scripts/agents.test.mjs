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

// The agent loader reads frontmatter as YAML, so each spelling below is the same breach to it as the plain one.
test('quoted or commented project memory is still project memory', () => {
  for (const spelling of ['memory: "project"', "memory: 'project'", 'memory: project # notes']) {
    const found = breaches(agent(`tools: Read, WebFetch\n${spelling}`));
    assert.equal(found.length, 1, spelling);
    assert.match(found[0], /carries memory: project/, spelling);
  }
});

test('a flow list of tools is read as a list', () => {
  const found = breaches(agent('tools: [Read, WebFetch, Write]'));
  assert.equal(found.length, 1);
  assert.match(found[0], /can also act \(Write\)/);
  assert.deepEqual(breaches(agent('tools: [Read, Grep, WebFetch]')), []);
  assert.deepEqual(breaches(agent(`tools: ['Read', "WebFetch"]`)), []);
});

test('a comment, quotes or a folded description on an ordinary agent are read, not flagged', () => {
  assert.deepEqual(breaches(agent('tools: Read, Grep, WebFetch # read-only')), []);
  assert.deepEqual(breaches(agent('tools: "Read, Grep, Write"\nmemory: "project"')), []);
  assert.deepEqual(breaches('---\nname: x\ndescription: >\n  reads pages,\n  writes nothing\n# a note\ntools: Read, WebFetch\n---\nbody\n'), []);
});

test('a tools or memory value this check cannot read plainly fails closed', () => {
  const unreadable = [
    'tools: Read, WebFetch\nmemory: "project',
    'tools: Read, WebFetch, Write]',
    'tools: Read, WebFetch\nmemory: !!str project',
    'tools: Read, WebFetch\nmemory: "proj\\x65ct"',
  ];
  for (const front of unreadable) assert.equal(breaches(agent(front)).length, 1, front);
});

test('a key set twice fails closed, whichever one a loader keeps', () => {
  assert.equal(breaches(agent('tools: Read, WebFetch, Write\ntools: Read, WebFetch')).length, 1);
  assert.equal(breaches(agent('tools: Read, WebFetch\nmemory: project\nmemory: user')).length, 1);
});

test('a line that is not a plain key: value fails closed', () => {
  assert.equal(breaches(agent('tools: Read, WebFetch\n"memory": project')).length, 1);
  assert.equal(breaches(agent('tools: Read, WebFetch\nmemory : project')).length, 1);
  assert.equal(breaches(agent('tools: Read, WebFetch\n- Write')).length, 1);
});

test('an indented line under tools or memory fails closed', () => {
  assert.equal(breaches(agent('tools: Read, WebFetch\nmemory:\n  project')).length, 1);
  assert.equal(breaches(agent('tools: Read, WebFetch\n  Write')).length, 1);
});

test('every agent in .claude/agents holds the firewall', () => {
  const bad = scan().filter((r) => r.breaches.length).map((r) => `${r.file}: ${r.breaches.join('; ')}`);
  assert.deepEqual(bad, []);
});
