import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, isConfigured } from './supabase';
import { apiFetch, deviceId } from './api';
import { wipeLocalData, cacheGet, cacheSet } from './offline';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Holds the signed-in profile. Login goes through the Node API (lockouts, student name login);
 * the returned session is then handed to the Supabase client so RLS reads work.
 */
export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      let { data } = await supabase.auth.getSession().catch(() => ({ data: {} }));
      let session = data?.session;
      if (!session && localStorage.getItem('auth_refresh_token')) {
        const refreshed = await supabase.auth.refreshSession({
          refresh_token: localStorage.getItem('auth_refresh_token')
        }).catch(() => ({ data: {} }));
        session = refreshed.data?.session;
        if (session?.access_token) {
          localStorage.setItem('auth_access_token', session.access_token);
          if (session.refresh_token) localStorage.setItem('auth_refresh_token', session.refresh_token);
        }
      }
      if (!session && !localStorage.getItem('auth_access_token')) {
        setProfile(null);
        return null;
      }
      const uid = session?.user?.id;
      try {
        const p = await apiFetch('/auth/me');
        setProfile(p);
        if (p?.id && window.OneSignalDeferred) {
          window.OneSignalDeferred.push(async OneSignal => {
            try {
              if (import.meta.env.VITE_ONESIGNAL_APP_ID) {
                await OneSignal.init({ appId: import.meta.env.VITE_ONESIGNAL_APP_ID });
              }
              await OneSignal.login(p.id);
            } catch {}
          });
        }
        if (uid) cacheSet(uid, 'profile', p).catch(() => {});
        return p;
      } catch (e) {
        if (e.network && uid) {
          const hit = await cacheGet(uid, 'profile');
          if (hit) {
            setProfile(hit.value);
            return hit.value;
          }
        }
        localStorage.removeItem('auth_access_token');
        localStorage.removeItem('auth_refresh_token');
        await supabase.auth.signOut().catch(() => {});
        setProfile(null);
        return null;
      }
    } catch (err) {
      console.warn('Session check failed:', err);
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    loadProfile().finally(() => setLoading(false));
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async OneSignal => {
        try { await OneSignal.logout(); } catch {}
      });
    }
    localStorage.removeItem('auth_access_token');
    localStorage.removeItem('auth_refresh_token');
    await wipeLocalData().catch(() => {});
    await supabase.auth.signOut().catch(() => {});
    setProfile(null);
  }, []);

  useEffect(() => {
    const expired = () => signOut();
    window.addEventListener('auth-expired', expired);
    return () => window.removeEventListener('auth-expired', expired);
  }, [signOut]);

  const signIn = useCallback(async (identity, password) => {
    const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000/api'}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId() },
      body: JSON.stringify({ identity, password })
    }).catch(() => { throw new Error('Cannot reach the server. Make sure the backend API is running on port 4000.'); });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Login failed');
    if (body.session?.access_token) {
      localStorage.setItem('auth_access_token', body.session.access_token);
      if (body.session.refresh_token) localStorage.setItem('auth_refresh_token', body.session.refresh_token);
    }
    const { error } = await supabase.auth.setSession({ access_token: body.session.access_token, refresh_token: body.session.refresh_token }).catch(() => ({ error: null }));
    if (error) console.warn('Supabase session set warning:', error.message);
    setProfile(body.profile);
    if (body.profile?.id && window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async OneSignal => {
        try {
          if (import.meta.env.VITE_ONESIGNAL_APP_ID) {
            await OneSignal.init({ appId: import.meta.env.VITE_ONESIGNAL_APP_ID });
          }
          await OneSignal.login(body.profile.id);
        } catch {}
      });
    }
    return body.profile;
  }, []);

  return (
    <AuthContext.Provider value={{ profile, setProfile, loading, signIn, signOut, reloadProfile: loadProfile, isConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}
