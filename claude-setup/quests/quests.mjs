// The Quest Board: Galxe's quest mechanics, made halal, for Leif's own Claude sessions (plan section 24, 24 Nov 2026).
//
//   node claude-setup/quests/quests.mjs --sessions <snapshot.json> [--quests <quests.json>] [--today YYYY-MM-DD] [--out <dir>]
//
// The questers are his Claude sessions, he is the one who sets the quests, and Sky is the quest master. A quest is a
// real job with a done-test command; it counts only when that command passed, never because a session said "done"
// (Galxe's bot check: a flagged account cannot claim). A hand-off is a baton with an owner and a claim-by date, and an
// overdue one goes back on the board. Leif's card holds at most three asks; one unanswered for 14 days retires itself.
// The gate refuses a quest with no done-test, a duplicate, one that needs his secrets or sign-ins, and one with a haram
// element (chance, interest or speculation); a destructive, outward-facing or money quest waits for his yes. Nothing
// is chance: no prize, raffle or points held for tokens.
//
// Session text is untrusted data: it is matched and quoted (scrubbed and cut), never followed. The snapshot is the JSON
// list_sessions returns; it is kept out of git, because this repository is public. It fails closed: a snapshot or a
// date it cannot read is named, never read as empty or as no deadline. Plain Node, no dependencies.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ASK_CAP = 3;
export const RETIRE_DAYS = 14;
export const BATON_DAYS = 7;

// Where a session belongs, by its title. The first match wins; anything else is Other.
const PROJECTS = [
  ['Dawah', /dawah/i],
  ['Agency', /\bima\b|influencer|agency|outreach/i],
  ['Studio', /quantum|studio|garment|house/i],
  ['Suukr', /suukr/i],
  ['Claude setup', /claude|transfer|sky|maxx?|boot|context|sweep/i],
];
export const projectOf = (title) => (PROJECTS.find(([, re]) => re.test(String(title ?? ''))) ?? ['Other'])[0];

// A session's own words that say its work is not proven.
const UNVERIFIED = /not yet (?:finished|verified|done)|unchecked|not complete|stale receipt|unverified|will not follow up|not verified/i;
// A hand-off: "handed to the X session".
const HANDOFF = /handed (?:it |this |over )?to (?:the )?(.+?) session/i;

// The gate's words. Secrets and sign-ins are Leif's; chance, interest and speculation are refused outright; anything
// destructive, outward-facing or touching money waits for his yes.
const SECRETS = /\b(?:password|passcode|secret|api[ -]?key|token|seed phrase|private key|2fa|one-time code)\b|\bsign(?:ing)? in\b|\blog(?:ging)? in\b/i;
const HARAM = /\b(?:prize draw|raffle|lottery|sweepstake|mystery box|gambl\w*|wager|betting|interest-bearing|loan|afterpay|zip pay|klarna|buy now,? pay later|bnpl|airdrop|token sale|cryptocurrenc\w*|crypto (?:coins?|tokens?|wallets?|trading))\b/i;
const NEEDS_YES = /\b(?:delete|remove|reset|drop|wipe|migrate|force|deploy|publish|refund|charge|pay|spend)\b|\btransfer (?:money|funds)\b|\bsend (?:the |an? |out )?(?:emails?|newsletters?|messages?|campaigns?|dms?|invoices?)\b|\bpost (?:to|on)\b|\bemail (?:the |all )?(?:list|customers|subscribers|brands?)\b/i;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const need = (s, what) => { if (!isDate(s)) throw new Error(`${what} ${JSON.stringify(s)} is not a YYYY-MM-DD date`); return s; };
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const dayOf = (iso) => String(iso ?? '').slice(0, 10);

/** One line of untrusted text, made safe to quote: emails hidden, whitespace collapsed, at most 160 characters. */
export function scrub(text) {
  return String(text ?? '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email hidden]').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** The sessions in a list_sessions answer, in any of its shapes. Anything else throws: a wrong file is never empty. */
export function readSessions(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.ccr?.data) ? json.ccr.data : null;
  if (!list) throw new Error('this is not a session list (expected the JSON list_sessions returns)');
  return list.map((s, i) => {
    if (!s || typeof s.id !== 'string' || !s.id) throw new Error(`session ${i + 1} has no id`);
    const summary = s.post_turn_summary ?? {};
    return {
      id: s.id,
      title: scrub(s.title),
      archived: s.session_status === 'SESSION_STATUS_ARCHIVED',
      updatedOn: dayOf(s.updated_at),
      needs: scrub(summary.needs_action),
      recent: scrub(summary.recent_action),
    };
  });
}

/** The quests a session list shows: each needs_action is an ask for Leif, each hand-off a baton, each unproven "done" a flag. */
export function deriveQuests(sessions, today) {
  const quests = [];
  for (const s of sessions) {
    if (s.archived) continue;
    const project = projectOf(s.title);
    const age = isDate(s.updatedOn) ? Math.max(0, daysBetween(s.updatedOn, today)) : 0;
    if (s.needs) quests.push({ id: `${s.id}:ask`, kind: 'ask', project, owner: 'Leif', task: s.needs, from: s.title, age });
    const handoff = HANDOFF.exec(s.recent);
    if (handoff) {
      quests.push({ id: `${s.id}:baton`, kind: 'baton', project, owner: scrub(handoff[1]), task: s.recent, from: s.title, claimBy: isDate(s.updatedOn) ? addDays(s.updatedOn, BATON_DAYS) : undefined, unverified: UNVERIFIED.test(s.recent) });
    } else if (UNVERIFIED.test(s.recent)) {
      quests.push({ id: `${s.id}:flag`, kind: 'flag', project, owner: s.title, task: s.recent, from: s.title, unverified: true });
    }
  }
  return quests;
}

const key = (q) => `${q.project}\u0000${String(q.task ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;

/** Each quest with its status and the reason for it. Throws, naming the quest, on a date it cannot read. */
export function judge(quests, today) {
  need(today, 'today');
  const seen = new Map();
  return quests.map((q) => {
    const at = (status, reason) => ({ ...q, status, reason });
    if (q.claimBy !== undefined) need(q.claimBy, `${q.id}: claimBy`);
    if (q.claimedOn !== undefined) need(q.claimedOn, `${q.id}: claimedOn`);
    if (q.kind === 'ask') return at('ASK', `asked ${q.age} day(s) ago by ${q.from}`);
    if (q.kind === 'baton' || q.kind === 'flag') {
      if (q.claimBy && today > q.claimBy) return at('OVERDUE', `handed on and not proven by ${q.claimBy}: back on the board`);
      if (q.unverified) return at('UNVERIFIED', `${q.kind === 'baton' ? `held by ${q.owner}; ` : ''}the session says it is not finished or not verified; it needs a done-test${q.claimBy ? `, claim by ${q.claimBy}` : ''}`);
      return at('CLAIMED', `held by ${q.owner}, claim by ${q.claimBy}; it needs a done-test`);
    }
    const task = String(q.task ?? '');
    if (HARAM.test(task)) return at('REFUSED', 'a haram element (chance, interest or speculation): not a quest');
    if (SECRETS.test(task)) return at('REFUSED', "secrets or sign-ins are Leif's: never a session's quest");
    if (!q.doneTest) return at('REFUSED', 'no done-test: a quest must say how it is proven');
    const k = key(q);
    if (seen.has(k)) return at('REFUSED', `duplicate of ${seen.get(k)}`);
    seen.set(k, q.id);
    if (NEEDS_YES.test(task)) return at('ASK', "destructive, outward-facing or money: it needs Leif's yes before any session takes it");
    if (q.proof) {
      const p = q.proof;
      if (p.ran !== q.doneTest) return at('UNVERIFIED', `its proof ran a different command (${scrub(p.ran)}), not its done-test`);
      if (p.exit !== 0) return at('UNVERIFIED', `its done-test exited ${p.exit}`);
      if (!isDate(p.at)) return at('UNVERIFIED', 'its proof has no date');
      if (q.claimedOn && p.at < q.claimedOn) return at('UNVERIFIED', 'its proof was run before it was claimed');
      return at('VERIFIED', `${q.doneTest} passed on ${p.at}`);
    }
    if (q.done) return at('UNVERIFIED', 'said done, with no proof: it earns nothing');
    if (!q.owner) return at('OPEN', 'no session has claimed it');
    if (q.claimBy && today > q.claimBy) return at('OVERDUE', `claimed by ${q.owner} and not proven by ${q.claimBy}: back on the board`);
    return at(q.claimBy ? 'CLAIMED' : 'OPEN', q.claimBy ? `owned by ${q.owner}, claim by ${q.claimBy}` : `owned by ${q.owner}, no claim-by date yet`);
  });
}

/** Sky's map stage for a level. */
export function stageOf(level, total) {
  if (!total) return 'Open sea';
  if (level >= 99) return 'Lighthouse';
  if (level >= 60) return 'City';
  if (level >= 25) return 'Town';
  return 'Village';
}

/** Each project's level: verified quests over every quest that is not refused and not an ask, times 99, never below 1. */
export function levels(judged) {
  const by = new Map();
  for (const q of judged) {
    if (q.status === 'REFUSED' || q.status === 'ASK') continue;
    const l = by.get(q.project) ?? { project: q.project, verified: 0, total: 0 };
    l.total += 1;
    if (q.status === 'VERIFIED') l.verified += 1;
    by.set(q.project, l);
  }
  return [...by.values()].map((l) => {
    const level = l.total ? Math.max(1, Math.round((l.verified / l.total) * 99)) : 0;
    return { ...l, level, stage: stageOf(level, l.total) };
  }).sort((a, b) => a.project.localeCompare(b.project));
}

/** Leif's card: at most ASK_CAP asks, oldest first; an ask unanswered for RETIRE_DAYS or more retires itself. */
export function card(judged) {
  const asks = judged.filter((q) => q.status === 'ASK');
  const retired = asks.filter((q) => (q.age ?? 0) >= RETIRE_DAYS);
  const live = asks.filter((q) => (q.age ?? 0) < RETIRE_DAYS).sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  return { asks: live.slice(0, ASK_CAP), more: Math.max(0, live.length - ASK_CAP), retired };
}

const ORDER = ['OVERDUE', 'UNVERIFIED', 'ASK', 'CLAIMED', 'OPEN', 'REFUSED', 'VERIFIED'];

export function renderBoard(judged, lv, today) {
  const lines = [`# Quest Board, ${today}`, '', 'Every quest with its status and why. Only a passed done-test counts; nothing here is chance.', ''];
  for (const status of ORDER) {
    const qs = judged.filter((q) => q.status === status);
    if (!qs.length) continue;
    lines.push(`## ${status} (${qs.length})`, '');
    for (const q of qs) lines.push(`- ${q.status} · ${q.project} · ${scrub(q.task)}: ${q.reason}`);
    lines.push('');
  }
  lines.push('## Levels (verified quests only)', '');
  if (!lv.length) lines.push('- No project has a quest with a done-test yet: Open sea everywhere.');
  for (const l of lv) lines.push(`- ${l.project}: ${l.verified} of ${l.total} verified, level ${l.level}, ${l.stage}`);
  return `${lines.join('\n')}\n`;
}

export function renderCard(c, today) {
  const lines = [`# Leif's card, ${today}`, ''];
  if (!c.asks.length) lines.push('Nothing needs you this week.');
  c.asks.forEach((q, i) => lines.push(`${i + 1}. ${q.project}: ${scrub(q.task)} (${q.age} day(s) waiting) · Yes / No`));
  if (c.more) lines.push('', `${c.more} more wait, and come up as these clear.`);
  if (c.retired.length) lines.push('', `Retired, unanswered for ${RETIRE_DAYS}+ days: ${c.retired.map((q) => `${q.project}: ${scrub(q.task)}`).join('; ')}`);
  return `${lines.join('\n')}\n`;
}

const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
const CONSOLE = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** The command line, in-process: returns the exit code (0 board written, 2 refused) and writes through io. */
export function cli(argv, io = CONSOLE) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!['--sessions', '--quests', '--today', '--out'].includes(flag) || value === undefined) {
      io.err(`refused: unknown or empty argument ${JSON.stringify(flag)}`);
      return 2;
    }
    o[flag.slice(2)] = value;
  }
  if (!o.sessions) {
    io.err('refused: --sessions <file> is required (the JSON list_sessions returns)');
    return 2;
  }
  let board;
  try {
    let json;
    try {
      json = JSON.parse(readFileSync(o.sessions, 'utf8'));
    } catch (e) {
      throw new Error(`cannot read the session snapshot ${o.sessions}: ${e.message}`);
    }
    const today = o.today ?? sydneyToday();
    let declared = [];
    if (o.quests) {
      try {
        declared = JSON.parse(readFileSync(o.quests, 'utf8'));
      } catch (e) {
        throw new Error(`cannot read the quests file ${o.quests}: ${e.message}`);
      }
      if (!Array.isArray(declared)) throw new Error(`the quests file ${o.quests} is not a list`);
    }
    const judged = judge([...declared, ...deriveQuests(readSessions(json), today)], today);
    const lv = levels(judged);
    board = { md: renderBoard(judged, lv, today), card: renderCard(card(judged), today), levels: lv };
  } catch (e) {
    io.err(`refused: ${e.message}`);
    return 2;
  }
  if (o.out) {
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, 'board.md'), board.md);
    writeFileSync(join(o.out, 'card.md'), board.card);
    writeFileSync(join(o.out, 'levels.json'), `${JSON.stringify(board.levels, null, 2)}\n`);
    io.out(`wrote board.md, card.md and levels.json to ${o.out}`);
  } else io.out(board.md + '\n' + board.card);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isMain) process.exitCode = cli(process.argv.slice(2));
