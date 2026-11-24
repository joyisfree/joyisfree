// The destructive-command guard served as a plugin from this repository (plan section 20, step E; Leif said yes on 23
// Nov 2026). This repository is its own marketplace: .claude-plugin/marketplace.json lists one plugin, joy-guard, at
// ./plugins/joy-guard, whose hooks/hooks.json runs the same guard on every Bash call that .claude/settings.json runs.
//
// The plugin's guard is a committed copy of .claude/hooks/guard.mjs, not a symlink: the plugin docs say a symlink to
// a file elsewhere in the marketplace is copied into the cache only for a git-hosted install, and is skipped for a
// plugin installed from a local path (code.claude.com/docs/en/plugins/host-marketplace.md, "Share files within a
// marketplace with symlinks"); what the claude.ai account sync does with one is not written down. The identity test
// below keeps the copy byte for byte the guard. This file must never be in guard.mjs's suite (SUITE_FOR in
// galxe-desk/scripts/mutate.mjs): every guard mutation changes guard.mjs, the identity test would go red on each, and
// "killed" would then prove nothing about the guard. It judges the plugin's own files instead.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..'); // the marketplace root: the folder that holds .claude-plugin/
const PLUGIN = join(ROOT, 'plugins', 'joy-guard');
const read = (...p) => readFileSync(join(...p), 'utf8');
const market = () => JSON.parse(read(ROOT, '.claude-plugin', 'marketplace.json'));
const manifest = () => JSON.parse(read(PLUGIN, '.claude-plugin', 'plugin.json'));
const hooksFile = () => JSON.parse(read(PLUGIN, 'hooks', 'hooks.json'));
const settings = () => JSON.parse(read(ROOT, '.claude', 'settings.json'));

const SCRATCH = mkdtempSync(join(tmpdir(), 'plugin-test-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

// The plugin hook, as Claude Code runs it: the same guard, on every Bash call, with a crash (`|| exit 2`) and a
// failure to start or a timeout (onFailure "block", Claude Code 2.1.295 and later) blocking the call, never letting it
// through. ${CLAUDE_PLUGIN_ROOT} is quoted so a plugin root with a space in it stays one word.
const COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs" || exit 2';
const HOOKS = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: COMMAND, timeout: 5, onFailure: 'block' }] }] };

// Every file the plugin ships, by its path from the plugin root. Nothing else: a top-level bin/ makes claude.ai refuse
// the plugin, a CLAUDE.md is not loaded, and anything a script reads from above the plugin root is not copied.
const FILES = ['.claude-plugin/plugin.json', 'hooks/guard.mjs', 'hooks/hooks.json'];
const walk = (dir, at = '') =>
  readdirSync(join(dir, at), { withFileTypes: true }).flatMap((d) => {
    const rel = at ? posix.join(at, d.name) : d.name;
    return d.isDirectory() ? walk(dir, rel) : [rel];
  });

const entry = () => {
  const plugins = market().plugins;
  assert.ok(Array.isArray(plugins) && plugins.length === 1, 'the marketplace lists exactly one plugin');
  return plugins[0];
};

test('marketplace: this repository is the joyisfree marketplace, and lists joy-guard by a ./ path inside it', () => {
  const m = market();
  assert.equal(m.name, 'joyisfree');
  assert.equal(typeof m.owner?.name, 'string');
  assert.ok(m.owner.name.trim(), 'owner.name is required');
  const e = entry();
  assert.equal(e.name, 'joy-guard');
  // a relative source must start with ./, may not hold .. or a backslash, and resolves from the marketplace root
  // (code.claude.com/docs/en/plugins/marketplace-reference.md, "Relative path plugin source")
  assert.equal(typeof e.source, 'string');
  assert.ok(e.source.startsWith('./'), `the source ${e.source} must start with ./`);
  assert.ok(!e.source.includes('..') && !e.source.includes('\\'), `the source ${e.source} must hold no .. and no backslash`);
  const at = resolve(ROOT, e.source);
  const rel = relative(ROOT, at);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), `the source ${e.source} must lie inside the repository`);
  assert.equal(at, PLUGIN);
  assert.ok(statSync(at).isDirectory());
});

test('marketplace: no version is pinned, so every install takes the guard at the commit it was fetched from', () => {
  // a version in plugin.json or the entry keeps users on their cached copy until the string changes, however many
  // guard fixes are pushed (code.claude.com/docs/en/plugins/loading.md, "How Claude Code computes the version")
  assert.ok(!('version' in entry()), 'the marketplace entry pins no version');
  assert.ok(!('version' in manifest()), 'plugin.json pins no version');
});

test('plugin: its manifest names it as its marketplace entry does, and it ships only the guard and its hook', () => {
  // the entry name is the install id and the enabledPlugins key; the manifest name namespaces it; the docs say keep them
  // the same (code.claude.com/docs/en/plugin-marketplaces, "Keep the entry name and the manifest name the same")
  const p = manifest();
  assert.equal(p.name, entry().name);
  assert.match(p.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'the plugin name is kebab-case');
  assert.equal(typeof p.description, 'string');
  assert.deepEqual(walk(PLUGIN).sort(), FILES);
});

test('hooks: the plugin runs the guard on every Bash call, and a crash, a failure to start or a timeout blocks it', () => {
  const h = hooksFile();
  // a hooks file wraps its event map in a top-level "hooks" key, with an optional "description" beside it
  // (code.claude.com/docs/en/plugins-reference, "hooks"; code.claude.com/docs/en/hooks)
  assert.deepEqual(Object.keys(h).filter((k) => k !== 'description'), ['hooks']);
  assert.deepEqual(h.hooks, HOOKS);
});

test("hooks: the plugin's hook is the project's hook, with the plugin's root in place of the project's", () => {
  const project = settings().hooks.PreToolUse;
  const plugin = hooksFile().hooks.PreToolUse;
  const asProject = (entries) =>
    JSON.parse(JSON.stringify(entries).split('\\"${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs\\"').join('\\"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs\\"'));
  assert.deepEqual(asProject(plugin), project);
});

const payload = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '/work/repo', hook_event_name: 'PreToolUse' });
const runHook = (root, command) =>
  spawnSync('sh', ['-c', hooksFile().hooks.PreToolUse[0].hooks[0].command], {
    input: payload(command),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });

test('hooks: the command in hooks.json lets an allowed call through, and blocks a refusal and a guard that cannot start', () => {
  // the command is read from hooks.json itself, so a change there is what this test runs; Claude Code substitutes
  // ${CLAUDE_PLUGIN_ROOT} and also exports it, and the shell's own expansion of the exported value is the same text
  const ok = runHook(PLUGIN, 'git status');
  assert.equal(ok.status, 0, ok.stderr);
  const refused = runHook(PLUGIN, 'git reset --hard');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Blocked by \.claude\/hooks\/guard\.mjs: .*reset --hard/);
  const missing = runHook(join(SCRATCH, 'no-such-plugin'), 'git status');
  assert.equal(missing.status, 2, 'node cannot start the guard: blocked'); // node exits 1; `|| exit 2` makes it a block
});

test('hooks: a cached copy of the plugin whose path holds a space still runs the guard', () => {
  // the cache is ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/, and the home folder can hold a space
  const copy = join(mkdtempSync(join(SCRATCH, 'cache ')), 'joy guard');
  cpSync(PLUGIN, copy, { recursive: true });
  assert.equal(runHook(copy, 'git status').status, 0);
  assert.equal(runHook(copy, 'git push --force').status, 2);
});

test("guard: the plugin's guard is a plain file, byte for byte .claude/hooks/guard.mjs", () => {
  const copy = join(PLUGIN, 'hooks', 'guard.mjs');
  assert.ok(existsSync(copy), `${relative(ROOT, copy)} is missing`);
  assert.ok(lstatSync(copy).isFile(), `${relative(ROOT, copy)} must be a regular file: a symlink is skipped by a local-path install`);
  const same = readFileSync(copy).equals(readFileSync(join(HERE, 'guard.mjs')));
  assert.ok(same, `${relative(ROOT, copy)} differs from .claude/hooks/guard.mjs: copy the guard over it (cp .claude/hooks/guard.mjs ${relative(ROOT, copy).split(sep).join('/')})`);
});

test('settings: this repository enables the plugin by the names its marketplace file gives', () => {
  // enabledPlugins is keyed "<entry name>@<marketplace name>", and extraKnownMarketplaces by the marketplace name
  // (code.claude.com/docs/en/plugins/loading.md, "Find where a plugin came from")
  const m = market();
  const s = settings();
  assert.equal(s.enabledPlugins?.[`${entry().name}@${m.name}`], true);
  assert.equal(s.extraKnownMarketplaces?.[m.name]?.source?.source, 'github');
  assert.equal(s.extraKnownMarketplaces[m.name].source.repo, 'joyisfree/joyisfree');
});
