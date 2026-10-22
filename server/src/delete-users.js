import 'dotenv/config';
import { admin } from './supabase.js';

/**
 * Script to safely delete user accounts (HOD, lecturers, students, and class reps)
 * Usage:
 *   node src/delete-users.js all
 *   node src/delete-users.js student
 *   node src/delete-users.js lecturer
 *   node src/delete-users.js class_rep
 *   node src/delete-users.js hod
 */

async function deleteUsers() {
  const targetRole = (process.argv[2] || 'all').toLowerCase();
  const validRoles = ['all', 'student', 'lecturer', 'class_rep', 'hod'];

  if (!validRoles.includes(targetRole)) {
    console.error(`Invalid role: "${targetRole}". Must be one of: ${validRoles.join(', ')}`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(` Starting User Deletion Process (Target: ${targetRole.toUpperCase()})`);
  console.log(`======================================================\n`);

  // 1. Fetch profiles to delete
  let query = admin.from('profiles').select('id, auth_user_id, role, username, full_name, email');
  if (targetRole !== 'all') {
    query = query.eq('role', targetRole);
  }
  const { data: profiles, error: pErr } = await query;

  if (pErr) {
    console.error('Error fetching profiles:', pErr.message);
    process.exit(1);
  }

  // Also check auth.users for any orphaned users when targetRole === 'all'
  let orphanAuthIds = [];
  if (targetRole === 'all') {
    const { data: authList } = await admin.auth.admin.listUsers();
    if (authList?.users?.length) {
      orphanAuthIds = authList.users.map(u => u.id);
    }
  }

  if ((!profiles || profiles.length === 0) && orphanAuthIds.length === 0) {
    console.log(`✓ Database is already clean. No user accounts or profiles found for target: ${targetRole.toUpperCase()}`);
    process.exit(0);
  }

  const profileIds = profiles.map(p => p.id);
  const authUserIds = profiles.map(p => p.auth_user_id).filter(Boolean);

  console.log(`Found ${profiles.length} user profile(s) to remove:`);
  profiles.forEach(p => console.log(` - [${p.role.toUpperCase()}] ${p.full_name} (${p.username || p.email || 'No username'})`));

  console.log('\n[1/5] Unlinking foreign key constraints...');
  // Unlink student list claims
  await admin.from('student_list').update({ is_claimed: false, claimed_by: null }).in('claimed_by', profileIds);

  // Unlink profile approved_by
  await admin.from('profiles').update({ approved_by: null }).in('approved_by', profileIds);

  // Unlink timetable entries
  await admin.from('timetable_entries').update({ lecturer_id: null }).in('lecturer_id', profileIds);
  await admin.from('timetable_entries').update({ created_by: null }).in('created_by', profileIds);

  // Unlink holidays
  await admin.from('holidays').update({ created_by: null }).in('created_by', profileIds);

  console.log('[2/5] Cleaning dependent activity records...');
  // Attendance records
  await admin.from('attendance_records').delete().in('student_id', profileIds);
  await admin.from('attendance_records').delete().in('reviewed_by', profileIds);

  // Appeals and Excuses
  await admin.from('attendance_appeals').delete().in('student_id', profileIds);
  await admin.from('attendance_appeals').delete().in('reviewed_by', profileIds);
  await admin.from('excuse_requests').delete().in('student_id', profileIds);
  await admin.from('excuse_requests').delete().in('reviewed_by', profileIds);

  // Sessions created by lecturers
  await admin.from('class_sessions').delete().in('lecturer_id', profileIds);

  // Course registrations & assignments
  await admin.from('course_registrations').delete().in('student_id', profileIds);
  await admin.from('lecturer_courses').delete().in('lecturer_id', profileIds);
  await admin.from('class_reps').delete().in('rep_id', profileIds);

  // Notifications, announcements & logs
  await admin.from('notifications').delete().in('recipient_id', profileIds);
  await admin.from('announcements').delete().in('author_id', profileIds);
  await admin.from('audit_logs').delete().in('actor_id', profileIds);

  if (targetRole === 'all') {
    await admin.from('login_attempts').delete().neq('key', '__keep__');
  }

  console.log('[3/5] Deleting profile rows...');
  const { error: delPErr } = await admin.from('profiles').delete().in('id', profileIds);
  if (delPErr) {
    console.error('Error deleting profiles:', delPErr.message);
  } else {
    console.log(`✓ Deleted ${profileIds.length} profile(s).`);
  }

  console.log('[4/5] Deleting Supabase auth accounts...');
  let authSuccess = 0;
  for (const authId of authUserIds) {
    try {
      const { error: aErr } = await admin.auth.admin.deleteUser(authId);
      if (aErr) {
        console.warn(`  Warning deleting auth user ${authId}:`, aErr.message);
      } else {
        authSuccess++;
      }
    } catch (err) {
      console.warn(`  Warning deleting auth user ${authId}:`, err.message);
    }
  }
  console.log(`✓ Deleted ${authSuccess} Supabase auth user(s).`);

  console.log('[5/5] Resetting staff sequences if role is all or staff...');
  if (targetRole === 'all' || targetRole === 'lecturer' || targetRole === 'class_rep') {
    try {
      await admin.rpc('reset_staff_sequences');
    } catch {
      // Ignored if RPC doesn't exist
    }
  }

  console.log('\n======================================================');
  console.log(` Successfully deleted user accounts for: ${targetRole.toUpperCase()}`);
  console.log('======================================================\n');
}

deleteUsers().catch(err => {
  console.error('Fatal error during deletion:', err);
  process.exit(1);
});
