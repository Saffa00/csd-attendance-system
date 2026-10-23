import { Router } from 'express';
import { z } from 'zod';
import { admin, publicAuth, verifyPassword } from '../supabase.js';
import { authenticate } from '../middleware.js';
import { loginLimit, registerLimit, passwordLimit, lockStatus, recordFailure, clearFailures } from '../limits.js';
import { normalisePhone, normaliseName, randomToken, safeEqual, generateRecoveryCode, hashRecoveryCode, cleanRecoveryCode } from '../utils.js';
import { audit, notify, publicProfile, registerCoursesFor, currentPeriod } from '../services.js';

const router = Router();

const STAFF_USERNAME = /^(LEC|REP|HOD)-\d+$/i;
const RESERVED_ID = /^(LEC|REP|HOD)-/i;

/** Does `password` already belong to another student with the same name and no student ID? */
async function passwordCollides(nameKey, password, excludeId = null) {
  let q = admin.from('profiles').select('id,email').eq('role', 'student').is('student_id', null).eq('name_key', nameKey);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q.limit(200);
  if (!data?.length) return false;
  const results = await Promise.all(data.map(p => verifyPassword(p.email, password)));
  return results.some(Boolean);
}

/** Resolve an identity to candidate profiles and verify the password. Returns { profile, session } or null. */
async function authenticateIdentity(identity, password) {
  const id = identity.trim();
  const candidates = [];
  const seenIds = new Set();
  const addCandidate = p => {
    if (p && p.email && !seenIds.has(p.id)) {
      seenIds.add(p.id);
      candidates.push(p);
    }
  };

  // 1. Direct Email login (staff or student)
  if (id.includes('@')) {
    const { data: byEmail } = await admin.from('profiles').select('*').ilike('email', id).maybeSingle();
    if (byEmail) addCandidate(byEmail);
  }

  // 2. Staff by Username: HOD-0001, LEC-0001, REP-0001 (handles HOD0001, hod-0001, lec-001, lec-2, rep-0002, etc.)
  const normalisedStaffId = id.toUpperCase().replace(/^([A-Z]+)\s*[-_]?\s*(\d+)$/, '$1-$2');
  const paddedStaffId = id.toUpperCase().replace(/^([A-Z]+)\s*[-_]?\s*(\d+)$/, (_, pfx, num) => `${pfx}-${num.padStart(4, '0')}`);
  const staffQueries = Array.from(new Set([id.toUpperCase(), normalisedStaffId, paddedStaffId]));
  for (const sq of staffQueries) {
    if (STAFF_USERNAME.test(sq)) {
      const { data: p } = await admin.from('profiles').select('*').eq('username', sq).maybeSingle();
      if (p) addCandidate(p);
    }
  }

  // 3. Phone Number login
  try {
    const phone = normalisePhone(id);
    const { data: byPhone } = await admin.from('profiles').select('*').eq('phone_number', phone);
    (byPhone || []).forEach(addCandidate);
  } catch {}

  // 4. Student or Class Rep by Student ID
  const { data: byIdList } = await admin.from('profiles').select('*').eq('student_id', id.toUpperCase());
  (byIdList || []).forEach(addCandidate);

  // 5. Staff, Class Reps, and Students by Full Name
  const targetKey = normaliseName(id);
  if (targetKey.length >= 2) {
    const { data: allProfiles } = await admin.from('profiles').select('*').limit(300);
    for (const p of allProfiles || []) {
      const pKey = normaliseName(p.full_name || '');
      if (pKey === targetKey || pKey.includes(targetKey) || targetKey.includes(pKey)) {
        addCandidate(p);
      }
    }
  }

  // Verify password against each matching candidate profile
  for (const candidate of candidates) {
    const session = await verifyPassword(candidate.email, password);
    if (session) return { profile: candidate, session };
  }

  return null;
}

// ------------------------------------------------------------------ LOGIN
router.post('/auth/login', loginLimit, async (req, res) => {
  const parsed = z.object({ identity: z.string().trim().min(2).max(120), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your login and password' });
  const { identity, password } = parsed.data;

  const device = String(req.get('x-device-id') || '').slice(0, 64);
  const guards = [
    { key: `ip:${req.ip}`, max: 40 },                        // generous: many students share campus Wi-Fi
    { key: `acct:${normaliseName(identity)}`, max: 5 },
    ...(device ? [{ key: `dev:${device}`, max: 8 }] : [])
  ];
  const lock = await lockStatus(guards.map(g => g.key));
  if (lock.locked) return res.status(429).json({ error: `Too many failed attempts. Try again in ${lock.minutes} minute(s).` });

  const result = await authenticateIdentity(identity, password);
  if (!result) {
    await recordFailure(guards);
    const msg = STAFF_USERNAME.test(identity.trim()) ? 'Invalid username or password.'
      : /\s/.test(identity.trim()) ? 'Invalid name or password.' : 'Invalid student ID or password.';
    return res.status(401).json({ error: msg });
  }
  const { profile, session } = result;
  await clearFailures(guards.filter(g => !g.key.startsWith('ip:')).map(g => g.key));

  // Only reveal account state after the password was proven correct.
  if (!profile.is_active) return res.status(403).json({ error: 'This account has been deactivated. Contact the HOD.' });
  if (profile.role === 'student' && profile.account_status === 'rejected')
    return res.status(403).json({ error: 'Your registration was not approved. Contact your class representative.' });
  if (profile.must_change_password && profile.temp_password_expires_at && Date.parse(profile.temp_password_expires_at) < Date.now())
    return res.status(403).json({ error: 'Your temporary password has expired. Ask for a new one.' });

  const meta = session?.user?.user_metadata || {};
  if (!profile.avatar_url && meta.avatar_url) {
    profile.avatar_url = meta.avatar_url;
  }
  if (!profile.semester && meta.semester) {
    profile.semester = meta.semester;
  }
  if (!profile.academic_year && meta.academic_year) {
    profile.academic_year = meta.academic_year;
  }

  await admin.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', profile.id);
  res.json({
    session: { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at },
    profile: publicProfile(profile)
  });
});

// ------------------------------------------------------------------ STUDENT REGISTRATION
const registerSchema = z.object({
  full_name: z.string().trim().min(3).max(100),
  student_id: z.string().trim().max(30).optional().default(''),
  phone_number: z.string().trim().min(8).max(20),
  programme: z.string().trim().min(2).max(100),
  level: z.coerce.number().int().min(1).max(4),
  semester: z.coerce.number().int().min(1).max(2).optional().default(1),
  password: z.string().min(8).max(200),
  avatar_image: z.string().optional()
});

router.post('/auth/register', registerLimit, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the form: ' + parsed.error.issues.map(i => i.path[0]).join(', ') });
  const b = parsed.data;

  // Enforce both letters and numbers in password
  if (!/[a-zA-Z]/.test(b.password) || !/\d/.test(b.password)) {
    return res.status(400).json({ error: 'Password must contain both letters and numbers.' });
  }

  // Restrict programme levels: Degree (1-4), Diploma (1-2), HND (1-3)
  const maxLevels = { Degree: 4, Diploma: 2, HND: 3, 'Computer Science': 4, BIT: 4, 'Software Engineering': 4 };
  const maxAllowed = maxLevels[b.programme] || 4;
  if (b.level < 1 || b.level > maxAllowed) {
    return res.status(400).json({ error: `${b.programme} is restricted to Year 1 to ${maxAllowed}.` });
  }

  let phone;
  try { phone = normalisePhone(b.phone_number); } catch (e) { return res.status(400).json({ error: e.message }); }

  const studentId = b.student_id ? b.student_id.toUpperCase() : null;
  if (studentId && (!/^[A-Z0-9][A-Z0-9/._-]{2,29}$/.test(studentId) || RESERVED_ID.test(studentId)))
    return res.status(400).json({ error: 'Enter a valid student ID' });

  // Duplicate checks (parameterised queries only)
  if (studentId) {
    const { data } = await admin.from('profiles').select('id').eq('student_id', studentId).limit(1);
    if (data?.length) return res.status(409).json({ error: 'This student ID is already registered' });
  }
  const { data: phoneUsed } = await admin.from('profiles').select('id').eq('phone_number', phone).limit(1);
  if (phoneUsed?.length) return res.status(409).json({ error: 'This phone number is already registered' });

  // No student ID => login is name + password, so the same name may not reuse a password.
  if (!studentId && await passwordCollides(normaliseName(b.full_name), b.password))
    return res.status(409).json({ error: 'Please choose a different password.' });

  // Auto-approval: student ID found on the HOD's uploaded list
  let listed = null;
  if (studentId) {
    const { data } = await admin.from('student_list').select('*').eq('student_id', studentId).eq('is_claimed', false).maybeSingle();
    listed = data;
  }

  const { year, semester } = await currentPeriod();
  const yearName = year?.name ? year.name.replace(/\s*academic\s*year/i, '').trim() : '2026/2027';
  const semNum = Number(b.semester) || 1;
  const semName = semNum === 2 ? 'Second Semester' : 'First Semester';

  const recoveryCode = generateRecoveryCode();
  const recoveryHash = hashRecoveryCode(recoveryCode);

  const email = `s-${randomToken(5)}@dept.app`;                // hidden internal auth email
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: b.password,
    email_confirm: true,
    user_metadata: {
      semester: semNum,
      semester_name: semName,
      level: b.level,
      programme: b.programme,
      academic_year_id: year?.id || null,
      academic_year: yearName,
      recovery_code_hash: recoveryHash
    }
  });
  if (authError) return res.status(400).json({ error: 'Could not create the account. Try again.' });

  const { data: profile, error } = await admin.from('profiles').insert({
    auth_user_id: authData.user.id,
    role: 'student',
    full_name: b.full_name,
    email,
    phone_number: phone,
    student_id: studentId,
    department: 'Computer Science',
    programme: listed?.programme || b.programme,
    level: listed?.level || b.level,
    academic_year_id: year?.id || null,
    account_status: 'approved',
    is_active: true,
    recovery_code_hash: recoveryHash,
    approved_at: new Date().toISOString()
  }).select('*').single();
  if (error) {
    await admin.auth.admin.deleteUser(authData.user.id);
    const dup = error.code === '23505';
    return res.status(dup ? 409 : 400).json({ error: dup ? 'This student ID or phone number is already registered' : 'Could not create the account' });
  }

  // Ensure recovery_code_hash is set if schema had older default
  if (!profile.recovery_code_hash) {
    try {
      await admin.from('profiles').update({ recovery_code_hash: recoveryHash }).eq('id', profile.id);
    } catch (e) {
      console.warn('Fallback recovery_code_hash update warning:', e.message);
    }
  }

  // Optional profile picture uploaded during registration
  if (b.avatar_image && typeof b.avatar_image === 'string') {
    try {
      const match = b.avatar_image.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i);
      const mimeType = match ? (match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()) : 'image/jpeg';
      const buffer = match ? Buffer.from(match[3], 'base64') : Buffer.from(b.avatar_image, 'base64');
      if (buffer.length <= 5 * 1024 * 1024) {
        const fileName = `${profile.id}.jpg`;
        await admin.storage.from('avatars').upload(fileName, buffer, { contentType: mimeType, upsert: true });
        const { data: pubData } = admin.storage.from('avatars').getPublicUrl(fileName);
        const avatarUrl = `${pubData.publicUrl}?t=${Date.now()}`;
        await admin.auth.admin.updateUserById(authData.user.id, { user_metadata: { avatar_url: avatarUrl } });
        try {
          await admin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', profile.id);
        } catch {}
      }
    } catch (e) {
      console.warn('Registration avatar upload warning:', e.message);
    }
  }

  try {
    if (listed) {
      await admin.from('student_list').update({ is_claimed: true, claimed_by: profile.id }).eq('id', listed.id);
      await registerCoursesFor(profile);
    } else {
      // Tell the class rep(s) of this level, and the HOD, that a registration needs review
      const { data: reps } = await admin.from('class_reps').select('rep_id').eq('level', profile.level).eq('programme', profile.programme);
      const { data: hods } = await admin.from('profiles').select('id').eq('role', 'hod').eq('is_active', true);
      await notify([...(reps || []).map(r => r.rep_id), ...(hods || []).map(h => h.id)],
        'New student registration', `${profile.full_name} (Level ${profile.level}) is waiting for approval.`);
    }
    await audit(profile.id, 'profile', profile.id, listed ? 'student_registered_auto_approved' : 'student_registered');
  } catch (postRegErr) {
    console.warn('Post-registration notification/audit warning:', postRegErr.message);
  }

  res.status(201).json({
    status: profile.account_status,
    message: 'Registration complete and approved. Save your recovery code below.',
    recovery_code: recoveryCode,
    student_name: profile.full_name,
    student_id: profile.student_id || profile.phone_number
  });
});

// ------------------------------------------------------------------ SESSION / PASSWORD
router.get('/auth/me', authenticate, async (req, res) => {
  const p = req.profile;
  if (p.auth_user_id) {
    try {
      const { data: userRes } = await admin.auth.admin.getUserById(p.auth_user_id);
      const meta = userRes?.user?.user_metadata || {};
      if (!p.avatar_url && meta.avatar_url) p.avatar_url = meta.avatar_url;
      if (!p.semester && meta.semester) p.semester = meta.semester;
      if (!p.academic_year && meta.academic_year) p.academic_year = meta.academic_year;
    } catch {}
  }
  res.json(publicProfile(p));
});

router.post('/auth/change-password', authenticate, passwordLimit, async (req, res) => {
  const parsed = z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const current_password = parsed.data.current_password.trim();
  const new_password = parsed.data.new_password.trim();
  if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (current_password === new_password) return res.status(400).json({ error: 'Choose a password different from the current one' });

  const ok = await verifyPassword(req.profile.email, current_password);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  if (req.profile.role === 'student' && !req.profile.student_id &&
      await passwordCollides(req.profile.name_key, new_password, req.profile.id))
    return res.status(409).json({ error: 'Please choose a different password.' });

  const { error } = await admin.auth.admin.updateUserById(req.profile.auth_user_id, { password: new_password });
  if (error) return res.status(400).json({ error: 'Could not change the password' });
  await admin.from('profiles').update({ must_change_password: false, temp_password_expires_at: null }).eq('id', req.profile.id);
  await audit(req.profile.id, 'profile', req.profile.id, 'password_changed');

  // Immediately sign in with the new password to yield a valid active session
  let newSession = null;
  try {
    const { data: signData } = await publicAuth.auth.signInWithPassword({
      email: req.profile.email,
      password: new_password
    });
    newSession = signData?.session;
  } catch (signErr) {
    console.warn('Auto sign-in after password change warning:', signErr.message);
  }

  res.json({
    ok: true,
    session: newSession ? {
      access_token: newSession.access_token,
      refresh_token: newSession.refresh_token,
      expires_at: newSession.expires_at
    } : null
  });
});

// ------------------------------------------------------------------ FORGOT PASSWORD
router.post('/auth/forgot-password', async (req, res) => {
  const { identity } = req.body || {};
  if (!identity || !identity.trim()) {
    return res.status(400).json({ error: 'Please enter your username, student ID, or email.' });
  }
  const id = identity.trim();

  // 1. If staff username
  const normalisedStaffId = id.toUpperCase().replace(/^([A-Z]+)\s*[-_]?\s*(\d+)$/, '$1-$2');
  if (STAFF_USERNAME.test(id) || STAFF_USERNAME.test(normalisedStaffId)) {
    return res.status(400).json({
      error: 'Lecturers and Class Representatives must request password reset using their Staff Username and registered Phone Number. Recovery codes are for students only.'
    });
  }

  // 2. If email (staff or student with email)
  if (id.includes('@')) {
    const { data: p } = await admin.from('profiles').select('id,email,full_name,role').ilike('email', id).maybeSingle();
    if (p?.email) {
      if (p.role === 'lecturer' || p.role === 'class_rep') {
        return res.status(400).json({
          error: 'Staff members must request a password reset with their username and registered phone number for HOD approval.'
        });
      try {
        await admin.auth.resetPasswordForEmail(p.email);
      } catch (e) {
        console.warn('Reset password email warning:', e.message);
      }
      return res.json({ message: 'Password reset instructions have been sent to your email address.' });
    }
  }

  // 3. If student ID or Full Name
  const { data: student } = await admin.from('profiles').select('id,full_name,student_id,level,programme').eq('role', 'student')
    .or(`student_id.eq.${id},full_name.ilike.%${id}%`).limit(1).maybeSingle();
  if (student) {
    const { data: reps } = await admin.from('class_reps').select('rep_id').eq('level', student.level);
    const { data: hods } = await admin.from('profiles').select('id').eq('role', 'hod').eq('is_active', true);
    await notify(
      [...(reps || []).map(r => r.rep_id), ...(hods || []).map(h => h.id)],
      'Password Reset Request',
      `Student ${student.full_name} (${student.student_id ? 'ID: ' + student.student_id : 'Level ' + student.level}) requested a password reset. You can generate a temporary password in your portal.`
    );
    return res.json({
      message: `Password reset request submitted for ${student.full_name}. Please contact your Class Representative or HOD who can generate your temporary password.`
    });
  }

  res.json({ message: 'If an account matches your details, password reset instructions have been dispatched.' });
});

// ------------------------------------------------------------------ STAFF FORGOT PASSWORD (LECTURER & CLASS REP)
// Lecturers and class representatives request a reset using their username and phone number.
// Only the HOD can approve these requests. Recovery codes are for students only.
router.post('/auth/staff-forgot-password', passwordLimit, async (req, res) => {
  const schema = z.object({
    username: z.string().trim().min(3).max(50),
    phone_number: z.string().trim().min(8).max(25)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please enter your staff username and registered phone number.' });
  }
  const { username, phone_number } = parsed.data;

  // Find staff profile by username
  const cleanUsername = username.trim().toUpperCase();
  const { data: p, error: pErr } = await admin.from('profiles')
    .select('id,auth_user_id,username,full_name,role,phone_number,is_active')
    .ilike('username', cleanUsername)
    .in('role', ['lecturer', 'class_rep'])
    .maybeSingle();

  if (pErr || !p) {
    return res.status(404).json({
      error: `No lecturer or class representative account found with username "${username}". Note: Recovery codes are for students only.`
    });
  }

  if (!p.is_active) {
    return res.status(403).json({ error: 'This staff account has been deactivated. Please contact the HOD in person.' });
  }

  // Normalise entered phone number and compare with verified phone on file
  let normEnteredPhone;
  try {
    normEnteredPhone = normalisePhone(phone_number);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid phone number format: ' + e.message });
  }

  const normSavedPhone = (p.phone_number || '').replace(/\D/g, '');
  const cleanEntered = normEnteredPhone.replace(/\D/g, '');

  if (cleanEntered !== normSavedPhone) {
    return res.status(400).json({
      error: 'The phone number entered does not match the number on file for this staff account. If you changed your phone number, please contact the HOD in person to verify and update your phone number first.'
    });
  }

  // Mark pending in auth user_metadata
  if (p.auth_user_id) {
    await admin.auth.admin.updateUserById(p.auth_user_id, {
      user_metadata: {
        staff_reset_pending: true,
        staff_reset_requested_at: new Date().toISOString(),
        staff_reset_phone: p.phone_number
      }
    });
  }

  // Record audit log
  await audit(p.id, 'profile', p.id, 'staff_password_reset_requested', null, {
    username: p.username,
    phone_number: p.phone_number,
    full_name: p.full_name,
    role: p.role
  });

  // Notify HOD
  const { data: hods } = await admin.from('profiles').select('id').eq('role', 'hod').eq('is_active', true);
  if (hods?.length) {
    await notify(
      hods.map(h => h.id),
      'Staff Password Reset Request',
      `${p.full_name} (${p.username}, ${p.role === 'lecturer' ? 'Lecturer' : 'Class Rep'}) requested a password reset. Phone on file: ${p.phone_number}`
    );
  }

  res.json({
    ok: true,
    message: `Password reset request submitted to HOD. Once approved, your temporary credentials will be sent to your verified WhatsApp number (${p.phone_number}).`
  });
});

// ------------------------------------------------------------------ RECOVERY CODE PASSWORD RESET (STUDENTS)
router.post('/auth/reset-with-recovery-code', passwordLimit, async (req, res) => {
  const schema = z.object({
    identity: z.string().trim().min(2).max(120),
    recovery_code: z.string().trim().min(6).max(40),
    new_password: z.string().min(8).max(200)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the entered information.' });
  const { identity, recovery_code, new_password } = parsed.data;

  // Enforce both letters and numbers in password
  if (!/[a-zA-Z]/.test(new_password) || !/\d/.test(new_password)) {
    return res.status(400).json({ error: 'New password must contain both letters and numbers.' });
  }

  const id = identity.trim();
  let studentProfile = null;

  // 1. Find by student_id
  const { data: byId } = await admin.from('profiles').select('*').eq('role', 'student').eq('student_id', id.toUpperCase()).maybeSingle();
  if (byId) studentProfile = byId;

  // 2. Find by phone
  if (!studentProfile) {
    try {
      const phone = normalisePhone(id);
      const { data: byPhone } = await admin.from('profiles').select('*').eq('role', 'student').eq('phone_number', phone).maybeSingle();
      if (byPhone) studentProfile = byPhone;
    } catch {}
  }

  // 3. Find by full name (exact or normaliseName match)
  if (!studentProfile) {
    const key = normaliseName(id);
    const { data: byName } = await admin.from('profiles').select('*').eq('role', 'student').eq('name_key', key).maybeSingle();
    if (byName) studentProfile = byName;
  }

  // 4. Find by email
  if (!studentProfile && id.includes('@')) {
    const { data: byEmail } = await admin.from('profiles').select('*').eq('role', 'student').ilike('email', id).maybeSingle();
    if (byEmail) studentProfile = byEmail;
  }

  if (!studentProfile) {
    return res.status(404).json({ error: 'No student account was found matching those details.' });
  }

  // Retrieve stored recovery code hash from profile or auth user_metadata
  let storedHash = studentProfile.recovery_code_hash;
  if (!storedHash && studentProfile.auth_user_id) {
    const { data: userRes } = await admin.auth.admin.getUserById(studentProfile.auth_user_id);
    storedHash = userRes?.user?.user_metadata?.recovery_code_hash;
  }

  if (!storedHash) {
    return res.status(400).json({
      error: 'No recovery code is registered for this account. Please ask your Class Representative or HOD to issue a temporary password.'
    });
  }

  const providedHash = hashRecoveryCode(recovery_code);
  const matches = (storedHash.length === providedHash.length && safeEqual(storedHash, providedHash)) || (storedHash === providedHash);
  if (!matches) {
    return res.status(400).json({
      error: 'Invalid recovery code. Please check the code carefully or ask your Class Representative or HOD.'
    });
  }

  // Update password in Supabase Auth
  const { error: pwdErr } = await admin.auth.admin.updateUserById(studentProfile.auth_user_id, { password: new_password });
  if (pwdErr) return res.status(400).json({ error: 'Could not set the new password. Please try again.' });

  // Generate a BRAND NEW recovery code (invalidating the used one)
  const nextRecoveryCode = generateRecoveryCode();
  const nextHash = hashRecoveryCode(nextRecoveryCode);

  await admin.auth.admin.updateUserById(studentProfile.auth_user_id, {
    user_metadata: { recovery_code_hash: nextHash }
  });
  try {
    await admin.from('profiles').update({
      recovery_code_hash: nextHash,
      must_change_password: false,
      temp_password_expires_at: null
    }).eq('id', studentProfile.id);
  } catch (e) {
    console.warn('Profile recovery hash update warning:', e.message);
  }

  await audit(studentProfile.id, 'profile', studentProfile.id, 'password_reset_via_recovery_code');

  res.json({
    ok: true,
    message: 'Password successfully reset.',
    new_recovery_code: nextRecoveryCode,
    student_name: studentProfile.full_name,
    student_id: studentProfile.student_id || studentProfile.phone_number
  });
});

// ------------------------------------------------------------------ REGENERATE RECOVERY CODE (MY PROFILE)
router.post('/auth/regenerate-recovery-code', authenticate, passwordLimit, async (req, res) => {
  if (req.profile.role !== 'student') {
    return res.status(403).json({ error: 'Only student accounts use recovery codes.' });
  }
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your current password to generate a new recovery code.' });
  }

  const ok = await verifyPassword(req.profile.email, password.trim());
  if (!ok) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const newRecoveryCode = generateRecoveryCode();
  const newHash = hashRecoveryCode(newRecoveryCode);

  await admin.auth.admin.updateUserById(req.profile.auth_user_id, {
    user_metadata: { recovery_code_hash: newHash }
  });
  try {
    await admin.from('profiles').update({ recovery_code_hash: newHash }).eq('id', req.profile.id);
  } catch (e) {
    console.warn('Profile recovery hash update warning:', e.message);
  }

  await audit(req.profile.id, 'profile', req.profile.id, 'recovery_code_regenerated');

  res.json({
    ok: true,
    recovery_code: newRecoveryCode,
    student_name: req.profile.full_name,
    student_id: req.profile.student_id || req.profile.phone_number
  });
});

export default router;
