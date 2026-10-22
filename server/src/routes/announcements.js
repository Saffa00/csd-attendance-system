import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { audit, notify } from '../services.js';

const router = Router();
router.use('/announcements', authenticate, requirePasswordChanged);

const announceSchema = z.object({
  title: z.string().trim().min(3).max(150),
  message: z.string().trim().min(5).max(3000),
  audience_type: z.enum(['all', 'level', 'module']),
  target_level: z.coerce.number().int().min(1).max(4).optional().nullable(),
  target_programme: z.string().trim().optional().nullable(),
  target_course_id: z.string().uuid().optional().nullable(),
  is_important: z.boolean().default(false),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
});

// GET /api/announcements : list visible announcements
router.get('/announcements', async (req, res) => {
  const profile = req.profile;
  const today = new Date().toISOString().slice(0, 10);
  let q = admin.from('announcements')
    .select('*,profiles!author_id(id,full_name,role),courses!target_course_id(code,title)')
    .order('created_at', { ascending: false });

  // Exclude expired
  q = q.or(`expires_at.is.null,expires_at.gte.${today}`);

  const { data, error } = await q.limit(100);
  if (error) return res.status(400).json({ error: error.message });

  // Filter based on role & audience
  if (profile.role === 'hod') {
    return res.json(data);
  }

  const filtered = data.filter(a => {
    if (a.author_id === profile.id) return true;
    if (a.audience_type === 'all') return true;
    if (a.audience_type === 'level') {
      return a.target_level === profile.level;
    }
    if (a.audience_type === 'module') {
      return true; // Courses filtered on frontend or matched to student's enrolled modules
    }
    return false;
  });

  res.json(filtered);
});

// POST /api/announcements : create announcement
router.post('/announcements', allow('hod', 'lecturer', 'class_rep'), async (req, res) => {
  const parsed = announceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check the form: ' + parsed.error.issues.map(i => i.path.join('.')).join(', ') });
  }

  const body = parsed.data;
  const profile = req.profile;

  // Validation according to role
  if (profile.role === 'lecturer') {
    if (body.audience_type !== 'module' || !body.target_course_id) {
      return res.status(403).json({ error: 'Lecturers can only post announcements for their assigned modules.' });
    }
  } else if (profile.role === 'class_rep') {
    if (body.audience_type !== 'level') {
      return res.status(403).json({ error: 'Class representatives can only post announcements for their assigned class level.' });
    }
    body.target_level = profile.level;
    body.target_programme = profile.programme;
  }

  const { data, error } = await admin.from('announcements')
    .insert({ ...body, author_id: profile.id })
    .select('*,profiles!author_id(id,full_name,role)')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Notify target recipients via OneSignal & in-app notifications
  let targetQuery = admin.from('profiles').select('id').eq('is_active', true);
  if (body.audience_type === 'level') {
    targetQuery = targetQuery.eq('level', body.target_level);
    if (body.target_programme) targetQuery = targetQuery.eq('programme', body.target_programme);
  }
  const { data: recipients } = await targetQuery;
  const recipientIds = (recipients || []).map(r => r.id).filter(id => id !== profile.id);

  if (recipientIds.length) {
    await notify(
      recipientIds,
      `${body.is_important ? '⚠️ IMPORTANT: ' : ''}${body.title}`,
      body.message.slice(0, 200)
    );
  }

  await audit(profile.id, 'announcement', data.id, 'created', null, data);
  res.status(201).json(data);
});

// PATCH /api/announcements/:id
router.patch('/announcements/:id', async (req, res) => {
  const { data: existing } = await admin.from('announcements').select('*').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Announcement not found' });

  if (req.profile.role !== 'hod' && existing.author_id !== req.profile.id) {
    return res.status(403).json({ error: 'You can only edit your own announcements' });
  }

  const parsed = announceSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid form data' });

  const { data, error } = await admin.from('announcements').update(parsed.data).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await audit(req.profile.id, 'announcement', data.id, 'updated', null, parsed.data);
  res.json(data);
});

// DELETE /api/announcements/:id
router.delete('/announcements/:id', async (req, res) => {
  const { data: existing } = await admin.from('announcements').select('*').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Announcement not found' });

  if (req.profile.role !== 'hod' && existing.author_id !== req.profile.id) {
    return res.status(403).json({ error: 'You can only delete your own announcements' });
  }

  const { error } = await admin.from('announcements').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });

  await audit(req.profile.id, 'announcement', req.params.id, 'deleted');
  res.json({ ok: true });
});

export default router;
