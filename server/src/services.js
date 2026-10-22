import { admin } from './supabase.js';

// ---------- notifications (in-app inbox + OneSignal push) ----------
export async function notify(recipientIds, title, body) {
  const ids = [...new Set([recipientIds].flat().filter(Boolean))];
  if (!ids.length) return;
  const { error } = await admin.from('notifications').insert(ids.map(recipient_id => ({ recipient_id, title, body })));
  if (error) console.error('Notification save failed:', error.message);
  const appId = process.env.ONESIGNAL_APP_ID, apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) return;
  try {
    const r = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
      body: JSON.stringify({
        app_id: appId, target_channel: 'push',
        include_aliases: { external_id: ids },
        headings: { en: title }, contents: { en: body }
      })
    });
    if (!r.ok) console.error('OneSignal delivery failed:', r.status);
  } catch (e) {
    console.error('OneSignal request failed:', e.message);
  }
}

// ---------- audit trail (server only) ----------
export async function audit(actorId, entityType, entityId, action, oldData = null, newData = null) {
  const { error } = await admin.from('audit_logs').insert({
    actor_id: actorId || null, entity_type: entityType, entity_id: String(entityId),
    action, old_data: oldData, new_data: newData
  });
  if (error) console.error('Audit write failed:', error.message);
}

// ---------- shared helpers ----------
/** Fields of a profile that are safe to send to the browser (no internal auth email). */
export function publicProfile(p) {
  if (!p) return null;
  const { id, role, username, full_name, phone_number, student_id, department, programme, level,
    account_status, is_active, must_change_password, credentials_sent, created_at, avatar_url,
    academic_year_id, academic_year, semester } = p;
  return { id, role, username, full_name, phone_number, student_id, department, programme, level,
    account_status, is_active, must_change_password, credentials_sent, created_at, avatar_url: avatar_url || null,
    academic_year_id: academic_year_id || null,
    academic_year: academic_year || '2026/2027',
    semester: semester || p.raw_user_meta_data?.semester || 1 };
}

export async function currentPeriod() {
  const [y, s] = await Promise.all([
    admin.from('academic_years').select('id,name').eq('is_current', true).maybeSingle(),
    admin.from('semesters').select('id,name,starts_on,ends_on').eq('is_current', true).maybeSingle()
  ]);
  return { year: y.data || null, semester: s.data || null };
}

/** Page through a query (pass a factory returning a fresh builder) so results are not capped at 1000 rows. */
export async function fetchAll(makeQuery, page = 1000, max = 50000) {
  const out = [];
  for (let from = 0; from < max; from += page) {
    const { data, error } = await makeQuery().range(from, from + page - 1);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

/** Register an approved student for this level's active courses in the current period. */
export async function registerCoursesFor(student) {
  const { year, semester } = await currentPeriod();
  if (!year || !semester) return 0;
  const { data: courses } = await admin.from('courses').select('id,semester_id')
    .eq('level', student.level).eq('is_active', true);
  const rows = (courses || [])
    .filter(c => !c.semester_id || c.semester_id === semester.id)
    .map(c => ({ student_id: student.id, course_id: c.id, academic_year_id: year.id, semester_id: semester.id }));
  if (!rows.length) return 0;
  await admin.from('course_registrations').upsert(rows, {
    onConflict: 'student_id,course_id,academic_year_id,semester_id', ignoreDuplicates: true
  });
  return rows.length;
}

/** The class (programme + level) a class representative manages. */
export async function getRepAllocation(profileId) {
  const { data, error } = await admin.from('class_reps').select('*').eq('rep_id', profileId).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  if (!data) {
    // Graceful fallback to the representative's profile configuration
    const { data: prof } = await admin.from('profiles').select('id,level,programme,academic_year_id').eq('id', profileId).maybeSingle();
    if (prof && (prof.level || prof.programme)) {
      const { year, semester } = await currentPeriod();
      return {
        rep_id: profileId,
        level: prof.level || 1,
        programme: prof.programme || 'Degree',
        academic_year_id: prof.academic_year_id || year?.id || null,
        semester_id: semester?.id || null
      };
    }
    throw Object.assign(new Error('No class is assigned to this representative yet'), { status: 403 });
  }
  return data;
}

let settingsCache = null;
let settingsCacheTime = 0;

export async function getDepartmentSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime < 30000)) {
    return settingsCache;
  }

  const { data: dept } = await admin.from('department_settings').select('*').limit(1).maybeSingle();
  const { data: auditSetting } = await admin.from('audit_logs')
    .select('new_data')
    .eq('entity_type', 'department_settings')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const min_attendance_threshold = dept?.min_attendance_threshold ?? auditSetting?.new_data?.min_attendance_threshold ?? 75;
  const require_qr_or_code = dept?.require_qr_or_code ?? auditSetting?.new_data?.require_qr_or_code ?? false;
  const attendance_grace_minutes = dept?.attendance_grace_minutes ?? auditSetting?.new_data?.attendance_grace_minutes ?? Number(process.env.ATTENDANCE_GRACE_MINUTES || 15);
  const university_name = dept?.university_name ?? auditSetting?.new_data?.university_name ?? 'Milton Margai Technical University';
  const department_name = dept?.department_name ?? auditSetting?.new_data?.department_name ?? 'Department of Computer Science';
  const lecturer_signature_label = dept?.lecturer_signature_label ?? auditSetting?.new_data?.lecturer_signature_label ?? 'Lecturer';
  const hod_signature_label = dept?.hod_signature_label ?? auditSetting?.new_data?.hod_signature_label ?? 'Head of Department';
  const logo_data = dept?.logo_data ?? auditSetting?.new_data?.logo_data ?? null;

  settingsCache = {
    ...dept,
    min_attendance_threshold: Number(min_attendance_threshold),
    require_qr_or_code: Boolean(require_qr_or_code),
    attendance_grace_minutes: Number(attendance_grace_minutes),
    university_name,
    department_name,
    lecturer_signature_label,
    hod_signature_label,
    logo_data
  };
  settingsCacheTime = now;
  return settingsCache;
}

export function clearSettingsCache() {
  settingsCache = null;
  settingsCacheTime = 0;
}


/** Approve or reject a student: shared by the HOD and the class rep endpoints. */
export async function decideStudent(student, decision, actor) {
  const patch = decision === 'approved'
    ? { account_status: 'approved', approved_by: actor.id, approved_at: new Date().toISOString() }
    : { account_status: 'rejected', approved_by: actor.id, approved_at: new Date().toISOString() };
  const { data, error } = await admin.from('profiles').update(patch).eq('id', student.id)
    .select('id,student_id,full_name,account_status,level,programme').single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  if (decision === 'approved') await registerCoursesFor(data);
  await audit(actor.id, 'profile', student.id, `student_${decision}`, { account_status: student.account_status }, patch);
  await notify(student.id,
    decision === 'approved' ? 'Registration approved' : 'Registration not approved',
    decision === 'approved'
      ? 'Your account has been approved. You can now mark attendance.'
      : 'Your registration was not approved. Please contact your class representative or the department.');
  return data;
}
