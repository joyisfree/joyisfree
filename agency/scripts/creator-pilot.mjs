#!/usr/bin/env node
// The creator-results pilot: who sent a real order, what it cost, whether the programme has earned its next
// month, and whether a payout may be written. One JSON line per event, appended, never edited.
//
//   node agency/scripts/creator-pilot.mjs check
//   node agency/scripts/creator-pilot.mjs add-creator --id ana --code JOYA --handle @ana --followers 4200 --self-emails ana@example.com
//   node agency/scripts/creator-pilot.mjs post --creator ana --url https://example.com/p/1 --clicks 40
//   node agency/scripts/creator-pilot.mjs order --order-id 1001 --code JOYA --value 84.50 --buyer-email b@example.com --source store
//   node agency/scripts/creator-pilot.mjs import-orders --from export.json
//   node agency/scripts/creator-pilot.mjs signup --signup-id s1 --code JOYA --account-email c@example.com --completed true
//   node agency/scripts/creator-pilot.mjs refund --order-id 1001 --amount 84.50
//   node agency/scripts/creator-pilot.mjs pay --creator ana --amount 12.68 --ref BANK-0042
//   node agency/scripts/creator-pilot.mjs flag --creator ana --note "same buyer on six codes"
//   node agency/scripts/creator-pilot.mjs status        # exit 2 unless the verdict is CONTINUE
//   node agency/scripts/creator-pilot.mjs weekly
//
// Every command takes --file (default agency/pilot/ledger.jsonl), --pilot (default agency/pilot/pilot.json),
// --ts ISO (when the event happened) and --now ISO (the moment the guards treat as now; for back-filling and tests).
//
// Why this exists: paying creators for results is accounting, not statistics, so it works at any list size. But a
// results programme run loosely pays for things that are not results: reach, the creator's own orders, the same
// order twice, an order later refunded, a sale the store never saw. Each of those is refused here with a named
// reason, and anything that cannot be verified is unpaid. The rules are fixed in pilot.json before the first event
// (pre-registration, as in ab-test.mjs) and pinned: the ledger's first line is {type:"rules", ts, pilotSha256}, the
// sha256 of the canonical pilot.json, written with the first event, and every read and write refuses
// (NOT_PRE_REGISTERED) once pilot.json no longer matches it, so a cap, rate, window or band edited after the data
// cannot re-price what is already recorded. Money is held as whole cents so float drift cannot move the cap, the cap
// is checked before any payout is written, and every figure is recomputed from the whole ledger on every run.
//
// The defaults chosen, each the stricter reading (change them here, deliberately):
//   - day 30 counts from the programme start, not from each creator's own start;
//   - "beats the paid-social band" means below its cheap end ($30), not inside it;
//   - an order and a sign-up from the same person both pay;
//   - a creator stopped for cost is still owed what they earned before the stop;
//   - earnings under an open fraud flag are held: no payout to a flagged creator, none at all under a programme flag.
//
// Privacy: buyer, account and self identifiers are stored only as sha256 hashes (node:crypto). A raw "@" in any of
// them is refused. An email is hashed in its one spelling (canonicalEmail), so ana+shop@gmail.com and a.n.a@gmail.com
// are the inbox ana@gmail.com, not two new people. A hash of an email is pseudonymous, not anonymous, so
// agency/pilot/ stays out of git.
//
// Two rules a write keeps, because the second round of review broke the pilot without them:
//   - one spelling per id: order, sign-up, payment-reference and creator ids pass through normId once, where a line
//     is written, and a stored id in any other spelling is refused, so "1001 " cannot be paid as a second order;
//   - a paid result is final: a line (a late store export, a back-dated flag) that would cut a creator's payable
//     below what they have already been paid is refused. Only a refund may take paid money back, as a clawback.
// And the day-30 decision is a one-way latch: it is taken once, from what the ledger held for days 1 to 30. A refund
// dated after day 30 nets its own order and never lifts or imposes a stop; one dated on or before day 30 but written
// after the decision is refused if it would move it. So a refund never pays a stopped creator, and never claws back
// a creator whose own orders were not refunded.
// And every write ends by re-validating the whole ledger with the new line in it, so a write can never leave behind
// a ledger that status then refuses to read.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EVENT_TYPES = new Set(['rules', 'creator', 'post', 'order', 'signup', 'refund', 'payout', 'flag']);

/** Every reason a result goes unpaid, worded so the creator can be told why. */
export const REASONS = Object.freeze({
  DUPLICATE_ORDER_ID: 'this order id was already counted once; the first line recorded is the one that counts',
  DUPLICATE_SIGNUP_ID: 'this sign-up id was already counted once; the first line recorded is the one that counts',
  DUPLICATE_ACCOUNT: 'this account was already seen under a code, so it is not a new sign-up',
  UNSOURCED: "it did not come from the store's own export (orders) or the app (sign-ups)",
  UNKNOWN_CODE: 'the code belongs to no creator in the pilot',
  BEFORE_CREATOR: 'it happened before the creator joined the pilot',
  OUTSIDE_WINDOW: 'it fell outside the pilot window (days 1 to 60)',
  CREATOR_STOPPED: 'the creator was stopped (the day-30 rule or a flag) before it happened',
  NO_BUYER: 'the order carries no buyer, so self-use cannot be ruled out',
  NO_ACCOUNT: 'the sign-up carries no account, so a repeat cannot be ruled out',
  SELF_USE: "the buyer or account is the creator's own",
  NOT_COMPLETED: 'the sign-up was not completed',
  REFUNDED: 'it was refunded in full',
  CAPPED: "verified, but the pilot's cap was already used up",
});

/** The template for pilot.json. decidedOn, startDate and baselineAovUsd have no safe default and are refused until set. */
export const PILOT_DEFAULTS = Object.freeze({
  name: 'creator-results pilot',
  decidedOn: null,
  startDate: null,
  capUsd: 600,
  days: 60,
  maxCreators: 12,
  commissionRate: 0.15,
  signupUsd: 5,
  day30MaxShareOfAov: 0.3,
  baselineAovUsd: 0,
  paidSocialBandUsd: Object.freeze([30, 100]),
});

const DAY = 86_400_000;
const DAY30 = 30;
const REACH_FIELDS = ['likes', 'reposts', 'follows', 'reach', 'impressions', 'views'];
const HASH = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------- strict parsing: unknown is never zero

/**
 * Money to whole cents, exactly. NaN for null, '', booleans, the string 'true' (what args() makes of a bare flag),
 * anything that is not a number, and anything with more than 2 decimals. A string is read digit by digit.
 */
export function toCents(v) {
  if (typeof v === 'string') {
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
    if (!m) return NaN;
    const c = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
    if (!Number.isSafeInteger(c)) return NaN;
    return m[1] && c ? -c : c;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const c = Math.round(v * 100);
    if (!Number.isSafeInteger(c) || Math.abs(v * 100 - c) > 1e-6) return NaN;
    return c === 0 ? 0 : c;
  }
  return NaN;
}

/** A plain number: no '', no booleans, no null. */
function num(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
  if (typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim())) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** A rate in whole basis points (0.15 -> 1500), or NaN. Basis points keep the commission arithmetic integral. */
function basisPoints(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return NaN;
  const bp = Math.round(n * 10_000);
  return Math.abs(n * 10_000 - bp) < 1e-6 ? bp : NaN;
}

/** A timestamp is YYYY-MM-DD or a full ISO time with an explicit Z or offset. Round-trip checked, so 2026-02-30 is refused. */
function strictTime(v) {
  if (typeof v !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(v);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m.map((x) => (x === undefined ? undefined : x));
  const dayMs = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const back = new Date(dayMs);
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return NaN;
  if (h !== undefined && (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59)) return NaN;
  return Date.parse(v);
}

/** What a bare flag (args() makes it 'true') or a lost value turns into once it is made a string. Never an id. */
const NOT_IDS = new Set(['TRUE', 'UNDEFINED', 'NULL', 'NAN']);

/** An identifier is a non-empty string, and never 'true', 'undefined', 'null' or 'NaN' in any case. */
const isId = (v) => typeof v === 'string' && v.trim() !== '' && !NOT_IDS.has(v.trim().toUpperCase());

export const normCode = (c) => (typeof c === 'string' ? c.trim().toUpperCase() : c);

/**
 * The one spelling of an order, sign-up, payment-reference or creator id: trimmed, one leading '#' dropped (a store
 * shows order 1001 as "#1001"), upper-cased. It is applied once, where a line is written (checkAppend, so every CLI
 * command and import-orders), and validateEvent refuses a stored id in any other spelling, so "1001", " 1001 " and
 * "#1001" are one order: counted once, refunded together, never paid twice. Folding case could merge two real ids
 * that differ only in case; that leaves one of them unpaid, which is the safe side. Anything that is not a string or a
 * finite number gives undefined, so it is refused as missing instead of being written as the text "undefined".
 */
export function normId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return (t.startsWith('#') ? t.slice(1).trim() : t).toUpperCase();
}

/** The fields normId governs. */
const ID_FIELDS = ['creator', 'orderId', 'signupId', 'ref'];

/**
 * One spelling of an email address, so one inbox is one buyer, account or self id: trimmed, lower-cased, any "+tag"
 * dropped from the local part, and for gmail.com and googlemail.com the dots dropped and the domain read as gmail.com
 * (Gmail delivers a.n.a+shop@googlemail.com to ana@gmail.com). Anything that is not one mailbox, one "@" and one
 * domain is refused, not hashed: an email flag holding something else is a mistake, never an identifier. The address
 * is never echoed in the error, so it cannot reach a screen or a log.
 */
export function canonicalEmail(s) {
  const bad = 'an email address must be one mailbox, one "@" and one domain';
  if (typeof s !== 'string') throw new Error(`canonicalEmail: ${bad}`);
  const t = s.trim().toLowerCase();
  const at = t.indexOf('@');
  if (at < 1 || at !== t.lastIndexOf('@') || at === t.length - 1) throw new Error(`canonicalEmail: ${bad}`);
  let local = t.slice(0, at);
  let domain = t.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('.').join('');
  if (!local) throw new Error('canonicalEmail: the address has no mailbox before its "+" or "@"');
  return `${local}@${domain}`;
}

/**
 * sha256 of the lowercased, trimmed identifier; an email (anything with an "@") is hashed in its one spelling,
 * canonicalEmail, so every path that hashes an address agrees. Refuses to hash nothing: one hash for every missing
 * buyer would collide.
 */
export function hashId(s) {
  if (typeof s !== 'string' && typeof s !== 'number') throw new Error('hashId: nothing to hash');
  const t = String(s).trim().toLowerCase();
  if (!t || t === 'true') throw new Error('hashId: nothing to hash (a bare flag is not an identifier)');
  return createHash('sha256').update(t.includes('@') ? canonicalEmail(t) : t).digest('hex');
}

function checkHash(field, v) {
  if (typeof v !== 'string') throw new Error(`${field} must be a sha256 hash`);
  if (v.includes('@')) throw new Error(`a raw email in ${field} is refused: store only its sha256 (the CLI hashes --buyer-email, --account-email and --self-emails; --buyer, --account and --self-ids take the hash itself)`);
  if (!HASH.test(v)) throw new Error(`${field} must be a sha256 hash (64 lowercase hex characters)`);
}

const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const plain = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(2));

// ---------------------------------------------------------------- the rules, fixed before the data

/** Every problem with the pre-registered rules. Any problem means NOT_PRE_REGISTERED: no figures, no writes. */
export function validatePilot(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['the pilot rules must be a JSON object'];
  const problems = [];
  const decided = strictTime(p.decidedOn);
  const start = strictTime(p.startDate);
  if (Number.isNaN(decided)) problems.push('decidedOn must be the date the rules were fixed (YYYY-MM-DD)');
  if (Number.isNaN(start)) problems.push('startDate must be the launch day (YYYY-MM-DD); day 1 is that UTC calendar day');
  if (!Number.isNaN(decided) && !Number.isNaN(start) && decided > start) {
    problems.push(`decidedOn ${p.decidedOn} is after startDate ${p.startDate}: the rules were not fixed before the data`);
  }
  const cap = toCents(p.capUsd);
  if (!(cap > 0)) problems.push('capUsd must be a dollar amount above 0');
  if (!Number.isInteger(p.days) || p.days <= DAY30 || p.days > 366) problems.push('days must be a whole number above 30 (the day-30 rule needs a day 31) and at most 366');
  if (!Number.isInteger(p.maxCreators) || p.maxCreators < 1) problems.push('maxCreators must be a whole number of at least 1');
  const rate = basisPoints(p.commissionRate);
  if (!(rate > 0 && rate < 10_000)) problems.push('commissionRate must be between 0 and 1, in whole basis points');
  if (!(toCents(p.signupUsd) >= 0)) problems.push('signupUsd must be a dollar amount (0 or more)');
  const share = basisPoints(p.day30MaxShareOfAov);
  if (!(share > 0 && share <= 10_000)) problems.push('day30MaxShareOfAov must be above 0 and at most 1, in whole basis points');
  if (!(toCents(p.baselineAovUsd) > 0)) {
    problems.push("baselineAovUsd must be the store's real average order value before the pilot (0 is refused on purpose)");
  }
  const band = p.paidSocialBandUsd;
  if (!Array.isArray(band) || band.length !== 2 || !(toCents(band[0]) > 0) || !(toCents(band[1]) >= toCents(band[0]))) {
    problems.push('paidSocialBandUsd must be [cheap end, dear end] in dollars, cheap end above 0');
  }
  // Money and rates must be JSON numbers. toCents reads "600" as 600, but the lines that show the rules do not, so a
  // string that passed here took status, check and pay down with a TypeError instead of being refused by name.
  for (const f of ['capUsd', 'signupUsd', 'baselineAovUsd', 'commissionRate', 'day30MaxShareOfAov']) {
    if (typeof p[f] !== 'number') problems.push(`${f} must be a JSON number, not ${JSON.stringify(p[f]) ?? 'missing'}`);
  }
  if (Array.isArray(band) && band.some((x) => typeof x !== 'number')) problems.push('paidSocialBandUsd must hold two JSON numbers, not strings');
  return problems;
}

/** JSON with every object's keys sorted and no spacing: key order and layout never change the hash, any value does. */
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x) ?? 'null').join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** The sha256 of the canonical pilot.json: what the ledger's first line pins. */
export function pilotSha256(pilot) {
  return createHash('sha256').update(canonicalJson(pilot) ?? 'null').digest('hex');
}

/**
 * Every reason the ledger does not pin these rules. Line 1 (file order) must be {type:"rules", ts, pilotSha256}, and
 * pilotSha256 must be the hash of pilot.json as it is now. Any problem is NOT_PRE_REGISTERED: no figures, no writes
 * (except the very first line, which is the pin itself). A ledger that is not a list is left to ledgerProblems.
 */
function pinProblems(entries, pilot) {
  if (!Array.isArray(entries)) return [];
  const first = entries[0];
  if (!first || first.type !== 'rules') {
    return [entries.length
      ? 'the ledger\'s first line must pin the rules, {type:"rules", ts, pilotSha256}: without it nothing shows which rules the results were recorded under'
      : 'the rules are not pinned yet: the ledger is empty, and its first write pins pilot.json as line 1'];
  }
  const want = pilotSha256(pilot);
  if (first.pilotSha256 !== want) {
    return [`pilot.json no longer matches the rules pinned on line 1 of the ledger (pinned ${JSON.stringify(first.pilotSha256) ?? 'nothing'}, pilot.json now hashes to "${want}"): rules changed after the data are refused, so put pilot.json back exactly as it was pinned`];
  }
  return [];
}

const startOf = (pilot) => Math.floor(strictTime(pilot.startDate) / DAY) * DAY;
/** Pilot day: day 1 is the UTC calendar day of startDate, counted as ledger.mjs counts days. */
const dayOf = (t, pilot) => (Math.floor(t / DAY) * DAY - startOf(pilot)) / DAY + 1;

// ---------------------------------------------------------------- the events

/** Throws on any line that is not a well-formed event. Returns the event unchanged. */
export function validateEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('an event must be a JSON object');
  if (!EVENT_TYPES.has(e.type)) throw new Error(`unknown type ${JSON.stringify(e.type)} (known: ${[...EVENT_TYPES].join(', ')})`);
  for (const f of REACH_FIELDS) if (e[f] !== undefined) throw new Error(`reach is never paid: a line carrying "${f}" is refused`);
  if (e.basis !== undefined && e.basis !== 'result') throw new Error(`reach is never paid: a basis of ${JSON.stringify(e.basis)} is refused, only a result is`);
  if (Number.isNaN(strictTime(e.ts))) throw new Error('ts must be an ISO date with an explicit Z or offset');
  const need = (f) => { if (!isId(e[f])) throw new Error(`${e.type} needs ${f}`); };
  // A stored id must already be in its one spelling: a hand-edited " 1001" would otherwise bring back the twin order.
  const ident = (f) => {
    need(f);
    if (normId(e[f]) !== e[f]) throw new Error(`${f} ${JSON.stringify(e[f])} is not in its one spelling ${JSON.stringify(normId(e[f]))}: two spellings of one id would count twice (the CLI writes it normalised)`);
  };
  const money = (f) => { if (!(toCents(e[f]) > 0)) throw new Error(`${f} must be a dollar amount above 0 with at most 2 decimals (got ${JSON.stringify(e[f])})`); };
  const code = () => {
    need('code');
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(normCode(e.code))) throw new Error(`code ${JSON.stringify(e.code)} must be 2 to 32 letters, digits, - or _`);
  };
  if (e.type === 'rules') {
    if (typeof e.pilotSha256 !== 'string' || !HASH.test(e.pilotSha256)) throw new Error('a rules line needs pilotSha256, the sha256 of the canonical pilot.json (64 lowercase hex characters)');
  } else if (e.type === 'creator') {
    ident('creator');
    code();
    need('handle');
    if (!Number.isInteger(e.followers) || e.followers < 0) throw new Error('followers must be a whole number');
    if (!Array.isArray(e.selfIds)) throw new Error('selfIds must be a list of sha256 hashes (write [] for none)');
    for (const h of e.selfIds) checkHash('selfIds', h);
  } else if (e.type === 'post') {
    ident('creator');
    need('url');
    if (e.clicks !== undefined && (!Number.isInteger(e.clicks) || e.clicks < 0)) throw new Error('clicks must be a whole number');
  } else if (e.type === 'order') {
    ident('orderId');
    code();
    money('valueUsd');
    if (e.buyer !== undefined && e.buyer !== null && e.buyer !== '') checkHash('buyer', e.buyer);
    if (e.source !== undefined && typeof e.source !== 'string') throw new Error('source must be a string');
  } else if (e.type === 'signup') {
    ident('signupId');
    code();
    if (e.account !== undefined && e.account !== null && e.account !== '') checkHash('account', e.account);
    if (e.source !== undefined && typeof e.source !== 'string') throw new Error('source must be a string');
  } else if (e.type === 'refund') {
    ident('orderId');
    money('amountUsd');
  } else if (e.type === 'payout') {
    ident('creator');
    money('amountUsd');
    ident('ref');
  } else if (e.type === 'flag') {
    need('note');
    if (e.creator !== undefined) {
      if (!isId(e.creator)) throw new Error('a flag creator must be a creator id');
      ident('creator');
    }
  }
  return e;
}

/** One JSON line per event. A line that will not parse or validate throws with its line number; none is skipped. */
export function parseLedger(text) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    let e;
    try {
      e = JSON.parse(l);
    } catch (err) {
      throw new Error(`line ${i + 1}: not JSON (${err.message})`);
    }
    try {
      validateEvent(e);
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err.message}`);
    }
    out.push(e);
  }
  return out;
}

/** Problems with the ledger as a whole: what a hand edit could break that no single line shows. */
function ledgerProblems(entries, pilot) {
  if (!Array.isArray(entries)) return ['the ledger must be a list of events'];
  const problems = [];
  const ids = new Set();
  const codes = new Set();
  const orderValue = new Map();
  const refunded = new Map();
  const refs = new Set();
  let paid = 0;
  entries.forEach((e, i) => {
    try {
      validateEvent(e);
    } catch (err) {
      problems.push(`entry ${i + 1}: ${err.message}`);
    }
  });
  if (problems.length) return problems;
  sorted(entries).forEach(({ e, i }) => {
    const at = `entry ${i + 1}`;
    if (e.type === 'rules') {
      if (i !== 0) problems.push(`${at}: the rules are pinned once, by line 1: a second rules line is refused`);
    } else if (e.type === 'creator') {
      if (ids.has(e.creator)) problems.push(`${at}: creator ${e.creator} added twice`);
      if (codes.has(normCode(e.code))) problems.push(`${at}: code ${normCode(e.code)} already used`);
      ids.add(e.creator);
      codes.add(normCode(e.code));
      if (ids.size > pilot.maxCreators) problems.push(`${at}: more than ${pilot.maxCreators} creators`);
    } else if (e.type === 'order' && !orderValue.has(e.orderId)) {
      orderValue.set(e.orderId, toCents(e.valueUsd));
    } else if (e.type === 'refund') {
      if (!orderValue.has(e.orderId)) problems.push(`${at}: refund for an order not in the ledger (${e.orderId})`);
      const total = (refunded.get(e.orderId) ?? 0) + toCents(e.amountUsd);
      refunded.set(e.orderId, total);
      if (orderValue.has(e.orderId) && total > orderValue.get(e.orderId)) problems.push(`${at}: refunds on ${e.orderId} exceed the order`);
    } else if (e.type === 'payout') {
      if (!ids.has(e.creator)) problems.push(`${at}: payout to a creator not in the ledger (${e.creator})`);
      if (refs.has(e.ref)) problems.push(`${at}: payment reference ${e.ref} used twice`);
      refs.add(e.ref);
      paid += toCents(e.amountUsd);
      if (paid > toCents(pilot.capUsd)) problems.push(`${at}: payouts total ${usd(paid)}, over the cap`);
    } else if ((e.type === 'flag' && e.creator !== undefined) || e.type === 'post') {
      if (!ids.has(e.creator)) problems.push(`${at}: ${e.type} for a creator not in the ledger (${e.creator})`);
    }
  });
  return problems;
}

/** ts order; where two lines share a ts, file order breaks the tie. */
function sorted(entries) {
  return entries.map((e, i) => ({ e, i, t: strictTime(e.ts) })).sort((a, b) => a.t - b.t || a.i - b.i);
}

// ---------------------------------------------------------------- verification, the cap and the stop rules

/**
 * Verify every order and sign-up against the rules, allocate the cap in ts order, and apply the day-30 rule.
 * Pure: the same ledger, rules and now always give the same answer. Assumes validatePilot passed.
 * Returns { results, rejected, stops, programmeFlag }.
 *
 * The day-30 rule is a one-way latch. A first pass takes the decision from what was known by the end of day 30:
 * every line dated in days 1 to 30, and only the refunds dated by then. The second pass nets every refund into its
 * own order but only applies that decision, never re-takes it. So a refund dated after day 30 can lower its own
 * order's commission and nothing else: it cannot lift a stop (paying a stopped creator's later orders) or impose one
 * (clawing back later orders that were never refunded), and it moves no other creator's cap room the wrong way.
 */
export function screen(entries, pilot, now = Date.now()) {
  const capCents = toCents(pilot.capUsd);
  const signupCents = toCents(pilot.signupUsd);
  const rateBp = basisPoints(pilot.commissionRate);
  const maxShareBp = basisPoints(pilot.day30MaxShareOfAov);
  const baselineCents = toCents(pilot.baselineAovUsd);
  const list = sorted(entries);

  const byCode = new Map();
  const refunds = new Map();
  const refundsBy30 = new Map();
  list.forEach(({ e, t }, pos) => {
    if (e.type === 'creator' && !byCode.has(normCode(e.code))) byCode.set(normCode(e.code), { id: e.creator, pos, selfIds: new Set(e.selfIds) });
    if (e.type === 'refund') {
      refunds.set(e.orderId, (refunds.get(e.orderId) ?? 0) + toCents(e.amountUsd));
      if (dayOf(t, pilot) <= DAY30) refundsBy30.set(e.orderId, (refundsBy30.get(e.orderId) ?? 0) + toCents(e.amountUsd));
    }
  });
  // The first line recorded for an order or sign-up id is the one that counts, by file position, not by ts: a copy
  // appended later under another code with an earlier ts must not take the commission from the line already paid.
  const firstLine = new Map();
  entries.forEach((e, i) => {
    const key = e.type === 'order' ? `order ${e.orderId}` : e.type === 'signup' ? `signup ${e.signupId}` : null;
    if (key !== null && !firstLine.has(key)) firstLine.set(key, i);
  });

  // One pass over the ledger in ts order, netting the refunds given. With latched null it takes the day-30 decision
  // and returns it; with a decision given it applies that one instead.
  const run = (refundsOf, latched) => {
    const results = [];
    const stops = {};
    const decided = {};
    const joined = [];
    let programmeFlag = null;
    let payableTotal = 0;
    let day30Done = false;
    const seenAccounts = new Set();

    const day30 = (t) => {
      if (day30Done || dayOf(t, pilot) <= DAY30) return;
      day30Done = true;
      for (const id of joined) {
        if (stops[id]) continue;
        if (latched) {
          if (latched[id]) stops[id] = latched[id];
          continue;
        }
        const rs = results.filter((r) => r.creator === id && r.verified && r.reason !== 'CAPPED' && r.day >= 1 && r.day <= DAY30);
        const orders = rs.filter((r) => r.type === 'order').length;
        const cost = rs.reduce((a, r) => a + r.payableCents, 0);
        // A creator with no orders has no share of AOV at all; that is a stop, never a NaN that compares as a pass.
        if (orders === 0) stops[id] = { reason: 'STOPPED_NO_ORDERS', day: DAY30 + 1, note: 'no verified order by day 30' };
        else if (cost * 10_000 > maxShareBp * baselineCents * orders) {
          stops[id] = { reason: 'STOPPED_DAY30', day: DAY30 + 1, share: cost / orders / baselineCents, note: `${usd(cost / orders)} per order by day 30` };
        }
        if (stops[id]) decided[id] = stops[id];
      }
    };

    const verify = (e, i, pos, r) => {
      const c = byCode.get(normCode(e.code));
      r.creator = c ? c.id : null;
      if (e.type === 'order') {
        if (firstLine.get(`order ${e.orderId}`) !== i) return 'DUPLICATE_ORDER_ID';
        if (e.source !== 'store') return 'UNSOURCED';
      } else {
        if (firstLine.get(`signup ${e.signupId}`) !== i) return 'DUPLICATE_SIGNUP_ID';
        const hasAccount = typeof e.account === 'string' && e.account !== '';
        if (hasAccount && seenAccounts.has(e.account)) return 'DUPLICATE_ACCOUNT';
        if (hasAccount) seenAccounts.add(e.account);
        if (e.completed !== true) return 'NOT_COMPLETED';
        if (e.source !== 'app') return 'UNSOURCED';
      }
      if (!c) return 'UNKNOWN_CODE';
      if (c.pos > pos) return 'BEFORE_CREATOR';
      if (r.day < 1 || r.day > pilot.days) return 'OUTSIDE_WINDOW';
      if (programmeFlag || stops[c.id]) return 'CREATOR_STOPPED';
      const who = e.type === 'order' ? e.buyer : e.account;
      if (typeof who !== 'string' || who === '') return e.type === 'order' ? 'NO_BUYER' : 'NO_ACCOUNT';
      if (c.selfIds.has(who)) return 'SELF_USE';
      if (e.type === 'order') {
        r.netCents = toCents(e.valueUsd) - (refundsOf.get(e.orderId) ?? 0);
        if (r.netCents <= 0) {
          r.netCents = 0;
          return 'REFUNDED';
        }
        r.earnedCents = Math.round((r.netCents * rateBp) / 10_000);
      } else {
        r.earnedCents = signupCents;
      }
      return null;
    };

    list.forEach(({ e, t, i }, pos) => {
      day30(t);
      if (e.type === 'creator') {
        if (joined.includes(e.creator)) return;
        joined.push(e.creator);
        // Day 30 counts from the programme start, so a creator who joins after it has no orders by day 30.
        if (day30Done) stops[e.creator] = { reason: 'STOPPED_NO_ORDERS', day: dayOf(t, pilot), note: 'joined after day 30' };
      } else if (e.type === 'flag') {
        if (e.creator !== undefined) stops[e.creator] = { reason: 'FLAGGED', day: dayOf(t, pilot), note: e.note };
        else programmeFlag ??= { day: dayOf(t, pilot), note: e.note };
      } else if (e.type === 'order' || e.type === 'signup') {
        const r = {
          ref: e.type === 'order' ? e.orderId : e.signupId, type: e.type, ts: e.ts, day: dayOf(t, pilot), code: normCode(e.code),
          creator: null, verified: false, reason: null, netCents: 0, earnedCents: 0, payableCents: 0,
        };
        r.reason = verify(e, i, pos, r);
        if (r.reason === null) {
          r.verified = true;
          const room = capCents - payableTotal;
          if (room <= 0) r.reason = 'CAPPED';
          else {
            r.payableCents = Math.min(r.earnedCents, room);
            if (r.payableCents < r.earnedCents) r.partial = true;
            payableTotal += r.payableCents;
          }
        }
        results.push(r);
      }
    });
    if (Number.isFinite(now)) day30(now);
    return { results, stops, programmeFlag, decided };
  };

  const { decided } = run(refundsBy30, null);
  const { results, stops, programmeFlag } = run(refunds, decided);
  const rejected = results.filter((r) => r.reason !== null).map((r) => ({ ref: r.ref, type: r.type, ts: r.ts, code: r.code, creator: r.creator, reason: r.reason, why: REASONS[r.reason] }));
  return { results, rejected, stops, programmeFlag };
}

/** The figures and the verdict. NOT_PRE_REGISTERED and INVALID_LEDGER show no figures at all. */
export function status(entries, pilot, now = Date.now()) {
  const empty = { day: null, provisional: null, creators: [], blended: null, cap: null, rejected: [], fraud: null, stopped: [] };
  const pilotProblems = validatePilot(pilot);
  if (pilotProblems.length) {
    return { ...empty, verdict: 'NOT_PRE_REGISTERED', verdictText: 'NOT_PRE_REGISTERED: the rules were not fixed, complete, before the data', problems: pilotProblems };
  }
  const unpinned = pinProblems(entries, pilot);
  if (unpinned.length) {
    return { ...empty, verdict: 'NOT_PRE_REGISTERED', verdictText: 'NOT_PRE_REGISTERED: the rules in force are not the ones the ledger pinned on its first line', problems: unpinned };
  }
  const day = dayOf(now, pilot);
  const ledgerBad = ledgerProblems(entries, pilot);
  if (ledgerBad.length) {
    return { ...empty, day, verdict: 'INVALID_LEDGER', verdictText: `INVALID_LEDGER: ${ledgerBad[0]}`, problems: ledgerBad };
  }

  const sc = screen(entries, pilot, now);
  const capCents = toCents(pilot.capUsd);
  const baselineCents = toCents(pilot.baselineAovUsd);
  const bandCents = toCents(pilot.paidSocialBandUsd[0]);
  const counted = (r) => r.verified && r.reason !== 'CAPPED';

  const creatorLines = entries.filter((e) => e.type === 'creator');
  const creators = sorted(creatorLines).map(({ e }) => {
    const id = e.creator;
    const mine = sc.results.filter((r) => r.creator === id);
    const posts = entries.filter((x) => x.type === 'post' && x.creator === id);
    const verifiedOrders = mine.filter((r) => r.type === 'order' && counted(r));
    const payable = mine.reduce((a, r) => a + r.payableCents, 0);
    const paid = entries.filter((x) => x.type === 'payout' && x.creator === id).reduce((a, x) => a + toCents(x.amountUsd), 0);
    const cpo = verifiedOrders.length ? payable / verifiedOrders.length : null;
    const stop = sc.stops[id];
    return {
      id,
      code: normCode(e.code),
      state: stop ? stop.reason : 'ACTIVE',
      stop: stop ?? null,
      held: Boolean(sc.programmeFlag || stop?.reason === 'FLAGGED'),
      posts: posts.length,
      clicks: posts.reduce((a, x) => a + (x.clicks ?? 0), 0),
      orders: mine.filter((r) => r.type === 'order').length,
      verifiedOrders: verifiedOrders.length,
      valueUsd: mine.filter((r) => r.type === 'order' && r.verified).reduce((a, r) => a + r.netCents, 0) / 100,
      signups: mine.filter((r) => r.type === 'signup' && counted(r)).length,
      payableUsd: payable / 100,
      paidUsd: paid / 100,
      owedUsd: Math.max(0, payable - paid) / 100,
      clawbackUsd: Math.max(0, paid - payable) / 100,
      costPerOrderUsd: cpo === null ? null : cpo / 100,
      shareOfAov: cpo === null ? null : cpo / baselineCents,
      payableCents: payable,
      paidCents: paid,
    };
  });

  const payableCents = sc.results.reduce((a, r) => a + r.payableCents, 0);
  const paidCents = creators.reduce((a, c) => a + c.paidCents, 0);
  const blendedOrders = sc.results.filter((r) => r.type === 'order' && counted(r)).length;
  const blendedResults = sc.results.filter(counted).length;
  const blended = {
    costUsd: payableCents / 100,
    verifiedOrders: blendedOrders,
    costPerOrderUsd: blendedOrders ? payableCents / blendedOrders / 100 : null,
    costPerResultUsd: blendedResults ? payableCents / blendedResults / 100 : null,
  };
  const cap = { capUsd: capCents / 100, payableUsd: payableCents / 100, paidUsd: paidCents / 100, remainingUsd: (capCents - payableCents) / 100 };
  const count = (...reasons) => sc.results.filter((r) => reasons.includes(r.reason)).length;
  const fraud = {
    duplicates: count('DUPLICATE_ORDER_ID', 'DUPLICATE_SIGNUP_ID', 'DUPLICATE_ACCOUNT'),
    selfUse: count('SELF_USE'),
    refundsUsd: entries.filter((e) => e.type === 'refund').reduce((a, e) => a + toCents(e.amountUsd), 0) / 100,
    clawbacksUsd: creators.reduce((a, c) => a + Math.max(0, c.paidCents - c.payableCents), 0) / 100,
  };
  const stopped = creators.filter((c) => c.state !== 'ACTIVE').map((c) => `${c.code} (${c.state})`);

  // The day-60 rule, as integers: blended cost per order below the band's cheap end, i.e. cost < cheapEnd x orders.
  const bandText = `$${plain(pilot.paidSocialBandUsd[0])}`;
  const decide = () => {
    if (!blendedOrders) return { verdict: 'STOP_DAY60', text: `STOP_DAY60: no verified orders, so no cost per order beats ${bandText}. Stop the programme, keep the capability` };
    const per = usd(payableCents / blendedOrders);
    return payableCents < bandCents * blendedOrders
      ? { verdict: 'CONTINUE', text: `CONTINUE: ${per} per order < ${bandText}, below the paid-social band` }
      : { verdict: 'STOP_DAY60', text: `STOP_DAY60: ${per} per order >= ${bandText}, the paid-social band's cheap end. Stop the programme, keep the capability` };
  };

  const decided = day > pilot.days;
  const base = { day, problems: [], creators, blended, cap, rejected: sc.rejected, fraud, stopped, provisional: !decided };
  const allStopped = creators.length ? creators.every((c) => c.state !== 'ACTIVE') : day > DAY30;
  if (sc.programmeFlag) return { ...base, verdict: 'STOP_FLAG', verdictText: `STOP_FLAG: ${sc.programmeFlag.note}. Every payout is held` };
  if (payableCents >= capCents) {
    const d = decide();
    return { ...base, provisional: false, decision: d.verdict, verdict: 'CAP_REACHED', verdictText: `CAP_REACHED: ${usd(payableCents)} of ${usd(capCents)} payable, so the pilot ended early and the day-60 decision is taken now. ${d.text}` };
  }
  if (decided && decide().verdict === 'STOP_DAY60') return { ...base, decision: 'STOP_DAY60', verdict: 'STOP_DAY60', verdictText: decide().text };
  if (allStopped) return { ...base, verdict: 'STOP_ALL_CREATORS', verdictText: `STOP_ALL_CREATORS: every creator is stopped: ${stopped.join(', ') || 'none recruited by day 30'}` };
  const so = blended.costPerOrderUsd === null ? 'no verified order yet' : `${usd(payableCents / blendedOrders)} per order so far`;
  const text = decided ? decide().text : `CONTINUE (provisional, day ${day} of ${pilot.days}: ${so}; the day-60 decision is taken on day ${pilot.days + 1})`;
  return { ...base, decision: decided ? 'CONTINUE' : null, verdict: 'CONTINUE', verdictText: `${text}${stopped.length ? `; stopped: ${stopped.join(', ')}` : ''}` };
}

// ---------------------------------------------------------------- the write guards

/** Whether a payout may be written. Runs on the full ledger; nothing is written unless ok. */
export function checkPayout(entries, pilot, { creator: rawCreator, amountUsd, ref: rawRef, ts } = {}, now = Date.now()) {
  // Called directly as well as from checkAppend, so it takes ids in their one spelling too.
  const creator = normId(rawCreator) ?? rawCreator;
  const ref = normId(rawRef) ?? rawRef;
  const s = status(entries, pilot, now);
  if (s.verdict === 'NOT_PRE_REGISTERED' || s.verdict === 'INVALID_LEDGER') return { ok: false, reasons: [s.verdictText, ...s.problems] };
  if (s.verdict === 'STOP_FLAG') return { ok: false, reasons: [`${s.verdictText}: no payout while the programme is frozen`] };
  const c = s.creators.find((x) => x.id === creator);
  if (!c) return { ok: false, reasons: [`unknown creator ${JSON.stringify(creator)}`] };
  const reasons = [];
  const at = ts === undefined ? now : strictTime(ts);
  if (Number.isNaN(at)) reasons.push('the payout ts must be an ISO date');
  else if (at > now + DAY) reasons.push('the payout is dated more than a day in the future');
  if (c.state === 'FLAGGED') reasons.push(`${c.code} is flagged (${c.stop.note}): their earnings are held until the flag is cleared`);
  if (!isId(ref)) reasons.push('a payout needs its payment reference (--ref)');
  else if (entries.some((e) => e.type === 'payout' && e.ref === ref)) reasons.push(`payment reference ${ref} is already in the ledger`);
  const cents = toCents(amountUsd);
  if (!(cents > 0)) {
    reasons.push(`the amount must be a dollar amount above 0 (got ${JSON.stringify(amountUsd)})`);
    return { ok: false, reasons };
  }
  if (c.clawbackUsd > 0) reasons.push(`${c.code} owes a clawback of ${usd(c.clawbackUsd * 100)} (refunds after payment): nothing more is paid until it is earned back`);
  const owed = c.payableCents - c.paidCents;
  if (cents > owed) reasons.push(`${usd(cents)} is more than ${c.code} is owed (${usd(Math.max(0, owed))})`);
  else if (!Number.isNaN(at)) {
    const sc = screen(entries, pilot, now);
    const earnedBy = sc.results.filter((r) => r.creator === creator && strictTime(r.ts) <= at).reduce((a, r) => a + r.payableCents, 0);
    if (cents > earnedBy - c.paidCents) reasons.push(`the payout is dated before the result it pays (owed by then: ${usd(Math.max(0, earnedBy - c.paidCents))})`);
  }
  const paidAll = Math.round(s.cap.paidUsd * 100);
  const capCents = toCents(pilot.capUsd);
  if (paidAll + cents > capCents) reasons.push(`paying ${usd(cents)} would take payouts to ${usd(paidAll + cents)}, over the ${usd(capCents)} cap`);
  return { ok: reasons.length === 0, reasons };
}

/** The guards a write runs before appending. Returns { ok, reasons, event } where event is what would be written. */
export function checkAppend(entries, pilot, event, now = Date.now()) {
  const pilotProblems = validatePilot(pilot);
  if (pilotProblems.length) return { ok: false, reasons: ['NOT_PRE_REGISTERED: no write until the rules are fixed before the data', ...pilotProblems], event };
  // Line 1 pins the rules, so the only write an empty ledger takes is that pin; every other write needs it to match.
  const empty = Array.isArray(entries) && entries.length === 0;
  if (empty && !(event && event.type === 'rules')) {
    return { ok: false, reasons: ['NOT_PRE_REGISTERED: the ledger\'s first line pins the rules: write {type:"rules", ts, pilotSha256} first (the CLI writes it with the first event)'], event };
  }
  const pinBad = empty ? [] : pinProblems(entries, pilot);
  if (pinBad.length) return { ok: false, reasons: ['NOT_PRE_REGISTERED: no write under rules other than the ones the ledger pinned', ...pinBad], event };
  const ledgerBad = ledgerProblems(entries, pilot);
  if (ledgerBad.length) return { ok: false, reasons: ['INVALID_LEDGER: no write onto a ledger that does not validate', ...ledgerBad], event };
  // The boundary: every id is put in its one spelling here, once, and stored that way.
  let e = event;
  if (event && typeof event === 'object' && !Array.isArray(event)) {
    e = { ...event };
    if (typeof e.code === 'string') e.code = normCode(e.code);
    for (const f of ID_FIELDS) {
      const n = normId(e[f]);
      if (n !== undefined) e[f] = n;
    }
  }
  try {
    validateEvent(e);
  } catch (err) {
    return { ok: false, reasons: [err.message], event: e };
  }
  const reasons = [];
  const t = strictTime(e.ts);
  if (t > now + DAY) reasons.push(`ts ${e.ts} is more than a day in the future`);
  const creators = entries.filter((x) => x.type === 'creator');
  const known = (id) => creators.some((x) => x.creator === id);
  if (e.type === 'rules') {
    // A second rules line is refused by ledgerProblems below: the rules are pinned once, by line 1.
    if (e.pilotSha256 !== pilotSha256(pilot)) reasons.push(`a rules line pins this pilot.json, whose sha256 is ${pilotSha256(pilot)}, not ${JSON.stringify(e.pilotSha256)}`);
  } else if (e.type === 'creator') {
    if (known(e.creator)) reasons.push(`creator id ${e.creator} already used`);
    if (creators.some((x) => normCode(x.code) === e.code)) reasons.push(`code already used: ${e.code}`);
    if (creators.length >= pilot.maxCreators) reasons.push(`the pilot is full: at most ${pilot.maxCreators} creators`);
    if (dayOf(t, pilot) > DAY30) reasons.push('day 30 counts from the programme start, so a creator added after it could never pass the day-30 rule');
  } else if (e.type === 'post' || (e.type === 'flag' && e.creator !== undefined)) {
    if (!known(e.creator)) reasons.push(`unknown creator ${e.creator}`);
  } else if (e.type === 'order') {
    // Refused at write time: an unsourced line would take this order id for good, and the real store row after it
    // could then never be paid (the ledger is append-only).
    if (e.source !== 'store') reasons.push(`an order is written only from the store's own export: source must be "store", not ${JSON.stringify(e.source) ?? 'missing'}`);
    if (entries.some((x) => x.type === 'order' && x.orderId === e.orderId)) reasons.push(`order id ${e.orderId} is already in the ledger`);
  } else if (e.type === 'signup') {
    if (e.source !== 'app') reasons.push(`a sign-up is written only from the app: source must be "app", not ${JSON.stringify(e.source) ?? 'missing'}`);
    if (entries.some((x) => x.type === 'signup' && x.signupId === e.signupId)) reasons.push(`sign-up id ${e.signupId} is already in the ledger`);
  } else if (e.type === 'refund') {
    const order = entries.find((x) => x.type === 'order' && x.orderId === e.orderId);
    if (!order) reasons.push(`no order ${e.orderId} in the ledger to refund`);
    else {
      const before = entries.filter((x) => x.type === 'refund' && x.orderId === e.orderId).reduce((a, x) => a + toCents(x.amountUsd), 0);
      const total = before + toCents(e.amountUsd);
      if (total > toCents(order.valueUsd)) reasons.push(`refunds on ${e.orderId} would total ${usd(total)}, more than the ${usd(toCents(order.valueUsd))} order`);
      if (t < strictTime(order.ts)) reasons.push(`the refund is dated ${e.ts}, before order ${e.orderId} was placed (${order.ts})`);
    }
  } else if (e.type === 'payout') {
    reasons.push(...checkPayout(entries, pilot, e, now).reasons);
  }
  if (reasons.length) return { ok: false, reasons, event: e };

  // The ledger as it would be. Anything wrong with it now is new, since the ledger validated above: a post or flag
  // dated before its creator, a refund before its order, and any invariant ledgerProblems learns later.
  const after = [...entries, e];
  const broken = ledgerProblems(after, pilot);
  if (broken.length) return { ok: false, reasons: broken.map((p) => `the ledger would not validate with this line: ${p}`), event: e };

  // The day-30 decision is a one-way latch (screen). A refund dated after day 30 never reaches it. One dated on or
  // before day 30 but written once the decision is taken would re-take it, so it is refused if it moves any stop:
  // dated after day 30 instead, it nets its own order and nothing else.
  if (e.type === 'refund' && dayOf(now, pilot) > DAY30 && dayOf(t, pilot) <= DAY30) {
    const stopsNow = screen(entries, pilot, now).stops;
    const stopsWith = screen(after, pilot, now).stops;
    for (const c of creators) {
      const stateNow = stopsNow[c.creator]?.reason ?? 'ACTIVE';
      const stateWith = stopsWith[c.creator]?.reason ?? 'ACTIVE';
      if (stateNow !== stateWith) {
        reasons.push(`the day-30 decision is taken and ${normCode(c.code)} is ${stateNow}; this refund is dated ${e.ts}, on or before day 30, so it would re-take that decision and make ${normCode(c.code)} ${stateWith}. Date it after day 30 (the CLI dates it now unless --ts is given): it then nets order ${e.orderId} and moves no stop`);
      }
    }
    if (reasons.length) return { ok: false, reasons, event: e };
  }

  // A paid result is final. The cap is handed out in ts order, so a late or back-dated line could take room from a
  // result already paid, or flip a stop under it, and leave a clawback no refund caused. Only a refund may take paid
  // money back, and (with the latch above) only the commission on its own order.
  if (e.type !== 'refund' && e.type !== 'payout') {
    const was = status(entries, pilot, now).creators;
    for (const c of status(after, pilot, now).creators) {
      const old = was.find((x) => x.id === c.id);
      if (old && c.payableCents < old.payableCents && c.payableCents < c.paidCents) {
        reasons.push(`${c.code} has been paid ${usd(c.paidCents)} and this line would cut their payable to ${usd(c.payableCents)}: a paid result is final. A late or back-dated line takes no room from results already paid; if money is to come back, record a refund`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons, event: e };
}

// ---------------------------------------------------------------- the weekly table

/** One row per creator per pilot week (days 1-7 are week 1), up to the current week. */
export function weekly(entries, pilot, now = Date.now()) {
  if (validatePilot(pilot).length || pinProblems(entries, pilot).length || ledgerProblems(entries, pilot).length) return [];
  const sc = screen(entries, pilot, now);
  const weekOf = (ts) => Math.ceil(dayOf(strictTime(ts), pilot) / 7);
  const current = Math.ceil(dayOf(now, pilot) / 7);
  const rows = [];
  for (const { e: c } of sorted(entries.filter((x) => x.type === 'creator'))) {
    for (let w = 1; w <= current; w++) {
      const posts = entries.filter((x) => x.type === 'post' && x.creator === c.creator && weekOf(x.ts) === w);
      const rs = sc.results.filter((r) => r.creator === c.creator && weekOf(r.ts) === w && r.verified && r.reason !== 'CAPPED');
      const orders = rs.filter((r) => r.type === 'order');
      const cost = rs.reduce((a, r) => a + r.payableCents, 0);
      const paid = entries.filter((x) => x.type === 'payout' && x.creator === c.creator && weekOf(x.ts) === w).reduce((a, x) => a + toCents(x.amountUsd), 0);
      rows.push({
        week: w,
        creator: c.creator,
        code: normCode(c.code),
        posts: posts.length,
        clicks: posts.reduce((a, x) => a + (x.clicks ?? 0), 0),
        orders: orders.length,
        valueUsd: orders.reduce((a, r) => a + r.netCents, 0) / 100,
        signups: rs.length - orders.length,
        paidUsd: paid / 100,
        costPerResultUsd: rs.length ? cost / rs.length / 100 : null,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- formatting (template literals only: "$" survives)

export function format(s) {
  if (s.verdict === 'NOT_PRE_REGISTERED' || s.verdict === 'INVALID_LEDGER') {
    const lines = [`Verdict  ${s.verdictText}`, ...s.problems.map((p) => `  ${p}`)];
    lines.push(s.verdict === 'NOT_PRE_REGISTERED'
      ? '  No figures are shown, and no write is taken but the first (which pins the rules), until pilot.json is complete, dated before the data and exactly the rules line 1 of the ledger pinned.'
      : '  No figures are shown and nothing is skipped: repair that line by hand, then run status again.');
    return lines.join('\n');
  }
  const money = (v) => (v === null ? 'n/a' : `$${v.toFixed(2)}`);
  const lines = [
    `Day ${s.day}${s.provisional ? ' (provisional: the day-60 decision is not taken yet)' : ''}`,
    `Cap: ${money(s.cap.payableUsd)} payable of ${money(s.cap.capUsd)}, ${money(s.cap.paidUsd)} paid, ${money(s.cap.remainingUsd)} unallocated`,
    `Blended: ${money(s.blended.costUsd)} over ${s.blended.verifiedOrders} verified orders = ${money(s.blended.costPerOrderUsd)} per order; ${money(s.blended.costPerResultUsd)} per verified result (does not decide)`,
    'Creators:',
  ];
  if (!s.creators.length) lines.push('  none yet');
  for (const c of s.creators) {
    const share = c.shareOfAov === null ? 'no verified order' : `${money(c.costPerOrderUsd)} per order = ${c.shareOfAov.toFixed(2)} of AOV`;
    lines.push(`  ${c.code} ${c.state}${c.held ? ' (held)' : ''}: ${c.verifiedOrders}/${c.orders} orders verified (${money(c.valueUsd)}), ${c.signups} sign-ups, payable ${money(c.payableUsd)}, paid ${money(c.paidUsd)}, owed ${money(c.owedUsd)}${c.clawbackUsd > 0 ? `, CLAWBACK ${money(c.clawbackUsd)}` : ''}; ${share}`);
  }
  if (s.rejected.length) {
    lines.push('Unpaid, with the reason to give the creator:');
    for (const r of s.rejected) lines.push(`  ${r.code} ${r.type} ${r.ref}: ${r.reason}, ${r.why}`);
  }
  lines.push(`Fraud: ${s.fraud.duplicates} duplicates, ${s.fraud.selfUse} self-use, ${money(s.fraud.refundsUsd)} refunded, ${money(s.fraud.clawbacksUsd)} to claw back`);
  lines.push(`Verdict  ${s.verdictText}`);
  return lines.join('\n');
}

export function formatWeekly(rows) {
  if (!rows.length) return 'No pilot week has started.';
  const money = (v) => (v === null ? 'n/a' : `$${v.toFixed(2)}`);
  return [
    'week  code  posts  clicks  orders  value  sign-ups  paid  per verified result',
    ...rows.map((r) => `${r.week}  ${r.code}  ${r.posts}  ${r.clicks}  ${r.orders}  ${money(r.valueUsd)}  ${r.signups}  ${money(r.paidUsd)}  ${money(r.costPerResultUsd)}`),
  ].join('\n');
}

// ---------------------------------------------------------------- the command line

function args() {
  const out = {};
  const a = process.argv.slice(3);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

/** A CLI dollar figure stored as a number when it is one, and left as typed when it is not, so validateEvent refuses it. */
const dollars = (v) => (Number.isFinite(toCents(v)) ? toCents(v) / 100 : v);
const whole = (v) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : v);
/** An email flag's value, hashed in its one spelling: canonicalEmail refuses anything that is not an address. */
const hashEmail = (v) => hashId(canonicalEmail(v));
const hashList = (v) => (v === undefined ? [] : v.split(',').map((x) => x.trim()).filter(Boolean).map(hashEmail));
/** --self-ids, like --buyer and --account, takes sha256 hashes: each is checked and stored exactly as given, never hashed again. */
const givenHashes = (v) => (v === undefined ? [] : v.split(',').map((x) => x.trim()).filter(Boolean).map((h) => { checkHash('--self-ids', h); return h; }));

const USAGE = `usage: creator-pilot.mjs <command> [--file agency/pilot/ledger.jsonl --pilot agency/pilot/pilot.json --ts ISO --now ISO]
  check
  add-creator --id ID --code CODE --handle @H --followers N [--self-emails a@x,b@y --self-ids SHA256,SHA256]
  post --creator ID --url URL [--clicks N]
  order --order-id ID --code CODE --value USD --buyer-email E --source store
  import-orders --from export.json
  signup --signup-id ID --code CODE --account-email E --completed true
  refund --order-id ID --amount USD
  pay --creator ID --amount USD --ref PAYMENT-REF
  flag [--creator ID] --note TEXT
  status        exit 2 unless CONTINUE
  weekly
The first write pins pilot.json: line 1 of the ledger is its sha256, and every command refuses once the file changes.`;

function main(cmd, o) {
  // args() turns a bare flag into 'true', and `o.file || default` would take that for a path: the event would go to
  // a second ledger called ./true and the real one would miss it. A path flag without a path is refused.
  for (const k of ['file', 'pilot', 'from']) {
    if (o[k] === 'true' || o[k] === '') {
      console.error(`--${k} needs a path (a bare --${k} would read or write a file called "true")\n${USAGE}`);
      return 1;
    }
  }
  const file = o.file || 'agency/pilot/ledger.jsonl';
  const pilotPath = o.pilot || 'agency/pilot/pilot.json';
  const now = o.now !== undefined ? strictTime(o.now) : Date.now();
  if (Number.isNaN(now)) {
    console.error('--now must be an ISO date');
    return 1;
  }
  const commands = ['check', 'add-creator', 'post', 'order', 'import-orders', 'signup', 'refund', 'pay', 'flag', 'status', 'weekly'];
  if (!commands.includes(cmd)) {
    console.error(USAGE);
    return 1;
  }
  if (!existsSync(pilotPath)) {
    console.error(`no pilot rules at ${pilotPath}. Write them before the first event, starting from:\n${JSON.stringify(PILOT_DEFAULTS, null, 2)}`);
    return 1;
  }
  let pilot;
  try {
    pilot = JSON.parse(readFileSync(pilotPath, 'utf8'));
  } catch (err) {
    console.error(`${pilotPath} is not JSON: ${err.message}`);
    return 1;
  }
  if (cmd === 'check') {
    const problems = validatePilot(pilot);
    if (problems.length) {
      console.error(`NOT_PRE_REGISTERED: ${pilotPath}\n${problems.map((p) => `  missing ${p}`).join('\n')}`);
      return 1;
    }
    // check reads the ledger's pin too: rules edited after the first write are refused here as everywhere else.
    let pinNote = 'not pinned yet: the first write pins them as line 1 of the ledger';
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (text.trim()) {
      let ledger;
      try {
        ledger = parseLedger(text);
      } catch (err) {
        console.error(`INVALID_LEDGER: ${err.message}`);
        return 1;
      }
      const unpinnedRules = pinProblems(ledger, pilot);
      if (unpinnedRules.length) {
        console.error(`NOT_PRE_REGISTERED: ${pilotPath}\n${unpinnedRules.map((p) => `  ${p}`).join('\n')}`);
        return 1;
      }
      pinNote = `pinned by line 1 of ${file}`;
    }
    console.log(`rules fixed on ${pilot.decidedOn}, day 1 is ${pilot.startDate}: cap $${plain(pilot.capUsd)}, ${pilot.days} days, ${pilot.maxCreators} creators, ${pilot.commissionRate * 100}% commission, $${plain(pilot.signupUsd)} a sign-up, baseline AOV $${plain(pilot.baselineAovUsd)}; ${pinNote}`);
    return 0;
  }

  let entries;
  try {
    entries = parseLedger(existsSync(file) ? readFileSync(file, 'utf8') : '');
  } catch (err) {
    if (cmd === 'status' || cmd === 'weekly') {
      console.log(format({ verdict: 'INVALID_LEDGER', verdictText: `INVALID_LEDGER: ${err.message}`, problems: [] }));
      return 2;
    }
    console.error(`refused: INVALID_LEDGER: ${err.message}`);
    return 1;
  }

  if (cmd === 'status') {
    const s = status(entries, pilot, now);
    console.log(format(s));
    return s.verdict === 'CONTINUE' ? 0 : 2;
  }
  if (cmd === 'weekly') {
    const s = status(entries, pilot, now);
    if (s.verdict === 'NOT_PRE_REGISTERED' || s.verdict === 'INVALID_LEDGER') {
      console.log(format(s));
      return 2;
    }
    console.log(formatWeekly(weekly(entries, pilot, now)));
    return 0;
  }

  const ts = o.ts || new Date(now).toISOString();
  const build = (make) => {
    try {
      return make();
    } catch (err) {
      return { error: err.message };
    }
  };
  let events;
  if (cmd === 'import-orders') {
    if (!o.from || !existsSync(o.from)) {
      console.error('import-orders needs --from export.json (the store export, as a JSON array)');
      return 1;
    }
    let rows;
    try {
      rows = JSON.parse(readFileSync(o.from, 'utf8'));
    } catch (err) {
      console.error(`${o.from} is not JSON: ${err.message}`);
      return 1;
    }
    if (!Array.isArray(rows)) {
      console.error(`${o.from} must be a JSON array of orders`);
      return 1;
    }
    events = rows.map((row) => build(() => {
      const email = row?.buyerEmail ?? row?.email;
      return {
        ts: row?.ts ?? row?.createdAt,
        type: 'order',
        // A null or missing id stays missing and is refused; String() would have written it as order "undefined".
        orderId: normId(row?.orderId ?? row?.id),
        code: row?.code,
        valueUsd: row?.valueUsd ?? row?.value ?? row?.total,
        buyer: email !== undefined && email !== null && email !== '' ? hashEmail(email) : row?.buyer,
        source: 'store',
      };
    }));
  } else {
    events = [build(() => {
      if (cmd === 'add-creator') {
        return { ts, type: 'creator', creator: o.id, code: o.code, handle: o.handle, followers: whole(o.followers), selfIds: [...hashList(o['self-emails']), ...givenHashes(o['self-ids'])] };
      }
      if (cmd === 'post') return { ts, type: 'post', creator: o.creator, url: o.url, clicks: whole(o.clicks) };
      if (cmd === 'order') {
        return { ts, type: 'order', orderId: o['order-id'], code: o.code, valueUsd: dollars(o.value), buyer: o['buyer-email'] !== undefined ? hashEmail(o['buyer-email']) : o.buyer, source: o.source };
      }
      if (cmd === 'signup') {
        return { ts, type: 'signup', signupId: o['signup-id'], code: o.code, account: o['account-email'] !== undefined ? hashEmail(o['account-email']) : o.account, completed: o.completed === 'true' ? true : o.completed, source: o.source ?? 'app' };
      }
      if (cmd === 'refund') return { ts, type: 'refund', orderId: o['order-id'], amountUsd: dollars(o.amount) };
      if (cmd === 'pay') return { ts, type: 'payout', creator: o.creator, amountUsd: dollars(o.amount), ref: o.ref };
      return { ts, type: 'flag', creator: o.creator, note: o.note };
    })];
  }

  const accepted = [];
  const refused = [];
  let ledger = entries;
  // The first write pins the rules: line 1 is the sha256 of pilot.json as it is now. It is written only together with
  // a line that is taken, so a refused first command leaves the ledger empty and the rules still open.
  let pin = null;
  if (entries.length === 0) {
    const r = checkAppend([], pilot, { ts: new Date(now).toISOString(), type: 'rules', pilotSha256: pilotSha256(pilot) }, now);
    if (!r.ok) {
      console.error(`refused ${r.reasons.join('; ')}`);
      return 1;
    }
    pin = r.event;
    ledger = [pin];
  }
  events.forEach((ev, i) => {
    const r = ev.error ? { ok: false, reasons: [ev.error] } : checkAppend(ledger, pilot, ev, now);
    if (r.ok) {
      accepted.push(r.event);
      ledger = [...ledger, r.event];
    } else refused.push({ i, ev, reasons: r.reasons });
  });
  if (accepted.length) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, [...(pin ? [pin] : []), ...accepted].map((e) => `${JSON.stringify(e)}\n`).join(''));
  }
  for (const r of refused) {
    const which = cmd === 'import-orders' ? `row ${r.i + 1}${r.ev.orderId ? ` (${r.ev.orderId})` : ''}: ` : '';
    console.error(`refused ${which}${r.reasons.join('; ')}`);
  }
  if (accepted.length) console.log(`recorded ${accepted.length} ${accepted.length === 1 ? accepted[0].type : 'lines'} in ${file}${pin ? ` (line 1 pins the rules: pilot.json sha256 ${pin.pilotSha256})` : ''}`);
  return refused.length ? 1 : 0;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) process.exitCode = main(process.argv[2], args());
