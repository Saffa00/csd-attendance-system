import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';

/** Loads `path` from the API and re-loads when `path` changes. */
export function useApi(path, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: enabled });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!enabled || !path) return;
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const data = await apiFetch(path);
      if (alive.current) setState({ data, error: '', loading: false });
    } catch (e) {
      if (alive.current) setState(s => ({ data: s.data, error: e.message, loading: false }));
    }
  }, [path, enabled]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: data => setState(s => ({ ...s, data })) };
}

/** Wraps an async action with busy / error / success state. */
export function useAction() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const run = useCallback(async (label, fn, success = '') => {
    setBusy(label || 'busy'); setError(''); setOk('');
    try { const r = await fn(); if (success) setOk(success); return r; }
    catch (e) { setError(e.message || 'Something went wrong'); return undefined; }
    finally { setBusy(''); }
  }, []);
  return { busy, error, ok, run, setError, setOk };
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/** Captures the browser's "install app" prompt (Android/Chrome/Edge) so we can show our own button. */
export function useInstallPrompt() {
  const [evt, setEvt] = useState(null);
  const [installed, setInstalled] = useState(window.matchMedia?.('(display-mode: standalone)').matches || false);
  useEffect(() => {
    const before = e => { e.preventDefault(); setEvt(e); };
    const done = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', done); };
  }, []);
  const install = async () => { if (!evt) return; evt.prompt(); await evt.userChoice; setEvt(null); };
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return { canInstall: Boolean(evt), installed, install, isIos };
}

// ---------------------------------------------------------------- small presentational helpers
export const Loading = ({ text = 'Loading…' }) => <div className="loading" role="status"><div className="spinner" />{text}</div>;
export const ErrorText = ({ children }) => (children ? <p className="error" role="alert">{children}</p> : null);
export const Success = ({ children }) => (children ? <p className="success" role="status">{children}</p> : null);
export const Empty = ({ children }) => <p className="empty">{children}</p>;

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && <div className="section-heading">{title && <h2>{title}</h2>}{action}</div>}
      {children}
    </section>
  );
}

export const Stat = ({ label, value, hint, tone }) => (
  <div className={`stat ${tone || ''}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
);

const TONE = {
  approved: 'ok',
  pending: 'warn',
  rejected: 'bad',
  absent: 'bad',
  correction_requested: 'warn',
  queued: 'info',
  failed: 'bad',
  excused: 'info',
  appealed: 'warn'
};
export const Badge = ({ status, children }) => <span className={`badge ${TONE[status] || ''}`}>{children || status}</span>;

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export const pct = n => `${Number.isFinite(n) ? n : 0}%`;
export const fmtDate = d => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const fmtTime = d => (d ? new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDateTime = d => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '');

export function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px', boxSizing: 'border-box', overflowY: 'auto' }}>
      <div className="panel" style={{ maxWidth: 480, width: '100%', margin: 'auto', background: '#fff', borderRadius: 16, maxHeight: '90vh', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ user, size = 40, className = '', style = {} }) {
  const [imgError, setImgError] = useState(false);
  const name = user?.full_name || user?.name || user?.username || 'User';
  const avatarUrl = !imgError && (user?.avatar_url || user?.avatar);

  const getInitials = (n) => {
    if (!n) return 'U';
    const cleaned = String(n).replace(/^(mr|mrs|ms|dr|prof)\.?\s+/i, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const colors = ['#1e3a8a', '#065f46', '#991b1b', '#854d0e', '#5b21b6', '#3730a3', '#0f766e', '#c2410c'];
  const charCodeSum = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const bgColor = colors[charCodeSum % colors.length];

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        onError={() => setImgError(true)}
        className={`app-avatar ${className}`}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          display: 'inline-block',
          flexShrink: 0,
          border: '2px solid rgba(255, 255, 255, 0.85)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          ...style
        }}
      />
    );
  }

  return (
    <div
      className={`app-avatar-initials ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: '#ffffff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.max(11, Math.round(size * 0.4)),
        letterSpacing: '0.04em',
        border: '2px solid rgba(255, 255, 255, 0.85)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        userSelect: 'none',
        flexShrink: 0,
        ...style
      }}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
}
