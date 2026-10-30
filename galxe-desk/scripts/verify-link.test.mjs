// The scam-link checker, shown to refuse every shape of fake claim page and to pass only the real quest app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyLink, formatVerdict, KNOWN_SCAM_HOSTS, OFFICIAL_NON_QUEST_HOSTS } from './verify-link.mjs';

test('the real quest app is the only GENUINE answer', () => {
  const v = verifyLink('https://app.galxe.com/quest/ck3c8enjXPDnduV3AiQoie/GCPnQtZ2uL');
  assert.equal(v.verdict, 'GENUINE');
  assert.equal(v.safe, true);
  assert.equal(v.host, 'app.galxe.com');
  // http is allowed to parse but the host is what decides; https is what a real link uses.
  assert.equal(verifyLink('https://app.galxe.com/').verdict, 'GENUINE');
});

const refusals = [
  ['a known Galxe drainer', 'https://galxe-claim.app/claim', 'KNOWN_SCAM'],
  ['another known drainer', 'https://airdrop-galxe.one/x', 'KNOWN_SCAM'],
  ['the fake-Galxe site from the research', 'https://dapps-bridge.net/galxe', 'KNOWN_SCAM'],
  ['a pump.fun claim drainer', 'https://pumpfun-claim.pages.dev/', 'KNOWN_SCAM'],
  ['a name-borrowing lookalike', 'https://galxe-rewards.io/claim', 'LOOKALIKE'],
  ['a homoglyph spelling', 'https://ga1xe.com/quest/x', 'LOOKALIKE'],
  ['a credential decoy before the @', 'https://app.galxe.com@evil.example/claim', 'LOOKALIKE'],
  ['a punycode homoglyph host', 'https://xn--galxe-0qa.com/claim', 'LOOKALIKE'],
  ['a javascript: scheme', 'javascript:alert(1)', 'NON_HTTP'],
  ['an ftp: scheme on a genuine-looking host', 'ftp://app.galxe.com/quest/x', 'NON_HTTP'],
  ['a data: URL', 'data:text/html,<h1>claim</h1>', 'NON_HTTP'],
  ['not a URL at all', 'claim your airdrop now', 'INVALID'],
  ['the marketing site', 'https://www.galxe.com/quest/x', 'OFFICIAL_NOT_QUEST'],
  ['the docs site', 'https://docs.galxe.com/about/legal/terms-of-service', 'OFFICIAL_NOT_QUEST'],
  ['an unknown galxe.com subdomain', 'https://rewards.galxe.com/claim', 'OFFICIAL_NOT_QUEST'],
  ['a wholly unrelated host', 'https://example.com/airdrop', 'UNRELATED'],
];

for (const [name, url, expected] of refusals) {
  test(`refuses: ${name}`, () => {
    const v = verifyLink(url);
    assert.equal(v.verdict, expected, `${url} -> ${v.verdict} (${v.reason})`);
    assert.equal(v.safe, false, 'nothing but the quest app is ever safe');
    assert.ok(v.reason.length > 0, 'a refusal always says why');
  });
}

test('an @-decoy is reported as going to the real destination, not the decoy', () => {
  const v = verifyLink('https://app.galxe.com@evil.example/claim');
  assert.equal(v.host, 'evil.example');
  assert.match(v.reason, /decoy/);
});

// A refusal is only useful if it says the right thing: these pin the reason, not just the verdict, because
// the reason is what tells Leif which trick he is looking at.
test('each refusal names the actual trick', () => {
  assert.match(verifyLink('https://xn--galxe-0qa.com/claim').reason, /punycode/, 'a homoglyph host is named as punycode, not just "borrows the name"');
  assert.match(verifyLink('https://docs.galxe.com/x').reason, /official Galxe page but not the quest app/, 'a known official page is named as official');
  assert.match(verifyLink('https://rewards.galxe.com/x').reason, /galxe\.com subdomain but not the quest app/, 'an unknown subdomain is named as a subdomain');
  assert.match(verifyLink('https://galxe-rewards.io/x').reason, /borrows the Galxe name/);
  assert.match(verifyLink('https://example.com/x').reason, /not a Galxe domain/);
});

test('the checker never treats an official non-quest page as claimable', () => {
  for (const host of OFFICIAL_NON_QUEST_HOSTS) {
    assert.equal(verifyLink(`https://${host}/x`).safe, false, `${host} must not be claimable`);
  }
  assert.ok(KNOWN_SCAM_HOSTS.size > 0, 'the known-drainer list is not empty');
});

test('formatVerdict marks the safe one OK and everything else STOP', () => {
  assert.match(formatVerdict('https://app.galxe.com/q', verifyLink('https://app.galxe.com/q')), /^OK\s+GENUINE/);
  assert.match(formatVerdict('https://galxe-claim.app', verifyLink('https://galxe-claim.app')), /^STOP KNOWN_SCAM/);
});

test('an empty or missing input is INVALID, never safe', () => {
  for (const bad of ['', '   ', null, undefined]) {
    const v = verifyLink(bad);
    assert.equal(v.verdict, 'INVALID');
    assert.equal(v.safe, false);
  }
});
