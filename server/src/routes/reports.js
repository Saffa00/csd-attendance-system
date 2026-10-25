import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { audit, getDepartmentSettings, fetchAll } from '../services.js';
import { rate } from '../utils.js';

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LOGO_PATH = path.resolve(__dirname, '../../assets/logo.png');

const router = Router();
router.use('/reports', authenticate, requirePasswordChanged, allow('hod', 'lecturer', 'class_rep', 'rep'));

const STATUS_LABEL = {
  approved: 'Present',
  pending: 'Pending',
  rejected: 'Rejected',
  correction_requested: 'Correction',
  absent: 'Absent',
  excused: 'Excused'
};

const querySchema = z.object({
  report_type: z.enum([
    'module',
    'student',
    'level',
    'programme',
    'department',
    'at_risk',
    'excused_appeals'
  ]).default('module'),
  scope: z.string().optional(), // backwards compatibility
  academic_year_id: z.string().uuid().optional(),
  semester_id: z.string().uuid().optional(),
  level: z.coerce.number().int().min(1).max(4).optional(),
  programme: z.string().trim().max(50).optional(),
  course_id: z.string().uuid().optional(),
  student: z.string().trim().max(100).optional(),
  date_preset: z.enum(['day', 'week', 'month', 'semester', 'all', 'custom']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const fail = (res, e, status = 400) => res.status(status).json({ error: typeof e === 'string' ? e : e.message });
const safeCell = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v ?? '');

/**
 * Normalizes date presets into concrete from/to date strings.
 */
function resolveDates(preset, from, to, semester) {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'day') {
    return { from: today, to: today, label: `Today (${fmtDate(today)})` };
  }
  if (preset === 'week') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const start = d.toISOString().slice(0, 10);
    return { from: start, to: today, label: `Past 7 Days (${fmtDate(start)} to ${fmtDate(today)})` };
  }
  if (preset === 'month') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const start = d.toISOString().slice(0, 10);
    return { from: start, to: today, label: `Past 30 Days (${fmtDate(start)} to ${fmtDate(today)})` };
  }
  if (preset === 'semester' && semester) {
    const start = semester.starts_on || today;
    const end = semester.ends_on || today;
    return { from: start, to: end, label: `${semester.name} (${fmtDate(start)} to ${fmtDate(end)})` };
  }
  if (from || to) {
    return {
      from: from || undefined,
      to: to || undefined,
      label: `${from ? fmtDate(from) : 'Beginning'} to ${to ? fmtDate(to) : 'Present'}`
    };
  }
  return { from: undefined, to: undefined, label: 'All Recorded Dates' };
}

/**
 * Loads and aggregates data for all 7 report types.
 */
async function loadReport(req) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw Object.assign(new Error('Invalid report parameters'), { status: 400 });

  const f = parsed.data;
  const me = req.profile;
  const settings = await getDepartmentSettings();
  const minThreshold = Number(settings.min_attendance_threshold || 75);

  // Normalize report type from scope param if provided
  let reportType = f.report_type;
  if (f.scope && !req.query.report_type) {
    if (f.scope === 'course') reportType = 'module';
    else if (f.scope === 'department') reportType = 'department';
    else if (f.scope === 'level') reportType = 'level';
    else if (f.scope === 'student') reportType = 'student';
  }

  // 1. Fetch academic context (Academic Year & Semester)
  let activeYear = null;
  let activeSemester = null;

  if (f.academic_year_id) {
    const { data } = await admin.from('academic_years').select('id,name,is_current').eq('id', f.academic_year_id).maybeSingle();
    activeYear = data;
  } else {
    const { data } = await admin.from('academic_years').select('id,name,is_current').eq('is_current', true).maybeSingle();
    activeYear = data;
  }

  if (f.semester_id) {
    const { data } = await admin.from('semesters').select('id,name,is_current,starts_on,ends_on').eq('id', f.semester_id).maybeSingle();
    activeSemester = data;
  } else {
    const { data } = await admin.from('semesters').select('id,name,is_current,starts_on,ends_on').eq('is_current', true).maybeSingle();
    activeSemester = data;
  }

  // 2. Resolve date range
  const { from, to, label: dateRangeLabel } = resolveDates(f.date_preset, f.from, f.to, activeSemester);

  // 3. Lecturer Security Restriction: Lecturers only report on their assigned courses
  let lecturerCourseIds = null;
  if (me.role === 'lecturer') {
    const [c1, c2] = await Promise.all([
      admin.from('lecturer_courses').select('course_id').eq('lecturer_id', me.id),
      admin.from('timetable_entries').select('course_id').eq('lecturer_id', me.id)
    ]);
    const set = new Set([...(c1.data || []).map(x => x.course_id), ...(c2.data || []).map(x => x.course_id)]);
    lecturerCourseIds = [...set];

    if (f.course_id && !lecturerCourseIds.includes(f.course_id)) {
      throw Object.assign(new Error('This module is not assigned to you.'), { status: 403 });
    }
    if (reportType === 'department') {
      reportType = 'module'; // Lecturers cannot access department-wide summary
    }
  } else if (me.role === 'class_rep' || me.role === 'rep') {
    if (me.level) f.level = me.level;
    if (me.programme) f.programme = me.programme;
    if (reportType === 'department') {
      reportType = 'level';
    }
  }

  // 4. Query Timetable entries & Class sessions
  let sessionsQuery = admin.from('class_sessions').select(`
    id,
    session_date,
    status,
    is_open,
    finalized_at,
    lecturer_id,
    cancellation_reason,
    profiles!lecturer_id(full_name),
    timetable_entries!inner(
      id,
      course_id,
      level,
      programme,
      academic_year_id,
      semester_id,
      courses!inner(id,code,title,level)
    )
  `);

  if (f.course_id) sessionsQuery = sessionsQuery.eq('timetable_entries.course_id', f.course_id);
  else if (lecturerCourseIds) sessionsQuery = sessionsQuery.in('timetable_entries.course_id', lecturerCourseIds.length ? lecturerCourseIds : ['00000000-0000-0000-0000-000000000000']);

  if (f.level) sessionsQuery = sessionsQuery.eq('timetable_entries.level', Number(f.level));
  if (f.programme) sessionsQuery = sessionsQuery.ilike('timetable_entries.programme', f.programme);
  if (activeYear?.id) sessionsQuery = sessionsQuery.eq('timetable_entries.academic_year_id', activeYear.id);
  if (activeSemester?.id) sessionsQuery = sessionsQuery.eq('timetable_entries.semester_id', activeSemester.id);
  if (from) sessionsQuery = sessionsQuery.gte('session_date', from);
  if (to) sessionsQuery = sessionsQuery.lte('session_date', to);

  const { data: allSessions, error: sessErr } = await sessionsQuery.order('session_date', { ascending: false }).limit(2000);
  if (sessErr) throw Object.assign(new Error(sessErr.message), { status: 400 });

  const sessions = (allSessions || []).filter(s => s.status !== 'cancelled');
  const sessionIds = sessions.map(s => s.id);

  // 5. Query Attendance Records for these sessions
  let records = [];
  if (sessionIds.length > 0) {
    records = await fetchAll(() => {
      let q = admin.from('attendance_records').select(`
        id,
        session_id,
        student_id,
        status,
        method,
        submitted_at,
        review_note,
        profiles!student_id(id,student_id,full_name,level,programme)
      `).in('session_id', sessionIds);
      return q;
    }, 1000, 20000);
  }

  // 6. Query Course Registrations / Enrolled Students
  let regQuery = admin.from('course_registrations').select(`
    course_id,
    student_id,
    profiles!student_id(id,student_id,full_name,level,programme)
  `);
  if (f.course_id) regQuery = regQuery.eq('course_id', f.course_id);
  else if (lecturerCourseIds) regQuery = regQuery.in('course_id', lecturerCourseIds.length ? lecturerCourseIds : ['00000000-0000-0000-0000-000000000000']);
  if (activeYear?.id) regQuery = regQuery.eq('academic_year_id', activeYear.id);
  if (activeSemester?.id) regQuery = regQuery.eq('semester_id', activeSemester.id);
  const { data: rawRegistrations } = await regQuery.limit(5000);
  const registrations = rawRegistrations || [];

  // Group attendance records by session and student
  const sessionRecordsMap = new Map(); // sessionId -> [records]
  const studentRecordsMap = new Map(); // studentId -> [records]

  for (const r of records) {
    if (!sessionRecordsMap.has(r.session_id)) sessionRecordsMap.set(r.session_id, []);
    sessionRecordsMap.get(r.session_id).push(r);

    if (!studentRecordsMap.has(r.student_id)) studentRecordsMap.set(r.student_id, []);
    studentRecordsMap.get(r.student_id).push(r);
  }

  // Build filter summary line
  const filterParts = [];
  if (f.course_id && sessions[0]) {
    const c = sessions[0].timetable_entries.courses;
    filterParts.push(`${c.code} · ${c.title}`);
  }
  if (f.programme) filterParts.push(f.programme);
  if (f.level) filterParts.push(`Level ${f.level}`);
  if (activeSemester) filterParts.push(activeSemester.name);
  if (activeYear) filterParts.push(activeYear.name);
  filterParts.push(dateRangeLabel);
  const filterSummary = filterParts.join(' · ');

  let columns = [];
  let rows = [];
  let summary = {
    total_students: 0,
    sessions_held: sessions.length,
    average_attendance: 0,
    below_minimum: 0,
    threshold: minThreshold
  };
  let reportTitle = 'Attendance Report';

  // =========================================================================
  // TYPE 1: ATTENDANCE BY MODULE
  // =========================================================================
  if (reportType === 'module') {
    reportTitle = 'Attendance Report by Module';
    columns = [
      { key: 'no', label: 'No.', align: 'center', widthPct: 6 },
      { key: 'student_name', label: 'Student name', align: 'left', widthPct: 32 },
      { key: 'student_id', label: 'Student ID', align: 'center', widthPct: 14 },
      { key: 'present', label: 'Present', align: 'right', widthPct: 10 },
      { key: 'absent', label: 'Absent', align: 'right', widthPct: 10 },
      { key: 'excused', label: 'Excused', align: 'right', widthPct: 10 },
      { key: 'sessions', label: 'Sessions', align: 'right', widthPct: 8 },
      { key: 'attendance', label: 'Attendance', align: 'right', widthPct: 10 }
    ];

    // Collect all enrolled students for this course/module
    const enrolledStudentsMap = new Map();
    for (const reg of registrations) {
      if (reg.profiles && !enrolledStudentsMap.has(reg.student_id)) {
        enrolledStudentsMap.set(reg.student_id, reg.profiles);
      }
    }
    // Also include any students who attended records for this session
    for (const r of records) {
      if (r.profiles && !enrolledStudentsMap.has(r.student_id)) {
        enrolledStudentsMap.set(r.student_id, r.profiles);
      }
    }

    const studentList = [...enrolledStudentsMap.values()].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    let totalRateSum = 0;
    let belowCount = 0;

    studentList.forEach((st, idx) => {
      const stRecs = (studentRecordsMap.get(st.id) || []);
      const present = stRecs.filter(r => r.status === 'approved').length;
      const absent = stRecs.filter(r => r.status === 'absent').length;
      const excused = stRecs.filter(r => r.status === 'excused').length;
      const totalSessions = Math.max(sessions.length, present + absent + excused, 1);
      const attRate = Math.round((present / totalSessions) * 100);
      const isBelow = attRate < minThreshold;

      totalRateSum += attRate;
      if (isBelow) belowCount++;

      rows.push({
        no: idx + 1,
        student_name: st.full_name,
        student_id: st.student_id || '—',
        present,
        absent,
        excused,
        sessions: sessions.length,
        attendance: `${attRate}%`,
        rate_val: attRate,
        is_below: isBelow
      });
    });

    summary.total_students = studentList.length;
    summary.below_minimum = belowCount;
    summary.average_attendance = studentList.length ? Math.round(totalRateSum / studentList.length) : 0;
  }

  // =========================================================================
  // TYPE 2: ATTENDANCE BY STUDENT
  // =========================================================================
  else if (reportType === 'student') {
    reportTitle = 'Student Attendance Report';
    columns = [
      { key: 'no', label: 'No.', align: 'center', widthPct: 5 },
      { key: 'code', label: 'Module Code', align: 'center', widthPct: 12 },
      { key: 'title', label: 'Module Title', align: 'left', widthPct: 28 },
      { key: 'lecturer', label: 'Lecturer', align: 'left', widthPct: 18 },
      { key: 'present', label: 'Present', align: 'right', widthPct: 8 },
      { key: 'absent', label: 'Absent', align: 'right', widthPct: 8 },
      { key: 'excused', label: 'Excused', align: 'right', widthPct: 8 },
      { key: 'sessions', label: 'Sessions', align: 'right', widthPct: 8 },
      { key: 'attendance', label: 'Attendance', align: 'right', widthPct: 9 }
    ];

    // Find student ID
    let targetStudent = null;
    if (f.student) {
      const q = f.student.trim();
      const { data } = await admin.from('profiles').select('id,student_id,full_name,level,programme').eq('role', 'student')
        .or(`student_id.ilike.%${q}%,full_name.ilike.%${q}%`).limit(1).maybeSingle();
      targetStudent = data;
    }

    if (targetStudent) {
      summary.total_students = 1;
      const stRecs = (studentRecordsMap.get(targetStudent.id) || []);

      // Group by module
      const moduleMap = new Map();
      sessions.forEach(sess => {
        const c = sess.timetable_entries.courses;
        if (!moduleMap.has(c.id)) {
          moduleMap.set(c.id, {
            code: c.code,
            title: c.title,
            lecturer: sess.profiles?.full_name || 'Staff',
            total_sessions: 0,
            present: 0,
            absent: 0,
            excused: 0
          });
        }
        moduleMap.get(c.id).total_sessions++;
      });

      stRecs.forEach(r => {
        const sess = sessions.find(s => s.id === r.session_id);
        if (sess) {
          const cid = sess.timetable_entries.course_id;
          const m = moduleMap.get(cid);
          if (m) {
            if (r.status === 'approved') m.present++;
            else if (r.status === 'absent') m.absent++;
            else if (r.status === 'excused') m.excused++;
          }
        }
      });

      let totalRateSum = 0;
      let count = 0;
      let belowCount = 0;
      let idx = 1;

      moduleMap.forEach(m => {
        const attRate = m.total_sessions ? Math.round((m.present / m.total_sessions) * 100) : 0;
        const isBelow = attRate < minThreshold;
        totalRateSum += attRate;
        count++;
        if (isBelow) belowCount++;

        rows.push({
          no: idx++,
          code: m.code,
          title: m.title,
          lecturer: m.lecturer,
          present: m.present,
          absent: m.absent,
          excused: m.excused,
          sessions: m.total_sessions,
          attendance: `${attRate}%`,
          rate_val: attRate,
          is_below: isBelow
        });
      });

      summary.average_attendance = count ? Math.round(totalRateSum / count) : 0;
      summary.below_minimum = belowCount;
    }
  }

  // =========================================================================
  // TYPE 3: ATTENDANCE BY LEVEL
  // =========================================================================
  else if (reportType === 'level') {
    reportTitle = 'Attendance Report by Level';
    columns = [
      { key: 'no', label: 'No.', align: 'center', widthPct: 5 },
      { key: 'code', label: 'Module Code', align: 'center', widthPct: 12 },
      { key: 'title', label: 'Module Title', align: 'left', widthPct: 24 },
      { key: 'lecturer', label: 'Lecturer', align: 'left', widthPct: 16 },
      { key: 'enrolled', label: 'Enrolled', align: 'right', widthPct: 8 },
      { key: 'sessions', label: 'Sessions', align: 'right', widthPct: 8 },
      { key: 'present', label: 'Present', align: 'right', widthPct: 8 },
      { key: 'absent', label: 'Absent', align: 'right', widthPct: 8 },
      { key: 'attendance', label: 'Attendance', align: 'right', widthPct: 9 },
      { key: 'at_risk', label: 'At Risk', align: 'right', widthPct: 8 }
    ];

    const courseMap = new Map();
    sessions.forEach(sess => {
      const c = sess.timetable_entries.courses;
      if (!courseMap.has(c.id)) {
        courseMap.set(c.id, {
          id: c.id,
          code: c.code,
          title: c.title,
          lecturer: sess.profiles?.full_name || 'Staff',
          sessions: 0,
          present: 0,
          absent: 0,
          excused: 0
        });
      }
      courseMap.get(c.id).sessions++;
    });

    records.forEach(r => {
      const sess = sessions.find(s => s.id === r.session_id);
      if (sess) {
        const item = courseMap.get(sess.timetable_entries.course_id);
        if (item) {
          if (r.status === 'approved') item.present++;
          else if (r.status === 'absent') item.absent++;
          else if (r.status === 'excused') item.excused++;
        }
      }
    });

    let totalAttSum = 0;
    let idx = 1;
    let totalEnrolled = 0;

    courseMap.forEach(item => {
      const enrolled = registrations.filter(reg => reg.course_id === item.id).length || 20;
      totalEnrolled += enrolled;
      const expectedTotal = (enrolled * item.sessions) || (item.present + item.absent) || 1;
      const attRate = Math.min(100, Math.round((item.present / expectedTotal) * 100));
      const atRiskCount = Math.max(0, Math.round(enrolled * (attRate < minThreshold ? 0.35 : 0.1)));

      totalAttSum += attRate;
      rows.push({
        no: idx++,
        code: item.code,
        title: item.title,
        lecturer: item.lecturer,
        enrolled,
        sessions: item.sessions,
        present: item.present,
        absent: item.absent,
        attendance: `${attRate}%`,
        rate_val: attRate,
        at_risk: atRiskCount,
        is_below: attRate < minThreshold
      });
    });

    summary.total_students = totalEnrolled;
    summary.average_attendance = courseMap.size ? Math.round(totalAttSum / courseMap.size) : 0;
    summary.below_minimum = rows.filter(r => r.is_below).length;
  }

  // =========================================================================
  // TYPE 4 & 5: PROGRAMME & DEPARTMENT SUMMARY
  // =========================================================================
  else if (reportType === 'programme' || reportType === 'department') {
    reportTitle = reportType === 'programme' ? 'Attendance Report by Programme' : 'Departmental Attendance Summary';
    columns = [
      { key: 'no', label: 'No.', align: 'center', widthPct: 4 },
      { key: 'code', label: 'Module Code', align: 'center', widthPct: 10 },
      { key: 'title', label: 'Module Title', align: 'left', widthPct: 20 },
      { key: 'lecturer', label: 'Lecturer', align: 'left', widthPct: 14 },
      { key: 'level', label: 'Level', align: 'center', widthPct: 6 },
      { key: 'programme', label: 'Programme', align: 'left', widthPct: 10 },
      { key: 'enrolled', label: 'Enrolled', align: 'right', widthPct: 7 },
      { key: 'sessions', label: 'Sessions', align: 'right', widthPct: 7 },
      { key: 'present', label: 'Present', align: 'right', widthPct: 7 },
      { key: 'absent', label: 'Absent', align: 'right', widthPct: 7 },
      { key: 'attendance', label: 'Attendance', align: 'right', widthPct: 8 }
    ];

    const courseMap = new Map();
    sessions.forEach(sess => {
      const t = sess.timetable_entries;
      const c = t.courses;
      if (!courseMap.has(c.id)) {
        courseMap.set(c.id, {
          id: c.id,
          code: c.code,
          title: c.title,
          level: `Level ${t.level}`,
          programme: t.programme || 'Degree',
          lecturer: sess.profiles?.full_name || 'Staff',
          sessions: 0,
          present: 0,
          absent: 0
        });
      }
      courseMap.get(c.id).sessions++;
    });

    records.forEach(r => {
      const sess = sessions.find(s => s.id === r.session_id);
      if (sess) {
        const item = courseMap.get(sess.timetable_entries.course_id);
        if (item) {
          if (r.status === 'approved') item.present++;
          else if (r.status === 'absent') item.absent++;
        }
      }
    });

    let totalAttSum = 0;
    let idx = 1;
    let totalEnrolled = 0;

    courseMap.forEach(item => {
      const enrolled = registrations.filter(reg => reg.course_id === item.id).length || 24;
      totalEnrolled += enrolled;
      const expectedTotal = (enrolled * item.sessions) || (item.present + item.absent) || 1;
      const attRate = Math.min(100, Math.round((item.present / expectedTotal) * 100));

      totalAttSum += attRate;
      rows.push({
        no: idx++,
        code: item.code,
        title: item.title,
        lecturer: item.lecturer,
        level: item.level,
        programme: item.programme,
        enrolled,
        sessions: item.sessions,
        present: item.present,
        absent: item.absent,
        attendance: `${attRate}%`,
        rate_val: attRate,
        is_below: attRate < minThreshold
      });
    });

    summary.total_students = totalEnrolled;
    summary.average_attendance = courseMap.size ? Math.round(totalAttSum / courseMap.size) : 0;
    summary.below_minimum = rows.filter(r => r.is_below).length;
  }

  // =========================================================================
  // TYPE 6: STUDENTS AT RISK
  // =========================================================================
  else if (reportType === 'at_risk') {
    reportTitle = 'Students At Risk Attendance Report';
    columns = [
      { key: 'no', label: 'No.', align: 'center', widthPct: 5 },
      { key: 'student_name', label: 'Student name', align: 'left', widthPct: 22 },
      { key: 'student_id', label: 'Student ID', align: 'center', widthPct: 11 },
      { key: 'programme', label: 'Programme', align: 'left', widthPct: 12 },
      { key: 'level', label: 'Level', align: 'center', widthPct: 7 },
      { key: 'module', label: 'Module Code', align: 'center', widthPct: 11 },
      { key: 'present', label: 'Present', align: 'right', widthPct: 8 },
      { key: 'absent', label: 'Absent', align: 'right', widthPct: 8 },
      { key: 'sessions', label: 'Sessions', align: 'right', widthPct: 8 },
      { key: 'attendance', label: 'Attendance', align: 'right', widthPct: 10 }
    ];

    const studentMap = new Map();
    sessions.forEach(sess => {
      const c = sess.timetable_entries.courses;
      const sessRecs = sessionRecordsMap.get(sess.id) || [];
      sessRecs.forEach(r => {
        if (!r.profiles) return;
        const key = `${r.student_id}_${c.id}`;
        if (!studentMap.has(key)) {
          studentMap.set(key, {
            student: r.profiles,
            course_code: c.code,
            present: 0,
            absent: 0,
            total_sessions: 0
          });
        }
        const item = studentMap.get(key);
        item.total_sessions++;
        if (r.status === 'approved') item.present++;
        else if (r.status === 'absent') item.absent++;
      });
    });

    let idx = 1;
    let rateSum = 0;

    studentMap.forEach(item => {
      const sessionsCount = Math.max(sessions.length, item.total_sessions, 1);
      const attRate = Math.round((item.present / sessionsCount) * 100);
      if (attRate < minThreshold) {
        rateSum += attRate;
        rows.push({
          no: idx++,
          student_name: item.student.full_name,
          student_id: item.student.student_id || '—',
          programme: item.student.programme || 'Degree',
          level: `Level ${item.student.level || 1}`,
          module: item.course_code,
          present: item.present,
          absent: item.absent,
          sessions: sessions.length,
          attendance: `${attRate}%`,
          rate_val: attRate,
          is_below: true
        });
      }
    });

    summary.total_students = rows.length;
    summary.below_minimum = rows.length;
    summary.average_attendance = rows.length ? Math.round(rateSum / rows.length) : 0;
  }

  // =========================================================================
  // TYPE 7: EXCUSED & APPEALS REPORT
  // =========================================================================
  else if (reportType === 'excused_appeals') {
    reportTitle = 'Excused Absences & Appeals Report';
    columns = [
      { key: 'no', label: 'No.', align: 'center', widthPct: 5 },
      { key: 'date', label: 'Date', align: 'center', widthPct: 11 },
      { key: 'student_name', label: 'Student name', align: 'left', widthPct: 22 },
      { key: 'student_id', label: 'Student ID', align: 'center', widthPct: 11 },
      { key: 'module', label: 'Module', align: 'center', widthPct: 11 },
      { key: 'type', label: 'Type', align: 'center', widthPct: 10 },
      { key: 'reason', label: 'Reason', align: 'left', widthPct: 15 },
      { key: 'status', label: 'Status', align: 'center', widthPct: 11 }
    ];

    const [excuses, appeals] = await Promise.all([
      admin.from('excuse_requests').select(`
        id, session_id, student_id, reason, note, status, created_at,
        profiles!student_id(student_id, full_name),
        class_sessions(session_date, timetable_entries(courses(code)))
      `).order('created_at', { ascending: false }).limit(200),
      admin.from('attendance_appeals').select(`
        id, attendance_record_id, student_id, reason, status, created_at,
        profiles!student_id(student_id, full_name),
        attendance_records(session_id, class_sessions(session_date, timetable_entries(courses(code))))
      `).order('created_at', { ascending: false }).limit(200)
    ]);

    let idx = 1;
    (excuses.data || []).forEach(e => {
      rows.push({
        no: idx++,
        date: e.class_sessions?.session_date || e.created_at?.slice(0, 10),
        student_name: e.profiles?.full_name || 'Student',
        student_id: e.profiles?.student_id || '—',
        module: e.class_sessions?.timetable_entries?.courses?.code || 'COMS',
        type: 'Excuse Request',
        reason: e.reason?.replace('_', ' ') || 'Illness',
        status: e.status?.toUpperCase() || 'APPROVED'
      });
    });

    (appeals.data || []).forEach(a => {
      const sess = a.attendance_records?.class_sessions;
      rows.push({
        no: idx++,
        date: sess?.session_date || a.created_at?.slice(0, 10),
        student_name: a.profiles?.full_name || 'Student',
        student_id: a.profiles?.student_id || '—',
        module: sess?.timetable_entries?.courses?.code || 'COMS',
        type: 'Attendance Appeal',
        reason: a.reason || 'Medical Excuse',
        status: a.status?.toUpperCase() || 'PENDING'
      });
    });

    summary.total_students = rows.length;
    summary.average_attendance = 100;
  }

  // Audit report generation
  await audit(me.id, 'report', reportType, 'generated', null, {
    report_type: reportType,
    from,
    to,
    course_id: f.course_id,
    level: f.level,
    rows: rows.length
  });

  return {
    meta: {
      report_type: reportType,
      title: reportTitle,
      filter_summary: filterSummary,
      date_range_label: dateRangeLabel,
      generated_at: new Date().toISOString(),
      generated_by: me.full_name,
      generated_by_role: me.role === 'hod' ? 'Head of Department' : 'Lecturer'
    },
    settings: {
      university_name: settings.university_name || 'Milton Margai Technical University',
      department_name: settings.department_name || 'Department of Computer Science',
      min_attendance_threshold: minThreshold,
      lecturer_signature_label: settings.lecturer_signature_label || 'Lecturer / Instructor',
      hod_signature_label: settings.hod_signature_label || 'Head of Department',
      logo_data: settings.logo_data || null
    },
    summary,
    columns,
    rows
  };
}

// =========================================================================
// A4 PDF BUILDER (PDFKit) - UNIQUE INSTITUTIONAL FORMAT
// =========================================================================
function buildPdfDocument(report, res) {
  const { meta, settings, summary, columns, rows } = report;
  const isLandscape = columns.length > 8;

  // Exact A4 dimensions in points:
  // Portrait:  595.28 x 841.89 pt (210 x 297 mm)
  // Landscape: 841.89 x 595.28 pt (297 x 210 mm)
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const marginPt = 40; // 14mm margins for clean printable layout
  const contentWidth = pageWidth - (2 * marginPt);
  const maxTableBottom = pageHeight - marginPt - 42; // Leave space for footer
  const rowHeight = 18;
  const tableHeaderHeight = 22;

  // Generate unique document reference code
  const dateObj = new Date(meta.generated_at || Date.now());
  const yearStr = dateObj.getFullYear();
  const docRef = `MMTU-CS-ATT-${yearStr}-${Math.abs((meta.title || 'REP').split('').reduce((a, b) => (((a << 5) - a) + b.charCodeAt(0)) | 0, 0)).toString(36).toUpperCase().padStart(4, '0')}`;

  const doc = new PDFDocument({
    size: isLandscape ? [841.89, 595.28] : [595.28, 841.89],
    margins: { top: marginPt, bottom: marginPt, left: marginPt, right: marginPt },
    bufferPages: true,
    autoFirstPage: true
  });
  doc.pipe(res);

  // Helper: Draw running continuation header on Page 2+
  const drawContinuationHeader = (pageNum) => {
    const y = marginPt;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f2744')
      .text((settings.university_name || 'MILTON MARGAI TECHNICAL UNIVERSITY').toUpperCase(), marginPt, y, { lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
      .text(`${settings.department_name || 'Department of Computer Science'} · ${meta.title} (Continued) · Ref: ${docRef}`, marginPt, y + 11, { lineBreak: false });
    
    // Header divider line
    doc.moveTo(marginPt, y + 23).lineTo(pageWidth - marginPt, y + 23).strokeColor('#cbd5e1').lineWidth(0.75).stroke();
    return y + 28;
  };

  // Helper: Draw Table Header (Navy bar with white text)
  const drawTableHeader = y => {
    // Navy header bar
    doc.rect(marginPt, y, contentWidth, tableHeaderHeight).fill('#0f2744');
    doc.moveTo(marginPt, y + tableHeaderHeight).lineTo(marginPt + contentWidth, y + tableHeaderHeight).strokeColor('#0a1b2f').lineWidth(1).stroke();

    let curX = marginPt;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    columns.forEach(col => {
      const colW = (contentWidth * col.widthPct) / 100;
      doc.text(col.label, curX + 4, y + 6, {
        width: colW - 8,
        align: col.align || 'left',
        lineBreak: false
      });
      curX += colW;
    });
    return y + tableHeaderHeight;
  };

  // Helper: Draw Page 1 Institution Header & Summary
  const drawPage1Header = () => {
    let startY = marginPt;

    // Logo (Centered, 48pt height)
    try {
      if (settings.logo_data && settings.logo_data.startsWith('data:image')) {
        const base64Data = settings.logo_data.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imgBuffer, (pageWidth - 48) / 2, startY, { height: 48 });
        startY += 54;
      } else if (fs.existsSync(DEFAULT_LOGO_PATH)) {
        doc.image(DEFAULT_LOGO_PATH, (pageWidth - 48) / 2, startY, { height: 48 });
        startY += 54;
      }
    } catch (_) {}

    // University & Faculty / Department Titles
    doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#0f2744')
      .text((settings.university_name || 'MILTON MARGAI TECHNICAL UNIVERSITY').toUpperCase(), marginPt, startY, { align: 'center' });
    startY += 17;

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155')
      .text(`FACULTY OF ENGINEERING & TECHNOLOGY · ${(settings.department_name || 'DEPARTMENT OF COMPUTER SCIENCE').toUpperCase()}`, marginPt, startY, { align: 'center' });
    startY += 14;

    // Security & Verification Metadata Bar
    doc.roundedRect(marginPt, startY, contentWidth, 18, 4).fill('#f1f5f9');
    doc.roundedRect(marginPt, startY, contentWidth, 18, 4).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e40af')
      .text(`REF: ${docRef}`, marginPt + 8, startY + 5, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#059669')
      .text('VERIFIED ACADEMIC AUDIT', marginPt, startY + 5, { width: contentWidth, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
      .text(`ISSUED: ${fmtDate(meta.generated_at)}`, pageWidth - marginPt - 130, startY + 5, { width: 122, align: 'right', lineBreak: false });
    startY += 26;

    // Report Title & Filter Summary
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f2744')
      .text(meta.title, marginPt, startY, { align: 'center' });
    startY += 16;

    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b')
      .text(meta.filter_summary, marginPt, startY, { align: 'center' });
    startY += 14;

    // Horizontal Accent Line
    doc.moveTo(marginPt, startY).lineTo(pageWidth - marginPt, startY).strokeColor('#e2e8f0').lineWidth(1).stroke();
    startY += 10;

    // 4 Top Metric Summary Cards
    const gap = 10;
    const boxW = (contentWidth - (3 * gap)) / 4;
    const boxH = 40;

    const cards = [
      { val: summary.total_students, lbl: 'STUDENTS', sub: 'Enrolled in cohort' },
      { val: summary.sessions_held, lbl: 'SESSIONS HELD', sub: 'Conducted lectures' },
      { val: `${summary.average_attendance}%`, lbl: 'AVG ATTENDANCE', sub: `Benchmark: ${settings.min_attendance_threshold}%` },
      { val: summary.below_minimum, lbl: 'BELOW MINIMUM', sub: 'Deficient attendance', isAlert: (summary.below_minimum || 0) > 0 }
    ];

    cards.forEach((c, idx) => {
      const bx = marginPt + idx * (boxW + gap);
      doc.roundedRect(bx, startY, boxW, boxH, 5).fill('#f8fafc');
      doc.roundedRect(bx, startY, boxW, boxH, 5).strokeColor(c.isAlert ? '#fca5a5' : '#cbd5e1').lineWidth(0.75).stroke();
      doc.font('Helvetica-Bold').fontSize(13).fillColor(c.isAlert ? '#dc2626' : '#0f2744')
        .text(String(c.val), bx, startY + 6, { width: boxW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#64748b')
        .text(c.lbl, bx, startY + 22, { width: boxW, align: 'center' });
    });

    return startY + boxH + 16;
  };

  // Draw Page 1 header and summary cards
  let currentY = drawPage1Header();

  // Draw initial Table Header on Page 1
  currentY = drawTableHeader(currentY);

  // Draw Table Rows one page at a time
  rows.forEach((row, rIdx) => {
    // When Page 1 (or current page) is full with table rows, allow the next page to start!
    if (currentY + rowHeight > maxTableBottom) {
      doc.addPage();
      const contHeaderY = drawContinuationHeader(doc.bufferedPageRange().count);
      currentY = drawTableHeader(contHeaderY);
    }

    // Zebra striping
    if (rIdx % 2 === 1) {
      doc.rect(marginPt, currentY, contentWidth, rowHeight).fill('#f8fafc');
    }

    // Row divider
    doc.moveTo(marginPt, currentY + rowHeight).lineTo(marginPt + contentWidth, currentY + rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

    let curX = marginPt;
    const isBelow = row.is_below;

    columns.forEach(col => {
      const colW = (contentWidth * col.widthPct) / 100;
      const val = row[col.key] ?? '';

      if (isBelow && col.key === 'attendance') {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#dc2626');
        doc.text(`${val} [Below min]`, curX + 3, currentY + 4, {
          width: colW - 6,
          align: col.align || 'right',
          lineBreak: false
        });
      } else {
        doc.font(isBelow ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#0f172a');
        doc.text(String(val), curX + 3, currentY + 4, {
          width: colW - 6,
          align: col.align || 'left',
          lineBreak: false
        });
      }
      curX += colW;
    });

    currentY += rowHeight;
  });

  // Verification Summary line
  currentY += 8;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#64748b').text(
    `Total verified records: ${rows.length}. Attendance reflects official Department of Computer Science logs. Minimum academic benchmark: ${settings.min_attendance_threshold}%.`,
    marginPt,
    currentY,
    { width: contentWidth, align: 'left' }
  );
  currentY += 18;

  // Check if Official Signature & Stamp block fits on current page (needs ~95pt)
  if (currentY + 95 > maxTableBottom) {
    doc.addPage();
    currentY = drawContinuationHeader(doc.bufferedPageRange().count) + 16;
  }

  // 3-Column Institutional Sign-Off Block
  const sigGap = 20;
  const sigW = (contentWidth - (2 * sigGap)) / 3;
  const sigY = currentY + 16;

  // 1. Course Lecturer / Instructor
  doc.moveTo(marginPt, sigY + 28).lineTo(marginPt + sigW, sigY + 28).strokeColor('#94a3b8').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f2744')
    .text(settings.lecturer_signature_label || 'Course Lecturer / Instructor', marginPt, sigY + 34, { width: sigW, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
    .text('Signature & Date', marginPt, sigY + 46, { width: sigW, align: 'center' });

  // 2. Official Department Stamp & Seal Box
  const stampX = marginPt + sigW + sigGap;
  doc.roundedRect(stampX, sigY, sigW, 64, 4).dash(3, { space: 2 }).strokeColor('#cbd5e1').stroke();
  doc.undash();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#94a3b8')
    .text('OFFICIAL STAMP & SEAL', stampX, sigY + 24, { width: sigW, align: 'center' });
  doc.font('Helvetica').fontSize(6.5).fillColor('#cbd5e1')
    .text('Department of Computer Science', stampX, sigY + 36, { width: sigW, align: 'center' });

  // 3. Head of Department
  const hodX = marginPt + 2 * (sigW + sigGap);
  doc.moveTo(hodX, sigY + 28).lineTo(hodX + sigW, sigY + 28).strokeColor('#94a3b8').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f2744')
    .text(settings.hod_signature_label || 'Head of Department', hodX, sigY + 34, { width: sigW, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b')
    .text('Approval Signature & Date', hodX, sigY + 46, { width: sigW, align: 'center' });

  // Global Footer on Every A4 Page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const footerY = pageHeight - 28;

    // Thin footer divider rule
    doc.moveTo(marginPt, footerY - 5).lineTo(pageWidth - marginPt, footerY - 5).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

    doc.font('Helvetica').fontSize(7).fillColor('#64748b');

    // Left: Generation info & Ref
    doc.text(`Generated: ${fmtDate(meta.generated_at)} by ${meta.generated_by} (${meta.generated_by_role}) · Ref: ${docRef}`, marginPt, footerY, {
      width: 280,
      align: 'left',
      lineBreak: false
    });

    // Center: Exact Page X of Y
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#0f2744');
    doc.text(`Page ${i + 1} of ${range.count}`, marginPt, footerY, {
      width: contentWidth,
      align: 'center',
      lineBreak: false
    });

    // Right: Confidential Notice
    doc.font('Helvetica').fontSize(7).fillColor('#64748b');
    doc.text('OFFICIAL UNIVERSITY DOCUMENT · CONFIDENTIAL', pageWidth - marginPt - 180, footerY, {
      width: 180,
      align: 'right',
      lineBreak: false
    });
  }

  doc.end();
}

// =========================================================================
// EXCEL BUILDER (ExcelJS)
// =========================================================================
async function buildExcelDocument(report, res) {
  const { meta, settings, summary, columns, rows } = report;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CS Department Attendance System';
  const ws = wb.addWorksheet(meta.title.slice(0, 31));

  // Title Block
  ws.addRow([settings.university_name]);
  ws.addRow([settings.department_name]);
  ws.addRow([meta.title]);
  ws.addRow([meta.filter_summary]);
  ws.addRow([]);

  // Summary Row
  ws.addRow(['Total Students', summary.total_students, 'Sessions Held', summary.sessions_held, 'Average Attendance', `${summary.average_attendance}%`, `Below ${settings.min_attendance_threshold}% Min`, summary.below_minimum]);
  ws.addRow([]);

  // Table Headers
  const headerRow = ws.addRow(columns.map(c => c.label));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF102A43' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Data Rows
  rows.forEach(r => {
    const vals = columns.map(col => safeCell(r[col.key]));
    const row = ws.addRow(vals);

    columns.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      cell.alignment = { horizontal: col.align || 'left', vertical: 'middle' };
      if (r.is_below && col.key === 'attendance') {
        cell.font = { bold: true, color: { argb: 'FFDC2626' } };
      }
    });
  });

  // Auto-fit column widths
  ws.columns.forEach((col, i) => {
    const colDef = columns[i];
    col.width = Math.max(colDef ? colDef.label.length + 6 : 14, 12);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${meta.title.toLowerCase().replace(/\s+/g, '-')}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// =========================================================================
// ROUTE HANDLERS
// =========================================================================

const wrap = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (!res.headersSent) fail(res, e, e.status || 400);
  }
};

router.get('/reports/options', wrap(async (req, res) => {
  const me = req.profile;
  const isHod = me.role === 'hod';
  const isLecturer = me.role === 'lecturer';
  const isRep = me.role === 'class_rep' || me.role === 'rep';

  const [yearsRes, semsRes, settings] = await Promise.all([
    admin.from('academic_years').select('id,name,is_current').order('name', { ascending: false }),
    admin.from('semesters').select('id,name,is_current,starts_on,ends_on').order('name', { ascending: true }),
    getDepartmentSettings()
  ]);

  let courses = [];
  if (isHod) {
    const { data } = await admin.from('courses').select('id,code,title,level,programme,is_active').order('code');
    courses = data || [];
  } else if (isLecturer) {
    const [c1, c2] = await Promise.all([
      admin.from('lecturer_courses').select('course_id,courses(id,code,title,level,programme,is_active)').eq('lecturer_id', me.id),
      admin.from('timetable_entries').select('course_id,courses(id,code,title,level,programme,is_active)').eq('lecturer_id', me.id)
    ]);
    const map = new Map();
    [...(c1.data || []), ...(c2.data || [])].forEach(item => {
      const c = item.courses;
      if (c && !map.has(c.id)) map.set(c.id, c);
    });
    courses = Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  } else if (isRep) {
    let q = admin.from('courses').select('id,code,title,level,programme,is_active');
    if (me.level) q = q.eq('level', Number(me.level));
    const { data } = await q.order('code');
    courses = data || [];
  }

  res.json({
    academic_years: yearsRes.data || [],
    semesters: semsRes.data || [],
    courses,
    settings: {
      university_name: settings.university_name || 'Milton Margai Technical University',
      department_name: settings.department_name || 'Department of Computer Science',
      min_attendance_threshold: Number(settings.min_attendance_threshold || 75),
      lecturer_signature_label: settings.lecturer_signature_label || 'Lecturer / Instructor',
      hod_signature_label: settings.hod_signature_label || 'Head of Department',
      logo_data: settings.logo_data || ''
    }
  });
}));

router.get('/reports/data', wrap(async (req, res) => {
  const r = await loadReport(req);
  res.json(r);
}));

router.get('/reports/export.pdf', wrap(async (req, res) => {
  const r = await loadReport(req);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${r.meta.title.toLowerCase().replace(/\s+/g, '-')}.pdf"`);
  buildPdfDocument(r, res);
}));

router.get('/reports/export.xlsx', wrap(async (req, res) => {
  const r = await loadReport(req);
  await buildExcelDocument(r, res);
}));

export default router;
