import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { resendLimit } from '../limits.js';
import { randomPassword, normaliseName } from '../utils.js';
import { audit, getRepAllocation, decideStudent } from '../services.js';

/**
 * Student registration review + student password reset.
 * Available to the HOD (all students) and class representatives (their own class only).
 */
const router = Router();
router.use('/students', authenticate, requirePasswordChanged, allow('hod', 'class_rep', 'rep'));

const fail = (res, e, status = 400) => res.status(status).json({ error: typeof e === 'string' ? e : e.message });

/** Loads a student and makes sure the caller is allowed to manage them. */
async function manageable(req, id) {
  const { data: s } = await admin.from('profiles').select('*').eq('id', id).eq('role', 'student').maybeSingle();
  if (!s) return { error: 'Student not found', status: 404 };
  const role = (req.profile?.role || '').toLowerCase();
  if (role === 'class_rep' || role === 'rep') {
    const a = await getRepAllocation(req.profile.id);
    if (a.level && Number(s.level) !== Number(a.level))
      return { error: 'This student is not in your class', status: 403 };
    if (a.programme && s.programme && a.programme.toLowerCase() !== s.programme.toLowerCase())
      return { error: 'This student is not in your class', status: 403 };
  }
  return { student: s };
}

router.get('/students/pending', async (req, res) => {
  try {
    let q = admin.from('profiles').select('id,student_id,full_name,phone_number,programme,level,created_at')
      .eq('role', 'student').eq('account_status', 'pending').order('created_at');
    const role = (req.profile?.role || '').toLowerCase();
    if (role === 'class_rep' || role === 'rep') {
      const a = await getRepAllocation(req.profile.id);
      if (a.level) q = q.eq('level', a.level);
      if (a.programme) q = q.ilike('programme', a.programme);
    }
    const { data, error } = await q;
    if (error) return fail(res, error);
    res.json(data);
  } catch (e) { fail(res, e, e.status || 400); }
});

router.patch('/students/:id/decision', async (req, res) => {
  try {
    const p = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(req.body);
    if (!p.success) return fail(res, 'Decision must be approved or rejected');
    const m = await manageable(req, req.params.id);
    if (m.error) return fail(res, m.error, m.status);
    res.json(await decideStudent(m.student, p.data.decision, req.profile));
  } catch (e) { fail(res, e, e.status || 400); }
});

// "Forgot password" for students is handled here by the HOD or the class rep.
router.post('/students/:id/reset-password', resendLimit, async (req, res) => {
  try {
    const m = await manageable(req, req.params.id);
    if (m.error) return fail(res, m.error, m.status);
    const s = m.student;
    const password = randomPassword();
    const { error } = await admin.auth.admin.updateUserById(s.auth_user_id, { password });
    if (error) return fail(res, 'Could not reset the password');
    await admin.from('profiles').update({
      must_change_password: true,
      temp_password_expires_at: new Date(Date.now() + Number(process.env.TEMP_PASSWORD_HOURS || 48) * 3600 * 1000).toISOString()
    }).eq('id', s.id);
    await admin.from('login_attempts').delete().in('key', [`acct:${normaliseName(s.student_id || s.full_name)}`]);
    await audit(req.profile.id, 'profile', s.id, 'student_password_reset');
    // Shown once to the HOD / rep, who hands it to the student. It is not stored anywhere.
    res.json({ full_name: s.full_name, student_id: s.student_id, password });
  } catch (e) { fail(res, e, e.status || 400); }
});

export default router;
