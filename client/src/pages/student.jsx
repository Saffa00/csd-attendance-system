import { useCallback, useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MapPin, CheckCircle2, Clock, RefreshCw, X, Wifi, WifiOff,
  AlertTriangle, AlertCircle, Calendar, BookOpen, User,
  Megaphone, ArrowRight, ShieldCheck, Check, ChevronDown, ChevronUp, Filter,
  ChevronRight, ChevronLeft, Layers, Activity, Search, Lightbulb, XCircle, GraduationCap,
  Zap, Hourglass, QrCode, KeyRound, Camera, FileText
} from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { cachedGet, queueAttendance, listQueue, dismissQueued, syncQueue } from '../offline';
import { getPosition } from '../geo';
import { StudentQrScannerModal } from '../components/QrAttendance';
import { DAYS, STATUS_LABEL, hhmm, PROGRAMME_LABELS } from '../config';
import {
  Badge, Empty, ErrorText, Field, Loading, Panel, Stat, Success,
  fmtDate, fmtDateTime, pct, useAction, useOnline, Modal
} from '../ui';
import Account from './Account';

/** Loads student data network-first and falls back to the IndexedDB copy when offline. */
function useCached(name, path) {
  const { profile } = useAuth();
  const [s, setS] = useState({ data: null, error: '', loading: true, fromCache: false, updatedAt: null });
  const load = useCallback(async () => {
    setS(x => ({ ...x, loading: true, error: '' }));
    try { const r = await cachedGet(profile.id, name, path); setS({ data: r.data, error: '', loading: false, fromCache: r.fromCache, updatedAt: r.updatedAt }); }
    catch (e) { setS(x => ({ ...x, error: e.message, loading: false })); }
  }, [profile.id, name, path]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFocus = () => { load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  return { ...s, reload: load };
}

const CacheNote = ({ fromCache, updatedAt }) => fromCache
  ? <p className="muted small" style={{ margin: '4px 0 12px' }}>Showing saved data{updatedAt ? ` from ${fmtDateTime(updatedAt)}` : ''}. It will refresh when you are online.</p> : null;

const PendingApproval = () => (
  <Panel title="Awaiting approval">
    <p>Your registration is waiting for approval by your class representative (or the HOD). You will get a notification when it is approved. Until then you cannot mark attendance.</p>
  </Panel>
);

/** Shimmering Loading Skeleton for Student Dashboard */
function StudentHomeSkeleton() {
  return (
    <div className="student-dashboard" aria-busy="true" aria-label="Loading student dashboard">
      {/* Greeting card skeleton */}
      <div className="skeleton-card" style={{ minHeight: 124 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div className="skeleton-shimmer" style={{ width: 78, height: 78, borderRadius: 12, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton-shimmer" style={{ width: '45%', height: 26 }} />
            <div className="skeleton-shimmer" style={{ width: '75%', height: 16 }} />
          </div>
        </div>
      </div>

      {/* Hero & Ring 2-Column Split skeleton */}
      <div className="student-hero-ring-split">
        <div className="skeleton-card" style={{ minHeight: 270 }}>
          <div className="skeleton-shimmer" style={{ width: '35%', height: 18 }} />
          <div className="skeleton-shimmer" style={{ width: '70%', height: 24, margin: '8px 0' }} />
          <div className="skeleton-shimmer" style={{ width: '100%', height: 80, borderRadius: 12 }} />
          <div className="skeleton-shimmer" style={{ width: '100%', height: 48, borderRadius: 12, marginTop: 'auto' }} />
        </div>
        <div className="skeleton-card" style={{ minHeight: 270 }}>
          <div className="skeleton-shimmer" style={{ width: '45%', height: 18 }} />
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: 'auto 0' }}>
            <div className="skeleton-shimmer" style={{ width: 108, height: 108, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="skeleton-shimmer" style={{ width: '70%', height: 22 }} />
              <div className="skeleton-shimmer" style={{ width: '100%', height: 48 }} />
            </div>
          </div>
          <div className="skeleton-shimmer" style={{ width: '100%', height: 38, borderRadius: 10 }} />
        </div>
      </div>

      {/* 4 solid stat cards skeleton */}
      <div className="student-stat-grid">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton-shimmer" style={{ height: 118, borderRadius: 16 }} />
        ))}
      </div>

      {/* Timeline skeleton */}
      <div className="skeleton-card" style={{ minHeight: 180 }}>
        <div className="skeleton-shimmer" style={{ width: '25%', height: 20, marginBottom: 12 }} />
        <div className="skeleton-shimmer" style={{ width: '100%', height: 64, borderRadius: 12 }} />
      </div>
    </div>
  );
}

// =================================================================== HOME
export function StudentHome() {
  const { profile } = useAuth();
  const online = useOnline();
  const ov = useCached('overview', '/student/overview');
  const today = useCached('today', '/student/today');
  const courses = useCached('courses', '/student/courses');
  const timetable = useCached('timetable', '/student/timetable');
  const announcements = useCached('announcements', '/announcements');

  const [queue, setQueue] = useState([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  // Mark attendance modal state
  const [markModal, setMarkModal] = useState(null);
  const [markCode, setMarkCode] = useState('');
  const [markBusy, setMarkBusy] = useState(false);
  const [markError, setMarkError] = useState('');
  const [markSuccess, setMarkSuccess] = useState('');

  // Timer tick for real-time countdown updates every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Monitor offline queue from IndexedDB
  const refreshQueue = useCallback(() => {
    if (profile?.id) {
      listQueue(profile.id).then(setQueue).catch(() => {});
    }
  }, [profile?.id]);

  useEffect(() => {
    refreshQueue();
    window.addEventListener('queue-changed', refreshQueue);
    return () => window.removeEventListener('queue-changed', refreshQueue);
  }, [refreshQueue]);

  if (profile.account_status !== 'approved') return <PendingApproval />;
  if (ov.loading && !ov.data) return <StudentHomeSkeleton />;

  // 1. Time-based Greeting
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || 'Student';
  const studentLevel = profile.level || ov.data?.level || 1;
  const programmeName = PROGRAMME_LABELS[profile.programme] || profile.programme || 'Computer Science';
  const semesterName = ov.data?.semester || (profile.semester ? (Number(profile.semester) === 2 ? 'Second Semester' : 'First Semester') : 'First Semester');
  const academicYear = (ov.data?.year || profile.academic_year) ? ` · ${(ov.data?.year || profile.academic_year).replace(/\s*academic\s*year/i, '').trim()}` : '';

  // 2. Next Class Computation
  const todayClasses = today.data?.classes || [];
  const toMinutes = tStr => {
    if (!tStr) return 0;
    const [h, m] = tStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Find class currently open
  const openClass = todayClasses.find(c => c.session_open);
  // Find next class today where ends_at is in the future
  const upcomingToday = todayClasses.find(c => toMinutes(c.ends_at) > nowMinutes);

  // If no remaining classes today, find the next upcoming class in weekly timetable
  const findNextWeeklyClass = () => {
    const list = timetable.data || [];
    if (!list.length) return null;
    const currentDow = now.getDay();
    const sorted = [...list].sort((a, b) => {
      let diffA = (a.day_of_week - currentDow + 7) % 7;
      let diffB = (b.day_of_week - currentDow + 7) % 7;
      if (diffA === 0 && toMinutes(a.ends_at) <= nowMinutes) diffA = 7;
      if (diffB === 0 && toMinutes(b.ends_at) <= nowMinutes) diffB = 7;
      if (diffA !== diffB) return diffA - diffB;
      return toMinutes(a.starts_at) - toMinutes(b.starts_at);
    });
    return sorted[0] ? { ...sorted[0], isNextWeekly: true } : null;
  };

  const heroClass = openClass || upcomingToday || (todayClasses.length ? todayClasses[0] : findNextWeeklyClass());

  // Helper for Hero card countdown & button status
  const getHeroStatus = (c) => {
    if (!c) return { label: 'No classes scheduled', canMark: false, isLive: false, countdown: null };

    const isQueued = queue.some(q => q.timetable_entry_id === c.id);
    if (isQueued) {
      return { label: 'Queued Offline', canMark: false, isLive: false, countdown: 'Waiting to sync' };
    }
    if (c.attendance_status === 'approved') {
      return { label: 'Marked (Approved)', canMark: false, isLive: false, countdown: 'Approved ✓' };
    }
    if (c.attendance_status === 'pending' || c.attendance_status === 'submitted') {
      return { label: 'Marked (Pending)', canMark: false, isLive: false, countdown: 'Awaiting lecturer review' };
    }
    if (c.attendance_status === 'rejected') {
      return { label: 'Attendance Rejected', canMark: false, isLive: false, countdown: 'Check history to appeal' };
    }

    if (c.session_open) {
      return { label: 'Mark Present', canMark: true, isLive: true, countdown: 'Session open now' };
    }

    if (!c.isNextWeekly) {
      const startMin = toMinutes(c.starts_at);
      const endMin = toMinutes(c.ends_at);
      if (nowMinutes < startMin) {
        const diff = startMin - nowMinutes;
        const countdown = diff <= 1 ? 'Starts in 1 min' : diff < 60 ? `Starts in ${diff} min` : `Starts in ${Math.floor(diff / 60)}h ${diff % 60}m`;
        return { label: countdown, canMark: false, isLive: false, countdown };
      }
      if (nowMinutes >= startMin && nowMinutes <= endMin) {
        return { label: 'Waiting for Lecturer', canMark: false, isLive: false, countdown: 'Session not opened yet' };
      }
      return { label: 'Class Ended', canMark: false, isLive: false, countdown: 'Period ended' };
    }

    // Weekly schedule lookup
    const dayDiff = (c.day_of_week - now.getDay() + 7) % 7;
    const dayLabel = dayDiff === 1 ? 'Tomorrow' : DAYS[c.day_of_week];
    const countdown = `${dayLabel} at ${hhmm(c.starts_at)}`;
    return { label: countdown, canMark: false, isLive: false, countdown };
  };

  const heroStatus = getHeroStatus(heroClass);

  // 3. Attendance Ring Calculation
  const att = ov.data?.attendance || { rate: 0, approved: 0, pending: 0, absent: 0, total: 0 };
  const rate = Math.round(att.rate || 0);
  const threshold = ov.data?.threshold || 75;
  const isAboveThreshold = rate >= threshold;
  const isNearThreshold = rate >= threshold - 5 && rate < threshold;
  const isBelowThreshold = rate < threshold - 5;
  const ringColor = isAboveThreshold ? '#16a34a' : isNearThreshold ? '#d97706' : '#dc2626';
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(100, Math.max(0, rate)) / 100);

  // 4. Offline Queue Sync Action
  const handleSyncQueue = async () => {
    if (!online || syncBusy) return;
    setSyncBusy(true);
    setSyncMsg('');
    try {
      const res = await syncQueue(profile.id);
      refreshQueue();
      today.reload();
      ov.reload();
      courses.reload();
      setSyncMsg(res.synced ? `Synced ${res.synced} attendance record(s).` : 'Offline queue up to date.');
      setTimeout(() => setSyncMsg(''), 4000);
    } catch (e) {
      setSyncMsg(e.message || 'Sync failed.');
    } finally {
      setSyncBusy(false);
    }
  };

  // 5. Submit Attendance from Hero / Timeline
  const submitMarkAttendance = async (e) => {
    e.preventDefault();
    if (!markModal) return;
    setMarkError('');
    setMarkSuccess('');
    setMarkBusy(true);

    try {
      const pos = await getPosition();
      const localDate = new Date().toLocaleDateString('en-CA');
      const sessionDate = today.data?.date || localDate;
      const requireCode = today.data?.require_qr_or_code === true;
      const codeVal = markCode.trim();
      if (requireCode && !codeVal) {
        setMarkError('Class code is required by department policy.');
        setMarkBusy(false);
        return;
      }
      const payload = {
        method: codeVal ? 'code' : 'manual',
        timetable_entry_id: markModal.id,
        session_date: sessionDate,
        ...(codeVal ? { class_code: codeVal } : {}),
        ...pos,
        client_timestamp: new Date().toISOString()
      };

      if (!navigator.onLine) {
        await queueAttendance(profile.id, payload);
        setMarkSuccess('Saved offline. It will submit automatically when you reconnect.');
        setTimeout(() => {
          setMarkModal(null);
          setMarkCode('');
          setMarkSuccess('');
          refreshQueue();
          today.reload();
        }, 1500);
        return;
      }

      await apiFetch('/attendance', { method: 'POST', body: { ...payload, submitted_offline: false } });
      setMarkSuccess('Attendance marked successfully! Waiting for lecturer approval.');
      setTimeout(() => {
        setMarkModal(null);
        setMarkCode('');
        setMarkSuccess('');
        today.reload();
        ov.reload();
        courses.reload();
      }, 1500);
    } catch (err) {
      if (err.network) {
        try {
          const pos = await getPosition();
          const localDate = new Date().toLocaleDateString('en-CA');
          const codeVal = markCode.trim();
          const payload = {
            method: codeVal ? 'code' : 'manual',
            timetable_entry_id: markModal.id,
            session_date: today.data?.date || localDate,
            ...(codeVal ? { class_code: codeVal } : {}),
            ...pos,
            client_timestamp: new Date().toISOString()
          };
          await queueAttendance(profile.id, payload);
          setMarkSuccess('Connection lost. Saved offline and will sync automatically.');
          setTimeout(() => {
            setMarkModal(null);
            setMarkCode('');
            setMarkSuccess('');
            refreshQueue();
            today.reload();
          }, 1500);
          return;
        } catch (_) {}
      }
      setMarkError(err.message || 'Failed to submit attendance');
    } finally {
      setMarkBusy(false);
    }
  };

  // Helper for timeline status chip
  const getTimelineChip = (c) => {
    if (queue.some(q => q.timetable_entry_id === c.id)) {
      return <span className="status-chip marked">Marked (Sync Pending)</span>;
    }
    if (c.attendance_status === 'approved') {
      return <span className="status-chip approved">Approved</span>;
    }
    if (c.attendance_status === 'pending' || c.attendance_status === 'submitted') {
      return <span className="status-chip marked">Marked</span>;
    }
    if (c.attendance_status === 'rejected') {
      return <span className="status-chip cancelled">Rejected</span>;
    }
    if (c.session_open) {
      return <span className="status-chip open">Open now</span>;
    }

    const startMin = toMinutes(c.starts_at);
    const endMin = toMinutes(c.ends_at);
    if (nowMinutes < startMin) {
      return <span className="status-chip upcoming">Upcoming</span>;
    }
    if (nowMinutes >= startMin && nowMinutes <= endMin) {
      return <span className="status-chip cancelled">Session closed</span>;
    }
    return <span className="status-chip missed">Missed</span>;
  };

  const latestNotice = (announcements.data || [])[0];

  return (
    <div className="student-dashboard">
      {/* 8. Pending Sync Banner (Shown when offline queue > 0) */}
      {queue.length > 0 && (
        <section className="pending-sync-banner" aria-label="Offline Submissions Pending">
          <div className="pending-sync-info">
            <RefreshCw size={20} className={syncBusy ? 'spin' : ''} />
            <div>
              <strong>{queue.length} Offline Submission{queue.length > 1 ? 's' : ''} Waiting to Sync</strong>
              <p>
                {online
                  ? 'Your internet connection is active. Tap to upload your attendance records.'
                  : 'You are offline. Your records are saved securely and will upload when connected.'}
              </p>
              {syncMsg && <p style={{ fontWeight: 700, color: '#16a34a', marginTop: 3 }}>{syncMsg}</p>}
            </div>
          </div>
          {online && (
            <button
              className="sync-action-btn"
              onClick={handleSyncQueue}
              disabled={syncBusy}
            >
              <RefreshCw size={14} className={syncBusy ? 'spin' : ''} />
              {syncBusy ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
        </section>
      )}

      {/* 1. Greeting Card */}
      <section className="student-greeting-card">
        <div className="greeting-main">
          <div className="greeting-logo-wrap">
            <img
              src="/logo.png"
              alt="Milton Margai Technical University Computer Science Department"
              className="greeting-logo"
            />
          </div>
          <div className="greeting-details">
            <div className="greeting-eyebrow">
              <span className="greeting-dept-tag">MMTU CS DEPARTMENT</span>
              <span className="student-meta-dot">·</span>
              <span className="small muted">Student Portal</span>
            </div>
            <h2 className="student-greeting-title">{greeting}, {profile.full_name || firstName}</h2>
            <div className="student-meta-line">
              <span className="student-meta-item"><strong>{programmeName}</strong></span>
              <span className="student-meta-dot">·</span>
              <span className="student-meta-item">Level {studentLevel}</span>
              <span className="student-meta-dot">·</span>
              <span className="student-meta-item">{semesterName}{academicYear}</span>
              {profile.student_id && (
                <>
                  <span className="student-meta-dot">·</span>
                  <span className="student-meta-item">ID: {profile.student_id}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="greeting-badge-wrap">
          <div
            className={`network-pill ${online ? 'online' : 'offline'}`}
            title={online ? 'Connected to internet' : 'Working offline'}
          >
            <span className="status-indicator-dot" />
            {online ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>{online ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </section>

      <ErrorText>{ov.error}</ErrorText>
      <CacheNote {...ov} />

      {/* 2 & 3. Hero Card ("Next class") & Attendance Ring Split Section */}
      <section className="student-hero-ring-split">
        {/* 2. "Next class" hero card */}
        <div className={`next-class-hero ${heroStatus.isLive ? 'is-open' : ''}`}>
          <div>
            <div className="hero-header-row">
              <span className="hero-eyebrow">
                <Calendar size={13} />
                {heroStatus.isLive ? 'Active Session' : 'Next Class'}
              </span>
              {heroStatus.isLive && (
                <span className="hero-live-chip">
                  <span className="live-dot" /> Open Now
                </span>
              )}
            </div>

            {heroClass ? (
              <>
                <div className="hero-course-code">{heroClass.courses?.code || heroClass.code || 'COMS'}</div>
                <h3 className="hero-course-title">{heroClass.courses?.title || heroClass.title || 'Department Module'}</h3>

                <div className="hero-meta-grid">
                  <div className="hero-meta-row">
                    <User size={15} className="hero-meta-icon" />
                    <span className="hero-meta-text">
                      Lecturer: <strong>{heroClass.lecturer_name || heroClass.profiles?.full_name || 'Department Lecturer'}</strong>
                    </span>
                  </div>
                  <div className="hero-meta-row">
                    <MapPin size={15} className="hero-meta-icon" />
                    <span className="hero-meta-text">
                      Venue: <strong>{heroClass.venues?.name || heroClass.venue_name || 'Venue TBA'}</strong>
                    </span>
                  </div>
                  <div className="hero-meta-row">
                    <Clock size={15} className="hero-meta-icon" />
                    <span className="hero-meta-text">
                      Time: <strong>{hhmm(heroClass.starts_at)} – {hhmm(heroClass.ends_at)}</strong>
                      {heroClass.isNextWeekly && ` (${DAYS[heroClass.day_of_week]})`}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748b' }}>
                <Calendar size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <p style={{ margin: 0, fontWeight: 600 }}>No upcoming classes found.</p>
                <p className="small muted" style={{ margin: '4px 0 0' }}>Your timetable for this semester is up to date.</p>
              </div>
            )}
          </div>

          <div className="hero-action-box">
            {heroStatus.canMark ? (
              <button
                className="hero-mark-btn active"
                onClick={() => {
                  setMarkModal(heroClass);
                  setMarkCode('');
                  setMarkError('');
                  setMarkSuccess('');
                }}
              >
                <CheckCircle2 size={18} /> Mark Present
              </button>
            ) : (
              <button
                className={`hero-mark-btn ${heroClass?.attendance_status ? 'marked' : 'disabled'}`}
                disabled
              >
                {heroClass?.attendance_status === 'approved' ? (
                  <><CheckCircle2 size={18} /> Attendance Approved</>
                ) : heroClass?.attendance_status ? (
                  <><Clock size={18} /> Marked ({STATUS_LABEL[heroClass.attendance_status] || 'Submitted'})</>
                ) : (
                  <><Clock size={18} /> {heroStatus.label}</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* 3. Attendance ring card */}
        <div className="attendance-ring-card">
          <div className="ring-card-header">
            <h3 className="ring-card-title">Attendance Overview</h3>
            <span className="ring-threshold-chip">Min. {threshold}%</span>
          </div>

          <div className="ring-center-display">
            <div className="ring-svg-wrapper">
              <svg className="ring-svg" viewBox="0 0 120 120">
                <circle className="ring-bg" cx="60" cy="60" r={radius} strokeWidth="10" />
                <circle
                  className="ring-progress"
                  cx="60"
                  cy="60"
                  r={radius}
                  strokeWidth="10"
                  stroke={ringColor}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              <div className="ring-text-overlay">
                <span className="ring-val-big" style={{ color: ringColor }}>{pct(rate)}</span>
                <span className="ring-val-sub">Overall</span>
              </div>
            </div>

            <div className="ring-stats-breakdown">
              <div className="ring-breakdown-box">
                <span className="ring-breakdown-val" style={{ color: '#16a34a' }}>{att.approved}</span>
                <span className="ring-breakdown-lbl">Approved</span>
              </div>
              <div className="ring-breakdown-box">
                <span className="ring-breakdown-val" style={{ color: '#d97706' }}>{att.pending}</span>
                <span className="ring-breakdown-lbl">Pending</span>
              </div>
              <div className="ring-breakdown-box">
                <span className="ring-breakdown-val" style={{ color: '#dc2626' }}>{att.absent}</span>
                <span className="ring-breakdown-lbl">Absent</span>
              </div>
              <div className="ring-breakdown-box">
                <span className="ring-breakdown-val" style={{ color: '#2563eb' }}>{att.total}</span>
                <span className="ring-breakdown-lbl">Total</span>
              </div>
            </div>
          </div>

          {/* Risk warning message */}
          {isBelowThreshold ? (
            <div className="ring-risk-alert danger" role="alert">
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>At Risk:</strong> Your attendance ({pct(rate)}) is below the required {threshold}% threshold. You risk semester examination debarment.
              </div>
            </div>
          ) : isNearThreshold ? (
            <div className="ring-risk-alert warning">
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Caution:</strong> You are within 5% of the {threshold}% minimum threshold. Attend upcoming sessions to stay in good standing.
              </div>
            </div>
          ) : (
            <div className="ring-risk-alert good">
              <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>In Good Standing:</strong> Your attendance satisfies the {threshold}% department requirement for final examinations.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 4. Stat cards for Modules, Approved, Pending, Absent (Solid colours, White text, 2-col on mobile) */}
      <section className="student-stat-grid" aria-label="Quick Attendance Stats">
        {/* Modules: Solid Blue */}
        <Link to="/profile" className="solid-stat-card blue">
          <div className="solid-stat-top">
            <div className="solid-stat-icon-wrap">
              <BookOpen size={18} color="#ffffff" />
            </div>
            <ArrowRight size={16} color="#ffffff" className="solid-stat-link-arrow" />
          </div>
          <div className="solid-stat-bottom">
            <span className="solid-stat-number">{ov.data?.courses ?? 0}</span>
            <span className="solid-stat-label">Modules</span>
          </div>
        </Link>

        {/* Approved: Solid Green */}
        <Link to="/history" className="solid-stat-card green">
          <div className="solid-stat-top">
            <div className="solid-stat-icon-wrap">
              <CheckCircle2 size={18} color="#ffffff" />
            </div>
            <ArrowRight size={16} color="#ffffff" className="solid-stat-link-arrow" />
          </div>
          <div className="solid-stat-bottom">
            <span className="solid-stat-number">{att.approved}</span>
            <span className="solid-stat-label">Approved</span>
          </div>
        </Link>

        {/* Pending: Solid Amber */}
        <Link to="/history" className="solid-stat-card amber">
          <div className="solid-stat-top">
            <div className="solid-stat-icon-wrap">
              <Clock size={18} color="#ffffff" />
            </div>
            <ArrowRight size={16} color="#ffffff" className="solid-stat-link-arrow" />
          </div>
          <div className="solid-stat-bottom">
            <span className="solid-stat-number">{att.pending}</span>
            <span className="solid-stat-label">Pending</span>
          </div>
        </Link>

        {/* Absent: Solid Red */}
        <Link to="/history" className="solid-stat-card red">
          <div className="solid-stat-top">
            <div className="solid-stat-icon-wrap">
              <X size={18} color="#ffffff" />
            </div>
            <ArrowRight size={16} color="#ffffff" className="solid-stat-link-arrow" />
          </div>
          <div className="solid-stat-bottom">
            <span className="solid-stat-number">{att.absent}</span>
            <span className="solid-stat-label">Absent</span>
          </div>
        </Link>
      </section>

      {/* 5. "Today's classes" timeline */}
      <section className="timeline-card">
        <div className="timeline-card-header">
          <h3>Today's Classes</h3>
          <Link to="/timetable" className="link-button" style={{ fontSize: 13 }}>
            Full Timetable →
          </Link>
        </div>

        {todayClasses.length ? (
          <div className="timeline-list">
            {todayClasses.map(c => {
              const chip = getTimelineChip(c);
              const isOpen = c.session_open;
              const hasMarked = Boolean(c.attendance_status) || queue.some(q => q.timetable_entry_id === c.id);

              return (
                <div key={c.id} className={`timeline-item ${isOpen ? 'open' : c.attendance_status || ''}`}>
                  <div className="timeline-dot" />
                  <div className="timeline-item-body">
                    <div className="timeline-item-main">
                      <div className="timeline-time-bar">
                        <Clock size={13} />
                        <span>{hhmm(c.starts_at)} – {hhmm(c.ends_at)}</span>
                      </div>
                      <div className="timeline-title-row">
                        <strong>{c.courses?.code || c.code}</strong>: {c.courses?.title || c.title}
                      </div>
                      <div className="timeline-sub-row">
                        <span><MapPin size={12} style={{ verticalAlign: -1 }} /> {c.venues?.name || c.venue_name || 'Venue TBA'}</span>
                        <span>·</span>
                        <span><User size={12} style={{ verticalAlign: -1 }} /> {c.lecturer_name || c.profiles?.full_name || 'Lecturer'}</span>
                      </div>
                    </div>

                    <div className="timeline-actions-wrap">
                      {chip}
                      {isOpen && !hasMarked && (
                        <button
                          className="primary compact"
                          style={{ padding: '6px 12px', fontSize: 12 }}
                          onClick={() => {
                            setMarkModal(c);
                            setMarkCode('');
                            setMarkError('');
                            setMarkSuccess('');
                          }}
                        >
                          Mark
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="friendly-empty-state">
            <div className="friendly-empty-icon">
              <Calendar size={24} />
            </div>
            <h4>No Classes Scheduled Today</h4>
            <p>
              {heroClass && heroClass.isNextWeekly
                ? `Your next scheduled lecture is ${heroClass.courses?.code} on ${DAYS[heroClass.day_of_week]} at ${hhmm(heroClass.starts_at)}.`
                : 'All classes for today are complete. Take this time to review course materials or work on department assignments.'}
            </p>
            <Link to="/timetable" className="link-button" style={{ marginTop: 8 }}>
              Open Weekly Timetable
            </Link>
          </div>
        )}
      </section>

      {/* 6. "My modules" list with attendance progress bars */}
      <section className="modules-card">
        <div className="modules-card-header">
          <h3>My Modules</h3>
          <Link to="/history" className="link-button" style={{ fontSize: 13 }}>
            Attendance History →
          </Link>
        </div>

        {courses.data?.length ? (
          <div className="modules-grid">
            {courses.data.map(c => {
              const mRate = Math.round(c.attendance?.rate || 0);
              const mColor = mRate >= threshold ? '#16a34a' : mRate >= threshold - 5 ? '#d97706' : '#dc2626';

              return (
                <div key={c.id} className="module-item-card">
                  <div className="module-top-row">
                    <div>
                      <span className="module-code-badge">{c.code}</span>
                      <span className="module-title-text">{c.title}</span>
                    </div>
                    <span className="module-rate-pill" style={{ color: mColor }}>
                      {pct(mRate)}
                    </span>
                  </div>

                  <div className="module-progress-track">
                    <div
                      className="module-progress-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, mRate))}%`,
                        backgroundColor: mColor
                      }}
                    />
                  </div>

                  <div className="module-bottom-info">
                    <span>{c.credit_units ? `${c.credit_units} Credit Units` : 'Department Module'}</span>
                    <span>
                      {c.attendance?.approved || 0} Attended · {c.attendance?.absent || 0} Absent · {c.attendance?.total || 0} Lectures
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="friendly-empty-state">
            <div className="friendly-empty-icon">
              <BookOpen size={24} />
            </div>
            <h4>No Modules Added</h4>
            <p>
              No modules for {profile.programme || 'Computer Science'}, Level {profile.level} yet. Your HOD will add them.
            </p>
          </div>
        )}
      </section>

      {/* 7. Latest-Announcement Preview with "View all" link */}
      <section className="announcement-preview-card">
        <div className="announcement-header">
          <h3>
            <Megaphone size={18} color="var(--primary)" />
            Department Notice
          </h3>
          <Link to="/announcements" className="view-all-link">
            View all notices <ArrowRight size={14} />
          </Link>
        </div>

        {latestNotice ? (
          <div className="announcement-body">
            <div className="announcement-title-row">
              <span className="announcement-item-title">{latestNotice.title}</span>
              <span className="announcement-date">{fmtDate(latestNotice.created_at)}</span>
            </div>
            <p className="announcement-excerpt">
              {latestNotice.message?.length > 180
                ? `${latestNotice.message.slice(0, 180)}…`
                : latestNotice.message}
            </p>
          </div>
        ) : (
          <div className="friendly-empty-state" style={{ padding: '20px 14px' }}>
            <p className="small muted" style={{ margin: 0 }}>No announcements posted yet. Official department notices will appear here.</p>
          </div>
        )}
      </section>

      {/* Modal for Marking Attendance */}
      {markModal && (
        <Modal
          title={`Mark Attendance — ${markModal.courses?.code}`}
          onClose={() => {
            if (!markBusy) {
              setMarkModal(null);
              setMarkError('');
              setMarkSuccess('');
            }
          }}
        >
          <div style={{ padding: '4px 0 14px' }}>
            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#1e293b' }}>
              {markModal.courses?.title}
            </p>
            <p className="muted small" style={{ margin: '0 0 14px' }}>
              Venue: {markModal.venues?.name || 'TBA'} · Lecturer: {markModal.lecturer_name || 'Lecturer'}
            </p>

            <form onSubmit={submitMarkAttendance}>
              {today.data?.require_qr_or_code ? (
                <Field
                  label="Lecturer Class Code"
                  hint="Enter the 6-digit session code displayed on the board by your lecturer."
                >
                  <input
                    type="text"
                    value={markCode}
                    onChange={e => setMarkCode(e.target.value)}
                    placeholder="e.g. 482910"
                    inputMode="numeric"
                    autoFocus
                    required
                    minLength={4}
                    maxLength={10}
                    style={{
                      fontSize: 22,
                      letterSpacing: 4,
                      textAlign: 'center',
                      fontWeight: 700,
                      padding: '12px',
                      borderRadius: 10
                    }}
                  />
                </Field>
              ) : (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  <p style={{ margin: 0, fontSize: 13, color: '#166534', fontWeight: 600 }}>
                    Class is currently in session!
                  </p>
                  <p className="small muted" style={{ margin: '4px 0 0', color: '#15803d' }}>
                    Tap "Confirm Present" below to record your attendance. Your device GPS will confirm your location at the lecture venue. (Class code optional).
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 0 14px', fontSize: 12, color: '#64748b' }}>
                <MapPin size={14} color="var(--primary)" />
                <span>GPS coordinates will be captured to verify presence in the venue.</span>
              </div>

              {!online && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>
                  Offline mode: Your attendance will be saved locally on this device and synced automatically when you reconnect.
                </div>
              )}

              <ErrorText>{markError}</ErrorText>
              <Success>{markSuccess}</Success>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setMarkModal(null)}
                  disabled={markBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={markBusy || (today.data?.require_qr_or_code && !markCode.trim())}
                >
                  {markBusy ? (
                    <><RefreshCw size={14} className="spin" /> Submitting…</>
                  ) : (
                    'Confirm Present'
                  )}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}


// =================================================================== TIMETABLE
// =================================================================== TIMETABLE
export function StudentTimetable() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const t = useCached('timetable', '/student/timetable');
  const todayApi = useCached('today', '/student/today');

  const [dayOffset, setDayOffset] = useState(0);
  const [viewMode, setViewMode] = useState('today'); // 'today' or 'full'

  if (profile.account_status !== 'approved') return <PendingApproval />;
  if (t.loading && !t.data) return <Loading />;

  const now = new Date();
  const targetDate = new Date();
  targetDate.setDate(now.getDate() + dayOffset);

  const targetDayIdx = targetDate.getDay();
  const isTargetToday = dayOffset === 0;

  const toMinutes = tStr => {
    if (!tStr) return 0;
    const [h, m] = tStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Format date: e.g. "Tue, 21 Oct 2026"
  const formattedDate = targetDate.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const dayLabel = isTargetToday ? 'Today' : DAYS[targetDayIdx];

  // Classes for the selected day
  const dayClasses = (t.data || [])
    .filter(x => x.day_of_week === targetDayIdx)
    .sort((a, b) => toMinutes(a.starts_at) - toMinutes(b.starts_at));

  // Today sessions status lookup
  const todaySessions = isTargetToday ? (todayApi.data?.classes || []) : [];

  // Completed vs Upcoming vs Missed
  const completedCount = isTargetToday
    ? dayClasses.filter(c => toMinutes(c.ends_at) <= nowMinutes).length
    : dayOffset < 0 ? dayClasses.length : 0;

  const upcomingCount = isTargetToday
    ? dayClasses.filter(c => toMinutes(c.ends_at) > nowMinutes).length
    : dayOffset > 0 ? dayClasses.length : 0;

  const missedCount = isTargetToday
    ? dayClasses.filter(c => {
        const ended = toMinutes(c.ends_at) <= nowMinutes;
        const attended = todaySessions.find(s => s.id === c.id)?.attendance_status;
        return ended && !attended;
      }).length
    : 0;

  // Next class today
  const nextClass = isTargetToday
    ? (dayClasses.find(c => toMinutes(c.ends_at) > nowMinutes) || dayClasses[0])
    : dayClasses[0];

  const timePillThemes = [
    { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
    { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' },
    { bg: '#fffbeb', text: '#b45309', border: '#fde68a' }
  ];

  return (
    <div className="student-timetable-container" style={{ maxWidth: 1140, margin: '0 auto', paddingBottom: 60 }}>

      <ErrorText>{t.error}</ErrorText>
      <CacheNote {...t} />

      {/* Header with Title and Date Switcher */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 20
      }}>
        {/* Left Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
          }}>
            <Calendar size={24} color="#ffffff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 750, color: '#0f172a', letterSpacing: '-0.02em' }}>
              Today's Timetable
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748b' }}>
              Your class schedule for today. Stay on track and never miss a session.
            </p>
          </div>
        </div>

        {/* Right Date Navigator Card */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '8px 14px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#eff6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#2563eb'
            }}>
              <Calendar size={18} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                {dayLabel}
              </div>
              <strong style={{ fontSize: 13, color: '#0f172a' }}>{formattedDate}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
            <button
              type="button"
              onClick={() => setDayOffset(o => o - 1)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569'
              }}
              title="Previous Day"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setDayOffset(o => o + 1)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569'
              }}
              title="Next Day"
            >
              <ChevronRight size={16} />
            </button>
            {!isTargetToday && (
              <button
                type="button"
                onClick={() => setDayOffset(0)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #bae6fd',
                  background: '#f0f9ff',
                  color: '#0284c7',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: 4
                }}
              >
                Today
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 16,
        marginBottom: 24
      }}>
        {/* Card 1: Total Classes Today */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '18px 20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#eff6ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#2563eb',
            flexShrink: 0
          }}>
            <BookOpen size={24} />
          </div>
          <div>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b' }}>
              Total Classes Today
            </span>
            <strong style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
              {dayClasses.length}
            </strong>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              out of {dayClasses.length} scheduled
            </span>
          </div>
        </div>

        {/* Card 2: Completed */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '18px 20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#f0fdf4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#16a34a',
            flexShrink: 0
          }}>
            <Clock size={24} />
          </div>
          <div>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b' }}>
              Completed
            </span>
            <strong style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
              {completedCount}
            </strong>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              classes so far
            </span>
          </div>
        </div>

        {/* Card 3: Upcoming */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '18px 20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#faf5ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9333ea',
            flexShrink: 0
          }}>
            <Hourglass size={24} />
          </div>
          <div>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b' }}>
              Upcoming
            </span>
            <strong style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
              {upcomingCount}
            </strong>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              classes remaining
            </span>
          </div>
        </div>

        {/* Card 4: Next Class */}
        <div style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          padding: '18px 20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 16
        }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: '#fff7ed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ea580c',
            flexShrink: 0
          }}>
            <Calendar size={24} />
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden' }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b' }}>
              Next Class
            </span>
            <strong style={{ display: 'block', fontSize: 18, fontWeight: 800, color: '#0f172a', lineHeight: 1.2, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {nextClass ? (nextClass.courses?.code || nextClass.code || 'COMS') : 'None'}
            </strong>
            <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              {nextClass ? `${hhmm(nextClass.starts_at)} – ${hhmm(nextClass.ends_at)}` : 'Schedule clear'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content: 2-Column Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 24,
        alignItems: 'start'
      }}>
        {/* Left Column (Wide Timeline) */}
        <div style={{ flex: '1 1 60%' }}>
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '24px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
              paddingBottom: 14,
              borderBottom: '1px solid #f1f5f9'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#eff6ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2563eb'
                }}>
                  <Calendar size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                    {viewMode === 'full' ? 'Complete Weekly Timetable' : `${dayLabel}'s Schedule`}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                    {viewMode === 'full'
                      ? 'All weekly classes for this semester'
                      : `Here are your classes for ${dayLabel.toLowerCase()}, ${formattedDate}.`}
                  </p>
                </div>
              </div>

              {viewMode === 'full' && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setViewMode('today')}
                  style={{ fontSize: 12, fontWeight: 600 }}
                >
                  Back to Daily View
                </button>
              )}
            </div>

            {/* If Full Timetable Mode */}
            {viewMode === 'full' ? (
              <div>
                {DAYS.map((d, i) => {
                  const items = (t.data || []).filter(x => x.day_of_week === i);
                  if (!items.length) return null;
                  return (
                    <div key={d} style={{ marginBottom: 16 }}>
                      <h4 style={{ margin: '10px 0 6px', fontSize: 13, fontWeight: 700, color: '#2563eb' }}>
                        {d} ({items.length} classes)
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {items.map(x => (
                          <div
                            key={x.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              background: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: 10
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: 13, color: '#0f172a' }}>{x.courses?.code}</strong>
                              <span style={{ fontSize: 13, color: '#475569', marginLeft: 6 }}>{x.courses?.title}</span>
                              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                {x.venues?.name || 'Venue TBA'} · Lecturer: {x.lecturer_name || 'Department Lecturer'}
                              </div>
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '4px 8px', borderRadius: 6 }}>
                              {hhmm(x.starts_at)} – {hhmm(x.ends_at)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Daily Timeline View */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {!dayClasses.length ? (
                  <div style={{
                    padding: '36px 20px',
                    textAlign: 'center',
                    background: '#f8fafc',
                    borderRadius: 12,
                    border: '1px dashed #cbd5e1'
                  }}>
                    <Calendar size={36} color="#94a3b8" style={{ margin: '0 auto 10px' }} />
                    <strong style={{ display: 'block', fontSize: 14, color: '#334155' }}>
                      No classes scheduled for {dayLabel}.
                    </strong>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                      Take time to review your course materials or check another day.
                    </p>
                  </div>
                ) : (
                  dayClasses.map((c, index) => {
                    const theme = timePillThemes[index % timePillThemes.length];
                    const startMin = toMinutes(c.starts_at);
                    const endMin = toMinutes(c.ends_at);
                    let classStatus = 'Upcoming';
                    let statusBg = '#eff6ff';
                    let statusColor = '#2563eb';

                    if (isTargetToday) {
                      if (nowMinutes >= startMin && nowMinutes <= endMin) {
                        classStatus = c.session_open ? 'Open Now' : 'Ongoing';
                        statusBg = c.session_open ? '#dcfce7' : '#fef3c7';
                        statusColor = c.session_open ? '#15803d' : '#b45309';
                      } else if (nowMinutes > endMin) {
                        classStatus = 'Completed';
                        statusBg = '#f1f5f9';
                        statusColor = '#475569';
                      }
                    } else if (dayOffset < 0) {
                      classStatus = 'Completed';
                      statusBg = '#f1f5f9';
                      statusColor = '#475569';
                    }

                    return (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          padding: '16px 18px',
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 14,
                          boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {/* Time Pill Box */}
                        <div style={{
                          minWidth: 120,
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: theme.bg,
                          border: `1px solid ${theme.border}`,
                          textAlign: 'center',
                          flexShrink: 0
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 750, color: theme.text }}>
                            {hhmm(c.starts_at)} – {hhmm(c.ends_at)}
                          </div>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            color: theme.text,
                            marginTop: 3
                          }}>
                            <Clock size={11} />
                            <span>{classStatus}</span>
                          </div>
                        </div>

                        {/* Middle Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{
                              background: '#2563eb',
                              color: '#ffffff',
                              fontSize: 11,
                              fontWeight: 750,
                              padding: '2px 8px',
                              borderRadius: 6
                            }}>
                              {c.courses?.code || c.code || 'COMS'}
                            </span>
                          </div>

                          <h4 style={{
                            margin: 0,
                            fontSize: 14,
                            fontWeight: 700,
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {c.courses?.title || c.title || 'Department Module'}
                          </h4>

                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '12px 16px',
                            marginTop: 6,
                            fontSize: 12,
                            color: '#64748b'
                          }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <MapPin size={13} color="#94a3b8" />
                              {c.venues?.name || 'Venue TBA'}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <User size={13} color="#94a3b8" />
                              {c.lecturer_name || c.profiles?.full_name || 'Prof. J. Ahmed'}
                            </span>
                          </div>
                        </div>

                        {/* Right Status Pill & Circular Action Button */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <span style={{
                            background: statusBg,
                            color: statusColor,
                            fontSize: 11,
                            fontWeight: 650,
                            padding: '4px 10px',
                            borderRadius: 20
                          }}>
                            {classStatus}
                          </span>

                          <button
                            type="button"
                            onClick={() => navigate('/attendance')}
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              background: '#2563eb',
                              border: 'none',
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                              transition: 'transform 0.15s ease'
                            }}
                            title="Go to Mark Attendance"
                          >
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Quick Actions Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
          }}>
            <h4 style={{
              margin: '0 0 14px',
              fontSize: 14,
              fontWeight: 750,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <Zap size={16} color="#2563eb" />
              Quick Actions
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Action 1: View Full Timetable */}
              <button
                type="button"
                onClick={() => setViewMode(v => v === 'today' ? 'full' : 'today')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #f1f5f9',
                  background: '#f8fafc',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563eb' }}>
                    <Calendar size={16} />
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: '#1e293b' }}>View Full Timetable</strong>
                    <span style={{ fontSize: 11, color: '#64748b' }}>See your complete schedule</span>
                  </div>
                </div>
                <ChevronRight size={16} color="#94a3b8" />
              </button>

              {/* Action 2: Mark Attendance */}
              <Link
                to="/attendance"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #f1f5f9',
                  background: '#f8fafc',
                  textDecoration: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                    <CheckCircle2 size={16} />
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: '#1e293b' }}>Mark Attendance</strong>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Scan or enter your attendance</span>
                  </div>
                </div>
                <ChevronRight size={16} color="#94a3b8" />
              </Link>

              {/* Action 3: Registered Modules */}
              <Link
                to="/modules"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #f1f5f9',
                  background: '#f8fafc',
                  textDecoration: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#faf5ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9333ea' }}>
                    <FileText size={16} />
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: '#1e293b' }}>Registered Modules</strong>
                    <span style={{ fontSize: 11, color: '#64748b' }}>View your enrolled courses</span>
                  </div>
                </div>
                <ChevronRight size={16} color="#94a3b8" />
              </Link>

              {/* Action 4: Attendance History */}
              <Link
                to="/history"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #f1f5f9',
                  background: '#f8fafc',
                  textDecoration: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff1f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e11d48' }}>
                    <Clock size={16} />
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: '#1e293b' }}>Attendance History</strong>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Past attendance records</span>
                  </div>
                </div>
                <ChevronRight size={16} color="#94a3b8" />
              </Link>
            </div>
          </div>

          {/* Motivational Quote Box */}
          <div style={{
            background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
            border: '1px solid #bae6fd',
            borderRadius: 16,
            padding: '20px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0284c7',
                flexShrink: 0,
                boxShadow: '0 2px 6px rgba(2, 132, 199, 0.12)'
              }}>
                <Calendar size={18} />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0369a1', fontStyle: 'italic' }}>
                  "Good attendance builds great results."
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#0284c7' }}>
                  Stay consistent, stay ahead!
                </p>
              </div>
            </div>
          </div>

          {/* Class Status Legend Box */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '18px 20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
          }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
              Class Status
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a' }} />
                  Completed
                </span>
                <strong style={{ color: '#0f172a' }}>{completedCount}</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }} />
                  Upcoming
                </span>
                <strong style={{ color: '#0f172a' }}>{upcomingCount}</strong>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                  Missed
                </span>
                <strong style={{ color: '#0f172a' }}>{missedCount}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =================================================================== MARK ATTENDANCE (online + offline)
export function StudentAttendance() {
  const { profile } = useAuth();
  const online = useOnline();
  const today = useCached('today', '/student/today');
  const timetable = useCached('timetable', '/student/timetable');
  const [queue, setQueue] = useState([]);
  const [open, setOpen] = useState(null);       // class being marked via code
  const [qrScanClass, setQrScanClass] = useState(null); // class being marked via QR
  const [code, setCode] = useState('');
  const { busy, error, ok, run, setOk, setError } = useAction();

  const refreshQueue = useCallback(() => listQueue(profile.id).then(setQueue), [profile.id]);
  useEffect(() => {
    refreshQueue();
    window.addEventListener('queue-changed', refreshQueue);
    return () => window.removeEventListener('queue-changed', refreshQueue);
  }, [refreshQueue]);

  if (profile.account_status !== 'approved') return <PendingApproval />;
  if (today.loading && !today.data && timetable.loading) return <Loading />;

  // Online we trust the server's date; offline we derive today's classes from the cached timetable.
  const localDate = new Date().toLocaleDateString('en-CA');
  const serverToday = today.data && !today.fromCache ? today.data : null;
  const date = serverToday?.date || localDate;
  const classes = serverToday?.classes
    || (timetable.data || []).filter(t => t.day_of_week === new Date().getDay()).map(t => ({ ...t, session_open: null, attendance_status: null }));

  const queuedFor = c => queue.find(q => q.timetable_entry_id === c.id && q.session_date === date);

  const markManual = async c => {
    setOk('');
    setError('');
    await run(`mark-${c.id}`, async () => {
      const pos = await getPosition();
      const payload = {
        method: 'manual',
        timetable_entry_id: c.id,
        session_date: date,
        ...pos,
        client_timestamp: new Date().toISOString()
      };
      const finish = msg => { setOk(msg); today.reload(); };
      if (!navigator.onLine) {
        await queueAttendance(profile.id, payload);
        return finish('Saved on this phone, Pending sync. It will submit automatically when back online.');
      }
      try {
        await apiFetch('/attendance', { method: 'POST', body: { ...payload, submitted_offline: false } });
        finish('Attendance marked successfully! Waiting for lecturer approval.');
      } catch (err) {
        if (!err.network) throw err;
        await queueAttendance(profile.id, payload);
        finish('Saved on this phone, Pending sync. It will submit automatically when back online.');
      }
    });
  };

  const mark = async e => {
    e.preventDefault();
    setOk('');
    await run('mark', async () => {
      const pos = await getPosition();
      const payload = {
        method: 'code',
        timetable_entry_id: open.id, session_date: date, class_code: code.trim(),
        ...pos, client_timestamp: new Date().toISOString()
      };
      const finish = msg => { setOk(msg); setOpen(null); setCode(''); today.reload(); };
      if (!navigator.onLine) {
        await queueAttendance(profile.id, payload);
        return finish('Saved on this phone, Pending sync. It will submit automatically when back online.');
      }
      try {
        await apiFetch('/attendance', { method: 'POST', body: { ...payload, submitted_offline: false } });
        finish('Attendance submitted. Waiting for your lecturer to approve it.');
      } catch (err) {
        if (!err.network) throw err;
        await queueAttendance(profile.id, payload);
        finish('Saved on this phone, Pending sync. It will submit automatically when back online.');
      }
    });
  };

  const retry = async () => { await run('sync', async () => { const r = await syncQueue(profile.id); setOk(r.synced ? `${r.synced} submission(s) synced.` : 'Nothing was synced yet.'); today.reload(); }); };

  const requireQrOrCode = today.data?.require_qr_or_code === true;

  return (
    <>
      <p className="muted">
        {DAYS[new Date(`${date}T12:00:00`).getDay()]}, {fmtDate(date)}.
        {requireQrOrCode
          ? ' Scan the live QR code displayed by your lecturer, or enter the class code to mark Present.'
          : ' Tap "Mark Present" while in your lecture hall. Your GPS location will verify your attendance.'}
      </p>
      <ErrorText>{today.error && !today.data ? today.error : ''}</ErrorText>
      <CacheNote {...today} />
      <Success>{ok}</Success>

      {/* QR Scanner Modal */}
      {qrScanClass && (
        <StudentQrScannerModal
          openClass={qrScanClass}
          profile={profile}
          onClose={() => setQrScanClass(null)}
          onSwitchToCode={() => {
            setOpen(qrScanClass);
            setQrScanClass(null);
          }}
          onSuccess={msg => {
            setOk(msg);
            setQrScanClass(null);
            today.reload();
          }}
        />
      )}

      {!classes.length && <Empty>No classes scheduled for today.</Empty>}
      {classes.map(c => {
        const q = queuedFor(c);
        const status = c.attendance_status;
        return (
          <Panel key={c.id} className={open?.id === c.id ? 'selected' : ''}>
            <div className="row">
              <div>
                <strong>{c.courses.code}</strong> <span className="muted">{c.courses.title}</span>
                <p className="muted small">
                  {hhmm(c.starts_at)}–{hhmm(c.ends_at)} · {c.venues?.name || 'Venue TBA'}
                  {c.lecturer_name && ` · Lecturer: ${c.lecturer_name}`}
                </p>
              </div>
              {q?.status === 'queued' ? <Badge status="queued">Pending sync</Badge>
                : q?.status === 'failed' ? <Badge status="failed">Not accepted</Badge>
                : status ? <Badge status={status}>{STATUS_LABEL[status]}</Badge>
                : c.session_open ? <Badge status="approved">Session open</Badge>
                : <Badge>Session closed</Badge>}
            </div>
            {c.review_note && <p className="muted small">Lecturer note: {c.review_note}</p>}
            {(!status || status === 'correction_requested') && !(q?.status === 'queued') && open?.id !== c.id && (
              c.session_open || !online ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {requireQrOrCode ? (
                    <>
                      <button
                        className="primary"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '12px 18px',
                          fontSize: 15,
                          fontWeight: 700,
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)',
                          boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)'
                        }}
                        onClick={() => {
                          setQrScanClass(c);
                          setOpen(null);
                          setError('');
                          setOk('');
                        }}
                      >
                        <QrCode size={19} /> Scan QR Code
                      </button>

                      <div style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="link-button"
                          style={{
                            fontSize: 13,
                            color: '#2563eb',
                            fontWeight: 600,
                            textDecoration: 'underline',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 8px'
                          }}
                          onClick={() => {
                            setOpen(c);
                            setQrScanClass(null);
                            setError('');
                            setOk('');
                          }}
                        >
                          Enter code instead
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        className="primary"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '12px 18px',
                          fontSize: 15,
                          fontWeight: 750,
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                          boxShadow: '0 4px 14px rgba(22, 163, 74, 0.35)'
                        }}
                        disabled={busy === `mark-${c.id}`}
                        onClick={() => markManual(c)}
                      >
                        <CheckCircle2 size={19} />
                        {busy === `mark-${c.id}` ? 'Submitting GPS…' : 'Mark Present (GPS)'}
                      </button>

                      <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                        <button
                          type="button"
                          className="link-button"
                          style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
                          onClick={() => {
                            setQrScanClass(c);
                            setOpen(null);
                            setError('');
                            setOk('');
                          }}
                        >
                          <QrCode size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                          Scan QR Code
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          style={{ fontSize: 13, color: '#2563eb', fontWeight: 600, textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
                          onClick={() => {
                            setOpen(c);
                            setQrScanClass(null);
                            setError('');
                            setOk('');
                          }}
                        >
                          Enter code instead
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button className="secondary" disabled title="Waiting for lecturer to open the session" style={{ marginTop: 10 }}>
                  <Clock size={16} /> Waiting for Session to Open
                </button>
              )
            )}
            {open?.id === c.id && (
              <form onSubmit={mark} style={{ marginTop: 12, padding: '14px', background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ fontSize: 14, color: '#1e293b' }}>Enter 6-Digit Class Code</strong>
                  <button
                    type="button"
                    style={{
                      background: '#eff6ff',
                      color: '#2563eb',
                      border: '1px solid #bfdbfe',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    onClick={() => {
                      setQrScanClass(c);
                      setOpen(null);
                    }}
                  >
                    <QrCode size={13} /> Switch to Scan QR
                  </button>
                </div>
                <Field label="Class code" hint="6 digits, displayed by your lecturer when the session is open.">
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    inputMode="numeric"
                    placeholder="e.g. 849201"
                    autoFocus
                    required
                    minLength={4}
                    maxLength={10}
                    style={{ fontSize: 18, letterSpacing: 4, textAlign: 'center', fontWeight: 700 }}
                  />
                </Field>
                <p className="muted small">
                  <MapPin size={13} /> Your location will be read when you submit.
                  {!online && ' You are offline: this will be saved on phone and synced later.'}
                </p>
                <ErrorText>{error}</ErrorText>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="primary" disabled={busy === 'mark'}>
                    {busy === 'mark' ? 'Reading location…' : 'Submit Code'}
                  </button>
                  <button type="button" className="secondary" onClick={() => setOpen(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </Panel>
        );
      })}


      {queue.length > 0 && (
        <Panel title="Offline submissions" action={online && <button className="link-button" onClick={retry} disabled={busy === 'sync'}><RefreshCw size={14} /> Sync now</button>}>
          {queue.map(q => (
            <div className="row" key={q.id}>
              <div><strong>{fmtDateTime(q.client_timestamp)}</strong>
                {q.status === 'failed' && <p className="error small">{q.error}</p>}</div>
              {q.status === 'queued' ? <Badge status="queued"><Clock size={12} /> Pending sync</Badge>
                : <button className="icon-button" aria-label="Dismiss" onClick={() => dismissQueued(q.id)}><X size={16} /></button>}
            </div>
          ))}
        </Panel>
      )}
    </>
  );
}

// =================================================================== HISTORY
export function StudentHistory() {
  const { profile } = useAuth();
  const hist = useCached('history', '/student/attendance');
  const courses = useCached('courses', '/student/courses');
  const ov = useCached('overview', '/student/overview');

  // Three labelled filters
  const [moduleFilter, setModuleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');

  // Pagination
  const [visibleCount, setVisibleCount] = useState(15);

  // Accordion expanded row IDs
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Modals for appeal and excuse
  const [appealModal, setAppealModal] = useState(null);
  const [appealReason, setAppealReason] = useState('');
  const [excuseModal, setExcuseModal] = useState(null);
  const [excuseForm, setExcuseForm] = useState({ reason: 'illness', note: '' });
  const [actionSuccess, setActionSuccess] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 1. Attendance by module: Built from student's modules + any module from attendance history
  const combinedModules = useMemo(() => {
    const map = new Map();
    (courses.data || []).forEach(c => {
      map.set(c.id, {
        id: c.id,
        code: c.code,
        title: c.title,
        credit_units: c.credit_units,
        semester: c.semester,
        attendance: c.attendance || { approved: 0, absent: 0, pending: 0, excused: 0, total: 0, rate: 0 }
      });
    });

    (hist.data || []).forEach(r => {
      const entry = r.class_sessions?.timetable_entries;
      const c = entry?.courses;
      const cid = entry?.course_id || c?.id;
      if (cid && !map.has(cid)) {
        map.set(cid, {
          id: cid,
          code: c?.code || 'COMS',
          title: c?.title || 'Department Module',
          credit_units: c?.credit_units || 3,
          semester: c?.semester || (entry?.semesters?.name?.toLowerCase().includes('second') ? 2 : 1),
          attendance: { approved: 0, absent: 0, pending: 0, excused: 0, total: 0, rate: 0 }
        });
      }
    });

    // Compute exact counts from hist.data
    if (hist.data?.length) {
      const countsByCourse = new Map();
      hist.data.forEach(r => {
        const cid = r.class_sessions?.timetable_entries?.course_id || r.class_sessions?.timetable_entries?.courses?.id;
        if (!cid) return;
        const cur = countsByCourse.get(cid) || { approved: 0, absent: 0, pending: 0, excused: 0, total: 0 };
        if (r.status === 'approved') cur.approved++;
        else if (r.status === 'absent') cur.absent++;
        else if (r.status === 'pending') cur.pending++;
        else if (r.status === 'excused') cur.excused++;
        cur.total++;
        countsByCourse.set(cid, cur);
      });

      countsByCourse.forEach((cnt, cid) => {
        if (map.has(cid)) {
          const m = map.get(cid);
          const relevant = cnt.approved + cnt.absent;
          const rate = relevant > 0 ? Math.round((cnt.approved / relevant) * 100) : (cnt.approved > 0 ? 100 : 0);
          m.attendance = { ...cnt, rate };
        }
      });
    }

    return Array.from(map.values());
  }, [courses.data, hist.data]);

  // 2. Summary stats & Overall Percentage Ring
  const { presentCount, absentCount, excusedCount, pendingCount, overallRate } = useMemo(() => {
    let p = 0, a = 0, e = 0, pend = 0;
    (hist.data || []).forEach(r => {
      if (r.status === 'approved') p++;
      else if (r.status === 'absent') a++;
      else if (r.status === 'excused') e++;
      else if (r.status === 'pending') pend++;
    });
    const relevant = p + a;
    const rate = relevant > 0 ? Math.round((p / relevant) * 100) : (p > 0 ? 100 : (hist.data?.length ? 0 : 100));
    return { presentCount: p, absentCount: a, excusedCount: e, pendingCount: pend, overallRate: rate };
  }, [hist.data]);

  const threshold = ov.data?.threshold || 75;
  const ringColor = overallRate >= threshold ? '#16a34a' : overallRate >= threshold - 5 ? '#d97706' : '#dc2626';

  // 5. Filtered rows by Module, Status, and Semester
  const filteredRows = useMemo(() => {
    return (hist.data || []).filter(r => {
      const entry = r.class_sessions?.timetable_entries;
      const cid = entry?.course_id || entry?.courses?.id;

      if (moduleFilter && cid !== moduleFilter) return false;
      if (statusFilter && r.status !== statusFilter) return false;

      if (semesterFilter) {
        const semName = (entry?.semesters?.name || '').toLowerCase();
        const semNum = semName.includes('second') || semName === '2' ? '2' : (semName.includes('first') || semName === '1' ? '1' : '');
        const courseSem = String(entry?.courses?.semester || '');
        if (semNum) {
          if (semNum !== semesterFilter) return false;
        } else if (courseSem) {
          if (courseSem !== semesterFilter) return false;
        }
      }

      return true;
    });
  }, [hist.data, moduleFilter, statusFilter, semesterFilter]);

  // 5. Group rows by month
  const groupedByMonth = useMemo(() => {
    const paged = filteredRows.slice(0, visibleCount);
    const groups = [];
    const map = new Map();

    paged.forEach(r => {
      const rawDate = r.class_sessions?.session_date || r.submitted_at || r.client_timestamp;
      const d = rawDate ? new Date(rawDate) : new Date();
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthTitle = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      if (!map.has(monthKey)) {
        const group = { key: monthKey, title: monthTitle, items: [] };
        map.set(monthKey, group);
        groups.push(group);
      }
      map.get(monthKey).items.push(r);
    });

    return groups;
  }, [filteredRows, visibleCount]);

  if (profile.account_status !== 'approved') return <PendingApproval />;
  if (hist.loading && !hist.data) return <Loading />;

  const submitAppeal = async (e) => {
    e.preventDefault();
    if (!appealModal) return;
    try {
      setActionBusy(true);
      await apiFetch('/appeals', {
        method: 'POST',
        body: { record_id: appealModal.id, reason: appealReason.trim() }
      });
      setAppealModal(null);
      setAppealReason('');
      setActionSuccess('Your appeal has been submitted for lecturer review.');
      hist.reload();
      setTimeout(() => setActionSuccess(''), 5000);
    } catch (err) {
      alert(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const submitExcuse = async (e) => {
    e.preventDefault();
    if (!excuseModal) return;
    try {
      setActionBusy(true);
      const sessionId = excuseModal.session_id || excuseModal.class_sessions?.id;
      await apiFetch('/excuses', {
        method: 'POST',
        body: { session_id: sessionId, reason: excuseForm.reason, note: excuseForm.note.trim() }
      });
      setExcuseModal(null);
      setExcuseForm({ reason: 'illness', note: '' });
      setActionSuccess('Your excused absence request has been submitted to the lecturer.');
      hist.reload();
      setTimeout(() => setActionSuccess(''), 5000);
    } catch (err) {
      alert(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const renderStatusChip = (status) => {
    switch (status) {
      case 'approved':
        return <span className="status-chip chip-approved"><CheckCircle2 size={13} /> Approved</span>;
      case 'pending':
        return <span className="status-chip chip-pending"><Clock size={13} /> Pending</span>;
      case 'rejected':
        return <span className="status-chip chip-rejected"><X size={13} /> Rejected</span>;
      case 'absent':
        return <span className="status-chip chip-absent"><X size={13} /> Absent</span>;
      case 'excused':
        return <span className="status-chip chip-excused"><ShieldCheck size={13} /> Excused</span>;
      case 'cancelled':
        return <span className="status-chip chip-cancelled">Cancelled</span>;
      default:
        return <span className="status-chip chip-default">{STATUS_LABEL[status] || status}</span>;
    }
  };

  return (
    <div className="student-history-page">
      <ErrorText>{hist.error}</ErrorText>
      <CacheNote {...hist} />

      {actionSuccess && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 10 }}>
          <CheckCircle2 size={18} color="#16a34a" /> {actionSuccess}
        </div>
      )}

      {/* 2. Summary Header: Coloured Ring & Count Chips */}
      <section className="history-summary-card">
        <div className="history-ring-col">
          <div className="history-ring-wrapper">
            <svg viewBox="0 0 100 100" className="history-ring-svg">
              <circle cx="50" cy="50" r="42" className="history-ring-bg" />
              <circle
                cx="50" cy="50" r="42"
                className="history-ring-fg"
                style={{
                  stroke: ringColor,
                  strokeDasharray: 264,
                  strokeDashoffset: 264 - (264 * Math.min(100, Math.max(0, overallRate))) / 100
                }}
              />
            </svg>
            <div className="history-ring-inner-text">
              <span className="history-ring-pct" style={{ color: ringColor }}>{overallRate}%</span>
              <span className="history-ring-label">Overall</span>
            </div>
          </div>
          <div className="history-ring-caption">
            <strong>Attendance Standing</strong>
            <p className="muted small">
              {overallRate >= threshold
                ? `Above the ${threshold}% requirement`
                : overallRate >= threshold - 5
                ? `Within 5% of ${threshold}% requirement`
                : `Below the ${threshold}% requirement`}
            </p>
          </div>
        </div>

        <div className="history-summary-chips-grid">
          <div className="history-count-chip chip-present">
            <div className="chip-icon-box"><CheckCircle2 size={16} /></div>
            <div className="chip-data">
              <span className="chip-num">{presentCount}</span>
              <span className="chip-lbl">Present</span>
            </div>
          </div>
          <div className="history-count-chip chip-absent">
            <div className="chip-icon-box"><X size={16} /></div>
            <div className="chip-data">
              <span className="chip-num">{absentCount}</span>
              <span className="chip-lbl">Absent</span>
            </div>
          </div>
          <div className="history-count-chip chip-excused">
            <div className="chip-icon-box"><ShieldCheck size={16} /></div>
            <div className="chip-data">
              <span className="chip-num">{excusedCount}</span>
              <span className="chip-lbl">Excused</span>
            </div>
          </div>
          <div className="history-count-chip chip-pending">
            <div className="chip-icon-box"><Clock size={16} /></div>
            <div className="chip-data">
              <span className="chip-num">{pendingCount}</span>
              <span className="chip-lbl">Pending</span>
            </div>
          </div>
        </div>
      </section>

      {/* 1 & 3. Attendance by Module */}
      <Panel title="Attendance by Module" className="history-modules-panel">
        {combinedModules.length ? (
          <div className="history-modules-list">
            {combinedModules.map(m => {
              const rate = m.attendance.rate;
              const barColor = rate >= threshold ? '#16a34a' : rate >= threshold - 5 ? '#d97706' : '#dc2626';
              return (
                <div className="history-module-row" key={m.id}>
                  <div className="history-module-left">
                    <div className="history-module-title-line">
                      <span className="module-code-pill">{m.code}</span>
                      <strong className="module-title-name">{m.title}</strong>
                    </div>
                    <div className="history-module-meta-line">
                      <span>{m.attendance.approved} / {m.attendance.total} sessions attended</span>
                      {m.credit_units && <span className="meta-sep">·</span>}
                      {m.credit_units && <span>{m.credit_units} Credit Units</span>}
                    </div>
                  </div>
                  <div className="history-module-right">
                    <div className="history-module-pct-line">
                      <strong style={{ color: barColor }}>{pct(rate)}</strong>
                    </div>
                    <div className="module-progress-bar-bg">
                      <div
                        className="module-progress-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, rate))}%`,
                          backgroundColor: barColor
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty>No modules for {profile.programme || 'Computer Science'}, Level {profile.level} yet. Your HOD will add them.</Empty>
        )}
      </Panel>

      {/* 4, 5, 6, 7. Attendance History Records */}
      <Panel title="Attendance History" className="history-records-panel">
        {/* 5. Three Labelled Filters: Module, Status, Semester */}
        <div className="history-filter-toolbar">
          <div className="history-filter-item">
            <label className="history-filter-label" htmlFor="hist-filter-module">
              <BookOpen size={13} /> Module
            </label>
            <select
              id="hist-filter-module"
              className="history-filter-select"
              value={moduleFilter}
              onChange={e => { setModuleFilter(e.target.value); setVisibleCount(15); }}
            >
              <option value="">All Modules</option>
              {combinedModules.map(m => (
                <option key={m.id} value={m.id}>{m.code} – {m.title}</option>
              ))}
            </select>
          </div>

          <div className="history-filter-item">
            <label className="history-filter-label" htmlFor="hist-filter-status">
              <Filter size={13} /> Status
            </label>
            <select
              id="hist-filter-status"
              className="history-filter-select"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setVisibleCount(15); }}
            >
              <option value="">All Statuses</option>
              <option value="approved">Approved (Present)</option>
              <option value="pending">Pending</option>
              <option value="absent">Absent</option>
              <option value="rejected">Rejected</option>
              <option value="excused">Excused</option>
            </select>
          </div>

          <div className="history-filter-item">
            <label className="history-filter-label" htmlFor="hist-filter-semester">
              <Calendar size={13} /> Semester
            </label>
            <select
              id="hist-filter-semester"
              className="history-filter-select"
              value={semesterFilter}
              onChange={e => { setSemesterFilter(e.target.value); setVisibleCount(15); }}
            >
              <option value="">All Semesters</option>
              <option value="1">First Semester</option>
              <option value="2">Second Semester</option>
            </select>
          </div>
        </div>

        {/* Empty state when filtered rows is 0 */}
        {!filteredRows.length && (
          <Empty>
            {moduleFilter || statusFilter || semesterFilter
              ? 'No attendance records match your active filters.'
              : 'No attendance records logged yet.'}
          </Empty>
        )}

        {/* 5. Grouped by month */}
        {groupedByMonth.map(group => (
          <div key={group.key} className="history-month-group">
            <div className="history-month-header">
              <Calendar size={15} color="var(--primary)" />
              <h4>{group.title}</h4>
              <span className="history-month-count">{group.items.length} records</span>
            </div>

            <div className="history-cards-stack">
              {group.items.map(r => {
                const isExpanded = expandedIds.has(r.id);
                const t = r.class_sessions?.timetable_entries;
                const course = t?.courses;
                const sessionDate = r.class_sessions?.session_date || r.submitted_at;
                const lecturer = t?.profiles?.full_name || 'Department Lecturer';
                const venue = t?.venues?.name || 'Venue TBA';
                const time = t?.starts_at && t?.ends_at ? `${hhmm(t.starts_at)} – ${hhmm(t.ends_at)}` : '';
                const isRejected = r.status === 'rejected';
                const isAbsent = r.status === 'absent';
                const isOffline = Boolean(r.submitted_offline);

                // 48-hour appeal window calculation
                const refTime = r.reviewed_at || r.submitted_at;
                const hoursSince = refTime ? (Date.now() - new Date(refTime).getTime()) / (1000 * 60 * 60) : 0;
                const canAppeal = isRejected && hoursSince <= 48;

                return (
                  <div
                    key={r.id}
                    className={`history-item-card ${isExpanded ? 'is-expanded' : ''}`}
                    onClick={() => toggleExpand(r.id)}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isExpanded}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(r.id); } }}
                  >
                    <div className="history-card-main-row">
                      <div className="history-card-info-col">
                        <div className="history-card-header-line">
                          <span className="history-card-code">{course?.code || 'COMS'}</span>
                          <span className="history-card-title">{course?.title || 'Department Module'}</span>
                        </div>
                        <div className="history-card-meta-line">
                          <span className="history-meta-subitem">
                            <Calendar size={13} className="meta-subitem-icon" /> {fmtDate(sessionDate)}
                          </span>
                          {time && (
                            <>
                              <span className="meta-sep">·</span>
                              <span className="history-meta-subitem">
                                <Clock size={13} className="meta-subitem-icon" /> {time}
                              </span>
                            </>
                          )}
                          <span className="meta-sep">·</span>
                          <span className="history-meta-subitem">
                            <User size={13} className="meta-subitem-icon" /> {lecturer}
                          </span>
                        </div>
                      </div>

                      <div className="history-card-status-col">
                        {renderStatusChip(r.status)}
                        <span className="history-chevron-wrap">
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                    </div>

                    {/* 4. Expanded Details */}
                    {isExpanded && (
                      <div className="history-card-expanded-body" onClick={e => e.stopPropagation()}>
                        <div className="expanded-details-grid">
                          <div className="detail-item">
                            <span className="detail-label">Venue</span>
                            <span className="detail-value">{venue}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Submitted At</span>
                            <span className="detail-value">{fmtDateTime(r.submitted_at || r.client_timestamp) || 'N/A'}</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Reviewed By</span>
                            <span className="detail-value">
                              {r.reviewer?.full_name || (r.status === 'approved' ? `Lecturer (${lecturer})` : (r.reviewed_at ? 'Course Lecturer' : 'Pending review'))}
                            </span>
                          </div>
                          {isOffline && (
                            <div className="detail-item">
                              <span className="detail-label">Submission Mode</span>
                              <span className="detail-value">
                                <span className="offline-badge-pill">
                                  <WifiOff size={11} /> Offline submission
                                </span>
                              </span>
                            </div>
                          )}
                        </div>

                        {r.review_note && (
                          <div className="detail-note-box">
                            <strong>Note:</strong> {r.review_note}
                          </div>
                        )}

                        {/* 6. Request excuse & Appeal buttons */}
                        <div className="expanded-actions-row">
                          {isAbsent && (
                            <button
                              type="button"
                              className="history-btn-excuse"
                              onClick={() => { setExcuseModal(r); setExcuseForm({ reason: 'illness', note: '' }); }}
                            >
                              <ShieldCheck size={14} /> Request Excuse
                            </button>
                          )}

                          {isRejected && (
                            canAppeal ? (
                              <button
                                type="button"
                                className="history-btn-appeal"
                                onClick={() => { setAppealModal(r); setAppealReason(''); }}
                              >
                                <AlertCircle size={14} /> Appeal Rejection (within 48h)
                              </button>
                            ) : (
                              <span className="history-appeal-expired">
                                <Clock size={12} /> Appeal window closed (must be submitted within 48h)
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* 5. Load More Button */}
        {filteredRows.length > visibleCount && (
          <div className="history-load-more-wrap">
            <button
              type="button"
              className="history-load-more-btn"
              onClick={() => setVisibleCount(c => c + 15)}
            >
              Load More Records ({filteredRows.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </Panel>

      {/* Appeal Modal */}
      {appealModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0, background: '#fff', borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Lodge Attendance Appeal</h3>
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Appealing rejection for <strong>{appealModal.class_sessions?.timetable_entries?.courses?.code}</strong> on {fmtDate(appealModal.class_sessions?.session_date)}. Must be submitted within 48 hours of rejection.
            </p>
            <form onSubmit={submitAppeal}>
              <Field label="Explanation for Appeal (required)">
                <textarea
                  rows={4}
                  required
                  className="input-field"
                  style={{ height: 'auto', padding: '10px 12px' }}
                  value={appealReason}
                  onChange={e => setAppealReason(e.target.value)}
                  placeholder="Explain why this attendance record was valid (e.g., GPS device accuracy, present in room, etc.)…"
                />
              </Field>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button type="button" className="secondary compact" onClick={() => setAppealModal(null)}>Cancel</button>
                <button type="submit" className="primary compact" disabled={actionBusy || !appealReason.trim()}>
                  {actionBusy ? 'Submitting…' : 'Submit Appeal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excuse Modal */}
      {excuseModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0, background: '#fff', borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Request Excused Absence</h3>
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Request excuse for <strong>{excuseModal.class_sessions?.timetable_entries?.courses?.code}</strong> on {fmtDate(excuseModal.class_sessions?.session_date)}.
            </p>
            <form onSubmit={submitExcuse}>
              <Field label="Reason Category">
                <select
                  className="input-field"
                  value={excuseForm.reason}
                  onChange={e => setExcuseForm({ ...excuseForm, reason: e.target.value })}
                >
                  <option value="illness">Medical / Illness</option>
                  <option value="family_emergency">Family Emergency</option>
                  <option value="official_duty">Official University Duty</option>
                  <option value="other">Other Official Reason</option>
                </select>
              </Field>
              <Field label="Additional Note (optional)">
                <textarea
                  rows={3}
                  className="input-field"
                  style={{ height: 'auto', padding: '10px 12px' }}
                  value={excuseForm.note}
                  onChange={e => setExcuseForm({ ...excuseForm, note: e.target.value })}
                  placeholder="Provide brief details or certificate reference…"
                />
              </Field>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button type="button" className="secondary compact" onClick={() => setExcuseModal(null)}>Cancel</button>
                <button type="submit" className="primary compact" disabled={actionBusy}>
                  {actionBusy ? 'Submitting…' : 'Submit Excuse Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// =================================================================== REGISTERED MODULES (Student Profile)
export function StudentProfile() {
  const { profile } = useAuth();
  const coursesApi = useCached('courses', '/student/courses');
  const ovApi = useCached('overview', '/student/overview');
  const [search, setSearch] = useState('');
  const [selectedModule, setSelectedModule] = useState(null);

  const studentLevel = profile.level || ovApi.data?.level || 1;
  const studentSemNum = Number(profile.semester || ovApi.data?.semester_num || (ovApi.data?.semester === 'Second Semester' ? 2 : 1));
  const semester = ovApi.data?.semester || (studentSemNum === 2 ? 'Second Semester' : 'First Semester');
  const academicYear = (ovApi.data?.year || profile.academic_year || '2026/2027').replace(/\s*academic\s*year/i, '').trim();
  const levelLabel = `Level ${studentLevel}`;

  // Real courses assigned to the student (no fake dummy courses)
  const rawList = useMemo(() => {
    if (!coursesApi.data || coursesApi.data.length === 0) return [];
    return coursesApi.data.map((c, i) => ({
      id: c.id || `c-${i}`,
      code: c.code || 'COMS',
      title: c.title || 'Department Module',
      level: c.level || studentLevel,
      credit_units: Number(c.credit_units) || 3,
      semester_name: (c.semester === 2 || c.semester_name === 'Second Semester') ? 'Second Semester' : 'First Semester',
      lecturer_name: c.lecturer_name || 'Department Lecturer',
      rate: c.rate ?? (c.attendance?.rate || 0),
      attended: c.attended ?? (c.attendance?.approved || 0),
      total_classes: c.total_classes ?? (c.attendance?.total || 0),
      missed: c.missed ?? ((c.attendance?.absent || 0) + (c.attendance?.rejected || 0)),
      pending: c.pending ?? (c.attendance?.pending || 0)
    }));
  }, [coursesApi.data, studentLevel]);

  // Filter by search term
  const modules = useMemo(() => {
    if (!search.trim()) return rawList;
    const term = search.toLowerCase();
    return rawList.filter(m =>
      m.code.toLowerCase().includes(term) ||
      m.title.toLowerCase().includes(term) ||
      m.lecturer_name.toLowerCase().includes(term)
    );
  }, [rawList, search]);

  // Aggregate stats
  const totalModules = rawList.length;
  const totalCredits = rawList.reduce((acc, m) => acc + (Number(m.credit_units) || 0), 0);
  const totalAttended = rawList.reduce((acc, m) => acc + (Number(m.attended) || 0), 0);
  const totalHeld = rawList.reduce((acc, m) => acc + (Number(m.total_classes) || 0), 0);
  const totalMissed = rawList.reduce((acc, m) => acc + (Number(m.missed) || 0), 0);
  const totalPending = rawList.reduce((acc, m) => acc + (Number(m.pending) || 0), 0);
  const averageRate = totalHeld > 0 ? Math.round((totalAttended / totalHeld) * 100) : 0;

  // Donut values
  const attendedPct = totalHeld > 0 ? Math.round((totalAttended / totalHeld) * 100) : 0;
  const missedPct = totalHeld > 0 ? Math.round((totalMissed / totalHeld) * 100) : 0;
  const pendingPct = totalHeld > 0 ? Math.max(0, 100 - attendedPct - missedPct) : 0;

  return (
    <div className="mod-page-container">
      {/* Header */}
      <div className="mod-header-row">

        <div className="mod-title-pills-row">
          <div className="mod-title-box">
            <h1 className="mod-page-title">My Registered Modules</h1>
            <p className="mod-page-desc">View your enrolled courses, attendance and academic progress.</p>
          </div>

          <div className="mod-context-pills">
            <div className="mod-context-pill">
              <Calendar size={18} className="mod-pill-icon" />
              <div className="mod-pill-text">
                <span className="mod-pill-label">Academic Year</span>
                <span className="mod-pill-val">{academicYear} <ChevronDown size={14} /></span>
              </div>
            </div>

            <div className="mod-context-pill">
              <GraduationCap size={18} className="mod-pill-icon" />
              <div className="mod-pill-text">
                <span className="mod-pill-label">Semester</span>
                <span className="mod-pill-val">{semester} <ChevronDown size={14} /></span>
              </div>
            </div>

            <div className="mod-context-pill">
              <Layers size={18} className="mod-pill-icon" />
              <div className="mod-pill-text">
                <span className="mod-pill-label">Academic Level</span>
                <span className="mod-pill-val">{levelLabel} <ChevronDown size={14} /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top 4 Metric Cards */}
      <div className="mod-metrics-grid">
        <div className="mod-metric-card">
          <div className="mod-metric-icon blue">
            <BookOpen size={22} />
          </div>
          <div className="mod-metric-content">
            <span className="mod-metric-label">Total Modules</span>
            <strong className="mod-metric-val">{totalModules}</strong>
            <span className="mod-metric-sub">Registered courses</span>
          </div>
        </div>

        <div className="mod-metric-card">
          <div className="mod-metric-icon green">
            <CheckCircle2 size={22} />
          </div>
          <div className="mod-metric-content">
            <span className="mod-metric-label">Total Credits</span>
            <strong className="mod-metric-val">{totalCredits}</strong>
            <span className="mod-metric-sub">Credit units</span>
          </div>
        </div>

        <div className="mod-metric-card">
          <div className="mod-metric-icon purple">
            <Activity size={22} />
          </div>
          <div className="mod-metric-content">
            <span className="mod-metric-label">Average Attendance</span>
            <strong className="mod-metric-val">{averageRate}%</strong>
            <span className="mod-metric-trend">{totalHeld > 0 ? `${averageRate}% attendance rate` : 'Semester average'}</span>
          </div>
        </div>

        <div className="mod-metric-card">
          <div className="mod-metric-icon amber">
            <Calendar size={22} />
          </div>
          <div className="mod-metric-content">
            <span className="mod-metric-label">Classes Attended</span>
            <strong className="mod-metric-val">{totalAttended} / {totalHeld}</strong>
            <div className="mod-progress-wrap">
              <div className="mod-progress-bar">
                <div className="mod-progress-fill" style={{ width: `${attendedPct}%` }} />
              </div>
              <span className="mod-progress-pct">{attendedPct}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Grid */}
      <div className="mod-main-layout">
        {/* Left Column: Registered Modules List */}
        <div className="mod-left-col">
          <div className="mod-panel">
            <div className="mod-panel-header">
              <div className="mod-panel-title-wrap">
                <BookOpen size={18} className="mod-panel-icon-blue" />
                <h2 className="mod-panel-title">Registered Modules ({modules.length})</h2>
              </div>
              <div className="mod-search-box">
                <Search size={15} className="mod-search-icon" />
                <input
                  type="text"
                  placeholder="Search modules..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="mod-search-input"
                />
              </div>
            </div>

            <div className="mod-items-list">
              {modules.map(m => {
                const parts = m.code.split(' ');
                const codePrefix = parts[0] || 'COMS';
                const codeNum = parts.slice(1).join(' ') || '111';

                // Ring progress color
                const ringColor = m.rate >= 90 ? '#10b981' : m.rate >= 75 ? '#f59e0b' : '#ef4444';
                const r = 24;
                const circ = 2 * Math.PI * r;
                const strokeDash = (m.rate / 100) * circ;

                return (
                  <div key={m.id} className="mod-item-card">
                    {/* Left Code Tile */}
                    <div className="mod-code-tile">
                      <span className="mod-code-prefix">{codePrefix}</span>
                      <strong className="mod-code-num">{codeNum}</strong>
                    </div>

                    {/* Middle Info */}
                    <div className="mod-item-details">
                      <h3 className="mod-item-title">{m.title}</h3>
                      <div className="mod-tags-row">
                        <span className="mod-tag tag-blue">Level {m.level}</span>
                        <span className="mod-tag tag-green">{m.credit_units} Credits</span>
                        <span className="mod-tag tag-purple">{m.semester_name}</span>
                      </div>
                      <div className="mod-lecturer-row">
                        <User size={13} className="mod-lec-icon" />
                        <span>{m.lecturer_name}</span>
                      </div>
                    </div>

                    {/* Circular Attendance Ring */}
                    <div className="mod-ring-box">
                      <svg width="56" height="56" viewBox="0 0 56 56" className="mod-ring-svg">
                        <circle cx="28" cy="28" r={r} fill="transparent" stroke="#f1f5f9" strokeWidth="5" />
                        <circle
                          cx="28"
                          cy="28"
                          r={r}
                          fill="transparent"
                          stroke={ringColor}
                          strokeWidth="5"
                          strokeDasharray={`${strokeDash} ${circ - strokeDash}`}
                          strokeLinecap="round"
                          transform="rotate(-90 28 28)"
                        />
                      </svg>
                      <span className="mod-ring-val">{m.rate}%</span>
                    </div>

                    {/* Class Counts */}
                    <div className="mod-item-stats">
                      <div className="mod-stat-stat-row">
                        <span className="mod-stat-meta-label">Attended</span>
                        <strong className="mod-stat-meta-val count-green">{m.attended}</strong>
                      </div>
                      <div className="mod-stat-stat-row">
                        <span className="mod-stat-meta-label">Total Classes</span>
                        <span className="mod-stat-meta-val">{m.total_classes}</span>
                      </div>
                      <div className="mod-stat-stat-row">
                        <span className="mod-stat-meta-label">Missed</span>
                        <strong className="mod-stat-meta-val count-red">{m.missed}</strong>
                      </div>
                    </div>

                    {/* Right Actions */}
                    <div className="mod-item-actions">
                      <span className="mod-active-chip">Active</span>
                      <button
                        type="button"
                        className="mod-view-details-btn"
                        onClick={() => setSelectedModule(m)}
                      >
                        View Details →
                      </button>
                    </div>
                  </div>
                );
              })}
              {!modules.length && (
                <div className="mod-empty-state">
                  <p>{search ? `No modules match "${search}".` : 'No registered modules found for this semester. Modules added by the HOD will appear here.'}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Academic Progress, Module Summary, Quick Tip */}
        <div className="mod-right-col">
          {/* Card 1: Academic Progress */}
          <div className="mod-panel">
            <h3 className="mod-right-panel-title">Academic Progress</h3>
            <div className="mod-progress-donut-wrap">
              <div className="mod-donut-circle-box">
                <svg width="130" height="130" viewBox="0 0 130 130">
                  {/* Base track */}
                  <circle cx="65" cy="65" r="48" fill="transparent" stroke="#f1f5f9" strokeWidth="16" />
                  {/* Attended (Green) */}
                  <circle
                    cx="65"
                    cy="65"
                    r="48"
                    fill="transparent"
                    stroke="#10b981"
                    strokeWidth="16"
                    strokeDasharray={`${(attendedPct / 100) * (2 * Math.PI * 48)} ${2 * Math.PI * 48}`}
                    strokeDashoffset="0"
                    strokeLinecap="round"
                    transform="rotate(-90 65 65)"
                  />
                  {/* Missed (Orange) */}
                  <circle
                    cx="65"
                    cy="65"
                    r="48"
                    fill="transparent"
                    stroke="#f97316"
                    strokeWidth="16"
                    strokeDasharray={`${(missedPct / 100) * (2 * Math.PI * 48)} ${2 * Math.PI * 48}`}
                    strokeDashoffset={`-${(attendedPct / 100) * (2 * Math.PI * 48)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 65 65)"
                  />
                  {/* Pending (Blue) */}
                  <circle
                    cx="65"
                    cy="65"
                    r="48"
                    fill="transparent"
                    stroke="#38bdf8"
                    strokeWidth="16"
                    strokeDasharray={`${(pendingPct / 100) * (2 * Math.PI * 48)} ${2 * Math.PI * 48}`}
                    strokeDashoffset={`-${((attendedPct + missedPct) / 100) * (2 * Math.PI * 48)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 65 65)"
                  />
                </svg>
                <div className="mod-donut-center-text">
                  <strong className="mod-donut-pct">{attendedPct}%</strong>
                  <span className="mod-donut-sub">Overall Attendance</span>
                </div>
              </div>

              <div className="mod-donut-legend">
                <div className="mod-legend-row">
                  <span className="mod-legend-dot bg-green" />
                  <span className="mod-legend-label">Attended</span>
                  <strong className="mod-legend-pct">{attendedPct}%</strong>
                </div>
                <div className="mod-legend-row">
                  <span className="mod-legend-dot bg-orange" />
                  <span className="mod-legend-label">Missed</span>
                  <strong className="mod-legend-pct">{missedPct}%</strong>
                </div>
                <div className="mod-legend-row">
                  <span className="mod-legend-dot bg-blue" />
                  <span className="mod-legend-label">Pending</span>
                  <strong className="mod-legend-pct">{pendingPct}%</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Module Summary */}
          <div className="mod-panel">
            <h3 className="mod-right-panel-title">Module Summary</h3>
            <div className="mod-summary-list">
              <div className="mod-summary-row">
                <div className="mod-sum-left">
                  <div className="mod-sum-icon text-blue"><BookOpen size={17} /></div>
                  <span className="mod-sum-label">Total Modules</span>
                </div>
                <strong className="mod-sum-val">{totalModules}</strong>
              </div>

              <div className="mod-summary-row">
                <div className="mod-sum-left">
                  <div className="mod-sum-icon text-green"><CheckCircle2 size={17} /></div>
                  <span className="mod-sum-label">Total Credits</span>
                </div>
                <strong className="mod-sum-val">{totalCredits}</strong>
              </div>

              <div className="mod-summary-row">
                <div className="mod-sum-left">
                  <div className="mod-sum-icon text-purple"><Activity size={17} /></div>
                  <span className="mod-sum-label">Average Attendance</span>
                </div>
                <strong className="mod-sum-val text-green">{averageRate}%</strong>
              </div>

              <div className="mod-summary-row">
                <div className="mod-sum-left">
                  <div className="mod-sum-icon text-coral"><CheckCircle2 size={17} /></div>
                  <span className="mod-sum-label">Classes Attended</span>
                </div>
                <strong className="mod-sum-val">{totalAttended}</strong>
              </div>

              <div className="mod-summary-row">
                <div className="mod-sum-left">
                  <div className="mod-sum-icon text-red"><XCircle size={17} /></div>
                  <span className="mod-sum-label">Classes Missed</span>
                </div>
                <strong className="mod-sum-val count-red">{totalMissed}</strong>
              </div>

              <div className="mod-summary-row">
                <div className="mod-sum-left">
                  <div className="mod-sum-icon text-amber"><Clock size={17} /></div>
                  <span className="mod-sum-label">Pending Records</span>
                </div>
                <strong className="mod-sum-val text-amber">{totalPending}</strong>
              </div>
            </div>
          </div>

          {/* Card 3: Quick Tip */}
          <div className="mod-tip-card">
            <div className="mod-tip-header">
              <Lightbulb size={18} className="mod-tip-icon" />
              <strong>Quick Tip</strong>
            </div>
            <p className="mod-tip-text">
              Your attendance is automatically updated after lecturers approve daily records.
            </p>
          </div>
        </div>
      </div>

      {/* Module Details Modal */}
      {selectedModule && (
        <div className="hod-modal-backdrop" onClick={() => setSelectedModule(null)}>
          <div className="hod-modal-card" onClick={e => e.stopPropagation()}>
            <div className="hod-modal-header">
              <div>
                <h3>{selectedModule.code}</h3>
                <p className="hod-modal-sub">{selectedModule.title}</p>
              </div>
              <button
                type="button"
                className="hod-modal-close-btn"
                onClick={() => setSelectedModule(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="hod-modal-body">
              <div className="hod-modal-field">
                <span className="hod-field-label">Department / Programme:</span>
                <strong>Computer Science · {profile.programme || 'Degree'}</strong>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Level & Semester:</span>
                <span>Level {selectedModule.level} · {selectedModule.semester_name}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Credit Units:</span>
                <span>{selectedModule.credit_units} Credits</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Assigned Lecturer:</span>
                <span>{selectedModule.lecturer_name}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Attendance Rate:</span>
                <span className={`hod-status-badge ${selectedModule.rate >= 75 ? 'badge-approved' : 'badge-rejected'}`}>
                  {selectedModule.rate}%
                </span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Attendance Breakdown:</span>
                <span>{selectedModule.attended} Attended · {selectedModule.missed} Missed · {selectedModule.total_classes} Held</span>
              </div>
            </div>

            <div className="hod-modal-footer">
              <button
                type="button"
                className="btn primary"
                onClick={() => setSelectedModule(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
