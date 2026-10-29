// Every guard in the Prize Gate is shown to refuse what it should, and the one good candidate is shown to pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate, rank, expectedValue, toMarkdown } from './rank.mjs';

const NOW = Date.parse('2026-07-24T12:00:00Z');

const account = {
  xAgeMonths: 6, xFollowers: 120, blueCheck: false, scoreHumanity: 1, passport: false, holdings: [],
  chains: { 'Gravity L1': true }, dailyMinutesCap: 10, evThresholdUsd: 2, haircutUnlaunched: 0.5,
};

const good = () => ({
  id: 'AIW3', url: 'https://app.galxe.com/quest/ck3c8enjXPDnduV3AiQoie/GCPnQtZ2uL', space: 'AIW3', spaceVerified: true,
  status: 'Active', startTime: '2026-07-21T00:00:00Z', endTime: '2026-07-27T23:59:59Z', cap: 0, participants: 3640,
  reward: { type: 'token', split: 'even', poolUsd: 60000, tokenLaunched: false, claimFeeUsd: 0.08, gasUsd: 0.02, claimChain: 'Gravity L1', claimWindowDays: 15 },
  requirements: { xAgeMonths: 3, xFollowers: 50 }, project: { fundingUsd: 0, tokenStatus: 'confirmed' }, minutes: 8,
});

test('the AIW3-shaped pool passes with the published arithmetic', () => {
  const r = gate(good(), account, NOW);
  assert.equal(r.pass, true, r.reasons.join('; '));
  assert.ok(Math.abs(r.evGross - 60000 / 3641) < 0.01, `gross ${r.evGross}`);
  assert.ok(Math.abs(r.ev - (60000 / 3641) * 0.5 + 0.1) < 0.01, `net ${r.ev}`);
});

const refusals = [
  ['OAT-only', (c) => { c.reward.type = 'oat'; }, /WORTHLESS_REWARD: oat/],
  ['points-only without a published conversion', (c) => { c.reward.type = 'points'; }, /WORTHLESS_REWARD: points/],
  ['GG-only', (c) => { c.reward.type = 'gg'; }, /WORTHLESS_REWARD: gg/],
  ['no reward type at all', (c) => { delete c.reward.type; }, /WORTHLESS_REWARD/],
  ['cap reached', (c) => { c.cap = 3640; }, /NOT_OPEN: cap reached/],
  ['expired by status', (c) => { c.status = 'Expired'; }, /NOT_OPEN: status Expired/],
  ['ended by time', (c) => { c.endTime = '2026-07-23T00:00:00Z'; }, /NOT_OPEN: ended/],
  ['not started', (c) => { c.startTime = '2026-07-25T00:00:00Z'; }, /NOT_OPEN: not started/],
  ['X account age unmet', (c) => { c.requirements.xAgeMonths = 12; }, /INELIGIBLE: X account 12 months/],
  ['followers unmet', (c) => { c.requirements.xFollowers = 500; }, /INELIGIBLE: 500 X followers/],
  ['humanity level unmet', (c) => { c.requirements.scoreHumanity = 2; }, /INELIGIBLE: Humanity L2/],
  ['passport required', (c) => { c.requirements.passport = true; }, /INELIGIBLE: Passport/],
  ['holding required', (c) => { c.requirements.holdings = ['SomeNFT']; }, /INELIGIBLE: must hold SomeNFT/],
  ['claim chain unknown', (c) => { delete c.reward.claimChain; }, /CLAIM_PATH_UNKNOWN: chain/],
  ['no gas on the claim chain', (c) => { c.reward.claimChain = 'Solana'; }, /CLAIM_PATH_UNKNOWN: no gas on Solana/],
  ['claim window unknown', (c) => { delete c.reward.claimWindowDays; }, /CLAIM_PATH_UNKNOWN: window/],
  ['claim fee unknown', (c) => { delete c.reward.claimFeeUsd; }, /CLAIM_PATH_UNKNOWN: fee/],
  ['lookalike domain', (c) => { c.url = 'https://galxe-claim.app/quest/x'; }, /LOOKALIKE_URL: galxe-claim.app/],
  ['invalid url', (c) => { c.url = 'not a url'; }, /LOOKALIKE_URL: invalid url/],
  ['unverified project', (c) => { c.spaceVerified = false; c.project = { fundingUsd: 1000, tokenStatus: 'none' }; }, /UNVERIFIED_PROJECT/],
  ['raffle too crowded', (c) => { c.reward = { ...c.reward, split: 'raffle', prizeUsd: 50, winners: 10, tokenLaunched: true }; c.participants = 6700; }, /LOW_EV: \$-?0\.0\d < \$2\.00/],
  ['cannot value', (c) => { c.reward.split = 'mystery'; }, /LOW_EV: cannot value/],
  ['too slow for the day', (c) => { c.minutes = 25; }, /TOO_SLOW: 25 min > 10 min cap/],
  ['blue check required', (c) => { c.requirements.blueCheck = true; }, /INELIGIBLE: X blue check needed/],
  ['the marketing site is not a quest page', (c) => { c.url = 'https://www.galxe.com/quest/x'; }, /LOOKALIKE_URL: www\.galxe\.com/],
  // Unknown counts as unmet: the gate fails closed (found by the Verifier on 29 Oct 2026; it used to pass all of these).
  ['requirements not recorded at all', (c) => { delete c.requirements; }, /INELIGIBLE: requirements not recorded/],
  ['a requirement recorded as unknown', (c) => { c.requirements.xAgeMonths = 'unknown'; }, /INELIGIBLE: xAgeMonths unknown/],
  ['a requirement recorded as null', (c) => { c.requirements.scoreHumanity = null; }, /INELIGIBLE: scoreHumanity unknown/],
  ['passport recorded as a string', (c) => { c.requirements.passport = 'maybe'; }, /INELIGIBLE: passport unknown/],
  ['holdings recorded as text', (c) => { c.requirements.holdings = 'some NFT'; }, /INELIGIBLE: holdings unknown/],
  ['participants unknown', (c) => { delete c.participants; }, /LOW_EV: participants unknown/],
  ['minutes unknown', (c) => { delete c.minutes; }, /TOO_SLOW: minutes unknown/],
];

for (const [name, mutate, re] of refusals) {
  test(`refuses: ${name}`, () => {
    const c = good();
    mutate(c);
    const r = gate(c, account, NOW);
    assert.equal(r.pass, false, `should refuse ${name}`);
    assert.ok(r.reasons.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(r.reasons)}`);
  });
}

test('points with a published, dated conversion are allowed through the reward guard', () => {
  const c = good();
  c.reward.type = 'points';
  c.reward.pointsConversion = { ratio: 0.01, date: '2026-10-01', source: 'https://app.galxe.com/space/x/announcement' };
  const r = gate(c, account, NOW);
  assert.ok(!r.reasons.some((x) => x.startsWith('WORTHLESS_REWARD')), r.reasons.join('; '));
});

test('expectedValue applies the haircut only to unlaunched or vesting tokens', () => {
  const launched = { participants: 99, reward: { split: 'even', poolUsd: 1000, tokenLaunched: true, claimFeeUsd: 0 } };
  const vesting = { participants: 99, reward: { split: 'even', poolUsd: 1000, tokenLaunched: true, vesting: true, claimFeeUsd: 0 } };
  assert.equal(expectedValue(launched).net, 10);
  assert.equal(expectedValue(vesting).net, 5);
  assert.equal(expectedValue({ participants: 1, reward: { split: 'fcfs', prizeUsd: 5, slotsLeft: 0 } }).net, 0);
});

test('rank skips metadata objects such as the scout\'s _sourcesChecked', () => {
  const r = rank([good(), { _sourcesChecked: [{ feed: 'DefiLlama', date: '2026-10-29' }] }], account, NOW);
  assert.equal(r.skipped, 1);
  assert.equal(r.results.length, 1);
  assert.ok(!r.refused.some((x) => x.id === undefined), 'no bogus refusal for the metadata object');
});

test('rank sorts the shortlist by expected value and renders both lists', () => {
  const a = good();
  const b = good(); b.id = 'B'; b.reward.poolUsd = 120000;
  const bad = good(); bad.id = 'BAD'; bad.reward.type = 'oat';
  const r = rank([a, b, bad], account, NOW);
  assert.deepEqual(r.passed.map((x) => x.id), ['B', 'AIW3']);
  assert.deepEqual(r.refused.map((x) => x.id), ['BAD']);
  const md = toMarkdown(r, new Date(NOW));
  assert.match(md, /## Do[\s\S]*B[\s\S]*AIW3[\s\S]*## Refused/);
  assert.match(md, /BAD: WORTHLESS_REWARD: oat/);
});
