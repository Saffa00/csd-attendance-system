import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth.js';
import hodRoutes from './routes/hod.js';
import studentAdminRoutes from './routes/students.js';
import repRoutes from './routes/rep.js';
import lecturerRoutes from './routes/lecturer.js';
import studentRoutes from './routes/student.js';
import attendanceRoutes from './routes/attendance.js';
import reportRoutes from './routes/reports.js';
import commonRoutes from './routes/common.js';
import venuesRoutes from './routes/venues.js';
import announcementsRoutes from './routes/announcements.js';
import excusesRoutes from './routes/excuses.js';
import profileRoutes from './routes/profile.js';
import { runFinalizeJob, runSessionRemindersJob, ensureSemesterSessions, runSessionLifecycleJob } from './finalize.js';

for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CLIENT_ORIGIN']) {
  if (!process.env[k]) { console.error(`Missing required environment variable ${k} (see server/.env.example)`); process.exit(1); }
}

if (!process.env.QR_SECRET || process.env.QR_SECRET.trim().length < 32) {
  console.error('Fatal: QR_SECRET environment variable is missing or shorter than 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const app = express();
// Behind Render/Railway/Nginx set TRUST_PROXY=1 so rate limits and lockouts see the real client IP.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 0));
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_ORIGIN.split(',').map(s => s.trim()),
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id'],
  exposedHeaders: ['Content-Disposition']
}));
// The student-list upload is the only large payload (CSV rows as JSON).
app.use('/api/hod/student-list', express.json({ limit: '2mb' }));
app.use('/api/profile/avatar', express.json({ limit: '5mb' }));
app.use('/api/auth/register', express.json({ limit: '5mb' }));
app.use(['/api/venues/:id/image', '/api/venues/upload-image'], express.json({ limit: '5mb' }));
app.use(express.json({ limit: '30kb' }));

app.get('/', (_, res) => res.json({
  service: 'CS Department Attendance System API',
  status: 'online',
  health: '/health',
  docs: 'Use /api routes for departmental requests'
}));
app.get('/health', (_, res) => res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() }));
app.use('/api', authRoutes, hodRoutes, studentAdminRoutes, repRoutes, lecturerRoutes, studentRoutes, attendanceRoutes, reportRoutes, commonRoutes, venuesRoutes, announcementsRoutes, excusesRoutes, profileRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('API error:', err.message);   // never log request bodies (they can contain passwords)
  if (res.headersSent) return next(err);
  res.status(err.type === 'entity.too.large' ? 413 : 500).json({ error: err.type === 'entity.too.large' ? 'Request too large' : 'Internal server error' });
});

const port = process.env.PORT || 4000;
// Server entry listener
app.listen(port, () => console.log(`API listening on ${port}`));

// Built-in scheduler: automatically manages class sessions lifecycle, auto-opening, auto-closing and absent marking.
if (process.env.AUTO_FINALIZE !== 'false') {
  const tickLifecycle = () => runSessionLifecycleJob().catch(e => console.error('Session lifecycle job failed:', e.message));
  const tickReminders = () => runSessionRemindersJob().catch(e => console.error('Reminders job failed:', e.message));
  const tickEnsureSessions = () => ensureSemesterSessions().catch(e => console.error('Ensure sessions job failed:', e.message));

  // Run lifecycle check every minute
  setInterval(tickLifecycle, 60 * 1000);
  setTimeout(tickLifecycle, 5 * 1000);

  // Check class start (5-min) and ending (20-min) session reminders every 30 seconds for high accuracy
  setInterval(tickReminders, 30 * 1000);
  setTimeout(tickReminders, 5 * 1000);

  // Sync / ensure semester sessions every 6 hours
  setInterval(tickEnsureSessions, 6 * 3600 * 1000);
  setTimeout(tickEnsureSessions, 2 * 1000);
}

