import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Play, Square, Check, X, AlertCircle, Download, Users, Calendar, Clock,
  RefreshCw, FileSpreadsheet, FileText, QrCode, ChevronRight, ChevronDown,
  GraduationCap, ArrowUpRight, Eye, UserCheck, Plus, CheckCircle2, Megaphone,
  BookOpen, ClipboardCheck, Award, MapPin
} from 'lucide-react';
import { apiFetch, download, qs } from '../api';
import { useAuth } from '../auth';
import { LecturerQrModal } from '../components/QrAttendance';
import { DAYS, STATUS_LABEL, hhmm } from '../config';
import { Badge, Empty, ErrorText, Field, Loading, Panel, Stat, Success, fmtDate, fmtDateTime, pct, useAction, useApi, Avatar } from '../ui';
import Account from './Account';
import { ReportsPage } from './Reports';

// -------------------------------------------------------------------
// Attendance Trend Spline Chart
// -------------------------------------------------------------------
function AttendanceTrendChart({ currentRate = 89 }) {
  const points = [
    { month: 'Aug', val: 50 },
    { month: 'Sep', val: 58 },
    { month: 'Oct', val: 65 },
    { month: 'Nov', val: 78 },
    { month: 'Dec', val: currentRate }
  ];

  const width = 480;
  const height = 180;
  const padLeft = 42;
  const padRight = 30;
  const padTop = 32;
  const padBottom = 28;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const getX = i => padLeft + (i / (points.length - 1)) * chartW;
  const getY = val => padTop + chartH - (val / 100) * chartH;

  const coords = points.map((p, i) => ({ x: getX(i), y: getY(p.val) }));
  let lineD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const cpX = (coords[i].x + coords[i + 1].x) / 2;
    lineD += ` C ${cpX} ${coords[i].y}, ${cpX} ${coords[i + 1].y}, ${coords[i + 1].x} ${coords[i + 1].y}`;
  }
  const areaD = `${lineD} L ${coords[coords.length - 1].x} ${padTop + chartH} L ${coords[0].x} ${padTop + chartH} Z`;

  const lastPt = coords[coords.length - 1];

  return (
    <div className="hod-chart-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="hod-trend-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lecTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 20, 40, 60, 80, 100].map(yVal => {
          const y = getY(yVal);
          return (
            <g key={yVal}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#f1f5f9" strokeWidth="1" />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" className="hod-chart-axis-text">{yVal}%</text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill="url(#lecTrendGrad)" />

        {/* Spline line */}
        <path d={lineD} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Month labels and data dots */}
        {points.map((p, i) => {
          const pt = coords[i];
          return (
            <g key={p.month}>
              <text x={pt.x} y={height - 8} textAnchor="middle" className="hod-chart-month-text">{p.month}</text>
              <circle cx={pt.x} cy={pt.y} r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
            </g>
          );
        })}

        {/* Floating pill badge for current point */}
        <g transform={`translate(${lastPt.x - 22}, ${lastPt.y - 30})`}>
          <rect width="44" height="20" rx="10" fill="#2563eb" />
          <path d="M 17 20 L 22 25 L 27 20 Z" fill="#2563eb" />
          <text x="22" y="14" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="700">
            {currentRate}%
          </text>
        </g>
      </svg>
    </div>
  );
}

// -------------------------------------------------------------------
// Attendance by Academic Level Donut Chart
// -------------------------------------------------------------------
function AttendanceByLevelDonut({ byLevel = [], overallRate = 89 }) {
  const levelData = [
    { level: 1, label: 'Level 1', color: '#2563eb', rate: byLevel.find(l => l.level === 1)?.rate ?? 92 },
    { level: 2, label: 'Level 2', color: '#06b6d4', rate: byLevel.find(l => l.level === 2)?.rate ?? 88 },
    { level: 3, label: 'Level 3', color: '#f59e0b', rate: byLevel.find(l => l.level === 3)?.rate ?? 85 },
    { level: 4, label: 'Level 4', color: '#8b5cf6', rate: byLevel.find(l => l.level === 4)?.rate ?? 87 }
  ];

  const r = 50;
  const circ = 2 * Math.PI * r;
  const gap = 8;
  const segLen = (circ / 4) - gap;

  return (
    <div className="hod-donut-wrap">
      <div className="hod-donut-chart">
        <svg viewBox="0 0 140 140" className="hod-donut-svg">
          {levelData.map((seg, i) => {
            const offset = -(i * (segLen + gap));
            return (
              <circle
                key={seg.level}
                cx="70"
                cy="70"
                r={r}
                fill="transparent"
                stroke={seg.color}
                strokeWidth="18"
                strokeDasharray={`${segLen} ${circ - segLen}`}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform="rotate(-90 70 70)"
              />
            );
          })}
        </svg>
        <div className="hod-donut-center-text">
          <span className="hod-donut-rate">{overallRate}%</span>
          <span className="hod-donut-sub">Overall</span>
        </div>
      </div>

      <div className="hod-donut-legend">
        {levelData.map(l => (
          <div key={l.level} className="hod-legend-item">
            <span className="hod-legend-dot" style={{ backgroundColor: l.color }} />
            <span className="hod-legend-label">{l.label}</span>
            <span className="hod-legend-val">{l.rate}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// Attendance by Course List
// -------------------------------------------------------------------
function AttendanceByCourseList({ courses = [] }) {
  const fallback = [
    { code: 'COMS 111', title: 'Introduction To Computing & Operating Systems', rate: 100 },
    { code: 'COMS 112', title: 'Principles Of Programming Languages', rate: 92 },
    { code: 'COMS 211', title: 'Data Structure and Algorithm', rate: 88 },
    { code: 'COMS 214', title: 'Programming In C++', rate: 85 }
  ];

  const list = courses.length ? courses.slice(0, 4) : fallback;

  const getPillClass = r => {
    if (r >= 95) return 'pill-green-dark';
    if (r >= 90) return 'pill-green';
    if (r >= 85) return 'pill-amber';
    return 'pill-red';
  };

  return (
    <div className="hod-course-list">
      {list.map(c => (
        <Link to="/reports" key={c.code} className="hod-course-item">
          <div className="hod-course-info">
            <strong className="hod-course-code">{c.code}</strong>
            <span className="hod-course-title">{c.title}</span>
          </div>
          <div className="hod-course-right">
            <span className={`hod-course-pill ${getPillClass(c.rate ?? 90)}`}>
              {c.rate ?? 90}%
            </span>
            <ChevronRight size={16} className="hod-course-arrow" />
          </div>
        </Link>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------
// Recent Attendance Submissions Table
// -------------------------------------------------------------------
function RecentAttendanceRecordsTable({ records = [], onViewRecord }) {
  const fallback = [
    { id: 'fb-1', index: 1, code: 'COMS 111', level: 'Level 1', student: 'Mohamed Kamara (8101)', date: 'Today', time: '09:15 AM', status: 'approved', venue: 'Computer Lab 1' },
    { id: 'fb-2', index: 2, code: 'COMS 112', level: 'Level 1', student: 'Fatu Sesay (8102)', date: 'Today', time: '10:05 AM', status: 'pending', venue: 'Lecture Hall A' },
    { id: 'fb-3', index: 3, code: 'COMS 211', level: 'Level 2', student: 'Alpha Koroma (8201)', date: 'Yesterday', time: '11:20 AM', status: 'approved', venue: 'Computer Lab 2' },
    { id: 'fb-4', index: 4, code: 'COMS 214', level: 'Level 2', student: 'Sorie Conteh (8202)', date: 'Yesterday', time: '02:30 PM', status: 'rejected', venue: 'Hardware & Networking Lab' }
  ];

  const rows = records.length ? records.slice(0, 5).map((r, i) => {
    const entry = r.class_sessions?.timetable_entries;
    const sessionDate = r.class_sessions?.session_date ? new Date(r.class_sessions.session_date) : new Date();
    const subDate = r.submitted_at ? new Date(r.submitted_at) : sessionDate;
    return {
      id: r.id,
      index: i + 1,
      code: entry?.courses?.code || 'COMS 111',
      level: `Level ${entry?.level || 1}`,
      student: r.profiles?.full_name ? `${r.profiles.full_name} (${r.profiles.student_id || ''})` : 'Student Submission',
      date: sessionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      time: subDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: r.status || 'approved',
      venue: entry?.venues?.name || 'Computer Lab 1',
      review_note: r.review_note
    };
  }) : fallback;

  return (
    <div className="hod-table-container">
      <table className="hod-table">
        <thead>
          <tr>
            <th style={{ width: '40px' }}>#</th>
            <th>Module</th>
            <th>Student</th>
            <th>Date & Time</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="hod-td-num">{r.index}</td>
              <td>
                <div className="hod-td-course">
                  <strong>{r.code}</strong>
                  <span className="hod-td-level">{r.level}</span>
                </div>
              </td>
              <td className="hod-td-lecturer" style={{ fontWeight: 600 }}>{r.student}</td>
              <td>
                <div className="hod-td-datetime">
                  <span>{r.date}</span>
                  <span className="hod-td-time">{r.time}</span>
                </div>
              </td>
              <td>
                <span className={`hod-status-badge badge-${r.status}`}>
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <button
                  type="button"
                  className="hod-view-action-btn"
                  onClick={() => onViewRecord(r)}
                >
                  <Eye size={13} /> View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =================================================================== LECTURER HOME (Arranged like HOD Dashboard)
export function LecturerHome() {
  const { profile } = useAuth();
  const ov = useApi('/lecturer/overview');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  if (ov.loading && !ov.data) return <Loading />;
  const d = ov.data;
  const overallRate = d?.attendance_rate ?? d?.attendance?.rate ?? 89;

  const dateStr = currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <div className="hod-dashboard">
      {/* Top Header & Breadcrumb */}
      <div className="hod-dashboard-header">
        <div className="hod-breadcrumb">
          <Link to="/" className="hod-breadcrumb-link">Home</Link>
          <ChevronRight size={14} className="hod-breadcrumb-sep" />
          <span className="hod-breadcrumb-current">Lecturer Dashboard</span>
        </div>

        <div className="hod-welcome-banner">
          <div className="hod-welcome-left">
            <h1 className="hod-welcome-title">Welcome Back, {profile.full_name || 'Lecturer'}!</h1>
            <p className="hod-welcome-desc">
              Here is an overview of your assigned modules, lecture sessions and student attendance.
            </p>
          </div>

          <div className="hod-header-pills">
            <div className="hod-header-pill">
              <div className="hod-pill-icon"><Calendar size={18} /></div>
              <div className="hod-pill-content">
                <span className="hod-pill-label">Academic Year</span>
                <span className="hod-pill-val">{d?.academic_year || '2026/2027'} <ChevronDown size={14} /></span>
              </div>
            </div>

            <div className="hod-header-pill">
              <div className="hod-pill-icon"><GraduationCap size={18} /></div>
              <div className="hod-pill-content">
                <span className="hod-pill-label">Semester</span>
                <span className="hod-pill-val">{d?.semester || 'First Semester'} <ChevronDown size={14} /></span>
              </div>
            </div>

            <div className="hod-header-pill hod-header-pill-datetime">
              <div className="hod-pill-icon"><Clock size={18} /></div>
              <div className="hod-pill-content">
                <span className="hod-pill-val-bold">{dateStr}</span>
                <span className="hod-pill-val-sub">{timeStr}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ErrorText>{ov.error}</ErrorText>

      {/* 4 Top Metric Cards (hod-metrics-grid) */}
      <div className="hod-metrics-grid">
        <div className="hod-metric-card">
          <div className="hod-stat-icon blue">
            <BookOpen size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Assigned Modules</span>
            <strong className="hod-stat-value">{d?.assigned_courses || d?.courses?.length || 0}</strong>
            <span className="hod-stat-trend up">Active curriculum</span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon green">
            <Users size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Enrolled Students</span>
            <strong className="hod-stat-value">{d?.enrolled_students || 0}</strong>
            <span className="hod-stat-trend up">Registered students</span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className={`hod-stat-icon ${(d?.pending_total || 0) > 0 ? 'amber' : 'purple'}`}>
            <ClipboardCheck size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Pending Approvals</span>
            <strong className="hod-stat-value">{d?.pending_total || 0}</strong>
            <span className="hod-stat-trend" style={{ color: (d?.pending_total || 0) > 0 ? '#d97706' : undefined }}>
              {(d?.pending_total || 0) > 0 ? 'Requires your approval' : 'All reviews up to date'}
            </span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon amber">
            <Award size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Attendance Rate</span>
            <strong className="hod-stat-value">{overallRate}%</strong>
            <span className="hod-stat-trend up">Average turnout</span>
          </div>
        </div>
      </div>

      {/* Middle 3 Visual Cards (hod-visual-cards-grid) */}
      <div className="hod-visual-cards-grid">
        {/* Attendance Trend */}
        <div className="hod-card hod-trend-card">
          <div className="hod-card-header">
            <h3>Attendance Trend</h3>
            <div className="hod-select-pill">
              <span>This Semester</span>
              <ChevronDown size={14} />
            </div>
          </div>
          <AttendanceTrendChart currentRate={overallRate} />
        </div>

        {/* Attendance by Academic Level */}
        <div className="hod-card hod-donut-card">
          <div className="hod-card-header">
            <h3>Attendance by Academic Level</h3>
          </div>
          <AttendanceByLevelDonut byLevel={d?.by_level || []} overallRate={overallRate} />
        </div>

        {/* Attendance by Course */}
        <div className="hod-card hod-course-card">
          <div className="hod-card-header">
            <h3>Attendance by Course</h3>
            <Link to="/courses" className="hod-card-header-link">
              View All <ArrowUpRight size={14} />
            </Link>
          </div>
          <AttendanceByCourseList courses={d?.by_course || []} />
        </div>
      </div>

      {/* Bottom Row: 2 Columns (hod-bottom-grid) */}
      <div className="hod-bottom-grid">
        {/* Left Column: Recent Attendance Submissions */}
        <div className="hod-card hod-records-card">
          <div className="hod-card-header">
            <h3>Recent Submissions</h3>
            <Link to="/approvals" className="hod-card-header-link">
              Review All <ArrowUpRight size={14} />
            </Link>
          </div>
          <RecentAttendanceRecordsTable
            records={d?.recent_records || []}
            onViewRecord={rec => setSelectedRecord(rec)}
          />
        </div>

        {/* Right Column: Quick Actions + System Notifications */}
        <div className="hod-right-col">
          {/* Quick Actions */}
          <div className="hod-card hod-quick-actions-card">
            <div className="hod-card-header">
              <h3>Quick Actions</h3>
            </div>
            <div className="hod-quick-actions-grid">
              <Link to="/sessions" className="hod-action-tile tile-blue">
                <div className="hod-tile-icon"><Play size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Open Session</strong>
                  <span>Start class session</span>
                </div>
              </Link>

              <Link to="/approvals" className="hod-action-tile tile-purple">
                <div className="hod-tile-icon"><CheckCircle2 size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Review Submissions</strong>
                  <span>Approve attendance</span>
                </div>
              </Link>

              <Link to="/courses" className="hod-action-tile tile-green">
                <div className="hod-tile-icon"><BookOpen size={22} /></div>
                <div className="hod-tile-text">
                  <strong>My Modules</strong>
                  <span>View assigned courses</span>
                </div>
              </Link>

              <Link to="/reports" className="hod-action-tile tile-orange">
                <div className="hod-tile-icon"><FileSpreadsheet size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Reports & Export</strong>
                  <span>Download PDF & Excel</span>
                </div>
              </Link>
            </div>
          </div>

          {/* System Notifications */}
          <div className="hod-card hod-notifications-card">
            <div className="hod-card-header">
              <h3>Department Notices</h3>
              <Link to="/announcements" className="hod-card-header-link">
                View All <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="hod-notifications-list">
              {(d?.announcements || []).length ? (
                d.announcements.map(n => (
                  <div key={n.id} className="hod-notification-item">
                    <div className="hod-notif-left">
                      <div className="hod-notif-icon">
                        <Megaphone size={16} />
                      </div>
                      <div className="hod-notif-content">
                        <strong className="hod-notif-title">{n.title}</strong>
                        <p className="hod-notif-desc">{n.message}</p>
                      </div>
                    </div>
                    <span className="hod-notif-time">{fmtDate(n.created_at)}</span>
                  </div>
                ))
              ) : (
                <div className="hod-notification-item">
                  <div className="hod-notif-left">
                    <div className="hod-notif-icon">
                      <Megaphone size={16} />
                    </div>
                    <div className="hod-notif-content">
                      <strong className="hod-notif-title">First Semester Classes Ongoing</strong>
                      <p className="hod-notif-desc">Ensure QR codes and GPS geofences are active during all scheduled sessions.</p>
                    </div>
                  </div>
                  <span className="hod-notif-time">Today</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Record Details Modal */}
      {selectedRecord && (
        <div className="hod-modal-overlay" onClick={() => setSelectedRecord(null)}>
          <div className="hod-modal" onClick={e => e.stopPropagation()}>
            <div className="hod-modal-header">
              <h3>Submission Details</h3>
              <button
                type="button"
                className="hod-modal-close-btn"
                onClick={() => setSelectedRecord(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="hod-modal-body">
              <div className="hod-modal-field">
                <span className="hod-field-label">Module:</span>
                <strong>{selectedRecord.code} ({selectedRecord.level})</strong>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Student:</span>
                <span>{selectedRecord.student}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Date & Time:</span>
                <span>{selectedRecord.date} at {selectedRecord.time}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Venue:</span>
                <span>{selectedRecord.venue || 'Classroom / Lecture Hall'}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Status:</span>
                <span className={`hod-status-badge badge-${selectedRecord.status}`}>
                  {selectedRecord.status.charAt(0).toUpperCase() + selectedRecord.status.slice(1)}
                </span>
              </div>
              {selectedRecord.review_note && (
                <div className="hod-modal-field">
                  <span className="hod-field-label">Note:</span>
                  <span className="hod-note-box">{selectedRecord.review_note}</span>
                </div>
              )}
            </div>

            <div className="hod-modal-footer">
              <button
                type="button"
                className="btn primary"
                onClick={() => setSelectedRecord(null)}
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

// =================================================================== LECTURER COURSES
export function LecturerCourses() {
  const courses = useApi('/lecturer/courses');
  const timetable = useApi('/lecturer/timetable');
  const [selectedCourse, setSelectedCourse] = useState(null);
  const students = useApi(selectedCourse ? `/lecturer/courses/${selectedCourse.course_id}/students` : null, { enabled: Boolean(selectedCourse) });

  if (courses.loading && !courses.data) return <Loading />;

  return (
    <>
      <ErrorText>{courses.error || timetable.error}</ErrorText>
      <Panel title="Assigned Courses">
        {courses.data?.length ? courses.data.map(c => (
          <div className="row" key={c.id}>
            <div>
              <strong>{c.courses.code}</strong> <span className="muted">{c.courses.title}</span>
              <p className="muted small">Level {c.courses.level} · {c.students} students registered · {c.academic_years?.name} {c.semesters?.name}</p>
            </div>
            <button className="secondary compact" onClick={() => setSelectedCourse(c)}>
              {selectedCourse?.id === c.id ? 'Close' : 'Students'}
            </button>
          </div>
        )) : <Empty>No courses assigned to you.</Empty>}
      </Panel>

      {selectedCourse && (
        <Panel title={`Enrolled Students - ${selectedCourse.courses.code}`} action={<button className="link-button" onClick={() => setSelectedCourse(null)}>Done</button>}>
          {students.loading ? <Loading text="Loading roster…" /> : (
            <>
              <ErrorText>{students.error}</ErrorText>
              {!students.data?.length && <Empty>No students enrolled yet.</Empty>}
              {students.data?.map(s => (
                <div className="row" key={s.id}>
                  <div>
                    <strong>{s.full_name}</strong>
                    <p className="muted small">{s.student_id ? `${s.student_id} · ` : ''}{s.programme} · Level {s.level}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </Panel>
      )}

      <Panel title="My Teaching Timetable">
        {!timetable.data?.length && <Empty>No scheduled timetable entries found.</Empty>}
        {DAYS.map((d, i) => {
          const items = (timetable.data || []).filter(x => x.day_of_week === i);
          if (!items.length) return null;
          return (
            <div key={d} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, color: '#465b70', margin: '8px 0' }}>{d}</h3>
              {items.map(x => (
                <div className="row" key={x.id}>
                  <div>
                    <strong>{x.courses.code}</strong> <span className="muted">{x.courses.title}</span>
                    <p className="muted small">{x.venues?.name || 'Venue TBA'} · Level {x.level} ({x.programme})</p>
                  </div>
                  <span className="time">{hhmm(x.starts_at)}–{hhmm(x.ends_at)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </Panel>
    </>
  );
}

// =================================================================== LECTURER SESSIONS
export function LecturerSessions() {
  const timetable = useApi('/lecturer/timetable');
  const sessions = useApi('/lecturer/sessions');
  const [createdSession, setCreatedSession] = useState(null);
  const [activeCode, setActiveCode] = useState(null);
  const [activeQrSession, setActiveQrSession] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleModal, setRescheduleModal] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleNote, setRescheduleNote] = useState('');
  const { busy, error, ok, run } = useAction();

  const todayIndex = new Date().getDay();
  const todayEntries = (timetable.data || []).filter(e => e.day_of_week === todayIndex);

  const startSession = entry => run(`start-${entry.id}`, async () => {
    const res = await apiFetch('/lecturer/sessions', { method: 'POST', body: { timetable_entry_id: entry.id } });
    setCreatedSession(res);
    sessions.reload();
  }, 'Session created for today.');

  const extendSession = session => run(`extend-${session.id}`, async () => {
    await apiFetch(`/sessions/${session.id}/extend`, { method: 'POST' });
    sessions.reload();
  }, 'Session extended by 15 minutes.');

  const openSession = session => run(`open-${session.id}`, async () => {
    const res = await apiFetch(`/sessions/${session.id}/open`, { method: 'POST' });
    setActiveQrSession({ id: session.id, class_code: res.class_code });
    sessions.reload();
  }, 'Session is now open! QR code ready for display.');

  const closeSession = session => run(`close-${session.id}`, async () => {
    const res = await apiFetch(`/sessions/${session.id}/close`, { method: 'POST' });
    setActiveCode(null);
    setActiveQrSession(null);
    sessions.reload();
  }, 'Session closed. Students without submission marked absent.');

  const handleCancelSession = () => run(`cancel-${cancelModal?.id}`, async () => {
    await apiFetch(`/sessions/${cancelModal.id}/cancel`, { method: 'POST', body: { reason: cancelReason } });
    setCancelModal(null);
    setCancelReason('');
    sessions.reload();
  }, 'Session cancelled and enrolled students notified.');

  const handleRescheduleSession = () => run(`reschedule-${rescheduleModal?.id}`, async () => {
    await apiFetch(`/sessions/${rescheduleModal.id}/reschedule`, { method: 'POST', body: { new_date: rescheduleDate, new_time_note: rescheduleNote } });
    setRescheduleModal(null);
    setRescheduleDate('');
    setRescheduleNote('');
    sessions.reload();
  }, 'Session rescheduled and students notified.');

  return (
    <>
      <ErrorText>{timetable.error || sessions.error || error}</ErrorText>
      <Success>{ok}</Success>

      {/* QR Code Fullscreen / Modal */}
      {activeQrSession && (
        <LecturerQrModal
          sessionId={activeQrSession.id}
          classCode={activeQrSession.class_code}
          onClose={() => setActiveQrSession(null)}
          onSwitchToCode={() => {
            setActiveCode({ sessionId: activeQrSession.id, code: activeQrSession.class_code });
            setActiveQrSession(null);
          }}
        />
      )}

      {/* Class code modal/banner */}
      {activeCode && (
        <div className="credential" style={{ border: '2px solid #16834b', background: '#eff8f3', textAlign: 'center', margin: '14px 0', padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', color: '#16834b' }}>Class Code Active</h3>
          <p className="muted small" style={{ margin: 0 }}>Announce or display this 6-digit code to students:</p>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 8, margin: '12px 0', color: '#102a43' }}>
            {activeCode.code}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 10 }}>
            <button
              className="primary compact"
              onClick={() => {
                const s = sessions.data?.find(x => x.id === activeCode.sessionId);
                if (s) setActiveQrSession(s);
              }}
            >
              <QrCode size={14} /> Switch to QR Code
            </button>
            <button className="secondary compact" onClick={() => setActiveCode(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <Panel title="Today's Scheduled Classes">
        <p className="muted small" style={{ margin: '0 0 12px' }}>
          Class sessions are automatically opened at start time and closed after the grace period. You can display QR/code, extend open sessions, or cancel class if needed.
        </p>
        {!todayEntries.length ? <Empty>No lectures scheduled for you today.</Empty> : todayEntries.map(e => {
          const s = (sessions.data || []).find(x => x.timetable_entry_id === e.id && x.session_date === new Date().toISOString().slice(0, 10));
          const isCancelled = s?.status === 'cancelled';
          return (
            <div className="row" key={e.id} style={{ alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{e.courses.code}</strong>
                  <span className="muted">{e.courses.title}</span>
                  {isCancelled && <Badge status="failed">Cancelled</Badge>}
                  {s?.is_open && <Badge status="approved">🟢 Open</Badge>}
                  {s && !s.is_open && !s.finalized_at && !isCancelled && <Badge status="pending">🕒 Scheduled</Badge>}
                  {s?.finalized_at && !isCancelled && <Badge status="approved">Closed & Finalized</Badge>}
                </div>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  {hhmm(e.starts_at)}–{hhmm(e.ends_at)} · {e.venues?.name || 'Venue TBA'} · Level {e.level}
                  {s?.is_open && s?.closes_at && ` · Auto-closes at ${hhmm(new Date(s.closes_at).toTimeString().slice(0, 5))}`}
                </p>
                {isCancelled && (
                  <p className="muted small" style={{ color: '#dc2626', margin: '4px 0 0' }}>
                    Cancellation Reason: {s.cancellation_reason}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {!s ? (
                  <button className="primary compact" disabled={busy === `start-${e.id}`} onClick={() => startSession(e)}>
                    Initialize Session
                  </button>
                ) : isCancelled ? (
                  <span className="muted small" style={{ color: '#64748b' }}>No action needed</span>
                ) : s.is_open ? (
                  <>
                    <button className="primary compact" onClick={() => setActiveQrSession(s)}>
                      <QrCode size={14} /> Show QR
                    </button>
                    <button className="secondary compact" onClick={() => setActiveCode({ sessionId: s.id, code: s.class_code })}>
                      Show Code
                    </button>
                    <button className="secondary compact" disabled={busy === `extend-${s.id}`} onClick={() => extendSession(s)}>
                      +15m Extend
                    </button>
                    <button className="danger compact" disabled={busy === `close-${s.id}`} onClick={() => closeSession(s)}>
                      <Square size={14} /> Close Early
                    </button>
                    <button className="secondary compact" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={() => { setCancelModal(s); setCancelReason(''); }}>
                      Cancel Class
                    </button>
                  </>
                ) : s.finalized_at ? (
                  <Badge status="approved">Finalized</Badge>
                ) : (
                  <>
                    <button className="primary compact" disabled={busy === `open-${s.id}`} onClick={() => openSession(s)}>
                      <Play size={14} /> Open Early
                    </button>
                    <button className="secondary compact" style={{ color: '#dc2626', borderColor: '#fca5a5' }} onClick={() => { setCancelModal(s); setCancelReason(''); }}>
                      Cancel Class
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </Panel>


      {/* Cancel Session Modal */}
      {cancelModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0, background: '#fff', borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Cancel Class Session</h3>
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Notice will be sent to all enrolled students via OneSignal push notification. No absences will be recorded.
            </p>
            <Field label="Cancellation Reason (required)">
              <textarea
                rows={3}
                required
                className="input-field"
                style={{ height: 'auto', padding: '10px 12px' }}
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="e.g. Faculty meeting, illness, rescheduled lecture…"
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="secondary compact" onClick={() => setCancelModal(null)}>Back</button>
              <button
                type="button"
                className="danger compact"
                disabled={!cancelReason.trim() || busy}
                onClick={handleCancelSession}
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Session Modal */}
      {rescheduleModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0, background: '#fff', borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Reschedule Class Session</h3>
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Move this session to a new date and notify students.
            </p>
            <Field label="New Date">
              <input
                type="date"
                required
                className="input-field"
                value={rescheduleDate}
                onChange={e => setRescheduleDate(e.target.value)}
              />
            </Field>
            <Field label="Time / Venue Note (optional)">
              <input
                type="text"
                className="input-field"
                value={rescheduleNote}
                onChange={e => setRescheduleNote(e.target.value)}
                placeholder="e.g. 14:00 in Lab 2"
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="secondary compact" onClick={() => setRescheduleModal(null)}>Cancel</button>
              <button
                type="button"
                className="primary compact"
                disabled={!rescheduleDate || busy}
                onClick={handleRescheduleSession}
              >
                Confirm Reschedule
              </button>
            </div>
          </div>
        </div>
      )}

      <Panel title="Recent Class Sessions">
        {!sessions.data?.length ? <Empty>No class sessions recorded yet.</Empty> : sessions.data.map(s => {
          const t = s.timetable_entries;
          const counts = s.counts || {};
          const isCancelled = s.status === 'cancelled';
          return (
            <div className="row" key={s.id}>
              <div>
                <strong>{t?.courses?.code}</strong> <span className="muted">{fmtDate(s.session_date)}</span>
                <p className="muted small">
                  {hhmm(t?.starts_at)}–{hhmm(t?.ends_at)} · {isCancelled ? '❌ Cancelled' : s.is_open ? '🟢 Currently Open' : s.finalized_at ? 'Finalized' : 'Closed'}
                </p>
                {isCancelled ? (
                  <p className="muted small" style={{ color: '#dc2626' }}>Reason: {s.cancellation_reason}</p>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <span className="muted small">Present: <b>{counts.approved || 0}</b></span>
                    <span className="muted small">Pending: <b>{counts.pending || 0}</b></span>
                    <span className="muted small">Absent: <b>{counts.absent || 0}</b></span>
                    <span className="muted small">Excused: <b>{counts.excused || 0}</b></span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                {s.is_open && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="secondary compact" disabled={busy === `extend-${s.id}`} onClick={() => extendSession(s)}>
                      +15m
                    </button>
                    <button className="danger compact" disabled={busy === `close-${s.id}`} onClick={() => closeSession(s)}>
                      Close
                    </button>
                  </div>
                )}
                {!s.finalized_at && !isCancelled && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="secondary compact"
                      style={{ fontSize: 11 }}
                      onClick={() => { setRescheduleModal(s); setRescheduleDate(s.session_date); setRescheduleNote(''); }}
                    >
                      Reschedule
                    </button>
                    <button
                      className="secondary compact"
                      style={{ fontSize: 11, color: '#dc2626', borderColor: '#fca5a5' }}
                      onClick={() => { setCancelModal(s); setCancelReason(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <Link to={`/approvals?session_id=${s.id}`} className="secondary compact">
                  Submissions
                </Link>
              </div>
            </div>
          );
        })}
      </Panel>
    </>
  );
}

// =================================================================== LECTURER APPROVALS
export function LecturerApprovals() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState('submissions'); // 'submissions' | 'excuses' | 'appeals'
  const sessions = useApi('/lecturer/sessions');
  const [selectedSession, setSelectedSession] = useState(searchParams.get('session_id') || '');
  const [selectedStatus, setSelectedStatus] = useState('pending');
  const [noteModal, setNoteModal] = useState(null); // { id, action: 'rejected' | 'correction_requested', note: '' }
  const submissions = useApi(`/lecturer/attendance?${new URLSearchParams({
    ...(selectedSession ? { session_id: selectedSession } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {})
  }).toString()}`);

  const excuses = useApi('/excuses');
  const appeals = useApi('/appeals');

  const { busy, error, ok, run, setOk } = useAction();

  const handleReview = (id, status, note = null) => run(`review-${id}`, async () => {
    await apiFetch(`/attendance/${id}/review`, { method: 'PATCH', body: { status, note } });
    submissions.reload();
    setNoteModal(null);
  }, `Record marked ${status}.`);

  const handleBulkApprove = () => run('bulk-approve', async () => {
    const pendingIds = (submissions.data?.rows || []).filter(r => r.status === 'pending').map(r => r.id);
    if (!pendingIds.length) return;
    const res = await apiFetch('/attendance/review-bulk', { method: 'POST', body: { ids: pendingIds, status: 'approved' } });
    submissions.reload();
    setOk(`Bulk approved ${res.approved} submissions.`);
  });

  const handleExcuseDecision = (id, decision) => run(`excuse-${id}`, async () => {
    await apiFetch(`/excuses/${id}/decide`, { method: 'POST', body: { decision } });
    excuses.reload();
  }, `Excuse request marked ${decision}.`);

  const handleAppealDecision = (id, decision) => run(`appeal-${id}`, async () => {
    await apiFetch(`/appeals/${id}/decide`, { method: 'POST', body: { decision } });
    appeals.reload();
  }, `Appeal decided: ${decision}.`);

  const rows = submissions.data?.rows || [];
  const pendingCount = rows.filter(r => r.status === 'pending').length;
  const displayError = submissions.error || sessions.error || excuses.error || appeals.error || error;

  return (
    <>
      {displayError && (
        <div style={{ marginBottom: 16 }}>
          <ErrorText>{displayError}</ErrorText>
          {String(displayError).toLowerCase().includes('auth') && (
            <div style={{ marginTop: 8 }}>
              <button className="primary compact" onClick={() => window.location.reload()}>
                <RefreshCw size={14} /> Reconnect Session
              </button>
            </div>
          )}
        </div>
      )}
      <Success>{ok}</Success>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={tab === 'submissions' ? 'primary compact' : 'secondary compact'}
          onClick={() => setTab('submissions')}
        >
          Daily Submissions
        </button>
        <button
          className={tab === 'excuses' ? 'primary compact' : 'secondary compact'}
          onClick={() => setTab('excuses')}
        >
          Excused Requests ({excuses.data?.filter(e => e.status === 'pending')?.length || 0})
        </button>
        <button
          className={tab === 'appeals' ? 'primary compact' : 'secondary compact'}
          onClick={() => setTab('appeals')}
        >
          Appeals ({appeals.data?.filter(a => a.status === 'pending')?.length || 0})
        </button>
      </div>

      {/* TAB 1: SUBMISSIONS */}
      {tab === 'submissions' && (
        <>
          {noteModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10, display: 'grid', placeItems: 'center', padding: 16 }}>
              <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0 }}>
                <h3>{noteModal.action === 'rejected' ? 'Reject Submission' : 'Request Correction'}</h3>
                <p className="muted small">Provide a clear note to the student explaining what needs correction or why it was rejected:</p>
                <Field label="Reason / Note (required)">
                  <textarea
                    rows={3}
                    style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #dce4ec' }}
                    value={noteModal.note}
                    onChange={e => setNoteModal({ ...noteModal, note: e.target.value })}
                    placeholder="e.g., GPS location was far from venue, or check session time."
                    required
                  />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button
                    className="primary compact"
                    disabled={!noteModal.note.trim() || busy}
                    onClick={() => handleReview(noteModal.id, noteModal.action, noteModal.note.trim())}
                  >
                    Confirm
                  </button>
                  <button className="secondary compact" onClick={() => setNoteModal(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          <Panel title="Review Submissions">
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <Field label="Filter Session">
                <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
                  <option value="">All My Sessions</option>
                  {sessions.data?.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.timetable_entries?.courses?.code} - {fmtDate(s.session_date)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  <option value="pending">Pending Review</option>
                  <option value="approved">Approved</option>
                  <option value="correction_requested">Correction Requested</option>
                  <option value="rejected">Rejected</option>
                  <option value="absent">Absent</option>
                </select>
              </Field>
            </div>

            {selectedStatus === 'pending' && pendingCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 16px' }}>
                <span className="muted small">{pendingCount} pending records</span>
                <button className="primary compact" disabled={busy === 'bulk-approve'} onClick={handleBulkApprove}>
                  <Check size={14} /> Approve All Pending
                </button>
              </div>
            )}

            {submissions.loading ? <Loading text="Loading records…" /> : !rows.length ? (
              <Empty>No submissions matching criteria.</Empty>
            ) : (
              rows.map(r => {
                const student = r.profiles || {};
                const sess = r.class_sessions || {};
                const course = sess.timetable_entries?.courses || {};
                return (
                  <div className="row" key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar user={student} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{student.full_name}</strong> {student.student_id ? <span className="muted">({student.student_id})</span> : ''}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 4,
                            background: r.method === 'qr' ? '#eff6ff' : '#f8fafc',
                            color: r.method === 'qr' ? '#1d4ed8' : '#334155',
                            border: r.method === 'qr' ? '1px solid #bfdbfe' : '1px solid #cbd5e1',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3
                          }}
                        >
                          {r.method === 'qr' ? '📷 QR Code' : '🔢 Class Code'}
                        </span>
                        {r.submitted_offline && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: '#fef3c7',
                              color: '#92400e',
                              border: '1px solid #fde68a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3
                            }}
                          >
                            ⚡ Offline Synced
                          </span>
                        )}
                      </div>
                      <p className="muted small">
                        {course.code} · {fmtDate(sess.session_date)} · {fmtDateTime(r.submitted_at)}
                      </p>
                      <p className="muted small">
                        GPS accuracy: {Math.round(r.gps_accuracy_m || 0)}m · Distance: {Math.round(r.distance_m || 0)}m
                      </p>
                      {r.review_note && <p className="muted small" style={{ color: '#b42318' }}>Note: {r.review_note}</p>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge>
                      {r.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="action-btn ok"
                            title="Approve"
                            disabled={busy === `review-${r.id}`}
                            onClick={() => handleReview(r.id, 'approved')}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            className="action-btn warn"
                            title="Request Correction"
                            disabled={busy === `review-${r.id}`}
                            onClick={() => setNoteModal({ id: r.id, action: 'correction_requested', note: '' })}
                          >
                            <AlertCircle size={15} />
                          </button>
                          <button
                            className="action-btn danger"
                            title="Reject"
                            disabled={busy === `review-${r.id}`}
                            onClick={() => setNoteModal({ id: r.id, action: 'rejected', note: '' })}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </Panel>
        </>
      )}

      {/* TAB 2: EXCUSES */}
      {tab === 'excuses' && (
        <Panel title="Excused Absence Requests">
          {!excuses.data?.length ? (
            <Empty>No excused absence requests submitted.</Empty>
          ) : (
            excuses.data.map(ex => {
              const student = ex.profiles || {};
              const sess = ex.class_sessions || {};
              const course = sess.timetable_entries?.courses || {};
              return (
                <div className="row" key={ex.id}>
                  <div>
                    <strong>{student.full_name}</strong> {student.student_id ? <span className="muted">({student.student_id})</span> : ''}
                    <p className="muted small">
                      {course.code} on {fmtDate(sess.session_date)} · Reason: <strong>{ex.reason}</strong>
                    </p>
                    {ex.note && <p className="muted small">Note: {ex.note}</p>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <Badge status={ex.status}>{ex.status}</Badge>
                    {ex.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="primary compact"
                          style={{ fontSize: 11 }}
                          disabled={busy === `excuse-${ex.id}`}
                          onClick={() => handleExcuseDecision(ex.id, 'approved')}
                        >
                          Approve (Excuse)
                        </button>
                        <button
                          className="secondary compact"
                          style={{ fontSize: 11 }}
                          disabled={busy === `excuse-${ex.id}`}
                          onClick={() => handleExcuseDecision(ex.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Panel>
      )}

      {/* TAB 3: APPEALS */}
      {tab === 'appeals' && (
        <Panel title="Attendance Rejection Appeals">
          {!appeals.data?.length ? (
            <Empty>No appeals filed by students.</Empty>
          ) : (
            appeals.data.map(ap => {
              const student = ap.profiles || {};
              const sess = ap.attendance_records?.class_sessions || {};
              const course = sess.timetable_entries?.courses || {};
              return (
                <div className="row" key={ap.id}>
                  <div>
                    <strong>{student.full_name}</strong> {student.student_id ? <span className="muted">({student.student_id})</span> : ''}
                    <p className="muted small">
                      {course.code} on {fmtDate(sess.session_date)} · Submitted within 48h
                    </p>
                    <p className="muted small" style={{ color: '#1e293b', background: '#f8fafc', padding: 6, borderRadius: 4 }}>
                      Student Statement: "{ap.reason}"
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <Badge status={ap.status}>{ap.status}</Badge>
                    {ap.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="primary compact"
                          style={{ fontSize: 11 }}
                          disabled={busy === `appeal-${ap.id}`}
                          onClick={() => handleAppealDecision(ap.id, 'approved')}
                        >
                          Reverse (Approve)
                        </button>
                        <button
                          className="secondary compact"
                          style={{ fontSize: 11 }}
                          disabled={busy === `appeal-${ap.id}`}
                          onClick={() => handleAppealDecision(ap.id, 'rejected')}
                        >
                          Uphold Rejection
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </Panel>
      )}
    </>
  );
}

// =================================================================== LECTURER REPORTS
export function LecturerReports() {
  return <ReportsPage isHod={false} />;
}
