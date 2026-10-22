# Computer Science Department Attendance Management System (PWA)

A mobile-first Progressive Web App (PWA) for students (Years 1 to 4), Lecturers, Class Representatives, and the Head of Department (HOD) in the Computer Science Department.

Built with:
- **Frontend:** React (Vite) using JavaScript with JSX (no TypeScript), Lucide icons, safe-area mobile design
- **Backend:** Node.js with Express (REST API), rate limiting, device/account lockouts, PDFKit, ExcelJS
- **Database, Auth & Storage:** Supabase (PostgreSQL, Supabase Auth, Row Level Security)
- **Push Notifications:** OneSignal (in-app notifications inbox + optional Web Push sent via server API)
- **Offline Storage:** IndexedDB (Dexie.js) + Workbox service worker caching

---

## Architecture & Security Model

1. **Role-Based Access Control:**
   - Client queries Supabase directly **only for READs governed by Row Level Security (RLS)**.
   - All write operations (student registration, login authentication, staff account creation, credential reset, timetable management, attendance submission, session open/close, lecturer review, student approval, Excel/PDF exports) run through the **Node.js Express API**.
   - The Supabase **service-role key is kept exclusively on the Node.js server** and is never bundled into or accessible by the frontend.

2. **Student Registration & Login:**
   - Students register themselves: full name, student ID (optional), phone number, programme, level, and password (min 8 characters).
   - If Student ID is provided: login with `Student ID` + `Password`.
   - If Student ID is omitted: login with `Full Name` + `Password`. The API normalises names and prevents any two same-name students from having identical passwords.
   - Accounts whose Student ID matches the HOD's uploaded student list are **automatically approved**.
   - Other accounts start as **Pending** and cannot mark attendance until approved by their level's Class Representative or the HOD.
   - Repeated login failures lock out the device, account, or IP to protect against brute-force attacks.

3. **Staff Creation & WhatsApp Credentials (HOD only):**
   - HOD, Lecturers, and Class Representatives have **no self-registration screen**; all staff accounts are created by the HOD.
   - The server validates phone numbers (normalised Sierra Leone format: `232...`), generates unique usernames (`LEC-0001`, `REP-0001`), creates the auth user with a random temporary password (forced password change on first login, expires in 48 hours), and creates allocations.
   - The temporary password is never stored in readable form in any database table.
   - Direct WhatsApp delivery is provided via `https://wa.me/<normalised_phone>?text=<encodeURIComponent(message)>`.
   - The HOD can track "Credentials sent" status and use "Reset & Resend" to generate a fresh temporary password and WhatsApp link.

4. **Attendance Validation Rules:**
   - Student account must be active and approved.
   - Class session must be currently open by the lecturer and within the scheduled timetable window (plus grace period).
   - Class code must match the lecturer's one-time 6-digit session code (with failed attempt lockouts).
   - Student GPS location is checked using the Haversine distance formula against the venue's configured coordinates and radius. Poor GPS accuracy (>60m) is rejected.
   - Exactly one submission per student per session.
   - Lecturer reviews submissions: **Approve**, **Reject** (with note), or **Request Correction** (with note).
   - Bulk approval is supported.
   - When a session closes or reaches its end, students with no submission are automatically recorded as **Absent**.

5. **Offline Support (Student side):**
   - Dexie.js (IndexedDB) caches the student profile, registered courses, timetable, today's classes, and attendance history.
   - Students can mark Present offline: coordinates, GPS accuracy, timestamp, and class code are stored in an IndexedDB queue.
   - The UI displays a live **"Pending sync"** badge.
   - When the connection returns or the app is reopened, queued records sync automatically to the API.
   - The server flags synced records as `submitted_offline = true` (with `client_timestamp` and `synced_at`), and rejects submissions older than 48 hours.

---

## Project Structure

```text
cs-attendance-system/
├── cs-attendance-pwa/
│   ├── client/                  # React (Vite) PWA
│   │   ├── public/              # PWA manifest icons & OneSignal workers
│   │   ├── src/
│   │   │   ├── api.js           # API client with token & device-id injection
│   │   │   ├── auth.jsx         # AuthContext & login/profile state
│   │   │   ├── config.js        # Programmes, levels, days & status constants
│   │   │   ├── geo.js           # Geolocation helper
│   │   │   ├── offline.js       # Dexie IndexedDB cache & offline queue
│   │   │   ├── Shell.jsx        # Mobile shell, top header, bottom navigation
│   │   │   ├── style.css        # Mobile-first stylesheet
│   │   │   ├── ui.jsx           # Reusable UI widgets & hooks
│   │   │   ├── pages/
│   │   │   │   ├── Login.jsx    # Unified login (all roles)
│   │   │   │   ├── Register.jsx # Student self-registration
│   │   │   │   ├── Account.jsx  # Profile, PWA install prompt, change password
│   │   │   │   ├── Notifications.jsx # Notification inbox
│   │   │   │   ├── student.jsx  # Student Home, Timetable, Attendance, History
│   │   │   │   ├── lecturer.jsx # Lecturer Home, Courses, Sessions, Approvals, Reports
│   │   │   │   ├── rep.jsx      # Class Rep Home, Timetable, Students, Attendance
│   │   │   │   └── hod.jsx      # HOD Home, Staff, Students, Attendance, Reports, Academic Setup
│   │   │   ├── App.jsx          # Role-based routing & nav configuration
│   │   │   └── main.jsx         # App bootstrap with AuthProvider
│   │   ├── vite.config.js       # Vite PWA configuration
│   │   └── package.json
│   ├── server/                  # Node.js + Express API
│   │   ├── src/
│   │   │   ├── index.js         # Express app, security middleware & scheduler
│   │   │   ├── supabase.js      # Admin & public Supabase clients
│   │   │   ├── middleware.js    # Auth, role guard, forced password change check
│   │   │   ├── limits.js        # Rate limiters & persistent login lockouts
│   │   │   ├── services.js      # Notifications, audit log, auto-enrollment
│   │   │   ├── finalize.js      # Absent marking & session finalize engine
│   │   │   ├── utils.js         # Phone normalisation, Haversine, timezone math
│   │   │   └── routes/
│   │   │       ├── auth.js      # API login, student registration, change password
│   │   │       ├── hod.js       # Staff CRUD, student list upload, academic setup
│   │   │       ├── students.js  # Approvals & student password resets
│   │   │       ├── rep.js       # Rep overview, students, timetable CRUD
│   │   │       ├── lecturer.js  # Lecturer overview, courses, sessions
│   │   │       ├── student.js   # Student timetable, today, history, self-register
│   │   │       ├── attendance.js# Attendance submission & review
│   │   │       ├── reports.js   # ExcelJS & PDFKit report generators
│   │   │       └── common.js    # Notifications inbox & cron webhook
│   │   ├── test/
│   │   │   └── utils.test.js    # Automated unit tests
│   │   └── package.json
│   └── supabase/
│       └── schema.sql           # Complete PostgreSQL schema & RLS policies
```

---

## Getting Started

### 1. Database Setup (Supabase)
1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor → New query**.
3. Paste the entire content of `cs-attendance-pwa/supabase/schema.sql` and run it.
4. Create the initial HOD account:
   - In **Authentication → Users → Add user**, create an email user (e.g. `hod@dept.app`) with a secure password and confirm the email.
   - Copy the generated User UID.
   - In SQL Editor, run:
     ```sql
     insert into public.profiles (auth_user_id, role, username, full_name, email, department, account_status, is_active)
     values ('<USER-UID-HERE>', 'hod', 'HOD-0001', 'Head of Department', 'hod@dept.app', 'Computer Science', 'approved', true);
     ```

### 2. Configure & Start Backend
```bash
cd cs-attendance-pwa/server
npm install
```
Copy `.env.example` to `.env`:
```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
TRUST_PROXY=0

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

APP_LOGIN_URL=http://localhost:5173/login

ONESIGNAL_APP_ID=
ONESIGNAL_REST_API_KEY=

APP_TIMEZONE=Africa/Freetown
GPS_MAX_ACCURACY_METERS=60
ATTENDANCE_GRACE_MINUTES=10
TEMP_PASSWORD_HOURS=48
LOGIN_LOCK_MINUTES=15
AUTO_FINALIZE=true
ATTENDANCE_JOB_SECRET=your-random-cron-secret
# QR Code Attendance Signing Secret (>= 32 characters)
QR_SECRET=replace_with_a_64_character_random_hex_string
```

#### QR Code Attendance Signing Secret (`QR_SECRET`)
The backend uses HMAC-SHA256 signing for real-time QR attendance tokens. The `QR_SECRET` variable must be at least 32 characters long, and the server will refuse to start if it is missing or too short.

- **Generate a secret**:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Local setup**: Paste the output as `QR_SECRET=<generated_hex>` in `cs-attendance-pwa/server/.env`.
- **Hosting setup (Render, Railway, etc.)**: Add `QR_SECRET` as an environment variable in your service dashboard under **Environment Variables**.
- **Security best practices**:
  - **Never** commit `server/.env` to source control.
  - **Never** expose `QR_SECRET` to the frontend client or in API responses.
  - Always use **different secrets** for development and production environments.
  - If `QR_SECRET` is ever compromised or exposed, rotate it immediately in your hosting settings and restart the backend. All active sessions will require newly signed tokens.

Run tests & start the server:
```bash
npm test
npm run check
npm run dev
```

### 3. Configure & Start Frontend
```bash
cd cs-attendance-pwa/client
npm install
```
Copy `.env.example` to `.env`:
```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
VITE_API_URL=http://localhost:4000/api
VITE_APP_NAME="Computer Science Department Attendance Management System"
VITE_ONESIGNAL_APP_ID=
```
Start Vite development server:
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Role-Specific Navigation & Capabilities

| Role | Bottom Navigation Bar | Primary Functions |
|---|---|---|
| **Student** | Home, Timetable, Attendance, History, Profile | Mark Present (online/offline with GPS verification), view today's classes, view personal attendance %, register for courses. |
| **Lecturer** | Home, Courses, Sessions, Approvals, Reports | Open class sessions with live 6-digit code, close sessions, review submissions (Approve, Reject with note, Request Correction), export PDF/Excel course reports. |
| **Class Rep** | Home, Timetable, Students, Attendance, Profile | Manage class timetable (detecting venue/lecturer clashes), view student roster with attendance %, approve/reject pending student registrations for their level, reset student passwords. |
| **HOD** | Home, Lecturers, Reps, Attendance, Reports | Department overview, register staff with direct WhatsApp link, upload auto-approval student ID list, filter departmental attendance, export department reports to PDF & Excel, manage academic years/semesters/courses/venues. |
