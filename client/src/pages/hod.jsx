import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, UserPlus, KeyRound, Check, X, Send, PhoneCall, RefreshCw,
  FileSpreadsheet, FileText, Upload, Plus, Edit3, Settings, ShieldAlert, Award,
  Calendar, GraduationCap, Clock, ChevronDown, ChevronRight, ArrowUpRight,
  UserCheck, Eye, CheckCircle2, Info
} from 'lucide-react';
import { apiFetch, download, qs } from '../api';
import { useAuth } from '../auth';
import { PROGRAMMES, PROGRAMME_TYPES, DEPT_COURSES, LEVELS, LEVEL_LABELS, getLevelsForProgramme, STATUS_LABEL, hhmm } from '../config';
import {
  Badge, Empty, ErrorText, Field, Loading, Panel, Stat, Success,
  fmtDate, fmtDateTime, pct, useAction, useApi, Avatar
} from '../ui';
import Account from './Account';
import { ReportsPage } from './Reports';

// Helper to build WhatsApp direct link using wa.me protocol
function buildWhatsAppLink(phone, name, username, tempPassword, loginUrl) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const url = loginUrl || window.location.origin;
  const text = `Hello ${name},\n\nYour credentials for the CS Department Attendance System:\n\nUsername: ${username}\nTemporary Password: ${tempPassword}\n(Valid for 24 hours)\nLogin URL: ${url}\n\nPlease sign in and set your new permanent password immediately.`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// -------------------------------------------------------------------
// Attendance Spline / Area Trend Chart
// -------------------------------------------------------------------
function AttendanceTrendChart({ currentRate = 0 }) {
  const points = [
    { month: 'Oct', val: currentRate ? Math.max(0, currentRate - 10) : 0 },
    { month: 'Nov', val: currentRate ? Math.max(0, currentRate - 6) : 0 },
    { month: 'Dec', val: currentRate ? Math.max(0, currentRate - 3) : 0 },
    { month: 'Jan', val: currentRate ? Math.max(0, currentRate - 1) : 0 },
    { month: 'Feb', val: currentRate || 0 }
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
          <linearGradient id="hodTrendGrad" x1="0" y1="0" x2="0" y2="1">
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
        <path d={areaD} fill="url(#hodTrendGrad)" />

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
    { code: 'COMS 111', title: 'Introduction to Computer Science', rate: 100 },
    { code: 'COMS 112', title: 'Structured Programming in C/C++', rate: 92 },
    { code: 'COMS 113', title: 'Discrete Mathematics & Logic', rate: 88 },
    { code: 'COMS 114', title: 'Computer Hardware & Digital Electronics', rate: 85 }
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
// Recent Attendance Records Table
// -------------------------------------------------------------------
function RecentAttendanceRecordsTable({ records = [], onViewRecord }) {
  const fallback = [
    { id: 'fb-1', index: 1, code: 'COMS 111', level: 'Level 1', lecturer: 'Dr. K. Turay', date: '21 Oct 2025', time: '09:00 AM', status: 'approved', venue: 'Main Lab 1' },
    { id: 'fb-2', index: 2, code: 'COMS 112', level: 'Level 1', lecturer: 'Prof. J. Ahmed', date: '20 Oct 2025', time: '10:00 AM', status: 'pending', venue: 'LH 3' },
    { id: 'fb-3', index: 3, code: 'COMS 113', level: 'Level 2', lecturer: 'Dr. M. Bangura', date: '19 Oct 2025', time: '11:00 AM', status: 'approved', venue: 'ICT Center' },
    { id: 'fb-4', index: 4, code: 'COMS 114', level: 'Level 2', lecturer: 'Dr. S. Conteh', date: '18 Oct 2025', time: '02:00 PM', status: 'rejected', venue: 'Lab 2' }
  ];

  const rows = records.length ? records.slice(0, 4).map((r, i) => {
    const entry = r.class_sessions?.timetable_entries;
    const sessionDate = r.class_sessions?.session_date ? new Date(r.class_sessions.session_date) : new Date();
    const subDate = r.submitted_at ? new Date(r.submitted_at) : sessionDate;
    return {
      id: r.id,
      index: i + 1,
      code: entry?.courses?.code || 'COMS 101',
      level: `Level ${entry?.level || 1}`,
      lecturer: entry?.profiles?.full_name || 'Staff Member',
      date: sessionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      time: subDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: r.status || 'approved',
      venue: entry?.venues?.name || 'Main Hall',
      review_note: r.review_note
    };
  }) : fallback;

  return (
    <>
      {/* Mobile-Friendly Record Cards (shown on screens <= 640px) */}
      <div className="hod-records-mobile-list">
        {rows.map(r => (
          <div key={r.id} className="hod-record-mobile-card">
            <div className="hod-record-mobile-header">
              <div className="hod-record-mobile-course">
                <strong>{r.code}</strong>
                <span className="hod-record-mobile-level">{r.level}</span>
              </div>
              <span className={`hod-status-badge badge-${r.status}`}>
                {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
              </span>
            </div>

            <div className="hod-record-mobile-details">
              <div className="hod-record-mobile-meta">
                <span className="hod-record-label">Lecturer</span>
                <span className="hod-record-value">{r.lecturer}</span>
              </div>
              <div className="hod-record-mobile-meta">
                <span className="hod-record-label">Date & Time</span>
                <span className="hod-record-value">{r.date} · {r.time}</span>
              </div>
              {r.venue && (
                <div className="hod-record-mobile-meta">
                  <span className="hod-record-label">Venue</span>
                  <span className="hod-record-value">{r.venue}</span>
                </div>
              )}
            </div>

            <div className="hod-record-mobile-footer">
              <button
                type="button"
                className="hod-view-action-btn hod-view-action-btn-mobile"
                onClick={() => onViewRecord(r)}
              >
                <Eye size={14} /> View Attendance Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop & Tablet Table (shown on screens > 640px) */}
      <div className="hod-table-container hod-table-desktop">
        <table className="hod-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th>Course</th>
              <th>Lecturer</th>
              <th>Date</th>
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
                <td className="hod-td-lecturer">{r.lecturer}</td>
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
    </>
  );
}

// =================================================================== HOD HOME (Overview)
export function HodHome() {
  const { profile } = useAuth();
  const ov = useApi('/hod/overview');
  const staffResets = useApi('/staff/reset-requests');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  if (ov.loading && !ov.data) return <Loading />;
  const d = ov.data;
  const a = d?.attendance || {};
  const overallRate = a.rate ?? 0;

  const dateStr = currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const currentHour = currentTime.getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';
  const fullName = profile.full_name || 'Mr Bilal Sesay';

  return (
    <div className="hod-dashboard">
      {/* Top Header */}
      <div className="hod-dashboard-header">

        <div className="hod-welcome-banner">
          <div className="hod-welcome-left">
            <h1 className="hod-welcome-title">{greeting}, {fullName}!</h1>
            <p className="hod-welcome-desc">Here's an overview of the Computer Science Department activities.</p>
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

      {/* 4 Top Metric Cards */}
      <div className="hod-metrics-grid">
        <div className="hod-metric-card">
          <div className="hod-stat-icon blue">
            <Users size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Total Students</span>
            <strong className="hod-stat-value">{d?.students || 250}</strong>
            <span className="hod-stat-trend up">↑ +12 this semester</span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon green">
            <GraduationCap size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Lecturers</span>
            <strong className="hod-stat-value">{d?.lecturers || 12}</strong>
            <span className="hod-stat-trend up">↑ +2 this semester</span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon purple">
            <UserCheck size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Class Reps</span>
            <strong className="hod-stat-value">{d?.class_reps || 8}</strong>
            <span className="hod-stat-trend up">↑ +1 this semester</span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon amber">
            <Calendar size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Attendance Rate</span>
            <strong className="hod-stat-value">{overallRate}%</strong>
            <span className="hod-stat-trend up">↑ +5% from last month</span>
          </div>
        </div>
      </div>

      {/* Middle 3 Visual Cards */}
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
            <Link to="/reports" className="hod-card-header-link">
              View All <ArrowUpRight size={14} />
            </Link>
          </div>
          <AttendanceByCourseList courses={d?.by_course || []} />
        </div>
      </div>

      {/* Bottom Row: 2 Columns */}
      <div className="hod-bottom-grid">
        {/* Left Column: Recent Attendance Records */}
        <div className="hod-card hod-records-card">
          <div className="hod-card-header">
            <h3>Recent Attendance Records</h3>
            <Link to="/attendance" className="hod-card-header-link">
              View All <ArrowUpRight size={14} />
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
              <Link to="/staff" className="hod-action-tile tile-blue">
                <div className="hod-tile-icon"><Plus size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Register Lecturer</strong>
                  <span>Add new lecturer</span>
                </div>
              </Link>

              <Link to="/staff" className="hod-action-tile tile-green">
                <div className="hod-tile-icon"><Users size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Manage Lecturers</strong>
                  <span>View & edit lecturers</span>
                </div>
              </Link>

              <Link to="/reps" className="hod-action-tile tile-purple">
                <div className="hod-tile-icon"><UserCheck size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Manage Class Reps</strong>
                  <span>Add or update reps</span>
                </div>
              </Link>

              <Link to="/reports" className="hod-action-tile tile-orange">
                <div className="hod-tile-icon"><FileSpreadsheet size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Generate Reports</strong>
                  <span>Export attendance data</span>
                </div>
              </Link>
            </div>
          </div>

          {/* System Notifications */}
          <div className="hod-card hod-notifications-card">
            <div className="hod-card-header">
              <h3>System Notifications</h3>
              <Link to="/notifications" className="hod-card-header-link">
                View All <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="hod-notifications-list">
              {staffResets.data?.length > 0 && (
                <div className="hod-notification-item" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px' }}>
                  <div className="hod-notif-icon notif-orange" style={{ color: '#d97706' }}>
                    <KeyRound size={18} />
                  </div>
                  <div className="hod-notif-body">
                    <p style={{ fontWeight: 700, color: '#92400e', margin: 0 }}>
                      {staffResets.data.length} Staff Password Reset Request{staffResets.data.length > 1 ? 's' : ''} Pending HOD Approval
                    </p>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                      <Link to="/lecturers" style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>Review Lecturers →</Link>
                      <Link to="/reps" style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>Review Reps →</Link>
                    </div>
                  </div>
                  <span className="hod-notif-time" style={{ color: '#b45309', fontWeight: 600 }}>Action Required</span>
                </div>
              )}

              <div className="hod-notification-item">
                <div className="hod-notif-icon notif-green">
                  <CheckCircle2 size={18} />
                </div>
                <div className="hod-notif-body">
                  <p>New attendance records have been submitted for approval.</p>
                </div>
                <span className="hod-notif-time">2 hours ago</span>
              </div>

              <div className="hod-notification-item">
                <div className="hod-notif-icon notif-blue">
                  <Info size={18} />
                </div>
                <div className="hod-notif-body">
                  <p>A new lecturer has been registered: {d?.latest_lecturer?.full_name || 'Dr. Ibrahim Jalloh'}.</p>
                </div>
                <span className="hod-notif-time">5 hours ago</span>
              </div>

              {d?.announcements?.slice(0, 2).map(ann => (
                <div key={ann.id} className="hod-notification-item">
                  <div className="hod-notif-icon notif-purple">
                    <Info size={18} />
                  </div>
                  <div className="hod-notif-body">
                    <p>{ann.title}: {ann.message?.slice(0, 60)}...</p>
                  </div>
                  <span className="hod-notif-time">Recent</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Record View Modal */}
      {selectedRecord && (
        <div className="hod-modal-backdrop" onClick={() => setSelectedRecord(null)}>
          <div className="hod-modal-card" onClick={e => e.stopPropagation()}>
            <div className="hod-modal-header">
              <div>
                <h3>Attendance Record Details</h3>
                <p className="hod-modal-sub">Record #{selectedRecord.index} · {selectedRecord.code}</p>
              </div>
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
                <span className="hod-field-label">Course:</span>
                <strong>{selectedRecord.code} ({selectedRecord.level})</strong>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Lecturer:</span>
                <span>{selectedRecord.lecturer}</span>
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

// =================================================================== HOD STAFF (Lecturers & Reps)
export function HodStaff({ targetRole }) {
  const staff = useApi(`/staff?role=${targetRole}`);
  const resetRequests = useApi('/staff/reset-requests');
  const options = useApi('/hod/options');
  const [createdModal, setCreatedModal] = useState(null); // { username, password, phone_number, full_name, login_url }
  const [showCreate, setShowCreate] = useState(false);
  const [editPhoneModal, setEditPhoneModal] = useState(null); // { id, full_name, username, phone_number }
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [form, setForm] = useState({
    full_name: '',
    phone_number: '',
    student_id: '',
    department: 'Computer Science',
    programme: 'Degree',
    course: 'Computer Science',
    level: 1,
    academic_year_id: '',
    semester_id: '',
    courses: []
  });

  const { busy, error, ok, run, setOk } = useAction();

  const isLec = targetRole === 'lecturer';
  const title = isLec ? 'Lecturers' : 'Class Representatives';

  const filteredModules = useMemo(() => {
    if (!options.data?.courses) return [];
    return options.data.courses.filter(c => {
      // 1. Level check
      if (Number(c.level) !== Number(form.level)) return false;

      // 2. Programme check
      const selProg = (form.programme || '').toLowerCase().trim();
      const cProg = (c.programme || '').toLowerCase().trim();
      if (cProg && cProg !== 'all') {
        const progMatch = cProg.includes(selProg) ||
          (selProg === 'degree' && (cProg.includes('degree') || cProg.includes('computer science') || cProg.includes('software') || cProg.includes('bit')));
        if (!progMatch) return false;
      }

      // 3. Course of Lecturing check
      const selCourse = (form.course || '').toLowerCase().trim();
      if (cProg && cProg !== 'all') {
        if (selCourse.includes('business') || selCourse.includes('bit')) {
          if (!cProg.includes('bit') && !cProg.includes('business') && !cProg.includes('degree') && !cProg.includes('all')) return false;
        } else if (selCourse.includes('software')) {
          if (!cProg.includes('software') && !cProg.includes('degree') && !cProg.includes('all')) return false;
        }
      }

      // 4. Semester check
      if (form.semester_id) {
        if (c.semester_id && c.semester_id !== form.semester_id) return false;
        const semObj = options.data?.semesters?.find(s => s.id === form.semester_id);
        const semName = (semObj?.name || '').toLowerCase();
        const isSem1 = semName.includes('first') || semName.includes('1');
        const isSem2 = semName.includes('second') || semName.includes('2');
        const match = c.code?.match(/\d+/);
        if (match && match[0].length >= 3) {
          const semDigit = match[0][1];
          if (isSem1 && semDigit === '2') return false;
          if (isSem2 && semDigit === '1') return false;
        }
      }

      return true;
    });
  }, [options.data?.courses, options.data?.semesters, form.level, form.programme, form.course, form.semester_id]);

  const toggleCourse = courseId => {
    setForm(prev => {
      const exists = prev.courses.includes(courseId);
      return {
        ...prev,
        courses: exists ? prev.courses.filter(id => id !== courseId) : [...prev.courses, courseId]
      };
    });
  };

  const handleCreate = e => {
    e.preventDefault();
    if (isLec && (!form.courses || form.courses.length === 0)) {
      return run('create-staff', async () => {
        throw new Error('Please select at least one module to assign to this lecturer.');
      });
    }

    run('create-staff', async () => {
      const currentYear = options.data?.academic_years?.find(y => y.is_current)?.id || options.data?.academic_years?.[0]?.id;
      const currentSem = options.data?.semesters?.find(s => s.is_current)?.id || options.data?.semesters?.[0]?.id;

      const payload = {
        role: targetRole,
        full_name: form.full_name.trim(),
        phone_number: form.phone_number.trim(),
        department: 'Computer Science',
        programme: form.programme,
        level: Number(form.level) || 1,
        academic_year_id: form.academic_year_id || currentYear,
        semester_id: form.semester_id || currentSem,
        student_id: (!isLec && form.student_id) ? form.student_id.trim() : null,
        courses: isLec ? form.courses : []
      };

      const res = await apiFetch('/staff', { method: 'POST', body: payload });
      setCreatedModal(res);
      setShowCreate(false);
      setForm({
        full_name: '',
        phone_number: '',
        student_id: '',
        department: 'Computer Science',
        programme: 'Degree',
        course: 'Computer Science',
        level: 1,
        academic_year_id: '',
        semester_id: '',
        courses: []
      });
      staff.reload();
    }, `${targetRole === 'lecturer' ? 'Lecturer' : 'Class representative'} account created.`);
  };

  const handleToggleStatus = (id, currentStatus) => run(`status-${id}`, async () => {
    await apiFetch(`/staff/${id}/status`, { method: 'PATCH', body: { is_active: !currentStatus } });
    staff.reload();
  });

  const handleToggleSent = (id, currentSent) => run(`sent-${id}`, async () => {
    await apiFetch(`/staff/${id}/credentials-sent`, { method: 'PATCH', body: { credentials_sent: !currentSent } });
    staff.reload();
  });

  // Direct reset by HOD on profile without prior request (valid 24h)
  const handleReset = staffMember => run(`reset-${staffMember.id}`, async () => {
    const res = await apiFetch(`/staff/${staffMember.id}/reset-password`, { method: 'POST' });
    setCreatedModal(res);
    resetRequests.reload();
    staff.reload();
  });

  // Approve reset request submitted by staff (valid 24h)
  const handleApproveReset = staffItem => run(`approve-${staffItem.id}`, async () => {
    const res = await apiFetch(`/staff/${staffItem.id}/approve-reset`, { method: 'POST' });
    setCreatedModal(res);
    resetRequests.reload();
    staff.reload();
  }, 'Temporary credentials generated. Send via WhatsApp below.');

  // Dismiss reset request
  const handleRejectReset = staffItem => run(`reject-${staffItem.id}`, async () => {
    await apiFetch(`/staff/${staffItem.id}/reject-reset`, { method: 'POST' });
    resetRequests.reload();
  }, 'Password reset request dismissed.');

  const handleOpenPhoneModal = staffItem => {
    setEditPhoneModal(staffItem);
    setNewPhoneInput(staffItem.phone_number || '');
  };

  const handleSavePhone = e => {
    e.preventDefault();
    if (!editPhoneModal) return;
    run('save-phone', async () => {
      await apiFetch(`/staff/${editPhoneModal.id}/phone`, {
        method: 'PATCH',
        body: { phone_number: newPhoneInput.trim() }
      });
      setEditPhoneModal(null);
      resetRequests.reload();
      staff.reload();
    }, 'Phone number verified and updated successfully.');
  };

  const pendingForRole = (resetRequests.data || []).filter(r => r.role === targetRole);

  return (
    <>
      <ErrorText>{staff.error || options.error || error}</ErrorText>
      <Success>{ok}</Success>

      {/* WhatsApp Credentials Modal */}
      {createdModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0 }}>
            <h3>Credentials Generated</h3>
            <p className="muted small">Send these credentials directly to <strong>{createdModal.full_name}</strong> via WhatsApp:</p>

            <div style={{ background: '#f4f7fb', padding: 14, borderRadius: 10, margin: '12px 0' }}>
              <div>Username: <b>{createdModal.username}</b></div>
              <div>Temporary Password: <b style={{ letterSpacing: 1 }}>{createdModal.password}</b></div>
              <div>Phone: <b>{createdModal.phone_number}</b></div>
              <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                One-time temporary password (valid 24 hours). The user must set a new permanent password on next login.
              </small>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <a
                className="whatsapp"
                style={{ justifyContent: 'center' }}
                href={buildWhatsAppLink(createdModal.phone_number, createdModal.full_name, createdModal.username, createdModal.password, createdModal.login_url)}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  if (createdModal.id) handleToggleSent(createdModal.id, false);
                }}
              >
                <Send size={16} /> Send via WhatsApp
              </a>
              <button className="secondary" onClick={() => setCreatedModal(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {/* In-Person Phone Verification Modal */}
      {editPhoneModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Verify & Update Phone</h3>
              <button className="link-button" onClick={() => setEditPhoneModal(null)}><X size={18} /></button>
            </div>
            <p className="muted small" style={{ margin: '0 0 12px' }}>
              Updating phone number for <strong>{editPhoneModal.full_name}</strong> ({editPhoneModal.username}).
            </p>

            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#92400e', marginBottom: 14, lineHeight: 1.5 }}>
              <ShieldAlert size={15} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              <strong>In-Person Verification Required:</strong> Confirm the staff member's physical identity before changing their registered number so credentials are never dispatched to an unauthorized recipient.
            </div>

            <form onSubmit={handleSavePhone}>
              <Field label="Verified Phone Number" hint="e.g. +232 76 123456">
                <input
                  type="tel"
                  value={newPhoneInput}
                  onChange={e => setNewPhoneInput(e.target.value)}
                  placeholder="+232 76 123456"
                  required
                  autoFocus
                />
              </Field>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="secondary" onClick={() => setEditPhoneModal(null)}>Cancel</button>
                <button type="submit" className="primary" disabled={busy === 'save-phone' || !newPhoneInput.trim()}>
                  {busy === 'save-phone' ? 'Updating…' : 'Save & Verify Phone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreate && (
        <Panel title={`Register New ${isLec ? 'Lecturer' : 'Class Representative'}`} action={<button className="link-button" onClick={() => setShowCreate(false)}>Cancel</button>}>
          <form onSubmit={handleCreate}>
            {isLec ? (
              <>
                {/* Section 1: Personal Information */}
                <div style={{ marginBottom: 18, borderBottom: '1px solid #e2e8f0', paddingBottom: 14 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: 12, alignItems: 'center', justifyContent: 'center' }}>1</span>
                    Personal Information
                  </h4>

                  <Field label="Full Name">
                    <input
                      value={form.full_name}
                      onChange={e => setForm({ ...form, full_name: e.target.value })}
                      placeholder="e.g. Dr. Francis Kamara"
                      required
                      minLength={3}
                    />
                  </Field>

                  <Field label="Phone Number" hint="Sierra Leone number e.g. +232 30 231858">
                    <input
                      value={form.phone_number}
                      onChange={e => setForm({ ...form, phone_number: e.target.value })}
                      placeholder="+232 76 123456"
                      required
                      inputMode="tel"
                    />
                  </Field>

                  <div className="form-grid">
                    <Field label="Programme">
                      <select
                        value={form.programme}
                        onChange={e => {
                          const nextProg = e.target.value;
                          const validLevels = getLevelsForProgramme(nextProg);
                          setForm(prev => ({
                            ...prev,
                            programme: nextProg,
                            level: validLevels.includes(prev.level) ? prev.level : 1,
                            courses: []
                          }));
                        }}
                      >
                        {PROGRAMME_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>

                    <Field label="Course of Lecturing">
                      <select
                        value={form.course}
                        onChange={e => setForm(prev => ({ ...prev, course: e.target.value, courses: [] }))}
                      >
                        {DEPT_COURSES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </Field>
                  </div>

                  <div className="form-grid">
                    <Field label="Academic Level">
                      <select
                        value={form.level}
                        onChange={e => setForm(prev => ({ ...prev, level: Number(e.target.value), courses: [] }))}
                      >
                        {getLevelsForProgramme(form.programme).map(lvl => (
                          <option key={lvl} value={lvl}>
                            Year {lvl} ({LEVEL_LABELS[lvl] || `Level ${lvl}`})
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Semester">
                      <select
                        value={form.semester_id}
                        onChange={e => setForm(prev => ({ ...prev, semester_id: e.target.value, courses: [] }))}
                      >
                        <option value="">All / Current Semester</option>
                        {options.data?.semesters?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                  </div>

                  <Field label="Academic Year">
                    <select value={form.academic_year_id} onChange={e => setForm({ ...form, academic_year_id: e.target.value })}>
                      <option value="">2026/2027 Academic Year (Current)</option>
                      {options.data?.academic_years?.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </Field>
                </div>

                {/* Section 2: Assign Modules via Multi-Select Checkboxes */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h4 style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: 12, alignItems: 'center', justifyContent: 'center' }}>2</span>
                      Assign Modules
                    </h4>
                    <span style={{ fontSize: 12, fontWeight: 600, color: form.courses.length > 0 ? '#1d4ed8' : '#64748b', background: form.courses.length > 0 ? '#eff6ff' : '#f1f5f9', padding: '3px 8px', borderRadius: 6 }}>
                      {form.courses.length} selected
                    </span>
                  </div>
                  <p className="muted small" style={{ marginBottom: 12 }}>
                    Filtered for <strong>{form.programme} · Year {form.level} · {form.course}</strong>. Check one or more modules to assign:
                  </p>

                  {(!filteredModules || !filteredModules.length) ? (
                    <Empty>
                      No modules found matching {form.programme} Year {form.level} for {form.course}. Check your options above.
                    </Empty>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                      {filteredModules.map(c => {
                        const isSelected = form.courses.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              padding: '12px 14px',
                              borderRadius: 10,
                              border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                              background: isSelected ? '#eff6ff' : '#ffffff',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <input
                              type="checkbox"
                              name="lecturer_assign_modules"
                              value={c.id}
                              checked={isSelected}
                              onChange={() => toggleCourse(c.id)}
                              style={{ width: 18, height: 18, accentColor: '#2563eb', cursor: 'pointer' }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <strong style={{ display: 'block', fontSize: 13, color: isSelected ? '#1d4ed8' : '#1e293b' }}>
                                {c.code} · {c.title}
                              </strong>
                              <span className="muted small" style={{ fontSize: 11 }}>
                                Level {c.level} · {c.credit_units || 3} Credits
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

              </>
            ) : (
              <>
                {/* Class Representative Form */}
                <Field label="Full Name">
                  <input
                    value={form.full_name}
                    onChange={e => setForm({ ...form, full_name: e.target.value })}
                    placeholder="e.g. John Sesay"
                    required
                    minLength={3}
                  />
                </Field>

                <Field label="Phone Number" hint="Sierra Leone number e.g. +232 30 231858">
                  <input
                    value={form.phone_number}
                    onChange={e => setForm({ ...form, phone_number: e.target.value })}
                    placeholder="+232 76 123456"
                    required
                    inputMode="tel"
                  />
                </Field>

                <Field label="Student ID">
                  <input
                    value={form.student_id}
                    onChange={e => setForm({ ...form, student_id: e.target.value })}
                    placeholder="e.g. STU-2026-0042"
                    required
                  />
                </Field>

                <div className="form-grid">
                  <Field label="Programme">
                    <select
                      value={form.programme}
                      onChange={e => {
                        const nextProg = e.target.value;
                        const validLevels = getLevelsForProgramme(nextProg);
                        setForm({
                          ...form,
                          programme: nextProg,
                          level: validLevels.includes(form.level) ? form.level : 1
                        });
                      }}
                    >
                      {PROGRAMME_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </Field>

                  <Field label="Course">
                    <select
                      value={form.course}
                      onChange={e => setForm({ ...form, course: e.target.value })}
                    >
                      {DEPT_COURSES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>

                <div className="form-grid">
                  <Field label="Academic Level">
                    <select
                      value={form.level}
                      onChange={e => setForm({ ...form, level: Number(e.target.value) })}
                    >
                      {getLevelsForProgramme(form.programme).map(lvl => (
                        <option key={lvl} value={lvl}>
                          Year {lvl} ({LEVEL_LABELS[lvl] || `Level ${lvl}`})
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Academic Year">
                    <select value={form.academic_year_id} onChange={e => setForm({ ...form, academic_year_id: e.target.value })}>
                      <option value="">2026/2027 Academic Year (Current)</option>
                      {options.data?.academic_years?.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Semester">
                  <select value={form.semester_id} onChange={e => setForm({ ...form, semester_id: e.target.value })}>
                    <option value="">Default (Current Semester)</option>
                    {options.data?.semesters?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="primary compact" disabled={busy === 'create-staff'}>
                {busy === 'create-staff' ? 'Creating…' : 'Create Account'}
              </button>
              <button type="button" className="secondary compact" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </Panel>
      )}

      {/* Staff Password Reset Requests (Requires HOD Approval) */}
      {pendingForRole.length > 0 && (
        <Panel title={`Staff Password Reset Requests (${pendingForRole.length} Pending)`}>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
            <strong>In-Person Phone Verification Required:</strong> Before approving, verify the phone number on file. If the staff member changed their phone number, verify them in person and update the number first so credentials are never sent to the wrong person.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pendingForRole.map(r => (
              <div key={r.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#ffffff' }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{r.full_name}</strong>
                    <span className="badge ok" style={{ textTransform: 'uppercase', fontSize: 10 }}>{r.role.replace('_', ' ')}</span>
                    <span className="muted small">({r.username})</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: '#475569' }}>Verified Phone on File:</span>
                    <strong style={{ fontFamily: 'monospace', fontSize: 14, color: '#0f172a', background: '#f1f5f9', padding: '2px 8px', borderRadius: 6 }}>
                      {r.phone_number}
                    </strong>
                  </div>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    Requested: {fmtDateTime(r.requested_at)}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="secondary compact"
                    onClick={() => handleOpenPhoneModal(r)}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    <Edit3 size={12} /> Update Phone
                  </button>
                  <button
                    className="primary compact"
                    onClick={() => handleApproveReset(r)}
                    disabled={busy === `approve-${r.id}`}
                    style={{ fontSize: 11, padding: '4px 10px', background: '#059669', borderColor: '#059669' }}
                  >
                    <KeyRound size={12} /> Generate Temporary Password & Send
                  </button>
                  <button
                    className="secondary compact danger"
                    onClick={() => handleRejectReset(r)}
                    disabled={busy === `reject-${r.id}`}
                    style={{ fontSize: 11, padding: '4px 8px' }}
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={title} action={!showCreate && <button className="primary compact" onClick={() => setShowCreate(true)}><UserPlus size={14} /> Add {isLec ? 'Lecturer' : 'Rep'}</button>}>
        {staff.loading ? <Loading text="Loading staff directory…" /> : !staff.data?.length ? (
          <Empty>No {title.toLowerCase()} accounts registered.</Empty>
        ) : (
          staff.data.map(p => {
            const courses = (p.lecturer_courses || []).map(lc => lc.courses?.code).filter(Boolean);
            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  padding: '14px 16px',
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  marginBottom: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                }}
              >
                {/* Header row: Avatar, Info, Badges */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <Avatar user={p} size={44} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: '#0f172a' }}>{p.full_name}</strong>
                      <span className="muted small" style={{ fontWeight: 600 }}>({p.username})</span>
                      <span className={p.is_active ? 'badge ok' : 'badge bad'} style={{ fontSize: 10, padding: '2px 8px' }}>
                        {p.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </div>

                    <div style={{ marginTop: 4, fontSize: 12, color: '#475569', lineHeight: 1.5, wordBreak: 'break-word' }}>
                      <div>Phone: <b style={{ color: '#0f172a' }}>{p.phone_number}</b> · Level {p.level || '—'} · {p.programme || 'Dept'}</div>
                      {courses.length > 0 && (
                        <div style={{ marginTop: 2, color: '#2563eb' }}>Courses: <b>{courses.join(', ')}</b></div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer row: Credentials sent & Action buttons */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  borderTop: '1px solid #f1f5f9',
                  paddingTop: 10
                }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#475569', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={p.credentials_sent}
                      onChange={() => handleToggleSent(p.id, p.credentials_sent)}
                      style={{ width: 16, height: 16, accentColor: '#2563eb' }}
                    />
                    <span>Credentials sent</span>
                  </label>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      className="secondary compact"
                      style={{ fontSize: 11, padding: '6px 10px', minHeight: 32 }}
                      title="Verify and update phone number in person"
                      onClick={() => handleOpenPhoneModal(p)}
                    >
                      <Edit3 size={13} /> Phone
                    </button>
                    <button
                      className="secondary compact"
                      style={{ fontSize: 11, padding: '6px 10px', minHeight: 32 }}
                      disabled={busy === `reset-${p.id}`}
                      onClick={() => handleReset(p)}
                    >
                      <RefreshCw size={13} /> Reset Password
                    </button>
                    <button
                      className={p.is_active ? 'danger compact' : 'secondary compact'}
                      style={{ fontSize: 11, padding: '6px 10px', minHeight: 32 }}
                      disabled={busy === `status-${p.id}`}
                      onClick={() => handleToggleStatus(p.id, p.is_active)}
                    >
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}

// =================================================================== HOD STUDENTS & AUTO-APPROVAL LIST
export function HodStudents() {
  const [tab, setTab] = useState('directory'); // 'directory', 'pending', 'reset-requests', 'upload'
  const students = useApi('/hod/students');
  const pending = useApi('/students/pending');
  const resetRequests = useApi('/students/reset-requests');
  const listStats = useApi('/hod/student-list');
  const [csvText, setCsvText] = useState('');
  const [uploadResult, setUploadResult] = useState(null);
  const [resetModal, setResetModal] = useState(null); // { full_name, student_id, phone_number, password }

  const { busy, error, ok, run } = useAction();

  const handleDecision = (id, decision) => run(`decision-${id}`, async () => {
    await apiFetch(`/students/${id}/decision`, { method: 'PATCH', body: { decision } });
    pending.reload();
    students.reload();
  }, `Student ${decision}.`);

  const handleToggleStatus = (id, is_active) => run(`toggle-${id}`, async () => {
    await apiFetch(`/hod/students/${id}/status`, { method: 'PATCH', body: { is_active: !is_active } });
    students.reload();
  });

  const handleResetPassword = student => run(`reset-${student.id}`, async () => {
    const res = await apiFetch(`/students/${student.id}/reset-password`, { method: 'POST' });
    setResetModal(res);
    resetRequests.reload();
  });

  const handleRejectReset = student => run(`reject-${student.id}`, async () => {
    await apiFetch(`/students/${student.id}/reject-reset`, { method: 'POST' });
    resetRequests.reload();
  }, 'Reset request dismissed.');

  const handleUploadList = e => {
    e.preventDefault();
    run('upload-list', async () => {
      // Parse CSV: student_id, full_name, programme, level
      const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
      const rows = lines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return {
          student_id: parts[0],
          full_name: parts[1] || 'Student',
          programme: parts[2] || PROGRAMMES[0],
          level: Number(parts[3]) || 1
        };
      });
      const res = await apiFetch('/hod/student-list', { method: 'POST', body: { rows } });
      setUploadResult(res);
      listStats.reload();
      students.reload();
      pending.reload();
    }, 'Student list uploaded and processed.');
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={tab === 'directory' ? 'primary compact' : 'secondary compact'} onClick={() => setTab('directory')}>
          Directory ({students.data?.length || 0})
        </button>
        <button className={tab === 'pending' ? 'primary compact' : 'secondary compact'} onClick={() => setTab('pending')}>
          Pending Registrations ({pending.data?.length || 0})
        </button>
        <button className={tab === 'reset-requests' ? 'primary compact' : 'secondary compact'} onClick={() => setTab('reset-requests')}>
          Reset Requests ({resetRequests.data?.length || 0})
        </button>
        <button className={tab === 'upload' ? 'primary compact' : 'secondary compact'} onClick={() => setTab('upload')}>
          Auto-Approval List
        </button>
      </div>

      <ErrorText>{students.error || pending.error || resetRequests.error || listStats.error || error}</ErrorText>
      <Success>{ok}</Success>

      {/* Student Temporary Password Modal */}
      {resetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0 }}>
            <h3>Temporary Password Generated</h3>
            <p className="muted small">Share this temporary password directly with <strong>{resetModal.full_name}</strong>:</p>
            <div style={{ background: '#f4f7fb', padding: 14, borderRadius: 10, margin: '12px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2, color: '#102a43' }}>{resetModal.password}</div>
              <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                Expires in 48 hours. Forced password change on first login.
              </small>
            </div>
            {resetModal.phone_number && (
              <a
                className="whatsapp"
                style={{ justifyContent: 'center', marginBottom: 8 }}
                href={`https://wa.me/${String(resetModal.phone_number || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${resetModal.full_name},\n\nYour temporary password for MMTU CS Attendance is: ${resetModal.password}\n\nPlease sign in and set your new permanent password.`)}`}
                target="_blank"
                rel="noreferrer"
              >
                <Send size={16} /> Send via WhatsApp
              </a>
            )}
            <button className="primary" style={{ width: '100%' }} onClick={() => setResetModal(null)}>Done</button>
          </div>
        </div>
      )}

      {tab === 'reset-requests' && (
        <Panel title={`Student Password Reset Requests (${resetRequests.data?.length || 0})`}>
          {!resetRequests.data?.length ? <Empty>No pending password reset requests from students.</Empty> : (
            resetRequests.data.map(s => (
              <div className="row" key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Avatar user={s} size={40} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong>{s.full_name}</strong> {s.student_id ? <span className="muted">({s.student_id})</span> : ''}
                  <p className="muted small">Level {s.level} · {s.programme} · Phone: {s.phone_number}</p>
                  <p className="muted small">Requested: {fmtDateTime(s.requested_at)}</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="primary compact"
                    style={{ background: '#059669', borderColor: '#059669' }}
                    disabled={busy === `reset-${s.id}`}
                    onClick={() => handleResetPassword(s)}
                  >
                    <KeyRound size={14} /> Generate Temporary Password
                  </button>
                  <button
                    className="secondary compact danger"
                    disabled={busy === `reject-${s.id}`}
                    onClick={() => handleRejectReset(s)}
                  >
                    <X size={14} /> Dismiss
                  </button>
                </div>
              </div>
            ))
          )}
        </Panel>
      )}

      {tab === 'upload' && (
        <Panel title="Upload Student ID List for Auto-Approval">
          <p className="muted small">
            Paste CSV lines with: <code>student_id, full_name, programme, level</code>. Students registering with matching IDs will be automatically approved.
          </p>
          <div className="stat-grid" style={{ marginBottom: 14 }}>
            <Stat label="Total in Department List" value={listStats.data?.total || 0} />
            <Stat label="Claimed by Registered Students" value={listStats.data?.claimed || 0} tone="primary" />
          </div>

          <form onSubmit={handleUploadList}>
            <Field label="CSV Data (one student per line)">
              <textarea
                rows={6}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #dce4ec', fontFamily: 'monospace', fontSize: 12 }}
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                placeholder="23201001, Mohamed Kamara, BSc Computer Science, 1&#10;23201002, Aminata Bangura, BSc Computer Science, 1"
                required
              />
            </Field>

            <button className="primary" disabled={busy === 'upload-list'} style={{ marginTop: 10 }}>
              <Upload size={16} /> {busy === 'upload-list' ? 'Importing…' : 'Import & Auto-Approve'}
            </button>
          </form>

          {uploadResult && (
            <div className="credential" style={{ marginTop: 14 }}>
              <strong>Import Summary:</strong>
              <div>Imported: {uploadResult.imported}</div>
              <div>Auto-approved existing pending students: {uploadResult.auto_approved_existing}</div>
            </div>
          )}
        </Panel>
      )}

      {tab === 'pending' && (
        <Panel title={`Pending Student Registrations (${pending.data?.length || 0})`}>
          {!pending.data?.length ? <Empty>No pending applications awaiting approval.</Empty> : (
            pending.data.map(s => (
              <div className="row" key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar user={s} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{s.full_name}</strong> {s.student_id ? <span className="muted">({s.student_id})</span> : ''}
                  <p className="muted small">Level {s.level} · {s.programme} · {s.phone_number}</p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="primary compact" disabled={busy === `decision-${s.id}`} onClick={() => handleDecision(s.id, 'approved')}>
                    <Check size={14} /> Approve
                  </button>
                  <button className="danger compact" disabled={busy === `decision-${s.id}`} onClick={() => handleDecision(s.id, 'rejected')}>
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </Panel>
      )}

      {tab === 'directory' && (
        <Panel title="Registered Students">
          {!students.data?.length ? <Empty>No students registered.</Empty> : (
            students.data.map(s => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '14px 16px',
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  marginBottom: 10,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <Avatar user={s} size={42} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15, color: '#0f172a' }}>{s.full_name}</strong>
                      {s.student_id ? <span className="muted small" style={{ fontWeight: 600 }}>({s.student_id})</span> : ''}
                      <Badge status={s.account_status}>{STATUS_LABEL[s.account_status]}</Badge>
                      <span className={s.is_active ? 'badge ok' : 'badge bad'} style={{ fontSize: 10 }}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="muted small" style={{ margin: '4px 0 0', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      Level {s.level} · {s.programme} · Phone: <b style={{ color: '#0f172a' }}>{s.phone_number}</b>
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                  flexWrap: 'wrap',
                  borderTop: '1px solid #f1f5f9',
                  paddingTop: 8
                }}>
                  <button
                    className="secondary compact"
                    style={{ fontSize: 11, padding: '5px 10px', minHeight: 30 }}
                    title="Generate Temporary Password"
                    disabled={busy === `reset-${s.id}`}
                    onClick={() => handleResetPassword(s)}
                  >
                    <KeyRound size={12} /> Reset Password
                  </button>
                  <button
                    className={s.is_active ? 'danger compact' : 'secondary compact'}
                    style={{ fontSize: 11, padding: '5px 10px', minHeight: 30 }}
                    disabled={busy === `toggle-${s.id}`}
                    onClick={() => handleToggleStatus(s.id, s.is_active)}
                  >
                    {s.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))
          )}
        </Panel>
      )}
    </>
  );
}

// =================================================================== HOD ATTENDANCE RECORDS
export function HodAttendance() {
  const options = useApi('/hod/options');
  const [level, setLevel] = useState('');
  const [courseId, setCourseId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const attendance = useApi(`/hod/attendance?${new URLSearchParams({
    ...(level ? { level } : {}),
    ...(courseId ? { course_id: courseId } : {}),
    ...(status ? { status } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {})
  }).toString()}`);

  return (
    <>
      <ErrorText>{attendance.error || options.error}</ErrorText>
      <Panel title="Departmental Attendance Records">
        <div className="form-grid">
          <Field label="Academic Level">
            <select value={level} onChange={e => setLevel(e.target.value)}>
              <option value="">All Levels</option>
              {LEVELS.map(l => <option key={l} value={l}>Level {l}</option>)}
            </select>
          </Field>
          <Field label="Course">
            <select value={courseId} onChange={e => setCourseId(e.target.value)}>
              <option value="">All Courses</option>
              {options.data?.courses?.map(c => <option key={c.id} value={c.id}>{c.code} - {c.title}</option>)}
            </select>
          </Field>
        </div>

        <div className="form-grid" style={{ marginBottom: 14 }}>
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="From Date">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </Field>
        </div>

        {attendance.loading ? <Loading text="Loading records…" /> : !attendance.data?.rows?.length ? (
          <Empty>No attendance records match the filters.</Empty>
        ) : (
          attendance.data.rows.map(r => {
            const student = r.profiles || {};
            const sess = r.class_sessions || {};
            const course = sess.timetable_entries?.courses || {};
            return (
              <div className="row" key={r.id}>
                <div>
                  <strong>{student.full_name}</strong> {student.student_id ? <span className="muted">({student.student_id})</span> : ''}
                  <p className="muted small">
                    {course.code} (Level {student.level}) · {fmtDate(sess.session_date)} · {fmtDateTime(r.submitted_at)}
                    {r.submitted_offline ? ' · (Offline)' : ''}
                  </p>
                  {r.review_note && <p className="muted small" style={{ color: '#b42318' }}>Note: {r.review_note}</p>}
                </div>
                <Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge>
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}

// =================================================================== HOD REPORTS & EXPORTS
export function HodReports() {
  return <ReportsPage isHod={true} />;
}

// =================================================================== HOD ACADEMIC SETUP
export function HodAcademic() {
  const options = useApi('/hod/options');
  const settings = useApi('/hod/settings');
  const [threshold, setThreshold] = useState(75);
  const [requireQr, setRequireQr] = useState(false);
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [yearName, setYearName] = useState('');
  const [semName, setSemName] = useState('');
  const [courseForm, setCourseForm] = useState({ code: '', title: '', level: 1 });
  const [venueForm, setVenueForm] = useState({ name: '', latitude: 8.4657, longitude: -13.2317, radius_m: 60 });
  const [allocLevel, setAllocLevel] = useState(1);

  const { busy, error, ok, run } = useAction();

  useEffect(() => {
    if (settings.data && !settingsLoaded) {
      if (settings.data.min_attendance_threshold !== undefined) setThreshold(settings.data.min_attendance_threshold);
      if (settings.data.require_qr_or_code !== undefined) setRequireQr(Boolean(settings.data.require_qr_or_code));
      if (settings.data.attendance_grace_minutes !== undefined) setGraceMinutes(settings.data.attendance_grace_minutes);
      setSettingsLoaded(true);
    }
  }, [settings.data, settingsLoaded]);

  const handleSaveSettings = e => {
    e.preventDefault();
    run('settings', async () => {
      await apiFetch('/hod/settings', {
        method: 'PATCH',
        body: {
          min_attendance_threshold: Number(threshold),
          require_qr_or_code: Boolean(requireQr),
          attendance_grace_minutes: Number(graceMinutes)
        }
      });
      settings.reload();
    }, 'Department attendance settings updated.');
  };

  const handleCreateYear = e => {
    e.preventDefault();
    run('year', async () => {
      await apiFetch('/hod/academic-years', { method: 'POST', body: { name: yearName.trim(), is_current: true } });
      setYearName('');
      options.reload();
    }, 'Academic year created.');
  };

  const handleCreateSem = e => {
    e.preventDefault();
    const currentYear = options.data?.academic_years?.find(y => y.is_current)?.id || options.data?.academic_years?.[0]?.id;
    if (!currentYear) return;
    run('sem', async () => {
      await apiFetch('/hod/semesters', { method: 'POST', body: { academic_year_id: currentYear, name: semName.trim(), is_current: true } });
      setSemName('');
      options.reload();
    }, 'Semester created.');
  };

  const handleCreateCourse = e => {
    e.preventDefault();
    run('course', async () => {
      await apiFetch('/hod/courses', { method: 'POST', body: { ...courseForm, level: Number(courseForm.level) } });
      setCourseForm({ code: '', title: '', level: 1 });
      options.reload();
    }, 'Course created.');
  };

  const handleCreateVenue = e => {
    e.preventDefault();
    run('venue', async () => {
      await apiFetch('/hod/venues', { method: 'POST', body: venueForm });
      setVenueForm({ name: '', latitude: 8.4657, longitude: -13.2317, radius_m: 60 });
      options.reload();
    }, 'Venue added.');
  };

  const handleAllocateLevel = () => {
    const curYear = options.data?.academic_years?.find(y => y.is_current)?.id || options.data?.academic_years?.[0]?.id;
    const curSem = options.data?.semesters?.find(s => s.is_current)?.id || options.data?.semesters?.[0]?.id;
    if (!curYear || !curSem) return;
    run('allocate', async () => {
      const res = await apiFetch('/hod/registrations/allocate-level', {
        method: 'POST',
        body: { level: allocLevel, academic_year_id: curYear, semester_id: curSem }
      });
      return res;
    }, `Allocated Level ${allocLevel} students to their courses.`);
  };

  return (
    <>
      <ErrorText>{options.error || settings.error || error}</ErrorText>
      <Success>{ok}</Success>

      <Panel title="Department Attendance Policy & Automatic Sessions">
        <p className="muted small" style={{ margin: '0 0 16px' }}>
          Configure department-wide rules for class session lifecycles and student attendance verification.
        </p>
        <form onSubmit={handleSaveSettings}>
          <div className="form-grid">
            <Field label="Minimum Attendance Threshold (%)" hint="Students below this percentage are flagged as at-risk.">
              <input
                type="number"
                min={1}
                max={100}
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                required
              />
            </Field>

            <Field label="Session Grace Period (minutes)" hint="Extra time after lecture scheduled end before auto-marking absents.">
              <input
                type="number"
                min={0}
                max={120}
                value={graceMinutes}
                onChange={e => setGraceMinutes(e.target.value)}
                required
              />
            </Field>
          </div>

          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '16px',
            margin: '16px 0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}>
            <input
              type="checkbox"
              id="require_qr_toggle"
              checked={requireQr}
              onChange={e => setRequireQr(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 2, cursor: 'pointer' }}
            />
            <label htmlFor="require_qr_toggle" style={{ cursor: 'pointer', flex: 1 }}>
              <strong style={{ display: 'block', fontSize: 14, color: '#0f172a' }}>
                Require QR or class code for attendance (Default: OFF)
              </strong>
              <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
                When <strong>OFF</strong>, students tap "Mark Present" inside the lecture hall; device GPS verifies physical presence within the venue boundary.
                When <strong>ON</strong>, students must additionally scan the lecturer's rotating QR code or enter the 6-digit class code to submit attendance.
              </span>
            </label>
          </div>

          <button className="primary compact" disabled={busy === 'settings'}>
            {busy === 'settings' ? 'Saving Policy…' : 'Save Attendance Policy'}
          </button>
        </form>
      </Panel>

      <Panel title="Academic Years & Semesters">
        <div className="form-grid">
          <div>
            <h3>Add Academic Year</h3>
            <form onSubmit={handleCreateYear}>
              <Field label="Year Name (e.g. 2026/2027)">
                <input value={yearName} onChange={e => setYearName(e.target.value)} required />
              </Field>
              <button className="primary compact" disabled={busy === 'year'}>Create Year</button>
            </form>
          </div>
          <div>
            <h3>Add Semester</h3>
            <form onSubmit={handleCreateSem}>
              <Field label="Semester Name (e.g. Semester 1)">
                <input value={semName} onChange={e => setSemName(e.target.value)} required />
              </Field>
              <button className="primary compact" disabled={busy === 'sem'}>Create Semester</button>
            </form>
          </div>
        </div>
      </Panel>

      <Panel title="Add Course">
        <form onSubmit={handleCreateCourse}>
          <div className="form-grid">
            <Field label="Course Code (e.g. COMS 101)">
              <input value={courseForm.code} onChange={e => setCourseForm({ ...courseForm, code: e.target.value })} required />
            </Field>
            <Field label="Course Title">
              <input value={courseForm.title} onChange={e => setCourseForm({ ...courseForm, title: e.target.value })} required />
            </Field>
          </div>
          <Field label="Level">
            <select value={courseForm.level} onChange={e => setCourseForm({ ...courseForm, level: Number(e.target.value) })}>
              {LEVELS.map(l => <option key={l} value={l}>Level {l}</option>)}
            </select>
          </Field>
          <button className="primary compact" disabled={busy === 'course'}>Save Course</button>
        </form>
      </Panel>

      <Panel title="Add Lecture Venue">
        <form onSubmit={handleCreateVenue}>
          <Field label="Venue Name (e.g. Computer Lab 1)">
            <input value={venueForm.name} onChange={e => setVenueForm({ ...venueForm, name: e.target.value })} required />
          </Field>
          <div className="form-grid">
            <Field label="Latitude">
              <input type="number" step="any" value={venueForm.latitude} onChange={e => setVenueForm({ ...venueForm, latitude: Number(e.target.value) })} required />
            </Field>
            <Field label="Longitude">
              <input type="number" step="any" value={venueForm.longitude} onChange={e => setVenueForm({ ...venueForm, longitude: Number(e.target.value) })} required />
            </Field>
          </div>
          <Field label="Permitted Radius (meters)">
            <input type="number" value={venueForm.radius_m} onChange={e => setVenueForm({ ...venueForm, radius_m: Number(e.target.value) })} min={10} max={2000} required />
          </Field>
          <button className="primary compact" disabled={busy === 'venue'}>Save Venue</button>
        </form>
      </Panel>

      <Panel title="Level-wide Course Enrollment">
        <p className="muted small">Enroll all approved students of a level into that level's active courses for the current semester:</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={allocLevel} onChange={e => setAllocLevel(Number(e.target.value))}>
            {LEVELS.map(l => <option key={l} value={l}>Level {l}</option>)}
          </select>
          <button className="primary compact" disabled={busy === 'allocate'} onClick={handleAllocateLevel}>
            Enroll Level {allocLevel}
          </button>
        </div>
      </Panel>
    </>
  );
}
