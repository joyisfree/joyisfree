#!/usr/bin/env node
// Check 1 of the two checks on every brief (the guardian is check 2): is each line really this person's? Every
// line must cite evidence ids from this person's own pack (digest.mjs), and every quote must appear in that
// evidence word for word. It reads two files and writes nothing.
//
//   node agency-desk/scripts/provenance.mjs --brief <brief.json> --pack <evidence.json> [--guardian pass|veto]
//
// brief.json: { who: { handle | name, channelId? }, lines: [{ section, text, cites: [ids], quotes?, read?, audience?, ask? }] }
//   section: 'brief' (for Leif's eyes), or 'hook' | 'block' | 'note' | 'dm' (words that may reach the person).
//   read: true marks an interpretation, and its text starts "My read:". ask: true marks a question, which states no fact.
import { readFileSync } from 'node:fs';
import { args, isMain, ENGAGEMENT_LABEL } from './lib.mjs';

const OUR_SUM = ENGAGEMENT_LABEL.slice(ENGAGEMENT_LABEL.indexOf('(') + 1, -1); // "our calculation from YouTube data"
const OUTBOUND = new Set(['hook', 'block', 'note', 'dm']);
const GUESS = /\b(?:seems?|seemingly|probably|likely|i think|i suspect|suggests?|looks like|appears? to|my guess|may be|might be)\b/i;
const PAID = /\b(?:partner(?:ed|s|ship|ships|ing)?|sponsor(?:ed|s|ship|ing)?|paid (?:deal|promotion|partnership)|ambassador)\b/i;
const PAID_KINDS = new Set(['sponsor', 'standing', 'paid']);
const QUOTED = /"([^"\n]{12,})"|“([^”\n]{12,})”/g;
const FIGURE = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(k\b|m\b|%|views?\b|subs\b|subscribers\b|followers\b)?/gi;

const flat = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const wordsOf = (s) => flat(s).match(/[a-z0-9']+/g) || [];
const same = (a, b) => Boolean(a) && Boolean(b) && flat(a) === flat(b);

function sharesRun(text, source, n = 6) {
  const a = wordsOf(text);
  const grams = new Set();
  const b = wordsOf(source);
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= a.length; i++) if (grams.has(a.slice(i, i + n).join(' '))) return true;
  return false;
}

function hasFigure(text) {
  for (const m of String(text).matchAll(FIGURE)) {
    if (m[2]) return true;
    const v = Number(m[1].replace(/,/g, ''));
    if (v >= 1000 && !(v >= 1900 && v <= 2099 && !m[1].includes(','))) return true;
  }
  return false;
}

export function checkBrief(brief, pack) {
  const errors = [];
  const err = (line, rule, detail) => errors.push({ line, rule, detail });
  const lines = brief?.lines || [];
  const who = brief?.who || {};
  const mine = pack?.who || {};
  const samePerson = who.channelId && mine.channelId ? who.channelId === mine.channelId
    : same(who.handle, mine.handle) || same(who.name, mine.name) || same(who.name, mine.title);
  if (!samePerson) {
    return { ok: false, canDoubleTick: false, errors: [{ line: null, rule: 'wrong-person', detail: 'this brief and this evidence are not about the same person' }], single: [], checked: lines.length };
  }
  const byId = new Map((pack.items || []).map((i) => [i.id, i]));
  const single = [];

  lines.forEach((l, n) => {
    const text = String(l.text || '');
    const cites = l.cites || [];
    if (!cites.length) {
      if (!l.ask) err(n, 'no-evidence', 'a line that states something names the evidence it came from');
      return;
    }
    const found = [];
    for (const id of cites) { const it = byId.get(id); if (it) found.push(it); else err(n, 'unknown-id', `${id} is not in this person's evidence`); }

    const quotes = [...(l.quotes || []), ...[...text.matchAll(QUOTED)].map((m) => m[1] || m[2])];
    let postQuoted = false;
    for (const q of quotes) {
      const hits = found.filter((it) => flat(it.text).includes(flat(q)));
      if (!hits.length) { err(n, 'quote-not-found', `"${q.slice(0, 60)}" is not in the evidence this line cites, word for word`); continue; }
      if (hits.some((it) => it.kind === 'post')) { postQuoted = true; err(n, 'post-quoted', 'a LinkedIn post is referred to by its topic, never quoted'); continue; }
      if (hits.every((it) => it.quotable === false)) { err(n, 'not-quotable', 'a search result is a pointer to a video, never a quote'); continue; }
      if (hits.every((it) => it.owner !== 'self') && !l.audience) err(n, 'fan-quoted-as-theirs', "a viewer's words are quoted as viewers' words (audience: true), never as the creator's");
    }
    for (const it of found) if (it.kind === 'mention' && it.confirmed !== true) err(n, 'mention-unconfirmed', `${it.id}: the video's own title or description must name the brand first`);
    if (!postQuoted && found.some((it) => it.kind === 'post' && sharesRun(text, it.text))) err(n, 'post-quoted', 'six of their words in a row is a quote: say what the post was about instead');
    if (OUTBOUND.has(l.section) && found.some((it) => it.never)) err(n, 'never-a-hook', 'health, family hardship, children, religion, politics and money troubles never open a message');

    const labelled = /^my read:/i.test(text.trim());
    if (Boolean(l.read) !== labelled) err(n, 'unlabelled-read', 'an interpretation starts "My read:" and is marked read: true');
    else if (!l.read && GUESS.test(text)) err(n, 'unlabelled-read', `"${GUESS.exec(text)[0]}" is an interpretation: label it "My read:"`);
    if (PAID.test(text) && !found.some((it) => PAID_KINDS.has(it.kind))) err(n, 'partnered-without-proof', 'a paid deal needs a sponsor line or YouTube\'s paid flag; otherwise say "featured"');
    if (/engagement/i.test(text) && !flat(text).includes(flat(OUR_SUM))) err(n, 'engagement-unlabelled', `an engagement rate is always labelled "${ENGAGEMENT_LABEL}"`);
    if (hasFigure(text)) err(n, 'figure-in-line', 'figures come from the Numbers the script writes, never from a written line');
    if (mine.kind === 'brand' && !mine.matched && found.some((it) => it.kind !== 'mention')) err(n, 'brand-channel-unmatched', "this channel was not matched to the brand's own domain or handle");

    if (found.length && found.every((it) => it.source === 'screenshot')) {
      single.push(n);
      if (l.ticks === '✓✓') err(n, 'screenshot-double-tick', 'a detail seen only in a screenshot gets one tick at most');
    }
  });
  if (single.length && brief.ticks === '✓✓') err(null, 'screenshot-double-tick', 'a brief with screenshot-only details gets one tick at most');
  return { ok: errors.length === 0, canDoubleTick: errors.length === 0 && single.length === 0, errors, single, checked: lines.length };
}

// Two ticks need both checks: this script, then the guardian's read. A veto, or any error here, is a cross.
export function ticks(result, guardian) {
  if (!result.ok || guardian === 'veto') return '✗';
  return guardian === 'pass' && result.canDoubleTick ? '✓✓' : '✓';
}

function main() {
  const a = args();
  if (!a.brief || !a.pack) { console.error('usage: provenance.mjs --brief <brief.json> --pack <evidence.json> [--guardian pass|veto]'); process.exit(2); }
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const r = checkBrief(read(a.brief), read(a.pack));
  for (const e of r.errors) console.log(`  ${e.line === null ? 'brief' : `line ${e.line + 1}`}  ${e.rule}  ${e.detail}`);
  console.log(`checked ${r.checked} lines · ${r.errors.length} errors · ${ticks(r, a.guardian)}${r.single.length ? ` · ${r.single.length} screenshot-only` : ''}`);
  process.exit(r.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
