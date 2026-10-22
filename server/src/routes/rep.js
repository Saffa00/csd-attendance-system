import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { audit, getRepAllocation, fetchAll, currentPeriod, notify } from '../services.js';
import { rate, todayInTz } from '../utils.js';
import { ensureSemesterSessions } from '../finalize.js';

/**
 * Class representative: restricted to the single class (programme + level) they are assigned to.
 * Reps can manage the timetable and view students/attendance. They cannot manage lecturers and
 * cannot approve or reject attendance (those routes are lecturer/HOD only).
 */
const router = Router();
router.use('/class-rep', authenticate, requirePasswordChanged, allow('class_rep', 'rep', 'hod'));

const fail = (res, e, status = 400) => res.status(status).json({ error: typeof e === 'string' ? e : e.message });
const wrap = fn => async (req, res) => {
  try { await fn(req, res, await getRepAllocation(req.profile.id)); }
  catch (e) { fail(res, e, e.status || 400); }
};
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).transform(t => (t.length === 5 ? `${t}:00` : t));
const timetableSchema = z.object({
  course_id: z.string().uuid(), day_of_week: z.coerce.number().int().min(0).max(6),
  starts_at: time, ends_at: time, venue_id: z.string().uuid(), lecturer_id: z.string().uuid()
});
const SELECT_TT = 'id,day_of_week,starts_at,ends_at,course_id,venue_id,lecturer_id,courses(id,code,title),venues(id,name),profiles!lecturer_id(id,full_name)';

const classEntries = a => admin.from('timetable_entries').select(SELECT_TT)
  .eq('level', a.level).eq('programme', a.programme)
  .eq('academic_year_id', a.academic_year_id).eq('semester_id', a.semester_id);

// ------------------------------------------------------------------ overview
router.get('/class-rep/overview', wrap(async (req, res, a) => {
  const [students, pending, entries, records, period, recentRecords, announcements] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('level', a.level).eq('programme', a.programme).eq('account_status', 'approved').eq('is_active', true),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('level', a.level).eq('programme', a.programme).eq('account_status', 'pending'),
    classEntries(a).order('day_of_week').order('starts_at'),
    fetchAll(() => admin.from('attendance_records').select('status,class_sessions!inner(timetable_entries!inner(level,programme))')
      .eq('class_sessions.timetable_entries.level', a.level).eq('class_sessions.timetable_entries.programme', a.programme)),
    currentPeriod(),
    admin.from('attendance_records')
      .select('id,status,submitted_at,client_timestamp,review_note,profiles!student_id(full_name,student_id),class_sessions(id,session_date,timetable_entries(course_id,level,courses(code,title),venues(name),profiles!lecturer_id(full_name)))')
      .order('submitted_at', { ascending: false })
      .limit(6),
    admin.from('announcements')
      .select('id,title,message,created_at,is_important')
      .order('created_at', { ascending: false })
      .limit(3)
  ]);
  if (entries.error) return fail(res, entries.error);
  const summary = { pending: 0, approved: 0, rejected: 0, absent: 0, correction_requested: 0 };
  records.forEach(r => { summary[r.status]++; });
  const total = records.length;
  res.json({
    class: { level: a.level, programme: a.programme },
    academic_year: period?.academic_year?.name || '2026/2027 Academic Year',
    semester: period?.semester?.name || 'First Semester',
    students: students.count || 0,
    pending_registrations: pending.count || 0,
    timetable: entries.data || [],
    attendance: { ...summary, total, rate: rate(summary) },
    recent_records: recentRecords.data || [],
    announcements: announcements.data || []
  });
}));

// ------------------------------------------------------------------ students (with their attendance summary)
router.get('/class-rep/students', wrap(async (req, res, a) => {
  let q = admin.from('profiles')
    .select('id,student_id,full_name,phone_number,account_status,is_active,programme,level')
    .eq('role', 'student');
  if (a.level) q = q.eq('level', a.level);
  if (a.programme) q = q.ilike('programme', a.programme);
  const { data: students, error } = await q.order('full_name').limit(2000);
  if (error) return fail(res, error);
  const ids = (students || []).map(s => s.id), stats = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await fetchAll(() => admin.from('attendance_records').select('student_id,status').in('student_id', ids.slice(i, i + 200)));
    rows.forEach(r => {
      const s = stats.get(r.student_id) || { total: 0, approved: 0, pending: 0, absent: 0, rejected: 0, correction_requested: 0 };
      s.total++; s[r.status]++; stats.set(r.student_id, s);
    });
  }
  res.json(students.map(s => {
    const st = stats.get(s.id) || { total: 0, approved: 0, pending: 0, absent: 0, rejected: 0, correction_requested: 0 };
    return { ...s, attendance: { ...st, rate: rate(st) } };
  }));
}));

// ------------------------------------------------------------------ class attendance records (view only)
router.get('/class-rep/attendance', wrap(async (req, res, a) => {
  const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(100, Number(req.query.limit) || 50);
  let q = admin.from('attendance_records').select(
    'id,status,submitted_at,submitted_offline,review_note,profiles!student_id(id,student_id,full_name),class_sessions!inner(session_date,timetable_entries!inner(level,programme,course_id,courses(code,title)))',
    { count: 'exact' })
    .eq('class_sessions.timetable_entries.level', a.level).eq('class_sessions.timetable_entries.programme', a.programme)
    .order('submitted_at', { ascending: false }).range((page - 1) * size, page * size - 1);
  const { status, course_id, from, to } = req.query;
  if (['pending', 'approved', 'rejected', 'absent', 'correction_requested'].includes(status)) q = q.eq('status', status);
  if (course_id && z.string().uuid().safeParse(course_id).success) q = q.eq('class_sessions.timetable_entries.course_id', course_id);
  if (from) q = q.gte('class_sessions.session_date', from);
  if (to) q = q.lte('class_sessions.session_date', to);
  const { data, error, count } = await q;
  if (error) return fail(res, error);
  res.json({ rows: data, total: count || 0, page, size });
}));

// ------------------------------------------------------------------ timetable
router.get('/class-rep/timetable', wrap(async (req, res, a) => {
  const { data, error } = await classEntries(a).order('day_of_week').order('starts_at');
  if (error) return fail(res, error);
  res.json(data);
}));

router.get('/class-rep/options', wrap(async (req, res, a) => {
  const [courses, venues, lecturers] = await Promise.all([
    admin.from('courses').select('id,code,title').eq('is_active', true).eq('level', a.level).order('code'),
    admin.from('venues').select('id,name').eq('is_active', true).order('name'),
    admin.from('lecturer_courses').select('lecturer_id,course_id,profiles!lecturer_id(id,full_name,is_active)')
      .eq('academic_year_id', a.academic_year_id).eq('semester_id', a.semester_id)
  ]);
  const err = [courses, venues, lecturers].find(x => x.error);
  if (err) return fail(res, err.error);
  res.json({
    courses: courses.data, venues: venues.data, allocation: { level: a.level, programme: a.programme },
    // lecturers with the courses they teach, so the form only offers valid pairs
    lecturers: lecturers.data.filter(l => l.profiles?.is_active)
      .map(l => ({ id: l.lecturer_id, full_name: l.profiles.full_name, course_id: l.course_id }))
  });
}));

/** Validates references and rejects clashes (same class, venue or lecturer at the same time). */
async function validateEntry(a, b, ignoreId = null) {
  if (b.ends_at <= b.starts_at) return 'End time must be after the start time';
  const [course, venue, alloc, sameDay] = await Promise.all([
    admin.from('courses').select('id').eq('id', b.course_id).eq('level', a.level).eq('is_active', true).maybeSingle(),
    admin.from('venues').select('id').eq('id', b.venue_id).eq('is_active', true).maybeSingle(),
    admin.from('lecturer_courses').select('id').eq('course_id', b.course_id).eq('lecturer_id', b.lecturer_id)
      .eq('academic_year_id', a.academic_year_id).eq('semester_id', a.semester_id).maybeSingle(),
    admin.from('timetable_entries').select('id,level,programme,venue_id,lecturer_id')
      .eq('day_of_week', b.day_of_week).eq('academic_year_id', a.academic_year_id).eq('semester_id', a.semester_id)
      .lt('starts_at', b.ends_at).gt('ends_at', b.starts_at)
  ]);
  if (!course.data) return 'Choose an active course for your level';
  if (!venue.data) return 'Choose an active venue';
  if (!alloc.data) return 'That lecturer is not assigned to this course';
  for (const e of sameDay.data || []) {
    if (e.id === ignoreId) continue;
    if (e.level === a.level && e.programme === a.programme) return 'Your class already has a lecture at that time';
    if (e.venue_id === b.venue_id) return 'That venue is already booked at that time';
    if (e.lecturer_id === b.lecturer_id) return 'That lecturer already teaches another class at that time';
  }
  return null;
}

router.post('/class-rep/timetable', wrap(async (req, res, a) => {
  const p = timetableSchema.safeParse(req.body);
  if (!p.success) return fail(res, 'Please check the form: ' + p.error.issues.map(i => i.path[0]).join(', '));
  const problem = await validateEntry(a, p.data);
  if (problem) return fail(res, problem, 409);
  const { data, error } = await admin.from('timetable_entries').insert({
    ...p.data, level: a.level, programme: a.programme, academic_year_id: a.academic_year_id, semester_id: a.semester_id, created_by: req.profile.id
  }).select(SELECT_TT).single();
  if (error) return fail(res, error);

  // Auto-generate sessions across semester weeks
  await ensureSemesterSessions(data.id).catch(() => {});

  // Notify lecturer
  if (data.lecturer_id) {
    const courseCode = data.courses?.code || 'Module';
    await notify(data.lecturer_id, 'New class scheduled', `A new lecture has been scheduled for ${courseCode} starting at ${data.starts_at}.`);
  }

  await audit(req.profile.id, 'timetable_entry', data.id, 'created', null, p.data);
  res.status(201).json(data);
}));

router.patch('/class-rep/timetable/:id', wrap(async (req, res, a) => {
  const p = timetableSchema.safeParse(req.body);
  if (!p.success) return fail(res, 'Please check the form: ' + p.error.issues.map(i => i.path[0]).join(', '));
  const { data: old } = await classEntries(a).eq('id', req.params.id).maybeSingle();
  if (!old) return fail(res, 'Timetable entry not found in your class', 404);
  const problem = await validateEntry(a, p.data, old.id);
  if (problem) return fail(res, problem, 409);
  const { data, error } = await admin.from('timetable_entries').update(p.data).eq('id', old.id).select(SELECT_TT).single();
  if (error) return fail(res, error);

  // Apply to future sessions only (delete future unfinalized sessions and re-generate)
  const today = todayInTz();
  await admin.from('class_sessions')
    .delete()
    .eq('timetable_entry_id', old.id)
    .gt('session_date', today)
    .is('finalized_at', null)
    .eq('is_open', false);

  await ensureSemesterSessions(data.id).catch(() => {});

  // Notify lecturer(s)
  const lecturerIds = [...new Set([old.lecturer_id, data.lecturer_id].filter(Boolean))];
  if (lecturerIds.length) {
    const courseCode = data.courses?.code || old.courses?.code || 'Module';
    await notify(lecturerIds, 'Timetable updated', `The schedule for ${courseCode} has been updated by your class representative.`);
  }

  await audit(req.profile.id, 'timetable_entry', old.id, 'updated', old, p.data);
  res.json(data);
}));

router.delete('/class-rep/timetable/:id', wrap(async (req, res, a) => {
  const { data: old } = await classEntries(a).eq('id', req.params.id).maybeSingle();
  if (!old) return fail(res, 'Timetable entry not found in your class', 404);

  // Apply to future sessions only
  const today = todayInTz();
  await admin.from('class_sessions')
    .delete()
    .eq('timetable_entry_id', old.id)
    .gt('session_date', today)
    .is('finalized_at', null)
    .eq('is_open', false);

  const { error } = await admin.from('timetable_entries').delete().eq('id', old.id);
  if (error) return fail(res, error.code === '23503' ? 'This entry has past recorded sessions and cannot be completely deleted' : error);

  if (old.lecturer_id) {
    const courseCode = old.courses?.code || 'Module';
    await notify(old.lecturer_id, 'Class removed from timetable', `The timetable entry for ${courseCode} was removed by your class representative.`);
  }

  await audit(req.profile.id, 'timetable_entry', old.id, 'deleted', old);
  res.json({ ok: true });
}));


export default router;
