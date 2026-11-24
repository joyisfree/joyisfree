// Tests of the real MUTATIONS list against the real repo: every line has a file, one match and a suite; no two lines
// are one guard; a changed agent file reaches the firewall guards. They read every file the list names, so they live
// here, outside every suite (plan 20, step A0): in mutate.test.mjs, mutate.mjs's own suite, they made that file's
// reach the whole repo, and then a change to any desk script, guard.mjs or prove.mjs would rerun mutate.mjs's own
// guards. npm test and prove's tests row still run this file (its folder's *.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUTATIONS, READS, SELF_REL, prepare, relPath, selectSince, twinsOf } from './mutate.mjs';

test('every listed mutation is four strings with a unique name, a real change, one match and a suite', () => {
  const names = new Set();
  for (const m of MUTATIONS) {
    assert.equal(m.length, 4, JSON.stringify(m));
    assert.ok(m.every((x) => typeof x === 'string'), m[0]);
    assert.ok(!names.has(m[0]), `${m[0]} is listed twice`);
    names.add(m[0]);
    assert.notEqual(m[2], m[3], m[0]);
    // mutate.mjs's own lines are checked by the run itself: in a mutated copy of this file their match is gone.
    if (relPath(m[1]) === SELF_REL) continue;
    const p = prepare(m);
    assert.equal(p.status, undefined, `${m[0]}: ${p.detail}`);
  }
});

test('no two listed mutations leave their file byte-identical, so killed N of N counts each guard once', () => {
  assert.deepEqual(twinsOf(MUTATIONS), []);
});

test('a changed agent file selects the agents.mjs firewall guards from the real list (the READS folder entry)', () => {
  const real = selectSince(MUTATIONS, ['.claude/agents/galxe-reader.md'], { reads: READS }).selected;
  assert.ok(real.some((m) => m[1] === 'agents.mjs'), 'the agents.mjs firewall guards are selected');
});
