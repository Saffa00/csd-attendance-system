import { Router } from 'express';
import { z } from 'zod';
import { admin } from '../supabase.js';
import { authenticate, allow, requirePasswordChanged } from '../middleware.js';
import { audit } from '../services.js';

const router = Router();
router.use('/venues', authenticate, requirePasswordChanged);

const venueSchema = z.object({
  name: z.string().trim().min(2).max(100),
  campus_building: z.string().trim().min(2).max(100).default('Main Campus'),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(10).max(2000).default(50),
  level: z.coerce.number().int().min(1).max(4).optional().nullable(),
  is_active: z.boolean().optional().default(true)
});

// GET /api/venues : list venues
// HOD sees all; Class Rep sees venues matching their assigned level or common venues; Lecturer/Student see active venues
router.get('/venues', async (req, res) => {
  const role = req.profile.role;
  let q = admin.from('venues').select('*').order('name');

  if (role === 'student' || role === 'lecturer') {
    q = q.eq('is_active', true);
  } else if (role === 'class_rep') {
    // Reps see their level or unassigned/common venues
    const repLevel = req.profile.level;
    q = q.or(`level.eq.${repLevel},level.is.null`);
  }

  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  // Attach custom uploaded venue images from Supabase storage
  let fileMap = new Map();
  try {
    const { data: files } = await admin.storage.from('venues').list();
    if (files) {
      files.forEach(f => {
        const idKey = f.name.replace(/\.[^.]+$/, '');
        const { data: pubData } = admin.storage.from('venues').getPublicUrl(f.name);
        fileMap.set(idKey, `${pubData.publicUrl}?t=${new Date(f.updated_at || Date.now()).getTime()}`);
      });
    }
  } catch (err) {
    console.warn('Could not list venue storage files:', err.message);
  }

  const mapped = (data || []).map(v => ({
    ...v,
    image_url: fileMap.get(`venue_${v.id}`) || fileMap.get(v.id) || null
  }));

  res.json(mapped);
});

// POST /api/venues : create venue (HOD or Class Rep)
router.post('/venues', allow('hod', 'class_rep'), async (req, res) => {
  const parsed = venueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check the form: ' + parsed.error.issues.map(i => i.path.join('.')).join(', ') });
  }

  const row = parsed.data;
  // Class rep can only create venues for their own level
  if (req.profile.role === 'class_rep') {
    row.level = req.profile.level;
  }

  const { data, error } = await admin.from('venues').insert(row).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await audit(req.profile.id, 'venue', data.id, 'created', null, data);
  res.status(201).json(data);
});

// POST /api/venues/:id/image : HOD uploads a photo for a venue
router.post('/venues/:id/image', allow('hod'), async (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Please provide an image to upload.' });
  }

  const match = image.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i);
  const mimeType = match ? (match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()) : 'image/jpeg';
  const buffer = match ? Buffer.from(match[3], 'base64') : Buffer.from(image, 'base64');

  if (buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Venue photo must not exceed 5 MB.' });
  }

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const fileName = `venue_${req.params.id}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from('venues')
    .upload(fileName, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) {
    return res.status(500).json({ error: `Upload failed: ${uploadError.message}` });
  }

  const { data: pubData } = admin.storage.from('venues').getPublicUrl(fileName);
  const imageUrl = `${pubData.publicUrl}?t=${Date.now()}`;

  await audit(req.profile.id, 'venue', req.params.id, 'photo_uploaded', null, { fileName, imageUrl });
  res.json({ ok: true, image_url: imageUrl });
});

// DELETE /api/venues/:id/image : HOD removes custom venue photo (reverts to default)
router.delete('/venues/:id/image', allow('hod'), async (req, res) => {
  const fileNames = [`venue_${req.params.id}.jpg`, `venue_${req.params.id}.png`, `venue_${req.params.id}.webp`, `${req.params.id}.jpg`];
  await admin.storage.from('venues').remove(fileNames).catch(() => {});
  await audit(req.profile.id, 'venue', req.params.id, 'photo_removed');
  res.json({ ok: true });
});

// PATCH /api/venues/:id : edit venue (HOD or Class Rep)
router.patch('/venues/:id', allow('hod', 'class_rep'), async (req, res) => {
  const parsed = venueSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Please check the form: ' + parsed.error.issues.map(i => i.path.join('.')).join(', ') });
  }

  // If class rep, verify this venue belongs to their level
  if (req.profile.role === 'class_rep') {
    const { data: v } = await admin.from('venues').select('level').eq('id', req.params.id).maybeSingle();
    if (!v || v.level !== req.profile.level) {
      return res.status(403).json({ error: 'You can only edit venues assigned to your class level.' });
    }
  }

  const { data, error } = await admin.from('venues').update(parsed.data).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await audit(req.profile.id, 'venue', data.id, 'updated', null, parsed.data);
  res.json(data);
});

export default router;
