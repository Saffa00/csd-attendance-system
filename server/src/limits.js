import rateLimit from 'express-rate-limit';
import { admin } from './supabase.js';

// ---------- express-rate-limit instances (one per purpose so counters are not shared) ----------
const make = (windowMs, limit, message, keyGenerator) =>
  rateLimit({
    windowMs, limit, standardHeaders: true, legacyHeaders: false,
    message: { error: message },
    ...(keyGenerator ? { keyGenerator } : {}),
    validate: { xForwardedForHeader: false }
  });

const perUserOrIp = req => req.profile?.id || req.ip;

export const loginLimit      = make(15 * 60 * 1000, 60, 'Too many login attempts from this network. Try again later.');
export const registerLimit   = make(60 * 60 * 1000, 40, 'Too many registrations from this network. Try again later.');
export const staffLimit      = make(15 * 60 * 1000, 30, 'Too many account creations. Try again later.', perUserOrIp);
export const resendLimit     = make(15 * 60 * 1000, 40, 'Too many credential resets. Try again later.', perUserOrIp);
export const passwordLimit   = make(15 * 60 * 1000, 20, 'Too many password change attempts.', perUserOrIp);
export const attendanceLimit = make(60 * 1000, 20, 'Too many attendance requests. Wait a moment.', perUserOrIp);

// ---------- persistent failure counters / lockouts (device + IP + account) ----------
export async function lockStatus(keys) {
  if (!keys.length) return { locked: false };
  const { data } = await admin.from('login_attempts').select('key,locked_until').in('key', keys);
  const now = Date.now();
  const until = (data || []).map(r => (r.locked_until ? Date.parse(r.locked_until) : 0)).filter(t => t > now);
  if (!until.length) return { locked: false };
  return { locked: true, minutes: Math.max(1, Math.ceil((Math.max(...until) - now) / 60000)) };
}

/** guards = [{key, max}]; locks a key for `lockMinutes` after `max` consecutive failures. */
export async function recordFailure(guards, lockMinutes = Number(process.env.LOGIN_LOCK_MINUTES || 15)) {
  const keys = guards.map(g => g.key);
  const { data } = await admin.from('login_attempts').select('key,failures,locked_until').in('key', keys);
  const byKey = new Map((data || []).map(r => [r.key, r]));
  const now = Date.now();
  const rows = guards.map(({ key, max }) => {
    const prev = byKey.get(key);
    const expired = prev?.locked_until && Date.parse(prev.locked_until) <= now;
    const failures = (expired ? 0 : prev?.failures || 0) + 1;
    return {
      key, failures: failures >= max ? 0 : failures,
      locked_until: failures >= max ? new Date(now + lockMinutes * 60000).toISOString() : null,
      updated_at: new Date().toISOString()
    };
  });
  await admin.from('login_attempts').upsert(rows, { onConflict: 'key' });
}

export async function clearFailures(keys) {
  if (keys.length) await admin.from('login_attempts').delete().in('key', keys);
}
