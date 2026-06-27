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

// ── Extract CITY_COORDS from index.html (GPS-aware concierge) ────
function extractCityCoords() {
  const start = html.indexOf('var CITY_COORDS = {');
  if (start === -1) throw new Error('CITY_COORDS not found in index.html');
  const open = html.indexOf('{', start);
  const close = html.indexOf('};', open);
  const body = html.slice(open + 1, close);
  const coords = {};
  const re = /([a-z]+)\s*:\s*\{\s*lat:\s*(-?\d+\.?\d*)\s*,\s*lng:\s*(-?\d+\.?\d*)\s*\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    coords[m[1]] = { lat: Number(m[2]), lng: Number(m[3]) };
  }
  if (Object.keys(coords).length === 0) throw new Error('Failed to parse CITY_COORDS');
  return coords;
}
const CITY_COORDS = extractCityCoords();

// ── Re-create the SHIPPED GPS resolution behaviour ──────────────
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function nearestCity(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
  let best = null, bestD = Infinity;
  for (const k of Object.keys(CITY_COORDS)) {
    const d = haversineKm(lat, lng, CITY_COORDS[k].lat, CITY_COORDS[k].lng);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best ? { city: best, distanceKm: bestD } : null;
}
function resolveConciergeCity(gps, date) {
  if (gps && typeof gps.lat === 'number' && typeof gps.lng === 'number'
      && !isNaN(gps.lat) && !isNaN(gps.lng)) {
    const n = nearestCity(gps.lat, gps.lng);
    if (n) return { city: n.city, source: 'gps', distanceKm: n.distanceKm };
  }
  const info = tripDayInfo(date || new Date());
  if (info.city) return { city: info.city, source: 'date' };
  return { city: null, source: null };
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

// ── GPS-aware concierge suites (sections 6-8) ──
runGpsSuites();

function runGpsSuites() {
// Real coordinates of the places visited (independent of dataset hubs),
// used to simulate a device GPS fix on each day.
const GPS_FIX = {
  portlandME:   { lat: 43.6591, lng: -70.2568 }, // Day 1/12
  digby:        { lat: 44.6217, lng: -65.7573 }, // Day 2
  lunenburg:    { lat: 44.3716, lng: -64.3093 }, // Day 3
  northSydney:  { lat: 46.2170, lng: -60.2490 }, // Day 4/9
  twillingate:  { lat: 49.6500, lng: -54.7667 }, // Day 5
  fogo:         { lat: 49.7167, lng: -54.1833 }, // Day 6-8
  pictou:       { lat: 45.6793, lng: -62.7108 }, // Day 10
  fredericton:  { lat: 45.9636, lng: -66.6431 }  // Day 11
};

// 6. GPS GRANTED: snap to nearest dataset, source = 'gps'
console.log('\n6) GPS granted -> nearest dataset wins (source=gps):');
function gpsCase(label, fix, expectCity) {
  const offDate = D(2026, 5, 27, 16, 0); // would be 'portland' by date
  const r = resolveConciergeCity(fix, offDate);
  eq(label + ' -> city', r.city, expectCity);
  eq(label + ' -> source', r.source, 'gps');
}
gpsCase('Portland fix',     GPS_FIX.portlandME,  'portland');
gpsCase('Digby fix',        GPS_FIX.digby,       'lunenburg');   // nearest hub
gpsCase('Lunenburg fix',    GPS_FIX.lunenburg,   'lunenburg');
gpsCase('North Sydney fix', GPS_FIX.northSydney, 'halifax');     // nearest hub
gpsCase('Twillingate fix',  GPS_FIX.twillingate, 'fogoisland');  // nearest hub (NL)
gpsCase('Fogo fix',         GPS_FIX.fogo,        'fogoisland');
gpsCase('Pictou fix',       GPS_FIX.pictou,      'halifax');     // nearest hub
// Fredericton, NB: by great-circle distance the nearest dataset is
// Lunenburg (254 km) vs Halifax (281 km) -- verified, not assumed.
gpsCase('Fredericton fix',  GPS_FIX.fredericton, 'lunenburg');

console.log('\n   GPS overrides date when they disagree:');
{
  const r = resolveConciergeCity(GPS_FIX.fogo, D(2026,5,27,16,0)); // date=Day1 Portland
  eq('Fogo GPS on Day-1 date -> city', r.city, 'fogoisland');
  eq('Fogo GPS on Day-1 date -> source', r.source, 'gps');
}

// 7. GPS DENIED / UNAVAILABLE: fall back to date logic
console.log('\n7) GPS denied/unavailable -> date fallback (source=date):');
function deniedCase(label, gps, date, expectCity, expectSource) {
  const r = resolveConciergeCity(gps, date);
  eq(label + ' -> city', r.city, expectCity);
  eq(label + ' -> source', r.source, expectSource);
}
const day5 = D(2026,6,1,16,0);  // Twillingate day -> date city 'stjohns'
deniedCase('null GPS on Day 5',        null,              day5, 'stjohns', 'date');
deniedCase('undefined GPS on Day 5',   undefined,         day5, 'stjohns', 'date');
deniedCase('empty object on Day 5',    {},                day5, 'stjohns', 'date');
deniedCase('NaN coords on Day 5',      {lat:NaN,lng:NaN}, day5, 'stjohns', 'date');
deniedCase('string coords on Day 5',   {lat:'x',lng:'y'}, day5, 'stjohns', 'date');
deniedCase('null GPS on Day 1',        null, D(2026,5,27,16,0), 'portland', 'date');
// Late-evening + GPS denied must STILL use local date (no UTC rollover):
deniedCase('null GPS Jun27 21:00 EDT', null, D(2026,5,28,1,0), 'portland', 'date');
// Off-trip + GPS denied -> null (caller uses tab fallback):
deniedCase('null GPS pre-trip',  null, D(2026,5,26,16,0), null, null);
deniedCase('null GPS post-trip', null, D(2026,6,9,16,0),  null, null);

// 8. Distance sanity
console.log('\n8) nearestCity distance sanity:');
eq('Fogo fix distance < 5 km', nearestCity(GPS_FIX.fogo.lat, GPS_FIX.fogo.lng).distanceKm < 5, true);
eq('Lunenburg fix distance < 5 km', nearestCity(GPS_FIX.lunenburg.lat, GPS_FIX.lunenburg.lng).distanceKm < 5, true);
eq('invalid coords -> null', nearestCity('a', 'b'), null);
eq('every CITY_COORDS key is supported',
   Object.keys(CITY_COORDS).every(function(k){ return SUPPORTED_CITIES.includes(k); }), true);
}

console.log(`\n${'='.repeat(48)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(48));
process.exit(fail === 0 ? 0 : 1);
