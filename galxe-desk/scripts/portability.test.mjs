// The four scripts decide "am I being run as a CLI?" by resolving both sides to a real path before comparing,
// so they still run when the invocation path has a space, a symlink or a non-ASCII character. A raw
// `file://${process.argv[1]}` would not match import.meta.url then, and the CLI would silently do nothing.
// The same one-line fix is in rank.mjs, ledger.mjs, do-card.mjs and rulebook-crawl.mjs; rank.mjs stands for all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

test('rank.mjs still runs as a CLI when its path has a space and goes through a symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'has space-'));
  const cands = join(dir, 'c.json');
  const out = join(dir, 'out.md');
  writeFileSync(cands, JSON.stringify([{ _note: 'metadata only: the gate skips it, so no network is needed' }]));
  const acct = resolve(here, '..', 'account.json');
  const linked = join(dir, 'rank.mjs'); // inside a directory whose name contains a space
  symlinkSync(resolve(here, 'rank.mjs'), linked);
  execFileSync(process.execPath, [linked, '--candidates', cands, '--account', acct, '--out', out], { stdio: 'pipe' });
  assert.ok(existsSync(out), 'the CLI ran and wrote its shortlist (it would not, with the raw-argv check)');
  assert.match(readFileSync(out, 'utf8'), /# Shortlist/);
});
