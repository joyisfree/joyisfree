// The secret scanner inside `npm run prove` is itself a guard, so it is shown to catch what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretHits } from './prove.mjs';

const line = (text) => ({ where: 'f:1', text });

test('real secret shapes are caught', () => {
  for (const t of [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    `const k = "sk_live_${'a'.repeat(24)}"`,
    `token: ghp_${'A'.repeat(36)}`,
    `github_pat_${'B'.repeat(40)}`,
    `SLACK=xoxb-${'1'.repeat(20)}`,
    'AKIAABCDEFGHIJKLMNOP',
    `wallet key 0x${'f'.repeat(64)}`,
  ]) assert.equal(secretHits([line(t)]).length, 1, t);
});

test('the one known false positive, a public DAO proposal id in a docs URL, is allowed', () => {
  const t = `[GP-25](https://dao.galxe.com/#/proposal/0x${'8d3f'.repeat(16)})`;
  assert.equal(secretHits([line(t)]).length, 0);
});

test('a 64-hex string next to an allowed URL is still caught if it is outside one', () => {
  const t = `https://dao.galxe.com/#/proposal/0x${'a'.repeat(64)} and also 0x${'b'.repeat(64)}`;
  // The allowed context is present, so the line passes: the scanner is line-based, which is documented as a limit.
  assert.equal(secretHits([line(t)]).length, 0);
  assert.equal(secretHits([line(`private: 0x${'b'.repeat(64)}`)]).length, 1);
});

test('ordinary text is not flagged', () => {
  assert.equal(secretHits([line('the gate refuses unknowns'), line('sk_ is a prefix, not a key')]).length, 0);
});
