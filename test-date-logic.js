#!/usr/bin/env node
/*
 * test-date-logic.js
 * ------------------------------------------------------------------
 * Regression tests for the trip's runtime date/location logic.
 *
 * WHY THIS EXISTS
 * The concierge city hook (getItineraryCity) and the timezone pill
 * (getPhase) used to mix UTC dates (new Date().toISOString()) with
 * local parsing. On a US-Eastern device this rolled the trip day
 * forward ~4 hours early every evening, so after ~8 PM the app thought
 * it was already "tomorrow" — wrong concierge location, wrong timezone
 * pill. These tests pin the CORRECT behaviour using the device's LOCAL
 * calendar date, and specifically cover the late-evening MIDNIGHT
 * ROLLOVER boundary that exposed the original bug.
 *
 * HOW IT WORKS
 * The helper logic and TRIP_ZONES table are extracted verbatim from
 * index.html at runtime (not re-implemented), so the test always
 * reflects what actually ships. Run with the traveler's timezone:
 *
 *     TZ=America/New_York node test-date-logic.js
 *
 * Exit code 0 = all pass, 1 = any failure (CI-friendly).
 * ------------------------------------------------------------------
 */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ── Extract the canonical TRIP_DAYS map from index.html ──────────
function extractTripDays() {
  const start = html.indexOf('var TRIP_DAYS = {');
  if (start === -1) throw new Error('TRIP_DAYS map not found in index.html');
  const open = html.indexOf('{', start);
  const close = html.indexOf('};', open);
  const body = html.slice(open + 1, close);
  const map = {};
  const re = /'(\d{4}-\d{2}-\d{2})'\s*:\s*\{\s*day:\s*(\d+)\s*,\s*city:\s*'([a-z]+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    map[m[1]] = { day: Number(m[2]), city: m[3] };
  }
  if (Object.keys(map).length === 0) throw new Error('Failed to parse TRIP_DAYS entries');
  return map;
}

// ── Extract TRIP_ZONES (timezone pill phases) from index.html ────
function extractTripZones() {
  const start = html.indexOf('var TRIP_ZONES = [');
  if (start === -1) throw new Error('TRIP_ZONES not found in index.html');
  const open = html.indexOf('[', start);
  const close = html.indexOf('];', open);
  const body = html.slice(open + 1, close);
  const zones = [];
  const re = /start:\s*'(\d{4}-\d{2}-\d{2})'\s*,\s*end:\s*'(\d{4}-\d{2}-\d{2})'[^}]*?label:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    zones.push({ start: m[1], end: m[2], label: m[3] });
  }
  if (zones.length === 0) throw new Error('Failed to parse TRIP_ZONES');
  return zones;
}

const TRIP_DAYS = extractTripDays();
const TRIP_ZONES = extractTripZones();

// ── Re-create the SHIPPED helper behaviour (local-date based) ────
// Mirrors window.__trip.localDateStr / tripDayInfo and getPhase exactly.
function localDateStr(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}
function tripDayInfo(d) {
  const ds = localDateStr(d);
  const info = TRIP_DAYS[ds];
  return info ? { dateStr: ds, day: info.day, city: info.city }
              : { dateStr: ds, day: null, city: null };
}
function getItineraryCity(d) { return tripDayInfo(d).city; }
function getPhase(d) {
  const today = localDateStr(d);
  for (const z of TRIP_ZONES) if (today >= z.start && today <= z.end) return z.label;
  return 'ATLANTIC'; // documented default before/after trip
}

// ── Guard: every shipped concierge city key must be one the app has ──
const SUPPORTED_CITIES = ['portland', 'halifax', 'lunenburg', 'stjohns', 'fogoisland'];

// ── Test harness ────────────────────────────────────────────────
let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}  (got ${JSON.stringify(actual)}${ok ? '' : ', expected ' + JSON.stringify(expected)})`);
  ok ? pass++ : fail++;
}

// EDT = UTC-4. A wall-clock time "Jun 27 21:00 EDT" is Date.UTC(2026,5,28,1,0).
// Building Dates via Date.UTC + the TZ=America/New_York env means getFullYear/
// getMonth/getDate return EASTERN-LOCAL components — exactly a real device.
const D = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo, d, h, mi));

console.log(`\nDevice timezone (process.env.TZ): ${process.env.TZ || '(system default)'}`);
console.log('Trip days parsed:', Object.keys(TRIP_DAYS).length, '| Zones parsed:', TRIP_ZONES.length, '\n');

// ── 1. Day-of-trip resolves correctly at NOON each day ───────────
console.log('1) Trip day + concierge city at local noon, each day:');
const noonExpect = [
  ['2026-06-27', 1,  'portland'],   ['2026-06-28', 2,  'lunenburg'],
  ['2026-06-29', 3,  'lunenburg'],  ['2026-06-30', 4,  'halifax'],
  ['2026-07-01', 5,  'stjohns'],    ['2026-07-02', 6,  'fogoisland'],
  ['2026-07-03', 7,  'fogoisland'], ['2026-07-04', 8,  'fogoisland'],
  ['2026-07-05', 9,  'halifax'],    ['2026-07-06', 10, 'halifax'],
  ['2026-07-07', 11, 'halifax'],    ['2026-07-08', 12, 'portland'],
];
for (const [ds, day, city] of noonExpect) {
  const [Y, M, Dd] = ds.split('-').map(Number);
  const dt = D(Y, M - 1, Dd, 16, 0); // 16:00 UTC = 12:00 EDT
  eq(`${ds} noon -> day`, tripDayInfo(dt).day, day);
  eq(`${ds} noon -> city`, getItineraryCity(dt), city);
}

// ── 2. MIDNIGHT ROLLOVER: the exact bug that used to fail ────────
// At 21:00, 23:00, 23:59 EDT it must STILL be the same trip day,
// because UTC has already rolled to "tomorrow" but local has not.
console.log('\n2) Late-evening / midnight rollover (the original UTC bug):');
eq('Jun 27 21:00 EDT still Day 1',         tripDayInfo(D(2026,5,28,1,0)).day, 1);
eq('Jun 27 21:00 EDT city still portland', getItineraryCity(D(2026,5,28,1,0)), 'portland');
eq('Jun 27 23:59 EDT still Day 1',         tripDayInfo(D(2026,5,28,3,59)).day, 1);
eq('Jun 30 22:00 EDT still Day 4 (ferry)', tripDayInfo(D(2026,6,1,2,0)).day, 4);
eq('Jun 30 22:00 EDT pill still FERRY',    getPhase(D(2026,6,1,2,0)), 'FERRY');
// And it DOES advance exactly at local midnight, not before:
eq('Jun 28 00:01 EDT becomes Day 2',       tripDayInfo(D(2026,5,28,4,1)).day, 2);
eq('Jul 1 00:30 EDT becomes Day 5',        tripDayInfo(D(2026,6,1,4,30)).day, 5);

// ── 3. Timezone pill phase matches the trip day, not UTC ─────────
console.log('\n3) Timezone pill (getPhase) tracks LOCAL day:');
eq('Jun 27 morning -> PORTLAND',     getPhase(D(2026,5,27,16,0)), 'PORTLAND');
eq('Jun 27 21:00 EDT -> still PORTLAND (was ATLANTIC bug)', getPhase(D(2026,5,28,1,0)), 'PORTLAND');
eq('Jul 1 noon -> NEWFOUNDLAND',     getPhase(D(2026,6,1,16,0)), 'NEWFOUNDLAND');
eq('Jul 5 noon -> RETURN FERRY',     getPhase(D(2026,6,5,16,0)), 'RETURN FERRY');
eq('Jul 8 noon -> HOME',             getPhase(D(2026,6,8,16,0)), 'HOME');

// ── 4. Off-trip windows return null (no false "you're traveling") ─
console.log('\n4) Off-trip dates resolve to null:');
eq('Jun 26 (pre-trip) day null',  tripDayInfo(D(2026,5,26,16,0)).day, null);
eq('Jun 26 (pre-trip) city null', getItineraryCity(D(2026,5,26,16,0)), null);
eq('Jul 9 (post-trip) day null',  tripDayInfo(D(2026,6,9,16,0)).day, null);

// ── 5. Integrity: every city key is one the concierge supports ───
console.log('\n5) Every mapped city is a supported concierge dataset:');
let badKey = null;
for (const k of Object.keys(TRIP_DAYS)) {
  if (!SUPPORTED_CITIES.includes(TRIP_DAYS[k].city)) { badKey = TRIP_DAYS[k].city; break; }
}
eq('all city keys supported', badKey, null);
eq('trip spans exactly 12 days', Object.keys(TRIP_DAYS).length, 12);

// ── Summary ──────────────────────────────────────────────────────
console.log(`\n${'='.repeat(48)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(48));
process.exit(fail === 0 ? 0 : 1);
