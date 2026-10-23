import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Landmark, Monitor, Calendar, Layers, BookOpen, CheckCircle2,
  Clock, Award, ArrowRight, ChevronRight, Lock, Shield, LogOut,
  Zap, CalendarDays, ClipboardCheck, History, Bell, User, GraduationCap,
  Megaphone, MapPin, Users, ShieldAlert, RefreshCw, Settings, FileText
} from 'lucide-react';
import { useAuth } from '../auth';
import { apiFetch } from '../api';
import { Avatar, Modal } from '../ui';
import { ChangePasswordForm } from './Account';

const ROLE_LABELS = {
  hod: 'Head of Department',
  lecturer: 'Lecturer',
  class_rep: 'Class Representative',
  student: 'Student'
};

export default function More() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [unread, setUnread] = useState(0);
  const [announcementsCount, setAnnouncementsCount] = useState(0);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const role = profile?.role === 'rep' ? 'class_rep' : (profile?.role || 'student');
  const roleLabel = ROLE_LABELS[role] || 'Member';

  useEffect(() => {
    // Load student overview if student
    if (role === 'student') {
      apiFetch('/student/overview')
        .then(data => setOverview(data))
        .catch(() => {});
    }
    // Load unread notifications count
    apiFetch('/notifications/unread-count')
      .then(r => setUnread(r.count || 0))
      .catch(() => {});
    // Load announcements count
    apiFetch('/announcements')
      .then(r => setAnnouncementsCount(Array.isArray(r) ? r.length : 0))
      .catch(() => {});
  }, [role]);

  const academicYear = (overview?.year || profile?.academic_year || '2026/2027').replace(/\s*academic\s*year/i, '').trim();
  const semesterName = overview?.semester || (profile?.semester === 2 ? 'Second Semester' : 'First Semester');

  const handleSignOut = async () => {
    setShowSignOutConfirm(false);
    await signOut();
  };

  // Remaining Buttons for HOD (Not on footer: Home, Attendance, Reports, Modules, More)
  const hodButtons = [
    {
      to: '/announcements',
      label: 'Department Notices',
      desc: 'Publish and review notices, memos, and broadcasts',
      icon: Megaphone,
      badge: announcementsCount ? `${announcementsCount} Active` : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/lecturers',
      label: 'Lecturers Management',
      desc: 'View departmental lecturers, active courses, and credentials',
      icon: Users,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/reps',
      label: 'Class Representatives',
      desc: 'Manage class reps across programmes and study levels',
      icon: User,
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      to: '/students',
      label: 'Students Directory',
      desc: 'Browse student roster, account approvals, and enrollment',
      icon: Users,
      color: 'bg-indigo-50 text-indigo-600'
    },
    {
      to: '/venues',
      label: 'Lecture Halls & Venues',
      desc: 'Configure lecture halls, GPS coordinates, and geofence radius',
      icon: MapPin,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/students-at-risk',
      label: 'Students At Risk',
      desc: 'Identify students below the 75% attendance threshold',
      icon: ShieldAlert,
      color: 'bg-rose-50 text-rose-600'
    },
    {
      to: '/rollover',
      label: 'Academic Year Rollover',
      desc: 'Advance academic session, promote levels, and rollover terms',
      icon: RefreshCw,
      color: 'bg-teal-50 text-teal-600'
    },
    {
      to: '/academic',
      label: 'Academic Setup & Policies',
      desc: 'Department terms, semester settings, and minimum attendance %',
      icon: Settings,
      color: 'bg-slate-100 text-slate-700'
    },
    {
      to: '/notifications',
      label: 'Notifications Center',
      desc: 'System alerts, attendance reminders, and announcements',
      icon: Bell,
      badge: unread > 0 ? `${unread} Unread` : null,
      color: 'bg-emerald-50 text-emerald-600'
    }
  ];

  // Remaining Buttons for Lecturer (Not on footer: Home, Sessions, Approvals, Modules, More)
  const lecturerButtons = [
    {
      to: '/announcements',
      label: 'Department Notices',
      desc: 'Read departmental announcements, memos, and updates',
      icon: Megaphone,
      badge: announcementsCount ? `${announcementsCount} Active` : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/reports',
      label: 'Reports & Export',
      desc: 'Export course attendance summaries, spreadsheets, and percentages',
      icon: FileText,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/students-at-risk',
      label: 'Students At Risk',
      desc: 'Monitor students at risk of attendance debarment',
      icon: ShieldAlert,
      color: 'bg-rose-50 text-rose-600'
    },
    {
      to: '/venues',
      label: 'Lecture Halls & GPS',
      desc: 'Check room locations, campus buildings, and GPS radius',
      icon: MapPin,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/notifications',
      label: 'Notifications Center',
      desc: 'Class alerts, attendance reminders, and department updates',
      icon: Bell,
      badge: unread > 0 ? `${unread} Unread` : null,
      color: 'bg-emerald-50 text-emerald-600'
    }
  ];

  // Remaining Buttons for Class Rep (Not on footer: Home, Timetable, Students, Modules, More)
  const repButtons = [
    {
      to: '/announcements',
      label: 'Department Notices',
      desc: 'Department broadcasts, class memos, and official notices',
      icon: Megaphone,
      badge: announcementsCount ? `${announcementsCount} Active` : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/attendance',
      label: 'Class Attendance Live',
      desc: 'Monitor live check-in statuses and marked attendance',
      icon: ClipboardCheck,
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      to: '/reports',
      label: 'Class Attendance Reports',
      desc: 'Download and export attendance records for your class',
      icon: FileText,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/venues',
      label: 'Class Venues & GPS',
      desc: 'View assigned lecture halls and GPS coordinates',
      icon: MapPin,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/notifications',
      label: 'Notifications Center',
      desc: 'Class notices, lecture alerts, and attendance approvals',
      icon: Bell,
      badge: unread > 0 ? `${unread} Unread` : null,
      color: 'bg-amber-50 text-amber-600'
    }
  ];

  // Remaining Buttons for Student (Not on footer: Home, Timetable, Attendance, Modules, More)
  const studentButtons = [
    {
      to: '/announcements',
      label: 'Department Notices',
      desc: 'Official departmental notices, schedule changes, and memos',
      icon: Megaphone,
      badge: announcementsCount ? `${announcementsCount} Active` : null,
      color: 'bg-amber-50 text-amber-600'
    },
    {
      to: '/history',
      label: 'Attendance History',
      desc: 'Complete log of your verified attendance records and sessions',
      icon: History,
      color: 'bg-purple-50 text-purple-600'
    },
    {
      to: '/venues',
      label: 'Lecture Halls & GPS',
      desc: 'Classroom buildings, halls, and GPS geofence radius',
      icon: MapPin,
      color: 'bg-blue-50 text-blue-600'
    },
    {
      to: '/notifications',
      label: 'Notifications Center',
      desc: 'Class alerts, attendance reminders, and system updates',
      icon: Bell,
      badge: unread > 0 ? `${unread} Unread` : null,
      color: 'bg-emerald-50 text-emerald-600'
    }
  ];

  const remainingButtons = role === 'hod'
    ? hodButtons
    : role === 'lecturer'
    ? lecturerButtons
    : role === 'class_rep'
    ? repButtons
    : studentButtons;

  return (
    <div className="dept-hub-wrapper max-w-5xl mx-auto px-2 sm:px-4 py-4 space-y-5">
      {/* 1. Breadcrumbs (Desktop Only) */}
      <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 font-medium">
        <Link to="/" className="text-primary no-underline hover:underline">Home</Link>
        <span>›</span>
        <span className="text-slate-800 font-semibold">More Features</span>
      </div>

      {/* 2. User Profile Summary Banner (Desktop Only) */}
      <div className="hidden md:flex bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-xs flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Avatar user={profile} size={56} className="ring-2 ring-primary/20 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight truncate">
                {profile?.full_name}
              </h2>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                role === 'hod' ? 'bg-purple-100 text-purple-700' :
                role === 'lecturer' ? 'bg-blue-100 text-blue-700' :
                role === 'class_rep' ? 'bg-emerald-100 text-emerald-700' :
                'bg-slate-100 text-slate-700'
              }`}>
                {roleLabel}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {profile?.student_id ? `Student ID: ${profile.student_id}` : profile?.username || 'Milton Margai CS Department'}
            </p>
          </div>
        </div>

        {/* Top-Right Department & Term Badges */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700">
            <Calendar size={13} className="text-primary" />
            <span>{academicYear}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700">
            <Layers size={13} className="text-primary" />
            <span>{semesterName}</span>
          </div>
        </div>
      </div>

      {/* 3. All Remaining Department Buttons & Tools */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Department Tools & Features</h3>
            <p className="text-xs text-slate-500">Access all remaining features and management tools.</p>
          </div>
          <span className="text-xs font-bold text-slate-400">
            {remainingButtons.length} Options
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {remainingButtons.map((btn) => {
            const Icon = btn.icon;
            return (
              <Link
                key={btn.to}
                to={btn.to}
                className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between group active:scale-[0.99] no-underline"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className={`p-3 rounded-xl ${btn.color} shrink-0 group-hover:scale-105 transition-transform`}>
                    <Icon size={20} />
                  </div>
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors truncate no-underline">
                        {btn.label}
                      </h4>
                      {btn.badge && (
                        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500 text-white rounded-md shrink-0">
                          {btn.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1 no-underline">
                      {btn.desc}
                    </p>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-1" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* 4. Account & Security Section */}
      <div className="space-y-3 pt-2">
        <div className="px-1">
          <h3 className="font-bold text-slate-900 text-sm sm:text-base">Account & Security</h3>
          <p className="text-xs text-slate-500">Manage your profile, credentials, and privacy terms.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Profile & Avatar */}
          <Link
            to="/account"
            className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between group no-underline"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-blue-50 text-primary group-hover:scale-105 transition-transform">
                <User size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors no-underline">
                  My Profile & Avatar
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 no-underline">
                  Update profile photo and review your personal details.
                </p>
              </div>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-1" />
          </Link>

          {/* Change Password Modal Trigger */}
          <button
            type="button"
            onClick={() => setShowPasswordModal(true)}
            className="w-full text-left bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between group cursor-pointer no-underline"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-slate-100 text-slate-700 group-hover:scale-105 transition-transform">
                <Lock size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors no-underline">
                  Security & Password
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 no-underline">
                  Change your password and protect your credentials.
                </p>
              </div>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-1" />
          </button>

          {/* Privacy Notice */}
          <Link
            to="/privacy"
            className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between group no-underline"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 group-hover:scale-105 transition-transform">
                <Shield size={20} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors no-underline">
                  Privacy & Geolocation Policy
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 no-underline">
                  Read how student location is securely verified.
                </p>
              </div>
            </div>
            <ChevronRight size={18} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-1" />
          </Link>

          {/* Sign Out Card */}
          <button
            type="button"
            onClick={() => setShowSignOutConfirm(true)}
            className="w-full text-left bg-red-50/60 hover:bg-red-50 rounded-2xl p-4 border border-red-200/80 shadow-2xs hover:shadow-md transition-all flex items-center justify-between group cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-red-100 text-red-600 group-hover:scale-105 transition-transform">
                <LogOut size={20} />
              </div>
              <div>
                <h4 className="font-bold text-red-900 text-sm">
                  Sign Out of CS Portal
                </h4>
                <p className="text-xs text-red-700 mt-0.5">
                  Disconnect your account securely from this device.
                </p>
              </div>
            </div>
            <ChevronRight size={18} className="text-red-400 group-hover:translate-x-1 group-hover:text-red-600 transition-all shrink-0 ml-1" />
          </button>
        </div>
      </div>

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
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                onClick={() => setShowSignOutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                onClick={handleSignOut}
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
