#!/usr/bin/env node
// The destructive-command guard: a PreToolUse hook on every Bash call (.claude/settings.json). It reads the command
// the way the shell will and blocks the few commands that lose work for good: a force, mirror or delete push in any
// spelling, a hard reset, git clean -f, a history rewrite, a forced checkout or switch, a checkout of the whole tree or
// a whole folder (., .., a path ending in /, a :(magic) pathspec such as :/ or :(top), a glob, or a pathspec it cannot
// read), a restore of one to the worktree (--source included), git stash clear, an expired reflog, a pruned object
// store, gh repo sync --force, a git config write or GIT_CONFIG* variable that could turn a push into a mirror push,
// and a recursive rm (or find -delete, or xargs rm) of anything not strictly beneath /tmp or the temp folder.
// Unknown is never a pass: a path, a flag or a command name the guard cannot read is refused with the reason, and so
// is a command it cannot tokenise or cannot read within its deadline. A program the guard does not know (flock, watch,
// su -c, npm exec and the rest) has each later word naming git, rm, find, a shell or a wrapper judged as the command
// it may run. It allows what the work needs: push -u, heredoc commits whose message mentions a force push,
// pull --rebase and the rebase --continue or --skip that finishes one, merge --ff-only, cherry-pick, worktrees,
// git archive | tar, rm -rf of a literal path inside a scratchpad, and an OS package manager's install, remove or
// upgrade (apt-get, brew, pip and the rest), which reads its arguments as package names; any other subcommand of one
// (brew bundle exec) is judged like a program the guard does not know. It allows on purpose a checkout or restore of named files
// (git checkout -- notes.md, git restore notes.md), git restore --staged . (the index only) and git stash drop (one
// entry, whose sha it prints, so it can be brought back until gc).
//
//   echo '{"tool_name":"Bash","tool_input":{"command":"git push -f"},"cwd":"/repo"}' | node .claude/hooks/guard.mjs
//   # exit 0 allows; exit 2 blocks, with the reason on stderr, which Claude Code hands back to Claude
//
// The settings run it as `node … || exit 2` with onFailure "block", so a crash or a timeout blocks too. It is a seat
// belt, not a sandbox: a program that deletes through its own code (node -e, python -c, a script file) is out of its
// reach, and so is git config that runs commands (an alias in a config file is caught only because an unknown git
// subcommand is refused). Git's command-valued variables and options are out of its reach too: GIT_EDITOR,
// GIT_SSH_COMMAND and the like, git -c core.pager, submodule foreach, bisect run, --upload-pack, archive --exec,
// grep -O and difftool -x. So are the places where bash runs a command from text the guard reads as data: $((cmd) ),
// which it reads as arithmetic, ${x@P}, an alias defined then used, and an arithmetic subscript; and so are sudo -s,
// sudo -i or su reading a script on stdin, rg --pre, and a folder named without a trailing /, which reads as a file.
// Each of these classes, and node -e, python -c and script files, is written down with a realistic example the guard
// still allows in KNOWN_MISSES in guard.test.mjs, so a later fix knows which case to move.

import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const { dirname, basename, resolve: resolvePath } = posix;

class Denied extends Error {}
const deny = (why) => {
  throw new Denied(why);
};

// How long decide() may spend on one command: past it the command is refused, well inside the hook's own timeout.
const DEADLINE_MS = 1500;
let deadline = Infinity;
const late = () => {
  if (Date.now() > deadline) deny('the command is too long for the guard to read in time');
};

// ------------------------------------------------------------------------------------------------------ the tokeniser

const SEPARATORS = ' \t\n;&|()<>';
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish']);
// Words that open or close shell grammar rather than name a command; the command is the word after them.
const RESERVED = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac']);

const blank = () => ({ w: '', dyn: false, dynAt: -1, splits: false, quoted: false, raw: '' });
/** A word that is exactly this reserved word: unquoted, and known before the shell runs. */
const bare = (w, v) => !w.dyn && !w.quoted && w.w === v;

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
 * bodies are data (a shell that reads one as its script gets it as `stdin` on its first word), and so are a case's
 * patterns. Redirections are dropped, after their targets are read for substitutions. Throws when the command is
 * unbalanced.
 */
export function words(cmd) {
  if (typeof cmd !== 'string') throw new Error('the command is not text');
  return seq({ s: cmd, i: 0 }, false);
}

// (( and $[ are arithmetic, where << is a shift and not a heredoc. The guard does not read arithmetic, so it refuses
// a command that holds either together with a <<.
const pair = (p, k) => {
  p[k] = true;
  if (p.arith && p.shift) throw new Error('arithmetic with << is not read');
};

function seq(p, sub) {
  const s = p.s;
  const out = [];
  let start = 0; // where the simple command being read begins in `out`: a substitution's group goes in before it
  let depth = 0;
  let pending = [];
  const fresh = () => ({ words: [], herestring: null, procIn: false, lead: true, caseAt: -1 });
  let cmd = fresh();
  // the case statements open here: 'pattern' while an arm's patterns are read, up to its ), 'body' for its commands
  const cases = [];
  const group = (toks, reads) => {
    out.splice(start, 0, reads ? { op: '(', reads } : { op: '(' }, ...toks, { op: ')' });
    start += toks.length + 2;
  };
  const close = () => {
    if (cmd.words.length) {
      if (cmd.procIn) cmd.words[0].procIn = true;
      if (cmd.herestring) cmd.words[0].stdin = { word: cmd.herestring };
    }
    scripts(cmd.words, group);
  };
  const op = (o) => {
    close();
    out.push({ op: o });
    start = out.length;
    cmd = fresh();
  };
  const push = (w) => {
    // `case WORD in`: the case word comes first in its command, after reserved words only
    if (cmd.lead && bare(w, 'case')) cmd.caseAt = cmd.words.length;
    out.push(w);
    cmd.words.push(w);
    cmd.lead = cmd.lead && !w.dyn && RESERVED.has(w.w);
  };
  const target = () => {
    while (s[p.i] === ' ' || s[p.i] === '\t') p.i++;
    // < <(cmd): the redirection reads a process substitution, and its command runs
    if ((s[p.i] === '<' || s[p.i] === '>') && s[p.i + 1] === '(') return procsub(p, group);
    if (p.i >= s.length || SEPARATORS.includes(s[p.i])) throw new Error('a redirection with nothing to redirect to');
    return word(p, group);
  };
  const newline = () => {
    if (pending.length) heredocs(p, pending, group);
    pending = [];
  };
  for (;;) {
    late();
    if (p.i >= s.length) {
      if (sub) throw new Error('a $( or <( with no )');
      if (depth) throw new Error('a ( with no )');
      if (cases.length) throw new Error('a case with no esac');
      if (pending.length) throw new Error(`the heredoc ${pending[0].delim} never ends`);
      close();
      return out;
    }
    const c = s[p.i];
    const n = s[p.i + 1];
    if (cases[cases.length - 1] === 'pattern' && c !== '#') {
      // a case arm's patterns, up to the ) that starts its commands: words, not commands, but a substitution runs
      if (c === ' ' || c === '\t' || c === '|' || c === '(') p.i++;
      else if (c === '\\' && n === '\n') p.i += 2;
      else if (c === '\n') {
        p.i++;
        newline();
      } else if (c === ')') {
        p.i++;
        cases[cases.length - 1] = 'body';
      } else if (SEPARATORS.includes(c)) throw new Error(`a ${c} in a case pattern`);
      else {
        const w = word(p, group);
        if (bare(w, 'esac')) {
          cases.pop();
          push(w);
        }
      }
      continue;
    }
    if (c === ' ' || c === '\t') p.i++;
    else if (c === '\\' && n === '\n') p.i += 2;
    else if (c === '#') while (p.i < s.length && s[p.i] !== '\n') p.i++;
    else if (c === '\n') {
      p.i++;
      op('\n');
      newline();
    } else if (c === ';') {
      // ;; ;& and ;;& end a case arm: its next patterns follow
      const arm = n === ';' || n === '&';
      p.i += n === ';' ? (s[p.i + 2] === '&' ? 3 : 2) : n === '&' ? 2 : 1;
      op(';');
      if (arm && cases[cases.length - 1] === 'body') cases[cases.length - 1] = 'pattern';
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
      if (n === '(') pair(p, 'arith');
      p.i++;
      op('(');
      depth++;
    } else if (c === ')' && depth) {
      p.i++;
      op(')');
      depth--;
    } else if (c === ')' && sub) {
      p.i++;
      if (cases.length) throw new Error('a case with no esac before the )');
      if (pending.length) throw new Error(`the heredoc ${pending[0].delim} never ends`);
      close();
      return out;
    } else if (c === ')') throw new Error('a ) with no (');
    else if ((c === '<' || c === '>') && n === '(') push(procsub(p, group));
    else if (c === '<' && n === '<') {
      pair(p, 'shift');
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
      // a < from a <( ) is input the guard cannot read
      if (target().proc && c === '<') cmd.procIn = true;
    } else {
      const w = word(p, group);
      // 2>&1 and {fd}>file: the word written against a redirection names its file descriptor; it is not a word
      if (/^(\d+|\{[A-Za-z_]\w*\})$/.test(w.raw) && (s[p.i] === '<' || s[p.i] === '>')) continue;
      // esac at the start of a command ends the case whose commands are being read
      if (cmd.lead && bare(w, 'esac') && cases[cases.length - 1] === 'body') cases.pop();
      push(w);
      if (cmd.caseAt >= 0 && cmd.words.length === cmd.caseAt + 3) {
        if (!bare(w, 'in')) throw new Error('a case with no in');
        op(';');
        cases.push('pattern');
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

/** Where the next separator, ], }, comma and .. are from each place in the text, so a run of [ or { is read once. */
function marks(p) {
  if (p.marks) return p.marks;
  const s = p.s;
  const n = s.length;
  const m = { sep: new Int32Array(n + 2), close: new Int32Array(n + 2), brace: new Int32Array(n + 2), comma: new Int32Array(n + 2), dots: new Int32Array(n + 2) };
  for (const a of Object.values(m)) a.fill(n, n);
  for (let k = n - 1; k >= 0; k--) {
    m.sep[k] = SEPARATORS.includes(s[k]) ? k : m.sep[k + 1];
    m.close[k] = s[k] === ']' ? k : m.close[k + 1];
    m.brace[k] = s[k] === '}' ? k : m.brace[k + 1];
    m.comma[k] = s[k] === ',' ? k : m.comma[k + 1];
    m.dots[k] = s[k] === '.' && s[k + 1] === '.' ? k : m.dots[k + 1];
  }
  p.marks = m;
  return m;
}
// [ starts a glob when a ] follows it in the same word
const later = (p, i) => {
  const m = marks(p);
  return m.close[i + 1] < m.sep[i + 1];
};
// {a,b} and {1..3} expand; {} and {x} stay as they are
const braces = (p, i) => {
  const m = marks(p);
  const b = m.brace[i + 1];
  return b < m.sep[i + 1] && (m.comma[i + 1] < b || m.dots[i + 1] < b);
};

function word(p, group) {
  const s = p.s;
  const begin = p.i;
  const w = blank();
  while (p.i < s.length && !SEPARATORS.includes(s[p.i])) {
    late();
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
      const glob = c === '*' || c === '?' || (c === '[' && later(p, p.i));
      if (glob || (c === '{' && braces(p, p.i)) || (c === '~' && p.i === begin)) mark(w, true);
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
  // $[ … ] is the old spelling of $(( … )), but it is read as a lone $ followed by words
  if (n === '[') pair(p, 'arith');
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
  // a >( ) reads what its command writes into it, the way a pipe does
  group(inner, p.s[at] === '>');
  const w = blank();
  mark(w, false);
  w.w = p.s.slice(at, p.i);
  w.raw = w.w;
  w.proc = true;
  return w;
}

function assignment(w) {
  const m = /^[A-Za-z_]\w*(\[[^\]]*\])?\+?=/.exec(w.w);
  return Boolean(m) && (!w.dyn || w.dynAt >= m[0].length);
}

/**
 * A shell's own options: whether -c is among them, whether -s is (the script comes from stdin and the operands are its
 * positional parameters), where its first operand is, and whether an option is built at runtime.
 */
function shellArgs(ws, j) {
  let c = false;
  let s = false;
  for (; j < ws.length; j++) {
    const v = ws[j].w;
    if (ws[j].dyn) return { c, s, at: j, dyn: true };
    if (v === '--' || v === '-') return { c, s, at: j + 1, dyn: false };
    if (!/^[-+]./.test(v)) break;
    if (v.startsWith('--')) {
      if (v === '--rcfile' || v === '--init-file') j++;
      continue;
    }
    if (v.includes('c')) c = true;
    if (v.includes('s')) s = true;
    if (/[oO]/.test(v)) j++;
  }
  return { c, s, at: j, dyn: false };
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
    let rest = ws.slice(k + 1);
    // eval -- runs the words after the --
    if (rest[0] && !rest[0].dyn && rest[0].w === '--') rest = rest.slice(1);
    if (rest.some((w) => w.dyn)) throw new Error('eval of text built at runtime');
    group(words(rest.map((w) => w.w).join(' ')));
  }
  // trap -- ACTION SIGNAL: the action comes after the --
  const action = ws[k + 1] && !ws[k + 1].dyn && ws[k + 1].w === '--' ? ws[k + 2] : ws[k + 1];
  if (name === 'trap' && action && !/^-[lp]$/.test(action.w)) {
    if (action.dyn) throw new Error('trap of a command built at runtime');
    group(words(action.w));
  }
}

// ---------------------------------------------------------------------------------------------- following the cwd

// The shell's grammar, read for what each command runs and from which folder. A folder is tracked as the set of
// places the shell can be in: `cd /x && rm -rf y` removes /x/y, but `cd /x; rm -rf y` may remove ./y (the cd can
// fail), so after a ; both count. A subshell's cd stays inside it; null is a folder the guard cannot follow, and past
// 16 places the guard stops following: the set becomes [null], so a relative path is unknown and it costs nothing.
const FOLDERS = 16;
const union = (...sets) => {
  const u = [...new Set(sets.flat())];
  return u.length > FOLDERS ? [null] : u;
};
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
  // the last and-or list's folders on success (S) and on failure (F): an if's condition, when a then follows it
  let S = I;
  let F = I;
  const ifs = [];
  for (;;) {
    late();
    while (i < t.length && (t[i].op === ';' || t[i].op === '\n' || t[i].op === '&')) i++;
    if (i >= t.length || t[i].op === ')') {
      if (ifs.length) throw new Error('an if with no fi');
      return { i, out: cur };
    }
    const from = i;
    let r = pipeline(t, i, branch(t, i, cur, S, F, ifs), ctx);
    S = r.S;
    F = r.F;
    i = r.i;
    while (i < t.length && (t[i].op === '&&' || t[i].op === '||')) {
      const and = t[i].op === '&&';
      i++;
      while (i < t.length && t[i].op === '\n') i++;
      r = pipeline(t, i, branch(t, i, and ? S : F, S, F, ifs), ctx);
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

/**
 * if, then, elif, else and fi at the start of a command: `then` starts where its condition succeeded (S), `elif` and
 * `else` where it failed (F), and after `fi` the shell can be where it entered the if, where any branch left it, or,
 * with no else, where the last condition failed. Returns the folders the command starts from.
 */
function branch(t, i, cur, S, F, ifs) {
  // a command's substitutions come first, as ( ) groups; its reserved words follow them
  while (t[i] && t[i].op === '(') {
    let d = 0;
    do {
      if (t[i].op === '(') d++;
      else if (t[i].op === ')') d--;
      i++;
    } while (t[i] && d);
  }
  for (; t[i] && !t[i].op && !t[i].dyn && RESERVED.has(t[i].w); i++) {
    const v = t[i].w;
    const top = ifs[ifs.length - 1];
    if (v === 'if') ifs.push({ entry: cur, ends: [], S: null, F: null, otherwise: false });
    if (v !== 'then' && v !== 'elif' && v !== 'else' && v !== 'fi') continue;
    if (!top) throw new Error(`${v} with no if before it`);
    if (v === 'then') {
      top.S = S;
      top.F = F;
      cur = S;
      continue;
    }
    if (!top.S) throw new Error(`${v} with no then before it`);
    top.ends.push(cur);
    if (v === 'fi') {
      ifs.pop();
      cur = union(top.entry, ...top.ends, top.otherwise ? [] : top.F);
    } else {
      cur = top.F;
      if (v === 'else') top.otherwise = true;
    }
  }
  return cur;
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
  // a subshell's cd stays inside it, so what follows starts from I again; in a pipeline it reads the pipe throughout,
  // and so does a >( ), which reads what its command writes into it
  while (t[i] && t[i].op === '(') {
    i = list(t, i + 1, I, piped || t[i].reads ? { ...ctx, piped: true } : ctx).i;
    if (!t[i] || t[i].op !== ')') throw new Error('a ( with no )');
    i++;
  }
  const ws = [];
  while (i < t.length && !t[i].op) ws.push(t[i++]);
  if (!ws.length) return { S: I, F: I, i };
  // a < from a <( ) is input the guard cannot read, and it wins over a heredoc or a here-string
  const r = judge(ws, I, ctx, piped, ws[0].procIn ? { procsub: true } : ws[0].stdin);
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

// The programs the guard has its own rules for, which read their arguments themselves.
const KNOWN = new Set(['git', 'rm', 'find', 'cd', 'pushd', 'popd', 'source', '.', ...SHELLS]);
// Programs that only read their arguments as data, which the backstop below leaves alone.
const DATA = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'cat', 'ls', 'head', 'tail', 'wc', 'man', 'which', 'type', 'test', '[', 'true', 'false', ':']);
// An OS package manager reads the words after an install-type subcommand as package names: apt-get install -y git curl
// installs git and curl, it does not run git curl. Any other subcommand may run what follows it (brew bundle exec -- …),
// so it gets the backstop like any program the guard does not know. pacman names its subcommand as a flag (-S, -R, -Q).
const INSTALLS = ['install', 'uninstall', 'reinstall', 'remove', 'purge', 'erase', 'autoremove', 'update', 'upgrade', 'info', 'show', 'search', 'list', 'freeze', 'download', 'add', 'del'];
const PACKAGES = new Set(['apt-get', 'apt', 'brew', 'dnf', 'yum', 'apk', 'pip', 'pip3']);
const installs = (name, args) => {
  if (name === 'pacman') return !!args[0] && !args[0].dyn && /^-[SRQ][A-Za-z]*$/.test(args[0].w);
  if (!PACKAGES.has(name)) return false;
  const sub = args.find((a) => a.dyn || !a.w.startsWith('-'));
  return !!sub && !sub.dyn && INSTALLS.includes(sub.w);
};
const dataOnly = (name, args) => DATA.has(name) || installs(name, args);
// A later word of an unknown program that names one of these is judged as the command the program may run…
const RUNS = new Set(['git', 'rm', 'find', ...SHELLS, ...Object.keys(WRAPPERS)]);
// …and a literal argument whose first word is one of these is read as a script.
const STARTS = new Set([...RUNS, 'cd', 'pushd']);
const CANDIDATES = 16;

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
// A GIT_CONFIG* variable sets git config the guard cannot see for every git after it: a mirror push, a hook, an alias.
const GIT_CONFIG_SET = /^GIT_CONFIG\w*(\[[^\]]*\])?\+?=/;

/**
 * One simple command. Returns where the shell can be after it succeeds (S) and after it fails (F), and its name.
 * `stdin` is what it reads when that is known (a heredoc, a here-string or a <( )); `inner` is set when the backstop
 * judges a command an unknown program may run, whose later words the backstop is already judging.
 */
function judge(ws, I, ctx, piped, stdin, inner) {
  late();
  for (const w of ws) if (GIT_CONFIG_SET.test(w.dyn ? w.w.slice(0, w.dynAt) : w.w)) deny(`${w.raw}: a GIT_CONFIG* variable sets git config the guard cannot see, such as a mirror push`);
  const st = { chdir: false, tail: false };
  let direct = true;
  let neg = false;
  let k = 0;
  for (;;) {
    while (k < ws.length && assignment(ws[k])) k++;
    if (k >= ws.length) return { S: I, F: I, name: '' };
    const head = commandName(ws[k]);
    if (RESERVED.has(head)) {
      if (head === '!') neg = !neg;
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
  let r = { S: I, F: I };
  if (name === 'git') git(args);
  else if (name === 'rm') rm(args, at, ctx);
  else if (name === 'find') find(args, at, ctx);
  else if (SHELLS.has(name)) shell(name, args, stdin, at, ctx, piped);
  else if (name === 'source' || name === '.') source(name, args, stdin);
  else if (direct && (name === 'cd' || name === 'pushd')) r = cd(args, I);
  else if (direct && name === 'popd') r = { S: [null], F: I };
  else if (name === 'gh') gh(args);
  if (!inner && !KNOWN.has(name) && !dataOnly(name, args)) backstop(name, args, ctx, piped, stdin);
  // `! cmd` succeeds where cmd fails
  return neg ? { S: r.F, F: r.S, name } : { ...r, name };
}

/** The first word of a text after its NAME=value assignments, split on whitespace only. */
function firstWord(text) {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    let e = i;
    while (e < text.length && !/\s/.test(text[e])) e++;
    const t = text.slice(i, e);
    if (!/^[A-Za-z_]\w*=/.test(t)) return t;
    i = e;
  }
}
// a program by its name, or by an absolute path to it
const named = (v) => (v.startsWith('/') ? basename(v) : v);

/**
 * The backstop for a program the guard does not know, which may run the command it is given: flock, ionice, taskset,
 * strace, watch, npm exec, ssh, su -c, script -c and the rest. Each later literal word naming a program in RUNS is
 * judged as the command from that word on, and a literal argument whose first word is in STARTS (`su -c 'rm -rf x'`)
 * is read as a script, both in a folder the guard cannot follow and with the program's own input. Past 16 of them in
 * one command the guard refuses rather than judge them all.
 */
function backstop(name, args, ctx, piped, stdin) {
  let n = 0;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a.dyn) continue;
    const spaced = /\s/.test(a.w);
    const runs = !spaced && RUNS.has(named(a.w));
    if (!runs && !(spaced && STARTS.has(named(firstWord(a.w))))) continue;
    if (++n > CANDIDATES) deny(`${name}: more than ${CANDIDATES} words that name a command it may run, too many to judge`);
    if (runs) judge(args.slice(j), [null], ctx, piped, stdin, true);
    else script(name, a.w, [null], ctx);
  }
}

function cd(args, I) {
  const d = args.length === 2 && !args[0].dyn && args[0].w === '--' ? args[1] : args.length === 1 ? args[0] : null;
  // only a literal absolute path or one starting with . or ..: a bare name may go anywhere on CDPATH
  const known = d && !d.dyn && /^(\/|\.\.?(\/|$))/.test(d.w);
  if (!known) return { S: [null], F: I };
  return { S: I.map((c) => (d.w.startsWith('/') ? resolvePath(d.w) : c === null ? null : resolvePath(c, d.w))), F: I };
}

/**
 * A shell with no -c and no script file reads its commands from stdin, and so does one with -s, whose operands are its
 * positional parameters: a heredoc or here-string is read as a script, and a pipe or other input is refused.
 */
function shell(name, args, stdin, I, ctx, piped) {
  const r = shellArgs(args, 0);
  if (r.dyn) deny(`${name} with an argument built at runtime, so the guard cannot tell what it runs`);
  if (stdin && stdin.procsub) deny(`${name} reads its input from a <( ), which the guard cannot read`);
  if (r.c || (r.at < args.length && !r.s)) return; // the -c script was read with the words; a script file is out of reach
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

// The names under which `source` or `.` reads its script from stdin.
const STDIN = new Set(['-', '/dev/stdin', '/dev/fd/0', '/proc/self/fd/0']);

/** source or . runs a script in this shell: one from a <( ) or from stdin is beyond what the guard reads, so it is refused. */
function source(name, args, stdin) {
  if (stdin && stdin.procsub) deny(`${name} with its input from a <( ), which the guard cannot read`);
  const a = args[0] && !args[0].dyn && args[0].w === '--' ? args[1] : args[0];
  if (!a) return;
  if (a.proc) deny(`${name} ${a.raw}: a script from a process substitution, which the guard cannot read`);
  if (!a.dyn && STDIN.has(a.w.startsWith('/') ? resolvePath(a.w) : a.w)) deny(`${name} ${a.raw}: a script read from stdin, which the guard does not read`);
}

/** gh repo sync --force resets the branch to its source, throwing away the branch's own commits. */
function gh(args) {
  if (!(args.length >= 2 && !args[0].dyn && !args[1].dyn && args[0].w === 'repo' && args[1].w === 'sync')) return;
  for (const a of args.slice(2)) {
    if (a.dyn) deny(`gh repo sync ${a.raw}: an argument built at runtime, which could be --force`);
    if (a.w === '--force' || a.w.startsWith('--force=')) deny("gh repo sync --force throws away the branch's own commits");
  }
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

// A pathspec that reaches the whole tree or a whole folder: an empty one, ., .., a path ending in /, . or .., a
// :(magic) one such as :/, :(top) or :!x, or a glob git expands itself (* ? [), quoted or not. A branch or tag name
// can be none of these. An operand built at runtime may be any of them, so it counts as one too.
const WHOLE_TREE = /^$|(^|\/)\.\.?$|\/$|^:|[*?[]/;
const wholeTree = (it) => operandOf(it) && (it.kind === 'dynpos' || WHOLE_TREE.test(it.a.w));
// --pathspec-from-file (or a prefix of it) reads the pathspecs from a file, or from stdin, which the guard cannot see
const fromFile = (it) => it.kind === 'long' && 'pathspec-from-file'.startsWith(it.name);
const DISCARD = 'a pathspec for the whole tree or a whole folder throws away its uncommitted changes for good, as a hard reset does; name the files';
const UNSEEN_PATHS = 'pathspecs read from a file the guard cannot see, which could be the whole tree; name the files';
// --continue and --skip finish a rebase that stopped on a conflict, such as an allowed git pull --rebase
const REBASE_FINISH = new Set(['--continue', '--skip']);

// git config: the keys a write may set (who commits, how paths print, which folders git trusts), and its options.
const CONFIG_KEYS = new Set(['user.name', 'user.email', 'core.quotepath', 'safe.directory']);
const CONFIG_WHOLE = ['rename-section', 'remove-section', 'edit'];
const CONFIG_WRITE = ['add', 'replace-all', 'unset', 'unset-all'];
const CONFIG_READ = ['get', 'get-all', 'get-regexp', 'get-urlmatch', 'get-color', 'get-colorbool', 'list'];
const CONFIG_FLAGS = ['global', 'system', 'local', 'worktree', 'file', 'blob', 'type', 'no-type', 'bool', 'int', 'bool-or-int', 'bool-or-str', 'path', 'expiry-date', 'null', 'name-only', 'show-origin', 'show-scope', 'show-names', 'includes', 'no-includes', 'default', 'fixed-value', 'comment', 'value', 'all', 'regexp', 'url', 'append'];
const CONFIG_SHORT = { e: 'edit', l: 'list', f: 'file', z: 'null' };
// git 2.46 and later: git config get, list, set, unset, rename-section, remove-section and edit
const CONFIG_VERBS = new Map([['get', 'read'], ['list', 'read'], ['set', 'write'], ['unset', 'write'], ['rename-section', 'whole'], ['remove-section', 'whole'], ['edit', 'whole']]);

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
    if (args.length === 1 && !args[0].dyn && REBASE_FINISH.has(args[0].w)) return;
    if (!(args.length === 1 && !args[0].dyn && args[0].w === '--abort')) deny('git rebase rewrites history; only git rebase --abort, --continue or --skip, alone, is allowed');
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
  checkout(args) {
    for (const it of opts(args, 'bB', ['orphan', 'conflict', 'pathspec-from-file'])) {
      if (it.kind === 'dyn') deny(`git checkout ${it.a.raw}: an argument built at runtime, which could be -f or -B`);
      if (it.kind === 'short' && it.ch === 'B') deny('git checkout -B resets a branch that may hold work (git branch -f by another name)');
      if (it.kind === 'short' && it.ch === 'f') deny('git checkout -f throws away uncommitted changes');
      if (it.kind === 'long' && 'force'.startsWith(it.name)) deny('git checkout --force throws away uncommitted changes');
      // with a pathspec, checkout overwrites the files it reaches from the index or a tree-ish, with no -f needed
      if (wholeTree(it)) deny(`git checkout ${it.a.raw}: ${DISCARD}`);
      if (fromFile(it)) deny(`git checkout ${it.a.raw}: ${UNSEEN_PATHS}`);
    }
  },
  restore(args) {
    let staged = false;
    let worktree = false;
    let reach = null; // the first pathspec that reaches the whole tree, or that the guard cannot read
    for (const it of opts(args, 's', ['source', 'conflict', 'pathspec-from-file'])) {
      if (it.kind === 'dyn') deny(`git restore ${it.a.raw}: an argument built at runtime, which could be --worktree or the whole tree`);
      // only --staged spelt out counts: an abbreviation of it is read as the default, the worktree
      if ((it.kind === 'short' && it.ch === 'S') || (it.kind === 'long' && it.name === 'staged')) staged = true;
      if ((it.kind === 'short' && it.ch === 'W') || (it.kind === 'long' && 'worktree'.startsWith(it.name))) worktree = true;
      if (!reach && (wholeTree(it) || fromFile(it))) reach = it;
    }
    // restore writes the worktree by default, and with --staged only when --worktree is given as well
    if (reach && (worktree || !staged)) deny(`git restore ${reach.a.raw}: ${fromFile(reach) ? UNSEEN_PATHS : DISCARD}`);
  },
  stash(args) {
    const verb = args[0];
    if (verb && verb.dyn) deny(`git stash ${verb.raw}: a subcommand built at runtime, which could be clear`);
    if (verb && verb.w === 'clear') deny('git stash clear drops every stash entry at once and prints no sha to bring one back (git stash drop drops one)');
  },
  switch(args) {
    for (const it of opts(args, 'cC', ['create', 'force-create', 'orphan', 'conflict'])) {
      if (it.kind === 'dyn') deny(`git switch ${it.a.raw}: an argument built at runtime, which could be -f or -C`);
      if (it.kind === 'short' && it.ch === 'C') deny('git switch -C resets a branch that may hold work (git branch -f by another name)');
      if (it.kind === 'short' && it.ch === 'f') deny('git switch -f throws away uncommitted changes');
      // --force is a prefix of --force-create, so one rule refuses both
      if (it.kind === 'long' && 'force-create'.startsWith(it.name)) deny(`git switch --${it.name} throws away uncommitted changes or resets a branch by force`);
      if (it.kind === 'long' && 'discard-changes'.startsWith(it.name)) deny('git switch --discard-changes throws away uncommitted changes');
    }
  },
  reflog(args) {
    const sub = args[0];
    if (sub && sub.dyn) deny(`git reflog ${sub.raw}: a subcommand built at runtime, which could be expire or delete`);
    if (sub && sub.w === 'expire') deny('git reflog expire drops the record that lets lost commits be found again');
    if (sub && sub.w === 'delete') deny('git reflog delete drops the record that lets lost commits be found again');
  },
  gc(args) {
    for (const it of opts(args)) {
      if (it.kind === 'dyn') deny(`git gc ${it.a.raw}: an argument built at runtime, which could be --prune=now`);
      if (it.kind === 'long' && 'prune'.startsWith(it.name)) deny('git gc --prune deletes unreachable objects, which may be the only copy of lost work');
    }
  },
  prune(args) {
    for (const it of opts(args, '', ['expire'])) {
      if (it.kind === 'dyn') deny(`git prune ${it.a.raw}: an argument built at runtime`);
      if ((it.kind === 'short' && it.ch === 'n') || (it.kind === 'long' && 'dry-run'.startsWith(it.name))) return;
    }
    deny('git prune deletes unreachable objects for good; only git prune -n is allowed');
  },
  config(args) {
    let write = false;
    let read = false;
    let whole = false; // a write of a whole section or of the file: there is no one key to check
    const ops = [];
    for (const it of opts(args, 'f', ['file', 'blob', 'type', 'default', 'comment', 'value', 'url'])) {
      if (it.kind === 'dyn') deny(`git config ${it.a.raw}: an argument built at runtime, which could make it a write`);
      if (operandOf(it)) {
        ops.push(it);
        continue;
      }
      const name = it.kind === 'long' ? it.name : CONFIG_SHORT[it.ch] || `-${it.ch}`;
      if (CONFIG_WHOLE.some((o) => o.startsWith(name))) whole = write = true;
      else if (CONFIG_WRITE.some((o) => o.startsWith(name))) write = true;
      else if (CONFIG_READ.some((o) => o.startsWith(name))) read = true;
      else if (!CONFIG_FLAGS.some((o) => o.startsWith(name))) deny(`git config ${it.a.raw}: an option the guard does not know`);
    }
    let key = ops[0];
    const verb = !write && !read && key && key.kind === 'pos' ? CONFIG_VERBS.get(key.a.w) : undefined;
    if (verb) {
      key = ops[1];
      if (verb === 'read') return;
      write = true;
      if (verb === 'whole') whole = true;
    } else if (!read && ops.length >= 2) write = true;
    if (!write) return;
    if (whole) deny('git config: a whole-section or whole-file write can set any config, a mirror push or a hook among them');
    if (!key || key.kind !== 'pos' || !CONFIG_KEYS.has(key.a.w.toLowerCase())) deny(`git config ${key ? key.a.raw : ''}: a write outside user.name, user.email, core.quotepath and safe.directory can turn a push into a mirror push or run a command`);
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
    if (!inner.length) continue;
    const name = judge(inner, v.endsWith('dir') ? [null] : I, ctx, false).name;
    // rm deletes what find found, and so does a program the guard does not know that runs rm with it (flock … rm)
    if (name === 'rm' || (!KNOWN.has(name) && !dataOnly(name, inner.slice(1)) && inner.some((w) => !w.dyn && named(w.w) === 'rm'))) deletes = true;
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
 * no command, or a command the guard cannot read, is refused, and so is one it cannot read within its deadline.
 * `opts.tmpdir` stands in for os.tmpdir() in tests, and `opts.deadlineMs` for the 1500 ms the guard allows itself.
 */
export function decide(input, opts = {}) {
  deadline = Date.now() + (typeof opts.deadlineMs === 'number' ? opts.deadlineMs : DEADLINE_MS);
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
  } finally {
    deadline = Infinity;
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
