import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Megaphone, Users, User, GraduationCap, MapPin, ShieldAlert,
  KeyRound, RefreshCw, Settings, FileText, History, ClipboardCheck,
  CalendarDays, Bell, Shield, LogOut, X, AlertTriangle
} from 'lucide-react';
import { apiFetch } from '../api';
import { Modal } from '../ui';

export default function MoreBottomSheet({ isOpen, onClose, profile, onSignOut }) {
  const navigate = useNavigate();
  const sheetRef = useRef(null);
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  // Dynamic notification & approval badges
  const [resetCount, setResetCount] = useState(0);
  const [pendingStudentCount, setPendingStudentCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const role = profile?.role === 'rep' ? 'class_rep' : (profile?.role || 'student');

  useEffect(() => {
    if (!isOpen) return;

    // Fetch badges when sheet opens
    if (role === 'hod') {
      apiFetch('/staff/reset-requests')
        .then(r => setResetCount(Array.isArray(r) ? r.length : 0))
        .catch(() => {});

      apiFetch('/students/pending')
        .then(r => setPendingStudentCount(Array.isArray(r) ? r.length : 0))
        .catch(() => {});
    }

    apiFetch('/notifications/unread-count')
      .then(r => setUnreadCount(r?.count || 0))
      .catch(() => {});
  }, [isOpen, role]);

  // Handle escape key and lock body scroll
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the sheet for accessibility
    sheetRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  // Touch handlers for swipe down to dismiss
  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  };

  const handleTouchMove = (e) => {
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;
    if (diff > 0 && sheetRef.current) {
      touchDeltaY.current = diff;
      sheetRef.current.style.transform = `translateY(${diff}px)`;
    }
  };

  const handleTouchEnd = () => {
    if (touchDeltaY.current > 75) {
      onClose();
    } else if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    touchDeltaY.current = 0;
  };

  if (!isOpen) return null;

  // HOD items (not on footer: Home, Attendance, Reports, Modules):
  // Department Notices, Lecturers, Class Representatives, Students Directory,
  // Venues & GPS Radius, Students At Risk, Reset Requests, Academic Year, Report Settings, My Profile
  const hodItems = [
    {
      to: '/announcements',
      label: 'Department Notices',
      icon: Megaphone,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/lecturers',
      label: 'Lecturers',
      icon: Users,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/reps',
      label: 'Class Representatives',
      icon: User,
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      to: '/students',
      label: 'Students Directory',
      icon: GraduationCap,
      badge: pendingStudentCount > 0 ? pendingStudentCount : null,
      color: 'bg-indigo-50 text-indigo-600'
    },
    {
      to: '/venues',
      label: 'Venues & GPS Radius',
      icon: MapPin,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/students-at-risk',
      label: 'Students At Risk',
      icon: ShieldAlert,
      color: 'bg-rose-50 text-rose-600'
    },
    {
      to: '/lecturers',
      label: 'Reset Requests',
      icon: KeyRound,
      badge: resetCount > 0 ? resetCount : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/rollover',
      label: 'Academic Year',
      icon: RefreshCw,
      color: 'bg-teal-50 text-teal-600'
    },
    {
      to: '/academic',
      label: 'Report Settings',
      icon: Settings,
      color: 'bg-slate-100 text-slate-700'
    },
    {
      to: '/account',
      label: 'My Profile',
      icon: User,
      color: 'bg-sky-50 text-sky-600'
    }
  ];

  // Lecturer items (not on footer: Home, Sessions, Approvals, Modules):
  const lecturerItems = [
    {
      to: '/announcements',
      label: 'Department Notices',
      icon: Megaphone,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/reports',
      label: 'Attendance Reports',
      icon: FileText,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/students-at-risk',
      label: 'Students At Risk',
      icon: ShieldAlert,
      color: 'bg-rose-50 text-rose-600'
    },
    {
      to: '/venues',
      label: 'Venues & GPS',
      icon: MapPin,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      to: '/account',
      label: 'My Profile',
      icon: User,
      color: 'bg-sky-50 text-sky-600'
    }
  ];

  // Class Rep items (not on footer: Home, Timetable, Students, Modules):
  const repItems = [
    {
      to: '/announcements',
      label: 'Department Notices',
      icon: Megaphone,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/attendance',
      label: 'Class Attendance',
      icon: ClipboardCheck,
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      to: '/reports',
      label: 'Attendance Reports',
      icon: FileText,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/venues',
      label: 'Venues & GPS',
      icon: MapPin,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/account',
      label: 'My Profile',
      icon: User,
      color: 'bg-sky-50 text-sky-600'
    }
  ];

  // Student items (not on footer: Home, Timetable, Attendance, Modules):
  const studentItems = [
    {
      to: '/announcements',
      label: 'Department Notices',
      icon: Megaphone,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/history',
      label: 'Attendance History',
      icon: History,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/venues',
      label: 'Venues & GPS',
      icon: MapPin,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadCount > 0 ? unreadCount : null,
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      to: '/privacy',
      label: 'Privacy Policy',
      icon: Shield,
      color: 'bg-slate-100 text-slate-700'
    },
    {
      to: '/account',
      label: 'My Profile',
      icon: User,
      color: 'bg-sky-50 text-sky-600'
    }
  ];

  const items = role === 'hod'
    ? hodItems
    : role === 'lecturer'
    ? lecturerItems
    : role === 'class_rep'
    ? repItems
    : studentItems;

  const handleItemClick = (path) => {
    onClose();
    navigate(path);
  };

  const handleConfirmSignOut = async () => {
    setShowSignOutConfirm(false);
    onClose();
    if (onSignOut) {
      await onSignOut();
    }
  };

  return (
    <>
      {/* Dark backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-[999] transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-up Bottom Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="More Menu"
        tabIndex={-1}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="fixed bottom-0 left-0 right-0 z-[1000] bg-white rounded-t-3xl shadow-2xl max-h-[88vh] flex flex-col focus:outline-none animate-slide-up-200"
        style={{
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.25)'
        }}
      >
        {/* Grabber bar */}
        <div className="w-full pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>

        {/* Sheet Header */}
        <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900 m-0">More</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* 3-Column Grid of Buttons */}
        <div className="p-4 overflow-y-auto flex-1 overscroll-contain">
          <div className="grid grid-cols-3 gap-3">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleItemClick(item.to)}
                  className="flex flex-col items-center justify-center p-2.5 rounded-2xl hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer group min-h-[76px] no-underline focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <div className="relative mb-1.5">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${item.color} group-hover:scale-105 transition-transform`}>
                      <Icon size={22} />
                    </div>
                    {item.badge && (
                      <span className="absolute -top-1 -right-1 px-1.5 py-0.5 min-w-[18px] text-[10px] font-bold bg-red-500 text-white rounded-full flex items-center justify-center shadow-xs">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-800 text-center leading-tight line-clamp-2 max-w-[95px] no-underline">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Red Log Out Button at the bottom */}
          <div className="mt-4 pt-3 border-t border-slate-100 px-2">
            <button
              type="button"
              onClick={() => setShowSignOutConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 text-xs font-bold transition-colors cursor-pointer min-h-[48px]"
            >
              <LogOut size={16} />
              <span>Log out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Log Out */}
      {showSignOutConfirm && (
        <Modal title="Confirm Log Out" onClose={() => setShowSignOutConfirm(false)}>
          <div className="p-2 text-slate-700">
            <div className="flex items-center gap-3 mb-4 p-3 bg-red-50 rounded-xl text-red-800 border border-red-100">
              <div className="p-2 bg-red-100 text-red-600 rounded-lg shrink-0">
                <AlertTriangle size={20} />
              </div>
              <p className="text-xs font-medium text-red-800 m-0">
                Are you sure you want to log out of the CS Attendance System on this device?
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-4">
              <button
                type="button"
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                onClick={() => setShowSignOutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                onClick={handleConfirmSignOut}
              >
                <LogOut size={14} /> Log out
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
