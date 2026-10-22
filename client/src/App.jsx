import { useState } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import {
  Home, CalendarDays, ClipboardCheck, History, User, BookOpen,
  Users, FileText, Settings, Upload, Megaphone, MoreHorizontal,
  MapPin, RefreshCw, ShieldAlert, Shield
} from 'lucide-react';
import { useAuth } from './auth';
import Shell from './Shell';
import SplashScreen from './components/SplashScreen';
import Login from './pages/Login';
import Register from './pages/Register';
import Account, { ForcedPasswordChange } from './pages/Account';
import Notifications from './pages/Notifications';
import Venues from './pages/Venues';
import Announcements from './pages/Announcements';
import StudentsAtRisk from './pages/StudentsAtRisk';
import HodRollover from './pages/HodRollover';
import Privacy from './pages/Privacy';
import More from './pages/More';
import { Loading } from './ui';

// Student components
import { StudentHome, StudentTimetable, StudentAttendance, StudentHistory, StudentProfile } from './pages/student';

// Lecturer components
import { LecturerHome, LecturerCourses, LecturerSessions, LecturerApprovals, LecturerReports } from './pages/lecturer';

// Class Rep components
import { RepHome, RepTimetable, RepStudents, RepAttendance } from './pages/rep';

// HOD components
import { HodHome, HodStaff, HodStudents, HodAttendance, HodReports, HodAcademic } from './pages/hod';
import HodModules from './pages/HodModules';

// ------------------------------------------------------------------ NAVIGATION DEFINITIONS
// Mobile bottom bar tabs (5 key items per role)
const NAV_CONFIG = {
  student: [
    { label: 'Home', icon: Home, to: '/' },
    { label: 'Timetable', icon: CalendarDays, to: '/timetable' },
    { label: 'Attendance', icon: ClipboardCheck, to: '/attendance' },
    { label: 'Notices', icon: Megaphone, to: '/announcements' },
    { label: 'More', icon: MoreHorizontal, to: '/more' }
  ],
  lecturer: [
    { label: 'Home', icon: Home, to: '/' },
    { label: 'Sessions', icon: CalendarDays, to: '/sessions' },
    { label: 'Approvals', icon: ClipboardCheck, to: '/approvals' },
    { label: 'Notices', icon: Megaphone, to: '/announcements' },
    { label: 'More', icon: MoreHorizontal, to: '/more' }
  ],
  class_rep: [
    { label: 'Home', icon: Home, to: '/' },
    { label: 'Timetable', icon: CalendarDays, to: '/timetable' },
    { label: 'Students', icon: Users, to: '/students' },
    { label: 'Notices', icon: Megaphone, to: '/announcements' },
    { label: 'More', icon: MoreHorizontal, to: '/more' }
  ],
  hod: [
    { label: 'Home', icon: Home, to: '/' },
    { label: 'Notices', icon: Megaphone, to: '/announcements' },
    { label: 'Attendance', icon: ClipboardCheck, to: '/attendance' },
    { label: 'Reports', icon: FileText, to: '/reports' },
    { label: 'More', icon: MoreHorizontal, to: '/more' }
  ]
};

// Desktop Website Sidebar Navigation (Grouped sections)
const SIDEBAR_CONFIG = {
  student: [
    {
      group: 'Academics',
      items: [
        { label: 'Dashboard', icon: Home, to: '/' },
        { label: 'Weekly Timetable', icon: CalendarDays, to: '/timetable' },
        { label: 'Mark Attendance', icon: ClipboardCheck, to: '/attendance' },
        { label: 'Attendance History', icon: History, to: '/history' }
      ]
    },
    {
      group: 'Campus & Notices',
      items: [
        { label: 'Department Notices', icon: Megaphone, to: '/announcements' },
        { label: 'My Registered Modules', icon: BookOpen, to: '/profile' },
        { label: 'Lecture Halls & GPS', icon: MapPin, to: '/venues' },
        { label: 'Department Hub', icon: MoreHorizontal, to: '/more' }
      ]
    },
    {
      group: 'Account',
      items: [
        { label: 'My Profile & Avatar', icon: User, to: '/account' },
        { label: 'Privacy & Location', icon: Shield, to: '/privacy' }
      ]
    }
  ],
  lecturer: [
    {
      group: 'Lectures & Sessions',
      items: [
        { label: 'Dashboard', icon: Home, to: '/' },
        { label: 'Class Sessions', icon: CalendarDays, to: '/sessions' },
        { label: 'Attendance Approvals', icon: ClipboardCheck, to: '/approvals' },
        { label: 'Assigned Courses', icon: BookOpen, to: '/courses' }
      ]
    },
    {
      group: 'Reports & Notices',
      items: [
        { label: 'Department Notices', icon: Megaphone, to: '/announcements' },
        { label: 'Students At Risk', icon: ShieldAlert, to: '/students-at-risk' },
        { label: 'Lecture Venues', icon: MapPin, to: '/venues' },
        { label: 'Reports & Export', icon: FileText, to: '/reports' },
        { label: 'Department Hub', icon: MoreHorizontal, to: '/more' }
      ]
    },
    {
      group: 'Account',
      items: [
        { label: 'My Account & Avatar', icon: User, to: '/account' },
        { label: 'Privacy Policy', icon: Shield, to: '/privacy' }
      ]
    }
  ],
  class_rep: [
    {
      group: 'Class Management',
      items: [
        { label: 'Dashboard', icon: Home, to: '/' },
        { label: 'Class Timetable', icon: CalendarDays, to: '/timetable' },
        { label: 'Class Students', icon: Users, to: '/students' },
        { label: 'Class Attendance', icon: ClipboardCheck, to: '/attendance' },
        { label: 'Reports & Export', icon: FileText, to: '/reports' }
      ]
    },
    {
      group: 'Campus & Notices',
      items: [
        { label: 'Department Notices', icon: Megaphone, to: '/announcements' },
        { label: 'Class Venues & GPS', icon: MapPin, to: '/venues' },
        { label: 'Department Hub', icon: MoreHorizontal, to: '/more' }
      ]
    },
    {
      group: 'Account',
      items: [
        { label: 'My Account & Avatar', icon: User, to: '/account' },
        { label: 'Privacy Notice', icon: Shield, to: '/privacy' }
      ]
    }
  ],
  hod: [
    {
      group: 'Overview',
      items: [
        { label: 'Department Dashboard', icon: Home, to: '/' },
        { label: 'Department Notices', icon: Megaphone, to: '/announcements' },
        { label: 'Attendance Live', icon: ClipboardCheck, to: '/attendance' },
        { label: 'Reports & Export', icon: FileText, to: '/reports' }
      ]
    },
    {
      group: 'People & Modules',
      items: [
        { label: 'Lecturers', icon: Users, to: '/lecturers' },
        { label: 'Class Representatives', icon: User, to: '/reps' },
        { label: 'Students Directory', icon: Users, to: '/students' },
        { label: 'Modules Management', icon: BookOpen, to: '/modules' },
        { label: 'Venues & GPS Radius', icon: MapPin, to: '/venues' }
      ]
    },
    {
      group: 'Academic Administration',
      items: [
        { label: 'Students At Risk', icon: ShieldAlert, to: '/students-at-risk' },
        { label: 'Academic Year Rollover', icon: RefreshCw, to: '/rollover' },
        { label: 'Academic Setup', icon: Settings, to: '/academic' },
        { label: 'Department Hub', icon: MoreHorizontal, to: '/more' }
      ]
    },
    {
      group: 'Account',
      items: [
        { label: 'My Profile & Avatar', icon: User, to: '/account' },
        { label: 'Privacy & Security', icon: Shield, to: '/privacy' }
      ]
    }
  ]
};

const TITLES = {
  '/': 'Home',
  '/modules': 'Department Modules',
  '/timetable': 'Class Timetable',
  '/attendance': 'Attendance',
  '/history': 'Attendance History',
  '/profile': 'My Registered Modules',
  '/registered-modules': 'My Registered Modules',
  '/courses': 'My Courses',
  '/sessions': 'Class Sessions',
  '/approvals': 'Attendance Approvals',
  '/reports': 'Reports & Export',
  '/students': 'Students',
  '/lecturers': 'Lecturers Management',
  '/reps': 'Class Representatives',
  '/academic': 'Academic Setup',
  '/account': 'My Account',
  '/notifications': 'Notifications',
  '/venues': 'Lecture Halls & Venues',
  '/announcements': 'Department Notices',
  '/students-at-risk': 'Students At Risk',
  '/rollover': 'Academic Year & Rollover',
  '/privacy': 'Privacy & Location Policy',
  '/more': 'Department Hub'
};

export default function App() {
  const { profile, loading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} minDuration={2000} />;
  }

  if (loading) {
    return <Loading text="Loading CS Attendance System…" />;
  }

  // Not signed in
  if (!profile) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Forced password change for first-time staff / reset passwords
  if (profile.must_change_password) {
    return <ForcedPasswordChange />;
  }

  const roleKey = profile.role === 'rep' ? 'class_rep' : profile.role;
  const roleNav = NAV_CONFIG[roleKey] || NAV_CONFIG.student;
  const roleSidebar = SIDEBAR_CONFIG[roleKey] || SIDEBAR_CONFIG.student;

  return (
    <Shell mobileNav={roleNav} sidebarNav={roleSidebar} titles={TITLES}>
      <Routes>
        {/* Student Routes */}
        {profile.role === 'student' && (
          <>
            <Route path="/" element={<StudentHome />} />
            <Route path="/timetable" element={<StudentTimetable />} />
            <Route path="/attendance" element={<StudentAttendance />} />
            <Route path="/history" element={<StudentHistory />} />
            <Route path="/profile" element={<StudentProfile />} />
            <Route path="/registered-modules" element={<StudentProfile />} />
          </>
        )}

        {/* Lecturer Routes */}
        {profile.role === 'lecturer' && (
          <>
            <Route path="/" element={<LecturerHome />} />
            <Route path="/courses" element={<LecturerCourses />} />
            <Route path="/sessions" element={<LecturerSessions />} />
            <Route path="/approvals" element={<LecturerApprovals />} />
            <Route path="/reports" element={<LecturerReports />} />
          </>
        )}

        {/* Class Representative Routes */}
        {(profile.role === 'class_rep' || profile.role === 'rep') && (
          <>
            <Route path="/" element={<RepHome />} />
            <Route path="/timetable" element={<RepTimetable />} />
            <Route path="/students" element={<RepStudents />} />
            <Route path="/attendance" element={<RepAttendance />} />
            <Route path="/reports" element={<LecturerReports />} />
            <Route path="/profile" element={<Account />} />
          </>
        )}

        {/* HOD Routes */}
        {profile.role === 'hod' && (
          <>
            <Route path="/" element={<HodHome />} />
            <Route path="/modules" element={<HodModules />} />
            <Route path="/lecturers" element={<HodStaff targetRole="lecturer" />} />
            <Route path="/reps" element={<HodStaff targetRole="class_rep" />} />
            <Route path="/students" element={<HodStudents />} />
            <Route path="/attendance" element={<HodAttendance />} />
            <Route path="/reports" element={<HodReports />} />
            <Route path="/academic" element={<HodAcademic />} />
            <Route path="/rollover" element={<HodRollover />} />
          </>
        )}

        {/* Shared Routes */}
        <Route path="/venues" element={<Venues />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/students-at-risk" element={<StudentsAtRisk />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/more" element={<More />} />
        <Route path="/account" element={<Account />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
