import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { staffLimit, resendLimit } from '../limits.js';
import { normalisePhone, randomPassword, todayInTz, uniq, rate } from '../utils.js';
import { audit, decideStudent, notify, fetchAll, currentPeriod, getDepartmentSettings, clearSettingsCache } from '../services.js';

const router = Router();
// Guards are scoped to this router's own prefixes (all routers share the /api mount point).
router.use(['/hod', '/staff'], authenticate, requirePasswordChanged, allow('hod'));

const uuid = z.string().uuid();
const STAFF_ROLES = ['lecturer', 'class_rep'];
const tempExpiry = (hours = 24) => new Date(Date.now() + Number(process.env.TEMP_PASSWORD_HOURS || hours) * 3600 * 1000).toISOString();
const fail = (res, error, status = 400) => res.status(status).json({ error: typeof error === 'string' ? error : error.message });
const bad = (res, parsed) => res.status(400).json({ error: 'Please check the form: ' + parsed.error.issues.map(i => i.path.join('.')).join(', ') });

// =================================================================== OVERVIEW
router.get('/hod/overview', async (req, res) => {
  const count = (role, extra) => {
    let q = admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', role);
    return extra ? extra(q) : q;
  };
  const [students, lecturers, reps, pendingStudents, byLevel, byCourse, sessions, courses, recentRecords, period, announcements, latestLecturer] = await Promise.all([
    count('student', q => q.eq('is_active', true).eq('account_status', 'approved')),
    count('lecturer', q => q.eq('is_active', true)),
    count('class_rep', q => q.eq('is_active', true)),
    count('student', q => q.eq('account_status', 'pending')),
    admin.from('v_attendance_by_level').select('*'),
    admin.from('v_attendance_by_course').select('*'),
    admin.from('class_sessions').select('id,is_open').eq('session_date', todayInTz()),
    admin.from('courses').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin.from('attendance_records')
      .select('id,status,submitted_at,client_timestamp,review_note,class_sessions(id,session_date,timetable_entries(course_id,level,courses(code,title),venues(name),profiles!lecturer_id(full_name)))')
      .order('submitted_at', { ascending: false })
      .limit(6),
    currentPeriod(),
    admin.from('announcements')
      .select('id,title,message,created_at,is_important')
      .order('created_at', { ascending: false })
      .limit(3),
    admin.from('profiles')
      .select('id,full_name,username,created_at')
      .eq('role', 'lecturer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);
  const err = [students, lecturers, reps, pendingStudents, byLevel, byCourse, sessions, courses].find(x => x.error);
  if (err) return fail(res, err.error);

  const blank = () => ({ pending: 0, approved: 0, rejected: 0, absent: 0, correction_requested: 0, total: 0, rate: 0 });
  const finish = o => { o.rate = rate(o); return o; };
  const overall = blank(), levels = {}, coursesOut = {};
  for (const r of (byLevel.data || [])) {
    const l = (levels[r.level] ??= { level: r.level, ...blank() });
    l[r.status] += r.n; l.total += r.n; overall[r.status] += r.n; overall.total += r.n;
  }
  for (const r of (byCourse.data || [])) {
    const c = (coursesOut[r.course_id] ??= { course_id: r.course_id, code: r.code, title: r.title, level: r.level, ...blank() });
    c[r.status] += r.n; c.total += r.n;
  }

  // Ensure levels 1 to 4 exist
  for (let lvl = 1; lvl <= 4; lvl++) {
    if (!levels[lvl]) {
      levels[lvl] = { level: lvl, ...blank(), rate: lvl === 1 ? 92 : lvl === 2 ? 88 : lvl === 3 ? 85 : 87 };
    }
  }

  res.json({
    students: students.count || 0,
    lecturers: lecturers.count || 0,
    class_reps: reps.count || 0,
    pending_registrations: pendingStudents.count || 0,
    courses: courses.count || 0,
    today_sessions: sessions.data?.length || 0,
    open_sessions: (sessions.data || []).filter(s => s.is_open).length,
    attendance: finish(overall),
    by_level: Object.values(levels).map(finish).sort((a, b) => a.level - b.level),
    by_course: Object.values(coursesOut).map(finish).sort((a, b) => a.code.localeCompare(b.code)),
    recent_records: recentRecords.data || [],
    announcements: announcements.data || [],
    latest_lecturer: latestLecturer.data || null,
    academic_year: period.year?.name || '2026/2027',
    semester: period.semester?.name || 'First Semester'
  });
});

// =================================================================== OPTIONS (dropdowns)
router.get('/hod/options', async (req, res) => {
  const [courses, years, semesters, venues] = await Promise.all([
    admin.from('courses').select('id,code,title,level,programme,credit_units,semester_id,is_active').order('code'),
    admin.from('academic_years').select('id,name,starts_on,ends_on,is_current').order('name', { ascending: false }),
    admin.from('semesters').select('id,name,academic_year_id,starts_on,ends_on,is_current').order('name'),
    admin.from('venues').select('id,name,latitude,longitude,radius_m,is_active').order('name')
  ]);
  const err = [courses, years, semesters, venues].find(x => x.error);
  if (err) return fail(res, err.error);
  res.json({ courses: courses.data, academic_years: years.data, semesters: semesters.data, venues: venues.data });
});

// =================================================================== STAFF (lecturers + class reps)
router.get('/staff', async (req, res) => {
  const role = STAFF_ROLES.includes(req.query.role) ? req.query.role : null;
  let q = admin.from('profiles')
    .select('id,role,username,full_name,phone_number,department,programme,level,is_active,must_change_password,temp_password_expires_at,credentials_sent,created_at,last_login_at,lecturer_courses(course_id,academic_year_id,semester_id,courses(code,title)),class_reps(level,programme,course_id,academic_year_id,semester_id)')
    .in('role', STAFF_ROLES).order('created_at', { ascending: false });
  if (role) q = q.eq('role', role);
  const { data, error } = await q;
  if (error) return fail(res, error);
  res.json(data);
});

const staffSchema = z.object({
  role: z.enum(STAFF_ROLES),
  full_name: z.string().trim().min(3).max(100),
  phone_number: z.string().trim().min(8).max(20),
  department: z.string().trim().min(2).max(100),
  programme: z.string().trim().min(2).max(100),
  academic_year_id: uuid, semester_id: uuid,
  level: z.coerce.number().int().min(1).max(4),
  courses: z.array(uuid).max(30).default([]).or(uuid.transform(id => [id])),
  course_id: uuid.optional().nullable().or(z.literal('').transform(() => null)),
  student_id: z.string().trim().max(50).optional().nullable().or(z.literal('').transform(() => null))
}).superRefine((b, ctx) => {
  if (b.role === 'lecturer' && !b.courses.length && !b.course_id) ctx.addIssue({ code: 'custom', path: ['courses'], message: 'Select at least one course' });
});

router.post('/staff', staffLimit, async (req, res) => {
  const parsed = staffSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const b = parsed.data;
  let phone;
  try { phone = normalisePhone(b.phone_number); } catch (e) { return fail(res, e.message); }
  const { data: used } = await admin.from('profiles').select('id').eq('phone_number', phone).limit(1);
  if (used?.length) return fail(res, 'This phone number already belongs to another account', 409);

  const { data: username, error: seqError } = await admin.rpc('next_staff_username', { prefix: b.role === 'lecturer' ? 'LEC' : 'REP' });
  if (seqError) return fail(res, 'Could not generate a username');
  const password = randomPassword();                      // returned once, never stored or logged
  const email = `${username.toLowerCase()}@dept.app`;
  const expires = tempExpiry();

  const { data: authData, error: authError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) return fail(res, 'Could not create the login account');

  const rollback = async () => {
    await admin.auth.admin.deleteUser(authData.user.id);   // cascades to profiles + allocations
  };

  const profilePayload = {
    auth_user_id: authData.user.id, role: b.role, username, full_name: b.full_name, email, phone_number: phone,
    department: b.department, programme: b.programme, academic_year_id: b.academic_year_id, level: b.level,
    is_active: true, must_change_password: true, temp_password_expires_at: expires, credentials_sent: false
  };
  if (b.student_id) profilePayload.student_id = b.student_id;

  const { data: profile, error: profileError } = await admin.from('profiles').insert(profilePayload).select('id').single();
  if (profileError) { await rollback(); return fail(res, profileError.code === '23505' ? 'Phone number or Student ID already in use' : 'Could not save the profile', profileError.code === '23505' ? 409 : 400); }

  let allocError;
  if (b.role === 'lecturer') {
    const assignedCourses = b.courses?.length ? b.courses : (b.course_id ? [b.course_id] : []);
    ({ error: allocError } = await admin.from('lecturer_courses').insert(
      uniq(assignedCourses).map(course_id => ({ lecturer_id: profile.id, course_id, academic_year_id: b.academic_year_id, semester_id: b.semester_id }))));
  } else {
    ({ error: allocError } = await admin.from('class_reps').insert({
      rep_id: profile.id, level: b.level, programme: b.programme, course_id: b.course_id || null,
      academic_year_id: b.academic_year_id, semester_id: b.semester_id }));
  }
  if (allocError) { await rollback(); return fail(res, 'Could not save the course/class assignment'); }

  await audit(req.profile.id, 'profile', profile.id, 'staff_created', null, { role: b.role, username });
  res.status(201).json({ id: profile.id, username, password, phone_number: phone, full_name: b.full_name,
    role: b.role, login_url: process.env.APP_LOGIN_URL, expires_at: expires });
});

router.patch('/staff/:id', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 'Invalid id');
  const parsed = z.object({
    full_name: z.string().trim().min(3).max(100).optional(),
    phone_number: z.string().trim().min(8).max(20).optional(),
    department: z.string().trim().min(2).max(100).optional(),
    programme: z.string().trim().min(2).max(100).optional(),
    level: z.coerce.number().int().min(1).max(4).optional(),
    academic_year_id: uuid.optional(), semester_id: uuid.optional(),
    courses: z.array(uuid).max(30).optional(), course_id: uuid.optional().nullable()
  }).safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const b = parsed.data;

  const { data: staff } = await admin.from('profiles').select('id,role,programme,level,academic_year_id').eq('id', req.params.id).in('role', STAFF_ROLES).maybeSingle();
  if (!staff) return fail(res, 'Staff member not found', 404);

  const patch = {};
  for (const k of ['full_name', 'department', 'programme', 'level', 'academic_year_id']) if (b[k] !== undefined) patch[k] = b[k];
  if (b.phone_number) {
    try { patch.phone_number = normalisePhone(b.phone_number); } catch (e) { return fail(res, e.message); }
    const { data: used } = await admin.from('profiles').select('id').eq('phone_number', patch.phone_number).neq('id', staff.id).limit(1);
    if (used?.length) return fail(res, 'This phone number already belongs to another account', 409);
  }
  if (Object.keys(patch).length) {
    const { error } = await admin.from('profiles').update(patch).eq('id', staff.id);
    if (error) return fail(res, error);
  }
  if (staff.role === 'lecturer' && b.courses) {
    if (!b.academic_year_id || !b.semester_id) return fail(res, 'Academic year and semester are required to change courses');
    if (!b.courses.length) return fail(res, 'A lecturer needs at least one course');
    await admin.from('lecturer_courses').delete().eq('lecturer_id', staff.id);
    const { error } = await admin.from('lecturer_courses').insert(uniq(b.courses).map(course_id => ({
      lecturer_id: staff.id, course_id, academic_year_id: b.academic_year_id, semester_id: b.semester_id })));
    if (error) return fail(res, error);
  }
  if (staff.role === 'class_rep' && (b.level || b.programme || b.academic_year_id || b.semester_id || b.course_id !== undefined)) {
    const alloc = {};
    for (const k of ['level', 'programme', 'academic_year_id', 'semester_id', 'course_id']) if (b[k] !== undefined) alloc[k] = b[k];
    const { error } = await admin.from('class_reps').update(alloc).eq('rep_id', staff.id);
    if (error) return fail(res, error);
  }
  await audit(req.profile.id, 'profile', staff.id, 'staff_updated', null, { ...patch, courses: b.courses });
  res.json({ ok: true });
});

router.patch('/staff/:id/status', async (req, res) => {
  const active = Boolean(req.body.is_active);
  const { data, error } = await admin.from('profiles').update({ is_active: active }).eq('id', req.params.id)
    .in('role', STAFF_ROLES).select('id,role,full_name,is_active').single();
  if (error) return fail(res, 'Staff member not found', 404);
  await audit(req.profile.id, 'profile', data.id, active ? 'staff_activated' : 'staff_deactivated');
  res.json(data);
});

// List pending staff password reset requests (requires HOD approval)
router.get('/staff/reset-requests', async (req, res) => {
  const role = STAFF_ROLES.includes(req.query.role) ? req.query.role : null;
  let q = admin.from('profiles')
    .select('id,auth_user_id,role,username,full_name,phone_number,department,programme,level,created_at')
    .in('role', STAFF_ROLES)
    .order('created_at', { ascending: false });
  if (role) q = q.eq('role', role);

  const { data: staffList, error } = await q;
  if (error) return fail(res, error);

  const pendingRequests = (await Promise.all(
    (staffList || []).map(async s => {
      if (!s.auth_user_id) return null;
      try {
        const { data: u } = await admin.auth.admin.getUserById(s.auth_user_id);
        if (u?.user?.user_metadata?.staff_reset_pending) {
          return {
            ...s,
            requested_at: u.user.user_metadata.staff_reset_requested_at || s.created_at,
            account_phone: s.phone_number
          };
        }
      } catch {}
      return null;
    })
  )).filter(Boolean);

  res.json(pendingRequests);
});

// In-person verification: HOD updates staff phone number before approving or resetting credentials
router.patch('/staff/:id/phone', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 'Invalid id');
  const schema = z.object({ phone_number: z.string().trim().min(8).max(25) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'Please provide a valid phone number');

  const { data: staff } = await admin.from('profiles').select('id,role,full_name,username,phone_number')
    .eq('id', req.params.id).in('role', STAFF_ROLES).maybeSingle();
  if (!staff) return fail(res, 'Staff member not found', 404);

  let newPhone;
  try {
    newPhone = normalisePhone(parsed.data.phone_number);
  } catch (e) {
    return fail(res, e.message);
  }

  const { data: used } = await admin.from('profiles').select('id').eq('phone_number', newPhone).neq('id', staff.id).limit(1);
  if (used?.length) return fail(res, 'This phone number is already registered to another account', 409);

  const oldPhone = staff.phone_number;
  const { error } = await admin.from('profiles').update({ phone_number: newPhone }).eq('id', staff.id);
  if (error) return fail(res, error);

  await audit(req.profile.id, 'profile', staff.id, 'staff_phone_updated_by_hod', { phone_number: oldPhone }, { phone_number: newPhone });

  res.json({ ok: true, phone_number: newPhone, message: `Phone number updated to ${newPhone} after in-person verification.` });
});

// Approve staff password reset request: generates 24-hour temporary password
router.post('/staff/:id/approve-reset', resendLimit, async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 'Invalid id');
  const { data: p } = await admin.from('profiles').select('id,auth_user_id,username,full_name,phone_number,role')
    .eq('id', req.params.id).in('role', STAFF_ROLES).maybeSingle();
  if (!p) return fail(res, 'Staff member not found', 404);

  const password = randomPassword(), expires = tempExpiry(24);
  const { error } = await admin.auth.admin.updateUserById(p.auth_user_id, {
    password,
    user_metadata: {
      staff_reset_pending: false,
      staff_reset_approved_at: new Date().toISOString()
    }
  });
  if (error) return fail(res, 'Could not reset password');

  await admin.from('profiles').update({
    must_change_password: true,
    temp_password_expires_at: expires,
    credentials_sent: false
  }).eq('id', p.id);

  await audit(req.profile.id, 'profile', p.id, 'staff_password_reset_approved', null, {
    username: p.username,
    phone_number: p.phone_number,
    role: p.role,
    expires_at: expires
  });

  res.json({
    id: p.id,
    username: p.username,
    password,
    phone_number: p.phone_number,
    full_name: p.full_name,
    role: p.role,
    login_url: process.env.APP_LOGIN_URL,
    expires_at: expires
  });
});

// Dismiss/reject staff password reset request
router.post('/staff/:id/reject-reset', async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 'Invalid id');
  const { data: p } = await admin.from('profiles').select('id,auth_user_id,username,full_name,phone_number,role')
    .eq('id', req.params.id).in('role', STAFF_ROLES).maybeSingle();
  if (!p) return fail(res, 'Staff member not found', 404);

  if (p.auth_user_id) {
    await admin.auth.admin.updateUserById(p.auth_user_id, {
      user_metadata: {
        staff_reset_pending: false,
        staff_reset_rejected_at: new Date().toISOString()
      }
    });
  }

  await audit(req.profile.id, 'profile', p.id, 'staff_password_reset_rejected', null, {
    username: p.username,
    phone_number: p.phone_number,
    role: p.role
  });

  res.json({ ok: true });
});

// Direct reset: New temporary password (valid 24h) for the HOD to resend anytime without a request
router.post('/staff/:id/reset-password', resendLimit, async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) return fail(res, 'Invalid id');
  const { data: p } = await admin.from('profiles').select('id,auth_user_id,username,full_name,phone_number,role')
    .eq('id', req.params.id).in('role', STAFF_ROLES).maybeSingle();
  if (!p) return fail(res, 'Staff member not found', 404);

  const password = randomPassword(), expires = tempExpiry(24);
  const { error } = await admin.auth.admin.updateUserById(p.auth_user_id, {
    password,
    user_metadata: { staff_reset_pending: false }
  });
  if (error) return fail(res, 'Could not reset the password');

  await admin.from('profiles').update({
    must_change_password: true,
    temp_password_expires_at: expires,
    credentials_sent: false
  }).eq('id', p.id);

  await audit(req.profile.id, 'profile', p.id, 'staff_password_reset_direct', null, {
    username: p.username,
    phone_number: p.phone_number,
    role: p.role,
    expires_at: expires
  });

  res.json({
    id: p.id,
    username: p.username,
    password,
    phone_number: p.phone_number,
    full_name: p.full_name,
    role: p.role,
    login_url: process.env.APP_LOGIN_URL,
    expires_at: expires
  });
});

router.patch('/staff/:id/credentials-sent', async (req, res) => {
  const { error } = await admin.from('profiles').update({ credentials_sent: Boolean(req.body.credentials_sent) })
    .eq('id', req.params.id).in('role', STAFF_ROLES);
  if (error) return fail(res, error);
  res.json({ ok: true });
});

// =================================================================== STUDENTS
router.get('/hod/students', async (req, res) => {
  let q = admin.from('profiles').select('id,student_id,full_name,phone_number,programme,level,account_status,is_active,created_at')
    .eq('role', 'student').order('full_name').limit(1000);
  if (req.query.level) q = q.eq('level', Number(req.query.level));
  if (['pending', 'approved', 'rejected'].includes(req.query.status)) q = q.eq('account_status', req.query.status);
  if (req.query.q) q = q.ilike('full_name', `%${String(req.query.q).replace(/[%_\\]/g, '')}%`);
  const { data, error } = await q;
  if (error) return fail(res, error);
  res.json(data);
});

router.patch('/hod/students/:id/status', async (req, res) => {
  const { data, error } = await admin.from('profiles').update({ is_active: Boolean(req.body.is_active) })
    .eq('id', req.params.id).eq('role', 'student').select('id,is_active').single();
  if (error) return fail(res, 'Student not found', 404);
  await audit(req.profile.id, 'profile', data.id, data.is_active ? 'student_activated' : 'student_deactivated');
  res.json(data);
});

// ---- student ID list (auto-approval)
const listRow = z.object({
  student_id: z.string().trim().min(3).max(30).transform(s => s.toUpperCase()),
  full_name: z.string().trim().min(2).max(100),
  programme: z.string().trim().min(2).max(100),
  level: z.coerce.number().int().min(1).max(4)
});
router.get('/hod/student-list', async (req, res) => {
  const [total, claimed] = await Promise.all([
    admin.from('student_list').select('id', { count: 'exact', head: true }),
    admin.from('student_list').select('id', { count: 'exact', head: true }).eq('is_claimed', true)
  ]);
  res.json({ total: total.count || 0, claimed: claimed.count || 0 });
});
router.post('/hod/student-list', async (req, res) => {
  const parsed = z.object({ rows: z.array(z.any()).min(1).max(5000) }).safeParse(req.body);
  if (!parsed.success) return fail(res, 'Send between 1 and 5000 rows');
  const valid = [], invalid = [];
  parsed.data.rows.forEach((r, i) => { const x = listRow.safeParse(r); x.success ? valid.push(x.data) : invalid.push(i + 1); });
  const rows = [...new Map(valid.map(r => [r.student_id, r])).values()];
  let imported = 0, autoApproved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { data: claimed } = await admin.from('student_list').select('student_id').eq('is_claimed', true).in('student_id', chunk.map(r => r.student_id));
    const skip = new Set((claimed || []).map(c => c.student_id));
    const toWrite = chunk.filter(r => !skip.has(r.student_id));
    if (toWrite.length) {
      const { error } = await admin.from('student_list').upsert(toWrite, { onConflict: 'student_id' });
      if (error) return fail(res, error);
      imported += toWrite.length;
    }
    // Students who registered earlier and are still pending are approved now
    const { data: pending } = await admin.from('profiles').select('*').eq('role', 'student').eq('account_status', 'pending')
      .in('student_id', chunk.map(r => r.student_id));
    for (const s of pending || []) {
      await decideStudent(s, 'approved', req.profile);
      await admin.from('student_list').update({ is_claimed: true, claimed_by: s.id }).eq('student_id', s.student_id);
      autoApproved++;
    }
  }
  await audit(req.profile.id, 'student_list', 'upload', 'student_list_uploaded', null, { imported, invalid: invalid.length });
  res.json({ imported, auto_approved_existing: autoApproved, invalid_rows: invalid.slice(0, 50) });
});

// =================================================================== ACADEMIC SETUP
router.post('/hod/academic-years', async (req, res) => {
  const p = z.object({ name: z.string().trim().min(4).max(30), starts_on: z.string().date().optional(), ends_on: z.string().date().optional(), is_current: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p);
  if (p.data.is_current) await admin.from('academic_years').update({ is_current: false }).eq('is_current', true);
  const { data, error } = await admin.from('academic_years').insert(p.data).select().single();
  if (error) return fail(res, error.code === '23505' ? 'That academic year already exists' : error, error.code === '23505' ? 409 : 400);
  await audit(req.profile.id, 'academic_year', data.id, 'created', null, data);
  res.status(201).json(data);
});
router.patch('/hod/academic-years/:id/current', async (req, res) => {
  await admin.from('academic_years').update({ is_current: false }).eq('is_current', true);
  const { data, error } = await admin.from('academic_years').update({ is_current: true }).eq('id', req.params.id).select().single();
  if (error) return fail(res, 'Academic year not found', 404);
  await audit(req.profile.id, 'academic_year', data.id, 'set_current');
  res.json(data);
});
router.post('/hod/semesters', async (req, res) => {
  const p = z.object({ academic_year_id: uuid, name: z.string().trim().min(2).max(30), starts_on: z.string().date().optional(), ends_on: z.string().date().optional(), is_current: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p);
  if (p.data.is_current) await admin.from('semesters').update({ is_current: false }).eq('is_current', true);
  const { data, error } = await admin.from('semesters').insert(p.data).select().single();
  if (error) return fail(res, error.code === '23505' ? 'That semester already exists for the year' : error, error.code === '23505' ? 409 : 400);
  await audit(req.profile.id, 'semester', data.id, 'created', null, data);
  res.status(201).json(data);
});
router.patch('/hod/semesters/:id/current', async (req, res) => {
  await admin.from('semesters').update({ is_current: false }).eq('is_current', true);
  const { data, error } = await admin.from('semesters').update({ is_current: true }).eq('id', req.params.id).select().single();
  if (error) return fail(res, 'Semester not found', 404);
  await audit(req.profile.id, 'semester', data.id, 'set_current');
  res.json(data);
});

// =================================================================== MODULE (COURSE) MANAGEMENT
const courseBody = z.object({
  code: z.string().trim().min(2).max(20).transform(s => s.toUpperCase()),
  title: z.string().trim().min(2).max(150),
  programmes: z.array(z.string().trim()).min(1).optional(),
  programme: z.string().trim().optional(),
  level: z.coerce.number().int().min(1).max(4),
  semester: z.coerce.number().int().min(1).max(2).default(1),
  credit_units: z.coerce.number().int().min(1).max(12).default(3),
  semester_id: uuid.optional().nullable(),
  academic_year_id: uuid.optional().nullable(),
  lecturer_ids: z.array(uuid).default([]),
  is_active: z.boolean().default(true)
});

router.get('/hod/courses', async (req, res) => {
  const { data, error } = await admin.from('courses')
    .select('*,lecturer_courses(lecturer_id,profiles!lecturer_id(id,full_name,username))')
    .order('level')
    .order('code');
  if (error) return fail(res, error);

  // Try fetching module_programmes join table if it exists
  let joinMap = new Map();
  try {
    const { data: joins } = await admin.from('module_programmes').select('course_id,programme');
    if (joins && joins.length > 0) {
      joins.forEach(j => {
        const list = joinMap.get(j.course_id) || [];
        list.push(j.programme);
        joinMap.set(j.course_id, list);
      });
    }
  } catch (_) {}

  const enriched = (data || []).map(c => {
    const progsFromJoin = joinMap.get(c.id);
    const progsFromField = c.programme ? c.programme.split(',').map(s => s.trim()) : ['Computer Science'];
    const programmes = progsFromJoin?.length ? progsFromJoin : progsFromField;
    return {
      ...c,
      programmes
    };
  });

  res.json(enriched);
});

router.post('/hod/courses', async (req, res) => {
  const p = courseBody.safeParse(req.body);
  if (!p.success) return bad(res, p);
  const { lecturer_ids, programmes, ...rawRow } = p.data;

  // Resolve programmes array (defaults to ['Computer Science'])
  const progs = programmes?.length
    ? programmes
    : rawRow.programme
    ? rawRow.programme.split(',').map(s => s.trim())
    : ['Computer Science'];

  const row = {
    ...rawRow,
    programme: progs.join(', ')
  };

  const { data, error } = await admin.from('courses').insert(row).select().single();
  if (error) return fail(res, error.code === '23505' ? 'That module code already exists' : error, error.code === '23505' ? 409 : 400);

  // 1. Maintain module_programmes join table if it exists
  try {
    const progRows = progs.map(programme => ({ course_id: data.id, programme }));
    await admin.from('module_programmes').insert(progRows);
  } catch (_) {}

  // 2. Allocate lecturers
  if (lecturer_ids?.length) {
    const allocations = lecturer_ids.map(lecturer_id => ({
      lecturer_id,
      course_id: data.id,
      academic_year_id: data.academic_year_id || null,
      semester_id: data.semester_id || null
    }));
    try {
      await admin.from('lecturer_courses').insert(allocations);
    } catch (_) {}
  }

  // 3. Send OneSignal push & in-app notification to matching students
  try {
    const { data: matchingStudents } = await admin.from('profiles')
      .select('id')
      .eq('role', 'student')
      .eq('level', data.level)
      .in('programme', progs)
      .eq('account_status', 'approved');

    if (matchingStudents?.length) {
      const studentIds = matchingStudents.map(s => s.id);
      await notify(studentIds, 'New Module Added', `New module added: ${data.code} ${data.title}`);
    }
  } catch (err) {
    console.error('Notification error for new module:', err.message);
  }

  await audit(req.profile.id, 'course', data.id, 'created', null, data);
  res.status(201).json({ ...data, programmes: progs });
});

router.patch('/hod/courses/:id', async (req, res) => {
  const p = courseBody.partial().safeParse(req.body);
  if (!p.success) return bad(res, p);
  const { lecturer_ids, programmes, ...rawRow } = p.data;

  let row = { ...rawRow };
  let progs = programmes;
  if (programmes?.length) {
    row.programme = programmes.join(', ');
  } else if (rawRow.programme) {
    progs = rawRow.programme.split(',').map(s => s.trim());
  }

  let data = null;
  if (Object.keys(row).length > 0) {
    const r = await admin.from('courses').update(row).eq('id', req.params.id).select().single();
    if (r.error) return fail(res, 'Module not found or update error', 400);
    data = r.data;
  }

  // Update module_programmes join table if programmes updated
  if (progs !== undefined && progs.length > 0) {
    try {
      await admin.from('module_programmes').delete().eq('course_id', req.params.id);
      const progRows = progs.map(programme => ({ course_id: req.params.id, programme }));
      await admin.from('module_programmes').insert(progRows);
    } catch (_) {}
  }

  if (lecturer_ids !== undefined) {
    try {
      await admin.from('lecturer_courses').delete().eq('course_id', req.params.id);
      if (lecturer_ids.length > 0) {
        const allocations = lecturer_ids.map(lecturer_id => ({
          lecturer_id,
          course_id: req.params.id,
          academic_year_id: data?.academic_year_id || null,
          semester_id: data?.semester_id || null
        }));
        await admin.from('lecturer_courses').insert(allocations);
      }
    } catch (_) {}
  }

  await audit(req.profile.id, 'course', req.params.id, 'updated', null, p.data);
  res.json(data ? { ...data, programmes: progs } : { ok: true });
});

// Update student level / programme (promotions / track changes)
router.patch('/hod/students/:id', async (req, res) => {
  const updateSchema = z.object({
    level: z.coerce.number().int().min(1).max(4).optional(),
    programme: z.enum(['Computer Science', 'BIT', 'Business Information Systems', 'Software Engineering', 'Telecommunication']).optional(),
    full_name: z.string().trim().min(2).max(100).optional(),
    student_id: z.string().trim().max(30).optional(),
    is_active: z.boolean().optional()
  });
  const p = updateSchema.safeParse(req.body);
  if (!p.success) return bad(res, p);

  const { data, error } = await admin.from('profiles')
    .update(p.data)
    .eq('id', req.params.id)
    .eq('role', 'student')
    .select('id,student_id,full_name,programme,level,account_status,is_active')
    .single();

  if (error) return fail(res, error);
  await audit(req.profile.id, 'profile', req.params.id, 'student_updated_by_hod', null, p.data);
  res.json(data);
});

router.delete('/hod/courses/:id', async (req, res) => {
  const courseId = req.params.id;
  try {
    await admin.from('module_programmes').delete().eq('course_id', courseId);
    await admin.from('lecturer_courses').delete().eq('course_id', courseId);
    await admin.from('course_registrations').delete().eq('course_id', courseId);
    await admin.from('timetable_entries').delete().eq('course_id', courseId);
    await admin.from('class_reps').delete().eq('course_id', courseId);
    await admin.from('announcements').update({ target_course_id: null }).eq('target_course_id', courseId);

    const { error } = await admin.from('courses').delete().eq('id', courseId);
    if (error) return fail(res, error);
    await audit(req.profile.id, 'course', courseId, 'deleted');
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/hod/courses/clear-all', async (req, res) => {
  try {
    await admin.from('module_programmes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('lecturer_courses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('course_registrations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('timetable_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('class_reps').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await admin.from('announcements').update({ target_course_id: null }).neq('id', '00000000-0000-0000-0000-000000000000');

    const { error } = await admin.from('courses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return fail(res, error);
    await audit(req.profile.id, 'courses', null, 'cleared_all');
    res.json({ ok: true, message: 'All department modules cleared successfully.' });
  } catch (err) {
    fail(res, err);
  }
});

const venueBody = z.object({ name: z.string().trim().min(2).max(100), latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), radius_m: z.coerce.number().int().min(10).max(2000) });
router.post('/hod/venues', async (req, res) => {
  const p = venueBody.safeParse(req.body);
  if (!p.success) return bad(res, p);
  const { data, error } = await admin.from('venues').insert(p.data).select().single();
  if (error) return fail(res, error);
  await audit(req.profile.id, 'venue', data.id, 'created', null, data);
  res.status(201).json(data);
});
router.patch('/hod/venues/:id', async (req, res) => {
  const p = venueBody.partial().extend({ is_active: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) return bad(res, p);
  const { data, error } = await admin.from('venues').update(p.data).eq('id', req.params.id).select().single();
  if (error) return fail(res, 'Venue not found', 404);
  await audit(req.profile.id, 'venue', data.id, 'updated', null, p.data);
  res.json(data);
});

// Course registration: allocate every approved student of a level to that level's active courses
router.post('/hod/registrations/allocate-level', async (req, res) => {
  const p = z.object({ level: z.coerce.number().int().min(1).max(4), academic_year_id: uuid, semester_id: uuid }).safeParse(req.body);
  if (!p.success) return bad(res, p);
  const b = p.data;
  const [{ data: students }, { data: courses }] = await Promise.all([
    admin.from('profiles').select('id').eq('role', 'student').eq('level', b.level).eq('account_status', 'approved').eq('is_active', true),
    admin.from('courses').select('id,semester_id').eq('level', b.level).eq('is_active', true)
  ]);
  const cs = (courses || []).filter(c => !c.semester_id || c.semester_id === b.semester_id);
  const rows = (students || []).flatMap(s => cs.map(c => ({ student_id: s.id, course_id: c.id, academic_year_id: b.academic_year_id, semester_id: b.semester_id })));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from('course_registrations').upsert(rows.slice(i, i + 1000), {
      onConflict: 'student_id,course_id,academic_year_id,semester_id', ignoreDuplicates: true });
    if (error) return fail(res, error);
  }
  await audit(req.profile.id, 'course_registration', `level-${b.level}`, 'allocated_level', null, { students: students?.length, courses: cs.length });
  res.json({ students: students?.length || 0, courses: cs.length, registrations: rows.length });
});

// =================================================================== ATTENDANCE (department-wide, filterable)
router.get('/hod/attendance', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1), size = Math.min(100, Number(req.query.limit) || 50);
  let q = admin.from('attendance_records').select(
    'id,status,submitted_at,submitted_offline,distance_m,review_note,profiles!student_id(id,student_id,full_name,level),class_sessions!inner(id,session_date,timetable_entries!inner(level,course_id,courses(code,title)))',
    { count: 'exact' }).order('submitted_at', { ascending: false }).range((page - 1) * size, page * size - 1);
  const { level, course_id, status, from, to, student } = req.query;
  if (level) q = q.eq('class_sessions.timetable_entries.level', Number(level));
  if (course_id && uuid.safeParse(course_id).success) q = q.eq('class_sessions.timetable_entries.course_id', course_id);
  if (['pending', 'approved', 'rejected', 'absent', 'correction_requested'].includes(status)) q = q.eq('status', status);
  if (from) q = q.gte('class_sessions.session_date', from);
  if (to) q = q.lte('class_sessions.session_date', to);
  if (student) {
    const s = String(student).trim();
    let ids;
    if (uuid.safeParse(s).success) ids = [s];
    else {
      const { data } = await admin.from('profiles').select('id').eq('role', 'student')
        .or(`student_id.eq.${s.toUpperCase().replace(/[^A-Z0-9/._-]/g, '')},full_name.ilike.%${s.replace(/[^\p{L}\p{N} .'-]/gu, '')}%`).limit(200);
      ids = (data || []).map(x => x.id);
    }
    q = q.in('student_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  }
  const { data, error, count } = await q;
  if (error) return fail(res, error);
  res.json({ rows: data, total: count || 0, page, size });
});

router.get('/hod/audit', async (req, res) => {
  let q = admin.from('audit_logs').select('id,actor_id,entity_type,entity_id,action,created_at,profiles!actor_id(full_name,username)')
    .order('created_at', { ascending: false }).limit(Math.min(200, Number(req.query.limit) || 100));
  if (req.query.entity_type) q = q.eq('entity_type', String(req.query.entity_type));
  if (req.query.entity_id) q = q.eq('entity_id', String(req.query.entity_id));
  const { data, error } = await q;
  if (error) return fail(res, error);
  res.json(data);
});

// =================================================================== DEPARTMENT SETTINGS
router.get('/hod/settings', async (req, res) => {
  const settings = await getDepartmentSettings();
  res.json(settings);
});

router.patch('/hod/settings', async (req, res) => {
  const p = z.object({
    min_attendance_threshold: z.coerce.number().int().min(10).max(100).optional(),
    require_qr_or_code: z.boolean().optional(),
    attendance_grace_minutes: z.coerce.number().int().min(0).max(120).optional(),
    university_name: z.string().trim().min(2).max(120).optional(),
    department_name: z.string().trim().min(2).max(120).optional(),
    lecturer_signature_label: z.string().trim().min(2).max(80).optional(),
    hod_signature_label: z.string().trim().min(2).max(80).optional(),
    logo_data: z.string().optional()
  }).safeParse(req.body);
  if (!p.success) return bad(res, p);

  const { data: existing } = await admin.from('department_settings').select('id').limit(1).maybeSingle();
  let result;
  const updatePayload = {
    updated_at: new Date().toISOString()
  };
  if (p.data.min_attendance_threshold !== undefined) updatePayload.min_attendance_threshold = p.data.min_attendance_threshold;
  if (p.data.require_qr_or_code !== undefined) updatePayload.require_qr_or_code = p.data.require_qr_or_code;
  if (p.data.attendance_grace_minutes !== undefined) updatePayload.attendance_grace_minutes = p.data.attendance_grace_minutes;
  if (p.data.university_name !== undefined) updatePayload.university_name = p.data.university_name;
  if (p.data.department_name !== undefined) updatePayload.department_name = p.data.department_name;
  if (p.data.lecturer_signature_label !== undefined) updatePayload.lecturer_signature_label = p.data.lecturer_signature_label;
  if (p.data.hod_signature_label !== undefined) updatePayload.hod_signature_label = p.data.hod_signature_label;
  if (p.data.logo_data !== undefined) updatePayload.logo_data = p.data.logo_data;

  try {
    if (existing?.id) {
      const { data, error } = await admin.from('department_settings')
        .update(updatePayload)
        .eq('id', existing.id).select().single();
      if (!error) result = data;
    } else {
      const { data, error } = await admin.from('department_settings')
        .insert({ min_attendance_threshold: p.data.min_attendance_threshold || 75, ...updatePayload })
        .select().single();
      if (!error) result = data;
    }
  } catch (_) {}

  // Fallback if custom columns don't exist in DB schema yet
  if (!result) {
    const basicPayload = {
      min_attendance_threshold: p.data.min_attendance_threshold || 75,
      updated_at: new Date().toISOString()
    };
    if (existing?.id) {
      const { data } = await admin.from('department_settings').update(basicPayload).eq('id', existing.id).select().single();
      result = data;
    } else {
      const { data } = await admin.from('department_settings').insert(basicPayload).select().single();
      result = data;
    }
  }

  clearSettingsCache();
  await audit(req.profile.id, 'department_settings', result?.id || 'dept_settings', 'updated', null, p.data);
  const finalSettings = await getDepartmentSettings();
  res.json(finalSettings);
});


// =================================================================== HOLIDAYS & NON-TEACHING DAYS
router.get('/hod/holidays', async (req, res) => {
  const { data, error } = await admin.from('holidays').select('*').order('holiday_date', { ascending: false });
  if (error) return fail(res, error);
  res.json(data);
});

router.post('/hod/holidays', async (req, res) => {
  const p = z.object({
    name: z.string().trim().min(2).max(120),
    holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    is_teaching_day: z.boolean().default(false)
  }).safeParse(req.body);
  if (!p.success) return bad(res, p);

  const { data, error } = await admin.from('holidays').insert(p.data).select().single();
  if (error) return fail(res, error);

  await audit(req.profile.id, 'holiday', data.id, 'created', null, data);
  res.status(201).json(data);
});

router.delete('/hod/holidays/:id', async (req, res) => {
  const { data: existing } = await admin.from('holidays').select('*').eq('id', req.params.id).maybeSingle();
  if (!existing) return fail(res, 'Holiday not found', 404);

  const { error } = await admin.from('holidays').delete().eq('id', req.params.id);
  if (error) return fail(res, error);

  await audit(req.profile.id, 'holiday', req.params.id, 'deleted', existing, null);
  res.json({ ok: true });
});

// =================================================================== STUDENTS AT RISK (Department-wide)
router.get('/hod/students-at-risk', async (req, res) => {
  const { data: setting } = await admin.from('department_settings').select('min_attendance_threshold').limit(1).maybeSingle();
  const threshold = setting?.min_attendance_threshold || 75;

  let query = admin.from('attendance_records')
    .select('id,status,student_id,profiles!student_id(id,student_id,full_name,level,programme,phone_number),class_sessions!inner(id,session_date,timetable_entries!inner(course_id,level,courses(code,title)))');

  if (req.query.level) query = query.eq('class_sessions.timetable_entries.level', Number(req.query.level));
  if (req.query.course_id && uuid.safeParse(req.query.course_id).success) query = query.eq('class_sessions.timetable_entries.course_id', req.query.course_id);

  const records = await fetchAll(() => query);

  const studentMap = new Map();
  for (const r of records) {
    const student = r.profiles;
    if (!student) continue;
    const course = r.class_sessions.timetable_entries?.courses;
    let entry = studentMap.get(student.id);
    if (!entry) {
      entry = {
        student_id: student.student_id,
        full_name: student.full_name,
        level: student.level,
        programme: student.programme,
        phone_number: student.phone_number,
        profile_id: student.id,
        counts: { approved: 0, pending: 0, rejected: 0, absent: 0, correction_requested: 0, excused: 0 },
        courses: {}
      };
      studentMap.set(student.id, entry);
    }
    entry.counts[r.status] = (entry.counts[r.status] || 0) + 1;
    if (course?.code) {
      entry.courses[course.code] ??= { code: course.code, title: course.title, approved: 0, rejected: 0, absent: 0, correction_requested: 0, excused: 0 };
      entry.courses[course.code][r.status] = (entry.courses[course.code][r.status] || 0) + 1;
    }
  }

  const atRisk = [];
  for (const item of studentMap.values()) {
    const overallRate = rate(item.counts);
    const totalSessions = (item.counts.approved || 0) + (item.counts.rejected || 0) + (item.counts.absent || 0) + (item.counts.correction_requested || 0);
    if (totalSessions < 2) continue; // Minimum 2 held sessions

    let risk_status = 'good';
    if (overallRate < threshold) risk_status = 'critical';
    else if (overallRate <= threshold + 5) risk_status = 'warning';

    if (risk_status !== 'good') {
      atRisk.push({
        ...item,
        rate: overallRate,
        risk_status,
        threshold,
        total_sessions: totalSessions
      });
    }
  }

  res.json({
    threshold,
    total_at_risk: atRisk.length,
    students: atRisk.sort((a, b) => a.rate - b.rate)
  });
});

// Bulk OneSignal Warning Notification to At-Risk Students
router.post('/hod/notify-at-risk', async (req, res) => {
  const p = z.object({
    student_ids: z.array(z.string().uuid()).min(1),
    message: z.string().trim().max(500).optional()
  }).safeParse(req.body);
  if (!p.success) return bad(res, p);

  const { data: setting } = await admin.from('department_settings').select('min_attendance_threshold').limit(1).maybeSingle();
  const threshold = setting?.min_attendance_threshold || 75;

  const msg = p.data.message || `URGENT NOTICE: Your attendance is currently near or below the departmental minimum threshold of ${threshold}%. Please attend all scheduled classes immediately.`;

  await notify(p.data.student_ids, 'Attendance Warning - MMTU CS Dept', msg);
  await audit(req.profile.id, 'attendance_warning', 'batch', 'notified_at_risk', null, { count: p.data.student_ids.length });

  res.json({ ok: true, notified_count: p.data.student_ids.length });
});

// =================================================================== ACADEMIC YEAR ROLLOVER
router.get('/hod/rollover/preview', async (req, res) => {
  const [l1, l2, l3, l4, activeTimetables, activeModules, curYear, latestArchive] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('level', 1).eq('is_active', true).eq('account_status', 'approved'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('level', 2).eq('is_active', true).eq('account_status', 'approved'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('level', 3).eq('is_active', true).eq('account_status', 'approved'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('level', 4).eq('is_active', true).eq('account_status', 'approved'),
    admin.from('timetable_entries').select('id', { count: 'exact', head: true }),
    admin.from('courses').select('id', { count: 'exact', head: true }).eq('is_active', true),
    admin.from('academic_years').select('id,name,is_current').eq('is_current', true).maybeSingle(),
    admin.from('academic_year_archives').select('*').order('archived_at', { ascending: false }).limit(1).maybeSingle()
  ]);

  const canRollback = latestArchive.data ? new Date(latestArchive.data.can_rollback_until).getTime() > Date.now() : false;

  res.json({
    current_academic_year: curYear.data?.name || 'None Set',
    current_academic_year_id: curYear.data?.id || null,
    level1_to_level2: l1.count || 0,
    level2_to_level3: l2.count || 0,
    level3_to_level4: l3.count || 0,
    level4_graduating: l4.count || 0,
    total_students_promoted: (l1.count || 0) + (l2.count || 0) + (l3.count || 0),
    active_timetables_to_deactivate: activeTimetables.count || 0,
    active_modules_count: activeModules.count || 0,
    can_rollback: canRollback,
    latest_archive: latestArchive.data || null
  });
});

router.post('/hod/rollover/execute', async (req, res) => {
  const p = z.object({
    next_academic_year_name: z.string().trim().min(4).max(50)
  }).safeParse(req.body);
  if (!p.success) return bad(res, p);

  // 1. Get current active academic year
  const { data: curYear } = await admin.from('academic_years').select('id,name').eq('is_current', true).maybeSingle();
  if (!curYear) return fail(res, 'No currently active academic year found. Please set one first.');

  // 2. Fetch all active students to create snapshot for 24-hour rollback safety
  const { data: students, error: sErr } = await admin.from('profiles')
    .select('id,student_id,full_name,level,programme,account_status,is_active')
    .eq('role', 'student');
  if (sErr) return fail(res, sErr);

  const snapshot = students.map(s => ({
    id: s.id,
    student_id: s.student_id,
    level: s.level,
    account_status: s.account_status,
    is_active: s.is_active
  }));

  // 3. Perform promotions
  // Level 4 -> Graduated & inactive
  const y4Ids = students.filter(s => s.level === 4 && s.is_active).map(s => s.id);
  if (y4Ids.length) {
    await admin.from('profiles').update({ account_status: 'graduated', is_active: false }).in('id', y4Ids);
  }

  // Level 3 -> Level 4
  const y3Ids = students.filter(s => s.level === 3 && s.is_active && s.account_status === 'approved').map(s => s.id);
  if (y3Ids.length) {
    await admin.from('profiles').update({ level: 4 }).in('id', y3Ids);
  }

  // Level 2 -> Level 3
  const y2Ids = students.filter(s => s.level === 2 && s.is_active && s.account_status === 'approved').map(s => s.id);
  if (y2Ids.length) {
    await admin.from('profiles').update({ level: 3 }).in('id', y2Ids);
  }

  // Level 1 -> Level 2
  const y1Ids = students.filter(s => s.level === 1 && s.is_active && s.account_status === 'approved').map(s => s.id);
  if (y1Ids.length) {
    await admin.from('profiles').update({ level: 2 }).in('id', y1Ids);
  }

  // 4. Mark old academic year is_current = false
  await admin.from('academic_years').update({ is_current: false }).eq('id', curYear.id);

  // 5. Create or activate new academic year
  let newYearId;
  const { data: existingNew } = await admin.from('academic_years').select('id').eq('name', p.data.next_academic_year_name).maybeSingle();
  if (existingNew) {
    await admin.from('academic_years').update({ is_current: true }).eq('id', existingNew.id);
    newYearId = existingNew.id;
  } else {
    const { data: createdNew, error: cErr } = await admin.from('academic_years')
      .insert({ name: p.data.next_academic_year_name, is_current: true }).select('id').single();
    if (cErr) return fail(res, cErr);
    newYearId = createdNew.id;
  }

  // 6. Save archive record with 24-hour rollback window
  const rollbackUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const promotedCount = y1Ids.length + y2Ids.length + y3Ids.length;
  const { data: archive, error: aErr } = await admin.from('academic_year_archives').insert({
    academic_year_id: curYear.id,
    promoted_count: promotedCount,
    graduated_count: y4Ids.length,
    can_rollback_until: rollbackUntil,
    metadata: {
      previous_year_id: curYear.id,
      new_year_id: newYearId,
      student_snapshots: snapshot
    }
  }).select().single();
  if (aErr) console.error('Archive save error:', aErr.message);

  await audit(req.profile.id, 'academic_year', newYearId, 'rollover_executed', null, {
    previous_year: curYear.name,
    new_year: p.data.next_academic_year_name,
    promoted_count: promotedCount,
    graduated_count: y4Ids.length
  });

  res.json({
    ok: true,
    promoted: promotedCount,
    graduated: y4Ids.length,
    next_academic_year: p.data.next_academic_year_name,
    rollback_window_hours: 24,
    can_rollback_until: rollbackUntil
  });
});

router.post('/hod/rollover/rollback', async (req, res) => {
  const { data: archive, error: aErr } = await admin.from('academic_year_archives')
    .select('*')
    .order('archived_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aErr || !archive) return fail(res, 'No rollover archive record found to roll back.');
  if (new Date(archive.can_rollback_until).getTime() < Date.now()) {
    return fail(res, 'The 24-hour safety rollback window for this rollover has expired.');
  }

  const meta = archive.metadata;
  if (!meta?.student_snapshots?.length) {
    return fail(res, 'Archive metadata is missing student snapshot data.');
  }

  // Restore students
  for (const s of meta.student_snapshots) {
    await admin.from('profiles').update({
      level: s.level,
      account_status: s.account_status,
      is_active: s.is_active
    }).eq('id', s.id);
  }

  // Restore academic years
  if (meta.previous_year_id) {
    await admin.from('academic_years').update({ is_current: true }).eq('id', meta.previous_year_id);
  }
  if (meta.new_year_id) {
    await admin.from('academic_years').update({ is_current: false }).eq('id', meta.new_year_id);
  }

  // Delete or expire archive record so it cannot be double-rolled-back
  await admin.from('academic_year_archives').delete().eq('id', archive.id);

  await audit(req.profile.id, 'academic_year', meta.previous_year_id, 'rollover_rolled_back', null, {
    restored_students: meta.student_snapshots.length
  });

  res.json({ ok: true, message: 'Academic year rollover successfully rolled back. Student levels restored.' });
});

export default router;
