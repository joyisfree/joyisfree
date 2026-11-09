// check.mjs: prove a settings change kept every guardrail. Usage: node check.mjs <backup.json> <settings.json>
import fs from 'node:fs';
const [bf, af] = process.argv.slice(2); let a, b;
const out = [], bad = [], same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
// No backup means settings.json did not exist before /maxx ran (step 3 backs up only what exists): compare with nothing.
try { a = JSON.parse(fs.readFileSync(bf, 'utf8')); } catch (e) { if (e.code === 'ENOENT') { a = {}; out.push('no backup: settings.json did not exist before'); } else { console.log(`FAIL backup unreadable: ${e.message}`); process.exit(1); } }
try { b = JSON.parse(fs.readFileSync(af, 'utf8')); } catch (e) { console.log(`FAIL settings.json no longer parses: ${e.message}`); process.exit(1); }
for (const k of ['deny', 'allow', 'ask']) { const x = a.permissions?.[k] || [], y = b.permissions?.[k] || [];
  const lost = x.filter(r => !y.includes(r)); (lost.length ? bad : out).push(`${k} rules ${x.length} -> ${y.length}${lost.length ? ` · LOST: ${lost.slice(0, 3).join(' | ')}` : ''}`); }
// The one hook /maxx may add is Joy Boot's SessionStart entry, exactly as written (plain or --verdict-only); any other hook change still fails.
const canon = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
const JOY = ['', ' --verdict-only'].map(f => canon({ matcher: 'startup|resume|clear|fork', hooks: [{ type: 'command', command: `[ -f ~/.claude/hooks/joy-boot.mjs ] && node ~/.claude/hooks/joy-boot.mjs${f} 2>/dev/null || true`, timeout: 5 }] }));
const noJoy = h => { if (!h) return h; const c = JSON.parse(JSON.stringify(h)); if (Array.isArray(c.SessionStart)) { c.SessionStart = c.SessionStart.filter(e => !JOY.includes(canon(e))); if (!c.SessionStart.length) delete c.SessionStart; } return Object.keys(c).length ? c : undefined; };
const hooksOk = same(a.hooks, b.hooks) || same(noJoy(a.hooks), noJoy(b.hooks));
(hooksOk ? out : bad).push(!hooksOk ? 'hooks CHANGED beyond the Joy Boot entry: compare them by hand' : same(a.hooks, b.hooks) ? `hooks unchanged (${Object.keys(a.hooks || {}).join(', ') || 'none'})` : 'hooks: only the Joy Boot SessionStart entry differs (allowed)');
const lostEnv = Object.keys(a.env || {}).filter(k => !(k in (b.env || {})) || a.env[k] !== b.env[k]);
(lostEnv.length ? bad : out).push(lostEnv.length ? `env CHANGED or LOST: ${lostEnv.join(', ')}` : `env kept (${Object.keys(a.env || {}).length}) · added: ${Object.keys(b.env || {}).filter(k => !(k in (a.env || {}))).join(', ') || 'none'}`);
const lostTop = Object.keys(a).filter(k => !(k in b)); (lostTop.length ? bad : out).push(lostTop.length ? `top-level settings LOST: ${lostTop.join(', ')}` : 'no top-level setting lost');
out.push(`permission mode ${a.permissions?.defaultMode || '(unset)'} -> ${b.permissions?.defaultMode || '(unset)'}`);
console.log([...out.map(l => 'ok   ' + l), ...bad.map(l => 'FAIL ' + l)].join('\n') + `\n${bad.length ? 'FAIL: restore the backup' : 'PASS'}`);
process.exit(bad.length ? 1 : 0);
