#!/usr/bin/env node
// Is the Gigapot lottery ever worth a ticket? One command, so the answer is arithmetic and not a feeling.
//
//   node galxe-desk/scripts/gigapot.mjs                                  # what it costs, and why it cannot be valued
//   node galxe-desk/scripts/gigapot.mjs --pool-usd 5000 --tickets-sold 40000
//
// The rules (rulebook/RULES.md section B5, help/11424533): a ticket is 50 GG, or 300 GG for ten. The Grand
// Alpha takes half the pot for one winner; the other half is split among 1,000 winners. Winners must flip
// the ticket within 7 days or it is void.
//
// The honest part: Galxe does not publish the pool size or the number of tickets sold, so the expected value
// of a ticket CANNOT be computed from public information. This script therefore refuses to value it unless
// you supply both numbers yourself, and it labels them as your estimate, not a fact. What it can always say
// is the real cost of a ticket, because GG is earned at +30 GG per qualified claim and a claim costs the
// $0.08 fee: that makes 50 GG cost about $0.13 of fees, whatever Galxe says GG is "worth".

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TICKET_GG = 50;
export const TEN_TICKETS_GG = 300;
export const GRAND_SHARE = 0.5; // half the pot to one winner
export const SPLIT_WINNERS = 1000; // the other half split among this many
export const FLIP_DAYS = 7;

/** What N Galxe Gold really costs, in dollars of claim fees (+30 GG per qualified claim at the $0.08 fee). */
export function ggCostUsd(gg, { feeUsd = 0.08, ggPerClaim = 30 } = {}) {
  const n = Number(gg);
  if (!Number.isFinite(n) || n < 0) return null;
  return (n / ggPerClaim) * feeUsd;
}

/**
 * Expected value of one ticket. Returns { verdict, evUsd, costUsd, netUsd, reason, basis }.
 * verdict is CANNOT_VALUE (the public case), NEGATIVE_EV or POSITIVE_EV.
 * poolUsd and ticketsSold are the caller's estimates: Galxe publishes neither.
 */
export function gigapotEv({ poolUsd, ticketsSold, tickets = 1, feeUsd = 0.08, ggPerClaim = 30 } = {}) {
  const costUsd = ggCostUsd(TICKET_GG * Number(tickets || 1), { feeUsd, ggPerClaim });
  const pool = Number(poolUsd);
  const sold = Number(ticketsSold);
  const missing = [];
  if (!Number.isFinite(pool) || pool <= 0) missing.push('pool size');
  if (!Number.isFinite(sold) || sold <= 0) missing.push('tickets sold');
  if (missing.length) {
    return {
      verdict: 'CANNOT_VALUE',
      evUsd: null,
      costUsd,
      netUsd: null,
      reason: `Galxe publishes no ${missing.join(' and no ')}, so a ticket cannot be valued from public information`,
      basis: 'public information only',
    };
  }
  // One ticket's share: the grand prize weighted by the chance of holding the one winning ticket, plus the
  // split half weighted by the chance of being among the 1,000.
  const grand = (pool * GRAND_SHARE) * (1 / sold);
  const splitShare = (pool * (1 - GRAND_SHARE)) / SPLIT_WINNERS;
  const split = splitShare * Math.min(1, SPLIT_WINNERS / sold);
  const evUsd = (grand + split) * Number(tickets || 1);
  const netUsd = evUsd - costUsd;
  return {
    verdict: netUsd >= 0 ? 'POSITIVE_EV' : 'NEGATIVE_EV',
    evUsd,
    costUsd,
    netUsd,
    reason: netUsd >= 0
      ? `at your estimate the ticket returns more than its $${costUsd.toFixed(2)} of fees`
      : `at your estimate the ticket returns less than its $${costUsd.toFixed(2)} of fees`,
    basis: 'your estimated pool and tickets sold, not published figures',
  };
}

export function format(r, { tickets = 1 } = {}) {
  const lines = [
    `Gigapot, ${tickets} ticket${tickets === 1 ? '' : 's'} (${TICKET_GG * tickets} GG)`,
    `Real cost: $${r.costUsd.toFixed(2)} in claim fees (GG is earned at +30 GG per $0.08 claim; Galxe says GG itself has no cash value).`,
  ];
  if (r.verdict === 'CANNOT_VALUE') {
    lines.push(`Verdict: CANNOT_VALUE — ${r.reason}.`);
    lines.push('The desk therefore does not buy tickets: an unpriceable bet is refused, like any unknown (RULES section B5).');
  } else {
    lines.push(`Expected return: $${r.evUsd.toFixed(4)} (${r.basis}).`);
    lines.push(`Verdict: ${r.verdict} — net $${r.netUsd.toFixed(4)}; ${r.reason}.`);
  }
  lines.push(`A win must be flipped within ${FLIP_DAYS} days or it is void.`);
  return lines.join('\n');
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const tickets = Number(arg('tickets') ?? 1);
  const accountPath = arg('account');
  const fee = accountPath ? Number(JSON.parse(readFileSync(accountPath, 'utf8')).claimFeeUsd ?? 0.08) : 0.08;
  const r = gigapotEv({ poolUsd: arg('pool-usd'), ticketsSold: arg('tickets-sold'), tickets, feeUsd: fee });
  console.log(format(r, { tickets }));
  process.exitCode = r.verdict === 'POSITIVE_EV' ? 0 : 1;
}
