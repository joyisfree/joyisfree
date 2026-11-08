// The ledger's arithmetic, the claim deadlines, every kill rule and the lane's standing decision, on fixtures.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLedger, status, validate, format, formatDue, readDecision, decisionStop, withDecision, DECISION_FILE, LANE, REFUSED_ON } from './ledger.mjs';

const rules = { day30MinRealisedUsd: 10, minNetUsdPerHour: 15, horizonDays: 90 };
const day = (n) => Date.parse('2026-11-01T00:00:00Z') + n * 86_400_000;

const fixture = [
  { ts: '2026-11-01T09:00:00Z', quest: 'A', action: 'entered', minutes: 8, fee: 0.08 },
  { ts: '2026-11-02T09:00:00Z', quest: 'B', action: 'entered', minutes: 6, fee: 0.08 },
  { ts: '2026-11-05T09:00:00Z', quest: 'A', action: 'won', amount: 16.5, deadline: '2026-11-20' },
  { ts: '2026-11-06T09:00:00Z', quest: 'A', action: 'claimed', minutes: 2, fee: 0.08, gas: 0.02 },
  { ts: '2026-11-07T09:00:00Z', quest: 'A', action: 'realised', amount: 14.9 },
  { ts: '2026-11-08T09:00:00Z', quest: 'B', action: 'won', amount: 3, deadline: '2026-11-10' },
];

test('parses one JSON line per event', () => {
  const text = fixture.map((e) => JSON.stringify(e)).join('\n') + '\n\n';
  assert.equal(parseLedger(text).length, 6);
});

test('status adds up the money and the minutes', () => {
  const s = status(fixture, rules, day(8));
  assert.equal(s.entered, 2);
  assert.equal(s.won, 2);
  assert.equal(s.claimed, 1);
  assert.equal(s.realisedUsd, 14.9);
  assert.ok(Math.abs(s.costsUsd - 0.26) < 1e-9, `costs ${s.costsUsd}`);
  assert.ok(Math.abs(s.netUsd - 14.64) < 1e-9);
  assert.equal(s.minutes, 16);
  assert.ok(Math.abs(s.netUsdPerHour - 14.64 / (16 / 60)) < 1e-9);
  assert.equal(s.day, 9);
  assert.equal(s.kill, 'CONTINUE');
});

test('a won quest not yet claimed is due until its deadline, then OVERDUE', () => {
  const before = status(fixture, rules, day(8));
  assert.deepEqual(before.due.map((d) => d.quest), ['B']);
  assert.equal(before.overdue.length, 0);
  const after = status(fixture, rules, day(12));
  assert.deepEqual(after.overdue.map((d) => d.quest), ['B']);
  assert.match(format(after), /OVERDUE: B \(was 2026-11-10\)/);
});

test('the claim clock lists what is due, what is late, and says so plainly when nothing is', () => {
  assert.match(formatDue(status(fixture, rules, day(8))), /^Due: B by 2026-11-10$/m);
  const late = formatDue(status(fixture, rules, day(12)));
  assert.match(late, /^OVERDUE \(claim window gone[^)]*\): B \(was 2026-11-10\)$/m);
  assert.match(formatDue(status([], rules, day(1))), /No claim is waiting/);
});

test('kill rule: a flag stops the desk at once', () => {
  const s = status([...fixture, { ts: '2026-11-09T09:00:00Z', quest: 'C', action: 'flag', note: 'Bot activity detected' }], rules, day(9));
  assert.match(s.kill, /^STOP_FLAG: Bot activity detected/);
});

test('kill rule: day 30 with under $10 realised stops', () => {
  const thin = fixture.filter((e) => e.action !== 'realised');
  assert.match(status(thin, rules, day(30)).kill, /^STOP_DAY30/);
  assert.equal(status(fixture, rules, day(30)).kill, 'CONTINUE');
});

test('kill rule: day 60 below the hourly bar stops, above it continues', () => {
  const slow = [...fixture, { ts: '2026-11-20T09:00:00Z', quest: 'D', action: 'entered', minutes: 600, fee: 0 }];
  assert.match(status(slow, rules, day(60)).kill, /^STOP_RATE/);
  assert.equal(status(fixture, rules, day(60)).kill, 'CONTINUE');
  assert.match(status(fixture, rules, day(91)).kill, /^HORIZON/);
});

test('validate refuses unknown actions, missing ids and a win without its deadline', () => {
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'dance' }), /unknown action/);
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', action: 'entered' }), /quest id required/);
  assert.throws(() => validate({ ts: 'yesterday', quest: 'A', action: 'entered' }), /ISO date/);
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won' }), /claim deadline/);
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won' }), /CLAIMING\.md/);
  // 30 Oct 2026, the adversarial review: a non-date deadline (or a bare `--deadline` that args() turns into
  // "true") used to be stored and then read as due for ever, never OVERDUE. It must be a real date.
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won', deadline: 'soon' }), /deadline as a date/);
  assert.throws(() => validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won', deadline: 'true' }), /deadline as a date/);
  assert.ok(validate({ ts: '2026-11-01T00:00:00Z', quest: 'A', action: 'won', deadline: '2026-11-16' }));
});

// 30 Oct 2026: a patch made with String.replace once ate the "$" in these messages ("realised 14.90 < 10").
test('kill-rule messages keep their dollar signs', () => {
  const thin = fixture.filter((e) => e.action !== 'realised');
  assert.equal(status(thin, rules, day(30)).kill, 'STOP_DAY30: realised $0.00 < $10');
  const slow = [...fixture, { ts: '2026-11-20T09:00:00Z', quest: 'D', action: 'entered', minutes: 600, fee: 0 }];
  assert.match(status(slow, rules, day(60)).kill, /^STOP_RATE: \$\d+\.\d\d\/h < \$15\/h$/);
});

// 8 Nov 2026, audit A5 and A11: the 31 Oct REFUSE lived only in prose, so `desk:status` printed CONTINUE and exited 0
// on a lane Leif had closed. The decision is now a file the status reads, and it fails closed.
const refused = { lane: 'galxe-questing', verdict: 'REFUSED', decidedOn: '2026-10-31', record: 'galxe-desk/docs/decision-2026-10-31-questing.md', reopensOnlyIf: 'Leif reopens it in his own words' };
const REFUSED_STOP = 'STOP_DECISION: refused 2026-10-31 (galxe-desk/docs/decision-2026-10-31-questing.md); reopens only if Leif reopens it in his own words';
const reopened = (over = {}) => ({ lane: 'galxe-questing', verdict: 'REOPENED', reopenedOn: '2026-11-08', leifsWords: 'reopen the Galxe questing, I want to try it again', ...over });
// Every temporary file lives under one folder, removed when the file finishes.
const SCRATCH = mkdtempSync(join(tmpdir(), 'ledger-test-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const scratch = (prefix) => mkdtempSync(join(SCRATCH, prefix));
const flagged = [...fixture, { ts: '2026-11-09T09:00:00Z', quest: 'C', action: 'flag', note: 'Bot activity detected' }];

test('a refused decision is a stop that names its date, its record and how it reopens', () => {
  assert.equal(LANE, 'galxe-questing');
  assert.equal(decisionStop({ decision: refused }), REFUSED_STOP);
});

test('the decision outranks CONTINUE: an empty ledger on a refused lane is STOP_DECISION', () => {
  const s = withDecision(status([], rules, day(1)), decisionStop({ decision: refused }));
  assert.equal(s.kill, REFUSED_STOP);
  assert.equal(s.decision, REFUSED_STOP);
  assert.match(format(s), /^Kill rule: STOP_DECISION: refused 2026-10-31/m);
  // Leaving the ledger's own numbers and claim clock as they were.
  assert.equal(s.day, 0);
  assert.match(formatDue(s), /No claim is waiting/);
});

test('the decision outranks the ledger\'s numeric stops too, because the lane is closed whatever the numbers say', () => {
  const thin = fixture.filter((e) => e.action !== 'realised');
  assert.equal(withDecision(status(thin, rules, day(30)), REFUSED_STOP).kill, REFUSED_STOP);
});

test('the decision never hides a flag: the flag stays the kill rule and the decision is printed beside it', () => {
  const s = withDecision(status(flagged, rules, day(9)), decisionStop({ decision: refused }));
  assert.match(s.kill, /^STOP_FLAG: Bot activity detected/);
  assert.equal(s.decision, REFUSED_STOP);
  const text = format(s);
  assert.match(text, /^Kill rule: STOP_FLAG: Bot activity detected$/m);
  assert.match(text, /^Decision: STOP_DECISION: refused 2026-10-31/m);
});

test('the decision line is not printed twice when it is already the kill rule, nor at all on an open lane', () => {
  const stopped = format(withDecision(status([], rules, day(1)), REFUSED_STOP));
  assert.doesNotMatch(stopped, /^Decision:/m);
  const open = withDecision(status(fixture, rules, day(8)), decisionStop({ decision: reopened() }));
  assert.equal(open.kill, 'CONTINUE');
  assert.equal(open.decision, null);
  assert.doesNotMatch(format(open), /Decision:/);
});

test('a missing, unreadable or malformed decision file fails closed and says why', () => {
  const dir = scratch('decision-');
  const missing = readDecision(join(dir, 'no-such-decision.json'));
  assert.match(decisionStop(missing), /^STOP_DECISION: the decision record .*no-such-decision\.json could not be read \(ENOENT\), so the lane is treated as stopped$/);
  writeFileSync(join(dir, 'broken.json'), '{ "verdict": "REFUSED", ');
  assert.match(decisionStop(readDecision(join(dir, 'broken.json'))), /^STOP_DECISION: .*broken\.json is not valid JSON/);
  assert.match(decisionStop(readDecision(dir)), /^STOP_DECISION: .*could not be read \(EISDIR\)/, 'a directory is not a record');
  // Valid JSON that is not a record.
  for (const d of [null, [], 'REOPENED', 7]) assert.match(decisionStop({ decision: d }), /^STOP_DECISION: the decision record is not an object/, JSON.stringify(d));
  assert.match(decisionStop({}), /^STOP_DECISION: the decision record is not an object/);
  assert.match(decisionStop(), /^STOP_DECISION:/);
});

test('a verdict the desk does not know is a stop, never an open lane', () => {
  for (const verdict of ['MAYBE', 'refused', 'PURSUE', '', undefined]) {
    assert.match(decisionStop({ decision: { ...refused, verdict } }), /^STOP_DECISION: the decision record's verdict .* is not REFUSED or REOPENED/, String(verdict));
  }
});

test('only a well-formed reopening, dated and in Leif\'s own words, opens the lane', () => {
  assert.equal(decisionStop({ decision: reopened() }), null);
  const needs = /^STOP_DECISION: a reopening needs reopenedOn as a date and leifsWords quoting Leif/;
  assert.match(decisionStop({ decision: reopened({ reopenedOn: undefined }) }), needs);
  assert.match(decisionStop({ decision: reopened({ reopenedOn: 'soon' }) }), needs);
  assert.match(decisionStop({ decision: reopened({ reopenedOn: 20261207 }) }), needs, 'a bare number is not a date');
  assert.match(decisionStop({ decision: reopened({ leifsWords: undefined }) }), needs);
  assert.match(decisionStop({ decision: reopened({ leifsWords: '   ' }) }), needs);
  assert.match(decisionStop({ decision: reopened({ leifsWords: true }) }), needs);
});

test('a reopening date is a real YYYY-MM-DD day after the refusal and not after today in Sydney', () => {
  const needs = /^STOP_DECISION: a reopening needs reopenedOn as a date and leifsWords quoting Leif/;
  // Date.parse alone accepts all of these, and each one used to open the lane.
  for (const reopenedOn of ['Leif 1', 'x 2026', '1', '2026-11-8', '8/11/2026', '2026-02-30', '2026-11-08T09:00:00Z', ' 2026-11-08', ['2026-11-08']]) {
    assert.match(decisionStop({ decision: reopened({ reopenedOn }) }, '2026-11-09'), needs, JSON.stringify(reopenedOn));
  }
  assert.match(decisionStop({ decision: reopened({ reopenedOn: '2026-11-31' }) }, '2026-12-05'), needs, '31 November is not a day');
  assert.match(decisionStop({ decision: reopened({ reopenedOn: '2026-10-31' }) }, '2026-11-09'), needs, 'the day of the refusal is not after it');
  assert.match(decisionStop({ decision: reopened({ reopenedOn: '2026-01-01' }) }, '2026-11-09'), needs, 'a date before the refusal');
  assert.match(decisionStop({ decision: reopened({ reopenedOn: '2026-11-10' }) }, '2026-11-09'), needs, 'a date after today');
  assert.match(decisionStop({ decision: reopened({ reopenedOn: '2099-01-01' }) }), needs, 'a far-future date, on the real clock');
  assert.equal(decisionStop({ decision: reopened({ reopenedOn: '2026-11-01' }) }, '2026-11-09'), null, 'the day after the refusal');
  assert.equal(decisionStop({ decision: reopened({ reopenedOn: '2026-11-09' }) }, '2026-11-09'), null, 'today itself');
  assert.equal(REFUSED_ON, '2026-10-31');
});

test('a decision about another lane, or none named, does not open this one', () => {
  assert.match(decisionStop({ decision: reopened({ lane: 'agency-pilot' }) }), /^STOP_DECISION: the decision record is for lane "agency-pilot", not galxe-questing/);
  assert.match(decisionStop({ decision: reopened({ lane: undefined }) }), /^STOP_DECISION: the decision record is for lane undefined/);
});

// The command Leif's standard names as the proof: `npm run desk:status; echo $?` gives 2 while the lane is refused.
const LEDGER = fileURLToPath(new URL('./ledger.mjs', import.meta.url));
const ACCOUNT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'account.json');
const cli = (...args) => spawnSync(process.execPath, [LEDGER, ...args], { encoding: 'utf8' });

test('desk:status reads the committed decision: STOP_DECISION and exit 2 on an empty ledger', () => {
  const empty = join(scratch('ledger-'), 'ledger.jsonl'); // never created: an empty ledger
  const r = cli('status', '--file', empty, '--account', ACCOUNT);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^Kill rule: STOP_DECISION: refused 2026-10-31 \(galxe-desk\/docs\/decision-2026-10-31-questing\.md\)/m);
  assert.match(DECISION_FILE, /galxe-desk[\\/]decision\.json$/);
});

test('desk:status with a missing decision file fails closed: exit 2 and the reason', () => {
  const dir = scratch('ledger-');
  const r = cli('status', '--file', join(dir, 'ledger.jsonl'), '--account', ACCOUNT, '--decision', join(dir, 'gone.json'));
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /^Kill rule: STOP_DECISION: .*gone\.json could not be read/m);
});

test('desk:status on a well-formed reopening goes back to the ledger\'s own rules: CONTINUE and exit 0', () => {
  const dir = scratch('ledger-');
  writeFileSync(join(dir, 'decision.json'), JSON.stringify(reopened()));
  const r = cli('status', '--file', join(dir, 'ledger.jsonl'), '--account', ACCOUNT, '--decision', join(dir, 'decision.json'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^Kill rule: CONTINUE$/m);
});

test('the claim clock is not questing: desk:due on a refused lane still answers on the claims alone', () => {
  const r = cli('due', '--file', join(scratch('ledger-'), 'ledger.jsonl'), '--account', ACCOUNT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No claim is waiting/);
});
