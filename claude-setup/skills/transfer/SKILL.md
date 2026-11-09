---
name: "transfer"
description: "Move everything still open from old Claude Code sessions in a folder into one HANDOFF.md without reopening them; archive them on Leif's yes. Use on /transfer: transfer, merge, catch up, tidy sessions."
---

# /transfer: old sessions into one HANDOFF.md

Leif typed one word, so you do the rest. Read-only except: HANDOFF.md and Archives/ in the target folder, and archiving old sessions after his yes in step 9. Never delete a session. Never print secrets.

Why it works this way: each old session only remembers itself, and reopening an idle one re-reads all of it at full price; /compact reads it all again (Claude Code docs, "Manage costs"). Instead, a small script cuts each old session down to what a /compact would keep: the first request, the latest /compact summary (saved inside the session file, covering the whole session before it), and the conversation after it, with tool output dropped and secrets hidden. Sessions Leif already /compacted give the best input. Tested: a 6 MB session became a 54 KB digest.

- **A repo's own rules win.** If the project names its own handoff or state convention, use it instead of the file this skill names. In Quantum Garment Studio that is `docs/handoff-<date>.md` through `SHIP_PROVE=0 npm run ship`: no PROGRESS.md, no second plan beside HANDOFF.md.
- **Twin check first.** Told to read or act on a handoff, list sessions with whichever session tool you have (cloud: claude-code-remote `list_sessions`; Mac: `mcp__ccd_session_mgmt__list_sessions`, loaded with ToolSearch); with neither, say "unknown" and start no parallel work before anything else; if another session already works it, stop and tell Leif. Two conductors queue two two-hour proofs.
- **The archive step has one conductor:** the session Leif typed /transfer in. Any other session that finds itself archiving stops and points to it.

## Steps
1. Tell Leif in one line what you're doing.
2. Save the script at the bottom to a temp file (for example `$TMPDIR/digest.mjs`) and run it from this folder: `node "$TMPDIR/digest.mjs" 14 12`. Show him the result table.
   - `NO SESSIONS FOUND`: the script lists the folders that do have recent sessions. Ask Leif which one he means (one question), then run it again for that folder: `node "$TMPDIR/digest.mjs" 14 12 "" "<folder path>"`. That folder is now the target: HANDOFF.md, Archives/ and the run report go there.
   - No Node on this computer: tell him, then read the newest session files in `~/.claude/projects/<folder named after the path>/` from the end backwards instead, skipping tool output.
3. Read the digests:
   - All digests together are 120 KB or less: read them yourself.
   - Bigger than that: give each digest its own helper with the helper brief below.
4. Merge and verify:
   - Check every item against the current files and `git log`.
   - Proven beats claimed. Newer beats older. Drop what's already done. Flag conflicts.
   - An item that only comes from a grade-C session goes in only if the files confirm it.
5. If a session that matters is grade C, or its header says `older part cut: yes`, don't guess. Ask Leif whether to run a deep summary of it: `JOY_BOOT_OFF=1 claude -p --resume <session-id> --fork-session "Summarize this session for a handoff: open tasks, decisions and why, blockers, what's waiting on Leif, dead ends, key file paths."` (`JOY_BOOT_OFF=1` keeps the boot hook quiet in a headless run). Tell him first that this costs about as much as reopening that session. Run it only after his yes.
6. If HANDOFF.md exists, copy it to `Archives/HANDOFF.md.<YYYY-MM-DD-HHMM>`. Then write the new HANDOFF.md in under 700 words, in this order:
   - first line: `Bismillah. Read HANDOFF.md.`
   - second line: `Updated: <date time, Sydney> · Running in: <this session's name or link, and the repo>` (never a computer's folder path: the file is read from any device);
   - goal; done and proven; still open (most important first); decisions; waiting on Leif; don't repeat; next step with its done-check;
   - last line: sources, naming the sessions used and their grades.

   Re-read it and confirm every open item is in it. Then, only if the repository is private (`curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/<owner>/<repo>` prints 404; 200 means public), commit HANDOFF.md (and Archives/) on the current branch, your changes only; pushing leaves this machine, so it rides on Leif's yes in step 9. In a public repository never commit HANDOFF.md: keep the local copy, write it to Google Drive at `Claude Handoffs/<project>/HANDOFF.md` as well (connectmusa's handoff rule), and say so in one line.
7. Write a short run report to `Archives/transfer-report-<YYYY-MM-DD-HHMM>.md` for Leif's case study:
   - the script's table;
   - each session's grade;
   - counts: items found, kept, dropped as already done, conflicts;
   - deep summaries run;
   - whether this computer was already equipped;
   - sessions archived and skipped (added after step 9).
8. Check this computer is equipped: `~/.claude/CLAUDE.md` (or this folder's CLAUDE.md) has a "# Compact instructions" section. If not, say in one line: "Type /maxx once to equip every folder on this computer." Don't edit settings from here.
9. Tidy the folder. List the other Code tab sessions whose folder is this folder (the desktop app lets you list and archive sessions; you never see the session you're in). Ask ONE yes/no: "Archive these N old sessions so only this one stays? Each can be unarchived from the Archived tab." In Bypass or Auto mode no approval card appears, so his yes here is the approval. On yes, archive each one, except:
   - a session that is still running: leave it and say so;
   - a session whose worktree has uncommitted changes: never choose "Archive anyway"; list it so Leif can commit first.

   If this app can't list sessions (terminal or cloud), skip this step and say so. Add archived and skipped counts to the run report. In a private repository the same message carries the push: "Push HANDOFF.md so every device sees it? (recommended: yes)"; on yes, `git push`.
10. Reply with only:
   - a checklist of the open items for Leif to tick;
   - `✅ HANDOFF saved and checked in <folder> · now open a new session there (Mac Cmd+N · PC Ctrl+N · iPhone: Claude app → Code → Cloud → <repo> → new session), then type: Bismillah. Read HANDOFF.md.`

## Helper brief (use as written)
Read ONLY this digest file: <path>. Don't search or change anything. Return, in under 350 words:
- OPEN (most important first)
- DECIDED (with why)
- BLOCKED / WAITING ON LEIF
- DEAD ENDS
- FILES

Tag every item [proven] (a check, test, file or commit shows it), [claimed] or [idea]. End with: GRADE A (clear), B (mixed) or C (messy or abandoned), plus one reason. No secrets, no copied code.

## Script: digest.mjs (save exactly as written)
```js
// digest.mjs: turn this folder's past Claude Code sessions into small, safe digests.
// Usage: node digest.mjs [days=14] [max=12] [outdir] [folder=this folder]
// Reads ~/.claude/projects/<this folder>/*.jsonl (read only). Keeps: the first request, the latest
// /compact summary, and the conversation text after it. Drops tool output. Hides secrets.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [days = 14, max = 12, outArg, folderArg] = process.argv.slice(2);
const folder = path.resolve(folderArg || process.cwd());
const out = outArg || fs.mkdtempSync(path.join(os.tmpdir(), 'session-digests-'));
const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const slug = folder.replace(/[^a-zA-Z0-9]/g, '-');
let dir = process.env.SESSIONS_DIR || path.join(root, slug);
if (!fs.existsSync(dir) && slug.length > 200 && fs.existsSync(root))
  dir = path.join(root, fs.readdirSync(root).find(d => d.startsWith(slug.slice(0, 200))) || slug);
const cutoff = Date.now() - Number(days) * 864e5;
const others = () => { // which folders DO have recent sessions? reads only the start of each file
  const seen = {}; if (!fs.existsSync(root)) return '';
  for (const d of fs.readdirSync(root)) { const pd = path.join(root, d); let fl = [];
    try { fl = fs.readdirSync(pd).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of fl) { const fp = path.join(pd, f); const st = fs.statSync(fp); if (st.mtimeMs < cutoff) continue;
      const buf = Buffer.alloc(65536); const fd = fs.openSync(fp, 'r'); const len = fs.readSync(fd, buf, 0, 65536, 0); fs.closeSync(fd);
      const m = buf.toString('utf8', 0, len).match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/); const cwd = m ? JSON.parse(`"${m[1]}"`) : `(unknown: ${d})`;
      seen[cwd] = (seen[cwd] || 0) + 1; } }
  const top = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return top.length ? '\nFOLDERS WITH SESSIONS IN THE LAST ' + days + ' DAYS:\n' + top.map(([c, k]) => `${k} · ${c}`).join('\n') : '';
};
if (!fs.existsSync(dir)) { console.log(`NO SESSIONS FOUND for ${folder}` + others()); process.exit(0); }
const SECRET = [/sk-[A-Za-z0-9_-]{16,}/g, /[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, /whsec_[A-Za-z0-9]{16,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[a-z]-[A-Za-z0-9-]{10,}/g, /AKIA[0-9A-Z]{16}/g, /AIza[0-9A-Za-z_-]{30,}/g, /GOCSPX-[A-Za-z0-9_-]{20,}/g, /npm_[A-Za-z0-9]{30,}/g, /re_[A-Za-z0-9]{20,}/g,
  /sbp_[A-Za-z0-9]{20,}/g, /sb_secret_[A-Za-z0-9_-]{20,}/g, /sb_publishable_[A-Za-z0-9_-]{16,}/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/"']+:[^\s@\/"']+@[^\s"']+/gi,
  /eyJ[\w-]{15,}\.[\w-]{10,}\.[\w-]{10,}/g, /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g];
const KEYVAL = /([\w-]*(?:api[_-]?key|secret|token|password|passwd|pwd|key)[\w-]*)(["']?\s*[:=]\s*)(?:"[^"\n]{4,}"|'[^'\n]{4,}'|[^\s"']{4,})/gi;
const hide = s => SECRET.reduce((t, r) => t.replace(r, '[HIDDEN]'), s).replace(KEYVAL, '$1$2[HIDDEN]');
const TAGS = 'system-reminder|local-command-caveat|local-command-stdout|command-name|command-message|command-args|task-notification|agent-message';
const strip = t => String(t || '').replace(new RegExp(`<(${TAGS})[^>]*>[\\s\\S]*?</\\1[^>]*>`, 'g'), '').trim();
const textOf = o => { const c = o?.message?.content; if (typeof c === 'string') return strip(c);
  return Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => strip(b.text)).filter(Boolean).join('\n') : ''; };
const noise = t => !t;
const cap = (s, n, end = true) => s.length <= n ? s : end ? '…' + s.slice(-n) : s.slice(0, n) + '…';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => ({ f, st: fs.statSync(path.join(dir, f)) }))
  .filter(x => x.st.mtimeMs >= cutoff).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
const rowsOut = []; let n = 0;
for (const { f, st } of files) {
  if (n >= Number(max)) break;
  const rows = []; let bad = 0;
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { bad++; } }
  const main = rows.filter(o => !o.isSidechain && (o.type === 'user' || o.type === 'assistant'));
  const userTexts = main.filter(o => o.type === 'user' && !o.isCompactSummary && !noise(textOf(o)));
  if (userTexts.length < 3) continue; // tiny session (or this new one): skip
  const lastC = main.map(o => !!o.isCompactSummary).lastIndexOf(true);
  const convo = (lastC >= 0 ? main.slice(lastC + 1) : main).map(o => [o.type, textOf(o).trim()])
    .filter(([, t]) => !noise(t)).map(([r, t]) => `${r === 'user' ? 'LEIF' : 'CLAUDE'}: ${cap(t, 4000, false)}`).join('\n\n');
  const stamps = rows.map(o => o.timestamp).filter(Boolean).sort();
  const md = [`# Session ${f.replace(/\.jsonl$/, '')} · ${stamps[0]?.slice(0, 16) || '?'} → ${stamps.at(-1)?.slice(0, 16) || '?'}`,
    `Compacted: ${lastC >= 0 ? 'yes' : 'no'} · older part cut: ${convo.length > 40000 || (lastC >= 0 && textOf(main[lastC]).length > 30000) ? 'yes' : 'no'} · your messages: ${userTexts.length} · unreadable lines: ${bad}`,
    `## First request\n${cap(textOf(userTexts[0]).trim(), 1500, false)}`,
    lastC >= 0 ? `## Latest /compact summary\n${cap(textOf(main[lastC]).trim(), 30000)}` : '',
    `## Conversation ${lastC >= 0 ? 'after that summary' : '(never compacted, newest part kept)'}\n${cap(convo, 40000)}`]
    .filter(Boolean).join('\n\n');
  n++; const name = `${String(n).padStart(2, '0')}-${(stamps.at(-1) || '').slice(0, 10)}-${f.slice(0, 8)}.md`;
  fs.writeFileSync(path.join(out, name), hide(md));
  rowsOut.push(`${name}  raw ${Math.round(st.size / 1024)} KB → digest ${Math.round(md.length / 1024)} KB  compacted:${lastC >= 0 ? 'yes' : 'no'}  cut:${convo.length > 40000 ? 'yes' : 'no'}`);
}
console.log(`DIGESTS for ${folder} in ${out}\n` + (rowsOut.join('\n') || 'none (no sessions with 3+ messages in range)' + others()));
```