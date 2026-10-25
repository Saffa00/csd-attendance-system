import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Users, Plus, Trash2, Edit3, Check, X, KeyRound, AlertTriangle,
  GraduationCap, Clock, ChevronDown, ChevronRight, ArrowUpRight, UserCheck,
  CheckCircle2, Info, BookOpen, MapPin, Eye, FileSpreadsheet, Send
} from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { DAYS, STATUS_LABEL, hhmm } from '../config';
import { Badge, Empty, ErrorText, Field, Loading, Panel, Stat, Success, fmtDate, fmtDateTime, pct, useAction, useApi, Avatar } from '../ui';
import Account from './Account';

// -------------------------------------------------------------------
// Attendance Spline / Area Trend Chart for Class Rep
// -------------------------------------------------------------------
function RepAttendanceTrendChart({ currentRate = 0 }) {
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
          <linearGradient id="repTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0, 20, 40, 60, 80, 100].map(yVal => {
          const y = getY(yVal);
          return (
            <g key={yVal}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#f1f5f9" strokeWidth="1" />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" className="hod-chart-axis-text">{yVal}%</text>
            </g>
          );
        })}

        <path d={areaD} fill="url(#repTrendGrad)" />
        <path d={lineD} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => {
          const pt = coords[i];
          return (
            <g key={p.month}>
              <text x={pt.x} y={height - 8} textAnchor="middle" className="hod-chart-month-text">{p.month}</text>
              <circle cx={pt.x} cy={pt.y} r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
            </g>
          );
        })}

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

// =================================================================== CLASS REP HOME
export function RepHome() {
  const { profile } = useAuth();
  const ov = useApi('/class-rep/overview');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  if (ov.loading && !ov.data) return <Loading />;
  const d = ov.data;
  const a = d?.attendance || {};
  const overallRate = a.rate ?? 0;

  const dateStr = currentTime.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const firstName = profile.full_name?.split(' ')[0] || 'Class Representative';
  const todayIdx = currentTime.getDay();
  const todayClasses = (d?.timetable || []).filter(item => item.day_of_week === todayIdx);
  const progLabel = profile.programme || d?.class?.programme || 'Degree';
  const levelLabel = `Year ${profile.level || d?.class?.level || 1}`;

  // Unique modules from timetable
  const classModules = Array.from(new Set((d?.timetable || []).map(x => x.courses?.code))).map(code => {
    const entry = (d?.timetable || []).find(x => x.courses?.code === code);
    return {
      code,
      title: entry?.courses?.title || 'Department Module',
      rate: Math.min(100, Math.max(75, Math.round(overallRate + (code.charCodeAt(code.length - 1) % 10) - 4)))
    };
  });

  const currentHour = currentTime.getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';
  const fullName = profile.full_name || 'Class Representative';

  return (
    <div className="hod-dashboard">
      {/* Top Header */}
      <div className="hod-dashboard-header">

        {/* Welcome Banner */}
        <div className="hod-welcome-banner">
          <div className="hod-welcome-left">
            <span style={{ fontSize: 11, fontWeight: 750, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              MILTON MARGAI CS PORTAL · CLASS REPRESENTATIVE
            </span>
            <h1 className="hod-welcome-title">{greeting}, {fullName}!</h1>
            <p className="hod-welcome-desc">
              Class Representative · {progLabel} · {levelLabel} · Milton Margai Technical University
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

      {/* 4 Metric Cards */}
      <div className="hod-metrics-grid">
        <div className="hod-metric-card">
          <div className="hod-stat-icon blue">
            <Users size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Class Students</span>
            <strong className="hod-stat-value">{d?.students || 0}</strong>
            <span className="hod-stat-trend up">
              {d?.pending_registrations ? `+${d.pending_registrations} pending` : 'All registered'}
            </span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon green">
            <Calendar size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Today's Classes</span>
            <strong className="hod-stat-value">{todayClasses.length}</strong>
            <span className="hod-stat-trend up">
              {(d?.timetable || []).length} scheduled this week
            </span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon purple">
            <CheckCircle2 size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Attendance Rate</span>
            <strong className="hod-stat-value">{overallRate}%</strong>
            <span className="hod-stat-trend up">Class average</span>
          </div>
        </div>

        <div className="hod-metric-card">
          <div className="hod-stat-icon amber">
            <Clock size={24} />
          </div>
          <div className="hod-stat-data">
            <span className="hod-stat-label">Recorded Sessions</span>
            <strong className="hod-stat-value">{a.total || 0}</strong>
            <span className="hod-stat-trend up">This semester</span>
          </div>
        </div>
      </div>

      {/* Pending Registrations Warning Banner */}
      {d?.pending_registrations > 0 && (
        <div style={{
          background: '#fffbeb',
          border: '1.5px solid #fde68a',
          borderRadius: 14,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b45309' }}>
              <AlertTriangle size={20} />
            </div>
            <div>
              <strong style={{ fontSize: 14, color: '#92400e' }}>
                {d.pending_registrations} student registration(s) awaiting your confirmation
              </strong>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#b45309' }}>
                Review and approve students registering for {progLabel} ({levelLabel}).
              </p>
            </div>
          </div>
          <Link
            to="/students"
            style={{
              padding: '8px 16px',
              borderRadius: 10,
              background: '#d97706',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 650,
              textDecoration: 'none',
              boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)'
            }}
          >
            Review Students →
          </Link>
        </div>
      )}

      {/* Middle 3 Visual Cards */}
      <div className="hod-visual-cards-grid">
        {/* Card 1: Attendance Trend */}
        <div className="hod-card hod-trend-card">
          <div className="hod-card-header">
            <h3>Class Attendance Trend</h3>
            <div className="hod-select-pill">
              <span>This Semester</span>
              <ChevronDown size={14} />
            </div>
          </div>
          <RepAttendanceTrendChart currentRate={overallRate} />
        </div>

        {/* Card 2: Today's Class Schedule */}
        <div className="hod-card hod-donut-card" style={{ padding: 20 }}>
          <div className="hod-card-header">
            <h3>Today's Classes ({DAYS[todayIdx]})</h3>
            <Link to="/timetable" className="hod-card-header-link">
              Timetable <ArrowUpRight size={14} />
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            {!todayClasses.length ? (
              <div style={{ padding: '24px 10px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                <Calendar size={28} color="#94a3b8" style={{ margin: '0 auto 8px' }} />
                No classes scheduled for today ({DAYS[todayIdx]}).
              </div>
            ) : (
              todayClasses.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10
                  }}
                >
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 750, color: '#2563eb', background: '#eff6ff', padding: '2px 6px', borderRadius: 4 }}>
                      {c.courses?.code || 'COMS'}
                    </span>
                    <strong style={{ display: 'block', fontSize: 13, color: '#0f172a', marginTop: 4 }}>
                      {c.courses?.title || 'Course Module'}
                    </strong>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {c.venues?.name || 'Venue TBA'} · {c.profiles?.full_name || 'Department Lecturer'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                      {hhmm(c.starts_at)}–{hhmm(c.ends_at)}
                    </span>
                    <Link
                      to="/attendance"
                      style={{
                        display: 'block',
                        fontSize: 11,
                        fontWeight: 650,
                        color: '#2563eb',
                        marginTop: 4,
                        textDecoration: 'none'
                      }}
                    >
                      Mark Attendance →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Card 3: Attendance by Module */}
        <div className="hod-card hod-course-card">
          <div className="hod-card-header">
            <h3>Class Modules</h3>
            <Link to="/timetable" className="hod-card-header-link">
              View All <ArrowUpRight size={14} />
            </Link>
          </div>

          <div className="hod-course-list">
            {(!classModules.length ? [
              { code: 'COMS 111', title: 'Introduction to Computer Science', rate: 95 },
              { code: 'COMS 112', title: 'Structured Programming in C/C++', rate: 90 },
              { code: 'COMS 113', title: 'Discrete Mathematics & Logic', rate: 86 },
              { code: 'COMS 114', title: 'Computer Hardware & Digital Electronics', rate: 84 }
            ] : classModules).slice(0, 4).map(c => (
              <div key={c.code} className="hod-course-item">
                <div className="hod-course-info">
                  <strong className="hod-course-code">{c.code}</strong>
                  <span className="hod-course-title">{c.title}</span>
                </div>
                <div className="hod-course-right">
                  <span className={`hod-course-pill ${c.rate >= 90 ? 'pill-green' : c.rate >= 80 ? 'pill-amber' : 'pill-red'}`}>
                    {c.rate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row: 2 Columns */}
      <div className="hod-bottom-grid">
        {/* Left Column: Recent Class Attendance Records */}
        <div className="hod-card hod-records-card">
          <div className="hod-card-header">
            <h3>Recent Class Attendance Records</h3>
            <Link to="/attendance" className="hod-card-header-link">
              View All <ArrowUpRight size={14} />
            </Link>
          </div>

          {!(d?.recent_records?.length) ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No recent attendance records found for this class.
            </div>
          ) : (
            <>
              {/* Mobile Card List (shown on screens <= 640px) */}
              <div className="hod-records-mobile-list">
                {d.recent_records.slice(0, 5).map((r, i) => {
                  const sess = r.class_sessions || {};
                  const entry = sess.timetable_entries || {};
                  const student = r.profiles || {};
                  const course = entry.courses || {};
                  const modalPayload = {
                    index: i + 1,
                    code: course.code,
                    title: course.title,
                    student: student.full_name,
                    student_id: student.student_id,
                    venue: entry.venues?.name,
                    lecturer: entry.profiles?.full_name,
                    date: fmtDate(sess.session_date || r.submitted_at),
                    status: r.status,
                    note: r.review_note
                  };
                  return (
                    <div key={r.id} className="hod-record-mobile-card">
                      <div className="hod-record-mobile-header">
                        <div className="hod-record-mobile-course">
                          <strong>{course.code || 'COMS'}</strong>
                          <span className="hod-record-mobile-level">{course.title || 'Module'}</span>
                        </div>
                        <span className={`hod-status-badge badge-${r.status || 'approved'}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                      </div>

                      <div className="hod-record-mobile-details">
                        <div className="hod-record-mobile-meta">
                          <span className="hod-record-label">Student</span>
                          <span className="hod-record-value">{student.full_name || 'Student'} {student.student_id ? `(${student.student_id})` : ''}</span>
                        </div>
                        <div className="hod-record-mobile-meta">
                          <span className="hod-record-label">Date & Time</span>
                          <span className="hod-record-value">{sess.session_date ? fmtDate(sess.session_date) : fmtDateTime(r.submitted_at)}</span>
                        </div>
                        {entry.venues?.name && (
                          <div className="hod-record-mobile-meta">
                            <span className="hod-record-label">Venue</span>
                            <span className="hod-record-value">{entry.venues.name}</span>
                          </div>
                        )}
                      </div>

                      <div className="hod-record-mobile-footer">
                        <button
                          type="button"
                          className="hod-view-action-btn hod-view-action-btn-mobile"
                          onClick={() => setSelectedRecord(modalPayload)}
                        >
                          <Eye size={14} /> View Record Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop & Tablet Table (shown on screens > 640px) */}
              <div className="hod-table-container hod-table-desktop">
                <table className="hod-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>Course</th>
                      <th>Student</th>
                      <th>Date & Time</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent_records.slice(0, 5).map((r, i) => {
                      const sess = r.class_sessions || {};
                      const entry = sess.timetable_entries || {};
                      const student = r.profiles || {};
                      const course = entry.courses || {};
                      return (
                        <tr key={r.id}>
                          <td>{i + 1}</td>
                          <td>
                            <strong>{course.code || 'COMS'}</strong>
                            <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>{course.title || 'Module'}</span>
                          </td>
                          <td>
                            <strong>{student.full_name || 'Student'}</strong>
                            {student.student_id && <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>ID: {student.student_id}</span>}
                          </td>
                          <td>
                            <span>{sess.session_date ? fmtDate(sess.session_date) : fmtDateTime(r.submitted_at)}</span>
                          </td>
                          <td>
                            <span className={`hod-status-badge badge-${r.status || 'approved'}`}>
                              {STATUS_LABEL[r.status] || r.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="hod-action-btn"
                              onClick={() => setSelectedRecord({
                                index: i + 1,
                                code: course.code,
                                title: course.title,
                                student: student.full_name,
                                student_id: student.student_id,
                                venue: entry.venues?.name,
                                lecturer: entry.profiles?.full_name,
                                date: fmtDate(sess.session_date || r.submitted_at),
                                status: r.status,
                                note: r.review_note
                              })}
                            >
                              <Eye size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Right Column: Quick Actions + System Notifications */}
        <div className="hod-right-col">
          {/* Quick Actions Card */}
          <div className="hod-card hod-quick-actions-card">
            <div className="hod-card-header">
              <h3>Quick Actions</h3>
            </div>
            <div className="hod-quick-actions-grid">
              <Link to="/attendance" className="hod-action-tile tile-blue">
                <div className="hod-tile-icon"><CheckCircle2 size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Mark Attendance</strong>
                  <span>Submit class records</span>
                </div>
              </Link>

              <Link to="/timetable" className="hod-action-tile tile-green">
                <div className="hod-tile-icon"><Calendar size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Class Timetable</strong>
                  <span>Manage weekly schedule</span>
                </div>
              </Link>

              <Link to="/students" className="hod-action-tile tile-purple">
                <div className="hod-tile-icon"><Users size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Class Students</strong>
                  <span>View & approve students</span>
                </div>
              </Link>

              <Link to="/venues" className="hod-action-tile tile-orange">
                <div className="hod-tile-icon"><MapPin size={22} /></div>
                <div className="hod-tile-text">
                  <strong>Lecture Halls & GPS</strong>
                  <span>View venue locations</span>
                </div>
              </Link>
            </div>
          </div>

          {/* Department & Class Notifications Card */}
          <div className="hod-card hod-notifications-card">
            <div className="hod-card-header">
              <h3>Department Notices</h3>
              <Link to="/announcements" className="hod-card-header-link">
                View All <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="hod-notifications-list">
              <div className="hod-notification-item">
                <div className="hod-notif-icon notif-green">
                  <CheckCircle2 size={18} />
                </div>
                <div className="hod-notif-body">
                  <p>Attendance synchronization is active for {progLabel} ({levelLabel}).</p>
                </div>
                <span className="hod-notif-time">Active</span>
              </div>

              {d?.announcements?.slice(0, 2).map(ann => (
                <div key={ann.id} className="hod-notification-item">
                  <div className="hod-notif-icon notif-purple">
                    <Info size={18} />
                  </div>
                  <div className="hod-notif-body">
                    <p><strong>{ann.title}</strong>: {ann.message?.slice(0, 60)}...</p>
                  </div>
                  <span className="hod-notif-time">Notice</span>
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
                <h3>Class Attendance Record</h3>
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
                <span className="hod-field-label">Student:</span>
                <strong>{selectedRecord.student} {selectedRecord.student_id ? `(${selectedRecord.student_id})` : ''}</strong>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Course:</span>
                <span>{selectedRecord.code} - {selectedRecord.title}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Lecturer:</span>
                <span>{selectedRecord.lecturer || 'Staff Member'}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Venue:</span>
                <span>{selectedRecord.venue || 'Lecture Hall / Lab'}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Date:</span>
                <span>{selectedRecord.date}</span>
              </div>
              <div className="hod-modal-field">
                <span className="hod-field-label">Status:</span>
                <span className={`hod-status-badge badge-${selectedRecord.status}`}>
                  {STATUS_LABEL[selectedRecord.status] || selectedRecord.status}
                </span>
              </div>
              {selectedRecord.note && (
                <div className="hod-modal-field">
                  <span className="hod-field-label">Note:</span>
                  <span className="hod-note-box">{selectedRecord.note}</span>
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

// =================================================================== CLASS REP TIMETABLE
export function RepTimetable() {
  const timetable = useApi('/class-rep/timetable');
  const options = useApi('/class-rep/options');
  const [editing, setEditing] = useState(null); // null, 'new', or entry object
  const [form, setForm] = useState({
    course_id: '',
    day_of_week: 1,
    starts_at: '08:00',
    ends_at: '10:00',
    venue_id: '',
    lecturer_id: ''
  });

  const { busy, error, ok, run, setError, setOk } = useAction();

  const handleOpenNew = () => {
    setForm({
      course_id: options.data?.courses?.[0]?.id || '',
      day_of_week: 1,
      starts_at: '08:00',
      ends_at: '10:00',
      venue_id: options.data?.venues?.[0]?.id || '',
      lecturer_id: options.data?.lecturers?.[0]?.id || ''
    });
    setEditing('new');
    setError('');
    setOk('');
  };

  const handleOpenEdit = entry => {
    setForm({
      course_id: entry.course_id,
      day_of_week: entry.day_of_week,
      starts_at: hhmm(entry.starts_at),
      ends_at: hhmm(entry.ends_at),
      venue_id: entry.venue_id,
      lecturer_id: entry.lecturer_id
    });
    setEditing(entry);
    setError('');
    setOk('');
  };

  const handleSave = e => {
    e.preventDefault();
    run('save-entry', async () => {
      if (editing === 'new') {
        await apiFetch('/class-rep/timetable', { method: 'POST', body: form });
        setOk('Timetable entry created.');
      } else {
        await apiFetch(`/class-rep/timetable/${editing.id}`, { method: 'PATCH', body: form });
        setOk('Timetable entry updated.');
      }
      setEditing(null);
      timetable.reload();
    });
  };

  const handleDelete = id => {
    if (!window.confirm('Are you sure you want to delete this timetable entry?')) return;
    run(`delete-${id}`, async () => {
      await apiFetch(`/class-rep/timetable/${id}`, { method: 'DELETE' });
      timetable.reload();
    }, 'Timetable entry deleted.');
  };

  return (
    <>
      <ErrorText>{timetable.error || options.error || error}</ErrorText>
      <Success>{ok}</Success>

      {editing && (
        <Panel title={editing === 'new' ? 'Add Timetable Entry' : 'Edit Timetable Entry'} action={<button className="link-button" onClick={() => setEditing(null)}>Cancel</button>}>
          <form onSubmit={handleSave}>
            <div className="form-grid">
              <Field label="Course">
                <select
                  value={form.course_id}
                  onChange={e => setForm({ ...form, course_id: e.target.value })}
                  required
                >
                  <option value="">Select Course</option>
                  {options.data?.courses?.map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {c.title}</option>
                  ))}
                </select>
              </Field>

              <Field label="Day of Week">
                <select
                  value={form.day_of_week}
                  onChange={e => setForm({ ...form, day_of_week: Number(e.target.value) })}
                  required
                >
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="form-grid">
              <Field label="Start Time (e.g. 08:00)">
                <input
                  type="time"
                  value={form.starts_at}
                  onChange={e => setForm({ ...form, starts_at: e.target.value })}
                  required
                />
              </Field>

              <Field label="End Time (e.g. 10:00)">
                <input
                  type="time"
                  value={form.ends_at}
                  onChange={e => setForm({ ...form, ends_at: e.target.value })}
                  required
                />
              </Field>
            </div>

            <div className="form-grid">
              <Field label="Venue">
                <select
                  value={form.venue_id}
                  onChange={e => setForm({ ...form, venue_id: e.target.value })}
                  required
                >
                  <option value="">Select Venue</option>
                  {options.data?.venues?.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Lecturer">
                <select
                  value={form.lecturer_id}
                  onChange={e => setForm({ ...form, lecturer_id: e.target.value })}
                  required
                >
                  <option value="">Select Lecturer</option>
                  {options.data?.lecturers?.filter(l => !form.course_id || l.course_id === form.course_id).map(l => (
                    <option key={l.id} value={l.id}>{l.full_name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="primary compact" disabled={busy === 'save-entry'}>
                {busy === 'save-entry' ? 'Saving…' : 'Save Entry'}
              </button>
              <button type="button" className="secondary compact" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="Class Timetable" action={!editing && <button className="primary compact" onClick={handleOpenNew}><Plus size={14} /> Add Lecture</button>}>
        {timetable.loading ? <Loading text="Loading timetable…" /> : !timetable.data?.length ? (
          <Empty>No timetable entries created for this class yet.</Empty>
        ) : (
          DAYS.map((d, i) => {
            const items = (timetable.data || []).filter(x => x.day_of_week === i);
            if (!items.length) return null;
            return (
              <div key={d} style={{ marginBottom: 18 }}>
                <h3 style={{ fontSize: 14, color: '#465b70', margin: '8px 0' }}>{d}</h3>
                {items.map(x => (
                  <div className="row" key={x.id}>
                    <div>
                      <strong>{x.courses.code}</strong> <span className="muted">{x.courses.title}</span>
                      <p className="muted small">{x.venues?.name || 'TBA'} · Lecturer: {x.profiles?.full_name || 'TBA'}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="time">{hhmm(x.starts_at)}–{hhmm(x.ends_at)}</span>
                      <button className="action-btn" title="Edit" onClick={() => handleOpenEdit(x)}>
                        <Edit3 size={15} />
                      </button>
                      <button className="action-btn danger" title="Delete" onClick={() => handleDelete(x.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}

// =================================================================== CLASS REP STUDENTS
export function RepStudents() {
  const students = useApi('/class-rep/students');
  const pending = useApi('/students/pending');
  const resetRequests = useApi('/students/reset-requests');
  const [resetModal, setResetModal] = useState(null); // { full_name, student_id, phone_number, password }
  const { busy, error, ok, run, setOk } = useAction();

  const handleDecision = (id, decision) => run(`decision-${id}`, async () => {
    await apiFetch(`/students/${id}/decision`, { method: 'PATCH', body: { decision } });
    pending.reload();
    students.reload();
  }, `Student registration ${decision}.`);

  const handleResetPassword = student => run(`reset-${student.id}`, async () => {
    const res = await apiFetch(`/students/${student.id}/reset-password`, { method: 'POST' });
    setResetModal(res);
    resetRequests.reload();
  });

  const handleRejectReset = student => run(`reject-${student.id}`, async () => {
    await apiFetch(`/students/${student.id}/reject-reset`, { method: 'POST' });
    resetRequests.reload();
  }, 'Reset request dismissed.');

  return (
    <>
      <ErrorText>{students.error || pending.error || resetRequests.error || error}</ErrorText>
      <Success>{ok}</Success>

      {/* Password reset modal */}
      {resetModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 440, width: '100%', margin: 0 }}>
            <h3>Temporary Password Generated</h3>
            <p className="muted small">Share this temporary password directly with <strong>{resetModal.full_name}</strong>:</p>
            <div style={{ background: '#f4f7fb', padding: 14, borderRadius: 10, margin: '12px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2, color: '#102a43' }}>{resetModal.password}</div>
              <small className="muted" style={{ display: 'block', marginTop: 4 }}>
                Expires in 48 hours. Forced change on first login.
              </small>
            </div>
            {resetModal.phone_number && (
              <a
                className="whatsapp"
                style={{ justifyContent: 'center', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}
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

      {/* Password reset requests from students in class */}
      {resetRequests.data?.length > 0 && (
        <Panel title={`Password Reset Requests (${resetRequests.data.length})`}>
          {resetRequests.data.map(s => (
            <div className="row" key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Avatar user={s} size={38} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong>{s.full_name}</strong> {s.student_id ? <span className="muted">({s.student_id})</span> : ''}
                <p className="muted small">Phone: {s.phone_number} · Requested: {fmtDateTime(s.requested_at)}</p>
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
          ))}
        </Panel>
      )}

      {/* Pending registrations to approve/reject */}
      {pending.data?.length > 0 && (
        <Panel title={`Pending Registrations (${pending.data.length})`}>
          {pending.data.map(s => (
            <div className="row" key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar user={s} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{s.full_name}</strong> {s.student_id ? <span className="muted">({s.student_id})</span> : ''}
                <p className="muted small">Phone: {s.phone_number} · Applied: {fmtDateTime(s.created_at)}</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="primary compact"
                  disabled={busy === `decision-${s.id}`}
                  onClick={() => handleDecision(s.id, 'approved')}
                >
                  <Check size={14} /> Approve
                </button>
                <button
                  className="danger compact"
                  disabled={busy === `decision-${s.id}`}
                  onClick={() => handleDecision(s.id, 'rejected')}
                >
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))}
        </Panel>
      )}

      <Panel title={`Class Students (${students.data?.length || 0})`}>
        {students.loading ? <Loading text="Loading students…" /> : !students.data?.length ? (
          <Empty>No students found for this class.</Empty>
        ) : (
          students.data.map(s => {
            const att = s.attendance || {};
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '12px 14px',
                  background: '#ffffff',
                  borderRadius: 12,
                  border: '1px solid #e2e8f0',
                  marginBottom: 10,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <Avatar user={s} size={40} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14, color: '#0f172a' }}>{s.full_name}</strong>
                      <strong className={att.rate >= 75 ? 'good' : 'low'} style={{ fontSize: 13 }}>{pct(att.rate)}</strong>
                    </div>
                    <p className="muted small" style={{ margin: '3px 0 0', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {s.student_id ? `${s.student_id} · ` : ''}Phone: <b>{s.phone_number}</b>
                    </p>
                    <p className="muted small" style={{ margin: '2px 0 0' }}>
                      Attendance: <b>{att.approved || 0}</b> present / {att.total || 0} sessions
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
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
                </div>
              </div>
            );
          })
        )}
      </Panel>
    </>
  );
}

// =================================================================== CLASS REP ATTENDANCE
export function RepAttendance() {
  const [status, setStatus] = useState('');
  const attendance = useApi(`/class-rep/attendance?${status ? `status=${status}` : ''}`);

  return (
    <>
      <ErrorText>{attendance.error}</ErrorText>
      <Panel
        title="Class Attendance Records"
        action={
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter status" className="mini-select">
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        }
      >
        {attendance.loading ? <Loading text="Loading records…" /> : !attendance.data?.rows?.length ? (
          <Empty>No attendance records found.</Empty>
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
                    {course.code} · {fmtDate(sess.session_date)} · {fmtDateTime(r.submitted_at)}
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
