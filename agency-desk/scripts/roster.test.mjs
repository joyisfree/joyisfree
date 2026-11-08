// Roster truth on made-up creators: one viral video cannot lift the typical number, and rates never leave the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTable, toCSV } from './lib.mjs';
import { buildRoster, publicView } from './roster.mjs';

const tabs = () => ({
  creators: readTable(toCSV([['Creator', 'Niche keywords', 'Avg views', 'Pitch line', 'Active'],
    ['Jay', 'diy', '300k', '', 'TRUE'], ['Gala', 'garden', '100k', '', 'TRUE'], ['Newbie', 'home', '', '', 'FALSE']])),
  myInfluencers: readTable(toCSV([['', '', '', '', 'Rate', '', '', 'Avg views', 'Engagement Rate', 'Country'],
    ['Jay for DIY', '', '', '', '10k', '', '', '300k avg', '', ''], ['Gala', '', '', '', '1500', '', '', '100k avg', '', 'UK']])),
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
  const [, gala, newbie] = buildRoster(tabs());
  assert.equal(gala.numberSource, 'roster sheet, not re-measured');
  assert.deepEqual(gala.numbers, ['100k']);
  assert.equal(gala.country, 'UK');
  assert.deepEqual(newbie.numbers, []);
  assert.equal(newbie.phrase, 'Newbie');
  assert.equal(newbie.active, false);
});

test('overrides add audience and sponsors; the public view drops every rate', () => {
  const roster = buildRoster(tabs(), { Jay: { audience: { US: 32.4 }, pastSponsors: ['Brand A'] } });
  assert.equal(roster[0].audience.US, 32.4);
  assert.equal(roster[0].private.rate, '10k');
  const pub = JSON.stringify(publicView(roster));
  assert.ok(!pub.includes('"rate"') && !pub.includes('1500'), 'no rate leaves the private file');
});
