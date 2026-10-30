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
  // 30 Oct 2026, the adversarial review: a cost or window written as the string "unknown" used to make net EV
  // NaN, and `NaN < threshold` is false, so the quest passed with no reasons. Non-numeric now fails closed.
  ['claim fee written as "unknown"', (c) => { c.reward.claimFeeUsd = 'unknown'; }, /CLAIM_PATH_UNKNOWN: fee/],
  ['claim window written as "unknown"', (c) => { c.reward.claimWindowDays = 'unknown'; }, /CLAIM_PATH_UNKNOWN: window/],
  ['claim gas written as "unknown"', (c) => { c.reward.gasUsd = 'unknown'; }, /CLAIM_PATH_UNKNOWN: claim gas/],
  ['task gas written as "unknown"', (c) => { c.taskGasUsd = 'unknown'; }, /TASK_COST_UNKNOWN: task gas/],
  // A requirement the gate does not model cannot be checked, so it is unmet, not ignored.
  ['a requirement the gate does not model', (c) => { c.requirements.galxePlus = 3; }, /INELIGIBLE: requirement galxePlus not understood/],
  // A non-http scheme on a matching hostname used to pass the hostname check; it is refused now.
  ['a non-http scheme', (c) => { c.url = 'ftp://app.galxe.com/quest/x'; }, /LOOKALIKE_URL: ftp not http/],
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

test('the haircut applies unless a token is explicitly launched: unknown, absent and the string "false" all keep it', () => {
  const base = (tl) => ({ participants: 99, reward: { split: 'even', poolUsd: 1000, tokenLaunched: tl, claimFeeUsd: 0 } });
  assert.equal(expectedValue(base(true)).net, 10, 'explicitly launched: full value');
  assert.equal(expectedValue(base(false)).net, 5, 'explicitly not launched: haircut');
  assert.equal(expectedValue(base('unknown')).net, 5, 'unknown launch: haircut (passed at full value before the fix)');
  assert.equal(expectedValue(base(undefined)).net, 5, 'absent launch: haircut (passed at full value before the fix)');
  assert.equal(expectedValue(base('false')).net, 5, 'the string "false": haircut (passed at full value before the fix)');
});

test('expectedValue returns null, not a NaN that reads as cheap, when a cost is non-numeric', () => {
  // cashVerdict also refuses this, but expectedValue is called directly too and must not hand back NaN.
  assert.equal(expectedValue({ participants: 1, reward: { split: 'even', poolUsd: 100, tokenLaunched: true, claimFeeUsd: 'unknown' } }), null);
});

test('a raffle values one entry at most at one prize, even when winners outnumber entrants', () => {
  // 10 winners and one entrant (us): n = 2, winners/n = 5, but one entry can win only one prize.
  const c = { participants: 1, reward: { split: 'raffle', prizeUsd: 20, winners: 10, tokenLaunched: true, claimFeeUsd: 0 } };
  assert.equal(expectedValue(c).net, 20); // was 20 x 10 / 2 = 100 before the fix
});

test('a cost or window written as "unknown" is refused, never valued as NaN that slips past the threshold', () => {
  const c = good(); c.reward.claimFeeUsd = 'unknown';
  const r = gate(c, account, NOW);
  assert.equal(r.pass, false, r.reasons.join('; '));
  assert.ok(r.reasons.includes('CLAIM_PATH_UNKNOWN: fee'), r.reasons.join('; '));
});

test('an on-chain wording the word list once missed ("supply") still forces capital and gas to be recorded', () => {
  const c = official();
  c.credentialGroups[0].conditions.push({ expression: 'Supply 10 USDC to the lending pool' });
  const r = gate(c, acct2, NOW2);
  assert.ok(r.reasons.includes('TASK_COST_UNKNOWN: on-chain task without capital and gas recorded'), r.reasons.join('; '));
});

test('the watchlist view shows the top N by value and says how many more passed', () => {
  const mk = (id, pool) => { const c = good(); c.id = id; c.reward.poolUsd = pool; return c; };
  const r = rank([mk('A', 60000), mk('B', 120000), mk('C', 90000)], account, NOW);
  assert.deepEqual(r.passed.map((x) => x.id), ['B', 'C', 'A'], 'sorted by value');
  const top2 = toMarkdown(r, new Date(NOW), { top: 2 });
  assert.match(top2, /\*\*AIW3 \/ B\*\*|\/ B\*\*/);
  assert.match(top2, /and 1 more that pass, below the top 2 by value/);
  assert.ok(!/\/ A\*\*/.test(top2), 'the third is not listed in a top-2 view');
  // No --top means every pass is listed, as before.
  assert.ok(!/more that pass/.test(toMarkdown(r, new Date(NOW))));
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

// ---------- 30 Oct 2026: Galxe's official quest shape, task costs, speed games, jurisdiction, published conversions ----------
import { mapRewardType, toMs, tasksOf, rewardOptions } from './rank.mjs';

const NOW2 = Date.parse('2026-11-02T00:00:00Z');
const secs = (iso) => Math.floor(Date.parse(iso) / 1000);

// The official API shape (docs.galxe.com/galxe-integration/api-reference/quest): unix-second times, participantsCount,
// a space object and credential groups whose rewards carry rewardType and rewardCount.
const official = () => ({
  id: 'GCofficial1', name: 'Season 2 week 1', type: 'Airdrop', status: 'Active',
  startTime: secs('2026-10-28T00:00:00Z'), endTime: secs('2026-11-10T00:00:00Z'), cap: 0, participantsCount: 1999,
  gasType: 'Gasless', chain: 'GRAVITY', space: { id: '123', name: 'Funded L2', verified: true },
  url: 'https://app.galxe.com/quest/fundedl2/GCofficial1', requirements: { xAgeMonths: 3 },
  project: { fundingUsd: 25000000, tokenStatus: 'live' }, minutes: 6,
  credentialGroups: [{
    conditionRelation: 'ALL',
    conditions: [{ expression: 'Follow @FundedL2 on X' }, { expression: 'Visit the docs page' }],
    rewards: [
      { rewardType: 'OAT', rewardCount: 1 },
      { rewardType: 'TOKEN', rewardCount: 20, value: { split: 'raffle', prizeUsd: 500, winners: 20, tokenLaunched: true, claimFeeUsd: 0.08, gasUsd: 0.02, claimChain: 'Gravity L1', claimWindowDays: 15 } },
    ],
  }],
});
const acct2 = { ...account, walletCapUsd: 25 };

test('official shape: unix seconds, participantsCount and a space object are read; the token raffle wins over the OAT', () => {
  const r = gate(official(), acct2, NOW2);
  assert.equal(r.pass, true, r.reasons.join('; '));
  assert.equal(r.option, 'token');
  assert.equal(r.space, 'Funded L2');
  assert.ok(Math.abs(r.ev - (500 * 20 / 2000 - 0.1)) < 1e-9, `ev ${r.ev}`);
  assert.equal(r.claimBy, '2026-11-25');
  assert.equal(r.endsAt, '2026-11-10');
  assert.equal(r.capitalUsd, 0);
  assert.equal(r.tasks[0].items[0].onX, true);
  assert.equal(r.tasks[0].items[1].onX, false);
});

test('a multi-reward quest that fails is refused with every option labelled', () => {
  const c = official(); c.participantsCount = 99999;
  const r = gate(c, acct2, NOW2);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.includes('[oat] WORTHLESS_REWARD: oat'), r.reasons.join('; '));
  assert.ok(r.reasons.some((x) => /^\[token\] LOW_EV/.test(x)), r.reasons.join('; '));
});

test('refuses: the official eligibility check says this address cannot claim', () => {
  const c = official(); c.credentialGroups[0].rewards[1].eligible = false;
  const r = gate(c, acct2, NOW2);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.some((x) => /\[token\] INELIGIBLE: the official eligibility check/.test(x)), r.reasons.join('; '));
});

test('refuses: an on-chain task with its capital and gas unrecorded', () => {
  const c = official(); c.credentialGroups[0].conditions.push({ expression: 'Bridge at least $10 to Funded L2' });
  const r = gate(c, acct2, NOW2);
  assert.ok(r.reasons.includes('TASK_COST_UNKNOWN: on-chain task without capital and gas recorded'), r.reasons.join('; '));
});

test('refuses: capital above the wallet cap; within the cap, task gas counts against value', () => {
  const c = official(); c.credentialGroups[0].conditions.push({ expression: 'Bridge at least $10 to Funded L2' });
  c.capitalUsd = 100; c.taskGasUsd = 0.5;
  assert.ok(gate(c, acct2, NOW2).reasons.includes('CAPITAL_ABOVE_CAP: $100 > $25 wallet cap'));
  c.capitalUsd = 10;
  const r = gate(c, acct2, NOW2);
  assert.equal(r.pass, true, r.reasons.join('; '));
  assert.ok(Math.abs(r.ev - (5 - 0.1 - 0.5)) < 1e-9, `ev ${r.ev}`);
  assert.equal(r.tasks[0].items[2].onChain, true);
});

const fcfs = (slots, slotsLeft) => { const c = official(); c.credentialGroups[0].rewards = [{ rewardType: 'TOKEN', value: { split: 'fcfs', prizeUsd: 5, slots, slotsLeft, tokenLaunched: true, claimFeeUsd: 0.08, gasUsd: 0, claimChain: 'Gravity L1', claimWindowDays: 15 } }]; return c; };
test('refuses first-come-first-served when slots are unknown or under half are left; passes when plenty are left', () => {
  assert.ok(gate(fcfs(undefined, undefined), acct2, NOW2).reasons.includes('SPEED_GAME: first-come-first-served with unknown slots'));
  assert.ok(gate(fcfs(100, 10), acct2, NOW2).reasons.includes('SPEED_GAME: 10 of 100 slots left'));
  const ok = gate(fcfs(100, 80), acct2, NOW2);
  assert.equal(ok.pass, true, ok.reasons.join('; '));
  assert.ok(Math.abs(ok.ev - 4.92) < 1e-9);
});

test('toMs reads unix seconds, milliseconds and ISO; mapRewardType maps the official names', () => {
  assert.equal(toMs(1730000000), 1730000000000);
  assert.equal(toMs('1730000000'), 1730000000000);
  assert.equal(toMs(1730000000000), 1730000000000);
  assert.equal(toMs('2026-11-02T00:00:00Z'), NOW2);
  assert.ok(Number.isNaN(toMs(undefined)));
  assert.deepEqual(['OAT', 'TOKEN', 'Airdrop', 'LOYALTYPOINTS', 'MysteryBox', 'CUSTOM', 'weird'].map(mapRewardType), ['oat', 'token', 'token', 'points', 'mysterybox', 'whitelist', 'weird']);
  assert.equal(rewardOptions({}).length, 0);
});

test('rank sorts real prizes by value and counts refusals by reason', () => {
  const oat = official(); oat.id = 'OATONLY'; oat.credentialGroups[0].rewards = [{ rewardType: 'OAT' }];
  const r = rank([official(), oat], acct2, NOW2);
  assert.deepEqual(r.passed.map((x) => x.id), ['GCofficial1']);
  assert.deepEqual(r.refused.map((x) => x.id), ['OATONLY']);
  assert.equal(r.byReason.WORTHLESS_REWARD, 1);
  const md = toMarkdown(r, new Date(NOW2));
  assert.match(md, /## Do: real prizes, claimable[\s\S]*GCofficial1[\s\S]*## Refused/);
  assert.match(md, /By reason: WORTHLESS_REWARD 1\./);
});

test('the refusal summary counts quests, not reason lines: three claim-path gaps in one quest count once', () => {
  const c = official(); c.id = 'NOPATH';
  c.credentialGroups[0].rewards = [{ rewardType: 'TOKEN', value: { split: 'even', poolUsd: 100000, tokenLaunched: true } }];
  const r = rank([c], acct2, NOW2);
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].reasons.filter((x) => x.startsWith('CLAIM_PATH_UNKNOWN')).length, 3);
  assert.equal(r.byReason.CLAIM_PATH_UNKNOWN, 1);
});

const jurisdiction = [
  ['our country excluded', (c, a) => { c.requirements.excludedCountries = ['US', 'au']; a.country = 'AU'; }, /INELIGIBLE: AU is excluded/],
  ['exclusions present but our country unrecorded', (c, a) => { c.requirements.excludedCountries = ['US']; delete a.country; }, /our country is not recorded/],
  ['exclusions recorded as text', (c, a) => { c.requirements.excludedCountries = 'US and others'; a.country = 'AU'; }, /excludedCountries unknown/],
  ['project KYC needed', (c, a) => { c.requirements.kyc = true; a.kycOk = false; }, /project KYC needed/],
  ['KYC recorded as unknown', (c, a) => { c.requirements.kyc = 'maybe'; }, /kyc unknown/],
];
for (const [name, mutate, re] of jurisdiction) {
  test(`refuses: ${name}`, () => {
    const c = official(); const a = { ...acct2 }; mutate(c, a);
    const r = gate(c, a, NOW2);
    assert.equal(r.pass, false);
    assert.ok(r.reasons.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(r.reasons)}`);
  });
}
test('a country not on the exclusion list passes', () => {
  const c = official(); c.requirements.excludedCountries = ['US', 'CN'];
  assert.equal(gate(c, { ...acct2, country: 'AU' }, NOW2).pass, true);
});

test('points with a published, dated conversion are valued as points x tokens per point x price, and can pass', () => {
  const c = official(); c.id = 'CONV';
  c.credentialGroups[0].rewards = [{ rewardType: 'LOYALTYPOINTS', rewardCount: 500, value: {
    pointsConversion: { ratio: 0.02, tokenPriceUsd: 0.5, date: '2026-10-20', source: 'https://app.galxe.com/space/x/announcement' },
    tokenLaunched: true, claimFeeUsd: 0.08, gasUsd: 0.02, claimChain: 'Gravity L1', claimWindowDays: 15 } }];
  const r = gate(c, acct2, NOW2);
  assert.equal(r.pass, true, r.reasons.join('; '));
  assert.ok(Math.abs(r.ev - (500 * 0.02 * 0.5 - 0.1)) < 1e-9, `ev ${r.ev}`);
  c.credentialGroups[0].rewards[0].value.pointsConversion.tokenPriceUsd = undefined;
  assert.ok(gate(c, acct2, NOW2).reasons.includes('LOW_EV: cannot value (split, pool or prize missing)'), 'an unpriced conversion cannot be valued');
});
