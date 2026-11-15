#!/usr/bin/env node
// The finishing pass. Every row the team wrote either passes the lint as written or becomes an honest role check
// ("if creator partnerships are yours, want a one-pager?") that names no creator and quotes no number. Rows that
// must not be messaged become skips with the reason, a row whose country is Canada or unknown waits (a bare invite
// can still go), and the Today list takes only rows with nothing blocking them.
//
// It always starts again from the team's own rows, so when a country becomes known or the postal line arrives, the
// copy the team wrote is still there on the next run.
//
// Private facts come from --config, a JSON file kept outside the repository:
//   { "warmThread": { "<brand id>": "<who>" }, "hold": ["<brand id>"], "wrongCompany": { "<brand id>": "<why>" },
//     "waitFor": { "<brand id>": "<what the lane waits for>" },
//     "country": { "<brand id>": "<country>" }, "personCountry": { "<Brand | Name>": "<country>" } }
//
//   node agency-desk/scripts/finalise.mjs (--run <team output.json> | --rows <team rows.json>) --worklist <worklist.json>
//        --roster <roster.public.json> --config <finalise.json> --today YYYY-MM-DD --out <rows.json>
//        [--today-csv <today.csv>] [--today-max 10] [--postal "<the postal line>"]
import { readFileSync, writeFileSync } from 'node:fs';
import { args, isMain, assertOutsideRepo, toCSV } from './lib.mjs';
import { lint, report, wantsNote, NOTE_MAX, DM_MAX } from './lint-lines.mjs';
// A row carrying any of these flags stays in the pack but never reaches Today. "waits:" comes from the private
// config's waitFor list (a lane that waits for the right creator); "confirm creator first" is the team's own hold.
export const BLOCK = ['no honest fit', 'address at another company', 'wrong company', 'warm brand', 'invalid', 'waits:', 'confirm creator first', 'before pitching'];
export const MAX_PER_BRAND = 5; // the sixth person at a brand waits until one of the first five answers

// Five variants of each line, so up to five colleagues at one brand never get the same note or the same DM. The
// brand is always written " at {b}", so a line still reads when a brand too long for it is left out.
const NOTES = [
  'Hi {f}, I run Joyisfree Studio, a small agency for home and garden YouTube creators. Do you look after creator partnerships at {b}? No worries if not.',
  "Hi {f}, I match home and garden YouTube creators with brands that fit them. Are creator partnerships at {b} yours? If it's not your area, no worries.",
  'Hi {f}, I work with home, garden and DIY creators on YouTube. Is creator work at {b} part of your role? Happy to leave it if not.',
  "Hi {f}, Leif here. I place home and garden YouTubers with brands. Is creator work at {b} yours, or a colleague's? No worries if not.",
  "Hi {f}, my agency works with DIY, home and garden YouTube channels. Who handles creator partnerships at {b}? If it's not you, I'll leave it there.",
];
const OPEN = ['Thanks for connecting, {f}.', 'Good to connect, {f}.', 'Thanks for accepting, {f}.', 'Hi {f}, thanks for connecting.', 'Glad we connected, {f}.'];
const MIDDLE = [
  'I match home and garden YouTube creators with brands that fit them.',
  'I help home and garden brands find YouTube creators who fit.',
  'I manage home and garden YouTube creators and only pitch where one genuinely fits.',
  'I work with home, garden and DIY creators on YouTube.',
  'I run a small agency for home and garden YouTube creators.',
];
// The one question: it checks the role and asks before anything is sent, so there is never a second ask.
const ASK = [
  'If creator partnerships at {b} are yours, want a one-pager here or by email?',
  'If you look after creator work at {b}, mind if I send you a one-pager?',
  'If creator partnerships at {b} sit with you, can I send a one-pager here?',
  'If YouTube creators are part of your role at {b}, would you like a one-pager here or by email?',
  "If you're the right person for creator partnerships at {b}, shall I send a one-pager?",
];
const OUT = "If this isn't your area, just say and I won't follow up. Leif, Joyisfree Studio";
const fill = (t, f, b) => t.replaceAll('{f}', f).replaceAll('{b}', b);
// The fullest version that fits the limit: with the brand, then without it, then without the first name either.
const within = (max, t, f, b) => {
  const bare = t.replaceAll(' at {b}', '');
  return [fill(t, f, b), fill(bare, f, b), fill(bare, 'there', b)].find((x) => x.length <= max);
};

export function firstName(name) {
  const n = String(name || '').replace(/[^A-Za-zÀ-ɏ' -]/g, '').trim().split(/\s+/)[0];
  return n || 'there';
}

// The honest fallback, for a row with no true, dated detail to stand on: who Leif is, one question that is also
// the consent ask, the way out and the sender. It names no creator and quotes no number, whatever the roster says:
// those wait for the one-pager, after a yes.
export function roleCheck(row, brand, i, { rule = '', noHonestFit = '' } = {}) {
  const f = firstName(row.name);
  const b = brand.label;
  const v = ((i % NOTES.length) + NOTES.length) % NOTES.length;
  const middle = rule === 'us-only' ? "I'm adding US creators for spring and will only come back with one who fits." : MIDDLE[v];
  // Drop review notes and any earlier rewrite's own flags, so a row rewritten twice does not carry them twice.
  const flags = (row.flags || []).filter((x) => !/^(guardian|pilot critic|panel|honest role check|rewritten:|no honest fit:)/.test(x));
  if (noHonestFit) flags.push(`no honest fit: ${String(noHonestFit).slice(0, 80)}`);
  flags.push('honest role check (no dated hook to stand on yet)');
  return {
    ...row,
    connectionNote: wantsNote(row) ? within(NOTE_MAX, NOTES[v], f, b) : '', // a bare invite carries no note
    dm: within(DM_MAX, [OPEN[v], middle, ASK[v], OUT].join(' '), f, b),
    emailOpener: 'Thanks for saying yes on LinkedIn. Here is the one-pager I mentioned.',
    subject: `For ${b}: our creator one-pager`.slice(0, 60),
    hook: { type: 'none', text: `role check, opener ${v + 1}` }, confidence: 'Low', flags, // the opener number feeds the reply scoreboard
  };
}

const skipRow = (key, reason, flag) => ({ key, route: 'skip', skipReason: reason, hook: { type: 'none' }, confidence: 'Low', contactOrder: 9, wave: 9, flags: [flag] });

// postal: Leif's postal line, when he has one. connected: the keys of people he is already connected to.
export function finalise({ rows: teamRows, worklist, roster, config = {}, picks = {}, today, maxRounds = 4, postal = '', connected = new Set() }) {
  if (!today || Number.isNaN(Date.parse(today))) throw new Error('finalise needs --today YYYY-MM-DD');
  const brandOf = new Map();
  const addrOf = new Map();
  for (const b of worklist) for (const p of b.people) { brandOf.set(p.key, b); addrOf.set(p.key, p.address || ''); }
  const byId = new Map(worklist.map((b) => [b.id, b]));
  // The matchmaker's pick never reaches a message: it stays on the row as "fit", for the brand's tab only.
  const rows = (teamRows || []).filter((r) => r && brandOf.has(r.key))
    .map(({ creator, creatorNumber, ...r }) => ({ ...r, ...(creator ? { fit: creator } : {}), flags: [...(r.flags || [])] }));
  const have = new Set(rows.map((r) => r.key));
  const add = (key, reason, flag) => { if (!have.has(key)) { rows.push(skipRow(key, reason, flag)); have.add(key); } };
  for (const [id, who] of Object.entries(config.warmThread || {})) {
    for (const p of byId.get(id)?.people || []) add(p.key, `live email thread with ${who}: reply there first (a Gmail draft is ready where one is owed)`, 'warm thread');
  }
  for (const id of config.hold || []) {
    const why = byId.get(id)?.rule?.why || 'on hold';
    for (const p of byId.get(id)?.people || []) add(p.key, `on hold: ${why}`, 'hold');
  }
  // People the team returned no row for (blank or note-only name cells): an honest skip, never a silent gap.
  for (const b of worklist) for (const p of b.people) add(p.key, 'no usable name in the sheet (blank, "?" or a note): find the person on LinkedIn first', 'no name');

  for (const r of rows) {
    const b = brandOf.get(r.key);
    r.brand = b.label;
    r.name = r.key.split(' | ').slice(1).join(' | ') || r.key;
    // The country is never the team's to say: the person's own when Leif has given it, else the brand's.
    r.country = config.personCountry?.[r.key] || config.country?.[b.id] || b.country || '';
    for (const k of ['contactOrder', 'wave']) { const n = parseInt(r[k], 10); r[k] = Number.isFinite(n) ? n : 9; }
    if (r.route === 'skip') continue;
    // The private lists win over anything the team wrote: a held brand or a live thread never gets a cold note.
    if (config.wrongCompany?.[b.id]) { Object.assign(r, { route: 'skip', skipReason: config.wrongCompany[b.id] }); r.flags.push('wrong company'); }
    else if (config.warmThread?.[b.id]) { Object.assign(r, { route: 'skip', skipReason: `live email thread with ${config.warmThread[b.id]}: reply there first (a Gmail draft is ready where one is owed)` }); r.flags.push('warm thread'); }
    else if ((config.hold || []).includes(b.id) || b.tier === 'hold' || ['park', 'exclude'].includes(b.rule?.route)) { Object.assign(r, { route: 'skip', skipReason: `on hold: ${b.rule?.why || 'on hold'}` }); r.flags.push('hold'); }
    else if (b.tier === 'warm') { Object.assign(r, { route: 'skip', skipReason: 'a conversation with this brand is already open: check that thread before messaging anyone new' }); r.flags.push('warm brand'); }
    else if (['other', 'webmail'].includes(addrOf.get(r.key))) r.flags.push('address at another company: check their profile shows they still work here');
    if (r.route !== 'skip' && config.waitFor?.[b.id]) r.flags.push(`waits: ${config.waitFor[b.id]}`);
  }

  // One person per brand per day, and at most five live at a brand: the rest wait for an answer.
  const live = new Map();
  for (const r of rows) if (r.route !== 'skip') { if (!live.has(r.brand)) live.set(r.brand, []); live.get(r.brand).push(r); }
  const rank = new Map();
  for (const list of live.values()) {
    list.sort((a, b) => a.contactOrder - b.contactOrder || a.wave - b.wave || a.key.localeCompare(b.key));
    list.forEach((r, i) => {
      if (i < MAX_PER_BRAND) { rank.set(r.key, i); return; }
      Object.assign(r, { route: 'skip', skipReason: `wait: the first ${MAX_PER_BRAND} people at this brand come first (contact order)` });
      r.flags.push('waits for a colleague');
    });
  }

  // A hold is not an error: the row keeps its copy and waits. Someone already connected waits for the country or
  // the postal line; anyone else gets a bare invite, which carries no message. Then the lint reads what is left.
  const check = () => {
    for (const r of rows) if (r.route !== 'skip' && !wantsNote(r)) r.connectionNote = '';
    const first = lint(rows, roster, { today, postal });
    if (!first.holds.length) return first;
    const held = new Set(first.holds.map((h) => h.key));
    for (const r of rows) {
      if (!held.has(r.key)) continue;
      r.nextStep = connected.has(r.key) || ['DM now', 'Wait'].includes(r.nextStep) ? 'Wait' : 'Invite';
      r.connectionNote = '';
    }
    return lint(rows, roster, { today, postal });
  };

  let result = check();
  let rewritten = 0;
  let subjects = 0;
  for (let round = 0; round < maxRounds && result.errors.length; round++) {
    const bad = new Map();
    for (const e of result.errors) { if (!bad.has(e.key)) bad.set(e.key, new Set()); bad.get(e.key).add(e.rule); }
    rows.forEach((r, i) => {
      const rules = bad.get(r.key);
      if (!rules || r.route === 'skip') return;
      if (rules.size === 1 && rules.has('generic-subject')) {
        r.subject = `For ${r.brand}: one creator idea`.slice(0, 60);
        subjects++;
        return;
      }
      const b = brandOf.get(r.key);
      // Colleagues at one brand get consecutive openers by contact rank (all different, whichever round rewrites
      // them); brands start at different openers, so replies show which wording works.
      const offset = [...b.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
      const next = roleCheck(r, b, (rank.get(r.key) ?? 0) + offset, { rule: b.rule?.route, noHonestFit: picks[b.id]?.noHonestFit });
      next.flags.push(`rewritten: ${[...rules].sort().join(', ')}`);
      rows[i] = next;
      rewritten++;
    });
    result = check();
  }
  const why = new Map(result.holds.map((h) => [h.key, h.detail]));
  for (const r of rows) { if (why.has(r.key)) r.hold = why.get(r.key); else delete r.hold; }
  return { rows, lint: result, stats: { rewritten, subjects } };
}

// Today: rows with a dated hook first, then confidence, brand tier and contact order; one person per brand.
export function pickToday(rows, worklist, { max = 10 } = {}) {
  const tierOf = new Map(worklist.map((b) => [b.label, b.tier]));
  const tier = { core: 0, home: 1, other: 2 };
  const conf = { High: 0, Medium: 1, Low: 2 };
  const dated = (r) => (['sponsor', 'launch', 'season', 'news', 'role'].includes(r.hook?.type) ? 0 : 1);
  const cands = rows.filter((r) => r.route === 'linkedin-dm' && r.connectionNote && !(r.flags || []).some((f) => BLOCK.some((b) => f.includes(b))));
  cands.sort((a, b) => dated(a) - dated(b) || (conf[a.confidence] ?? 3) - (conf[b.confidence] ?? 3)
    || (tier[tierOf.get(a.brand)] ?? 3) - (tier[tierOf.get(b.brand)] ?? 3) || a.contactOrder - b.contactOrder || a.wave - b.wave);
  const seen = new Set();
  const out = [];
  for (const r of cands) {
    if (seen.has(r.brand)) continue;
    seen.add(r.brand);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

export function todayTable(list) {
  const find = (r) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${r.name} ${r.brand}`)}`;
  return [['#', 'Brand', 'Person', 'Role found', 'Connection note (200 max)', 'DM after they accept', 'Find them (a search link to open yourself)', 'Confidence', 'Flags'],
    ...list.map((r, i) => [String(i + 1), r.brand, r.name, r.role || '', r.connectionNote || '', r.dm || '', find(r), r.confidence || '', (r.flags || []).join('; ')])];
}

function main() {
  const a = args();
  if ((!a.run && !a.rows) || !a.worklist || !a.roster || !a.today || !a.out) {
    console.error('usage: finalise.mjs (--run <team output.json> | --rows <rows.json>) --worklist <worklist.json> --roster <roster.json> [--config <finalise.json>] --today YYYY-MM-DD --out <rows.json> [--today-csv <today.csv>] [--today-max 10] [--postal "<the postal line>"]');
    process.exit(2);
  }
  let out;
  let todayCsv;
  try { out = assertOutsideRepo(a.out); if (a['today-csv']) todayCsv = assertOutsideRepo(a['today-csv']); } catch (e) { console.error(e.message); process.exit(2); }
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
  let teamRows;
  const picks = {};
  if (a.run) {
    const d = read(a.run);
    const res = d.result || d;
    teamRows = res.rows || [];
    for (const batch of res.research || []) for (const b of batch?.brands || []) if (b?.id) picks[b.id] = b;
  } else teamRows = read(a.rows);
  const worklist = read(a.worklist);
  const { rows, lint: result, stats } = finalise({ rows: teamRows, worklist, roster: read(a.roster), config: a.config ? read(a.config) : {}, picks, today: a.today, postal: typeof a.postal === 'string' ? a.postal : '' });
  writeFileSync(out, JSON.stringify(rows, null, 1));
  const live = rows.filter((r) => r.route !== 'skip');
  console.log(`rows ${rows.length} · live ${live.length} · skip ${rows.length - live.length} · rewritten ${stats.rewritten} · subjects fixed ${stats.subjects} · held ${result.holds.length}`);
  if (todayCsv) {
    const list = pickToday(rows, worklist, { max: Number(a['today-max'] || 10) });
    writeFileSync(todayCsv, toCSV(todayTable(list)));
    console.log(`today ${list.length} rows, one per brand`);
  }
  console.log(report(result));
  process.exit(result.errors.length ? 1 : 0);
}

if (isMain(import.meta.url)) main();
