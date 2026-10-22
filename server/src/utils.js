import crypto from 'node:crypto';

/** Sierra Leone phone normalisation: "+232 30 231858" -> "23230231858". */
export function normalisePhone(value = '') {
  let n = String(value).replace(/[\s+\-()]/g, '');
  if (n.startsWith('00232')) n = '232' + n.slice(5);
  else if (n.startsWith('0')) n = '232' + n.slice(1);
  else if (!n.startsWith('232') && (n.length === 8 || n.length === 9)) n = '232' + n;
  if (!/^232\d{8,9}$/.test(n)) throw new Error('Enter a valid Sierra Leone phone number');
  return n;
}

/** Name key for "full name + password" student login: trim, collapse spaces, lowercase. */
export function normaliseName(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Haversine distance in metres. */
export function distanceMeters(a, b, c, d) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(c - a), dLon = rad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function randomPassword() {
  return 'CS!' + crypto.randomBytes(9).toString('base64url');
}

export function randomToken(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function safeEqual(a = '', b = '') {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Clean a recovery code by stripping dashes and whitespace, converted to uppercase */
export function cleanRecoveryCode(code = '') {
  return String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Generates a formatted single-use recovery code, e.g. "RC-4A7B-9E2D-3F8K" */
export function generateRecoveryCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // avoids 0/O, 1/I confusion
  let raw = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) {
    raw += chars[bytes[i] % chars.length];
  }
  return `RC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Generates a SHA-256 hash of the cleaned recovery code */
export function hashRecoveryCode(code = '') {
  const clean = cleanRecoveryCode(code);
  return crypto.createHash('sha256').update(`mmtu-cs-recovery-salt-2026:${clean}`).digest('hex');
}

export const TZ = () => process.env.APP_TIMEZONE || 'Africa/Freetown';

function tzOffsetMs(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** Convert a local wall-clock date ("2026-10-19") + time ("08:30[:00]") in `tz` to UTC milliseconds. */
export function zonedToUtcMs(date, time, tz = TZ()) {
  const t = String(time).length === 5 ? `${time}:00` : String(time);
  const asUtc = Date.parse(`${date}T${t}Z`);
  let ms = asUtc - tzOffsetMs(asUtc, tz);
  ms = asUtc - tzOffsetMs(ms, tz);
  return ms;
}

/** Today's date (YYYY-MM-DD) in the department's timezone. */
export function todayInTz(tz = TZ(), now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** 0 = Sunday ... 6 = Saturday for a YYYY-MM-DD string. */
export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Scheduled class window for a given session date, including the 5-minute pre-start window and grace period at the end. */
export function sessionWindow(date, startsAt, endsAt, graceMinutes = Number(process.env.ATTENDANCE_GRACE_MINUTES || 10), tz = TZ()) {
  const start = zonedToUtcMs(date, startsAt, tz);
  return {
    earliestOpen: start - 5 * 60000,
    start,
    end: zonedToUtcMs(date, endsAt, tz) + graceMinutes * 60000
  };
}

export const uniq = arr => [...new Set(arr)];
export const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

/** Attendance percentage: approved / reviewed sessions (pending submissions are not yet counted against the student). */
export function rate(c) {
  const denom = (c.approved || 0) + (c.rejected || 0) + (c.absent || 0) + (c.correction_requested || 0);
  return denom ? Math.round((c.approved || 0) / denom * 100) : 0;
}
