#!/usr/bin/env node
// The Do card: Leif's one weekly pass on one page. It takes the gate's shortlist, fills his weekly minutes (cash prizes
// first, best value per minute; then Voyage positions), lists each quest's exact URL and its tasks in order, marks the
// clicks that must be his, and gives the claim-by or cut-off date. Claude writes the ledger from his one-line reply.
//
//   node galxe-desk/scripts/do-card.mjs --shortlist galxe-desk/shortlist.json --account galxe-desk/account.json --out galxe-desk/do-card.md

import { readFileSync, writeFileSync } from 'node:fs';

const perMinute = (x) => (Number(x.ev) || 0) / Math.max(1, Number(x.minutes) || 1);

export function plan(shortlist, account) {
  const cap = Number(account.weeklyMinutesCap ?? 30);
  const cash = [...(shortlist.passed || [])].sort((a, b) => perMinute(b) - perMinute(a)).map((x) => ({ ...x, lane: 'cash' }));
  const voyage = [...(shortlist.voyage || [])].sort((a, b) => perMinute(b) - perMinute(a)).map((x) => ({ ...x, lane: 'voyage' }));
  const picked = [];
  const skipped = [];
  let used = 0;
  for (const x of [...cash, ...voyage]) {
    const m = Number(x.minutes);
    if (Number.isFinite(m) && used + m <= cap) { picked.push(x); used += m; } else skipped.push(x);
  }
  return { picked, skipped, used, cap };
}

export function doCard(shortlist, account, when = new Date()) {
  const { picked, skipped, used, cap } = plan(shortlist, account);
  const lines = [`# Do card, week of ${when.toISOString().slice(0, 10)}`, ''];
  if (picked.length === 0) {
    lines.push('Nothing clears the gate this week, so there is nothing to do. That is a result, not a failure.', '');
    return lines.join('\n');
  }
  lines.push(`One pass, about ${used} of your ${cap} minutes. Open the "Galxe desk" profile in Brave and go top to bottom.`);
  lines.push('The clicks are yours: X forbids scripted clicks, Galxe flags automated ones, and every signature is your key.');
  lines.push('Sign only a readable sign-in message or the exact claim or task transaction. Refuse any approval, Permit or unlimited allowance, and tell Claude.', '');
  picked.forEach((x, i) => {
    const what = x.lane === 'cash'
      ? `cash, worth about $${Number(x.ev).toFixed(2)} to you, about ${x.minutes} min, claim by ${x.claimBy ?? 'see the shortlist'}`
      : `Voyage position, about ${x.minutes} min, the project's cut-off ${x.claimBy ?? 'see the shortlist'}`;
    lines.push(`${i + 1}. **${x.space}${x.name ? ` / ${x.name}` : ''}** (${what})`);
    lines.push(`   ${x.url}`);
    for (const g of x.tasks || []) {
      if (g.relation === 'ANY' && g.items.length > 1) lines.push('   Do one of:');
      for (const t of g.items) {
        const tags = [t.onX ? 'on X: your click' : null, t.onChain ? 'on-chain: sign only this exact transaction' : null, t.done ? 'already done' : null].filter(Boolean);
        lines.push(`   - ${t.text}${tags.length ? ` (${tags.join('; ')})` : ''}`);
      }
    }
    lines.push('   Then press Verify on the quest page.', '');
  });
  if (skipped.length) {
    lines.push('Left for next week (the minutes ran out):');
    for (const x of skipped) lines.push(`- ${x.space}${x.name ? ` / ${x.name}` : ''} (${x.lane}, about ${x.minutes ?? '?'} min)`);
    lines.push('');
  }
  lines.push('When you are done, tell Claude in one line which numbers you did, for example "did 1 and 2". Claude writes the ledger.', '');
  return lines.join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const shortlist = JSON.parse(readFileSync(arg('shortlist', 'galxe-desk/shortlist.json'), 'utf8'));
  const account = JSON.parse(readFileSync(arg('account', 'galxe-desk/account.json'), 'utf8'));
  const out = arg('out', 'galxe-desk/do-card.md');
  writeFileSync(out, doCard(shortlist, account));
  const p = plan(shortlist, account);
  console.log(`do card: ${p.picked.length} quests in ${p.used} of ${p.cap} min, ${p.skipped.length} left for next week -> ${out}`);
}
