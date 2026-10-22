import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged, requireApproved } from '../middleware.js';
import { attendanceLimit, lockStatus, recordFailure, clearFailures } from '../limits.js';
import { audit, notify, getDepartmentSettings } from '../services.js';
import { distanceMeters, safeEqual, sessionWindow } from '../utils.js';

const router = Router();
router.use('/attendance', authenticate, requirePasswordChanged);

const reject = async (res, status, code, error, meta = null, studentId = null) => {
  if (studentId) {
    try {
      await audit(studentId, 'attendance', meta?.sessionId || 'submission_rejected', 'rejected', null, { code, error, ...meta });
    } catch (_) {}
  }
  return res.status(status).json({ error, code });
};

function verifyQrToken(token, secret) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'Malformed QR code token.' };
  const parts = token.trim().split('.');
  if (parts.length !== 3) return { valid: false, error: 'Invalid QR token format.' };
  const [sessionId, slotStr, signature] = parts;
  const slot = parseInt(slotStr, 10);
  if (isNaN(slot)) return { valid: false, error: 'Invalid QR token time slot.' };

  const expectedSig = crypto.createHmac('sha256', secret).update(`${sessionId}.${slotStr}`).digest('hex');
  const bufReceived = Buffer.from(signature, 'hex');
  const bufExpected = Buffer.from(expectedSig, 'hex');
  if (bufReceived.length !== bufExpected.length || !crypto.timingSafeEqual(bufReceived, bufExpected)) {
    return { valid: false, error: 'Invalid or tampered QR code signature.' };
  }
  return { valid: true, sessionId, slot };
}

const submitSchema = z.object({
  session_id: z.string().uuid().optional(),
  timetable_entry_id: z.string().uuid().optional(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  method: z.enum(['qr', 'code', 'manual']).default('manual'),
  token: z.string().trim().optional(),
  class_code: z.string().trim().min(4).max(10).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  gps_accuracy_m: z.number().positive(),
  client_timestamp: z.string().datetime().optional(),
  submitted_offline: z.boolean().default(false)
}).refine(b => b.session_id || (b.timetable_entry_id && b.session_date) || (b.method === 'qr' && b.token), {
  message: 'Select a class or provide attendance QR/code'
});

/**
 * POST /api/attendance : a student marks Present via direct tap, QR scan, or class code.
 * Works for live and for queued (offline) submissions; the server re-validates everything.
 */
router.post('/attendance', attendanceLimit, allow('student'), requireApproved, async (req, res) => {
  const v = submitSchema.safeParse(req.body);
  if (!v.success) return reject(res, 400, 'INVALID', v.error.issues[0]?.message || 'Invalid attendance request');
  const b = v.data, student = req.profile, now = Date.now();

  // Check department requirement for QR/code
  const settings = await getDepartmentSettings();
  const requireQrOrCode = Boolean(settings.require_qr_or_code);
  if (requireQrOrCode) {
    if (b.method === 'manual' || (!b.token && !b.class_code)) {
      return reject(res, 400, 'CODE_REQUIRED', 'Department policy requires scanning the QR code or entering the class code to mark attendance.', null, student.id);
    }
  }

  let targetSessionId = b.session_id;
  let qrSlot = null;


  // ---- 1. QR token validation (if submitted via QR)
  if (b.method === 'qr') {
    const qrResult = verifyQrToken(b.token, process.env.QR_SECRET);
    if (!qrResult.valid) {
      return reject(res, 400, 'INVALID_QR', qrResult.error, { method: 'qr' }, student.id);
    }
    targetSessionId = qrResult.sessionId;
    qrSlot = qrResult.slot;
    const currentSlot = Math.floor(now / 30000);

    if (b.submitted_offline) {
      // Reject queued offline submissions older than 48 hours
      const tokenAgeMs = now - (qrSlot * 30000);
      if (tokenAgeMs > 48 * 3600 * 1000) {
        return reject(res, 400, 'STALE', 'This offline submission is older than 48 hours and was rejected.', { method: 'qr', qrSlot }, student.id);
      }
    } else {
      // Live QR: allow a grace period of 2 slots behind and 1 slot ahead for network delay and minor clock skew
      if (qrSlot < currentSlot - 2 || qrSlot > currentSlot + 1) {
        return reject(res, 400, 'QR_EXPIRED', 'This QR code has expired. Ask your lecturer to show the new QR.', { method: 'qr', qrSlot, currentSlot }, student.id);
      }
    }
  }

  // ---- 2. Time determination (validate token time slot, never the phone's clock)
  let when = now;
  if (b.method === 'qr') {
    when = qrSlot * 30000;
  } else if (b.submitted_offline) {
    when = b.client_timestamp ? Date.parse(b.client_timestamp) : NaN;
    if (!Number.isFinite(when) || when > now + 5 * 60000) return reject(res, 400, 'INVALID_TIME', 'Invalid attendance timestamp', null, student.id);
    if (now - when > 48 * 3600 * 1000) return reject(res, 400, 'STALE', 'This offline submission is older than 48 hours and was rejected.', null, student.id);
  }

  // ---- 3. GPS accuracy quality
  const maxAccuracy = Number(process.env.GPS_MAX_ACCURACY_METERS || 60);
  if (b.gps_accuracy_m > maxAccuracy) {
    return reject(res, 422, 'WEAK_GPS', `Weak GPS accuracy (${Math.round(b.gps_accuracy_m)} m). Move to an open area and try again.`, { accuracy: b.gps_accuracy_m }, student.id);
  }

  // ---- 4. Session lookup
  let sq = admin.from('class_sessions').select('*,timetable_entries(*,venues(*),courses(code,title,level,programme))');
  sq = targetSessionId ? sq.eq('id', targetSessionId) : sq.eq('timetable_entry_id', b.timetable_entry_id).eq('session_date', b.session_date);
  const { data: s } = await sq.maybeSingle();
  if (!s) return reject(res, 404, 'NO_SESSION', 'The lecturer has not opened this class session yet.', { sessionId: targetSessionId }, student.id);
  const t = s.timetable_entries;

  // ---- 5. Programme and Level module eligibility
  const studentProg = (student.programme || '').toLowerCase().trim();
  const classProg = (t.programme || '').toLowerCase().trim();
  const progMatches = !classProg || classProg === 'all' || classProg.includes(studentProg) || studentProg.includes(classProg) ||
    (studentProg === 'degree' && (classProg.includes('computer science') || classProg.includes('degree') || classProg.includes('software') || classProg.includes('bit')));

  if (t.level !== student.level || !progMatches) {
    return reject(res, 403, 'WRONG_MODULE', 'This QR is not for one of your modules.', { sessionId: s.id, course: t.courses?.code }, student.id);
  }

  // Check course registration
  let reg = admin.from('course_registrations').select('id').eq('student_id', student.id).eq('course_id', t.course_id);
  if (t.academic_year_id) reg = reg.eq('academic_year_id', t.academic_year_id);
  if (t.semester_id) reg = reg.eq('semester_id', t.semester_id);
  const { data: regRows } = await reg.limit(1);
  if (!regRows?.length) {
    // If not explicitly registered, allow if module matches their level & programme
    if (t.level !== student.level) {
      return reject(res, 403, 'NOT_REGISTERED', 'You are not registered for this course.', { sessionId: s.id }, student.id);
    }
  }

  // ---- 6. One submission per student per session
  const { data: existing } = await admin.from('attendance_records').select('id,status').eq('session_id', s.id).eq('student_id', student.id).maybeSingle();
  const correction = existing?.status === 'correction_requested';
  if (existing && !correction && !(existing.status === 'absent' && b.submitted_offline)) {
    return reject(res, 409, 'ALREADY', 'You have already submitted attendance for this session.', { sessionId: s.id }, student.id);
  }

  // ---- 7. Session state and open window
  if (!correction) {
    const w = sessionWindow(s.session_date, t.starts_at, t.ends_at);
    if (when < w.start || when > w.end) {
      return reject(res, 400, 'OUT_OF_WINDOW', 'Attendance can only be marked during the scheduled class time.', { sessionId: s.id }, student.id);
    }
    if (b.submitted_offline) {
      const opened = s.opened_at ? Date.parse(s.opened_at) : NaN;
      const closed = s.closes_at ? Date.parse(s.closes_at) : NaN;
      if (!Number.isFinite(opened) || when < opened - 60000 || (Number.isFinite(closed) && when > closed + 60000)) {
        return reject(res, 400, 'NOT_OPEN', 'The lecturer had not opened this session at the time of attendance.', { sessionId: s.id }, student.id);
      }
    } else if (!s.is_open || s.status !== 'open' || (s.closes_at && now > Date.parse(s.closes_at))) {
      return reject(res, 400, 'NOT_OPEN', 'The lecturer has not opened this session, or it has closed.', { sessionId: s.id }, student.id);
    }
  }

  // ---- 8. GPS Geofence Verification
  const venue = t.venues;
  if (!venue) return reject(res, 400, 'NO_VENUE', 'This class has no venue configured.', { sessionId: s.id }, student.id);
  const distance = distanceMeters(venue.latitude, venue.longitude, b.latitude, b.longitude);
  if (distance > venue.radius_m) {
    return reject(res, 403, 'OUTSIDE_AREA', `You are outside the class area (${Math.round(distance)} m away, limit ${venue.radius_m} m).`, { distance, radius: venue.radius_m }, student.id);
  }

  // ---- 9. Class code check (if method is 'code')
  if (b.method === 'code') {
    const codeKey = `code:${s.id}:${student.id}`;
    const lock = await lockStatus([codeKey]);
    if (lock.locked) return reject(res, 429, 'LOCKED', `Too many wrong codes. Try again in ${lock.minutes} minute(s).`, { sessionId: s.id }, student.id);
    if (!s.class_code || !safeEqual(b.class_code, s.class_code)) {
      await recordFailure([{ key: codeKey, max: 5 }], 10);
      return reject(res, 400, 'WRONG_CODE', 'Incorrect class code.', { sessionId: s.id }, student.id);
    }
    await clearFailures([codeKey]);
  }

  // ---- 10. Save attendance record
  const row = {
    status: 'pending',
    submitted_at: new Date().toISOString(),
    client_timestamp: new Date(when).toISOString(),
    submitted_offline: b.submitted_offline,
    synced_at: b.submitted_offline ? new Date().toISOString() : null,
    latitude: b.latitude,
    longitude: b.longitude,
    gps_accuracy_m: b.gps_accuracy_m,
    distance_m: Math.round(distance * 10) / 10,
    class_code_valid: b.method === 'code' || b.method === 'manual',
    reviewed_by: null,
    reviewed_at: null,
    review_note: null
  };

  let rec, error;
  // Attempt with method and qr_time_slot
  try {
    const fullRow = { ...row, method: b.method, qr_time_slot: qrSlot };
    const resIns = existing
      ? await admin.from('attendance_records').update(fullRow).eq('id', existing.id).select('id,status').single()
      : await admin.from('attendance_records').insert({ ...fullRow, session_id: s.id, student_id: student.id }).select('id,status').single();
    rec = resIns.data;
    error = resIns.error;
  } catch (err) {
    error = err;
  }

  // Graceful fallback if method or qr_time_slot column does not exist in schema cache
  if (error && (error.code === 'PGRST204' || String(error.message || '').includes('column'))) {
    const resFallback = existing
      ? await admin.from('attendance_records').update(row).eq('id', existing.id).select('id,status').single()
      : await admin.from('attendance_records').insert({ ...row, session_id: s.id, student_id: student.id }).select('id,status').single();
    rec = resFallback.data;
    error = resFallback.error;
  }

  if (error) {
    return error.code === '23505'
      ? reject(res, 409, 'ALREADY', 'You have already submitted attendance for this session.', { sessionId: s.id }, student.id)
      : reject(res, 400, 'FAILED', 'Could not save the attendance record.', { sessionId: s.id }, student.id);
  }

  await audit(student.id, 'attendance', rec.id, correction ? 'resubmitted' : existing ? 'submitted_after_sync' : 'submitted',
    existing ? { status: existing.status } : null,
    { ...row, session_id: s.id, method: b.method, qr_time_slot: qrSlot });

  await notify(s.lecturer_id, 'Attendance awaiting review', `${student.full_name} marked present (${b.method.toUpperCase()}) for ${t.courses?.code || 'your class'}.`);

  res.status(201).json({ ...rec, method: b.method });
});


// ------------------------------------------------------------------ lecturer review
const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected', 'correction_requested']),
  note: z.string().trim().max(300).optional()
}).refine(b => b.status === 'approved' || (b.note && b.note.length >= 3), { message: 'A note is required when rejecting or requesting a correction', path: ['note'] });

async function reviewRecord(req, id, status, note) {
  const { data: old } = await admin.from('attendance_records').select('*,class_sessions!inner(lecturer_id,timetable_entries(courses(code)))').eq('id', id).maybeSingle();
  if (!old) return { status: 404, error: 'Attendance record not found' };
  if (old.class_sessions.lecturer_id !== req.profile.id) return { status: 403, error: 'This is not your session' };
  const { class_sessions: ctx, ...before } = old;
  const { data, error } = await admin.from('attendance_records').update({
    status, reviewed_by: req.profile.id, reviewed_at: new Date().toISOString(), review_note: note || null
  }).eq('id', id).select('id,status,review_note').single();
  if (error) return { status: 400, error: error.message };
  await audit(req.profile.id, 'attendance', id, status, { status: before.status, review_note: before.review_note }, { status, review_note: note || null });
  const code = ctx.timetable_entries?.courses?.code || 'class';
  await notify(old.student_id,
    status === 'approved' ? 'Attendance approved' : status === 'rejected' ? 'Attendance rejected' : 'Correction requested',
    status === 'approved' ? `Your attendance for ${code} was approved.`
      : status === 'rejected' ? `Your attendance for ${code} was rejected: ${note}`
      : `Your lecturer asked you to correct your attendance for ${code}: ${note}`);
  return { data };
}

router.patch('/attendance/:id/review', allow('lecturer'), async (req, res) => {
  const v = reviewSchema.safeParse(req.body);
  if (!v.success) return reject(res, 400, 'INVALID', v.error.issues[0]?.message || 'Invalid review');
  const r = await reviewRecord(req, req.params.id, v.data.status, v.data.note);
  if (r.error) return reject(res, r.status, 'FAILED', r.error);
  res.json(r.data);
});

router.post('/attendance/review-bulk', allow('lecturer'), async (req, res) => {
  const v = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), status: z.literal('approved') }).safeParse(req.body);
  if (!v.success) return reject(res, 400, 'INVALID', 'Select up to 200 records to approve');
  let done = 0; const failed = [];
  for (const id of v.data.ids) {
    const r = await reviewRecord(req, id, 'approved');
    r.error ? failed.push(id) : done++;
  }
  res.json({ approved: done, failed });
});

// ------------------------------------------------------------------ audit trail for a record
router.get('/attendance/:id/audit', async (req, res) => {
  const { data: rec } = await admin.from('attendance_records').select('id,student_id,class_sessions(lecturer_id)').eq('id', req.params.id).maybeSingle();
  if (!rec) return reject(res, 404, 'FAILED', 'Record not found');
  const p = req.profile;
  const ok = p.role === 'hod' || (p.role === 'lecturer' && rec.class_sessions?.lecturer_id === p.id);
  if (!ok) return reject(res, 403, 'FORBIDDEN', 'Not allowed');
  const { data } = await admin.from('audit_logs').select('id,action,created_at,old_data,new_data,profiles!actor_id(full_name,username,role)')
    .eq('entity_type', 'attendance').eq('entity_id', rec.id).order('created_at');
  res.json(data || []);
});

export default router;
