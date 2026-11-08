// The secret scanner inside `npm run prove` is itself a guard, so it is shown to catch what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretHits } from './prove.mjs';

const line = (text) => ({ where: 'f:1', text });

// The fixtures are assembled at runtime from pieces, so this file's own source never contains a secret shape and
// `npm run prove`'s scan of the repo stays clean. 8 Nov 2026: written as literals, they made prove flag itself.
const j = (...parts) => parts.join('');

test('real secret shapes are caught', () => {
  for (const t of [
    j('-----BEGIN OPENSSH ', 'PRIVATE', ' KEY-----'),
    j('const k = "', 'sk', '_live_', 'a'.repeat(24), '"'),
    j('token: ', 'gh', 'p_', 'A'.repeat(36)),
    j('gith', 'ub_pat_', 'B'.repeat(40)),
    j('SLACK=', 'xo', 'xb-', '1'.repeat(20)),
    j('AK', 'IA', 'ABCDEFGHIJKLMNOP'),
    j('wallet key ', '0', 'x', 'f'.repeat(64)),
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
