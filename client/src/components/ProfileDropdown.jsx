import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ChevronDown, User, BookOpen, Bell, KeyRound, Settings,
  LogOut, Shield, CheckCircle2, AlertTriangle, X
} from 'lucide-react';
import { useAuth } from '../auth';
import { Avatar, Modal } from '../ui';
import { ChangePasswordForm } from '../pages/Account';

const ROLE_DISPLAY = {
  hod: 'Head of Department',
  lecturer: 'Lecturer',
  class_rep: 'Class Representative',
  student: 'Student'
};

export default function ProfileDropdown({ unread = 0 }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const dropdownRef = useRef(null);

  const isStudent = profile?.role === 'student';

  // Toggle dropdown
  const toggle = () => setOpen(prev => !prev);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  // Close when pressing Escape key
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleNavigate = (path) => {
    setOpen(false);
    navigate(path);
  };

  const handleOpenPassword = () => {
    setOpen(false);
    setShowPasswordModal(true);
  };

  const handleOpenSignOut = () => {
    setOpen(false);
    setShowSignOutConfirm(true);
  };

  const executeSignOut = async () => {
    setShowSignOutConfirm(false);
    await signOut();
  };

  const initials = (profile?.full_name || 'U')
    .trim()
    .split(/\s+/)
    .map(p => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const formattedUserId = profile?.student_id
    ? (profile.student_id.startsWith('STU') ? profile.student_id : `STU-2025-${String(profile.student_id).padStart(4, '0')}`)
    : profile?.username || `ID: #${profile?.id?.slice(0, 8) || '0000'}`;

  const roleLabel = ROLE_DISPLAY[profile?.role] || profile?.role || 'Member';
  const roleSubtitle = isStudent
    ? (profile?.level ? `Level ${profile.level} Student` : 'Student')
    : roleLabel;

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Avatar & Trigger Button */}
      <button
        type="button"
        className="profile-trigger-btn flex items-center gap-2.5 p-1 rounded-full md:rounded-xl hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="User profile and settings menu"
      >
        {/* Avatar circle with initials or picture */}
        <div className="relative">
          <Avatar user={profile} size={36} className="ring-2 ring-primary/20 rounded-full" />
        </div>

        {/* Desktop User Name & Subtitle */}
        <div className="hidden md:flex flex-col text-left leading-tight pr-1">
          <span className="text-sm font-semibold text-slate-800 line-clamp-1 max-w-[130px]">
            {profile?.full_name || 'My Account'}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            {roleSubtitle}
          </span>
        </div>

        {/* Small dropdown chevron arrow beside avatar */}
        <ChevronDown
          size={15}
          className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-primary' : ''}`}
        />
      </button>

      {/* Floating Dropdown Panel */}
      {open && (
        <div
          className="profile-dropdown-panel absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden transform opacity-100 scale-100 transition-all origin-top-right animate-in fade-in-50 zoom-in-95 duration-150"
          style={{
            boxShadow: '0 12px 30px -4px rgba(16, 42, 67, 0.15), 0 4px 12px -2px rgba(16, 42, 67, 0.08)'
          }}
          role="menu"
          aria-orientation="vertical"
        >
          {/* 1. Profile Header */}
          <div className="p-4 bg-gradient-to-br from-slate-50 to-blue-50/40 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <Avatar user={profile} size={44} className="ring-2 ring-white shadow-sm" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-slate-800 truncate" title={profile?.full_name}>
                  {profile?.full_name}
                </h4>
                <p className="text-xs text-slate-500 font-mono font-medium truncate mt-0.5">
                  {formattedUserId}
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                    {roleLabel}
                  </span>
                  {profile?.programme && (
                    <span className="text-[10px] text-slate-500 font-medium truncate">
                      • {profile.programme}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 2. Menu Options */}
          <div className="py-1.5 text-slate-700">
            {/* My Profile */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-slate-50 hover:text-primary transition-colors group"
              onClick={() => handleNavigate('/account')}
              role="menuitem"
            >
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                <User size={16} />
              </div>
              <div className="flex-1 font-medium text-slate-800 group-hover:text-primary">
                My Profile
              </div>
            </button>

            {/* Academic Information (role-based: for students) */}
            {isStudent && (
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-slate-50 hover:text-primary transition-colors group"
                onClick={() => handleNavigate('/profile')}
                role="menuitem"
              >
                <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                  <BookOpen size={16} />
                </div>
                <div className="flex-1 font-medium text-slate-800 group-hover:text-primary">
                  Academic Information
                </div>
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">
                  {profile?.level ? `L${profile.level}` : 'Courses'}
                </span>
              </button>
            )}

            {/* Notifications */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-slate-50 hover:text-primary transition-colors group"
              onClick={() => handleNavigate('/notifications')}
              role="menuitem"
            >
              <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                <Bell size={16} />
              </div>
              <div className="flex-1 font-medium text-slate-800 group-hover:text-primary">
                Notifications
              </div>
              {unread > 0 && (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-red-500 rounded-full">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>

            {/* Change Password */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-slate-50 hover:text-primary transition-colors group"
              onClick={handleOpenPassword}
              role="menuitem"
            >
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                <KeyRound size={16} />
              </div>
              <div className="flex-1 font-medium text-slate-800 group-hover:text-primary">
                Change Password
              </div>
            </button>

            {/* Account Settings / Privacy */}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-slate-50 hover:text-primary transition-colors group"
              onClick={() => handleNavigate('/privacy')}
              role="menuitem"
            >
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                <Shield size={16} />
              </div>
              <div className="flex-1 font-medium text-slate-800 group-hover:text-primary">
                Account Settings & Privacy
              </div>
            </button>
          </div>

          {/* 3. Divider & Sign Out */}
          <div className="border-t border-slate-100 p-1.5 bg-slate-50/50">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl transition-colors font-medium group"
              onClick={handleOpenSignOut}
              role="menuitem"
            >
              <div className="p-1.5 rounded-lg bg-red-100/70 text-red-600 group-hover:bg-red-200/80 transition-colors">
                <LogOut size={16} />
              </div>
              <span className="font-semibold">Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Sign Out */}
      {showSignOutConfirm && (
        <Modal title="Sign Out Confirmation" onClose={() => setShowSignOutConfirm(false)}>
          <div className="p-1 text-slate-700">
            <div className="flex items-center gap-3.5 mb-4 p-3 bg-red-50 rounded-xl text-red-800 border border-red-100">
              <div className="p-2 bg-red-100 text-red-600 rounded-lg shrink-0">
                <LogOut size={22} />
              </div>
              <div>
                <h4 className="font-bold text-sm text-red-900">Disconnect Session?</h4>
                <p className="text-xs text-red-700 mt-0.5">
                  Are you sure you want to sign out of the Milton Margai CS Attendance System?
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Your offline attendance drafts and queued synchronizations are securely cached locally, but you will need to sign in again to mark live attendance or review department records.
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                onClick={() => setShowSignOutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
                onClick={executeSignOut}
              >
                <LogOut size={15} /> Yes, Sign Out
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <Modal title="Change Account Password" onClose={() => setShowPasswordModal(false)}>
          <div className="p-1">
            <p className="text-xs text-slate-500 mb-4">
              Enter your current password and choose a new, strong password with at least 8 characters.
            </p>
            <ChangePasswordForm onDone={() => setShowPasswordModal(false)} />
          </div>
        </Modal>
      )}
    </div>
  );
}
