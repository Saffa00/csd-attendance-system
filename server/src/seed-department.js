import { admin } from './supabase.js';

async function seed() {
  console.log('Seeding department data for MMTU Computer Science Department...');

  // 1. Department Settings
  try {
    await admin.from('department_settings').upsert({
      id: 1,
      min_attendance_threshold: 75,
      gps_required: true,
      allow_offline: true,
      timezone: 'Africa/Freetown'
    });
  } catch (_) {}

  // 2. Academic Year
  let { data: year } = await admin.from('academic_years').select('id,name').eq('name', '2025/2026 Academic Year').maybeSingle();
  if (!year) {
    const { data: newYear, error: yErr } = await admin.from('academic_years').insert({
      name: '2025/2026 Academic Year',
      starts_on: '2025-09-01',
      ends_on: '2026-07-31',
      is_current: true
    }).select().single();
    if (yErr) console.error('Year error:', yErr);
    year = newYear;
  }
  console.log('Academic Year:', year?.name);

  // 3. Semester
  let { data: semester } = await admin.from('semesters').select('id,name').eq('name', 'First Semester').maybeSingle();
  if (!semester && year) {
    const { data: newSem, error: sErr } = await admin.from('semesters').insert({
      academic_year_id: year.id,
      name: 'First Semester',
      starts_on: '2025-09-15',
      ends_on: '2026-02-15',
      is_current: true
    }).select().single();
    if (sErr) console.error('Sem error:', sErr);
    semester = newSem;
  }
  console.log('Semester:', semester?.name);

  // 4. Venues
  const venueList = [
    { name: 'Computer Lab 1 (Software Lab)', latitude: 8.4657, longitude: -13.2317, radius_m: 80 },
    { name: 'Computer Lab 2 (Main Campus)', latitude: 8.4658, longitude: -13.2319, radius_m: 80 },
    { name: 'Lecture Hall B (Faculty of Tech)', latitude: 8.4655, longitude: -13.2315, radius_m: 100 },
    { name: 'Hardware & Networking Lab', latitude: 8.4659, longitude: -13.2318, radius_m: 80 }
  ];
  for (const v of venueList) {
    const { data: existing } = await admin.from('venues').select('id').eq('name', v.name).maybeSingle();
    if (!existing) {
      await admin.from('venues').insert(v);
    }
  }
  const { data: venues } = await admin.from('venues').select('id,name');
  console.log('Venues seeded:', venues?.length);

  // 5. Ensure Lecturer exists
  const { data: hod } = await admin.from('profiles').select('id,full_name').eq('role', 'hod').maybeSingle();
  const lecturerId = hod?.id;

  // 6. Courses for Level 1 Degree
  const coursesToSeed = [
    { code: 'COMS 111', title: 'Introduction to Computer Science & Problem Solving', credit_units: 3, level: 1, programme: 'Degree', semester: 1 },
    { code: 'COMS 112', title: 'Structured Programming in C/C++', credit_units: 4, level: 1, programme: 'Degree', semester: 1 },
    { code: 'COMS 113', title: 'Discrete Mathematics & Computing Logic', credit_units: 3, level: 1, programme: 'Degree', semester: 1 },
    { code: 'COMS 114', title: 'Computer Hardware & Digital Electronics', credit_units: 3, level: 1, programme: 'Degree', semester: 1 },
    { code: 'COMS 115', title: 'Communication Skills & Computing Ethics', credit_units: 2, level: 1, programme: 'Degree', semester: 1 },
    { code: 'COMS 116', title: 'Information Literacy & Internet Technologies', credit_units: 3, level: 1, programme: 'Degree', semester: 1 }
  ];

  for (const c of coursesToSeed) {
    const { data: existing } = await admin.from('courses').select('id').eq('code', c.code).maybeSingle();
    if (!existing) {
      await admin.from('courses').insert({
        ...c,
        semester_id: semester?.id || null,
        academic_year_id: year?.id || null,
        is_active: true
      });
    }
  }
  const { data: seededCourses } = await admin.from('courses').select('id,code,title').eq('level', 1);
  console.log('Courses seeded for Level 1:', seededCourses?.length);

  // 7. Timetable entries for Level 1 Degree
  // Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5
  const todayDow = new Date().getDay();
  const lab1 = venues?.find(v => v.name.includes('Lab 1'))?.id || venues?.[0]?.id;
  const lab2 = venues?.find(v => v.name.includes('Lab 2'))?.id || venues?.[1]?.id;
  const hallB = venues?.find(v => v.name.includes('Hall B'))?.id || venues?.[2]?.id;

  if (seededCourses && seededCourses.length >= 4) {
    const ttEntries = [
      // Today's classes!
      {
        course_id: seededCourses[0].id,
        lecturer_id: lecturerId,
        day_of_week: todayDow,
        starts_at: '09:00:00',
        ends_at: '11:00:00',
        venue_id: lab1,
        level: 1,
        programme: 'Degree'
      },
      {
        course_id: seededCourses[1].id,
        lecturer_id: lecturerId,
        day_of_week: todayDow,
        starts_at: '11:30:00',
        ends_at: '13:30:00',
        venue_id: hallB,
        level: 1,
        programme: 'Degree'
      },
      {
        course_id: seededCourses[2].id,
        lecturer_id: lecturerId,
        day_of_week: (todayDow + 1) % 7,
        starts_at: '10:00:00',
        ends_at: '12:00:00',
        venue_id: lab2,
        level: 1,
        programme: 'Degree'
      },
      {
        course_id: seededCourses[3].id,
        lecturer_id: lecturerId,
        day_of_week: (todayDow + 2) % 7,
        starts_at: '14:00:00',
        ends_at: '16:00:00',
        venue_id: hallB,
        level: 1,
        programme: 'Degree'
      }
    ];

    for (const entry of ttEntries) {
      const { data: existing } = await admin.from('timetable_entries').select('id')
        .eq('course_id', entry.course_id)
        .eq('day_of_week', entry.day_of_week)
        .eq('starts_at', entry.starts_at)
        .maybeSingle();

      if (!existing) {
        await admin.from('timetable_entries').insert({
          ...entry,
          academic_year_id: year?.id || null,
          semester_id: semester?.id || null
        });
      }
    }
  }

  // 8. Open a class session for today so "Mark Present" is active and testable!
  const todayDate = new Date().toISOString().slice(0, 10);
  const { data: todayTT } = await admin.from('timetable_entries').select('id').eq('day_of_week', todayDow).limit(1).maybeSingle();
  let session = null;
  if (todayTT) {
    const { data: existingSession } = await admin.from('class_sessions').select('id').eq('timetable_entry_id', todayTT.id).eq('session_date', todayDate).maybeSingle();
    if (!existingSession) {
      const { data: newSess } = await admin.from('class_sessions').insert({
        timetable_entry_id: todayTT.id,
        session_date: todayDate,
        lecturer_id: lecturerId,
        is_open: true,
        class_code: '482910',
        status: 'open',
        opened_at: new Date().toISOString(),
        closes_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString()
      }).select().single();
      session = newSess;
      console.log('Opened class session with code 482910 for today!');
    } else {
      await admin.from('class_sessions').update({ is_open: true, class_code: '482910' }).eq('id', existingSession.id);
      session = existingSession;
      console.log('Updated existing class session to open with code 482910');
    }
  }

  // 9. Seed attendance records for Peter Saffa
  const { data: student } = await admin.from('profiles').select('id').eq('role', 'student').limit(1).maybeSingle();
  if (student && session) {
    const { data: existingRec } = await admin.from('attendance_records').select('id').eq('student_id', student.id).limit(1).maybeSingle();
    if (!existingRec) {
      // Create past sessions and records
      const pastRecords = [
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'approved' },
        { status: 'pending' },
        { status: 'pending' },
        { status: 'absent' }
      ];

      for (let i = 0; i < pastRecords.length; i++) {
        await admin.from('attendance_records').insert({
          session_id: session.id,
          student_id: student.id,
          status: pastRecords[i].status,
          submitted_at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
          client_timestamp: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
          latitude: 8.4657,
          longitude: -13.2317,
          distance_m: 12
        });
      }
      console.log('Seeded sample attendance records for student (12 approved, 2 pending, 1 absent -> 86% rate)!');
    }
  }

  // 10. Seed Announcement
  const { data: existingNotice } = await admin.from('announcements').select('id').limit(1).maybeSingle();
  if (!existingNotice) {
    await admin.from('announcements').insert({
      author_id: lecturerId,
      title: 'Commencement of Semester Attendance & 75% Requirement',
      message: 'Welcome to the First Semester. Please be reminded that university regulations strictly enforce a minimum 75% attendance threshold for eligibility to sit final examinations. Ensure you mark your attendance promptly in every scheduled lecture.',
      audience_type: 'all',
      is_important: true
    });
    console.log('Seeded department announcement from HOD.');
  }

  console.log('Seeding completed successfully!');
}

seed().catch(console.error);
