import crypto from 'node:crypto';
import { admin } from './supabase.js';
import { audit, notify, currentPeriod, getDepartmentSettings } from './services.js';
import { sessionWindow, todayInTz, weekdayOf, zonedToUtcMs } from './utils.js';

/**
 * Creates class sessions automatically from timetable entries for every week
 * of the active semester, skipping holidays and non-teaching days.
 */
export async function ensureSemesterSessions(targetTimetableId = null) {
  const { semester, year } = await currentPeriod();
  if (!semester) return { created: 0, reason: 'No active semester' };

  const todayStr = todayInTz();
  let startStr = semester.starts_on || todayStr;
  let endStr = semester.ends_on;

  // Default to 16 weeks if ends_on is missing
  if (!endStr) {
    const sDate = new Date(startStr);
    sDate.setDate(sDate.getDate() + 16 * 7);
    endStr = sDate.toISOString().slice(0, 10);
  }

  // Fetch non-teaching holidays
  const { data: holidays } = await admin.from('holidays')
    .select('holiday_date,is_teaching_day')
    .eq('is_teaching_day', false);
  const holidaySet = new Set((holidays || []).map(h => h.holiday_date));

  // Fetch timetable entries
  let tq = admin.from('timetable_entries').select('id,lecturer_id,day_of_week,starts_at,ends_at');
  if (targetTimetableId) {
    tq = tq.eq('id', targetTimetableId);
  } else if (semester.id) {
    tq = tq.or(`semester_id.eq.${semester.id},semester_id.is.null`);
  }
  const { data: entries, error: tErr } = await tq;
  if (tErr || !entries?.length) return { created: 0, reason: tErr?.message || 'No timetable entries' };

  const startD = new Date(startStr + 'T00:00:00Z');
  const endD = new Date(endStr + 'T23:59:59Z');
  const rowsToInsert = [];

  for (const entry of entries) {
    if (!entry.lecturer_id) continue;
    let curr = new Date(startD);
    while (curr <= endD) {
      const dateStr = curr.toISOString().slice(0, 10);
      const dayOfWeek = curr.getUTCDay();

      if (dayOfWeek === entry.day_of_week && !holidaySet.has(dateStr)) {
        rowsToInsert.push({
          timetable_entry_id: entry.id,
          lecturer_id: entry.lecturer_id,
          session_date: dateStr,
          status: 'scheduled',
          is_open: false
        });
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
  }

  if (!rowsToInsert.length) return { created: 0 };

  // Batch insert in chunks of 200 with onConflict ignore
  let totalInserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += 200) {
    const chunk = rowsToInsert.slice(i, i + 200);
    const { data, error } = await admin.from('class_sessions')
      .upsert(chunk, { onConflict: 'timetable_entry_id,session_date', ignoreDuplicates: true })
      .select('id');
    if (!error && data) totalInserted += data.length;
  }

  return { created: totalInserted, total_planned: rowsToInsert.length };
}

/**
 * Scheduled job:
 * 1. Scheduled -> Open when start time is reached.
 * 2. Open -> Closed when end time + grace period is reached (default 15 minutes, set by HOD).
 * 3. Finalizes closed sessions: marks every non-submitting enrolled student Absent.
 */
export async function runSessionLifecycleJob() {
  const settings = await getDepartmentSettings();
  const graceMinutes = settings.attendance_grace_minutes ?? 15;
  const today = todayInTz();
  const now = Date.now();
  const nowIso = new Date().toISOString();

  let openedCount = 0;
  let closedCount = 0;

  // --- Step 1: Auto-open Scheduled Sessions ---
  const { data: scheduledToday, error: sErr } = await admin.from('class_sessions')
    .select('id,session_date,class_code,status,timetable_entries(id,starts_at,ends_at)')
    .eq('session_date', today)
    .eq('status', 'scheduled')
    .eq('is_open', false);

  if (!sErr && scheduledToday?.length) {
    for (const s of scheduledToday) {
      const t = s.timetable_entries;
      if (!t) continue;
      const w = sessionWindow(s.session_date, t.starts_at, t.ends_at, graceMinutes);

      // Start time reached (or up to 5 mins early) and class has not ended
      if (now >= w.earliestOpen && now < w.end) {
        const code = s.class_code || String(crypto.randomInt(100000, 1000000));
        const { error } = await admin.from('class_sessions').update({
          status: 'open',
          is_open: true,
          class_code: code,
          opened_at: new Date().toISOString(),
          closes_at: new Date(w.end).toISOString()
        }).eq('id', s.id);

        if (!error) {
          openedCount++;
          await audit(null, 'class_session', s.id, 'auto_opened', null, { code, closes_at: new Date(w.end).toISOString() });
        }
      }
    }
  }

  // --- Step 2: Auto-close Open Sessions past end time + grace period ---
  const { data: openExpired, error: oErr } = await admin.from('class_sessions')
    .select('id,closes_at')
    .eq('is_open', true)
    .lt('closes_at', nowIso);

  if (!oErr && openExpired?.length) {
    for (const s of openExpired) {
      await admin.from('class_sessions').update({ status: 'closed', is_open: false }).eq('id', s.id);
      await finalizeSession(s.id);
      closedCount++;
    }
  }

  // --- Step 3: Finalize any closed sessions not yet finalized ---
  const { data: unfinalized } = await admin.from('class_sessions')
    .select('id')
    .eq('is_open', false)
    .neq('status', 'cancelled')
    .is('finalized_at', null)
    .lt('closes_at', nowIso)
    .limit(200);

  if (unfinalized?.length) {
    for (const s of unfinalized) {
      await finalizeSession(s.id);
    }
  }

  return { auto_opened: openedCount, auto_closed: closedCount };
}

/**
 * Marks every approved, active student registered for the session's course (year + semester)
 * who has no record as ABSENT, notifies them, and stamps the session as finalized (only once).
 */
export async function finalizeSession(sessionId) {
  const { data: s } = await admin.from('class_sessions')
    .select('id,status,finalized_at,timetable_entries(course_id,level,programme,academic_year_id,semester_id,courses(code))').eq('id', sessionId).maybeSingle();
  if (!s || s.finalized_at || s.status === 'cancelled' || !s.timetable_entries) return 0;
  const t = s.timetable_entries;

  let reg = admin.from('course_registrations').select('student_id').eq('course_id', t.course_id);
  if (t.academic_year_id) reg = reg.eq('academic_year_id', t.academic_year_id);
  if (t.semester_id) reg = reg.eq('semester_id', t.semester_id);
  const { data: enrolled, error } = await reg.limit(5000);
  if (error) return 0;

  let absentIds = [];
  const ids = (enrolled || []).map(r => r.student_id);
  if (ids.length) {
    const [students, existing] = await Promise.all([
      admin.from('profiles').select('id').in('id', ids).eq('role', 'student').eq('is_active', true).eq('account_status', 'approved'),
      admin.from('attendance_records').select('student_id').eq('session_id', s.id)
    ]);
    if (students.error || existing.error) return 0;
    const have = new Set(existing.data.map(r => r.student_id));
    absentIds = students.data.map(r => r.id).filter(id => !have.has(id));
    if (absentIds.length) {
      const { error: insertError } = await admin.from('attendance_records')
        .upsert(absentIds.map(student_id => ({ session_id: s.id, student_id, status: 'absent' })),
          { onConflict: 'session_id,student_id', ignoreDuplicates: true });
      if (insertError) return 0;
    }
  }
  await admin.from('class_sessions').update({ is_open: false, finalized_at: new Date().toISOString() }).eq('id', s.id);
  await audit(null, 'class_session', s.id, 'finalized', null, { absent: absentIds.length });
  if (absentIds.length)
    await notify(absentIds, 'Marked absent', `You were marked absent for ${t.courses?.code || 'a class'} because no attendance was submitted before the session closed.`);
  return absentIds.length;
}

/** Closes sessions whose scheduled time has ended, then finalizes every closed session. */
export async function runFinalizeJob() {
  return runSessionLifecycleJob();
}

/** Helper to format "09:00:00" -> "9:00 AM", "14:30:00" -> "2:30 PM" */
function formatTime12(timeStr) {
  if (!timeStr) return '';
  const parts = String(timeStr).split(':');
  const hour = parseInt(parts[0], 10);
  const min = parts[1] || '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${min} ${ampm}`;
}

// In-memory cache to prevent duplicate start reminders during server runtime
const sentStartReminderCache = new Set();
let startReminderCacheDate = null;

async function ensureStartReminderCache(today) {
  if (startReminderCacheDate === today) return;
  sentStartReminderCache.clear();
  startReminderCacheDate = today;
  // Restore any start reminders already audited today
  try {
    const { data: audited } = await admin.from('audit_logs')
      .select('entity_id')
      .eq('entity_type', 'class_session')
      .eq('action', 'start_reminder_sent')
      .gte('created_at', `${today}T00:00:00Z`);
    if (audited?.length) {
      audited.forEach(a => sentStartReminderCache.add(a.entity_id));
    }
  } catch (err) {
    console.warn('Could not restore start reminder cache from audit logs:', err.message);
  }
}

/**
 * Checks class sessions and sends accurate notifications:
 * 1. 5 minutes before class starts (to students and lecturer)
 * 2. 20 minutes before class ends (to students who have not yet marked attendance, and lecturer)
 */
export async function runSessionRemindersJob() {
  const now = Date.now();
  const today = todayInTz();
  await ensureStartReminderCache(today);

  let totalNotified = 0;

  // -----------------------------------------------------------------
  // 1. START REMINDERS: 5 MINUTES BEFORE CLASS STARTS
  // -----------------------------------------------------------------
  try {
    const { data: upcomingSessions, error: upErr } = await admin.from('class_sessions')
      .select('id,session_date,status,is_open,lecturer_id,timetable_entries(id,level,programme,course_id,starts_at,ends_at,lecturer_id,courses(code,title),venues(name))')
      .eq('session_date', today)
      .neq('status', 'cancelled');

    if (!upErr && upcomingSessions?.length) {
      for (const s of upcomingSessions) {
        const t = s.timetable_entries;
        if (!t?.starts_at) continue;
        if (sentStartReminderCache.has(s.id)) continue;

        const startMs = zonedToUtcMs(s.session_date, t.starts_at);
        const msUntilStart = startMs - now;

        // Trigger when between 5 minutes before start and up to 2 minutes after start
        if (msUntilStart <= 5 * 60000 && msUntilStart >= -2 * 60000) {
          sentStartReminderCache.add(s.id);

          const courseCode = t.courses?.code || 'Class';
          const courseTitle = t.courses?.title || 'Scheduled Lecture';
          const venueName = t.venues?.name || 'Assigned Lecture Hall';
          const startTimeFormatted = formatTime12(t.starts_at);

          // Get enrolled students & matching class students
          const [regStudents, classStudents] = await Promise.all([
            admin.from('course_registrations').select('student_id').eq('course_id', t.course_id),
            admin.from('profiles').select('id')
              .eq('role', 'student')
              .eq('programme', t.programme)
              .eq('level', t.level)
              .eq('is_active', true)
              .eq('account_status', 'approved')
          ]);

          const studentIds = new Set([
            ...(regStudents.data || []).map(r => r.student_id),
            ...(classStudents.data || []).map(r => r.id)
          ]);

          const studentList = [...studentIds];
          const lecturerId = s.lecturer_id || t.lecturer_id;

          // Notify students
          if (studentList.length > 0) {
            await notify(
              studentList,
              `🔔 Class Starting in 5 Mins: ${courseCode}`,
              `"${courseTitle}" starts at ${startTimeFormatted} in ${venueName}. Please proceed to your lecture hall!`
            );
            totalNotified += studentList.length;
          }

          // Notify lecturer
          if (lecturerId) {
            await notify(
              lecturerId,
              `🔔 Lecture Starting in 5 Mins: ${courseCode}`,
              `"${courseTitle}" is starting at ${startTimeFormatted} in ${venueName}. Session is ready to begin.`
            );
            totalNotified += 1;
          }

          // Persist audit record and update start_reminder_sent if column exists
          await audit(null, 'class_session', s.id, 'start_reminder_sent', null, {
            course: courseCode,
            starts_at: t.starts_at,
            notified_students: studentList.length
          });
          try {
            await admin.from('class_sessions').update({ start_reminder_sent: true }).eq('id', s.id);
          } catch (e) {
            console.warn('Reminder flag update warning:', e.message);
          }
        }
    }
  } catch (err) {
    console.error('Error running 5-min start reminders:', err.message);
  }

  // -----------------------------------------------------------------
  // 2. ENDING REMINDERS: 20 MINUTES BEFORE CLASS ENDS
  // -----------------------------------------------------------------
  try {
    const { data: activeSessions, error: aErr } = await admin.from('class_sessions')
      .select('id,session_date,status,is_open,closes_at,reminder_sent,lecturer_id,timetable_entries(id,level,programme,course_id,starts_at,ends_at,lecturer_id,courses(code,title),venues(name))')
      .eq('session_date', today)
      .eq('reminder_sent', false)
      .neq('status', 'cancelled');

    if (!aErr && activeSessions?.length) {
      for (const s of activeSessions) {
        const t = s.timetable_entries;
        if (!t?.ends_at) continue;

        const scheduledEndMs = zonedToUtcMs(s.session_date, t.ends_at);
        const closesAtMs = s.closes_at ? Date.parse(s.closes_at) : sessionWindow(s.session_date, t.starts_at, t.ends_at).end;
        const msUntilScheduledEnd = scheduledEndMs - now;

        // Trigger when 20 minutes or less remain before scheduled end, and class has not closed yet
        if (msUntilScheduledEnd <= 20 * 60000 && msUntilScheduledEnd >= -5 * 60000 && now < closesAtMs) {
          const courseCode = t.courses?.code || 'Class';
          const courseTitle = t.courses?.title || 'Lecture';
          const endTimeFormatted = formatTime12(t.ends_at);

          // Get enrolled students
          const [regStudents, classStudents, submittedRecords] = await Promise.all([
            admin.from('course_registrations').select('student_id').eq('course_id', t.course_id),
            admin.from('profiles').select('id')
              .eq('role', 'student')
              .eq('programme', t.programme)
              .eq('level', t.level)
              .eq('is_active', true)
              .eq('account_status', 'approved'),
            admin.from('attendance_records').select('student_id').eq('session_id', s.id)
          ]);

          const allStudentIds = new Set([
            ...(regStudents.data || []).map(r => r.student_id),
            ...(classStudents.data || []).map(r => r.id)
          ]);

          const submittedSet = new Set((submittedRecords.data || []).map(r => r.student_id));
          const pendingStudentIds = [...allStudentIds].filter(id => !submittedSet.has(id));
          const lecturerId = s.lecturer_id || t.lecturer_id;

          // Notify students who haven't submitted yet
          if (pendingStudentIds.length > 0) {
            await notify(
              pendingStudentIds,
              `⏳ Class Ending in 20 Mins: ${courseCode}`,
              `"${courseTitle}" is ending in 20 minutes (at ${endTimeFormatted})! Please submit your attendance now before the session closes.`
            );
            totalNotified += pendingStudentIds.length;
          }

          // Notify lecturer
          if (lecturerId) {
            await notify(
              lecturerId,
              `⏰ Class Ending in 20 Mins: ${courseCode}`,
              `"${courseTitle}" ends in 20 minutes. ${pendingStudentIds.length} student(s) have not yet marked attendance.`
            );
            totalNotified += 1;
          }

          // Mark reminder_sent on session and audit
          await admin.from('class_sessions').update({ reminder_sent: true }).eq('id', s.id);
          await audit(null, 'class_session', s.id, 'end_reminder_sent', null, {
            course: courseCode,
            ends_at: t.ends_at,
            unsubmitted_students: pendingStudentIds.length
          });
        }
      }
    }
  } catch (err) {
    console.error('Error running 20-min ending reminders:', err.message);
  }

  return totalNotified;
}

