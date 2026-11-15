// The homework Leif no longer does by hand. What the YouTube Data API returned for one creator (their last uploads,
// descriptions, top comments), or what Leif pasted from one person's own LinkedIn posts, becomes a pack of evidence
// items. Every item has an id, its exact words, a link and a date, so each line of a brief can say where it came
// from and a checker can prove it (provenance.mjs). Pure functions: nothing here reads the network or a file.
import { measure, recentLong, entriesFromVideos } from './measure.mjs';
import { ENGAGEMENT_LABEL } from './lib.mjs';

export { ENGAGEMENT_LABEL };
const DAY = 86_400_000;
export const REFRESH_DAYS = 30; // YouTube's developer policy: stored API data is refreshed or deleted within 30 days

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (when, n) => iso(Date.parse(when) + n * DAY);
const watch = (id, t) => `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const median = (xs) => { const v = [...xs].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const round1 = (n) => Math.round(n * 10) / 10;
export const lines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// A capitalised name of up to four words: "Acme Tools", "Northwind Paints".
const NAME = "((?:[A-Z][\\w&'’-]*)(?:\\s+[A-Z][\\w&'’-]*){0,3})";
const SPONSOR = /\b(?:sponsored by|is the (?:official )?sponsor|sponsor(?:s|ing)? (?:of )?(?:this|today'?s|our) (?:video|episode|move|build|series)|for sponsoring|in (?:paid )?partnership with|paid partnership|partnered with|use (?:my |our |the )?code\b|(?:discount|promo|coupon) code|\d{1,2}% off)|(?:^|\s)#(?:ad|sponsored|partner)\b/i;
const SPONSOR_NAME = [
  new RegExp(`[Ss]ponsored by\\s+${NAME}`),
  new RegExp(`[Tt]hank(?:s| you)(?: so much)?,?(?: to)?\\s+${NAME}\\s+for\\s+(?:sponsoring|partnering|supporting)`),
  new RegExp(`^${NAME}\\s+is the (?:official )?sponsor`),
  new RegExp(`[Ii]n (?:paid )?partnership with\\s+${NAME}`),
];

// Lines in a description that say who paid for the video, kept word for word, with the sponsor's name when the
// line itself gives one. The word "sponsored" alone is not enough.
export function sponsorLines(description) {
  return lines(description).filter((l) => SPONSOR.test(l)).map((text) => {
    let brand = '';
    for (const re of SPONSOR_NAME) { const m = re.exec(text); if (m) { brand = m[1]; break; } }
    return { text, brand };
  });
}

// A line that sits in at least half of the descriptions (and in three or more) is the channel's standing footer:
// socials, gear lists, a year-round discount code. It shows standing partners, never a new deal.
export function boilerplate(videos) {
  const withText = videos.filter((v) => typeof v.description === 'string' && v.description.trim());
  const out = new Set();
  if (withText.length < 4) return out;
  const seen = new Map();
  for (const v of withText) for (const l of new Set(lines(v.description).map(norm))) seen.set(l, (seen.get(l) || 0) + 1);
  const need = Math.max(3, Math.ceil(withText.length / 2));
  for (const [l, n] of seen) if (n >= need) out.add(l);
  return out;
}

// YouTube's own rule for chapters: three or more timestamps, the first at 0:00.
export function chapters(description) {
  const out = [];
  for (const l of lines(description)) {
    const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:]?\s*(\S.*)$/.exec(l);
    if (m) out.push({ t: Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), label: m[4].trim() });
  }
  return out.length >= 3 && out[0].t === 0 ? out : [];
}

const FUTURE = /\b(?:next (?:week|video|episode|time|month)|coming (?:soon|up)|stay tuned|in the next (?:video|episode|part)|upcoming (?:video|episode|series|project))\b/i;
export function futureLines(description) {
  return lines(description).filter((l) => FUTURE.test(l));
}

// "Cabin rebuild, Part 3: the roof": a numbered series is the story a creator is telling. The name is what stands
// before the number; a title that starts with the number ("Day 4: …") is grouped by that word alone.
const MARK = /\b(part|pt|ep|episode|day|week|chapter)\.?\s*#?(\d{1,3})\b/i;
export function seriesArc(videos) {
  const groups = new Map();
  for (const v of videos) {
    const m = MARK.exec(v.title || '');
    if (!m) continue;
    const before = norm(v.title.slice(0, m.index)).replace(/[\s,:;|–—-]+$/, '');
    const name = before || `"${m[1].toLowerCase()}" series`;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ n: Number(m[2]), id: v.id, title: v.title, date: String(v.publishedAt || '').slice(0, 10) });
  }
  return [...groups].filter(([, list]) => list.length >= 2)
    .map(([name, list]) => ({ name, count: list.length, latest: list.sort((a, b) => b.date.localeCompare(a.date))[0] }))
    .sort((a, b) => b.latest.date.localeCompare(a.latest.date));
}

const STOP = new Set(('about after again also back been before being best build building could down ever every first from getting '
  + 'have here into just last like made make making more most much need never next only over part some than that their them then '
  + 'there these they this time today very video week what when where which while will with year your youre episode finally').split(' '));
// Words that keep coming back across titles. A word in nearly every title (the channel's own name) is not a theme.
export function themes(videos, { top = 8 } = {}) {
  const df = new Map();
  for (const v of videos) {
    const words = new Set((String(v.title || '').toLowerCase().match(/[a-z][a-z'’]{3,}/g) || []).map((w) => w.replace(/['’]/g, '')).filter((w) => !STOP.has(w)));
    for (const w of words) df.set(w, (df.get(w) || 0) + 1);
  }
  const n = videos.length;
  return [...df].filter(([, c]) => c >= 3 && !(n >= 10 && c / n > 0.8)).map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, top);
}

// A Short can run three minutes and the API has no Shorts flag, so length is all there is to go on.
export function lengthKind(v) {
  if (v.live || !v.durationSec) return 'live';
  if (v.durationSec <= 60) return 'short';
  return v.durationSec <= 180 ? 'maybe' : 'long';
}

// The videos read closely (their chapters, their first lines, their comments): the newest five long ones and the
// best one. One definition, so the comments that are fetched are the ones the pack expects.
export function closeRead(videos) {
  const long = videos.filter((v) => lengthKind(v) === 'long').sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const best = long.reduce((a, b) => (!a || b.views > a.views ? b : a), null);
  return [...new Set([...long.slice(0, 5), ...(best ? [best] : [])].map((v) => v.id))];
}

export function standouts(videos, typical, { top = 5 } = {}) {
  if (!Number.isFinite(typical) || typical <= 0) return [];
  return videos.filter((v) => lengthKind(v) === 'long' && Number.isFinite(v.views) && v.views >= 2 * typical)
    .sort((a, b) => b.views - a.views).slice(0, top)
    .map((v) => ({ id: v.id, title: v.title, views: v.views, times: round1(v.views / typical), link: watch(v.id), date: String(v.publishedAt).slice(0, 10) }));
}

// The numbers Leif asks for every time: typical and average views, the best video, how often they post, the last
// upload, and an engagement rate. A number with no fetch date cannot be aged, so it is refused.
export function stats(videos, today, fetchedAt) {
  if (!fetchedAt || Number.isNaN(Date.parse(fetchedAt))) throw new Error('stats needs fetchedAt: the date this YouTube data was read');
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error('stats needs today as YYYY-MM-DD');
  const real = videos.filter((v) => lengthKind(v) !== 'live' && !Number.isNaN(Date.parse(v.publishedAt)));
  const newest = [...real].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
  const shortish = real.filter((v) => lengthKind(v) !== 'long').length;
  const long = real.filter((v) => lengthKind(v) === 'long').sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const gaps = long.slice(1).map((v, i) => (Date.parse(long[i].publishedAt) - Date.parse(v.publishedAt)) / DAY);
  const base = {
    fetchedAt, refreshBy: addDays(fetchedAt, REFRESH_DAYS), videos: real.length, shorts: shortish,
    lastUpload: newest ? { date: iso(Date.parse(newest.publishedAt)), daysAgo: Math.floor((now - Date.parse(newest.publishedAt)) / DAY) } : null,
    pace: gaps.length ? { medianGapDays: round1(median(gaps)), perMonth: round1(long.filter((v) => (now - Date.parse(v.publishedAt)) / DAY <= 90).length / 3) } : null,
  };
  if (real.length && shortish / real.length >= 0.6) {
    return { ...base, typical: null, why: `mostly Shorts or very short videos (${shortish} of ${real.length}): no typical long-video number` };
  }
  const entries = entriesFromVideos(videos);
  const m = measure(entries, today);
  if (!m.ok) return { ...base, typical: null, why: m.why };
  const used = recentLong(entries, today);
  const byLink = new Map(videos.map((v) => [watch(v.id), v]));
  const top = used.reduce((a, b) => (b.views > a.views ? b : a));
  const rates = used.map((e) => byLink.get(e.link)).filter((v) => v && Number.isFinite(v.likes) && Number.isFinite(v.comments) && v.views > 0)
    .map((v) => (v.likes + v.comments) / v.views);
  const engagement = rates.length >= Math.min(3, used.length)
    ? { rate: Math.round(median(rates) * 10000) / 10000, n: rates.length, label: ENGAGEMENT_LABEL }
    : { rate: null, n: rates.length, label: ENGAGEMENT_LABEL, why: 'likes or comments are hidden or off on most of these videos' };
  return {
    ...base, typical: m.measured.typical, average: Math.round(used.reduce((s, e) => s + e.views, 0) / used.length), n: used.length,
    best: { views: top.views, title: top.title, link: top.link }, method: m.measured.method, engagement,
  };
}

// Never a hook, whatever the evidence holds: health, family hardship, children, religion, politics, money troubles.
const SENSITIVE = /\b(?:hospital|surgery|cancer|chemo|diagnos\w*|illness|stroke|heart attack|miscarriage|passed away|funeral|died|grief|mental health|depression|rehab|divorce|custody|lost (?:the|our) (?:baby|son|daughter)|(?:my|our) (?:son|daughter|kids?|children|baby|toddler|newborn)|pregnan\w*|church|god|pray(?:er|ers|ing)?|allah|mosque|bible|quran|jesus|sermon|election|voting|vote for|referendum|republicans?|democrats?|debt|bankrupt\w*|evict\w*|foreclos\w*|laid off|lost (?:my|our) job|can'?t afford|lose the house)\b/i;
export const sensitive = (text) => SENSITIVE.test(String(text || ''));

// A channel run by a talent manager or another agency is not ours to offer.
const MANAGED = /\bmanaged by\b|\brepresented by\b|\b(?:talent|creator|influencer) (?:agency|management)\b|\bmgmt\b|\bmanagement\s*[:@-]/i;
export const managedBy = (description) => MANAGED.test(String(description || ''));

const LINKISH = /^(?:https?:\/\/\S+|www\.\S+|#\w+(?:\s+#\w+)*|[\w .'&-]{0,40}:\s*https?:\/\/\S+)$/i;

// Everything read for one creator, as items a brief can cite. `comments` maps a video id to what topComments()
// returned for it; leave it out when comments were not read, and the pack says "not checked" rather than "none".
export function evidencePack({ channel, videos, comments, fetchedAt, today }) {
  const numbers = stats(videos, today, fetchedAt); // throws without fetchedAt
  const items = [];
  const push = (it) => items.push({ ...it, source: 'api', ...(sensitive(it.text) ? { never: true } : {}) });
  const date = (v) => String(v.publishedAt || '').slice(0, 10);
  const real = videos.filter((v) => lengthKind(v) !== 'live').sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const described = real.filter((v) => typeof v.description === 'string');
  const stated = real.filter((v) => v.lang);
  const english = !(stated.length && stated.filter((v) => !/^en\b/i.test(v.lang)).length / stated.length >= 0.6);
  const standing = boilerplate(real);
  const close = new Set(closeRead(real));

  (channel?.description ? lines(channel.description).slice(0, 8) : []).forEach((text, k) => push({ id: `about:${k + 1}`, kind: 'about', text, link: channel.handle ? `https://www.youtube.com/${channel.handle}` : '', date: iso(Date.parse(fetchedAt)), owner: 'self' }));
  const standingSeen = new Set();
  for (const v of real) {
    push({ id: `t:${v.id}`, kind: 'title', text: v.title, link: watch(v.id), date: date(v), owner: 'self', length: lengthKind(v), views: v.views });
    if (v.paid) push({ id: `p:${v.id}`, kind: 'paid', text: v.title, link: watch(v.id), date: date(v), owner: 'self' });
    if (typeof v.description !== 'string') continue;
    const own = lines(v.description);
    const sponsors = english ? sponsorLines(v.description) : [];
    const sponsorText = new Set(sponsors.map((s) => s.text));
    sponsors.forEach((s, k) => {
      if (!standing.has(norm(s.text))) return push({ id: `s:${v.id}:${k + 1}`, kind: 'sponsor', text: s.text, brand: s.brand, link: watch(v.id), date: date(v), owner: 'self' });
      if (standingSeen.has(norm(s.text))) return undefined;
      standingSeen.add(norm(s.text)); // newest video first, so the standing line carries its newest date
      return push({ id: `st:${standingSeen.size}`, kind: 'standing', text: s.text, brand: s.brand, link: watch(v.id), date: date(v), owner: 'self' });
    });
    const plans = english && real.indexOf(v) < 10 ? futureLines(v.description).filter((l) => !standing.has(norm(l))) : [];
    plans.forEach((text, k) => push({ id: `f:${v.id}:${k + 1}`, kind: 'plan', text, link: watch(v.id), date: date(v), owner: 'self' }));
    if (!close.has(v.id)) continue;
    const marks = chapters(v.description);
    marks.forEach((c, k) => push({ id: `c:${v.id}:${k + 1}`, kind: 'chapter', text: c.label, link: watch(v.id, c.t), date: date(v), owner: 'self' }));
    const taken = new Set([...sponsorText, ...plans]);
    own.filter((l) => !standing.has(norm(l)) && !taken.has(l) && !LINKISH.test(l) && !/^(?:\d{1,2}:)?\d{1,2}:\d{2}\b/.test(l)).slice(0, 6)
      .forEach((text, k) => push({ id: `d:${v.id}:${k + 1}`, kind: 'description', text: text.slice(0, 300), link: watch(v.id), date: date(v), owner: 'self' }));
  }
  let fans = 0;
  let fanVideos = 0;
  let off = 0;
  const read = Object.entries(comments || {});
  for (const [id, c] of read) {
    const v = real.find((x) => x.id === id);
    if (!v) continue;
    if (c.disabled) { off++; continue; }
    fanVideos++;
    (c.comments || []).slice(0, 20).forEach((x, k) => { fans++; push({ id: `a:${id}:${k + 1}`, kind: 'fan', text: x.text, likes: x.likes ?? null, link: watch(id), date: String(x.publishedAt || v.publishedAt).slice(0, 10), owner: 'audience' }); });
    (c.ownerReplies || []).slice(0, 10).forEach((x, k) => push({ id: `r:${id}:${k + 1}`, kind: 'reply', text: x.text, link: watch(id), date: String(x.publishedAt || v.publishedAt).slice(0, 10), owner: 'self' }));
  }
  const sponsorCount = items.filter((i) => i.kind === 'sponsor').length;
  const summary = {
    sponsors: !english ? 'not in English: sponsor and plan lines were not read'
      : !described.length ? 'unknown (no descriptions were read)'
        : `${sponsorCount || 'no'} sponsor line${sponsorCount === 1 ? '' : 's'} in ${described.length} descriptions`,
    fans: comments === undefined ? 'not checked' : read.length && off === read.length ? 'comments off'
      : `${fans} fan comments from ${fanVideos} videos${off ? ` (comments off on ${off})` : ''}`,
  };
  return {
    who: { kind: 'creator', handle: channel?.handle || '', channelId: channel?.id || '', title: channel?.title || '', country: channel?.country || '' },
    fetchedAt, refreshBy: numbers.refreshBy, stats: numbers, summary, managed: managedBy(channel?.description),
    derived: { series: seriesArc(real), themes: themes(real), standouts: standouts(real, numbers.typical) },
    items,
  };
}

// What a search returned is a pointer to a video, never a quote: the API cuts these texts short and escapes them.
// The video's real title and description come from videos.list before anything is said about it.
export function fromSearch(results, fetchedAt) {
  return (results || []).map((r) => ({
    id: `m:${r.videoId}`, kind: 'mention', text: r.title, snippet: r.snippet || '', link: watch(r.videoId), date: String(r.publishedAt || '').slice(0, 10),
    owner: 'other', source: 'api', quotable: false, channelId: r.channelId || '', channelTitle: r.channelTitle || '', fetchedAt,
  }));
}

// Leif's own paste of one person's LinkedIn "Activity > Posts" page (Claude never opens linkedin.com). Only what
// that person wrote is kept: a repost, a comment on someone else's post and a reaction are dropped as the paste is
// read. LinkedIn shows ages ("3w"), so a date is a range, and the older end is the one the rules judge.
const ACTIVITY = [
  ['reposted', /\breposted this\b/i],
  ['commented', /\b(?:commented on|replied to)\b/i],
  ['reacted', /\b(?:likes?|liked|celebrates?|loves?|supports?|finds?) this\b|\breacted to\b/i],
];
const AGE = /^(\d+)\s?(mo|yr|m|h|d|w)\b\s*(?:•|$)/i;
const DEGREE = /^•?\s*(?:1st|2nd|3rd\+?|following|follow)\b/i;
const END = /^(?:…\s?see more|\.\.\.\s?see more|…more|see more|see less|like|comment|repost|send|share|[\d,]+|[\d,]+ (?:comments?|reposts?|reactions?)|.* and [\d,]+ others|activate to view larger image.*|no alternative text.*)$/i;
const SKIP = /^(?:edited|visible to anyone on or off linkedin|follow)$/i;

function ageRange(n, unit, today) {
  const t = Date.parse(today);
  const u = unit.toLowerCase();
  const span = { m: 0, h: 0, d: 1, w: 7, mo: 30, yr: 365 }[u];
  if (span <= 1) return { date: iso(t - n * span * DAY), dateTo: iso(t - n * span * DAY), approx: false };
  return { date: iso(t - (n * span + span - 1) * DAY), dateTo: iso(t - n * span * DAY), approx: true };
}

export function linkedinPosts(text, { name, company = '', today, source = 'paste' } = {}) {
  if (!name) throw new Error('linkedinPosts needs the name of the person the paste belongs to');
  if (Number.isNaN(Date.parse(today))) throw new Error('linkedinPosts needs today as YYYY-MM-DD');
  const dropped = { reposted: 0, commented: 0, reacted: 0, notTheirs: 0, empty: 0 };
  const flags = [];
  const posts = [];
  let headline = '';
  const chunks = String(text || '').split(/^\s*Feed post number \d+\s*$/im).slice(1);
  if (!chunks.length) flags.push('no post markers found: paste the whole Activity > Posts page, or send screenshots');
  for (const chunk of chunks) {
    const ls = chunk.split(/\r?\n/).map((l) => l.trim());
    const first = ls.findIndex(Boolean);
    if (first < 0) { dropped.empty++; continue; }
    const act = ACTIVITY.find(([, re]) => re.test(ls[first]));
    if (act) { dropped[act[0]]++; continue; }
    if (!norm(ls[first]).includes(norm(name))) { dropped.notTheirs++; continue; }
    const at = ls.findIndex((l, i) => i > first && i <= first + 8 && AGE.test(l));
    if (at < 0) { dropped.empty++; continue; }
    const head = ls.slice(first + 1, at).filter((l) => l && !DEGREE.test(l) && norm(l) !== norm(ls[first]));
    if (head.length && !headline) headline = head[head.length - 1];
    const body = [];
    for (const l of ls.slice(at + 1)) {
      if (!l || SKIP.test(l)) continue;
      if (END.test(l)) break;
      body.push(l);
    }
    if (!body.length) { dropped.empty++; continue; }
    const [, n, unit] = AGE.exec(ls[at]);
    posts.push({ id: `li:${posts.length + 1}`, kind: 'post', text: body.join('\n'), owner: 'self', source, ...ageRange(Number(n), unit, today), ...(sensitive(body.join(' ')) ? { never: true } : {}) });
  }
  if (company && headline && !norm(headline).includes(norm(company))) flags.push('changed job?');
  return { posts, dropped, headline, flags };
}

// The page Claude writes a brief from: every item on one line, led by its id. Long texts are cut for reading only;
// the checker compares a quote with the full text in the pack.
export function briefInput(pack) {
  const out = [`# Evidence for ${pack.who.title || pack.who.name || pack.who.handle}`, `read ${String(pack.fetchedAt).slice(0, 10)} · refresh or delete by ${pack.refreshBy}`];
  const s = pack.stats;
  if (s) {
    out.push('', '## Numbers (script-made: copy them, do not restate them)');
    out.push(s.typical === null ? `no typical number: ${s.why}` : `typical ${s.typical} views · average ${s.average} · best ${s.best.views} ("${s.best.title}") · ${s.method}`);
    if (s.engagement) out.push(s.engagement.rate === null ? `${ENGAGEMENT_LABEL}: not available (${s.engagement.why})` : `${ENGAGEMENT_LABEL}: ${(s.engagement.rate * 100).toFixed(1)}% over ${s.engagement.n} videos`);
    if (s.lastUpload) out.push(`last upload ${s.lastUpload.date} (${s.lastUpload.daysAgo} days ago)${s.pace ? ` · a long video about every ${s.pace.medianGapDays} days` : ''}`);
  }
  if (pack.summary) out.push('', `sponsors: ${pack.summary.sponsors} · fans: ${pack.summary.fans}${pack.managed ? ' · MANAGED BY SOMEONE ELSE: not ours to offer' : ''}`);
  if (pack.derived) {
    if (pack.derived.series.length) out.push(`series: ${pack.derived.series.map((x) => `${x.name} (${x.count} videos, latest ${x.latest.date})`).join('; ')}`);
    if (pack.derived.themes.length) out.push(`recurring words: ${pack.derived.themes.map((x) => `${x.word} ×${x.count}`).join(', ')}`);
    if (pack.derived.standouts.length) out.push(`stand-outs: ${pack.derived.standouts.map((x) => `[t:${x.id}] ${x.times}× typical`).join(', ')}`);
  }
  const order = ['title', 'sponsor', 'standing', 'paid', 'plan', 'chapter', 'description', 'reply', 'fan', 'about', 'post', 'mention'];
  const cap = { title: 50, sponsor: 20, standing: 8, paid: 20, plan: 10, chapter: 40, description: 36, reply: 12, fan: 30, about: 8, post: 25, mention: 25 };
  for (const kind of order) {
    const list = pack.items.filter((i) => i.kind === kind).slice(0, cap[kind]);
    if (!list.length) continue;
    out.push('', `## ${kind}`);
    for (const i of list) out.push(`[${i.id}] (${i.date})${i.never ? ' NEVER A HOOK' : ''}${i.quotable === false ? ' NOT QUOTABLE' : ''} ${String(i.text).replace(/\s+/g, ' ').slice(0, 240)}`);
  }
  return out.join('\n');
}
