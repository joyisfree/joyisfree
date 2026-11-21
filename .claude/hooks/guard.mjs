#!/usr/bin/env node
// The destructive-command guard: a PreToolUse hook on every Bash call (.claude/settings.json). It reads the command
// the way the shell will and blocks the few commands that lose work for good: a force, mirror or delete push in any
// spelling, a hard reset, git clean -f, a history rewrite, and a recursive rm (or find -delete, or xargs rm) of
// anything not strictly beneath /tmp or the temp folder. Unknown is never a pass: a path, a flag or a command name the
// guard cannot read is refused with the reason, and so is a command it cannot tokenise. It allows what the work
// needs: push -u, heredoc commits whose message mentions a force push, pull --rebase, merge --ff-only, cherry-pick,
// worktrees, git archive | tar, and rm -rf of a literal path inside a scratchpad.
//
//   echo '{"tool_name":"Bash","tool_input":{"command":"git push -f"},"cwd":"/repo"}' | node .claude/hooks/guard.mjs
//   # exit 0 allows; exit 2 blocks, with the reason on stderr, which Claude Code hands back to Claude
//
// The settings run it as `node … || exit 2`, so a crash blocks too. It is a seat belt, not a sandbox: a program that
// deletes through its own code (node -e, python -c, a script file) is out of its reach, and so is git config that
// runs commands (an alias in a config file is caught only because an unknown git subcommand is refused).

import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const { dirname, basename, resolve: resolvePath } = posix;

class Denied extends Error {}
const deny = (why) => {
  throw new Denied(why);
};

// ------------------------------------------------------------------------------------------------------ the tokeniser

const SEPARATORS = ' \t\n;&|()<>';
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish']);
// Words that open or close shell grammar rather than name a command; the command is the word after them.
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac']);

const blank = () => ({ w: '', dyn: false, dynAt: -1, splits: false, quoted: false, raw: '' });

/** Part of the word from here on is only known when the shell runs; `splits` when it is unquoted, so it can split. */
function mark(w, splits) {
  if (!w.dyn) {
    w.dyn = true;
    w.dynAt = w.w.length;
  }
  if (splits) w.splits = true;
}

/**
 * The command as the shell will split it: an array of { op } separators (; && || | & newline and the ( ) of a
 * subshell) and { w, dyn, dynAt, splits, raw } words. `w` is the word with quotes and escapes removed; `dyn` says part
 * of it is only known when the shell runs (an expansion, a substitution, a glob, a brace or a ~), `dynAt` is where that
 * part starts in `w`, and `splits` says it is unquoted, so it can become several words. The commands inside a $( ), a
 * backtick, a <( ), a `bash -c` or `sh -c` script and an eval are read too, and come first as a ( ) group. Heredoc
 * bodies are data (a shell that reads one as its script gets it as `stdin` on its first word). Redirections are
 * dropped, after their targets are read for substitutions. Throws when the command is unbalanced.
 */
export function words(cmd) {
  if (typeof cmd !== 'string') throw new Error('the command is not text');
  return seq({ s: cmd, i: 0 }, false);
}

function seq(p, sub) {
  const s = p.s;
  const out = [];
  let start = 0; // where the simple command being read begins in `out`: a substitution's group goes in before it
  let depth = 0;
  let pending = [];
  let cmd = { words: [], herestring: null };
  const group = (toks) => {
    out.splice(start, 0, { op: '(' }, ...toks, { op: ')' });
    start += toks.length + 2;
  };
  const close = () => {
    if (cmd.herestring && cmd.words.length) cmd.words[0].stdin = { word: cmd.herestring };
    scripts(cmd.words, group);
  };
  const op = (o) => {
    close();
    out.push({ op: o });
    start = out.length;
    cmd = { words: [], herestring: null };
  };
  const target = () => {
    while (s[p.i] === ' ' || s[p.i] === '\t') p.i++;
    if (p.i >= s.length || SEPARATORS.includes(s[p.i])) throw new Error('a redirection with nothing to redirect to');
    return word(p, group);
  };
  for (;;) {
    if (p.i >= s.length) {
      if (sub) throw new Error('a $( or <( with no )');
      if (depth) throw new Error('a ( with no )');
      if (pending.length) throw new Error(`the heredoc ${pending[0].delim} never ends`);
      close();
      return out;
    }
    const c = s[p.i];
    const n = s[p.i + 1];
    if (c === ' ' || c === '\t') p.i++;
    else if (c === '\\' && n === '\n') p.i += 2;
    else if (c === '#') while (p.i < s.length && s[p.i] !== '\n') p.i++;
    else if (c === '\n') {
      p.i++;
      op('\n');
      if (pending.length) heredocs(p, pending, group);
      pending = [];
    } else if (c === ';') {
      p.i += n === ';' ? (s[p.i + 2] === '&' ? 3 : 2) : n === '&' ? 2 : 1;
      op(';');
    } else if (c === '&' && n === '&') {
      p.i += 2;
      op('&&');
    } else if (c === '&' && n === '>') {
      p.i += s[p.i + 2] === '>' ? 3 : 2;
      target();
    } else if (c === '&') {
      p.i++;
      op('&');
    } else if (c === '|' && n === '|') {
      p.i += 2;
      op('||');
    } else if (c === '|') {
      p.i += n === '&' ? 2 : 1;
      op('|');
    } else if (c === '(') {
      p.i++;
      op('(');
      depth++;
    } else if (c === ')' && depth) {
      p.i++;
      op(')');
      depth--;
    } else if (c === ')' && sub) {
      p.i++;
      if (pending.length) throw new Error(`the heredoc ${pending[0].delim} never ends`);
      close();
      return out;
    } else if (c === ')') throw new Error('a ) with no (');
    else if ((c === '<' || c === '>') && n === '(') {
      const w = procsub(p, group);
      out.push(w);
      cmd.words.push(w);
    } else if (c === '<' && n === '<') {
      p.i += 2;
      if (s[p.i] === '<') {
        p.i++;
        cmd.herestring = target();
      } else {
        const strip = s[p.i] === '-';
        if (strip) p.i++;
        const d = target();
        pending.push({ delim: d.w, quoted: d.quoted, strip, cmd });
      }
    } else if (c === '<' || c === '>') {
      p.i++;
      if (s[p.i] === '>' || s[p.i] === '&' || s[p.i] === '|') p.i++;
      target();
    } else {
      const w = word(p, group);
      // 2>&1: digits written against a redirection are its file descriptor, not a word
      if (!/^\d+$/.test(w.raw) || (s[p.i] !== '<' && s[p.i] !== '>')) {
        out.push(w);
        cmd.words.push(w);
      }
    }
  }
}

/** Reads the bodies of the heredocs opened on the line just ended; an unquoted one runs its $( ) and backticks. */
function heredocs(p, list, group) {
  const s = p.s;
  for (const h of list) {
    const lines = [];
    for (;;) {
      if (p.i >= s.length) throw new Error(`the heredoc ${h.delim} never ends`);
      let e = s.indexOf('\n', p.i);
      if (e < 0) e = s.length;
      const line = s.slice(p.i, e);
      p.i = Math.min(e + 1, s.length);
      let k = 0;
      if (h.strip) while (line[k] === '\t') k++;
      if (line.slice(k) === h.delim) break;
      lines.push(line);
    }
    const text = lines.join('\n');
    if (!h.quoted) dq({ s: text, i: 0 }, blank(), group, '');
    if (h.cmd.words.length) h.cmd.words[0].stdin = { text, quoted: h.quoted };
  }
}

const later = (s, i, ch) => {
  for (let k = i + 1; k < s.length && !SEPARATORS.includes(s[k]); k++) if (s[k] === ch) return true;
  return false;
};
// {a,b} and {1..3} expand; {} and {x} stay as they are
const braces = (s, i) => {
  let list = false;
  for (let k = i + 1; k < s.length && !SEPARATORS.includes(s[k]); k++) {
    if (s[k] === '}') return list;
    if (s[k] === ',' || (s[k] === '.' && s[k + 1] === '.')) list = true;
  }
  return false;
};

function word(p, group) {
  const s = p.s;
  const begin = p.i;
  const w = blank();
  while (p.i < s.length && !SEPARATORS.includes(s[p.i])) {
    const c = s[p.i];
    if (c === '\\') {
      if (p.i + 1 >= s.length) throw new Error('a \\ with nothing after it');
      if (s[p.i + 1] !== '\n') {
        w.w += s[p.i + 1];
        w.quoted = true;
      }
      p.i += 2;
    } else if (c === "'") {
      const e = s.indexOf("'", p.i + 1);
      if (e < 0) throw new Error("a ' with no closing '");
      w.w += s.slice(p.i + 1, e);
      w.quoted = true;
      p.i = e + 1;
    } else if (c === '"' || (c === '$' && s[p.i + 1] === '"')) {
      p.i += c === '$' ? 2 : 1;
      w.quoted = true;
      dq(p, w, group, '"');
    } else if (c === '$' && s[p.i + 1] === "'") ansi(p, w);
    else if (c === '$') dollar(p, w, group, true);
    else if (c === '`') backtick(p, w, group, true, false);
    else {
      const glob = c === '*' || c === '?' || (c === '[' && later(s, p.i, ']'));
      if (glob || (c === '{' && braces(s, p.i)) || (c === '~' && p.i === begin)) mark(w, true);
      w.w += c;
      p.i++;
    }
  }
  w.raw = s.slice(begin, p.i);
  return w;
}

/** Double-quoted text up to `end` (or, for a heredoc body, `end` is '' and it runs to the end of the text). */
function dq(p, w, group, end) {
  const s = p.s;
  for (;;) {
    if (p.i >= s.length) {
      if (end) throw new Error('a " with no closing "');
      return;
    }
    const c = s[p.i];
    if (end && c === end) {
      p.i++;
      return;
    }
    if (c === '\\') {
      const n = s[p.i + 1];
      if (n === '\n') p.i += 2;
      else if (n === '$' || n === '`' || n === '\\' || (end && n === '"')) {
        w.w += n;
        p.i += 2;
      } else {
        w.w += c;
        p.i++;
      }
    } else if (c === '$') dollar(p, w, group, false);
    else if (c === '`') backtick(p, w, group, false, Boolean(end));
    else {
      w.w += c;
      p.i++;
    }
  }
}

function dollar(p, w, group, unquoted) {
  const s = p.s;
  const at = p.i;
  const n = s[p.i + 1];
  if (n === '(' && s[p.i + 2] === '(') arith(p, group);
  else if (n === '(') {
    p.i += 2;
    group(seq(p, true));
  } else if (n === '{') {
    p.i += 2;
    braced(p, group);
  } else if (n !== undefined && /[A-Za-z_]/.test(n)) {
    p.i += 2;
    while (p.i < s.length && /\w/.test(s[p.i])) p.i++;
  } else if (n !== undefined && /[0-9@*#?$!-]/.test(n)) p.i += 2;
  else {
    w.w += '$'; // a lone $ is just a $
    p.i++;
    return;
  }
  mark(w, unquoted);
  w.w += s.slice(at, p.i);
}

function arith(p, group) {
  const s = p.s;
  const scratch = blank();
  let depth = 2;
  p.i += 3;
  while (depth) {
    if (p.i >= s.length) throw new Error('a $(( with no ))');
    const c = s[p.i];
    if (c === '$') dollar(p, scratch, group, false);
    else if (c === '`') backtick(p, scratch, group, false, false);
    else {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      p.i++;
    }
  }
}

function braced(p, group) {
  const s = p.s;
  const scratch = blank();
  let depth = 1;
  while (depth) {
    if (p.i >= s.length) throw new Error('a ${ with no }');
    const c = s[p.i];
    if (c === '\\') p.i += 2;
    else if (c === "'") {
      const e = s.indexOf("'", p.i + 1);
      if (e < 0) throw new Error("a ' with no closing '");
      p.i = e + 1;
    } else if (c === '"') {
      p.i++;
      dq(p, scratch, group, '"');
    } else if (c === '$') dollar(p, scratch, group, false);
    else if (c === '`') backtick(p, scratch, group, false, false);
    else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      p.i++;
    }
  }
}

function backtick(p, w, group, unquoted, inDq) {
  const s = p.s;
  const at = p.i;
  let inner = '';
  for (p.i++; ; ) {
    if (p.i >= s.length) throw new Error('a ` with no closing `');
    const c = s[p.i];
    const n = s[p.i + 1];
    if (c === '`') {
      p.i++;
      break;
    }
    if (c === '\\' && n !== undefined && (n === '$' || n === '`' || n === '\\' || (inDq && n === '"'))) {
      inner += n;
      p.i += 2;
    } else {
      inner += c;
      p.i++;
    }
  }
  group(words(inner));
  mark(w, unquoted);
  w.w += s.slice(at, p.i);
}

/** $'…': one word; an escape inside is not decoded, so the word counts as unknown. */
function ansi(p, w) {
  const s = p.s;
  p.i += 2;
  w.quoted = true;
  for (;;) {
    if (p.i >= s.length) throw new Error("a $' with no closing '");
    const c = s[p.i];
    if (c === "'") {
      p.i++;
      return;
    }
    if (c === '\\') {
      mark(w, false);
      w.w += s.slice(p.i, p.i + 2);
      p.i += 2;
    } else {
      w.w += c;
      p.i++;
    }
  }
}

function procsub(p, group) {
  const at = p.i;
  p.i += 2;
  const inner = seq(p, true);
  group(inner);
  const w = blank();
  mark(w, false);
  w.w = p.s.slice(at, p.i);
  w.raw = w.w;
  return w;
}

function assignment(w) {
  const m = /^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.exec(w.w);
  return Boolean(m) && (!w.dyn || w.dynAt >= m[0].length);
}

/** A shell's own options: whether -c is among them, where its first operand is, and whether an option is unknown. */
function shellArgs(ws, j) {
  let c = false;
  for (; j < ws.length; j++) {
    const v = ws[j].w;
    if (ws[j].dyn) return { c, at: j, dyn: true };
    if (v === '--' || v === '-') return { c, at: j + 1, dyn: false };
    if (!/^[-+]./.test(v)) break;
    if (v.startsWith('--')) {
      if (v === '--rcfile' || v === '--init-file') j++;
      continue;
    }
    if (v.includes('c')) c = true;
    if (/[oO]/.test(v)) j++;
  }
  return { c, at: j, dyn: false };
}

/**
 * The scripts a simple command runs from its own words: `bash -c '…'` anywhere in it (behind sudo, xargs or
 * find -exec too), and, where it is the command, eval's words and trap's command.
 */
function scripts(ws, group) {
  for (let k = 0; k < ws.length; k++) {
    if (ws[k].dyn || !SHELLS.has(basename(ws[k].w))) continue;
    const r = shellArgs(ws, k + 1);
    const script = ws[r.at];
    if (!r.c || !script) continue;
    if (script.dyn) throw new Error(`${ws[k].w} -c runs a script built at runtime`);
    group(words(script.w));
  }
  let k = 0;
  while (k < ws.length && (assignment(ws[k]) || (!ws[k].dyn && RESERVED.has(ws[k].w)))) k++;
  if (k < ws.length && !ws[k].dyn && (ws[k].w === 'command' || ws[k].w === 'builtin')) k++;
  const name = k < ws.length && !ws[k].dyn ? ws[k].w : '';
  if (name === 'eval') {
    const rest = ws.slice(k + 1);
    if (rest.some((w) => w.dyn)) throw new Error('eval of text built at runtime');
    group(words(rest.map((w) => w.w).join(' ')));
  }
  const action = ws[k + 1];
  if (name === 'trap' && action && !/^-[lp]$/.test(action.w)) {
    if (action.dyn) throw new Error('trap of a command built at runtime');
    group(words(action.w));
  }
}

// ---------------------------------------------------------------------------------------------- following the cwd

// The shell's grammar, read for what each command runs and from which folder. A folder is tracked as the set of
// places the shell can be in: `cd /x && rm -rf y` removes /x/y, but `cd /x; rm -rf y` may remove ./y (the cd can
// fail), so after a ; both count. A subshell's cd stays inside it; null is a folder the guard cannot follow.
const union = (...sets) => [...new Set(sets.flat())];
const LOOPS = new Set(['for', 'while', 'until', 'select', 'function']);
const hasLoops = (toks) =>
  toks.some((t, k) => (!t.op && !t.dyn && LOOPS.has(t.w)) || (t.op === '(' && toks[k + 1] && toks[k + 1].op === ')'));

function run(toks, I, ctx) {
  const inner = { ...ctx, loops: ctx.loops || hasLoops(toks) };
  // in a loop or a function a command can run again after a later cd, so no relative path is known
  const r = list(toks, 0, inner.loops ? [null] : I, inner);
  if (r.i !== toks.length) throw new Error('the guard did not read the command to its end');
}

function list(t, i, I, ctx) {
  let cur = I;
  for (;;) {
    while (i < t.length && (t[i].op === ';' || t[i].op === '\n' || t[i].op === '&')) i++;
    if (i >= t.length || t[i].op === ')') return { i, out: cur };
    const from = i;
    let r = pipeline(t, i, cur, ctx);
    let S = r.S;
    let F = r.F;
    i = r.i;
    while (i < t.length && (t[i].op === '&&' || t[i].op === '||')) {
      const and = t[i].op === '&&';
      i++;
      while (i < t.length && t[i].op === '\n') i++;
      r = pipeline(t, i, and ? S : F, ctx);
      if (and) {
        S = r.S;
        F = union(F, r.F);
      } else {
        S = union(S, r.S);
        F = r.F;
      }
      i = r.i;
    }
    cur = union(S, F);
    if (i === from) throw new Error('the guard could not read past a separator');
  }
}

function pipeline(t, i, I, ctx) {
  let r = command(t, i, I, ctx, Boolean(ctx.piped));
  if (!t[r.i] || t[r.i].op !== '|') return r;
  let all = union(r.S, r.F);
  while (t[r.i] && t[r.i].op === '|') {
    let j = r.i + 1;
    while (t[j] && t[j].op === '\n') j++;
    r = command(t, j, I, ctx, true);
    all = union(all, r.S, r.F);
  }
  return { S: all, F: all, i: r.i };
}

function command(t, i, I, ctx, piped) {
  // a subshell's cd stays inside it, so what follows starts from I again; in a pipeline it reads the pipe throughout
  while (t[i] && t[i].op === '(') {
    i = list(t, i + 1, I, piped ? { ...ctx, piped: true } : ctx).i;
    if (!t[i] || t[i].op !== ')') throw new Error('a ( with no )');
    i++;
  }
  const ws = [];
  while (i < t.length && !t[i].op) ws.push(t[i++]);
  if (!ws.length) return { S: I, F: I, i };
  const r = judge(ws, I, ctx, piped);
  return { S: r.S, F: r.F, i };
}

// ------------------------------------------------------------------------------------------------------ the judge

// Commands that run another command: how to step over their own options to reach it. flags: options with no value;
// vals: options that take one; chdir: options that run it somewhere else; skip: plain words before the command
// (timeout's duration); tail: the command gets arguments the guard never sees (xargs); direct: it runs in this shell,
// so a cd still moves it; strict: an unknown option is refused (env -S, which splits a string into a command, is one).
const WRAPPERS = {
  env: { assign: true, dash: true, strict: true, flags: 'i0v', long: ['ignore-environment', 'null', 'debug'], vals: 'uC', longVals: ['unset', 'chdir'], chdir: ['C', 'chdir'] },
  sudo: { vals: 'CDghpRrTtUu', longVals: ['chdir', 'chroot', 'close-from', 'group', 'host', 'prompt', 'role', 'type', 'command-timeout', 'other-user', 'user'], chdir: ['D', 'R', 'chdir', 'chroot'] },
  doas: { vals: 'uC' },
  nohup: {},
  nice: { numeric: true, vals: 'n', longVals: ['adjustment'] },
  timeout: { vals: 'sk', longVals: ['signal', 'kill-after'], skip: 1 },
  stdbuf: { vals: 'ioe', longVals: ['input', 'output', 'error'] },
  setsid: {},
  xargs: { vals: 'adEILnPs', optional: 'eil', longVals: ['arg-file', 'delimiter', 'max-args', 'max-procs', 'max-chars', 'process-slot-var'], tail: true },
  exec: { vals: 'a' },
  busybox: {},
  command: { direct: true, lookup: 'vV' },
  builtin: { direct: true },
  time: { direct: true },
};

function wrapper(name, spec, ws, j, st) {
  let skip = spec.skip || 0;
  for (; j < ws.length; j++) {
    const a = ws[j];
    const v = a.w;
    if (spec.assign && assignment(a)) continue;
    if (a.dyn) deny(`${name} ${a.raw}: an argument built at runtime, so the guard cannot tell what it runs`);
    if (v === '--') return j + 1;
    if (v === '-' && spec.dash) continue;
    if (v.startsWith('--')) {
      const eq = v.indexOf('=');
      const opt = v.slice(2, eq < 0 ? undefined : eq);
      if ((spec.chdir || []).includes(opt)) st.chdir = true;
      if ((spec.longVals || []).includes(opt)) {
        if (eq < 0) j++;
      } else if (spec.strict && !(spec.long || []).includes(opt)) deny(`${name} ${v}: an option the guard does not know`);
      continue;
    }
    if (v.startsWith('-') && v.length > 1) {
      if (spec.numeric && /^-\d+$/.test(v)) continue;
      for (let k = 1; k < v.length; k++) {
        const ch = v[k];
        if ((spec.lookup || '').includes(ch)) return -1; // command -v: a lookup, nothing runs
        if ((spec.vals || '').includes(ch)) {
          if ((spec.chdir || []).includes(ch)) st.chdir = true;
          if (k === v.length - 1) j++;
          break;
        }
        if ((spec.optional || '').includes(ch)) break;
        if (spec.strict && !(spec.flags || '').includes(ch)) deny(`${name} -${ch}: an option the guard does not know`);
      }
      continue;
    }
    if (skip) {
      skip--;
      continue;
    }
    break;
  }
  if (spec.tail) st.tail = true;
  return j;
}

/** The program a word names. A name built at runtime is refused, except "$DIR"/literal/name, quoted. */
function commandName(w) {
  if (!w.dyn) return basename(w.w);
  const m = /^\$\{?[A-Za-z_]\w*\}?(?:\/[^/$`]+)*\/([^/$`]+)$/.exec(w.w);
  if (m && !w.splits) return m[1];
  return deny(`the command ${w.raw} is built at runtime, so the guard cannot tell what it runs`);
}

// What xargs adds to the end of the command: arguments the guard never sees.
const UNSEEN = { w: '', dyn: true, dynAt: 0, splits: true, quoted: false, raw: '<what xargs reads>' };
// The head of a for, select or case runs nothing itself; its body starts after the next separator.
const NOOPS = new Set(['for', 'select', 'case']);

/** One simple command. Returns where the shell can be after it succeeds (S) and after it fails (F), and its name. */
function judge(ws, I, ctx, piped) {
  const st = { chdir: false, tail: false };
  let direct = true;
  let k = 0;
  for (;;) {
    while (k < ws.length && assignment(ws[k])) k++;
    if (k >= ws.length) return { S: I, F: I, name: '' };
    const head = commandName(ws[k]);
    if (RESERVED.has(head)) {
      k++;
      continue;
    }
    // `function f { … }` and `coproc NAME { … }`: the name is not a command, the body after it is
    if (head === 'function' || (head === 'coproc' && ws[k + 2] && ws[k + 2].w === '{')) {
      k += 2;
      continue;
    }
    if (head === 'coproc') {
      k++;
      continue;
    }
    if (NOOPS.has(head)) return { S: I, F: I, name: head };
    const spec = WRAPPERS[head];
    if (!spec) break;
    if (!spec.direct) direct = false;
    k = wrapper(head, spec, ws, k + 1, st);
    if (k < 0) return { S: I, F: I, name: head };
  }
  const name = commandName(ws[k]);
  const args = ws.slice(k + 1);
  if (st.tail) args.push(UNSEEN);
  const at = st.chdir ? [null] : I;
  if (name === 'git') git(args);
  else if (name === 'rm') rm(args, at, ctx);
  else if (name === 'find') find(args, at, ctx);
  else if (SHELLS.has(name)) shell(name, args, ws[0].stdin, at, ctx, piped);
  else if (direct && (name === 'cd' || name === 'pushd')) return { ...cd(args, I), name };
  else if (direct && name === 'popd') return { S: [null], F: I, name };
  return { S: I, F: I, name };
}

function cd(args, I) {
  const d = args.length === 2 && !args[0].dyn && args[0].w === '--' ? args[1] : args.length === 1 ? args[0] : null;
  // only a literal absolute path or one starting with . or ..: a bare name may go anywhere on CDPATH
  const known = d && !d.dyn && /^(\/|\.\.?(\/|$))/.test(d.w);
  if (!known) return { S: [null], F: I };
  return { S: I.map((c) => (d.w.startsWith('/') ? resolvePath(d.w) : c === null ? null : resolvePath(c, d.w))), F: I };
}

/** A shell with no -c and no script file reads its commands from stdin: a heredoc or here-string is read as a script. */
function shell(name, args, stdin, I, ctx, piped) {
  const r = shellArgs(args, 0);
  if (r.dyn) deny(`${name} with an argument built at runtime, so the guard cannot tell what it runs`);
  if (r.c || r.at < args.length) return; // the -c script was read with the words; a script file is out of reach
  if (stdin && stdin.text !== undefined) {
    if (!stdin.quoted && /[$`]/.test(stdin.text)) deny(`${name} reads a heredoc script built at runtime (quote the delimiter: <<'EOF')`);
    return script(name, stdin.text, I, ctx);
  }
  if (stdin && stdin.word) {
    if (stdin.word.dyn) deny(`${name} reads a here-string script built at runtime`);
    return script(name, stdin.word.w, I, ctx);
  }
  if (piped) deny(`${name} reads its commands from a pipe the guard cannot see`);
}

function script(name, text, I, ctx) {
  let toks;
  try {
    toks = words(text);
  } catch (e) {
    deny(`${name} reads a script the guard cannot read (${e.message})`);
  }
  run(toks, I, ctx);
}

// ------------------------------------------------------------------------------------------------------------- git

const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source']);
const GIT_FLAG = new Set(['-p', '--paginate', '-P', '--no-pager', '--no-replace-objects', '--no-lazy-fetch', '--bare', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--no-optional-locks', '--no-advice', '--exec-path', '--html-path', '--man-path', '--info-path', '--version', '-v', '--help', '-h']);
const REWRITE = new Set(['filter-branch', 'filter-repo', 'replace', 'update-ref']);
// git's own commands. Anything else could be an alias (git pf = push --force), so it is refused: spell it out.
const GIT_COMMANDS = new Set(
  ('add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-mailmap ' +
    'check-ref-format checkout checkout-index cherry cherry-pick citool clean clone column commit commit-graph ' +
    'commit-tree config count-objects credential describe diff diff-files diff-index diff-tree difftool fetch ' +
    'fetch-pack filter-branch filter-repo for-each-ref format-patch fsck gc get-tar-commit-id grep gui hash-object help index-pack init ' +
    'init-db instaweb interpret-trailers lfs log ls-files ls-remote ls-tree maintenance merge merge-base merge-file ' +
    'merge-index merge-tree mergetool mktag mktree mv name-rev notes pack-objects pack-refs prune prune-packed ' +
    'pull push range-diff read-tree rebase reflog remote repack replace request-pull rerere reset restore rev-list ' +
    'rev-parse revert rm send-email shortlog show show-branch show-index show-ref sparse-checkout stash status ' +
    'stripspace submodule switch symbolic-ref tag unpack-objects update-index update-ref update-server-info var ' +
    'verify-commit verify-pack verify-tag version whatchanged worktree write-tree').split(' '),
);

const value = (args, j, items) => {
  if (args[j + 1] && args[j + 1].splits) items.push({ kind: 'dyn', a: args[j + 1] });
  return j + 1;
};

/**
 * A git command's arguments the way git's option parser reads them, as far as the guard needs: short flags may be
 * combined (-fu), a flag that takes a value takes the rest of its cluster or the next word, a long option may be any
 * prefix (git takes an unambiguous one), and after -- every word is an operand. A word built at runtime is 'dyn' where
 * it could be an option, 'dynpos' where it can only be an operand; an unquoted one is always 'dyn'.
 */
function opts(args, shortVal = '', longVal = []) {
  const items = [];
  let end = false;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    const v = a.w;
    const lit = a.dyn ? v.slice(0, a.dynAt) : v;
    if (a.splits) items.push({ kind: 'dyn', a });
    else if (end) items.push({ kind: a.dyn ? 'dynpos' : 'pos', a, lit });
    else if (v === '--' && !a.dyn) end = true;
    else if (lit.startsWith('--')) {
      const eq = lit.indexOf('=');
      if (a.dyn && eq < 0) items.push({ kind: 'dyn', a });
      else {
        const name = (eq < 0 ? v : v.slice(0, eq)).slice(2);
        items.push({ kind: 'long', name, a });
        if (eq < 0 && longVal.includes(name)) j = value(args, j, items);
      }
    } else if (lit.startsWith('-') && lit.length > 1) {
      for (let k = 1; ; k++) {
        if (k >= lit.length) {
          if (a.dyn) items.push({ kind: 'dyn', a });
          break;
        }
        items.push({ kind: 'short', ch: lit[k], a });
        if (shortVal.includes(lit[k])) {
          if (k === v.length - 1) j = value(args, j, items);
          break;
        }
      }
    } else items.push({ kind: !a.dyn ? 'pos' : lit && !lit.startsWith('-') ? 'dynpos' : 'dyn', a, lit });
  }
  return items;
}

const PUSH_DANGER = ['force', 'force-with-lease', 'force-if-includes', 'mirror', 'delete', 'prune'];
const operandOf = (it) => it.kind === 'pos' || it.kind === 'dynpos';

const RULES = {
  push(args, config) {
    for (const c of config) {
      if (c.dyn) deny('git -c with a value built at runtime, before a push');
      const eq = c.w.indexOf('=');
      const key = (eq < 0 ? c.w : c.w.slice(0, eq)).toLowerCase();
      if (key.startsWith('remote.') || key.startsWith('push.')) deny(`git -c ${key} before a push can make it a forced or mirror push`);
    }
    for (const it of opts(args, 'o', ['push-option', 'repo', 'receive-pack', 'exec'])) {
      if (it.kind === 'dyn') deny(`git push ${it.a.raw}: an argument built at runtime, which could be --force; write the remote and branch out`);
      if (it.kind === 'dynpos' && !it.lit) deny(`git push ${it.a.raw}: a refspec built at runtime, which could start with + or :`);
      if (it.kind === 'short' && it.ch === 'f') deny('git push -f: a force push');
      if (it.kind === 'short' && it.ch === 'd') deny('git push -d: deletes a remote branch');
      if (it.kind === 'long' && PUSH_DANGER.some((d) => d.startsWith(it.name))) deny(`git push --${it.name}: a force, mirror, prune or delete push`);
      if (operandOf(it) && it.lit.startsWith('+')) deny(`git push ${it.a.raw}: a +refspec forces the push`);
      if (operandOf(it) && it.lit.startsWith(':')) deny(`git push ${it.a.raw}: a :branch refspec deletes the remote branch`);
    }
  },
  reset(args) {
    for (const it of opts(args, '', ['pathspec-from-file'])) {
      if (it.kind === 'dyn') deny(`git reset ${it.a.raw}: an argument built at runtime, which could be --hard`);
      if (it.kind === 'long' && 'hard'.startsWith(it.name)) deny('git reset --hard throws away uncommitted work for good');
    }
  },
  clean(args) {
    let dry = false;
    for (const it of opts(args, 'e', ['exclude'])) {
      if (it.kind === 'dyn') deny(`git clean ${it.a.raw}: an argument built at runtime, which could be -f`);
      if (it.kind === 'short' && it.ch === 'f') deny('git clean -f deletes untracked files for good (git clean -n shows what it would delete)');
      if (it.kind === 'long' && 'force'.startsWith(it.name)) deny('git clean --force deletes untracked files for good');
      if ((it.kind === 'short' && it.ch === 'n') || (it.kind === 'long' && 'dry-run'.startsWith(it.name))) dry = true;
    }
    if (!dry) deny('git clean without -n: only the dry run is allowed, since clean.requireForce may be off');
  },
  rebase(args) {
    if (!(args.length === 1 && !args[0].dyn && args[0].w === '--abort')) deny('git rebase rewrites history; only git rebase --abort is allowed');
  },
  commit(args) {
    const values = ['message', 'file', 'reuse-message', 'reedit-message', 'author', 'date', 'template', 'cleanup', 'trailer', 'fixup', 'squash', 'pathspec-from-file'];
    for (const it of opts(args, 'mFCct', values)) {
      if (it.kind === 'dyn') deny(`git commit ${it.a.raw}: an argument built at runtime, which could be --amend`);
      if (it.kind === 'long' && 'amend'.startsWith(it.name)) deny('git commit --amend rewrites the last commit');
    }
  },
  branch(args) {
    for (const it of opts(args, 'u', ['set-upstream-to', 'sort', 'format', 'points-at'])) {
      if (it.kind === 'dyn') deny(`git branch ${it.a.raw}: an argument built at runtime, which could be -f`);
      if (it.kind === 'short' && 'fMC'.includes(it.ch)) deny(`git branch -${it.ch} moves or overwrites a branch by force`);
      if (it.kind === 'long' && 'force'.startsWith(it.name)) deny('git branch --force moves a branch by force');
    }
  },
  worktree(args) {
    if (!args.length || args[0].w !== 'remove' || args[0].dyn) {
      if (args.length && args[0].dyn) deny(`git worktree ${args[0].raw}: a subcommand built at runtime`);
      return;
    }
    for (const it of opts(args.slice(1))) {
      if (it.kind === 'dyn') deny(`git worktree remove ${it.a.raw}: an argument built at runtime, which could be --force`);
      if (it.kind === 'short' && it.ch === 'f') deny('git worktree remove -f deletes a worktree with uncommitted work');
      if (it.kind === 'long' && 'force'.startsWith(it.name)) deny('git worktree remove --force deletes a worktree with uncommitted work');
    }
  },
};

function git(args) {
  const config = [];
  let j = 0;
  for (; j < args.length; j++) {
    const a = args[j];
    const v = a.w;
    if (a.dyn) break; // read below, as a subcommand built at runtime
    const eq = v.indexOf('=');
    const opt = eq < 0 ? v : v.slice(0, eq);
    if (GIT_VALUE.has(v)) {
      const val = args[++j];
      if (val && val.splits) deny(`git ${v} ${val.raw}: an unquoted value the shell may split into more arguments`);
      if (val && (v === '-c' || v === '--config-env')) config.push(val);
    } else if (eq > 0 && opt.startsWith('--') && (GIT_VALUE.has(opt) || opt === '--exec-path' || opt === '--list-cmds')) {
      if (opt === '--config-env') config.push({ ...a, w: v.slice(eq + 1) });
    } else if (!GIT_FLAG.has(v)) break;
  }
  // a subcommand built at runtime ($CMD) or an option the guard does not know is not a git command it knows, either
  const sub = args[j];
  if (!sub) return;
  if (REWRITE.has(sub.w)) deny(`git ${sub.w} rewrites history or refs, which loses work for good`);
  if (!GIT_COMMANDS.has(sub.w)) deny(`git ${sub.w}: not a git command the guard knows (an alias could hide a force push); spell it out`);
  if (RULES[sub.w]) RULES[sub.w](args.slice(j + 1), config);
}

// ------------------------------------------------------------------------------------------------- rm and find

/** The path the kernel will reach: each existing step resolved through its symlinks, and .. taken after that. */
export function physical(abs) {
  let cur = '/';
  for (const seg of abs.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      cur = dirname(cur);
      continue;
    }
    const next = cur === '/' ? `/${seg}` : `${cur}/${seg}`;
    try {
      cur = realpathSync(next);
    } catch (e) {
      if (!e || (e.code !== 'ENOENT' && e.code !== 'ENOTDIR')) throw e;
      cur = next;
    }
  }
  return cur;
}

const holds = (a, b) => a === '/' || a === b || b.startsWith(`${a}/`);
const UNREADABLE = /[$`*?[~{]/;

/** One path a recursive delete would remove: literal, and strictly beneath a temp folder, and not a session's own. */
function operand(a, I, ctx, what) {
  const v = a.w;
  if (a.dyn || UNREADABLE.test(v)) deny(`${what} ${a.raw}: a path holding $, a backtick, a glob, a brace or ~, which the guard cannot read`);
  const paths = v.startsWith('/') ? [v] : I.map((c) => (c === null ? deny(`${what} ${v}: a relative path after a cd the guard cannot follow`) : `${c}/${v}`));
  for (const p of paths.map(physical)) {
    if (!ctx.roots.some((r) => p.startsWith(`${r}/`))) deny(`${what} ${v}: ${p} is not strictly beneath /tmp or the temp folder`);
    if (ctx.cwd && holds(p, ctx.cwd)) deny(`${what} ${v}: ${p} holds the folder this session works in`);
    const segs = p.split('/');
    const claude = segs.findIndex((s) => s.startsWith('claude-'));
    const pad = claude < 0 ? -1 : segs.indexOf('scratchpad', claude + 1);
    if (claude >= 0 && (pad < 0 || pad === segs.length - 1)) deny(`${what} ${v}: ${p} is a Claude session folder or one above it; only what is inside a scratchpad may go`);
  }
}

function rm(args, I, ctx) {
  let end = false;
  let recursive = false;
  let unread = false;
  const operands = [];
  for (const a of args) {
    if (end) operands.push(a);
    else if (!a.dyn && a.w === '--') end = true;
    else if (a.dyn) {
      unread = true; // it could be -r
      operands.push(a);
    } else if (a.w.startsWith('--')) {
      if ('recursive'.startsWith(a.w.slice(2).split('=')[0])) recursive = true;
    } else if (a.w.startsWith('-') && a.w.length > 1) {
      if (/[rR]/.test(a.w)) recursive = true;
    } else operands.push(a);
  }
  if (!recursive && !unread) return;
  const what = recursive ? 'rm -r' : 'rm with an argument built at runtime (it could be -r)';
  for (const a of operands) operand(a, I, ctx, what);
}

const EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const DOT = { w: '.', dyn: false, dynAt: -1, splits: false, quoted: false, raw: '.' };

/** find deletes with -delete or with -exec rm: then its starting points are read as rm -r operands. */
function find(args, I, ctx) {
  let j = 0;
  while (j < args.length && !args[j].dyn && /^-([HLP]+|O\d*|D)$/.test(args[j].w)) j += args[j].w === '-D' ? 2 : 1;
  const starts = [];
  for (; j < args.length && (args[j].dyn || !/^[-(!),]/.test(args[j].w)); j++) starts.push(args[j]);
  let deletes = args.some((a) => a.dyn); // a word built at runtime could be -delete
  for (let m = j; m < args.length; m++) {
    const v = args[m].w;
    if (v === '-delete') deletes = true;
    if (!EXEC.has(v)) continue;
    const inner = [];
    for (m++; m < args.length && args[m].w !== ';' && args[m].w !== '+'; m++) if (args[m].w !== '{}') inner.push(args[m]);
    if (inner.length && judge(inner, v.endsWith('dir') ? [null] : I, ctx, false).name === 'rm') deletes = true;
  }
  if (deletes) for (const s of starts.length ? starts : [DOT]) operand(s, I, ctx, 'find that deletes, from');
}

// ------------------------------------------------------------------------------------------------------- decide

const no = (why) => ({ allow: false, why });

function context(input, opts) {
  const home = physical(homedir());
  const cwd = typeof input.cwd === 'string' && input.cwd.startsWith('/') ? resolvePath(input.cwd) : null;
  const real = cwd && physical(cwd);
  const roots = [physical('/tmp')];
  const t = 'tmpdir' in opts ? opts.tmpdir : tmpdir();
  // the temp folder counts only where it holds neither the home folder nor the session's own folder
  if (typeof t === 'string' && t.startsWith('/')) {
    const r = physical(t);
    if (!holds(r, home) && !(real && holds(r, real))) roots.push(r);
  }
  return { roots, cwd: real, loops: false, start: [cwd] };
}

/**
 * The hook's verdict on one tool call: { allow: true } or { allow: false, why }. Only Bash calls are judged; one with
 * no command, or a command the guard cannot read, is refused. `opts.tmpdir` stands in for os.tmpdir() in tests.
 */
export function decide(input, opts = {}) {
  try {
    if (!input || typeof input !== 'object') return no('the hook input is not a JSON object');
    if (typeof input.tool_name !== 'string') return no('the hook input names no tool');
    if (input.tool_name !== 'Bash') return { allow: true };
    const cmd = input.tool_input && input.tool_input.command;
    if (typeof cmd !== 'string') return no('the Bash call carries no command to read');
    let toks;
    try {
      toks = words(cmd);
    } catch (e) {
      return no(`the guard cannot read this command (${e.message}), and a command it cannot read is refused`);
    }
    const ctx = context(input, opts);
    run(toks, ctx.start, ctx);
    return { allow: true };
  } catch (e) {
    return no(e instanceof Denied ? e.message : `the guard failed (${e && e.message}), so it refuses rather than guess`);
  }
}

function block(why) {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${why}\n`);
  process.exitCode = 2;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch (e) {
    return block(`the hook input is not JSON (${e.message})`);
  }
  const r = decide(input);
  if (r.allow === true) process.exitCode = 0;
  else block(r.why);
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
// decide() turns any error into a refusal, and a crash that still got through exits 1, which the settings' `|| exit 2` blocks
if (isMain) main();
