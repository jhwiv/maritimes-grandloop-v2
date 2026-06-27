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
  const re = /\[\s*'([^']+)'\s*,\s*(null|'[^']+')\s*,\s*(\d+)\s*\]/g;
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
eq('06:00 AM EDT Jun 27 (exact) -> section-day1', pick(T('2026-06-27T06:00-04:00')).target, 'section-day1');
eq('05:59 AM EDT Jun 27 -> null (top, before activation)', pick(T('2026-06-27T05:59-04:00')).target, null);
eq('12:30 PM EDT Jun 27 still -> section-day1', pick(T('2026-06-27T12:30-04:00')).target, 'section-day1');

// ── 2. Day 1 entry value is exactly the new time ────────────────
console.log('\n2) Config value:');
eq('Day 1 ISO is 06:00 EDT', schedule[0][0], '2026-06-27T06:00-04:00');
eq('Day 1 section unchanged', schedule[0][1], 'section-day1');

// ── 3. Regression: later days still activate at their times ─────
console.log('\n3) Other days unchanged:');
eq('Jun 28 09:00 EDT -> section-day2', pick(T('2026-06-28T09:00-04:00')).target, 'section-day2');
eq('Jun 29 20:30 ADT -> section-day3', pick(T('2026-06-29T20:30-03:00')).target, 'section-day3');
eq('Jul 8 21:00 EDT (trip over) -> null', pick(T('2026-07-08T21:00-04:00')).target, null);

console.log(`\n${'='.repeat(48)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(48));
process.exit(fail === 0 ? 0 : 1);
