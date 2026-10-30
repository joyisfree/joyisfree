#!/usr/bin/env node
// The scam-link checker. Paste a claim URL, get a verdict before a wallet ever sees it.
//
//   node galxe-desk/scripts/verify-link.mjs https://app.galxe.com/quest/space/GCxxxx
//   npm run desk:verify -- https://galxe-claim.app/claim https://app.galxe.com/quest/x
//
// This is the guardian's first checklist line made into one command (rulebook/RULES.md section E,
// CLAIMING.md section 1 point 6). It answers one question: is this page the genuine Galxe quest app?
// It never connects a wallet, never fetches the page, and never follows a redirect: it judges the URL
// itself, because the moment you open a drainer you have already lost the race.
//
// The host rule lives in rank.mjs (GENUINE_HOSTS) and is imported, not copied: one rule, one place.
// Exit code 0 only when every URL given is GENUINE, so it is usable in a script or a hook.

import { GENUINE_HOSTS } from './rank.mjs';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Official Galxe property, but never where a quest is claimed. Opening these is fine; connecting a wallet
// because one of them told you to is not.
export const OFFICIAL_NON_QUEST_HOSTS = new Set(['galxe.com', 'www.galxe.com', 'docs.galxe.com', 'help.galxe.com']);

// Hosts reported as Galxe/airdrop drainers or lookalikes (galxe-desk/docs/scouting-2026-10-30.md and the
// 30 Oct research: PCRisk, PhishDestroy, ScamSniffer, The Block on the Oct 2023 galxe.com DNS hijack).
// A miss here is not safety: anything not GENUINE is refused anyway. This set only sharpens the reason.
export const KNOWN_SCAM_HOSTS = new Set([
  'galxe-claim.app',
  'airdrop-galxe.one',
  'dapps-bridge.net',
  'pumpfun-claim.pages.dev',
  'pumpclaimpad.fun',
  'allocate-pump.fun',
  'in-pump.fun',
  'pumpcheck.cfd',
  'p3ump.fun',
  'refundsolana.net',
  'bayc-reward.xyz',
]);

export const VERDICTS = new Set(['GENUINE', 'OFFICIAL_NOT_QUEST', 'KNOWN_SCAM', 'LOOKALIKE', 'NON_HTTP', 'INVALID', 'UNRELATED']);

/** True when the host is galxe.com itself or one of its subdomains (not a lookalike that merely contains "galxe"). */
function isGalxeDomain(host) {
  return host === 'galxe.com' || host.endsWith('.galxe.com');
}

/**
 * Judge one URL. Returns { verdict, reason, host, scheme, safe }.
 * `safe` is true only for GENUINE: everything else is refused, including the official non-quest pages,
 * because a claim never happens anywhere but the quest app.
 */
export function verifyLink(input, { genuineHosts = GENUINE_HOSTS } = {}) {
  const raw = String(input ?? '').trim();
  let u = null;
  try { u = new URL(raw); } catch { u = null; }
  if (!u) return { verdict: 'INVALID', reason: 'not a URL at all', host: null, scheme: null, safe: false };

  const scheme = u.protocol.replace(':', '');
  if (!/^https?$/.test(scheme)) {
    return { verdict: 'NON_HTTP', reason: `scheme "${scheme}" is not http(s); a quest link is never ${scheme}:`, host: u.hostname || null, scheme, safe: false };
  }

  const host = u.hostname.toLowerCase();

  // A credential in the URL is a deliberate deception: https://app.galxe.com@evil.com reads as Galxe but
  // goes to evil.com. The host check below would catch it; this says why, which is the useful part.
  if (u.username || u.password) {
    return { verdict: 'LOOKALIKE', reason: `the text before "@" is a decoy; this actually goes to ${host}`, host, scheme, safe: false };
  }

  // A punycode host renders as familiar letters but is a different domain (homoglyph attack).
  if (host.split('.').some((label) => label.startsWith('xn--'))) {
    return { verdict: 'LOOKALIKE', reason: `punycode host (${host}) renders as lookalike letters; not a real Galxe domain`, host, scheme, safe: false };
  }

  if (KNOWN_SCAM_HOSTS.has(host)) {
    return { verdict: 'KNOWN_SCAM', reason: `${host} is a reported drainer or lookalike; never connect a wallet`, host, scheme, safe: false };
  }

  if (genuineHosts.has(host)) {
    return { verdict: 'GENUINE', reason: `${host} is the real Galxe quest app`, host, scheme, safe: true };
  }

  if (OFFICIAL_NON_QUEST_HOSTS.has(host)) {
    return { verdict: 'OFFICIAL_NOT_QUEST', reason: `${host} is an official Galxe page but not the quest app; never claim or connect here`, host, scheme, safe: false };
  }

  // A real galxe.com subdomain we do not know: official-looking, still not the quest app. Fail closed.
  if (isGalxeDomain(host)) {
    return { verdict: 'OFFICIAL_NOT_QUEST', reason: `${host} is a galxe.com subdomain but not the quest app; do not claim here`, host, scheme, safe: false };
  }

  // Impersonation: the name borrows "galxe" (or "earndrop"/"airdrop" plus galxe) without being galxe.com.
  if (/galxe|galaxe|ga1xe|galxee/.test(host)) {
    return { verdict: 'LOOKALIKE', reason: `${host} borrows the Galxe name but is not a galxe.com domain`, host, scheme, safe: false };
  }

  return { verdict: 'UNRELATED', reason: `${host} is not a Galxe domain; a Galxe quest is only ever on app.galxe.com`, host, scheme, safe: false };
}

/** One line per URL, for the Do card, a report or the terminal. */
export function formatVerdict(url, v) {
  const mark = v.safe ? 'OK  ' : 'STOP';
  return `${mark} ${v.verdict}: ${url}\n     ${v.reason}`;
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (urls.length === 0) {
    console.error('usage: verify-link.mjs <url> [url...]\n       anything but GENUINE exits 1. A claim happens only on app.galxe.com.');
    process.exitCode = 1;
  } else {
    let allSafe = true;
    for (const url of urls) {
      const v = verifyLink(url);
      if (!v.safe) allSafe = false;
      console.log(formatVerdict(url, v));
    }
    process.exitCode = allSafe ? 0 : 1;
  }
}
