import { publicAuth, admin } from './supabase.js';

/**
 * Verifies the bearer token and loads the caller's profile.
 * Pending students are allowed through (they can log in, but `requireApproved`
 * blocks attendance); rejected / deactivated accounts are always refused.
 */
export async function authenticate(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const { data: { user } = {}, error } = await publicAuth.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired session' });
    const { data: profile } = await admin.from('profiles').select('*').eq('auth_user_id', user.id).maybeSingle();
    if (!profile) return res.status(403).json({ error: 'Profile missing' });
    if (!profile.is_active) return res.status(403).json({ error: 'This account has been deactivated' });
    if (profile.role === 'student' && profile.account_status === 'rejected')
      return res.status(403).json({ error: 'Your registration was not approved' });
    if (user?.user_metadata) {
      if (!profile.semester && user.user_metadata.semester) profile.semester = user.user_metadata.semester;
      if (!profile.academic_year && user.user_metadata.academic_year) profile.academic_year = user.user_metadata.academic_year;
      if (!profile.level && user.user_metadata.level) profile.level = user.user_metadata.level;
      if (!profile.programme && user.user_metadata.programme) profile.programme = user.user_metadata.programme;
    }
    req.user = user; req.profile = profile; req.accessToken = token;
    next();
  } catch {
    res.status(401).json({ error: 'Unable to authenticate' });
  }
}

/** Role guard: allow('hod'), allow('lecturer','hod'), allow('class_rep', 'rep') ... */
export const allow = (...roles) => (req, res, next) => {
  const userRole = (req.profile?.role || '').toLowerCase().trim();
  const matched = roles.some(r => {
    const rLower = (r || '').toLowerCase().trim();
    if (userRole === rLower) return true;
    if ((rLower === 'class_rep' || rLower === 'rep') && (userRole === 'class_rep' || userRole === 'rep')) return true;
    return false;
  });
  return matched ? next() : res.status(403).json({ error: 'Insufficient permissions' });
};

/**
 * Blocks accounts that still must change a temporary password, so a leaked temp
 * password cannot be used for anything except changing it.
 */
export function requirePasswordChanged(req, res, next) {
  if (req.profile?.must_change_password)
    return res.status(403).json({ error: 'Please change your temporary password first', code: 'MUST_CHANGE_PASSWORD' });
  next();
}

/** Students must be approved before they can use attendance features. */
export function requireApproved(req, res, next) {
  if (req.profile?.role === 'student' && req.profile.account_status !== 'approved')
    return res.status(403).json({ error: 'Your registration is awaiting approval', code: 'PENDING_APPROVAL' });
  next();
}
