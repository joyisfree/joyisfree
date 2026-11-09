#!/usr/bin/env node
// The copy gate: every note, DM, opener and subject must be short, true, sourced, legal and Leif's own voice.
// Exit 1 on any error, so a bad line cannot reach the pack.
//
//   node agency-desk/scripts/lint-lines.mjs --rows <rows.json> --roster <roster.json> --today YYYY-MM-DD
//        [--note-max 200] [--max-age-days 183] [--json]
import { readFileSync } from 'node:fs';
import { args, isMain, emailDomain, WEBMAIL, token } from './lib.mjs';

export const BANNED = [
  'stoked with', 'game changer', 'game-changer', 'hope this finds you', 'hope this email finds you', 'hope you are well',
  'touch base', 'circle back', 'synergy', 'love what you guys stand for', 'i came across your profile', 'revolutionize',
  'leverage our', 'just following up', 'just checking in', 'guaranteed', 'go viral', '10x your', 'apple of smart home',
  'positive energy',
];
// How long a hook stays true enough to quote, by kind (days from the event or publish date, never the read date).
export const MAX_AGE = { sponsor: 548, launch: 183, news: 183, season: 400, role: 365, value: 400, warm: 365 };
// "my huge property", "my 250 year old heritage house": up to four words may sit between the pronoun and the thing
// claimed. "My roster is home and garden YouTubers" is about the creators, not Leif's life, so it never matches.
export const FIRST_PERSON = /\b((my|our) (?:(?!(?:roster|creators?|channels?|clients|team|are|is|make|makes|cover|covers|home|and|garden|diy)\b)[a-z0-9'-]+ ){0,4}(house|home|property|land|kids?|wife|husband|garden|shop|office|backyard|place|balcony|cafe|offices)(?! and garden|,? garden| and diy|-garden| improvement)|we're running|i (own|bought|use|have been using)|wife|husband|my kid'?s)\b/i;
// "brands plan spring creators about now" is a claim about the calendar: it needs a sourced season, launch or news hook.
export const TIMING = /\b(about now|right now is when|lines? up (their |its )?(spring|creators|creator)|plan(s|ning)? (their |its )?(spring|summer|2027|creators|creator)|budgets? (are|get|is) (set|locked)|lock(ing)? in (their |its )?(spring|creators)|now'?s (a )?good time|this time of year)\b/i;
const CONSENT = /\b(mind if i (send|email|share|pop)|ok(ay)? (if|to) i? ?(send|email)|ok(ay)? to (send|email)|can i (send|email)|happy for me to (send|email|share)|shall i (send|email)|want me to (send|email)|would it be ok(ay)? (if i|to) (send|email)|(want|like) the one-pager|here or by email)/i;
// A LinkedIn DM may itself be a commercial electronic message under the Spam Act: it carries an easy way out.
const OPT_OUT = /(not your area|not the right person|rather not hear|won'?t follow up|no worries if not|say so and i|just say and i|i'?ll leave it there|happy to leave it)/i;
const BAD_SOURCE = /(^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/|google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/\?)/i;
const GENERIC_SUBJECT = /^(creators (and influencers )?for |question about creator content for |quick one for whoever handles|curious who oversees creator|partnership opportunity|collaboration opportunity)/i;
const NUMBER = /(?<![\w.])\d+(?:\.\d+)?\s?[km](?![a-z])/gi;
const ROUTES = new Set(['linkedin-dm', 'email-published', 'email-consented', 'skip']);

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function jaccard(a, b) {
  const x = new Set(norm(a).split(' ').filter(Boolean));
  const y = new Set(norm(b).split(' ').filter(Boolean));
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
const numKey = (s) => s.toLowerCase().replace(/\s+/g, '');

const DAY = 86_400_000;

// yesDays: brand copy may name a creator only this long after their latest yes (the team meeting's rule).
// freshDays: a number may be quoted only this long after it was measured; a sheet figure is never measured.
// One definition for the lint and the finishing pass. A missing date, or one in the future (a typo), fails closed.
export function creatorStatus(c, today, { yesDays = 90, freshDays = 30 } = {}) {
  const now = Date.parse(today);
  const age = (s) => { const t = Date.parse(s || ''); return Number.isNaN(t) || Number.isNaN(now) ? NaN : (now - t) / DAY; };
  const yes = age(c?.yesAt);
  const at = age(c?.measuredAt);
  return {
    named: Boolean(c) && yes >= 0 && yes <= yesDays,
    fresh: Boolean(c) && c.numberSource === 'measured' && at >= 0 && at <= freshDays,
  };
}

export function lint(rows, roster, { today, noteMax = 200, maxAgeDays = 183, yesDays = 90, freshDays = 30 } = {}) {
  if (!today || Number.isNaN(Date.parse(today))) throw new Error('lint needs --today YYYY-MM-DD so the age check is reproducible');
  const now = Date.parse(today);
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const creators = (roster.creators || []).map((c) => {
    const all = [c.name, ...(c.aliases || [])].filter(Boolean);
    return {
      ...c,
      names: all.map(token).filter((t) => t.length >= 3),
      // Whole words only, so "Jay" never matches inside "Spear & Jayson".
      patterns: all.map((n) => new RegExp(`(^|[^a-z0-9])${esc(n)}($|[^a-z0-9])`, 'i')),
      numbers: new Set((c.numbers || []).map(numKey)),
    };
  });
  const findCreator = (name) => creators.find((c) => c.names.includes(token(name)));
  const errors = [];
  const warnings = [];
  const err = (row, rule, detail) => errors.push({ key: row.key, rule, detail });
  const warn = (row, rule, detail) => warnings.push({ key: row.key, rule, detail });
  const byBrand = new Map();

  for (const row of rows) {
    const route = row.route || '';
    if (!ROUTES.has(route)) { err(row, 'route-unknown', route || '(blank)'); continue; }
    if (route === 'skip') continue;
    const note = row.connectionNote || '';
    const dm = row.dm || '';
    const opener = row.emailOpener || '';
    const subject = row.subject || '';
    const text = [note, dm, opener, subject, row.bump || ''].join('\n');

    if (!note) err(row, 'note-empty', 'no connection note');
    if (note.length > noteMax) err(row, 'note-too-long', `${note.length} > ${noteMax} characters`);
    if (/https?:\/\/|www\./i.test(note)) err(row, 'link-in-note', 'a connection note never carries a link');
    if (/[@$£€]/.test(note)) err(row, 'note-has-handle-or-price', 'no address, handle or price in a connection note');
    if (note && !note.includes('?')) warn(row, 'note-no-question', 'ends without a question');
    if (!dm) err(row, 'dm-empty', 'no DM for after they accept');
    else {
      if (!CONSENT.test(dm)) err(row, 'dm-no-consent-ask', 'the DM must ask before emailing ("Mind if I email you a one-pager?")');
      if (dm.length > 600) err(row, 'dm-too-long', `${dm.length} > 600 characters`);
      if (!OPT_OUT.test(dm)) err(row, 'dm-no-opt-out', 'the DM gives an easy way out ("If this isn\'t your area, just say and I won\'t follow up")');
      if (/https?:\/\/|www\./i.test(dm)) err(row, 'link-in-dm', 'no link in the first message');
    }
    for (const b of BANNED) if (text.toLowerCase().includes(b)) err(row, 'banned-phrase', b);
    const claim = FIRST_PERSON.exec(text);
    if (claim && !(row.confirmedClaims || []).some((c) => claim[0].toLowerCase().includes(String(c).toLowerCase()))) err(row, 'unconfirmed-claim', claim[0]);

    // Numbers: every "24k" or "1.2m" must be one of the named creator's true numbers.
    const nums = (text.match(NUMBER) || []).map(numKey);
    const named = creators.filter((c) => c.patterns.some((p) => p.test(text)));
    if (named.length > 1) err(row, 'two-creators', named.map((c) => c.name).join(', '));
    const creator = findCreator(row.creator || '') || named[0];
    if (nums.length && !creator) err(row, 'number-without-creator', nums.join(', '));
    for (const n of nums) if (creator && !creator.numbers.has(n)) err(row, 'number-not-in-roster', `${n} is not a true number for ${creator.name}`);
    if (creator) {
      const st = creatorStatus(creator, today, { yesDays, freshDays });
      if (!st.named) err(row, 'creator-not-confirmed', `${creator.name} has no yes on record in the last ${yesDays} days`);
      if (nums.length && !st.fresh) err(row, 'number-not-fresh', `${creator.name}'s numbers were not measured in the last ${freshDays} days`);
    }

    // The hook: a real source and a recent date, or the row is honest about having none.
    const hook = row.hook || {};
    const sourced = /^https?:\/\//.test(hook.source || '') && !Number.isNaN(Date.parse(hook.date || ''));
    if (TIMING.test(text) && !(['season', 'launch', 'news'].includes(hook.type) && sourced)) err(row, 'unsourced-timing-claim', TIMING.exec(text)[0]);
    if (!hook.type || hook.type === 'none') {
      if ((row.confidence || '').toLowerCase() !== 'low') err(row, 'no-hook-not-low', 'without a hook the confidence must be Low');
    } else if (hook.type === 'value') {
      // An idea is not a fact: it needs no source, but it can never be High confidence.
      if ((row.confidence || '').toLowerCase() === 'high') err(row, 'idea-hook-high', 'an idea hook is at most Medium confidence');
    } else {
      if (!/^https?:\/\//.test(hook.source || '')) err(row, 'hook-without-source', hook.type);
      else if (BAD_SOURCE.test(hook.source)) err(row, 'hook-source-not-allowed', 'a LinkedIn page or a search page is not a source');
      const d = Date.parse(hook.date || '');
      const limit = MAX_AGE[hook.type] ?? maxAgeDays;
      if (Number.isNaN(d)) err(row, 'hook-without-date', hook.type);
      else if ((now - d) / DAY > limit) err(row, 'hook-stale', `${hook.date} is older than ${limit} days for a ${hook.type} hook`);
    }

    // The route: published address with its page, or recorded consent; never personal webmail.
    if (route === 'email-published') {
      if (!row.publishedAddress || !/^https?:\/\//.test(row.publishedSource || '')) err(row, 'published-without-source', row.publishedAddress || '(blank)');
      if (WEBMAIL.has(emailDomain(row.publishedAddress || ''))) err(row, 'webmail-address', row.publishedAddress);
    }
    if (route === 'email-consented' && String(row.consent || '').toLowerCase() !== 'yes') err(row, 'email-without-consent', 'a LinkedIn-found address needs a recorded yes');

    if (subject && subject.length > 60) err(row, 'subject-too-long', `${subject.length} > 60`);
    if (GENERIC_SUBJECT.test(subject)) err(row, 'generic-subject', subject);

    const list = byBrand.get(row.brand) || [];
    for (const other of list) {
      if (note && (norm(other.connectionNote) === norm(note) || jaccard(other.connectionNote, note) >= 0.8)) {
        err(row, 'same-note-as-colleague', `too close to the note for ${other.key}`);
        break;
      }
    }
    list.push(row);
    byBrand.set(row.brand, list);
  }
  return { errors, warnings, checked: rows.length };
}

export function report({ errors, warnings, checked }) {
  const count = (xs) => xs.reduce((m, e) => ((m[e.rule] = (m[e.rule] || 0) + 1), m), {});
  const lines = [`checked ${checked} rows · ${errors.length} errors · ${warnings.length} warnings`];
  for (const [k, v] of Object.entries(count(errors))) lines.push(`error ${k.padEnd(26)} ${v}`);
  for (const [k, v] of Object.entries(count(warnings))) lines.push(`warn  ${k.padEnd(26)} ${v}`);
  return lines.join('\n');
}

function main() {
  const a = args();
  if (!a.rows || !a.roster || !a.today) {
    console.error('usage: lint-lines.mjs --rows <rows.json> --roster <roster.json> --today YYYY-MM-DD [--note-max 200] [--max-age-days 183] [--yes-days 90] [--fresh-days 30] [--json]');
    process.exit(2);
  }
  const rows = JSON.parse(readFileSync(a.rows, 'utf8'));
  const roster = JSON.parse(readFileSync(a.roster, 'utf8'));
  const result = lint(rows, roster, { today: a.today, noteMax: Number(a['note-max'] || 200), maxAgeDays: Number(a['max-age-days'] || 183), yesDays: Number(a['yes-days'] || 90), freshDays: Number(a['fresh-days'] || 30) });
  console.log(a.json ? JSON.stringify(result, null, 2) : report(result));
  process.exit(result.errors.length ? 1 : 0);
}

if (isMain(import.meta.url)) main();
