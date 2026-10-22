import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged, requireApproved } from '../middleware.js';
import { currentPeriod, fetchAll, getDepartmentSettings, audit } from '../services.js';
import { todayInTz, weekdayOf, rate } from '../utils.js';

/** Student workspace. Every query is scoped to the signed-in student's own profile, programme and level. */
const router = Router();
router.use('/student', authenticate, requirePasswordChanged, allow('student'));

const fail = (res, e, status = 400) => res.status(status).json({ error: typeof e === 'string' ? e : e.message });
const handler = fn => async (req, res) => { try { await fn(req, res); } catch (e) { fail(res, e, e.status || 400); } };
const key = (c, y, s) => `${c}:${y || ''}:${s || ''}`;

/** 
 * Automatically determine the student's modules by matching programme and level 
 * to active department modules for the current semester. No student self-registration needed.
 * Criteria:
 * 1. student's programme is in the module's programmes (via module_programmes join table or comma-separated list)
 * 2. module.level = student.level
 * 3. module.semester = active semester (if active semester is set)
 * 4. module.is_active = true
 */
async function myRegistrations(profile) {
  const { semester, year } = await currentPeriod();
  
  // 1. Fetch active courses for the student's level
  let q = admin.from('courses')
    .select('id,code,title,level,programme,credit_units,semester,semester_id,academic_year_id,is_active')
    .eq('level', profile.level)
    .eq('is_active', true);
  const { data: courses, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 400 });

  // 2. Fetch module_programmes join table if it exists
  let joinMap = new Map();
  try {
    const { data: joins } = await admin.from('module_programmes').select('course_id,programme');
    if (joins && joins.length > 0) {
      joins.forEach(j => {
        const list = joinMap.get(j.course_id) || [];
        list.push(j.programme.toLowerCase().trim());
        joinMap.set(j.course_id, list);
      });
    }
  } catch (_) {}

  const studentProg = (profile.programme || '').toLowerCase().trim();
  const studentSemNum = Number(profile.semester || profile.raw_user_meta_data?.semester || (semester?.name?.toLowerCase().includes('second') || semester?.name === '2' ? 2 : 1));

  const filtered = (courses || []).filter(c => {
    // Semester check: match student's semester or module semester
    if (c.semester && c.semester !== studentSemNum) return false;

    // Programme matching:
    // A. Check module_programmes join table first
    if (joinMap.has(c.id)) {
      const list = joinMap.get(c.id);
      if (list.includes('all') || list.includes(studentProg)) return true;
      if (studentProg === 'degree' && (list.includes('computer science') || list.includes('bit') || list.includes('software engineering') || list.includes('degree'))) return true;
      if (studentProg === 'diploma' && (list.includes('diploma') || list.includes('all'))) return true;
      if (studentProg === 'hnd' && (list.includes('hnd') || list.includes('all'))) return true;
    }

    // B. Check course.programme (supports comma-separated, single name, or 'All')
    if (!c.programme || c.programme.toLowerCase().trim() === 'all') return true;
    const progs = c.programme.split(',').map(s => s.toLowerCase().trim());
    if (progs.includes('all') || progs.includes(studentProg)) return true;
    if (studentProg === 'degree') {
      return progs.some(p => p.includes('degree') || p.includes('computer science') || p.includes('bit') || p.includes('software engineering'));
    }
    if (studentProg === 'diploma') {
      return progs.some(p => p.includes('diploma') || p.includes('all'));
    }
    if (studentProg === 'hnd') {
      return progs.some(p => p.includes('hnd') || p.includes('all'));
    }
    return progs.some(p => p.includes(studentProg) || studentProg.includes(p));
  });

  // Sync to course_registrations table for historical tracking and foreign keys
  if (year && filtered.length) {
    const rows = filtered.map(c => ({
      student_id: profile.id,
      course_id: c.id,
      academic_year_id: year.id,
      semester_id: semester?.id || c.semester_id || null
    }));
    try {
      await admin.from('course_registrations').upsert(rows, {
        onConflict: 'student_id,course_id,academic_year_id,semester_id',
        ignoreDuplicates: true
      });
    } catch (_) {}
  }

  return filtered.map(c => ({
    id: c.id,
    course_id: c.id,
    academic_year_id: year?.id || null,
    semester_id: semester?.id || c.semester_id || null,
    courses: c
  }));
}

const SELECT_TT = 'id,course_id,lecturer_id,day_of_week,starts_at,ends_at,level,programme,academic_year_id,semester_id,courses(id,code,title),venues(id,name,latitude,longitude,radius_m),profiles!lecturer_id(id,full_name)';
async function myTimetable(profile, regs) {
  if (!regs.length) return [];
  const courseIds = [...new Set(regs.map(r => r.course_id))];
  const { data, error } = await admin.from('timetable_entries').select(SELECT_TT)
    .in('course_id', courseIds).eq('level', profile.level)
    .order('day_of_week').order('starts_at');
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  const studentProg = (profile.programme || '').toLowerCase().trim();
  return (data || []).filter(t => !t.programme || t.programme.toLowerCase().trim() === 'all' || t.programme.toLowerCase().includes(studentProg));
}

// Records with course info, used by overview / history
const myRecords = profileId => fetchAll(() => admin.from('attendance_records')
  .select('id,status,submitted_at,client_timestamp,submitted_offline,distance_m,review_note,reviewed_at,reviewed_by,reviewer:profiles!reviewed_by(full_name),class_sessions(id,session_date,status,cancellation_reason,timetable_entries(course_id,starts_at,ends_at,semester_id,semesters(id,name),courses(id,code,title,level,credit_units),venues(name),profiles!lecturer_id(full_name)))')
  .eq('student_id', profileId).order('submitted_at', { ascending: false }), 1000, 10000);

const counts = () => ({ pending: 0, approved: 0, rejected: 0, absent: 0, correction_requested: 0, excused: 0 });

// ------------------------------------------------------------------ overview (allowed while pending)
router.get('/student/overview', handler(async (req, res) => {
  const p = req.profile;
  const { semester, year } = await currentPeriod();
  const yearName = year ? year.name.replace(/\s*academic\s*year/i, '').trim() : (p.academic_year || '2026/2027');
  const semNum = Number(p.semester || p.raw_user_meta_data?.semester || (semester?.name?.toLowerCase().includes('second') ? 2 : 1));
  const semName = semNum === 2 ? 'Second Semester' : 'First Semester';
  const regs = await myRegistrations(p);

  const records = p.account_status === 'approved' ? await myRecords(p.id) : [];
  const c = counts(); records.forEach(r => { if (c[r.status] !== undefined) c[r.status]++; else c[r.status] = 1; });
  const timetable = p.account_status === 'approved' ? await myTimetable(p, regs) : [];
  const today = weekdayOf(todayInTz());
  const { data: setting } = await admin.from('department_settings').select('min_attendance_threshold').limit(1).maybeSingle();
  const threshold = setting?.min_attendance_threshold || 75;

  res.json({
    account_status: p.account_status,
    courses: regs.length,
    today_classes: timetable.filter(t => t.day_of_week === today).length,
    attendance: { ...c, total: records.length, rate: rate(c) },
    threshold,
    semester: semName,
    semester_num: semNum,
    year: yearName,
    level: p.level || 1,
    programme: p.programme || 'Degree'
  });
}));

// ------------------------------------------------------------------ courses (+ per-course percentage)
router.get('/student/courses', handler(async (req, res) => {
  const [regs, records] = await Promise.all([myRegistrations(req.profile), req.profile.account_status === 'approved' ? myRecords(req.profile.id) : []]);
  const byCourse = new Map();
  records.forEach(r => {
    const id = r.class_sessions?.timetable_entries?.course_id;
    if (!id) return;
    const c = byCourse.get(id) || counts();
    if (c[r.status] !== undefined) c[r.status]++; else c[r.status] = 1;
    byCourse.set(id, c);
  });

  const courseMap = new Map();
  // 1. Matched modules for this student's programme, level & semester
  for (const r of regs) {
    const c = byCourse.get(r.course_id) || counts();
    courseMap.set(r.course_id, {
      id: r.course_id,
      ...r.courses,
      attendance: {
        ...c,
        total: Object.values(c).reduce((a, b) => a + b, 0),
        rate: rate(c)
      }
    });
  }

  // 2. Plus any course that has attendance records for this student
  for (const r of records) {
    const course = r.class_sessions?.timetable_entries?.courses;
    const cid = r.class_sessions?.timetable_entries?.course_id || course?.id;
    if (cid && !courseMap.has(cid)) {
      const c = byCourse.get(cid) || counts();
      courseMap.set(cid, {
        id: cid,
        code: course?.code || 'COMS',
        title: course?.title || 'Department Module',
        credit_units: course?.credit_units || 3,
        level: course?.level || req.profile.level,
        attendance: {
          ...c,
          total: Object.values(c).reduce((a, b) => a + b, 0),
          rate: rate(c)
        }
      });
    }
  }

  // Fetch lecturer mapping for courses
  const courseIds = Array.from(courseMap.keys());
  let lecturerMap = new Map();
  if (courseIds.length) {
    try {
      const [ttLecturers, lcLecturers] = await Promise.all([
        admin.from('timetable_entries').select('course_id,profiles!lecturer_id(full_name)').in('course_id', courseIds),
        admin.from('lecturer_courses').select('course_id,profiles!lecturer_id(full_name)').in('course_id', courseIds)
      ]);
      (ttLecturers.data || []).forEach(t => {
        if (t.profiles?.full_name && !lecturerMap.has(t.course_id)) {
          lecturerMap.set(t.course_id, t.profiles.full_name);
        }
      });
      (lcLecturers.data || []).forEach(l => {
        if (l.profiles?.full_name && !lecturerMap.has(l.course_id)) {
          lecturerMap.set(l.course_id, l.profiles.full_name);
        }
      });
    } catch (_) {}
  }

  courseMap.forEach((c, cid) => {
    c.lecturer_name = lecturerMap.get(cid) || 'Dr. Department Staff';
    c.attended = c.attendance?.approved || 0;
    c.missed = (c.attendance?.absent || 0) + (c.attendance?.rejected || 0);
    c.pending = c.attendance?.pending || 0;
    c.total_classes = c.attendance?.total || 0;
    c.rate = c.attendance?.rate || 0;
  });

  res.json(Array.from(courseMap.values()));
}));

router.use('/student', requireApproved);

// Self course registration (own level, active courses, current semester only)
router.post('/student/courses/register', handler(async (req, res) => {
  const p = z.object({ course_id: z.string().uuid() }).safeParse(req.body);
  if (!p.success) return fail(res, 'Select a course');
  const { year, semester } = await currentPeriod();
  if (!year || !semester) return fail(res, 'No current semester is set. Contact the HOD.');
  const { data: course } = await admin.from('courses').select('id,code,semester_id').eq('id', p.data.course_id)
    .eq('level', req.profile.level).eq('is_active', true).maybeSingle();
  if (!course || (course.semester_id && course.semester_id !== semester.id)) return fail(res, 'That course is not available for your level this semester');
  const { error } = await admin.from('course_registrations').upsert(
    { student_id: req.profile.id, course_id: course.id, academic_year_id: year.id, semester_id: semester.id },
    { onConflict: 'student_id,course_id,academic_year_id,semester_id', ignoreDuplicates: true });
  if (error) return fail(res, error);
  await audit(req.profile.id, 'course_registration', course.id, 'student_registered_course');
  res.status(201).json({ ok: true });
}));

router.get('/student/available-courses', handler(async (req, res) => {
  const { semester } = await currentPeriod();
  const [{ data: courses }, regs] = await Promise.all([
    admin.from('courses').select('id,code,title,level,semester_id').eq('level', req.profile.level).eq('is_active', true).order('code'),
    myRegistrations(req.profile)
  ]);
  const mine = new Set(regs.map(r => r.course_id));
  res.json((courses || []).filter(c => !mine.has(c.id) && (!c.semester_id || c.semester_id === semester?.id)));
}));

// ------------------------------------------------------------------ timetable
router.get('/student/timetable', handler(async (req, res) => {
  res.json(await myTimetable(req.profile, await myRegistrations(req.profile)));
}));

/**
 * Today's scheduled classes with live session state and my submission status.
 * The class code is never included here.
 */
router.get('/student/today', handler(async (req, res) => {
  const date = todayInTz(), dow = weekdayOf(date);
  const settings = await getDepartmentSettings();
  const timetable = (await myTimetable(req.profile, await myRegistrations(req.profile))).filter(t => t.day_of_week === dow);
  if (!timetable.length) return res.json({ date, require_qr_or_code: Boolean(settings.require_qr_or_code), classes: [] });
  const { data: sessions } = await admin.from('class_sessions').select('id,timetable_entry_id,is_open,closes_at')
    .eq('session_date', date).in('timetable_entry_id', timetable.map(t => t.id));
  const bySession = new Map((sessions || []).map(s => [s.timetable_entry_id, s]));
  const { data: records } = sessions?.length
    ? await admin.from('attendance_records').select('session_id,status,review_note').eq('student_id', req.profile.id).in('session_id', sessions.map(s => s.id))
    : { data: [] };
  const byRecord = new Map((records || []).map(r => [r.session_id, r]));
  res.json({
    date,
    require_qr_or_code: Boolean(settings.require_qr_or_code),
    attendance_grace_minutes: settings.attendance_grace_minutes || 15,
    classes: timetable.map(t => {
      const s = bySession.get(t.id), r = s && byRecord.get(s.id);
      return {
        ...t,
        lecturer_name: t.profiles?.full_name || 'Department Lecturer',
        session_open: Boolean(s?.is_open),
        session_id: s?.id || null,
        attendance_status: r?.status || null,
        review_note: r?.review_note || null
      };
    })
  });
}));


// ------------------------------------------------------------------ history
router.get('/student/attendance', handler(async (req, res) => {
  const records = await myRecords(req.profile.id);
  res.json(records.slice(0, 500));
}));

export default router;
