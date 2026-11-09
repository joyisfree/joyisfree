#!/usr/bin/env node
// The finishing pass. Every row the team wrote either passes the lint as written or becomes an honest role check
// ("who looks after creator partnerships?") that claims nothing beyond the roster. Rows that must not be messaged
// become skips with the reason, and the Today list takes only rows with nothing blocking them.
//
// It always starts again from the team's own rows, so when a creator says yes (roster yesAt) or is measured again
// (roster measuredAt), the team's fuller copy comes back by itself on the next run.
//
// Private facts come from --config, a JSON file kept outside the repository:
//   { "warmThread": { "<brand id>": "<who>" }, "hold": ["<brand id>"], "wrongCompany": { "<brand id>": "<why>" },
//     "waitFor": { "<brand id>": "<what the lane waits for>" } }
//
//   node agency-desk/scripts/finalise.mjs (--run <team output.json> | --rows <team rows.json>) --worklist <worklist.json>
//        --roster <roster.public.json> --config <finalise.json> --today YYYY-MM-DD --out <rows.json>
//        [--today-csv <today.csv>] [--today-max 10]
import { readFileSync, writeFileSync } from 'node:fs';
import { args, isMain, assertOutsideRepo, toCSV } from './lib.mjs';
import { lint, report, creatorStatus } from './lint-lines.mjs';
// A row carrying any of these flags stays in the pack but never reaches Today. "waits:" comes from the private
// config's waitFor list (a lane that waits for the right creator); "confirm creator first" is the team's own hold.
export const BLOCK = ['no honest fit', 'address at another company', 'wrong company', 'warm brand', 'invalid', 'waits:', 'confirm creator first', 'before pitching'];
export const MAX_PER_BRAND = 5; // the sixth person at a brand waits until one of the first five answers

// Five variants, so up to five colleagues at one brand never get the same note.
const NOTES = [
  'Hi {f}, I run Joyisfree Studio, a small agency for home and garden YouTube creators. Do you look after creator partnerships at {b}?',
  'Hi {f}, I match home and garden YouTube creators with brands that fit them. Who looks after creator partnerships at {b}: you or someone on your team?',
  'Hi {f}, I work with home, garden and DIY creators on YouTube. Are creator partnerships part of your role at {b}?',
  'Hi {f}, Leif here. I place home and garden YouTubers with brands. Is creator work at {b} yours, or a colleague\'s?',
  'Hi {f}, my agency works with DIY, home and garden YouTube channels. Who handles creator partnerships at {b}?',
];
const OPEN = [
  'Thanks for connecting, {f}. Quick one: do you look after creator partnerships at {b}, or is that someone else on your team?',
  "Thanks for connecting, {f}. Who's the right person for creator partnerships at {b}: you, or someone on your team?",
  'Thanks for connecting, {f}. Are YouTube creator partnerships part of your role at {b}, or should I speak with someone else?',
  'Thanks for accepting, {f}. Is creator work at {b} something you look after?',
  'Good to connect, {f}. Who should I speak with about creator partnerships at {b}?',
];
const ASK = ['If so, want a short one-pager here or by email?', "If it's you, want the one-pager here or by email?",
  'If they are, want the one-pager here or by email?', 'If it is, want the one-pager here or by email?',
  'If it lands with you, want the one-pager here or by email?'];
const OUT = "If this isn't your area, just say and I won't follow up. Leif, Joyisfree Studio";
const fill = (t, f, b) => t.replaceAll('{f}', f).replaceAll('{b}', b);

export function firstName(name) {
  const n = String(name || '').replace(/[^A-Za-zÀ-ɏ' -]/g, '').trim().split(/\s+/)[0];
  return n || 'there';
}

// Can brand copy name this creator today, and quote their numbers? The lint's own definition, so the two never drift.
export const creatorState = creatorStatus;

// The honest fallback: who looks after creator partnerships? It names a creator only after a recent yes, and
// quotes their number only when it was measured recently.
export function roleCheck(row, brand, i, { creator = null, state = { named: false, fresh: false }, rule = '', noHonestFit = '' } = {}) {
  const f = firstName(row.name);
  const b = brand.label;
  const v = ((i % NOTES.length) + NOTES.length) % NOTES.length;
  let middle = 'I manage home and garden YouTube creators and only pitch where one genuinely fits.';
  let name = '';
  let number = '';
  if (rule === 'us-only') middle = "I'm adding US creators for spring and will only come back with one who fits.";
  else if (creator && state.named) {
    name = creator.name;
    if (state.fresh && creator.phrase) { middle = `I look after ${creator.phrase}.`; number = creator.phrase; }
    else middle = `I look after ${creator.name}${creator.describe ? `, ${creator.describe}` : ''}.`;
  }
  let dm = [fill(OPEN[v], f, b), middle, ASK[v], OUT].join(' ');
  if (dm.length > 480 && name) { dm = [fill(OPEN[v], f, b), `I look after ${name}.`, ASK[v], OUT].join(' '); number = ''; }
  // Drop review notes and any earlier rewrite's own flags, so a row rewritten twice does not carry them twice.
  const flags = (row.flags || []).filter((x) => !/^(guardian|pilot critic|panel|honest role check|rewritten:|no honest fit:)/.test(x));
  if (noHonestFit && !name) flags.push(`no honest fit: ${String(noHonestFit).slice(0, 80)}`);
  flags.push('honest role check (no dated hook to stand on yet)');
  return {
    ...row, connectionNote: fill(NOTES[v], f, b), dm, creator: name, creatorNumber: number,
    emailOpener: `Thanks for saying yes on LinkedIn. Here is the one-pager I mentioned${name ? ` on ${name}` : ''}.`,
    subject: (name ? `${b} + ${name}: the one-pager` : `For ${b}: our creator one-pager`).slice(0, 60),
    hook: { type: 'none', text: `role check, opener ${v + 1}` }, confidence: 'Low', flags, // the opener number feeds the reply scoreboard
  };
}

const skipRow = (key, reason, flag) => ({ key, route: 'skip', skipReason: reason, hook: { type: 'none' }, confidence: 'Low', contactOrder: 9, wave: 9, flags: [flag] });

export function finalise({ rows: teamRows, worklist, roster, config = {}, picks = {}, today, maxRounds = 4, yesDays = 90, freshDays = 30 }) {
  if (!today || Number.isNaN(Date.parse(today))) throw new Error('finalise needs --today YYYY-MM-DD');
  const brandOf = new Map();
  const addrOf = new Map();
  for (const b of worklist) for (const p of b.people) { brandOf.set(p.key, b); addrOf.set(p.key, p.address || ''); }
  const byId = new Map(worklist.map((b) => [b.id, b]));
  const byName = new Map((roster.creators || []).map((c) => [c.name, c]));
  const rows = (teamRows || []).filter((r) => r && brandOf.has(r.key)).map((r) => ({ ...r, flags: [...(r.flags || [])] }));
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

  let result = lint(rows, roster, { today, yesDays, freshDays });
  let rewritten = 0;
  let subjects = 0;
  for (let round = 0; round < maxRounds && result.errors.length; round++) {
    const bad = new Map();
    for (const e of result.errors) { if (!bad.has(e.key)) bad.set(e.key, new Set()); bad.get(e.key).add(e.rule); }
    rows.forEach((r, i) => {
      const rules = bad.get(r.key);
      if (!rules || r.route === 'skip') return;
      if (rules.size === 1 && rules.has('generic-subject')) {
        r.subject = (r.creator ? `${r.brand} + ${r.creator}?` : `For ${r.brand}: one creator idea`).slice(0, 60);
        subjects++;
        return;
      }
      const b = brandOf.get(r.key);
      const creator = byName.get(r.creator || '') || null;
      // Colleagues at one brand get consecutive openers by contact rank (all different, whichever round rewrites
      // them); brands start at different openers, so replies show which wording works.
      const offset = [...b.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
      const next = roleCheck(r, b, (rank.get(r.key) ?? 0) + offset, {
        creator, state: creatorState(creator, today, { yesDays, freshDays }), rule: b.rule?.route, noHonestFit: picks[b.id]?.noHonestFit,
      });
      next.flags.push(`rewritten: ${[...rules].sort().join(', ')}`);
      rows[i] = next;
      rewritten++;
    });
    result = lint(rows, roster, { today, yesDays, freshDays });
  }
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
    console.error('usage: finalise.mjs (--run <team output.json> | --rows <rows.json>) --worklist <worklist.json> --roster <roster.json> [--config <finalise.json>] --today YYYY-MM-DD --out <rows.json> [--today-csv <today.csv>] [--today-max 10]');
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
  const { rows, lint: result, stats } = finalise({ rows: teamRows, worklist, roster: read(a.roster), config: a.config ? read(a.config) : {}, picks, today: a.today });
  writeFileSync(out, JSON.stringify(rows, null, 1));
  const live = rows.filter((r) => r.route !== 'skip');
  const named = live.filter((r) => r.creator).length;
  console.log(`rows ${rows.length} · live ${live.length} · skip ${rows.length - live.length} · rewritten ${stats.rewritten} · subjects fixed ${stats.subjects} · naming a creator ${named}`);
  if (todayCsv) {
    const list = pickToday(rows, worklist, { max: Number(a['today-max'] || 10) });
    writeFileSync(todayCsv, toCSV(todayTable(list)));
    console.log(`today ${list.length} rows, one per brand`);
  }
  console.log(report(result));
  process.exit(result.errors.length ? 1 : 0);
}

if (isMain(import.meta.url)) main();
