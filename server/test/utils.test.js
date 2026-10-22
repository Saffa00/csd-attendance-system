import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePhone, normaliseName, distanceMeters, randomPassword, zonedToUtcMs, sessionWindow,
  todayInTz, weekdayOf, rate, safeEqual
} from '../src/utils.js';

test('normalisePhone converts Sierra Leone local and international formats', () => {
  assert.equal(normalisePhone('076 123 456'), '23276123456');
  assert.equal(normalisePhone('+232 76 123 456'), '23276123456');
  assert.equal(normalisePhone('00232 76 123 456'), '23276123456');
  assert.equal(normalisePhone('+232 30 231858'), '23230231858');
  assert.equal(normalisePhone('+232-30-231858'), '23230231858');
});

test('normalisePhone rejects unsupported numbers', () => {
  assert.throws(() => normalisePhone('12345'), /valid Sierra Leone phone number/);
});

test('normaliseName trims, collapses spaces and lowercases', () => {
  assert.equal(normaliseName('  Aminata   KAMARA '), 'aminata kamara');
});

test('distanceMeters is zero for the same point and symmetric', () => {
  assert.equal(distanceMeters(8.4657, -13.2317, 8.4657, -13.2317), 0);
  const a = distanceMeters(8.4657, -13.2317, 8.4667, -13.2317), b = distanceMeters(8.4667, -13.2317, 8.4657, -13.2317);
  assert.ok(a > 100 && a < 120);
  assert.ok(Math.abs(a - b) < 0.001);
});

test('randomPassword produces a nontrivial temporary password', () => {
  assert.match(randomPassword(), /^CS![A-Za-z0-9_-]{12}$/);
});

test('zonedToUtcMs handles UTC and offset zones', () => {
  assert.equal(zonedToUtcMs('2026-10-19', '08:30', 'UTC'), Date.parse('2026-10-19T08:30:00Z'));
  assert.equal(zonedToUtcMs('2026-10-19', '08:30', 'Africa/Freetown'), Date.parse('2026-10-19T08:30:00Z'));
  assert.equal(zonedToUtcMs('2026-10-19', '08:30', 'Africa/Lagos'), Date.parse('2026-10-19T07:30:00Z'));
});

test('sessionWindow adds the grace period to the end', () => {
  const w = sessionWindow('2026-10-19', '08:00:00', '10:00:00', 10, 'UTC');
  assert.equal(w.start, Date.parse('2026-10-19T08:00:00Z'));
  assert.equal(w.end, Date.parse('2026-10-19T10:10:00Z'));
});

test('todayInTz and weekdayOf', () => {
  assert.equal(todayInTz('Africa/Lagos', Date.parse('2026-10-19T23:30:00Z')), '2026-10-20');
  assert.equal(weekdayOf('2026-10-19'), 1); // Monday
});

test('rate ignores pending submissions', () => {
  assert.equal(rate({ approved: 3, absent: 1, pending: 5 }), 75);
  assert.equal(rate({ pending: 2 }), 0);
});

test('safeEqual compares strings in constant time', () => {
  assert.ok(safeEqual('123456', '123456'));
  assert.ok(!safeEqual('123456', '123457'));
  assert.ok(!safeEqual('1', '12'));
});

test('HMAC-SHA256 QR token verification', async () => {
  const crypto = await import('node:crypto');
  const secret = 'a'.repeat(64);
  const sessionId = 'd27845f1-6f5a-49c5-bb8b-a42b48dabe6b';
  const slot = Math.floor(Date.now() / 30000);
  const sig = crypto.createHmac('sha256', secret).update(`${sessionId}.${slot}`).digest('hex');
  const token = `${sessionId}.${slot}.${sig}`;

  const [tSession, tSlotStr, tSig] = token.split('.');
  assert.equal(tSession, sessionId);
  assert.equal(parseInt(tSlotStr, 10), slot);

  const expected = crypto.createHmac('sha256', secret).update(`${tSession}.${tSlotStr}`).digest('hex');
  const bufReceived = Buffer.from(tSig, 'hex');
  const bufExpected = Buffer.from(expected, 'hex');
  assert.equal(bufReceived.length, bufExpected.length);
  assert.ok(crypto.timingSafeEqual(bufReceived, bufExpected));

  // Tampered signature or slot should fail
  const tamperedSig = Buffer.from('b'.repeat(64), 'hex');
  assert.ok(!crypto.timingSafeEqual(tamperedSig, bufExpected));
});

