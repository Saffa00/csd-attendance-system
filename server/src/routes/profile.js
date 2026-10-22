import { Router } from 'express';
import { admin } from '../supabase.js';
import { authenticate } from '../middleware.js';
import { audit } from '../services.js';

const router = Router();

router.use('/profile', authenticate);

router.post('/profile/avatar', async (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Please provide an image' });
  }

  // Parse data URL: data:image/jpeg;base64,....
  const match = image.match(/^data:(image\/(jpeg|jpg|png|webp));base64,(.+)$/i);
  let buffer;
  let mimeType = 'image/jpeg';
  if (match) {
    mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    buffer = Buffer.from(match[3], 'base64');
  } else {
    try {
      buffer = Buffer.from(image, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid image data' });
    }
  }

  // Limit file size to 5MB (client compresses down to ~50-100KB)
  if (buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image too large. Please select a photo under 5MB.' });
  }

  const fileName = `${req.profile.id}.jpg`;
  const { error: uploadError } = await admin.storage
    .from('avatars')
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true
    });

  if (uploadError) {
    console.error('Avatar upload error:', uploadError.message);
    return res.status(500).json({ error: 'Failed to save avatar image' });
  }

  const { data: pubData } = admin.storage.from('avatars').getPublicUrl(fileName);
  const avatarUrl = `${pubData.publicUrl}?t=${Date.now()}`;

  // 1. Save in Auth user_metadata
  if (req.profile.auth_user_id) {
    try {
      await admin.auth.admin.updateUserById(req.profile.auth_user_id, {
        user_metadata: { avatar_url: avatarUrl }
      });
    } catch (e) {
      console.warn('Failed to update auth user_metadata:', e.message);
    }
  }

  // 2. Also save to public.profiles if column exists
  try {
    await admin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', req.profile.id);
  } catch (e) {
    // Column might not exist yet if table wasn't altered
  }

  await audit(req.profile.id, 'profile', req.profile.id, 'avatar_updated');

  res.json({ ok: true, avatar_url: avatarUrl });
});

router.delete('/profile/avatar', async (req, res) => {
  const fileName = `${req.profile.id}.jpg`;
  try {
    await admin.storage.from('avatars').remove([fileName]);
  } catch (e) {
    console.warn('Avatar delete error:', e.message);
  }

  if (req.profile.auth_user_id) {
    try {
      await admin.auth.admin.updateUserById(req.profile.auth_user_id, {
        user_metadata: { avatar_url: null }
      });
    } catch (e) {
      console.warn('Failed to clear auth user_metadata:', e.message);
    }
  }

  try {
    await admin.from('profiles').update({ avatar_url: null }).eq('id', req.profile.id);
  } catch (e) {}

  await audit(req.profile.id, 'profile', req.profile.id, 'avatar_removed');

  res.json({ ok: true, avatar_url: null });
});

export default router;
