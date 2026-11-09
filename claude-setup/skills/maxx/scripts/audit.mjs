// audit.mjs: measure every Claude Code session on this computer. Runs locally, uses no Claude usage.
// Usage: node audit.mjs [days=30]   Reads ~/.claude/projects/*/*.jsonl (read only). Prints numbers, never content.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const days = Number(process.argv[2] || 30), cutoff = Date.now() - days * 864e5;
const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
if (!fs.existsSync(root)) { console.log(`NO SESSION HISTORY at ${root}`); process.exit(0); }
const F = {}, T = { sessions: 0, mb: 0, msgs: 0, compacted: 0, cold: 0, long: 0, errors: 0, denied: 0, timeouts: 0, limits: 0 };
for (const d of fs.readdirSync(root)) {
  let fl = []; try { fl = fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of fl) {
    const fp = path.join(root, d, f), st = fs.statSync(fp); if (st.mtimeMs < cutoff) continue;
    let cwd = `(${d})`, msgs = 0, comp = false, errors = 0, denied = 0, timeouts = 0, limits = 0, times = [];
    let text; try { text = fs.readFileSync(fp, 'utf8'); } catch { continue; } // a transcript over ~512 MB cannot be one string: skip it, keep the audit
    for (const line of text.split('\n')) {
      if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.cwd && cwd.startsWith('(')) cwd = o.cwd;
      if (o.isSidechain) continue;
      if (o.isCompactSummary) comp = true;
      if (/usage limit|rate.limit|limit reached|hit your .* limit/i.test(line) && (o.type === 'system' || o.isApiErrorMessage)) limits++;
      const c = o.message?.content;
      if (o.type === 'user' && !o.isCompactSummary) {
        const human = typeof c === 'string' ? c.trim() : Array.isArray(c) && c.some(b => b?.type === 'text' && !/^\s*</.test(b.text || ''));
        if (human) { msgs++; if (o.timestamp) times.push(Date.parse(o.timestamp)); }
      }
      if (Array.isArray(c)) for (const b of c) if (b?.type === 'tool_result' && b.is_error) {
        errors++; const t = JSON.stringify(b.content || '').toLowerCase();
        if (t.includes('denied') || t.includes('permission')) denied++;
        if (t.includes('timed out') || t.includes('timeout')) timeouts++;
      }
    }
    times.sort((a, b) => a - b); const cold = times.slice(1).filter((t, i) => t - times[i] > 36e5).length;
    const long = times.length > 1 && times.at(-1) - times[0] > 5 * 36e5 ? 1 : 0;
    const r = F[cwd] ||= { sessions: 0, mb: 0, msgs: 0, compacted: 0, cold: 0, long: 0, errors: 0, denied: 0, timeouts: 0, limits: 0 };
    for (const [k, v] of Object.entries({ sessions: 1, mb: st.size / 1048576, msgs, compacted: comp ? 1 : 0, cold, long, errors, denied, timeouts, limits })) { r[k] += v; T[k] += v; }
  }
}
const rows = Object.entries(F).sort((a, b) => b[1].sessions - a[1].sessions);
const fmt = (n, r) => `${String(r.sessions).padStart(4)} ${r.mb.toFixed(1).padStart(7)} ${String(r.msgs).padStart(6)} ${String(Math.round(100 * r.compacted / r.sessions) + '%').padStart(5)} ${String(r.cold).padStart(5)} ${String(r.long).padStart(5)} ${String(r.errors).padStart(6)} ${String(r.denied).padStart(6)} ${String(r.timeouts).padStart(5)} ${String(r.limits).padStart(5)}  ${n}`;
console.log(`SESSION AUDIT · last ${days} days · ${T.sessions} sessions\n sess      MB   msgs  comp  cold  5h+  errors denied  t/o  limit  folder`);
rows.forEach(([n, r]) => console.log(fmt(n, r))); if (rows.length > 1) console.log(fmt('ALL FOLDERS', T));
const s = [];
if (T.cold > T.sessions) s.push(`${T.cold} cold restarts (back after 1h+ away): each re-reads the whole session. Use /fresh, not old sessions.`);
if (T.long) s.push(`${T.long} sessions ran past 5 hours: the session clock and /fresh are for these.`);
if (T.sessions && T.compacted / T.sessions < 0.5) s.push(`Only ${Math.round(100 * T.compacted / T.sessions)}% of sessions ever compacted: /transfer reads the rest from their newest part.`);
if (T.timeouts >= 3) s.push(`${T.timeouts} command timeouts: if they were builds or tests, a longer BASH_DEFAULT_TIMEOUT_MS helps; dev servers belong in the background.`);
if (T.denied >= 10) s.push(`${T.denied} actions stopped by safety rules: check none of them were wanted.`);
if (T.limits) s.push(`${T.limits} usage-limit stops: fresh sessions and Sonnet helpers stretch the limit.`);
console.log(s.length ? '\nSIGNALS\n- ' + s.join('\n- ') : '\nSIGNALS: none above the thresholds');
