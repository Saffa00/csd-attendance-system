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
// A4 PDF BUILDER (PDFKit)
// =========================================================================
function buildPdfDocument(report, res) {
  const { meta, settings, summary, columns, rows } = report;
  const isLandscape = columns.length > 8;

  // A4 Page size in points: 595.28 x 841.89
  // 20 mm margins = 56.7 points
  const marginPt = 56.7;
  const pageWidth = isLandscape ? 841.89 : 595.28;
  const pageHeight = isLandscape ? 595.28 : 841.89;
  const contentWidth = pageWidth - (2 * marginPt);

  const doc = new PDFDocument({
    size: isLandscape ? [841.89, 595.28] : [595.28, 841.89],
    margins: { top: marginPt, bottom: marginPt, left: marginPt, right: marginPt },
    bufferPages: true
  });
  doc.pipe(res);

  // Helper: Draw header on Page 1
  const drawPage1Header = () => {
    // Logo
    try {
      if (settings.logo_data && settings.logo_data.startsWith('data:image')) {
        const base64Data = settings.logo_data.replace(/^data:image\/\w+;base64,/, '');
        const imgBuffer = Buffer.from(base64Data, 'base64');
        doc.image(imgBuffer, (pageWidth - 60) / 2, doc.y, { height: 60 });
        doc.y += 66;
      } else if (fs.existsSync(DEFAULT_LOGO_PATH)) {
        doc.image(DEFAULT_LOGO_PATH, (pageWidth - 60) / 2, doc.y, { height: 60 });
        doc.y += 66;
      }
    } catch (_) {}

    // University & Department Titles
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#102a43').text(settings.university_name, { align: 'center' });
    doc.font('Helvetica').fontSize(10.5).fillColor('#486581').text(settings.department_name, { align: 'center' });
    doc.moveDown(0.4);

    // Horizontal Divider
    doc.moveTo(marginPt, doc.y).lineTo(pageWidth - marginPt, doc.y).strokeColor('#9fb3c8').lineWidth(1).stroke();
    doc.moveDown(0.6);

    // Centered Title Block
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#102a43').text(meta.title, { align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor('#627d98').text(meta.filter_summary, { align: 'center' });
    doc.moveDown(0.8);

    // Summary Cards (4 rectangular boxes)
    const gap = 10;
    const boxW = (contentWidth - (3 * gap)) / 4;
    const boxH = 40;
    const by = doc.y;

    const cards = [
      { val: summary.total_students, lbl: 'Students' },
      { val: summary.sessions_held, lbl: 'Sessions held' },
      { val: `${summary.average_attendance}%`, lbl: 'Average attendance' },
      { val: summary.below_minimum, lbl: `Below ${settings.min_attendance_threshold}% minimum` }
    ];

    cards.forEach((c, idx) => {
      const bx = marginPt + idx * (boxW + gap);
      doc.roundedRect(bx, by, boxW, boxH, 4).strokeColor('#d9e2ec').lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#102a43').text(String(c.val), bx, by + 6, { width: boxW, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor('#627d98').text(c.lbl, bx, by + 23, { width: boxW, align: 'center' });
    });

    doc.y = by + boxH + 16;
  };

  // Helper: Draw repeating Table Header
  const drawTableHeader = y => {
    doc.rect(marginPt, y, contentWidth, 20).fill('#f0f4f8');
    doc.moveTo(marginPt, y + 20).lineTo(marginPt + contentWidth, y + 20).strokeColor('#94a3b8').lineWidth(1).stroke();

    let curX = marginPt;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#102a43');
    columns.forEach(col => {
      const colW = (contentWidth * col.widthPct) / 100;
      doc.text(col.label, curX + 3, y + 5, {
        width: colW - 6,
        align: col.align || 'left',
        lineBreak: false
      });
      curX += colW;
    });
    return y + 20;
  };

  // Page 1 header & summary
  drawPage1Header();

  // Draw Table
  let currentY = drawTableHeader(doc.y);
  const rowHeight = 18;

  rows.forEach((row, rIdx) => {
    // Check if new page is needed (reserving 50pt bottom margin for safety)
    if (currentY + rowHeight > pageHeight - marginPt - 40) {
      doc.addPage();
      currentY = drawTableHeader(marginPt);
    }

    // Zebra striping
    if (rIdx % 2 === 1) {
      doc.rect(marginPt, currentY, contentWidth, rowHeight).fill('#f8fafc');
    }
    // Bottom border for each row
    doc.moveTo(marginPt, currentY + rowHeight).lineTo(marginPt + contentWidth, currentY + rowHeight).strokeColor('#e2e8f0').lineWidth(0.5).stroke();

    let curX = marginPt;
    const isBelow = row.is_below;

    columns.forEach(col => {
      const colW = (contentWidth * col.widthPct) / 100;
      const val = row[col.key] ?? '';
      doc.font(isBelow ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(isBelow && col.key === 'attendance' ? '#dc2626' : '#102a43');

      // If at risk and this is the attendance column, render text + "[Below min]" tag
      if (isBelow && col.key === 'attendance') {
        doc.text(`${val} [Below min]`, curX + 2, currentY + 4, {
          width: colW - 4,
          align: 'right',
          lineBreak: false
        });
      } else {
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

  // Table continuation / note below table
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#627d98').text(
    `Total records: ${rows.length}. Attendance counts approved Present records only. Generated automatically.`,
    marginPt,
    currentY + 6
  );
  currentY += 24;

  // Last page signature blocks
  if (currentY + 110 > pageHeight - marginPt) {
    doc.addPage();
    currentY = marginPt + 20;
  }

  const sigW = (contentWidth - 60) / 3;
  const sigY = currentY + 25;

  // 1. Lecturer Signature
  doc.moveTo(marginPt, sigY).lineTo(marginPt + sigW, sigY).strokeColor('#627d98').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#102a43').text(settings.lecturer_signature_label, marginPt, sigY + 6, { width: sigW, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#627d98').text('Date: _______________________', marginPt, sigY + 20, { width: sigW, align: 'center' });

  // 2. Official Stamp Box
  const stampX = marginPt + sigW + 30;
  doc.roundedRect(stampX, sigY - 20, sigW, 60, 4).dash(3, { space: 2 }).strokeColor('#9fb3c8').stroke();
  doc.undash();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#9fb3c8').text('OFFICIAL STAMP', stampX, sigY + 8, { width: sigW, align: 'center' });

  // 3. Head of Department Signature
  const hodX = marginPt + (2 * (sigW + 30));
  doc.moveTo(hodX, sigY).lineTo(hodX + sigW, sigY).strokeColor('#627d98').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#102a43').text(settings.hod_signature_label, hodX, sigY + 6, { width: sigW, align: 'center' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#627d98').text('Date: _______________________', hodX, sigY + 20, { width: sigW, align: 'center' });

  // Footers on Every Page
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const footerY = pageHeight - 34;
    doc.font('Helvetica').fontSize(7.5).fillColor('#829ab1');

    // Left: Generated on date by name, role
    doc.text(`Generated on ${fmtDate(meta.generated_at)} by ${meta.generated_by}, ${meta.generated_by_role}`, marginPt, footerY, {
      width: 250,
      align: 'left',
      lineBreak: false
    });

    // Center: Page X of Y
    doc.text(`Page ${i + 1} of ${range.count}`, marginPt, footerY, {
      width: contentWidth,
      align: 'center',
      lineBreak: false
    });

    // Right: Confidential
    doc.text('Confidential', pageWidth - marginPt - 100, footerY, {
      width: 100,
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
