-- =====================================================================
-- Computer Science Department Attendance Management System
-- Supabase / PostgreSQL schema + Row Level Security
--
-- Run this whole file in Supabase  SQL Editor -> New query  on a FRESH project.
--
-- To rebuild an existing DEVELOPMENT project from scratch first run:
--   drop schema public cascade; create schema public;
--   grant usage on schema public to postgres, anon, authenticated, service_role;
--   grant all on schema public to postgres, service_role;
--   (also delete the old users in Authentication -> Users)
--
-- SECURITY MODEL
--  * The browser (anon/authenticated keys) may only READ rows allowed by the
--    RLS policies below. It can never INSERT / UPDATE / DELETE: those table
--    privileges are revoked at the bottom of this file.
--  * Every write (registration, approvals, attendance, sessions, staff creation,
--    audit logs, notifications ...) goes through the Node.js API, which uses the
--    service-role key (server only) and applies its own validation.
-- Clean reset of public schema to eliminate any "type already exists" or "table already exists" conflicts
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

create extension if not exists pgcrypto;

create type public.app_role          as enum ('hod','lecturer','class_rep','student');
create type public.attendance_status as enum ('pending','approved','rejected','correction_requested','absent','excused','appealed');
create type public.session_status    as enum ('scheduled','open','closed','cancelled');
create type public.account_status    as enum ('pending','approved','rejected');

-- ---------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------
create table public.academic_years (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false
);
create unique index academic_years_one_current on public.academic_years (is_current) where is_current;

create table public.semesters (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  name             text not null,
  starts_on        date,
  ends_on          date,
  is_current       boolean not null default false,
  unique (academic_year_id, name)
);
create unique index semesters_one_current on public.semesters (is_current) where is_current;

create table public.profiles (
  id                       uuid primary key default gen_random_uuid(),
  auth_user_id             uuid unique references auth.users(id) on delete cascade,
  role                     public.app_role not null,
  username                 text unique,             -- staff login: LEC-0001 / REP-0001 / HOD-0001
  full_name                text not null,
  -- normalised name used for "full name + password" student login
  name_key                 text generated always as (lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g'))) stored,
  email                    text unique,             -- hidden internal auth email, never shown to users
  phone_number             text unique,             -- normalised, e.g. 23230231858
  student_id               text unique,             -- optional for students
  department               text not null default 'Computer Science',
  programme                text,
  academic_year_id         uuid references public.academic_years(id),
  level                    smallint check (level between 1 and 4),
  account_status           public.account_status not null default 'approved',
  is_active                boolean not null default true,
  must_change_password     boolean not null default false,
  temp_password_expires_at timestamptz,
  credentials_sent         boolean not null default false,
  approved_by              uuid references public.profiles(id),
  approved_at              timestamptz,
  last_login_at            timestamptz,
  avatar_url               text,
  recovery_code_hash       text,
  created_at               timestamptz not null default now(),
  constraint student_needs_class check (role <> 'student' or (programme is not null and level is not null))
);
create index profiles_name_key_idx on public.profiles (name_key) where role = 'student';
create index profiles_role_level_idx on public.profiles (role, level);

create table public.courses (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  title            text not null,
  programme        text not null default 'Degree',
  level            smallint not null check (level between 1 and 4),
  semester         smallint not null default 1 check (semester in (1, 2)),
  credit_units     smallint not null default 3 check (credit_units between 1 and 12),
  semester_id      uuid references public.semesters(id),
  academic_year_id uuid references public.academic_years(id),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.course_registrations (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.profiles(id) on delete cascade,
  course_id        uuid not null references public.courses(id),
  academic_year_id uuid references public.academic_years(id),
  semester_id      uuid references public.semesters(id),
  unique (student_id, course_id, academic_year_id, semester_id)
);
create index course_registrations_course_idx on public.course_registrations (course_id);

create table public.lecturer_courses (
  id               uuid primary key default gen_random_uuid(),
  lecturer_id      uuid not null references public.profiles(id) on delete cascade,
  course_id        uuid not null references public.courses(id),
  academic_year_id uuid references public.academic_years(id),
  semester_id      uuid references public.semesters(id),
  unique (lecturer_id, course_id, academic_year_id, semester_id)
);

-- A class representative manages exactly one class (programme + level)
create table public.class_reps (
  id               uuid primary key default gen_random_uuid(),
  rep_id           uuid not null unique references public.profiles(id) on delete cascade,
  level            smallint not null check (level between 1 and 4),
  programme        text not null,
  course_id        uuid references public.courses(id),
  academic_year_id uuid references public.academic_years(id),
  semester_id      uuid references public.semesters(id)
);

create table public.venues (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  campus_building text not null default 'Main Campus',
  latitude        double precision not null check (latitude between -90 and 90),
  longitude       double precision not null check (longitude between -180 and 180),
  radius_m        integer not null check (radius_m between 10 and 2000) default 50,
  level           smallint check (level between 1 and 4), -- optional restriction for class reps
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- day_of_week follows JavaScript: 0 = Sunday ... 6 = Saturday
create table public.timetable_entries (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.courses(id),
  level            smallint not null check (level between 1 and 4),
  programme        text not null,
  day_of_week      smallint not null check (day_of_week between 0 and 6),
  starts_at        time not null,
  ends_at          time not null,
  venue_id         uuid references public.venues(id),
  lecturer_id      uuid references public.profiles(id),
  academic_year_id uuid references public.academic_years(id),
  semester_id      uuid references public.semesters(id),
  created_by       uuid references public.profiles(id),
  check (ends_at > starts_at)
);
create index timetable_class_idx on public.timetable_entries (level, programme, day_of_week);

create table public.class_sessions (
  id                 uuid primary key default gen_random_uuid(),
  timetable_entry_id uuid not null references public.timetable_entries(id),
  lecturer_id        uuid not null references public.profiles(id),
  session_date       date not null,
  class_code         text,                 -- short-lived 6 digit code, only readable by the owning lecturer / HOD
  status             public.session_status not null default 'scheduled',
  is_open            boolean not null default false,
  opened_at          timestamptz,
  closes_at          timestamptz,          -- scheduled end + grace, or the moment the lecturer closes it
  reminder_sent      boolean not null default false,
  start_reminder_sent boolean not null default false,
  cancellation_reason text,
  rescheduled_to     timestamptz,
  finalized_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (timetable_entry_id, session_date)
);
create index class_sessions_finalize_idx on public.class_sessions (is_open, finalized_at, closes_at);

-- ---------------------------------------------------------------------
-- Attendance records
-- ---------------------------------------------------------------------
create table public.attendance_records (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.class_sessions(id),
  student_id        uuid not null references public.profiles(id),
  status            public.attendance_status not null default 'pending',
  client_timestamp  timestamptz,
  submitted_at      timestamptz not null default now(),
  synced_at         timestamptz,
  submitted_offline boolean not null default false,
  latitude          double precision,
  longitude         double precision,
  gps_accuracy_m    double precision,
  distance_m        double precision,
  method            text not null default 'code', -- 'qr' or 'code'
  qr_time_slot      bigint,                       -- 30s slot number for QR validation
  class_code_valid  boolean not null default false,
  reviewed_by       uuid references public.profiles(id),
  reviewed_at       timestamptz,
  review_note       text,
  unique (session_id, student_id)
);
create index attendance_student_idx on public.attendance_records (student_id, submitted_at desc);
create index attendance_session_idx on public.attendance_records (session_id, status);

-- ---------------------------------------------------------------------
-- Department Settings (Minimum Attendance Threshold)
-- ---------------------------------------------------------------------
create table public.department_settings (
  id                       uuid primary key default gen_random_uuid(),
  min_attendance_threshold integer not null default 75 check (min_attendance_threshold between 10 and 100),
  academic_year_id         uuid references public.academic_years(id),
  semester_id              uuid references public.semesters(id),
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Holidays & Non-teaching days
-- ---------------------------------------------------------------------
create table public.holidays (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid references public.academic_years(id) on delete cascade,
  name             text not null,
  holiday_date     date not null,
  is_teaching_day  boolean not null default false,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);
create index holidays_date_idx on public.holidays (holiday_date);

-- ---------------------------------------------------------------------
-- Excused Absence Requests
-- ---------------------------------------------------------------------
create table public.excuse_requests (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles(id) on delete cascade,
  session_id  uuid not null references public.class_sessions(id) on delete cascade,
  reason      text not null check (reason in ('illness', 'family_emergency', 'official_duty', 'other')),
  note        text,
  status      public.account_status not null default 'pending', -- pending, approved, rejected
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index excuse_requests_student_idx on public.excuse_requests (student_id);

-- ---------------------------------------------------------------------
-- Attendance Appeals (within 48 hours of rejection)
-- ---------------------------------------------------------------------
create table public.attendance_appeals (
  id              uuid primary key default gen_random_uuid(),
  record_id       uuid not null references public.attendance_records(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  reason          text not null,
  status          public.account_status not null default 'pending',
  decision_reason text,
  reviewed_by     uuid references public.profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index attendance_appeals_student_idx on public.attendance_appeals (student_id);

-- ---------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------
create table public.announcements (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid not null references public.profiles(id) on delete cascade,
  title            text not null,
  message          text not null,
  audience_type    text not null check (audience_type in ('all', 'level', 'module')),
  target_level     smallint check (target_level between 1 and 4),
  target_programme text,
  target_course_id uuid references public.courses(id),
  is_important     boolean not null default false,
  expires_at       date,
  created_at       timestamptz not null default now()
);
create index announcements_created_idx on public.announcements (created_at desc);

-- ---------------------------------------------------------------------
-- Academic Year Rollover Archives & Safety Rollback
-- ---------------------------------------------------------------------
create table public.academic_year_archives (
  id                 uuid primary key default gen_random_uuid(),
  academic_year_id   uuid not null references public.academic_years(id) on delete cascade,
  archived_at        timestamptz not null default now(),
  promoted_count     integer not null default 0,
  graduated_count    integer not null default 0,
  can_rollback_until timestamptz not null default (now() + interval '24 hours'),
  metadata           jsonb
);

create table public.audit_logs (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id),
  entity_type text not null,
  entity_id   text not null,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_entity_idx on public.audit_logs (entity_type, entity_id);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  body         text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- The HOD uploads this list; students whose ID matches are approved automatically.
create table public.student_list (
  id          uuid primary key default gen_random_uuid(),
  student_id  text unique not null,
  full_name   text not null,
  programme   text not null,
  level       smallint not null check (level between 1 and 4),
  academic_year_id uuid references public.academic_years(id),
  is_claimed  boolean not null default false,
  claimed_by  uuid references public.profiles(id)
);

-- Failed-login counters / lockouts (device, IP and account keys). Server only.
create table public.login_attempts (
  key          text primary key,
  failures     integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Sequences for staff usernames (LEC-0012, REP-0007)
-- ---------------------------------------------------------------------
create sequence public.lecturer_username_seq start 1;
create sequence public.rep_username_seq      start 1;

create or replace function public.next_staff_username(prefix text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if prefix = 'LEC' then
    return 'LEC-' || lpad(nextval('public.lecturer_username_seq')::text, 4, '0');
  elsif prefix = 'REP' then
    return 'REP-' || lpad(nextval('public.rep_username_seq')::text, 4, '0');
  end if;
  raise exception 'Unknown prefix %', prefix;
end $$;
revoke all on function public.next_staff_username(text) from public, anon, authenticated;
grant execute on function public.next_staff_username(text) to service_role;

-- ---------------------------------------------------------------------
-- Helper functions used by RLS. They are SECURITY DEFINER so that reading
-- profiles inside a policy does not recurse into the profiles policy.
-- The role is read from public.profiles (never from user-editable metadata).
-- ---------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path = public as
$$ select id from public.profiles where auth_user_id = auth.uid() and is_active limit 1 $$;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as
$$ select role from public.profiles where auth_user_id = auth.uid() and is_active limit 1 $$;

create or replace function public.current_level()
returns smallint language sql stable security definer set search_path = public as
$$ select coalesce(
     (select cr.level from public.class_reps cr join public.profiles p on p.id = cr.rep_id
        where p.auth_user_id = auth.uid() and p.is_active limit 1),
     (select level from public.profiles where auth_user_id = auth.uid() and is_active limit 1)) $$;

create or replace function public.current_programme()
returns text language sql stable security definer set search_path = public as
$$ select coalesce(
     (select cr.programme from public.class_reps cr join public.profiles p on p.id = cr.rep_id
        where p.auth_user_id = auth.uid() and p.is_active limit 1),
     (select programme from public.profiles where auth_user_id = auth.uid() and is_active limit 1)) $$;

create or replace function public.is_hod()
returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.current_app_role() = 'hod', false) $$;

-- ---------------------------------------------------------------------
-- Reporting views (server/service-role only; revoked from browser roles below)
-- ---------------------------------------------------------------------
create view public.v_attendance_by_level as
select t.level, ar.status, count(*)::int as n
from public.attendance_records ar
join public.class_sessions cs on cs.id = ar.session_id
join public.timetable_entries t on t.id = cs.timetable_entry_id
group by t.level, ar.status;

create view public.v_attendance_by_course as
select c.id as course_id, c.code, c.title, t.level, ar.status, count(*)::int as n
from public.attendance_records ar
join public.class_sessions cs on cs.id = ar.session_id
join public.timetable_entries t on t.id = cs.timetable_entry_id
join public.courses c on c.id = t.course_id
group by c.id, c.code, c.title, t.level, ar.status;

-- ---------------------------------------------------------------------
-- Row Level Security (SELECT only)
-- ---------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.academic_years       enable row level security;
alter table public.semesters            enable row level security;
alter table public.courses              enable row level security;
alter table public.course_registrations enable row level security;
alter table public.lecturer_courses     enable row level security;
alter table public.class_reps           enable row level security;
alter table public.venues               enable row level security;
alter table public.timetable_entries    enable row level security;
alter table public.class_sessions       enable row level security;
alter table public.attendance_records   enable row level security;
alter table public.department_settings  enable row level security;
alter table public.holidays             enable row level security;
alter table public.excuse_requests      enable row level security;
alter table public.attendance_appeals   enable row level security;
alter table public.announcements        enable row level security;
alter table public.academic_year_archives enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.notifications        enable row level security;
alter table public.student_list         enable row level security;
alter table public.login_attempts       enable row level security;   -- no policies = no browser access

create policy "profiles: self, hod, lecturer of the course, rep of the class" on public.profiles for select using (
  id = public.current_profile_id()
  or public.is_hod()
  or (public.current_app_role() = 'lecturer' and role = 'student' and exists (
        select 1 from public.course_registrations cr
        join public.lecturer_courses lc on lc.course_id = cr.course_id
        where cr.student_id = profiles.id and lc.lecturer_id = public.current_profile_id()))
  or (public.current_app_role() = 'class_rep' and role = 'student'
        and level = public.current_level() and programme = public.current_programme())
);

create policy "academic years: signed-in read" on public.academic_years for select using (auth.uid() is not null);
create policy "semesters: signed-in read"      on public.semesters      for select using (auth.uid() is not null);
create policy "courses: signed-in read"        on public.courses        for select using (auth.uid() is not null);
create policy "venues: signed-in read"         on public.venues         for select using (auth.uid() is not null);
create policy "settings: signed-in read"       on public.department_settings for select using (auth.uid() is not null);
create policy "holidays: signed-in read"       on public.holidays for select using (auth.uid() is not null);
create policy "announcements: signed-in read"  on public.announcements for select using (auth.uid() is not null);

create policy "registrations: own, hod, course lecturer" on public.course_registrations for select using (
  student_id = public.current_profile_id() or public.is_hod()
  or exists (select 1 from public.lecturer_courses lc
             where lc.course_id = course_registrations.course_id and lc.lecturer_id = public.current_profile_id()));

create policy "lecturer allocations: own or hod" on public.lecturer_courses for select
  using (lecturer_id = public.current_profile_id() or public.is_hod());
create policy "rep allocations: own or hod" on public.class_reps for select
  using (rep_id = public.current_profile_id() or public.is_hod());

create policy "timetable: hod, lecturer, own class" on public.timetable_entries for select using (
  public.is_hod()
  or lecturer_id = public.current_profile_id()
  or (public.current_app_role() in ('class_rep','student')
      and level = public.current_level() and programme = public.current_programme()));

-- Students never read sessions directly (they would see the class code); they use the API.
create policy "sessions: hod or owning lecturer" on public.class_sessions for select
  using (public.is_hod() or lecturer_id = public.current_profile_id());

create policy "attendance: hod, own, session lecturer" on public.attendance_records for select using (
  public.is_hod() or student_id = public.current_profile_id()
  or exists (select 1 from public.class_sessions s
             where s.id = attendance_records.session_id and s.lecturer_id = public.current_profile_id()));

create policy "excuse requests: hod, own, session lecturer" on public.excuse_requests for select using (
  public.is_hod() or student_id = public.current_profile_id()
  or exists (select 1 from public.class_sessions s
             where s.id = excuse_requests.session_id and s.lecturer_id = public.current_profile_id()));

create policy "appeals: hod, own, session lecturer" on public.attendance_appeals for select using (
  public.is_hod() or student_id = public.current_profile_id()
  or exists (select 1 from public.attendance_records ar
             join public.class_sessions s on s.id = ar.session_id
             where ar.id = attendance_appeals.record_id and s.lecturer_id = public.current_profile_id()));

create policy "archives: hod only"       on public.academic_year_archives for select using (public.is_hod());
create policy "audit: hod only"          on public.audit_logs    for select using (public.is_hod());
create policy "notifications: own"       on public.notifications for select using (recipient_id = public.current_profile_id());
create policy "student list: hod only"   on public.student_list  for select using (public.is_hod());

-- ---------------------------------------------------------------------
-- Privileges: the browser roles can read (through RLS) but never write.
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on public.profiles, public.academic_years, public.semesters, public.courses,
                public.course_registrations, public.lecturer_courses, public.class_reps,
                public.venues, public.timetable_entries, public.class_sessions,
                public.attendance_records, public.department_settings, public.holidays,
                public.excuse_requests, public.attendance_appeals, public.announcements,
                public.academic_year_archives, public.audit_logs, public.notifications,
                public.student_list
  to authenticated;

-- Ensure service_role and postgres have full administrative read/write access
grant all on schema public to postgres, service_role;
grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all routines in schema public to postgres, service_role;

alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on routines to postgres, service_role;

-- The old client-side login resolver is intentionally gone: login is done by the API.

-- ---------------------------------------------------------------------
-- FIRST HOD ACCOUNT (create the Auth user in the dashboard first, then run):
--   insert into public.profiles (auth_user_id, role, username, full_name, email, department)
--   values ('<AUTH-USER-UUID>', 'hod', 'HOD-0001', 'Head of Department', 'hod@dept.app', 'Computer Science');
-- The HOD signs in with the username HOD-0001 and the password set in Auth.
-- ---------------------------------------------------------------------
