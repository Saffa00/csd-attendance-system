import 'dotenv/config';
import { admin } from './supabase.js';

async function main() {
  const email = process.argv[2] || 'hod@dept.mmtu.edu.sl';
  const password = process.argv[3] || 'MMTU@HOD2026';
  const fullName = process.argv[4] || 'Head of Department';

  console.log(`\nSetting up initial HOD account...`);
  console.log(`Email: ${email}`);
  console.log(`Username: HOD-0001`);
  console.log(`Name: ${fullName}\n`);

  // 1. Create or retrieve Auth User
  let authUserId;
  const { data: users, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    console.error('Failed to list users:', listErr.message);
    process.exit(1);
  }

  const existing = users.users.find(u => u.email === email);
  if (existing) {
    console.log(`Auth user already exists (${existing.id}), updating password...`);
    authUserId = existing.id;
    await admin.auth.admin.updateUserById(authUserId, { password, email_confirm: true });
  } else {
    console.log(`Creating new Supabase Auth user...`);
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
    if (createErr) {
      console.error('Failed to create auth user:', createErr.message);
      process.exit(1);
    }
    authUserId = newUser.user.id;
  }

  // 2. Insert or update profile in public.profiles
  const profilePayload = {
    auth_user_id: authUserId,
    role: 'hod',
    username: 'HOD-0001',
    full_name: fullName,
    email: email,
    department: 'Computer Science',
    account_status: 'approved',
    is_active: true,
    must_change_password: false
  };

  const { data: profile, error: pErr } = await admin.from('profiles')
    .upsert(profilePayload, { onConflict: 'auth_user_id' })
    .select()
    .single();

  if (pErr) {
    console.error('Failed to save HOD profile:', pErr.message);
    process.exit(1);
  }

  console.log('========================================================');
  console.log('✅ HOD ACCOUNT SUCCESSFULLY CREATED / CONFIGURED');
  console.log('========================================================');
  console.log(`Username: HOD-0001`);
  console.log(`Password: ${password}`);
  console.log(`Email:    ${email}`);
  console.log(`Role:     HOD (Head of Department)`);
  console.log('========================================================');
  console.log('You can now log in at http://localhost:5173 with:');
  console.log('  Login ID: HOD-0001');
  console.log(`  Password: ${password}`);
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
