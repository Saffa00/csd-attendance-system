import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Landmark, Monitor, Calendar, Layers, BookOpen, CheckCircle2,
  Clock, Award, ArrowRight, ChevronRight, Lock, Shield, LogOut,
  Zap, CalendarDays, ClipboardCheck, History, Bell, User, GraduationCap
} from 'lucide-react';
import { useAuth } from '../auth';
import { apiFetch } from '../api';
import { Modal } from '../ui';
import { ChangePasswordForm } from './Account';

export default function More() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [unread, setUnread] = useState(0);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    // Load student overview if student
    if (profile?.role === 'student') {
      apiFetch('/student/overview')
        .then(data => setOverview(data))
        .catch(() => {});
    }
    // Load unread notifications
    apiFetch('/notifications/unread-count')
      .then(r => setUnread(r.count || 0))
      .catch(() => {});
  }, [profile]);

  const academicYear = (overview?.year || profile?.academic_year || '2026/2027').replace(/\s*academic\s*year/i, '').trim();
  const semesterName = overview?.semester || (profile?.semester === 2 ? 'Second Semester' : 'First Semester');
  const modulesCount = overview?.courses || 5;
  const attendanceRate = overview?.attendance?.rate ?? 89;
  const classesAttended = overview?.attendance?.approved ?? 18;
  const totalClasses = overview?.attendance?.total || 20;

  const handleSignOut = async () => {
    setShowSignOutConfirm(false);
    await signOut();
  };

  return (
    <div className="dept-hub-wrapper max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-6">
      {/* 1. Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
        <Link to="/" className="text-primary hover:underline">Home</Link>
        <span>›</span>
        <span className="text-slate-800 font-semibold">Department Hub</span>
      </div>

      {/* 2. Welcome Header Banner */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-blue-50 text-primary border border-blue-100 shrink-0">
            <Landmark size={28} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Welcome to Your Department Hub
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Access your academic records, manage your modules, attendance and more — all in one place.
            </p>
          </div>
        </div>

        {/* Top-Right Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700">
            <Monitor size={15} className="text-primary" />
            <span>Department: <strong className="text-slate-900">Computer Science</strong></span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700">
            <Calendar size={15} className="text-primary" />
            <span>Academic Year: <strong className="text-slate-900">{academicYear}</strong></span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-700">
            <Layers size={15} className="text-primary" />
            <span>Semester: <strong className="text-slate-900">{semesterName}</strong></span>
          </div>
        </div>
      </div>

      {/* 3. Four Metric Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Registered Modules */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between group hover:shadow-md transition">
          <div>
            <div className="p-2.5 rounded-xl bg-blue-50 text-primary w-fit mb-3">
              <BookOpen size={20} />
            </div>
            <span className="text-xs text-slate-500 font-medium">Registered Modules</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{modulesCount}</div>
          </div>
          <Link
            to="/profile"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 mt-3 group-hover:translate-x-0.5 transition-transform"
          >
            <span>View Modules</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Total Attendance Rate */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between group hover:shadow-md transition">
          <div>
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 w-fit mb-3">
              <CalendarDays size={20} />
            </div>
            <span className="text-xs text-slate-500 font-medium">Total Attendance Rate</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{attendanceRate}%</div>
          </div>
          <Link
            to="/attendance"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 mt-3 group-hover:translate-x-0.5 transition-transform"
          >
            <span>View Attendance</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Classes Attended */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between group hover:shadow-md transition">
          <div>
            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 w-fit mb-3">
              <Clock size={20} />
            </div>
            <span className="text-xs text-slate-500 font-medium">Classes Attended</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{classesAttended} / {totalClasses}</div>
          </div>
          <Link
            to="/history"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 mt-3 group-hover:translate-x-0.5 transition-transform"
          >
            <span>View History</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Current GPA */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between group hover:shadow-md transition">
          <div>
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 w-fit mb-3">
              <GraduationCap size={20} />
            </div>
            <span className="text-xs text-slate-500 font-medium">Current GPA</span>
            <div className="text-2xl font-black text-slate-900 mt-1">3.42</div>
          </div>
          <Link
            to="/venues"
            className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 mt-3 group-hover:translate-x-0.5 transition-transform"
          >
            <span>View GPA</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* 4. Main Two-Column Hub Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Academic Records & Account & Legal */}
        <div className="lg:col-span-8 space-y-6">
          {/* Section: Academic Records */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100/60 text-primary">
                <BookOpen size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Academic Records</h3>
                <p className="text-[11px] text-slate-500">View your complete academic information and progress.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <Link
                to="/history"
                className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                    <BookOpen size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors">
                      Attendance History
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      View your complete log of marked attendances.
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-2" />
              </Link>

              <Link
                to="/profile"
                className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                    <User size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors">
                      My Profile & Modules
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Your enrolled modules and student details.
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-2" />
              </Link>
            </div>
          </div>

          {/* Section: Account & Legal */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-100/60 text-primary">
                <Shield size={16} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Account & Legal</h3>
                <p className="text-[11px] text-slate-500">Manage your account and important information.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => setShowPasswordModal(true)}
                className="w-full text-left bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600 group-hover:bg-primary group-hover:text-white transition-colors">
                    <Lock size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors">
                      Security & Password
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Change your account password.
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-2" />
              </button>

              <Link
                to="/privacy"
                className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-50 text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                    <Shield size={18} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors">
                      Privacy Notice & GPS Policy
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Geolocation protection and data retention.
                    </p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400 group-hover:translate-x-1 group-hover:text-primary transition-all shrink-0 ml-2" />
              </Link>
            </div>

            {/* Sign Out Card */}
            <button
              type="button"
              onClick={() => setShowSignOutConfirm(true)}
              className="w-full text-left bg-gradient-to-r from-red-50/70 to-red-100/30 rounded-2xl p-4 border border-red-200/80 shadow-sm hover:bg-red-50 hover:shadow-md transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-red-100 text-red-600 group-hover:bg-red-200 transition-colors">
                  <LogOut size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-red-900 text-sm">
                    Sign Out
                  </h4>
                  <p className="text-xs text-red-700 mt-0.5">
                    Disconnect your account securely from this device.
                  </p>
                </div>
              </div>
              <ChevronRight size={18} className="text-red-400 group-hover:translate-x-1 group-hover:text-red-600 transition-all shrink-0 ml-2" />
            </button>
          </div>
        </div>

        {/* Right Column (4 cols): Quick Access & Motivation Card */}
        <div className="lg:col-span-4 space-y-4">
          {/* Quick Access Card */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
              <Zap size={16} className="text-primary fill-primary" />
              <h3 className="font-bold text-slate-900 text-sm">Quick Access</h3>
            </div>

            <div className="space-y-1">
              <Link
                to="/profile"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                    <BookOpen size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 group-hover:text-primary transition-colors">
                      View Registered Modules
                    </h5>
                    <span className="text-[11px] text-slate-500">Check your enrolled courses</span>
                  </div>
                </div>
                <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
              </Link>

              <Link
                to="/attendance"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                    <ClipboardCheck size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 group-hover:text-primary transition-colors">
                      Mark Attendance
                    </h5>
                    <span className="text-[11px] text-slate-500">Submit your attendance</span>
                  </div>
                </div>
                <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
              </Link>

              <Link
                to="/timetable"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                    <CalendarDays size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 group-hover:text-primary transition-colors">
                      Today's Timetable
                    </h5>
                    <span className="text-[11px] text-slate-500">View your classes for today</span>
                  </div>
                </div>
                <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
              </Link>

              <Link
                to="/history"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                    <History size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 group-hover:text-primary transition-colors">
                      My Attendance
                    </h5>
                    <span className="text-[11px] text-slate-500">Check your attendance records</span>
                  </div>
                </div>
                <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
              </Link>

              <Link
                to="/notifications"
                className="flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-50 text-amber-600 relative">
                    <Bell size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-slate-800 group-hover:text-primary transition-colors">
                      View Notifications
                    </h5>
                    <span className="text-[11px] text-slate-500">Latest updates and alerts</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {unread > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full">
                      {unread}
                    </span>
                  )}
                  <ChevronRight size={15} className="text-slate-400 group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
                </div>
              </Link>
            </div>
          </div>

          {/* Motivational "Keep Going!" Box */}
          <div className="bg-gradient-to-br from-blue-50/70 to-indigo-50/40 rounded-2xl p-5 border border-blue-100 flex items-center justify-between gap-4">
            <div>
              <h4 className="font-bold text-slate-900 text-sm mb-1">Keep Going!</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your academic journey is important. Stay consistent, attend your classes and achieve your goals.
              </p>
              <div className="w-12 h-0.5 bg-primary rounded-full mt-3"></div>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-blue-100 flex items-center justify-center shrink-0 text-primary">
              <GraduationCap size={28} />
            </div>
          </div>
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
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                onClick={() => setShowSignOutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
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
