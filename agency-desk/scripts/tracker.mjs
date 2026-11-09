#!/usr/bin/env node
// The tracker: an append-only log of what happened with each person (invite, accept, dm, reply, yes, stop, promise,
// done). Every promise carries a due date, because the promises made in July went unkept. A "stop" is honoured for
// good. "yes" is the recorded consent that lets an address found through LinkedIn be emailed. Lines are never
// edited: a correction is a new line. The log is private and lives outside the repository.
//
//   node agency-desk/scripts/tracker.mjs add --log <events.jsonl> --key "Brand | Name" --event reply [--note "..."] [--due YYYY-MM-DD] [--at YYYY-MM-DD]
//   node agency-desk/scripts/tracker.mjs status --log <events.jsonl> --today YYYY-MM-DD
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { args, isMain, assertOutsideRepo } from './lib.mjs';

const DAY = 86_400_000;
export const EVENTS = ['invite', 'accept', 'dm', 'reply', 'yes', 'stop', 'promise', 'done'];
export const FOLLOW_UP_DAYS = 7; // the one follow-up goes 7 to 10 days after an unanswered DM, and only once
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));

export function validate(ev) {
  if (!ev || !String(ev.key || '').includes(' | ')) throw new Error('key must be "Brand | Name", as in the pack');
  if (!EVENTS.includes(ev.event)) throw new Error(`event must be one of ${EVENTS.join(', ')}`);
  if (!isDate(ev.at)) throw new Error('at must be a date, YYYY-MM-DD');
  if (ev.event === 'promise' && (!isDate(ev.due) || !String(ev.note || '').trim())) throw new Error('a promise needs --note (what was promised) and --due (by when)');
  if (ev.event === 'done' && !String(ev.note || '').trim()) throw new Error('done needs --note naming the promise it closes, word for word');
  return { key: ev.key, event: ev.event, at: ev.at, ...(ev.note ? { note: String(ev.note) } : {}), ...(ev.due ? { due: ev.due } : {}) };
}

export function parseLog(text) {
  return String(text || '').split('\n').map((line, i) => [line.trim(), i + 1]).filter(([l]) => l).map(([l, n]) => {
    try { return validate(JSON.parse(l)); } catch (e) { throw new Error(`log line ${n}: ${e.message}`); }
  });
}

export function status(events, today) {
  if (!isDate(today)) throw new Error('status needs --today YYYY-MM-DD');
  const now = Date.parse(today);
  const people = new Map();
  for (const ev of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const p = people.get(ev.key) || { key: ev.key, last: null, consent: false, stopped: false, promises: [], dms: 0, lastDm: null, replied: false };
    p.last = ev;
    if (ev.event === 'yes' && !p.stopped) p.consent = true; // a stop is final: a later yes never restores consent
    if (ev.event === 'stop') { p.stopped = true; p.consent = false; }
    if (ev.event === 'promise') p.promises.push({ note: ev.note, due: ev.due, at: ev.at });
    if (ev.event === 'done') {
      // Close only the promise it names; a "done" that matches nothing closes nothing, so no promise vanishes.
      const same = (x) => String(x || '').trim().toLowerCase();
      const i = p.promises.findIndex((x) => same(x.note) === same(ev.note));
      if (i >= 0) p.promises.splice(i, 1);
    }
    if (ev.event === 'dm') { p.dms++; p.lastDm = ev.at; p.replied = false; }
    if (['reply', 'yes', 'stop'].includes(ev.event)) p.replied = true;
    people.set(ev.key, p);
  }
  const all = [...people.values()];
  const overdue = all.flatMap((p) => p.promises.filter((x) => Date.parse(x.due) < now).map((x) => ({ key: p.key, ...x })));
  const dueSoon = all.flatMap((p) => p.promises.filter((x) => Date.parse(x.due) >= now && (Date.parse(x.due) - now) / DAY <= 3).map((x) => ({ key: p.key, ...x })));
  const followUp = all.filter((p) => !p.stopped && !p.replied && p.dms === 1 && p.lastDm && (now - Date.parse(p.lastDm)) / DAY >= FOLLOW_UP_DAYS).map((p) => p.key);
  return { people, overdue, dueSoon, followUp, stopped: all.filter((p) => p.stopped).map((p) => p.key), consented: all.filter((p) => p.consent).map((p) => p.key) };
}

function main() {
  const a = args();
  const cmd = a._[0];
  if (!['add', 'status'].includes(cmd) || !a.log) {
    console.error('usage: tracker.mjs add --log <events.jsonl> --key "Brand | Name" --event <event> [--note ..] [--due YYYY-MM-DD] [--at YYYY-MM-DD]\n       tracker.mjs status --log <events.jsonl> --today YYYY-MM-DD');
    process.exit(2);
  }
  let log;
  try { log = assertOutsideRepo(a.log); } catch (e) { console.error(e.message); process.exit(2); }
  const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
  try {
    const events = parseLog(text);
    if (cmd === 'add') {
      const ev = validate({ key: a.key, event: a.event, at: a.at || new Date().toISOString().slice(0, 10), note: a.note, due: a.due });
      const prior = status(events, ev.at).people.get(ev.key);
      if (prior?.stopped && ['invite', 'dm', 'promise', 'yes'].includes(ev.event)) throw new Error('this person said stop: nothing more goes to them, and consent does not come back');
      appendFileSync(log, `${JSON.stringify(ev)}\n`);
      console.log(`added: ${ev.event} on ${ev.at}`);
      return;
    }
    const s = status(events, a.today);
    console.log(`people ${s.people.size} · consented ${s.consented.length} · stopped ${s.stopped.length} · follow-ups due ${s.followUp.length} · promises overdue ${s.overdue.length} · due within 3 days ${s.dueSoon.length}`);
    for (const x of s.overdue) console.log(`OVERDUE ${x.due}  ${x.key}: ${x.note}`);
    for (const x of s.dueSoon) console.log(`due ${x.due}  ${x.key}: ${x.note}`);
    for (const k of s.followUp) console.log(`follow up  ${k}`);
    process.exit(s.overdue.length ? 1 : 0);
  } catch (e) { console.error(e.message); process.exit(2); }
}

if (isMain(import.meta.url)) main();
