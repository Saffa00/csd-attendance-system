import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

/** Service-role client. SERVER ONLY. Never import this from anything sent to the browser. */
export const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/** Anon client used only to validate access tokens (auth.getUser). */
export const publicAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/**
 * Verify an email/password pair against Supabase Auth with a throwaway client so that
 * sessions never leak between requests. Returns the session on success, otherwise null.
 */
export async function verifyPassword(email, password) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  let { data, error } = await client.auth.signInWithPassword({ email, password });
  if (!error && data?.session) return data.session;

  const trimmed = typeof password === 'string' ? password.trim() : '';
  if (trimmed && trimmed !== password) {
    const res = await client.auth.signInWithPassword({ email, password: trimmed });
    if (!res.error && res.data?.session) return res.data.session;
  }
  return null;
}
