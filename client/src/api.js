import { supabase } from './supabase';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

/** Stable per-device id, sent with login requests so repeated failures can lock a single device. */
export function deviceId() {
  let id = localStorage.getItem('device_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('device_id', id); }
  return id;
}

/**
 * Calls the Node.js API with the Supabase access token.
 * Errors carry: .status, .code (server error code), .network (true when the request never reached the server).
 */
export async function apiFetch(path, { method = 'GET', body, raw = false } = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      token = data.session.access_token;
      // Proactively refresh if token expires in less than 45 seconds
      if (data.session.expires_at && data.session.expires_at * 1000 < Date.now() + 45000) {
        const refreshed = await supabase.auth.refreshSession().catch(() => null);
        if (refreshed?.data?.session?.access_token) {
          token = refreshed.data.session.access_token;
          localStorage.setItem('auth_access_token', token);
          if (refreshed.data.session.refresh_token) {
            localStorage.setItem('auth_refresh_token', refreshed.data.session.refresh_token);
          }
        }
      }
    }
  } catch {}

  // Fallback to localStorage backup if Supabase client state was momentarily unready
  if (!token) {
    token = localStorage.getItem('auth_access_token');
    const refreshToken = localStorage.getItem('auth_refresh_token');
    if (!token && refreshToken) {
      const refreshed = await supabase.auth.refreshSession({ refresh_token: refreshToken }).catch(() => null);
      if (refreshed?.data?.session?.access_token) {
        token = refreshed.data.session.access_token;
        localStorage.setItem('auth_access_token', token);
        if (refreshed.data.session.refresh_token) {
          localStorage.setItem('auth_refresh_token', refreshed.data.session.refresh_token);
        }
      }
    }
  }

  const headers = { 'x-device-id': deviceId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error('You appear to be offline. Check your connection.');
    e.network = true;
    throw e;
  }
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const e = new Error(json?.error || 'Request failed');
    e.status = res.status; e.code = json?.code;
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/forgot-password')) {
      window.dispatchEvent(new Event('auth-expired'));
    }
    throw e;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

/** Download a report (PDF / Excel) through the authenticated API. */
export async function download(path, filename) {
  const res = await apiFetch(path, { raw: true });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const qs = params => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v !== undefined && v !== null) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
