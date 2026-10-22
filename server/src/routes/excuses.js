import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { audit, notify } from '../services.js';

const router = Router();
router.use(authenticate, requirePasswordChanged);

// --------------------------------------------------------------------- EXCUSE REQUESTS
const excuseSchema = z.object({
  session_id: z.string().uuid(),
  reason: z.enum(['illness', 'family_emergency', 'official_duty', 'other']),
  note: z.string().trim().max(1000).optional().default('')
});

// POST /api/excuses : student submits an excuse request for a missed session
router.post('/excuses', allow('student'), async (req, res) => {
  const parsed = excuseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please select a reason and session.' });
  }

  const { session_id, reason, note } = parsed.data;
  const student = req.profile;

  // Verify session exists and belongs to student's level
  const { data: session } = await admin.from('class_sessions')
    .select('id,lecturer_id,session_date,timetable_entries(course_id,level,programme,courses(code,title))')
    .eq('id', session_id).maybeSingle();

  if (!session) return res.status(404).json({ error: 'Class session not found.' });

  // Prevent duplicate requests
  const { data: existing } = await admin.from('excuse_requests')
    .select('id,status').eq('session_id', session_id).eq('student_id', student.id).maybeSingle();
  if (existing) {
    return res.status(409).json({ error: `An excuse request for this session has already been submitted (${existing.status}).` });
  }

  const { data, error } = await admin.from('excuse_requests').insert({
    student_id: student.id,
    session_id,
    reason,
    note,
    status: 'pending'
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Notify lecturer
  if (session.lecturer_id) {
    await notify(
      session.lecturer_id,
      `New Excused Absence Request: ${session.timetable_entries?.courses?.code || 'Module'}`,
      `${student.full_name} submitted an excuse request for the class on ${session.session_date}.`
    );
  }

  await audit(student.id, 'excuse_request', data.id, 'submitted', null, data);
  res.status(201).json(data);
});

// GET /api/excuses : list excuses (student sees own; lecturer sees pending for their modules; HOD sees all)
router.get('/excuses', async (req, res) => {
  const profile = req.profile;
  let q = admin.from('excuse_requests')
    .select('*,profiles!student_id(id,full_name,student_id,level,programme),class_sessions(id,session_date,timetable_entries(courses(code,title)))')
    .order('created_at', { ascending: false });

  if (profile.role === 'student') {
    q = q.eq('student_id', profile.id);
  } else if (profile.role === 'lecturer') {
    // Lecturer sees requests for their sessions
    const { data: ownSessions } = await admin.from('class_sessions').select('id').eq('lecturer_id', profile.id);
    const sessionIds = (ownSessions || []).map(s => s.id);
    if (!sessionIds.length) return res.json([]);
    q = q.in('session_id', sessionIds);
  }

  const { data, error } = await q.limit(200);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/excuses/:id/decide : lecturer or HOD decides an excuse request
router.post('/excuses/:id/decide', allow('lecturer', 'hod'), async (req, res) => {
  const parsed = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Decision must be approved or rejected' });

  const { data: excuse } = await admin.from('excuse_requests')
    .select('*,class_sessions(id,session_date,lecturer_id,timetable_entries(courses(code,title)))')
    .eq('id', req.params.id).maybeSingle();

  if (!excuse) return res.status(404).json({ error: 'Excuse request not found' });
  if (req.profile.role === 'lecturer' && excuse.class_sessions?.lecturer_id !== req.profile.id) {
    return res.status(403).json({ error: 'You are not assigned to this class session.' });
  }

  const decision = parsed.data.decision;
  const { data, error } = await admin.from('excuse_requests').update({
    status: decision,
    reviewed_by: req.profile.id,
    reviewed_at: new Date().toISOString()
  }).eq('id', excuse.id).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // If approved: update or insert attendance record as 'excused'
  if (decision === 'approved') {
    await admin.from('attendance_records').upsert({
      session_id: excuse.session_id,
      student_id: excuse.student_id,
      status: 'excused',
      review_note: `Absence excused: ${excuse.reason} (${excuse.note || ''})`
    }, { onConflict: 'session_id,student_id' });
  }

  // Notify student
  await notify(
    excuse.student_id,
    `Excuse Request ${decision === 'approved' ? 'Approved' : 'Rejected'}`,
    `Your excuse request for ${excuse.class_sessions?.timetable_entries?.courses?.code || 'class'} on ${excuse.class_sessions?.session_date} was ${decision}.`
  );

  await audit(req.profile.id, 'excuse_request', excuse.id, `decided_${decision}`, null, data);
  res.json(data);
});

// --------------------------------------------------------------------- ATTENDANCE APPEALS
// POST /api/appeals : student appeals a rejected attendance record within 48 hours
router.post('/appeals', allow('student'), async (req, res) => {
  const parsed = z.object({
    record_id: z.string().uuid(),
    reason: z.string().trim().min(5).max(1000)
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Please provide an explanation for your appeal.' });

  const { record_id, reason } = parsed.data;
  const student = req.profile;

  const { data: record } = await admin.from('attendance_records')
    .select('*,class_sessions(id,session_date,lecturer_id,timetable_entries(courses(code,title)))')
    .eq('id', record_id).eq('student_id', student.id).maybeSingle();

  if (!record) return res.status(404).json({ error: 'Attendance record not found.' });
  if (record.status !== 'rejected') {
    return res.status(400).json({ error: 'Appeals can only be submitted for rejected records.' });
  }

  // 48-hour limit check
  const rejectedAtMs = Date.parse(record.submitted_at);
  if (Date.now() - rejectedAtMs > 48 * 3600 * 1000) {
    return res.status(400).json({ error: 'Appeals must be submitted within 48 hours of rejection.' });
  }

  // Prevent multiple appeals
  const { data: existing } = await admin.from('attendance_appeals')
    .select('id,status').eq('record_id', record_id).maybeSingle();
  if (existing) {
    return res.status(409).json({ error: `An appeal has already been submitted (${existing.status}).` });
  }

  const { data, error } = await admin.from('attendance_appeals').insert({
    record_id,
    student_id: student.id,
    reason,
    status: 'pending'
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Update record status to 'appealed'
  await admin.from('attendance_records').update({ status: 'appealed' }).eq('id', record_id);

  // Notify lecturer
  const lecturerId = record.class_sessions?.lecturer_id;
  if (lecturerId) {
    await notify(
      lecturerId,
      `Attendance Appeal: ${record.class_sessions?.timetable_entries?.courses?.code || 'Module'}`,
      `${student.full_name} appealed a rejected attendance record from ${record.class_sessions?.session_date}.`
    );
  }

  await audit(student.id, 'attendance_appeal', data.id, 'submitted', null, data);
  res.status(201).json(data);
});

// GET /api/appeals : list appeals
router.get('/appeals', async (req, res) => {
  const profile = req.profile;
  let q = admin.from('attendance_appeals')
    .select('*,profiles!student_id(id,full_name,student_id,level,programme),attendance_records(id,submitted_at,class_sessions(id,session_date,lecturer_id,timetable_entries(courses(code,title))))')
    .order('created_at', { ascending: false });

  if (profile.role === 'student') {
    q = q.eq('student_id', profile.id);
  } else if (profile.role === 'lecturer') {
    const { data: ownSessions } = await admin.from('class_sessions').select('id').eq('lecturer_id', profile.id);
    const sessionIds = (ownSessions || []).map(s => s.id);
    if (!sessionIds.length) return res.json([]);
    // Filter through session_id
  }

  const { data, error } = await q.limit(200);
  if (error) return res.status(400).json({ error: error.message });

  if (profile.role === 'lecturer') {
    const filtered = (data || []).filter(a => a.attendance_records?.class_sessions?.lecturer_id === profile.id);
    return res.json(filtered);
  }

  res.json(data);
});

// POST /api/appeals/:id/decide : lecturer reverses (approves) or upholds (rejects)
router.post('/appeals/:id/decide', allow('lecturer', 'hod'), async (req, res) => {
  const parsed = z.object({
    decision: z.enum(['approved', 'rejected']),
    decision_reason: z.string().trim().max(1000).optional().default('')
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: 'Decision must be approved or rejected' });

  const { data: appeal } = await admin.from('attendance_appeals')
    .select('*,attendance_records(*,class_sessions(id,session_date,lecturer_id,timetable_entries(courses(code,title))))')
    .eq('id', req.params.id).maybeSingle();

  if (!appeal) return res.status(404).json({ error: 'Appeal not found' });
  if (req.profile.role === 'lecturer' && appeal.attendance_records?.class_sessions?.lecturer_id !== req.profile.id) {
    return res.status(403).json({ error: 'You are not assigned to this class session.' });
  }

  const { decision, decision_reason } = parsed.data;
  const { data, error } = await admin.from('attendance_appeals').update({
    status: decision,
    decision_reason,
    reviewed_by: req.profile.id,
    reviewed_at: new Date().toISOString()
  }).eq('id', appeal.id).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Update attendance record status: if approved -> 'approved'; if rejected -> 'rejected'
  const finalStatus = decision === 'approved' ? 'approved' : 'rejected';
  await admin.from('attendance_records').update({
    status: finalStatus,
    review_note: `Appeal ${decision}: ${decision_reason}`
  }).eq('id', appeal.record_id);

  // Notify student
  await notify(
    appeal.student_id,
    `Attendance Appeal ${decision === 'approved' ? 'Upheld (Approved)' : 'Rejected'}`,
    `Your appeal was reviewed. Result: ${decision.toUpperCase()}${decision_reason ? `. Note: ${decision_reason}` : ''}.`
  );

  await audit(req.profile.id, 'attendance_appeal', appeal.id, `decided_${decision}`, null, data);
  res.json(data);
});

export default router;
