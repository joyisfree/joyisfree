// Guard for the Qalam skill (qalam/skill/qalam). The skill must stay:
// - uploadable as a claude.ai account skill;
// - small;
// - sourced, with every ayah and hadith marked verified;
// - free of prayer times and rulings;
// - free of personal data, because this repo is public.
// Every check is also shown to fail on a broken fixture. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const QALAM = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = join(QALAM, 'skill', 'qalam');
const skillMd = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const sourcesMd = readFileSync(join(SKILL_DIR, 'references', 'sources.md'), 'utf8');

// The only frontmatter keys a claude.ai account skill accepts (joy-teams, section 6).
const ACCOUNT_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
// Personal words that must never reach this public repo. They are split so that this file never matches itself.
const PRIVATE = [['Le', 'if'], ['Syd', 'ney'], ['Ray', 'con']].map((parts) => parts.join(''));
const PRAYER = "(?:fajr|dhuhr|zuhr|asr|maghrib|isha|jumu'?ah)";
const CLOCK = '\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)\\b';
const RULING = /\b(?:halal|haram|makruh|mustahabb?|fard|wajib|sinful|obligatory)\b/i;
const FAITH_REF = /Qur'an \d+:\d+|(?:Bukhari|Muslim|Abu Dawud|Tirmidhi|Ibn Majah|Nasa'i) \d+/g;
const STUDY_REF = /\b(?:Scullin|Windred|Gollwitzer|Lally|Wright|Watson|Qaseem|Brooks) \d{4}\b/g;

export function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { keys: [], name: undefined, description: '', body: '', problems: ['no frontmatter block'] };
  const keys = [...m[1].matchAll(/^([A-Za-z][\w-]*):/gm)].map((k) => k[1]);
  const name = (m[1].match(/^name:\s*"?([^"\n]+?)"?\s*$/m) || [])[1];
  const description = (m[1].match(/^description:\s*"(.*)"\s*$/m) || [])[1] ?? '';
  return { keys, name, description, body: m[2], problems: [] };
}

export function checkFrontmatter(md, folder) {
  const f = frontmatter(md);
  const problems = [...f.problems];
  if (problems.length) return problems;
  for (const key of f.keys) if (!ACCOUNT_KEYS.includes(key)) problems.push(`frontmatter key "${key}" is not accepted by account skills`);
  if (f.name !== folder) problems.push(`name "${f.name}" does not match the folder "${folder}"`);
  if (!f.description) problems.push('the description is missing');
  if (f.description.length > 200) problems.push(`the description is ${f.description.length} characters (limit 200, claude.ai's)`);
  if (!/\bUse when\b/.test(f.description)) problems.push('the description does not say when to use the skill');
  return problems;
}

export function checkBody(md) {
  const lines = frontmatter(md).body.split('\n').length;
  return lines > 150 ? [`the body is ${lines} lines (limit 150)`] : [];
}

export function checkCitations(md, sources) {
  const problems = [];
  const lines = sources.split('\n');
  for (const ref of new Set(md.match(FAITH_REF) || [])) {
    const line = lines.find((l) => l.includes(`**${ref}**`));
    if (!line) problems.push(`${ref} is quoted but has no entry in sources.md`);
    else if (!/\bverified\b/.test(line)) problems.push(`${ref} is in sources.md but not marked verified`);
  }
  for (const ref of new Set(md.match(STUDY_REF) || [])) {
    if (!sources.includes(`**${ref}`)) problems.push(`${ref} is cited but has no entry in sources.md`);
  }
  return problems;
}

export function checkPrayerTimes(text) {
  const near = new RegExp(`${PRAYER}[^\\n]{0,30}?\\b${CLOCK}|\\b${CLOCK}[^\\n]{0,30}?${PRAYER}`, 'i');
  return near.test(text) ? ['a prayer name sits next to a clock time'] : [];
}

export function checkRulings(text) {
  const m = text.match(RULING);
  return m ? [`ruling word "${m[0]}"`] : [];
}

export function checkPrivate(files) {
  const problems = [];
  for (const [path, text] of files) {
    for (const word of PRIVATE) if (new RegExp(`\\b${word}\\b`, 'i').test(text)) problems.push(`${path} contains "${word}"`);
  }
  return problems;
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules' || name === '.DS_Store') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push([relative(QALAM, full), readFileSync(full, 'utf8')]);
  }
  return out;
}

test('the Qalam skill passes every check', () => {
  assert.deepEqual(checkFrontmatter(skillMd, 'qalam'), []);
  assert.deepEqual(checkBody(skillMd), []);
  assert.deepEqual(checkCitations(skillMd, sourcesMd), []);
  assert.deepEqual(checkPrayerTimes(skillMd), []);
  assert.deepEqual(checkPrayerTimes(sourcesMd), []);
  assert.deepEqual(checkRulings(skillMd), []);
  assert.deepEqual(checkRulings(sourcesMd), []);
  assert.deepEqual(checkPrivate(filesUnder(QALAM)), []);
});

test('each check fails on a broken fixture (the guard is wired)', () => {
  const closing = '\n---\n';
  assert.ok(checkFrontmatter(skillMd.replace(closing, `\nmodel: sonnet${closing}`), 'qalam').length, 'an extra frontmatter key');
  assert.ok(checkFrontmatter(skillMd, 'not-qalam').length, 'a name that does not match the folder');
  assert.ok(checkFrontmatter(skillMd.replace(/^description: ".*"$/m, `description: "Use when ${'x'.repeat(192)}"`), 'qalam').length, 'a description of 201 characters');
  assert.ok(checkFrontmatter(skillMd.replace('Use when', 'Use for'), 'qalam').length, 'a description that never says when');
  assert.ok(checkFrontmatter('no frontmatter here', 'qalam').length, 'a file with no frontmatter');
  assert.ok(checkBody(skillMd + '\n'.repeat(200)).length, 'a body over 150 lines');
  assert.ok(checkCitations(`${skillMd}\n(Bukhari 9999)`, sourcesMd).length, 'a hadith with no entry');
  assert.ok(checkCitations(skillMd, sourcesMd.replace('**Bukhari 1142**, verified', '**Bukhari 1142**, pending')).length, 'a hadith not marked verified');
  assert.ok(checkCitations(`${skillMd}\n(Lally 2011)`, sourcesMd).length, 'a study with no entry');
  assert.ok(checkPrayerTimes('Fajr is at 4:10am today').length, 'a prayer time after the prayer name');
  assert.ok(checkPrayerTimes('set the alarm for 4:10 am, before Fajr').length, 'a prayer time before the prayer name');
  assert.ok(checkRulings('Sleeping after Fajr is makruh').length, 'a ruling word');
  assert.ok(checkPrivate([['x.md', `Home: ${PRIVATE[1]}`]]).length, 'a personal word');
});
