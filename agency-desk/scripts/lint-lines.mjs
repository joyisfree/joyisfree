#!/usr/bin/env node
// The copy gate: every note, DM, opener and subject must be short, true, sourced, legal and Leif's own voice.
// Exit 1 on any error, so a bad line cannot reach the pack.
//
//   node agency-desk/scripts/lint-lines.mjs --rows <rows.json> --roster <roster.json> --today YYYY-MM-DD
//        [--note-max 200] [--max-age-days 183] [--postal "<the postal line>"] [--json]
import { readFileSync } from 'node:fs';
import { args, isMain, emailDomain, WEBMAIL } from './lib.mjs';

export const BANNED = [
  'stoked with', 'game changer', 'game-changer', 'hope this finds you', 'hope this email finds you', 'hope you are well',
  'touch base', 'circle back', 'synergy', 'love what you guys stand for', 'i came across your profile', 'revolutionize',
  'leverage our', 'just following up', 'just checking in', 'guaranteed', 'go viral', '10x your', 'apple of smart home',
  'positive energy',
];
// How long a hook stays true enough to quote, by kind (days from the event or publish date, never the read date).
export const MAX_AGE = { sponsor: 548, launch: 183, news: 183, season: 400, role: 365, value: 400, warm: 365, post: 183 };
export const NOTE_MAX = 200; // a connection note is 200 characters at most
export const DM_MAX = 600;
// "my huge property", "my 250 year old heritage house": up to four words may sit between the pronoun and the thing
// claimed. "My roster is home and garden YouTubers" is about the creators, not Leif's life, so it never matches.
export const FIRST_PERSON = /\b((my|our) (?:(?!(?:roster|creators?|channels?|clients|team|are|is|make|makes|cover|covers|home|and|garden|diy)\b)[a-z0-9'-]+ ){0,4}(house|home|property|land|kids?|wife|husband|garden|shop|office|backyard|place|balcony|cafe|offices)(?! and garden|,? garden| and diy|-garden| improvement)|we're running|i (own|bought|use|have been using)|wife|husband|my kid'?s)\b/i;
// "brands plan spring creators about now" is a claim about the calendar: it needs a sourced season, launch or news hook.
export const TIMING = /\b(about now|right now is when|lines? up (their |its )?(spring|creators|creator)|plan(s|ning)? (their |its )?(spring|summer|2027|creators|creator)|budgets? (are|get|is) (set|locked)|lock(ing)? in (their |its )?(spring|creators)|now'?s (a )?good time|this time of year)\b/i;
const CONSENT = /\b(mind if i (send|email|share|pop)|ok(ay)? (if|to) i? ?(send|email)|ok(ay)? to (send|email)|can i (send|email)|happy for me to (send|email|share)|shall i (send|email)|want me to (send|email)|would it be ok(ay)? (if i|to) (send|email)|(want|like) the one-pager|here or by email)/i;
// A LinkedIn DM may itself be a commercial electronic message under the Spam Act: it carries an easy way out.
const OPT_OUT = /(not your area|not the right person|rather not hear|won'?t follow up|no worries if not|say so and i|just say and i|i'?ll leave it there|happy to leave it)/i;
// A search page, a channel's own search page and a feed show whatever matches today: none is a page a hook can cite.
const BAD_SOURCE = /(^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/|google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/\?|youtube\.com\/(results\b|feeds\/|([^?#\s]*\/)?search\b))/i;
const GENERIC_SUBJECT = /^(creators (and influencers )?for |question about creator content for |quick one for whoever handles|curious who oversees creator|partnership opportunity|collaboration opportunity)/i;
const NUMBER = /(?<![\w.])\d+(?:\.\d+)?\s?[km](?![a-z])/gi;
// A view, subscriber, follower, percentage or money figure, in the ways one gets written. A first message carries
// none: they wait for the one-pager. A year ("spring 2027"), a quarter ("Q1") and a plain count ("3 ideas") are fine.
const N = String.raw`\d+(?:[.,]\d+)*`;
const AUDIENCE = String.raw`(?:views?|viewers?|subscribers?|subs|followers?)\b`;
const FIGURE = new RegExp([
  NUMBER.source, // 24k, 1.2m
  String.raw`${N}\s?(?:thousand|million|billion)\b`, // 190 thousand
  String.raw`(?<![\w.,])\d{1,3}(?:,\d{3})+`, // 24,000
  String.raw`(?<![\w.,])${N}\+?[\s-]${AUDIENCE}`, // 800 subscribers
  String.raw`\b(?:hundred|thousand|million|billion)s?[\s-](?:[a-z]+\s){0,2}${AUDIENCE}`, // half a million followers
  String.raw`${N}\s?(?:%|per ?cent\b)`, // 12%
  String.raw`[$£€]\s?${N}|${N}\s?(?:dollars?|bucks|euros?|usd|aud)\b`, // $500
].join('|'), 'gi');
// A date read from a relative age ("3w") is a range, so the copy may not name a month. "May" counts only as a
// capitalised word inside a sentence, so "this may not be your area" is never a month.
const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
const MAY = /(?<=[a-z,] )May\b/;
const ROUTES = new Set(['linkedin-dm', 'email-published', 'email-consented', 'skip']);
const STEPS = new Set(['DM now', 'Invite + note', 'Invite', 'Wait']);
// A note travels only with an invitation that carries one. A row with no next step yet keeps its note until a
// later step assigns one. One definition for the lint and the finishing pass.
export const wantsNote = (row) => !row.nextStep || row.nextStep === 'Invite + note';

// The law a recipient's country brings to a message: Canada's CASL, the US's CAN-SPAM, or none. One definition
// for the emails and the LinkedIn rows.
export function countryLaw(country) {
  const c = String(country || '').trim().toLowerCase();
  return /^(us|usa|united states( of america)?)$/.test(c) ? 'CAN-SPAM' : /^(ca|canada)$/.test(c) ? 'CASL' : '';
}

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
// Two colleagues' lines are the same line when they match, or share four words in five.
const close = (a, b) => norm(a) === norm(b) || jaccard(a, b) >= 0.8;
// What is personal in a DM: everything but the opt-out and the sign-off, which every colleague's DM shares.
const personal = (dm) => sentences(dm).filter((s) => !OPT_OUT.test(s) && !/^leif\b/i.test(s)).join(' ');
// Two colleagues stand on the same detail when both carry the same evidence id, or failing that the same link.
const sameHook = (a, b) => (a.evidence && b.evidence ? String(a.evidence) === String(b.evidence) : /^https?:\/\//.test(a.source || '') && a.source === b.source);
// The first run of six words lifted from a post into the copy, or '' when the post is only referred to.
function quoted(post, copy) {
  const w = norm(post).split(' ').filter(Boolean);
  const said = ` ${norm(copy)} `;
  for (let i = 0; i + 6 <= w.length; i++) {
    const run = w.slice(i, i + 6).join(' ');
    if (said.includes(` ${run} `)) return run;
  }
  return '';
}

const DAY = 86_400_000;

// yesDays: brand copy may name a creator only this long after their latest yes (the team meeting's rule).
// freshDays: a number may be quoted only this long after it was measured; a sheet figure is never measured.
// A first message now carries neither, so the row lint no longer asks: this is the one definition for the one-pager
// and the emails. A missing date, or one in the future (a typo), fails closed.
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

// The result's holds are rows that are fine as written but must wait (see the country hold below): not errors.
export function lint(rows, roster, { today, noteMax = NOTE_MAX, maxAgeDays = 183, postal = '' } = {}) {
  if (!today || Number.isNaN(Date.parse(today))) throw new Error('lint needs --today YYYY-MM-DD so the age check is reproducible');
  const now = Date.parse(today);
  const line = String(postal || '').trim();
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // Whole words only, so "Jay" never matches inside "Spear & Jayson".
  const creators = (roster.creators || []).map((c) => ({
    name: c.name,
    patterns: [c.name, ...(c.aliases || [])].filter(Boolean).map((n) => new RegExp(`(^|[^a-z0-9])${esc(n)}($|[^a-z0-9])`, 'i')),
  }));
  const errors = [];
  const warnings = [];
  const holds = [];
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
    const bump = row.bump || '';
    const text = [note, dm, opener, subject, bump].join('\n');
    const sent = [note, dm, bump].join('\n'); // what reaches them on LinkedIn

    if (row.nextStep && !STEPS.has(row.nextStep)) err(row, 'next-step-unknown', row.nextStep);
    if (!note && wantsNote(row)) err(row, 'note-empty', 'no connection note');
    if (note.length > noteMax) err(row, 'note-too-long', `${note.length} > ${noteMax} characters`);
    if (/https?:\/\/|www\./i.test(note)) err(row, 'link-in-note', 'a connection note never carries a link');
    if (/[@$£€]/.test(note)) err(row, 'note-has-handle-or-price', 'no address, handle or price in a connection note');
    if (note && !OPT_OUT.test(note)) err(row, 'note-no-opt-out', 'a note gives an easy way out too ("No worries if not.")');
    if (note && !note.includes('?')) warn(row, 'note-no-question', 'ends without a question');
    if (!dm) err(row, 'dm-empty', 'no DM for after they accept');
    else {
      // One question, and it is the consent ask: a second question reads like a template.
      const asked = (dm.match(/\?/g) || []).length;
      if (asked !== 1) err(row, 'dm-questions', `${asked} questions: the DM asks exactly one`);
      if (!sentences(dm).some((s) => s.includes('?') && CONSENT.test(s))) err(row, 'dm-no-consent-ask', 'the DM\'s question must ask before emailing ("Mind if I email you a one-pager?")');
      if (dm.length > DM_MAX) err(row, 'dm-too-long', `${dm.length} > ${DM_MAX} characters`);
      if (!OPT_OUT.test(dm)) err(row, 'dm-no-opt-out', 'the DM gives an easy way out ("If this isn\'t your area, just say and I won\'t follow up")');
      if (!/\bleif\b/i.test(dm) || !/\bjoyisfree studio\b/i.test(dm)) err(row, 'dm-no-sender', 'the DM names its sender ("Leif, Joyisfree Studio")');
      if (/https?:\/\/|www\./i.test(dm)) err(row, 'link-in-dm', 'no link in the first message');
    }
    for (const b of BANNED) if (text.toLowerCase().includes(b)) err(row, 'banned-phrase', b);
    const claim = FIRST_PERSON.exec(text);
    if (claim && !(row.confirmedClaims || []).some((c) => claim[0].toLowerCase().includes(String(c).toLowerCase()))) err(row, 'unconfirmed-claim', claim[0]);

    // No figure and no creator in a first message, even a creator who said yes: both wait for the one-pager.
    const figures = [...new Set((text.match(FIGURE) || []).map((x) => x.trim().toLowerCase()))];
    if (figures.length) err(row, 'number-in-message', figures.join(', '));
    const named = creators.filter((c) => c.patterns.some((p) => p.test(text)));
    if (named.length) err(row, 'creator-in-message', named.map((c) => c.name).join(', '));

    // The hook: a real source and a recent date, or the row is honest about having none.
    const hook = row.hook || {};
    const confidence = (row.confidence || '').toLowerCase();
    const sourced = /^https?:\/\//.test(hook.source || '') && !Number.isNaN(Date.parse(hook.date || ''));
    if (TIMING.test(text) && !(['season', 'launch', 'news'].includes(hook.type) && sourced)) err(row, 'unsourced-timing-claim', TIMING.exec(text)[0]);
    if (!hook.type || hook.type === 'none') {
      if (confidence !== 'low') err(row, 'no-hook-not-low', 'without a hook the confidence must be Low');
    } else if (hook.type === 'value') {
      // An idea is not a fact: it needs no source, but it can never be High confidence.
      if (confidence === 'high') err(row, 'idea-hook-high', 'an idea hook is at most Medium confidence');
    } else {
      if (hook.type === 'post') {
        // Their own LinkedIn post, which Leif pastes. It has no link to check, so it is referred to by its topic
        // and never quoted, and a screenshot (which cannot be checked twice) is never High confidence.
        if (!['paste', 'screenshot'].includes(hook.source)) err(row, hook.source ? 'hook-source-not-allowed' : 'hook-without-source', 'a post hook is a paste or a screenshot, never a link');
        if (!hook.topic) err(row, 'hook-without-topic', 'a post is referred to by its topic');
        if (hook.source === 'screenshot' && confidence === 'high') err(row, 'screenshot-hook-high', 'a screenshot is at most Medium confidence');
        const run = quoted(hook.text, sent);
        if (run) err(row, 'post-quoted', `"${run}": refer to the post by its topic`);
      } else if (!/^https?:\/\//.test(hook.source || '')) err(row, 'hook-without-source', hook.type);
      else if (BAD_SOURCE.test(hook.source)) err(row, 'hook-source-not-allowed', 'a LinkedIn page, a search page or a feed is not a source');
      const d = Date.parse(hook.date || '');
      const limit = MAX_AGE[hook.type] ?? maxAgeDays;
      if (Number.isNaN(d)) err(row, 'hook-without-date', hook.type);
      else if ((now - d) / DAY > limit) err(row, 'hook-stale', `${hook.date} is older than ${limit} days for a ${hook.type} hook`);
    }
    const month = hook.approx ? MONTH.exec(sent) || MAY.exec(sent) : null;
    if (month) err(row, 'month-from-relative-age', `"${month[0]}": the date came from a relative age, so name no month`);

    // The route: published address with its page, or recorded consent; never personal webmail.
    if (route === 'email-published') {
      if (!row.publishedAddress || !/^https?:\/\//.test(row.publishedSource || '')) err(row, 'published-without-source', row.publishedAddress || '(blank)');
      if (WEBMAIL.has(emailDomain(row.publishedAddress || ''))) err(row, 'webmail-address', row.publishedAddress);
    }
    if (route === 'email-consented' && String(row.consent || '').toLowerCase() !== 'yes') err(row, 'email-without-consent', 'a LinkedIn-found address needs a recorded yes');

    if (subject && subject.length > 60) err(row, 'subject-too-long', `${subject.length} > 60`);
    if (GENERIC_SUBJECT.test(subject)) err(row, 'generic-subject', subject);

    // Canada's CASL covers a LinkedIn message, so a Canadian row waits for the postal line, and so does a row whose
    // country nobody knows yet. CAN-SPAM covers email only, so a US row goes. The row is held, not failed.
    if (route === 'linkedin-dm') {
      const country = String(row.country || '').trim();
      const canada = countryLaw(country) === 'CASL';
      if ((canada || !country || /^(unknown|\?+)$/i.test(country)) && !(line && dm.includes(line) && (!note || note.includes(line)))) {
        holds.push({ key: row.key, rule: 'country-hold', detail: canada ? 'Canadian recipient: the message needs the postal line (CASL)' : 'check the country first: a Canadian recipient needs the postal line' });
      }
    }

    // Colleagues compare what they were sent: each gets a note, a DM and a detail of their own.
    const list = byBrand.get(row.brand) || [];
    const noteTwin = list.find((o) => note && close(o.connectionNote, note));
    if (noteTwin) err(row, 'same-note-as-colleague', `too close to the note for ${noteTwin.key}`);
    const dmTwin = list.find((o) => dm && o.dm && close(personal(o.dm), personal(dm)));
    if (dmTwin) err(row, 'same-dm-as-colleague', `too close to the DM for ${dmTwin.key}`);
    const hookTwin = list.find((o) => sameHook(o.hook || {}, hook));
    if (hookTwin) err(row, 'same-hook-as-colleague', `the same detail as ${hookTwin.key}`);
    list.push(row);
    byBrand.set(row.brand, list);
  }
  return { errors, warnings, holds, checked: rows.length };
}

// The email voice, from Leif's own sent mail (the May and June creator emails that got replies) and his 10 Nov rule:
// "like a friend texting, no signatures that are cooked". 40 to 70 words, one true detail, one question, a short
// opt-out, signed "Leif" (and "Joyisfree Studio" in a first email, so the sender is identified under the Spam Act).
const EMAIL_OPT_OUT = /(rather i (stop|didn'?t)|say the word and i'?ll stop|won'?t email (you )?again|no reply needed|just say and i'?ll stop|if not,? just say|happy to stop)/i;
const SIGNATURE = /(kind regards|best regards|warm(est)? regards|regards,|sincerely|best wishes|many thanks,|sent from my|^--\s*$|unsubscribe)/im;
const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|au|uk|us|online|studio)(\b|\/)/i;
const PHONE = /\+?\d[\d ()-]{7,}\d/;
const SUBJECT_TAG = /\[[A-Z][A-Z ]{2,}(:[^\]]*)?\]/;
const POSTAL = /\b(p\.?\s?o\.?\s?box|gpo box|locked bag)\b/i;
const DATE_PROMISE = /\b(i'?ll|i will|we'?ll|we will)\b[^.?!\n]*\b(by|on|before|next|this|in|until)\s+(the end of |early |mid |late )?((mon|tues|wednes|thurs|fri|satur|sun)day|january|february|march|april|june|july|august|september|october|november|december|next week|tomorrow|the weekend)\b/i;
const HAGGLE = /\b(drop|lower|reduce|bring down|knock down)\b[^.?!\n]{0,20}\b(rate|price|fee)s?\b|\b(best|lowest) (rate|price)\b|\bdiscount\b/i;
const words = (s) => (String(s || '').match(/[a-z0-9][a-z0-9'’]*/gi) || []).length;
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

// One email: { key, subject, body, first, us (true, false, or unknown), holds, allowNumbers, confirmedClaims }.
// The folder is "Fix first" while any error remains, "On hold" while any hold remains, else "Ready to send".
export function lintEmail(e, { postal = '', minWords = 40, maxWords = 70 } = {}) {
  const errors = [];
  const warnings = [];
  const err = (rule, detail) => errors.push({ key: e.key, rule, detail });
  const warn = (rule, detail) => warnings.push({ key: e.key, rule, detail });
  const body = String(e.body || '');
  const subject = String(e.subject || '');
  const n = words(body);
  if (n > maxWords) err('too-long', `${n} words > ${maxWords}`);
  if (n < minWords) warn('short', `${n} words < ${minWords}`);
  const q = (body.match(/\?/g) || []).length;
  if (q === 0) err('no-question', 'one easy question, so it is easy to reply');
  if (q > 1) err('more-than-one-question', `${q} questions; keep one`);
  if (!EMAIL_OPT_OUT.test(body)) err('no-opt-out', 'end with a short way out ("Just say if you\'d rather I stop.")');
  const postalLine = (l) => (postal ? l === postal.trim() : POSTAL.test(l));
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  while (lines.length && postalLine(lines.at(-1))) lines.pop();
  if (!/^leif\b/i.test(lines.at(-1) || '')) err('no-sender', 'sign off "Leif"');
  if (e.first && !/joyisfree/i.test(body)) err('first-email-no-studio', 'a first email names Joyisfree Studio');
  if (SIGNATURE.test(body)) err('signature', SIGNATURE.exec(body)[0].trim());
  if (LINK.test(body)) err('link', 'no links in the email');
  if (PHONE.test(body)) err('phone-number', 'no phone number or footer');
  for (const b of BANNED) if (`${subject}\n${body}`.toLowerCase().includes(b)) err('banned-phrase', b);
  const claim = FIRST_PERSON.exec(body);
  if (claim && !(e.confirmedClaims || []).some((c) => claim[0].toLowerCase().includes(String(c).toLowerCase()))) err('unconfirmed-claim', claim[0]);
  const allowed = new Set((e.allowNumbers || []).map(numKey));
  for (const x of (body.match(NUMBER) || []).map(numKey)) if (!allowed.has(x)) err('number-not-fresh', `${x}: quote a number only from a measurement in the last 30 days`);
  if (SUBJECT_TAG.test(subject)) err('subject-tag', SUBJECT_TAG.exec(subject)[0]);
  // A reply keeps its thread's own "Re:" subject, whatever its length, so the thread never splits.
  if (!/^re:/i.test(subject) && subject.length > 60) err('subject-too-long', `${subject.length} > 60`);
  if (!/^re:/i.test(subject) && GENERIC_SUBJECT.test(subject)) err('generic-subject', subject);
  if (DATE_PROMISE.test(body)) warn('date-promise', `${DATE_PROMISE.exec(body)[0]}: add a tracker promise with its due date`);
  if (HAGGLE.test(body)) warn('haggle-before-brief', HAGGLE.exec(body)[0]);

  const hold = [...(e.holds || [])];
  // The US (CAN-SPAM) and Canada (CASL) want the sender's postal address in the email itself.
  const law = e.us === true ? 'CAN-SPAM' : countryLaw(e.country);
  const known = Boolean(String(e.country || '').trim()) || e.us === true || e.us === false;
  if (law && !(postal ? body.includes(postal.trim()) : POSTAL.test(body))) hold.push(`${law === 'CASL' ? 'Canadian' : 'US'} recipient: needs the postal line (${law})`);
  if (!known) hold.push('check the country first: a US or Canadian recipient needs the postal line');
  const folder = errors.length ? 'Fix first' : hold.length ? 'On hold' : 'Ready to send';
  return { key: e.key, errors, warnings, hold, folder };
}

// A run's emails together: each one alone, then no copy-paste middle sentence and no subject formula used twice.
// The question and the opt-out may repeat: they are the ask and the legal line, not the personal part.
export function lintEmails(list, opts = {}) {
  const results = list.map((e) => lintEmail(e, opts));
  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);
  const middle = new Map();
  const subjects = new Map();
  for (const e of list) {
    for (const s of sentences(e.body)) {
      if (words(s) < 8 || s.endsWith('?') || EMAIL_OPT_OUT.test(s) || /^leif\b/i.test(s)) continue;
      const k = norm(s);
      if (middle.has(k) && middle.get(k) !== e.key) errors.push({ key: e.key, rule: 'copy-paste-line', detail: `same sentence as the email for ${middle.get(k)}` });
      else middle.set(k, e.key);
    }
    const subj = String(e.subject || '');
    if (!/^re:/i.test(subj)) {
      const k = norm(subj).split(' ').slice(0, 3).join(' ');
      if (k && subjects.has(k)) warnings.push({ key: e.key, rule: 'same-subject-formula', detail: `starts like the subject for ${subjects.get(k)}` });
      else if (k) subjects.set(k, e.key);
    }
  }
  for (const r of results) if (errors.some((x) => x.key === r.key)) r.folder = 'Fix first';
  return { errors, warnings, results, checked: list.length };
}

export function report({ errors, warnings, holds, checked, results }, unit = 'rows') {
  const count = (xs) => xs.reduce((m, e) => ((m[e.rule] = (m[e.rule] || 0) + 1), m), {});
  const lines = [`checked ${checked} ${unit} · ${errors.length} errors · ${warnings.length} warnings${holds ? ` · ${holds.length} held` : ''}`];
  if (results) lines.push(Object.entries(results.reduce((m, r) => ((m[r.folder] = (m[r.folder] || 0) + 1), m), {})).map(([f, c]) => `${f} ${c}`).join(' · '));
  for (const [k, v] of Object.entries(count(errors))) lines.push(`error ${k.padEnd(26)} ${v}`);
  for (const [k, v] of Object.entries(count(warnings))) lines.push(`warn  ${k.padEnd(26)} ${v}`);
  return lines.join('\n');
}

function main() {
  const a = args();
  if (a.emails) {
    // node lint-lines.mjs --emails <emails.json> [--postal "<the postal line>"] [--json]
    const result = lintEmails(JSON.parse(readFileSync(a.emails, 'utf8')), { postal: typeof a.postal === 'string' ? a.postal : '' });
    console.log(a.json ? JSON.stringify(result, null, 2) : report(result, 'emails'));
    process.exit(result.errors.length ? 1 : 0);
  }
  if (!a.rows || !a.roster || !a.today) {
    console.error('usage: lint-lines.mjs --rows <rows.json> --roster <roster.json> --today YYYY-MM-DD [--note-max 200] [--max-age-days 183] [--postal "<the postal line>"] [--json]');
    process.exit(2);
  }
  const rows = JSON.parse(readFileSync(a.rows, 'utf8'));
  const roster = JSON.parse(readFileSync(a.roster, 'utf8'));
  const result = lint(rows, roster, { today: a.today, noteMax: Number(a['note-max'] || NOTE_MAX), maxAgeDays: Number(a['max-age-days'] || 183), postal: typeof a.postal === 'string' ? a.postal : '' });
  console.log(a.json ? JSON.stringify(result, null, 2) : report(result));
  process.exit(result.errors.length ? 1 : 0);
}

if (isMain(import.meta.url)) main();
