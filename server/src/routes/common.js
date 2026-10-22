import { Router } from 'express';
import { admin } from '../supabase.js';
import { authenticate } from '../middleware.js';
import { notify } from '../services.js';
import { runFinalizeJob } from '../finalize.js';
import { safeEqual } from '../utils.js';

const router = Router();

// ------------------------------------------------------------------ in-app notifications (bell)
router.use('/notifications', authenticate);

router.get('/notifications', async (req, res) => {
  const { data, error } = await admin.from('notifications').select('id,title,body,read_at,created_at')
    .eq('recipient_id', req.profile.id).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});
router.get('/notifications/unread-count', async (req, res) => {
  const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true })
    .eq('recipient_id', req.profile.id).is('read_at', null);
  res.json({ count: count || 0 });
});
router.post('/notifications/read-all', async (req, res) => {
  await admin.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', req.profile.id).is('read_at', null);
  res.json({ ok: true });
});
router.patch('/notifications/:id/read', async (req, res) => {
  const { data, error } = await admin.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('recipient_id', req.profile.id).select('id,read_at').maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'Notification not found' });
  res.json(data);
});
router.post('/notifications/test', async (req, res) => {
  await notify(req.profile.id, '🔔 Notification Test', 'Your mobile and in-app notifications are active and working accurately!');
  res.json({ ok: true, message: 'Test notification sent' });
});

// ------------------------------------------------------------------ courses catalog (authenticated search & reference)
router.get('/courses', authenticate, async (req, res) => {
  const { data, error } = await admin.from('courses')
    .select('id,code,title,level,programme,credit_units,semester')
    .eq('is_active', true)
    .order('code');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// ------------------------------------------------------------------ scheduled job (external cron alternative)
router.post('/jobs/finalize-attendance', async (req, res) => {
  const secret = process.env.ATTENDANCE_JOB_SECRET;
  if (!secret || !safeEqual(req.get('x-job-secret') || '', secret)) return res.status(401).json({ error: 'Unauthorized job request' });
  try { res.json(await runFinalizeJob()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
