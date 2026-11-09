// Roster truth on made-up creators: one viral video cannot lift the typical number, and rates never leave the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTable, toCSV } from './lib.mjs';
import { buildRoster, publicView } from './roster.mjs';

const tabs = () => ({
  creators: readTable(toCSV([['Creator', 'Niche keywords', 'Avg views', 'Pitch line', 'Active'],
    ['Jay', 'diy', '300k', '', 'TRUE'], ['Pip', 'garden', '80k', '', 'TRUE'], ['Newbie', 'home', '', '', 'FALSE']])),
  myInfluencers: readTable(toCSV([['', '', '', '', 'Rate', '', '', 'Avg views', 'Engagement Rate', 'Country'],
    ['Jay for DIY', '', '', '', '10k', '', '', '300k avg', '', ''], ['Pip', '', '', '', '777', '', '', '80k avg', '', 'UK']])),
  pricing: readTable(toCSV([['Influencer', 'Average Views', 'CPM'],
    ['JaysChannel', '190k + 15000 + 1900 + 2200 + 8800 + 2800 + 2900 + 7300 + 1400 + 8000 = 240,300 Divided by 10 = 24K', '']])),
});

test('a measured creator is quoted by the median, with a warning when the sheet claims far more', () => {
  const [jay] = buildRoster(tabs());
  assert.equal(jay.numberSource, 'measured');
  assert.equal(jay.measured.typical, 5100);
  assert.deepEqual(jay.numbers, ['5k', '24k', '190k']);
  assert.match(jay.phrase, /about 5k views on a typical video, 190k on the best of the last 10/);
  assert.match(jay.warning, /300k.*5k typical/);
});

test('an unmeasured creator keeps the sheet figure, labelled; a creator with none gets no number', () => {
  const [, pip, newbie] = buildRoster(tabs());
  assert.equal(pip.numberSource, 'roster sheet, not re-measured');
  assert.deepEqual(pip.numbers, ['80k']);
  assert.equal(pip.country, 'UK');
  assert.equal(pip.measuredAt, null, 'a sheet figure has no measurement date, so it is never fresh');
  assert.deepEqual(newbie.numbers, []);
  assert.equal(newbie.phrase, 'Newbie');
  assert.equal(newbie.active, false);
});

test('overrides add audience and sponsors; the public view drops every rate', () => {
  const roster = buildRoster(tabs(), { Jay: { audience: { US: 32.4 }, pastSponsors: ['Brand A'] } });
  assert.equal(roster[0].audience.US, 32.4);
  assert.equal(roster[0].private.rate, '10k');
  const pub = JSON.stringify(publicView(roster));
  assert.ok(!pub.includes('"rate"') && !pub.includes('777'), 'no rate leaves the private file');
});

test('a dated measurement and a dated yes come from the private overrides, and win over the sheet', () => {
  const roster = buildRoster(tabs(), { Pip: { yesAt: '2026-11-12', describe: 'a gardening channel', measured: { n: 12, typical: 61000, best: 150000, at: '2026-11-10', method: 'feed' } } });
  const pip = roster[1];
  assert.equal(pip.yesAt, '2026-11-12');
  assert.equal(pip.describe, 'a gardening channel');
  assert.equal(pip.numberSource, 'measured');
  assert.equal(pip.measuredAt, '2026-11-10');
  assert.deepEqual(pip.numbers, ['61k', '150k']);
  assert.match(pip.phrase, /about 61k views on a typical video, 150k on the best of the last 12/);
  assert.equal(roster[0].measuredAt, null, 'the Pricing tab lists videos but no date, so its median is not fresh');
});

test('a screenshot that gives only the typical views makes an honest phrase, and an override without one is ignored', () => {
  const [, pip] = buildRoster(tabs(), { Pip: { measured: { typical: 30000, at: '2026-11-08' } } });
  assert.equal(pip.phrase, 'Pip (about 30k views on a typical video)');
  assert.ok(!/undefined|NaN/.test(pip.phrase));
  const [, ignored] = buildRoster(tabs(), { Pip: { measured: { best: 90000, at: '2026-11-08' } } });
  assert.equal(ignored.measuredAt, null);
  assert.equal(ignored.numberSource, 'roster sheet, not re-measured');
});
