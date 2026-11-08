#!/usr/bin/env node
// The Do card: Leif's one weekly pass on one page. It takes the gate's shortlist and fills his weekly minutes, quests
// that end before next week's pass first, then the best value per minute. All quests share the one wallet cap: money
// tied up at once never exceeds it. Each entry gives the exact URL, the tasks in order with his clicks and signatures
// marked, and the end and claim-by dates. Claude writes the ledger from his one-line reply.
//
// The card is built only on an open lane. A recorded flag, a kill-rule stop or the lane's standing decision
// (galxe-desk/decision.json, refused 31 Oct 2026) each blank it to a stop notice, and a missing decision file is a stop
// too. The claim clock still shows, because a prize already won is not new questing.
//
//   node galxe-desk/scripts/do-card.mjs --shortlist galxe-desk/shortlist.json --account galxe-desk/account.json --out galxe-desk/do-card.md
//   node galxe-desk/scripts/do-card.mjs --decision PATH   # judge another decision file (the default sits beside scripts/)

import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseLedger, status, withDecision, decisionStop, readDecision, DECISION_FILE } from './ledger.mjs';

const DAY = 86_400_000;
const perMinute = (x) => (Number(x.ev) || 0) / Math.max(1, Number(x.minutes) || 1);

// Task text is copied from the quest page and is untrusted. A link in it to anywhere but app.galxe.com is
// removed, so the card can never hand Leif a lookalike claim page to click.
export function safeTaskText(s) {
  return String(s).replace(/https?:\/\/[^\s)]+/gi, (u) => {
    try { if (new URL(u).hostname === 'app.galxe.com') return u; } catch { /* fall through */ }
    return '[external link removed — open only app.galxe.com]';
  });
}

export function plan(shortlist, account, now = Date.now()) {
  const cap = Number(account.weeklyMinutesCap ?? 30);
  const walletCap = Number(account.walletCapUsd ?? 25);
  const urgent = (x) => x.endsAt != null && Date.parse(x.endsAt) - now < 7 * DAY;
  const items = [...(shortlist.passed || [])].sort((a, b) => (urgent(b) - urgent(a)) || (perMinute(b) - perMinute(a)));
  const picked = [];
  const skipped = [];
  let used = 0;
  let capital = 0;
  for (const x of items) {
    const m = Number(x.minutes);
    const c = Number(x.capitalUsd) || 0;
    if (!Number.isFinite(m)) skipped.push({ ...x, why: 'minutes unknown' });
    else if (used + m > cap) skipped.push({ ...x, why: 'the minutes ran out' });
    else if (capital + c > walletCap) skipped.push({ ...x, why: `the $${walletCap} wallet cap is already in use` });
    else { picked.push({ ...x, urgent: urgent(x) }); used += m; capital += c; }
  }
  return { picked, skipped, used, cap, capital, walletCap };
}

/** The claim clock, first on the card: a prize already won and unclaimed is worth more than any new quest. */
function claimClock(due, overdue) {
  const lines = [];
  if (overdue.length) {
    lines.push(`## OVERDUE — check these before anything else`, '');
    for (const d of overdue) lines.push(`- **${d.quest}**: the window closed ${d.deadline}. Open the quest page and see whether it can still be claimed; if not, record it as lost.`);
    lines.push('');
  }
  if (due.length) {
    lines.push(`## Claim first — already won, not yet claimed`, '');
    for (const d of due) lines.push(`- **${d.quest}**: claim by ${d.deadline}.`);
    lines.push('');
  }
  return lines;
}

export function doCard(shortlist, account, when = new Date(), { kill = 'CONTINUE', due = [], overdue = [], decision = null } = {}) {
  const header = `# Do card, week of ${when.toISOString().slice(0, 10)}`;
  // A recorded flag, or any other kill-rule stop, ends the questing: no Do card is produced until the panel
  // clears it. A standing decision ends it until Leif reopens the lane, and is not a panel's to clear.
  // The claim clock still shows, because a prize already won is not new questing.
  if (kill && kill !== 'CONTINUE') {
    const closed = String(kill).startsWith('STOP_DECISION');
    const why = closed
      ? [
        `The questing lane is closed by a standing decision: ${kill}`,
        'There is no Do card this week, and none until Leif reopens the lane in his own words. Nothing is owed by Leif:',
        'no pass and no minutes.',
      ]
      : [
        `The desk is stopped by its own kill rule: ${kill}`,
        'There is no Do card this week. The critic panel (the risk officer first) reviews before any questing resumes;',
        'a flag is cleared only after that review.',
      ];
    if (decision && decision !== kill) why.push(`The lane is also closed by a standing decision: ${decision}`);
    return [header, '', ...why, 'Run `npm run desk:status` to see it.', '', ...claimClock(due, overdue)].join('\n');
  }
  const { picked, skipped, used, cap, capital, walletCap } = plan(shortlist, account, when.getTime());
  const lines = [header, '', ...claimClock(due, overdue)];
  if (picked.length === 0) {
    lines.push('Nothing new clears the gate this week, so there is no quest to do. That is a result, not a failure.', '');
    return lines.join('\n');
  }
  lines.push(`One pass, about ${used} of your ${cap} minutes. Open the "Galxe desk" profile in Brave and go top to bottom.`);
  if (capital > 0) lines.push(`Money tied up at once: $${capital} of your $${walletCap} wallet cap.`);
  lines.push('The clicks are yours: X forbids scripted clicks, Galxe flags automated ones, and every signature is your key.');
  lines.push('Sign only a readable sign-in message, the exact claim, or the exact on-chain task transaction the guardian noted; an exact-amount approval only if a task needs one. Refuse any unlimited allowance, blind Permit or setApprovalForAll, and tell Claude.', '');
  picked.forEach((x, i) => {
    const dates = [x.endsAt ? `ends ${x.endsAt}` : null, x.claimBy ? `claim by ${x.claimBy}` : null].filter(Boolean).join(', ');
    lines.push(`${i + 1}. **${x.space}${x.name ? ` / ${x.name}` : ''}** (worth about $${Number(x.ev).toFixed(2)} to you, about ${x.minutes} min${dates ? `, ${dates}` : ''})${x.urgent ? ' **ends before next week**' : ''}`);
    lines.push(`   ${x.url}`);
    for (const g of x.tasks || []) {
      if (g.relation === 'ANY' && g.items.length > 1) lines.push('   Do one of:');
      for (const t of g.items) {
        const tags = [t.onX ? 'on X: your click' : null, t.onChain ? 'on-chain: sign only this exact transaction' : null, t.done ? 'already done' : null].filter(Boolean);
        lines.push(`   - ${safeTaskText(t.text)}${tags.length ? ` (${tags.join('; ')})` : ''}`);
      }
    }
    lines.push('   Then press Verify on the quest page.', '');
  });
  if (skipped.length) {
    lines.push('Left for next week:');
    for (const x of skipped) lines.push(`- ${x.space}${x.name ? ` / ${x.name}` : ''} (about ${x.minutes ?? '?'} min): ${x.why}`);
    lines.push('');
  }
  lines.push('When you are done, tell Claude in one line which numbers you did, for example "did 1 and 2". Claude writes the ledger.', '');
  return lines.join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const account = JSON.parse(readFileSync(arg('account', 'galxe-desk/account.json'), 'utf8'));
  const out = arg('out', 'galxe-desk/do-card.md');
  // The ledger's kill state and the lane's standing decision gate the card: a flag, a stop rule or a refusal means no
  // quests this week.
  const ledgerPath = arg('ledger', 'galxe-desk/ledger/ledger.jsonl');
  const entries = existsSync(ledgerPath) ? parseLedger(readFileSync(ledgerPath, 'utf8')) : [];
  const s = withDecision(status(entries, account.killRules), decisionStop(readDecision(arg('decision', DECISION_FILE))));
  const { kill, due, overdue, decision } = s;
  // A stopped desk needs no shortlist, and on a refused lane there is none, because nothing was scouted.
  const shortlist = kill === 'CONTINUE' ? JSON.parse(readFileSync(arg('shortlist', 'galxe-desk/shortlist.json'), 'utf8')) : { passed: [] };
  writeFileSync(out, doCard(shortlist, account, new Date(), { kill, due, overdue, decision }));
  const clock = `${due.length} claim(s) due, ${overdue.length} OVERDUE`;
  if (kill !== 'CONTINUE') {
    console.log(`desk stopped (${kill}): no Do card; ${clock} -> ${out}`);
  } else {
    const p = plan(shortlist, account);
    console.log(`do card: ${p.picked.length} quests in ${p.used} of ${p.cap} min, $${p.capital} of $${p.walletCap} tied up, ${p.skipped.length} left for next week; ${clock} -> ${out}`);
  }
}
