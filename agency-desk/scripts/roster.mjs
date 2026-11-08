#!/usr/bin/env node
// Roster truth: the one table every quoted number comes from. Where the Pricing tab lists a creator's recent videos,
// the typical video is their median (one viral video cannot lift it); otherwise the sheet's own figure is used and
// marked "not re-measured". Rates stay in the private file and never in copy.
//
//   node agency-desk/scripts/roster.mjs --li <dir> --ima <dir> [--extra <private overrides.json>] --out <roster.json outside the repo>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { args, isMain, readTableFile, col, token, parseViews, pricingStats, fmtViews, assertOutsideRepo } from './lib.mjs';

const same = (a, b) => { const x = token(a); const y = token(b); return x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)); };

export function buildRoster({ creators, myInfluencers, pricing }, extra = {}) {
  return creators.rows.filter((r) => col(r, 'Creator')).map((r) => {
    const name = col(r, 'Creator');
    const mi = myInfluencers.rows.find((m) => same((m._cells[0] || '').split(' for ')[0], name));
    const pr = pricing.rows.find((p) => same(p._cells[0] || '', name));
    const stats = pr ? pricingStats(pr._cells[1] || '') : null;
    const claimed = parseViews(col(r, 'Avg views')) || (mi ? parseViews(col(mi, 'Avg views')) : NaN);
    const x = extra[name] || {};
    const c = {
      name,
      aliases: x.aliases || [],
      niche: col(r, 'Niche keywords'),
      active: /true/i.test(col(r, 'Active')),
      country: x.country || (mi ? col(mi, 'Country') : ''),
      audience: x.audience || null, // e.g. { US: 32.4, UK: 13.9, AU: 25.9 } from a dated analytics screenshot
      pastSponsors: x.pastSponsors || [],
      platforms: x.platforms || ['YouTube'],
      claimedViews: Number.isFinite(claimed) ? claimed : null,
      measured: stats ? { n: stats.n, typical: stats.median, average: stats.mean, best: stats.max, method: 'median of the listed recent videos (Pricing tab)' } : null,
      private: { rate: mi ? col(mi, 'Rate') : '' }, // never quoted in copy
    };
    if (c.measured) {
      c.numbers = [...new Set([fmtViews(c.measured.typical), fmtViews(c.measured.average), fmtViews(c.measured.best)])];
      c.phrase = `${name} (about ${fmtViews(c.measured.typical)} views on a typical video, ${fmtViews(c.measured.best)} on the best of the last ${c.measured.n})`;
      c.numberSource = 'measured';
      if (c.claimedViews && c.claimedViews / c.measured.typical > 2) c.warning = `the sheet says ${fmtViews(c.claimedViews)}, the videos say ${fmtViews(c.measured.typical)} typical`;
    } else if (c.claimedViews) {
      c.numbers = [fmtViews(c.claimedViews)];
      c.phrase = `${name} (about ${fmtViews(c.claimedViews)} views a video)`;
      c.numberSource = 'roster sheet, not re-measured';
    } else {
      c.numbers = [];
      c.phrase = name;
      c.numberSource = 'none: pitch without a number until it is measured';
    }
    return c;
  });
}

// What the workflow and the lint may see: no rates.
export function publicView(roster) {
  return { creators: roster.map(({ private: _p, ...rest }) => rest) };
}

function main() {
  const a = args();
  if (!a.li || !a.out) { console.error('usage: roster.mjs --li <dir> --ima <dir> [--extra <overrides.json>] --out <roster.json>'); process.exit(2); }
  let out;
  try { out = assertOutsideRepo(a.out); } catch (e) { console.error(e.message); process.exit(2); }
  const load = (dir, f) => (dir && existsSync(join(dir, f)) ? readTableFile(join(dir, f)) : { rows: [] });
  const extra = a.extra ? JSON.parse(readFileSync(a.extra, 'utf8')) : {};
  const roster = buildRoster({ creators: load(a.li, 'Creators.csv'), myInfluencers: load(a.li, 'My_Influencers.csv'), pricing: load(a.ima, 'Pricing_Influencers.csv') }, extra);
  writeFileSync(out, JSON.stringify({ creators: roster }, null, 2));
  writeFileSync(out.replace(/\.json$/, '.public.json'), JSON.stringify(publicView(roster), null, 2));
  for (const c of roster) console.log(`${c.active ? 'active  ' : 'inactive'} ${c.numberSource.padEnd(32)} ${c.warning ? 'WARNING ' + c.warning : ''}`);
}

if (isMain(import.meta.url)) main();
