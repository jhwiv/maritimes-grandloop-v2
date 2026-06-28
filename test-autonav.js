#!/usr/bin/env node
/*
 * test-autonav.js
 * ------------------------------------------------------------------
 * Verifies the time-aware auto-navigation that opens the app to the
 * current day's card on load. Extracts the REAL schedule array from
 * index.html (not a copy) and runs the same selection logic the app
 * uses, so the test reflects what ships.
 *
 *   TZ=America/New_York node test-autonav.js
 *
 * Exit 0 = all pass, 1 = any failure.
 * ------------------------------------------------------------------
 */
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── Extract the schedule array verbatim from index.html ──────────
function extractSchedule() {
  const anchor = html.indexOf('Maritimes trip schedule:');
  if (anchor === -1) throw new Error('schedule marker not found');
  const open = html.indexOf('var schedule = [', anchor);
  const start = html.indexOf('[', open + 'var schedule = '.length - 1);
  const close = html.indexOf('];', start);
  const body = html.slice(start + 1, close);
  const re = /\[\s*'([^']+)'\s*,\s*(null|'[^']+')\s*,\s*(-?\d+)\s*\]/g;
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push([m[1], m[2] === 'null' ? null : m[2].replace(/'/g, ''), Number(m[3])]);
  }
  if (out.length === 0) throw new Error('failed to parse schedule');
  return out;
}
const schedule = extractSchedule();

// ── Mirror of the shipped selection logic (latest entry <= now) ──
function pick(now) {
  let target = null, stopIdx = 0;
  for (let i = 0; i < schedule.length; i++) {
    const t = new Date(schedule[i][0]);
    if (now >= t) { target = schedule[i][1]; stopIdx = schedule[i][2]; }
  }
  return { target, stopIdx };
}

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}  (got ${JSON.stringify(actual)}${ok ? '' : ', expected ' + JSON.stringify(expected)})`);
  ok ? pass++ : fail++;
}

console.log(`\nDevice timezone: ${process.env.TZ || '(system default)'}`);
console.log(`Schedule entries parsed: ${schedule.length}`);
console.log(`Day 1 entry: ${schedule[0][0]} -> ${schedule[0][1]}\n`);

// Build a Date from an explicit-offset ISO string (timezone-safe).
const T = iso => new Date(iso);

// ── 1. The requested verification: 09:00 AM EDT opens to Day 1 ───
console.log('1) Day 1 activation (after lowering to 06:00 EDT):');
eq('09:00 AM EDT Jun 27 -> section-day1', pick(T('2026-06-27T09:00-04:00')).target, 'section-day1');
eq('00:00 EDT Jun 27 (exact) -> section-day1', pick(T('2026-06-27T00:00-04:00')).target, 'section-day1');
eq('05:59 AM EDT Jun 27 -> section-day1 (after midnight activation)', pick(T('2026-06-27T05:59-04:00')).target, 'section-day1');
eq('12:30 PM EDT Jun 27 still -> section-day1', pick(T('2026-06-27T12:30-04:00')).target, 'section-day1');

// 1b. Day 1's first .stop is "Afternoon" (arrival day), so stopIdx must be -1
// (= scroll to the day's date banner/overview), not 0 (= the afternoon).
console.log('\n1b) Day 1 lands on section top (stopIdx -1), not afternoon:');
eq('09:00 AM EDT Jun 27 -> stopIdx -1', pick(T('2026-06-27T09:00-04:00')).stopIdx, -1);
eq('Day 1 config stopIdx is -1', schedule[0][2], -1);

// 1c. Early-morning opens (before old 7-9 AM triggers) must show TODAY,
// not yesterday. Each day now activates at 00:00 local.
console.log('\n1c) Early-morning opens land on the correct day (00:00 activation):');
eq('Sun Jun 28 06:25 EDT -> section-day2', pick(T('2026-06-28T06:25-04:00')).target, 'section-day2');
eq('Sun Jun 28 00:30 EDT -> section-day2', pick(T('2026-06-28T00:30-04:00')).target, 'section-day2');
eq('Mon Jun 29 05:00 ADT -> section-day3', pick(T('2026-06-29T05:00-03:00')).target, 'section-day3');
eq('Tue Jun 30 06:00 ADT -> section-day4', pick(T('2026-06-30T06:00-03:00')).target, 'section-day4');
eq('Wed Jul 1 06:00 NDT -> section-day5', pick(T('2026-07-01T06:00-02:30')).target, 'section-day5');
eq('Thu Jul 2 06:00 NDT -> section-fogo', pick(T('2026-07-02T06:00-02:30')).target, 'section-fogo');
eq('Mon Jul 6 06:00 ADT -> section-day10', pick(T('2026-07-06T06:00-03:00')).target, 'section-day10');
eq('Tue Jul 7 06:00 ADT -> section-day11', pick(T('2026-07-07T06:00-03:00')).target, 'section-day11');
eq('Wed Jul 8 06:00 EDT -> section-day12', pick(T('2026-07-08T06:00-04:00')).target, 'section-day12');
// Boundary: 23:59 the night before must still be the PRIOR day.
eq('Sat Jun 27 23:59 EDT -> section-day1', pick(T('2026-06-27T23:59-04:00')).target, 'section-day1');

// 1d. TIME-OF-DAY tracking: within a day, landing advances to the event
// card closest to (at or before) the current time.
console.log('\n1d) Landing tracks time-of-day within a day:');
function at(iso){ var p = pick(T(iso)); return p.target + '#' + p.stopIdx; }
// Day 2 (Sun): Morning(0) -> En Route(1 @11:00) -> Ferry(2 @14:15 ADT) -> Arrive(3 @17:00 ADT)
eq('Sun 06:33 EDT -> Day2 stop0 (Morning)',  at('2026-06-28T06:33-04:00'), 'section-day2#0');
eq('Sun 11:30 EDT -> Day2 stop1 (En Route)', at('2026-06-28T11:30-04:00'), 'section-day2#1');
eq('Sun 14:30 ADT -> Day2 stop2 (Ferry)',    at('2026-06-28T14:30-03:00'), 'section-day2#2');
eq('Sun 19:00 ADT -> Day2 stop3 (Arrive)',   at('2026-06-28T19:00-03:00'), 'section-day2#3');
// Day 1 (arrival): section top(-1) -> Afternoon(0 @13:00) -> Evening(1 @18:00)
eq('Sat 07:00 EDT -> Day1 top(-1)',          at('2026-06-27T07:00-04:00'), 'section-day1#-1');
eq('Sat 15:00 EDT -> Day1 stop0 (Afternoon)',at('2026-06-27T15:00-04:00'), 'section-day1#0');
eq('Sat 19:30 EDT -> Day1 stop1 (Evening)',  at('2026-06-27T19:30-04:00'), 'section-day1#1');
// Day 5 (NDT): Morning(0)->MidMorn(1 @10)->Lunch(2 @12:30)->Evening(3 @18)
eq('Wed 09:00 NDT -> Day5 stop0',            at('2026-07-01T09:00-02:30'), 'section-day5#0');
eq('Wed 13:00 NDT -> Day5 stop2 (Lunch)',    at('2026-07-01T13:00-02:30'), 'section-day5#2');
eq('Wed 20:00 NDT -> Day5 stop3 (Evening)',  at('2026-07-01T20:00-02:30'), 'section-day5#3');

// ── 2. Day 1 entry value is exactly the new time ────────────────
console.log('\n2) Config value:');
eq('Day 1 ISO is 00:00 EDT', schedule[0][0], '2026-06-27T00:00-04:00');
eq('Day 1 section unchanged', schedule[0][1], 'section-day1');

// ── 3. Regression: later days still activate at their times ─────
console.log('\n3) Other days unchanged:');
eq('Jun 28 09:00 EDT -> section-day2', pick(T('2026-06-28T09:00-04:00')).target, 'section-day2');
eq('Jun 29 20:30 ADT -> section-day3', pick(T('2026-06-29T20:30-03:00')).target, 'section-day3');
eq('Jul 8 21:00 EDT (trip over) -> null', pick(T('2026-07-08T21:00-04:00')).target, null);

// ── 4. Integrity: every scheduled stopIdx exists in its section ──
console.log('\n4) Every scheduled stopIdx is valid for its section:');
function stopCount(sectionId) {
  const re = new RegExp('<section id="' + sectionId + '"');
  const m = re.exec(html);
  if (!m) return null;
  const start = m.index;
  // next <section id="..."> after start
  const after = html.slice(start + 10);
  const nextRel = after.search(/<section id="section-/);
  const block = nextRel === -1 ? html.slice(start) : html.slice(start, start + 10 + nextRel);
  // Match the DOM's .stop selector: count elements whose class list contains
  // 'stop' as a standalone token (so class="stop is-ferry" counts, but
  // class="stop-time" does not) -- exactly what querySelectorAll('.stop') does.
  let n = 0;
  const classAttrs = block.match(/class="[^"]*"/g) || [];
  for (const ca of classAttrs) {
    const tokens = ca.slice(7, -1).split(/\s+/);
    if (tokens.includes('stop')) n++;
  }
  return n;
}
let badIdx = null;
for (const [iso, sec, idx] of schedule) {
  if (sec === null) continue;
  const n = stopCount(sec);
  // idx -1 (section top) is always valid; otherwise must be < stop count
  if (idx !== -1 && (n === null || idx >= n)) { badIdx = `${sec} idx ${idx} but ${n} stops`; break; }
}
eq('all scheduled stop indices valid', badIdx, null);

console.log(`\n${'='.repeat(48)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(48));
process.exit(fail === 0 ? 0 : 1);
