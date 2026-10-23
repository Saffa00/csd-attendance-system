import { useEffect, useState, useCallback } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Wifi, WifiOff, CloudUpload, Menu, X, LogOut,
  Download, ChevronRight, ShieldCheck, User, Search, BellRing
} from 'lucide-react';
import { apiFetch } from './api';
import { useAuth } from './auth';
import { useOnline, useInstallPrompt, Avatar } from './ui';
import { queueCount, syncQueue } from './offline';
import ProfileDropdown from './components/ProfileDropdown';
import GlobalSearchBar from './components/GlobalSearchBar';
import MoreBottomSheet from './components/MoreBottomSheet';

/** Web Audio 2-tone notification chime (zero latency, no audio file download) */
function playChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.12); // A5
    gain2.gain.setValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.4);
  } catch {}
}

/** Triggers sound, vibration and native OS notification on mobile/desktop */
function triggerDeviceAlert(title, body, tag) {
  playChime();
  if ('vibrate' in navigator) {
    try { navigator.vibrate([180, 100, 200]); } catch {}
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body,
            icon: '/logo.png',
            badge: '/logo.png',
            tag: tag || 'class-reminder',
            renotify: true
          });
        });
      } else {
        new Notification(title, { body, icon: '/logo.png' });
      }
    } catch {}
  }
}

const ROLE_LABELS = {
  hod: 'Head of Department',
  lecturer: 'Lecturer',
  class_rep: 'Class Representative',
  student: 'Student'
};

/**
 * Modern dual-experience shell:
 * - Desktop/Tablet: Fixed left sidebar with university branding, user profile card,
 *   grouped navigation, and wide main workspace panel.
 * - Mobile/PWA: Responsive mobile app header, slide-out drawer, and fixed bottom navigation bar.
 */
export default function Shell({ mobileNav = [], sidebarNav = [], nav, titles = {}, children }) {
  const { profile, signOut } = useAuth();
  const online = useOnline();
  const { canInstall, install } = useInstallPrompt();
  const loc = useLocation();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [pendingSync, setPendingSync] = useState(0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [activeToast, setActiveToast] = useState(null);
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(() => {
    return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default' && !sessionStorage.getItem('dismissed_notif_prompt');
  });

  const isStudent = profile.role === 'student';
  const effectiveMobileNav = mobileNav.length ? mobileNav : (nav || []);
  const title = titles[loc.pathname] || titles[`/${loc.pathname.split('/')[1]}`] || 'CS Portal';

  // Automatically close mobile drawer and more sheet when navigating
  useEffect(() => {
    setMobileDrawerOpen(false);
    setMoreSheetOpen(false);
  }, [loc.pathname]);

  // Request notification permission handler
  const requestNotificationPermission = useCallback(async () => {
    if ('Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          triggerDeviceAlert('🔔 Notifications Active', 'You will now receive 5-min class alerts and 20-min attendance reminders!');
        }
      } catch {}
    }
    if (window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async OneSignal => {
        try { await OneSignal.Notifications.requestPermission(); } catch {}
      });
    }
    setShowPermissionPrompt(false);
  }, []);

  // Real-time notification polling and native device alerts
  useEffect(() => {
    if (!online) return;
    let live = true;
    let lastNotifiedId = sessionStorage.getItem('last_notified_id') || '';

    const checkNotifications = async () => {
      try {
        const [unreadRes, listRes] = await Promise.all([
          apiFetch('/notifications/unread-count'),
          apiFetch('/notifications')
        ]);
        if (!live) return;
        setUnread(unreadRes?.count || 0);

        if (Array.isArray(listRes) && listRes.length > 0) {
          const newest = listRes[0];
          // If newest notification has not been seen and is unread
          if (newest && !newest.read_at && newest.id !== lastNotifiedId) {
            sessionStorage.setItem('last_notified_id', newest.id);
            lastNotifiedId = newest.id;
            setActiveToast(newest);
            triggerDeviceAlert(newest.title, newest.body, newest.id);
          }
        }
      } catch {}
    };

    checkNotifications();
    const timer = setInterval(checkNotifications, 20 * 1000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') checkNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [online, loc.pathname]);

  // Auto-dismiss in-app toast after 8 seconds
  useEffect(() => {
    if (!activeToast) return;
    const t = setTimeout(() => setActiveToast(null), 8000);
    return () => clearTimeout(t);
  }, [activeToast]);

  // Students: offline sync count & auto-sync
  useEffect(() => {
    if (!isStudent) return;
    const refresh = () => queueCount(profile.id).then(setPendingSync).catch(() => {});
    const sync = () => {
      if (profile.account_status === 'approved') syncQueue(profile.id).then(refresh).catch(() => {});
    };
    refresh(); sync();
    window.addEventListener('queue-changed', refresh);
    window.addEventListener('online', sync);
    return () => {
      window.removeEventListener('queue-changed', refresh);
      window.removeEventListener('online', sync);
    };
  }, [isStudent, profile.id, profile.account_status]);

  return (
    <div className="app-layout">
      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ===================================================================
          DESKTOP SIDEBAR + MOBILE SLIDE-OUT DRAWER
          =================================================================== */}
      <aside className={`app-sidebar ${mobileDrawerOpen ? 'drawer-open' : ''}`}>
        {/* Brand Header */}
        <div className="sidebar-brand">
          <Link to="/" className="sidebar-brand-link" onClick={() => setMobileDrawerOpen(false)}>
            <img src="/logo.png" alt="Milton Margai Technical University" className="sidebar-logo" />
            <div className="sidebar-brand-text">
              <span className="brand-uni">MILTON MARGAI</span>
              <span className="brand-dept">Computer Science</span>
            </div>
          </Link>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setMobileDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        {/* User Profile Card */}
        <div className="sidebar-user-card">
          <Link to="/account" className="sidebar-user-avatar-link" onClick={() => setMobileDrawerOpen(false)}>
            <Avatar user={profile} size={46} className="sidebar-avatar" />
          </Link>
          <div className="sidebar-user-info">
            <Link to="/account" className="sidebar-user-name" onClick={() => setMobileDrawerOpen(false)}>
              {profile.full_name}
            </Link>
            <div className="sidebar-user-meta">
              <span className={`badge ${profile.role === 'hod' ? 'ok' : 'info'} sidebar-role-pill`}>
                {ROLE_LABELS[profile.role] || profile.role}
              </span>
              {profile.student_id && <span className="sidebar-id-pill">ID: {profile.student_id}</span>}
              {profile.username && <span className="sidebar-id-pill">{profile.username}</span>}
            </div>
          </div>
        </div>

        {/* Grouped Sidebar Navigation */}
        <nav className="sidebar-nav">
          {sidebarNav.length > 0 ? (
            sidebarNav.map(section => (
              <div key={section.group} className="sidebar-nav-group">
                <div className="sidebar-group-title">{section.group}</div>
                <div className="sidebar-group-items">
                  {section.items.map(({ label, icon: Icon, to }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => setMobileDrawerOpen(false)}
                    >
                      <Icon size={18} className="sidebar-nav-icon" />
                      <span className="sidebar-nav-label">{label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="sidebar-nav-group">
              <div className="sidebar-group-items">
                {effectiveMobileNav.map(({ label, icon: Icon, to }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileDrawerOpen(false)}
                  >
                    <Icon size={18} className="sidebar-nav-icon" />
                    <span className="sidebar-nav-label">{label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          {canInstall && (
            <button type="button" className="sidebar-install-btn" onClick={install}>
              <Download size={15} /> <span>Install Mobile App</span>
            </button>
          )}

          <div className="sidebar-footer-actions">
            <Link to="/account" className="sidebar-footer-btn" onClick={() => setMobileDrawerOpen(false)}>
              <User size={15} /> <span>My Account</span>
            </Link>
            <button type="button" className="sidebar-footer-btn danger-btn" onClick={signOut}>
              <LogOut size={15} /> <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ===================================================================
          MAIN WORKSPACE PANEL & TOP HEADER
          =================================================================== */}
      <div className="main-wrapper">
        {/* Top Header Bar */}
        <header className="main-header">
          <div className="main-header-left flex items-center gap-2.5 min-w-0">
            <Link to="/" className="flex items-center gap-2 min-w-0 text-inherit no-underline">
              <img src="/logo.png" alt="MMTU" className="header-mobile-logo" />
              <div className="main-header-title-box flex min-w-0">
                <span className="main-header-portal-tag">
                  MMTU CS · {ROLE_LABELS[profile.role]?.toUpperCase()}
                </span>
                <h1 className="main-header-page-title">{title}</h1>
              </div>
            </Link>

            {/* Interactive Global Search Bar */}
            <div className="hidden md:block">
              <GlobalSearchBar role={profile.role} />
            </div>
          </div>

          <div className="main-header-right flex items-center gap-2.5">
            {/* Live Network Status */}
            <span className={online ? 'net online' : 'net offline'} title={online ? 'Network Online' : 'Network Offline'}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span className="net-text">{online ? 'Online' : 'Offline'}</span>
            </span>

            {/* Offline sync queue counter for students */}
            {isStudent && pendingSync > 0 && (
              <Link to="/attendance" className="net sync" title={`${pendingSync} attendance records waiting to sync`}>
                <CloudUpload size={14} />
                <span className="net-text">{pendingSync} sync</span>
              </Link>
            )}

            {/* Notifications Bell */}
            <Link
              to="/notifications"
              className="icon-button bell header-bell relative"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            >
              <Bell size={20} />
              {unread > 0 && <b className="dot">{unread > 9 ? '9+' : unread}</b>}
            </Link>

            {/* Modern Responsive Profile Dropdown Menu */}
            <ProfileDropdown unread={unread} />
          </div>
        </header>

        {/* Mobile Notification Permission Request Banner */}
        {showPermissionPrompt && (
          <div className="notif-perm-banner">
            <div className="flex items-center gap-2 flex-1">
              <BellRing size={16} className="text-amber-500 animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-slate-800">
                Enable mobile alerts for 5-min class start & 20-min attendance reminders
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={requestNotificationPermission}
                className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-xs cursor-pointer"
              >
                Enable
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('dismissed_notif_prompt', '1');
                  setShowPermissionPrompt(false);
                }}
                className="text-slate-400 hover:text-slate-600 px-1 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Live In-App Notification Toast Popup */}
        {activeToast && (
          <div
            className="mobile-notification-toast"
            role="alert"
            onClick={() => {
              navigate('/notifications');
              setActiveToast(null);
            }}
          >
            <div className="toast-icon">
              <BellRing size={20} className="text-emerald-600 animate-bounce" />
            </div>
            <div className="toast-text">
              <div className="toast-title">{activeToast.title}</div>
              <div className="toast-body">{activeToast.body}</div>
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={(e) => {
                e.stopPropagation();
                setActiveToast(null);
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Offline notification banner */}
        {!online && (
          <div className="offline-banner">
            {isStudent
              ? 'You are offline. You can still view cached classes and submit attendance; it will automatically sync once your connection is restored.'
              : 'You are offline. Staff and administrative actions require an active internet connection.'}
          </div>
        )}

        {/* Main Content Workspace Panel */}
        <main className="main-content-panel">
          {children}
        </main>

        {/* ===================================================================
            MOBILE BOTTOM NAVIGATION BAR (Phones & PWA Standalone Mode)
            =================================================================== */}
        <nav className="mobile-bottom-nav" aria-label="Mobile Bottom Navigation">
          {effectiveMobileNav.map(({ label, icon: Icon, to }) => {
            const isMore = label === 'More' || to === '/more';
            if (isMore) {
              return (
                <button
                  key="more-bottom-btn"
                  type="button"
                  onClick={(e) => {
                    if (window.innerWidth < 768) {
                      e.preventDefault();
                      setMoreSheetOpen(prev => !prev);
                    } else {
                      navigate('/more');
                    }
                  }}
                  className={`mobile-nav-item ${moreSheetOpen || loc.pathname === '/more' ? 'active' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={moreSheetOpen}
                  aria-label="Open More menu"
                >
                  <Icon size={21} />
                  <span>{label}</span>
                </button>
              );
            }
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setMoreSheetOpen(false)}
              >
                <Icon size={21} />
                <span>{label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Slide-Up Bottom Sheet on screens < 768px */}
        <MoreBottomSheet
          isOpen={moreSheetOpen}
          onClose={() => setMoreSheetOpen(false)}
          profile={profile}
          onSignOut={signOut}
        />
      </div>
    </div>
  );
}
