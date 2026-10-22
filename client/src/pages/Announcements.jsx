import { useState, useEffect } from 'react';
import { Megaphone, Plus, AlertTriangle, Calendar, User, BookOpen, Trash2, Edit2, WifiOff } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { cachedGet } from '../offline';
import { Loading, Empty, Modal } from '../ui';

export default function Announcements() {
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [courses, setCourses] = useState([]);

  const isHod = profile.role === 'hod';
  const isLecturer = profile.role === 'lecturer';
  const isRep = profile.role === 'class_rep';
  const canPost = isHod || isLecturer || isRep;

  const defaultForm = {
    title: '',
    message: '',
    audience_type: isHod ? 'all' : isLecturer ? 'module' : 'level',
    target_level: isRep ? profile.level : 1,
    target_programme: isRep ? profile.programme : 'degree',
    target_course_id: '',
    is_important: false,
    expires_at: ''
  };

  const [form, setForm] = useState(defaultForm);

  const load = async () => {
    try {
      setLoading(true);
      if (profile.role === 'student') {
        const { data, fromCache } = await cachedGet(profile.id, 'announcements', '/announcements');
        setItems(data || []);
        setIsOffline(fromCache);
      } else {
        const data = await apiFetch('/announcements');
        setItems(data || []);
        setIsOffline(false);
      }
    } catch (e) {
      console.error('Failed to load announcements:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (canPost) {
      if (isLecturer) {
        apiFetch('/lecturer/courses').then(data => setCourses(data || [])).catch(() => {});
      } else if (isHod) {
        apiFetch('/hod/options').then(data => setCourses(data?.courses || [])).catch(() => {});
      }
    }
  }, []);

  const openNew = () => {
    setForm(defaultForm);
    setShowModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        audience_type: form.audience_type,
        target_level: form.audience_type === 'level' ? Number(form.target_level) : null,
        target_programme: form.audience_type === 'level' ? form.target_programme : null,
        target_course_id: form.audience_type === 'module' && form.target_course_id ? form.target_course_id : null,
        is_important: form.is_important,
        expires_at: form.expires_at || null
      };

      await apiFetch('/announcements', { method: 'POST', body: payload });
      setShowModal(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return;
    try {
      await apiFetch(`/announcements/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Announcements & Notices</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            Department notices, timetable updates, and official communications
          </p>
        </div>
        {canPost && (
          <button className="primary" onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> New Post
          </button>
        )}
      </div>

      {isOffline && (
        <div className="card" style={{ background: '#fffbeb', borderColor: '#fde68a', color: '#92400e', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <WifiOff size={16} />
          <span>You are viewing cached announcements in offline mode.</span>
        </div>
      )}

      {loading ? (
        <Loading text="Loading announcements…" />
      ) : items.length === 0 ? (
        <Empty title="No Announcements" message="There are no active notices for your programme or courses." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {items.map(item => {
            const author = item.profiles?.full_name || 'Department Admin';
            const authorRole = item.profiles?.role?.toUpperCase() || 'HOD';
            const course = item.courses ? `${item.courses.code} - ${item.courses.title}` : null;

            return (
              <div
                key={item.id}
                className="card"
                style={{
                  borderLeft: item.is_important ? '4px solid #ef4444' : '4px solid var(--primary)',
                  position: 'relative'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.is_important && (
                      <span className="pill danger" style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={11} /> IMPORTANT
                      </span>
                    )}
                    <span className="pill neutral" style={{ fontSize: 10 }}>
                      {item.audience_type === 'all' ? 'All Students & Staff' : item.audience_type === 'level' ? `Level ${item.target_level}` : course || 'Module'}
                    </span>
                  </div>

                  {(isHod || item.author_id === profile.id) && (
                    <button
                      className="icon-btn"
                      onClick={() => remove(item.id)}
                      title="Delete Announcement"
                      style={{ color: '#ef4444', padding: 4 }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>{item.title}</h3>
                <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-line', color: 'var(--text-color, #1e293b)' }}>
                  {item.message}
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--muted)', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <User size={12} /> {author} ({authorRole})
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Calendar size={12} /> {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <Modal title="Post Department Announcement" onClose={() => setShowModal(false)}>
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Title</label>
              <input
                type="text"
                className="input-field"
                required
                placeholder="e.g. Schedule Revision for CS301"
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Message Content</label>
              <textarea
                className="input-field"
                required
                rows={5}
                style={{ height: 'auto', padding: '10px 14px' }}
                placeholder="Type the announcement details here…"
                value={form.message}
                onChange={e => setForm({ ...form, message: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Target Audience</label>
                <select
                  className="input-field"
                  value={form.audience_type}
                  disabled={isRep || isLecturer}
                  onChange={e => setForm({ ...form, audience_type: e.target.value })}
                >
                  {isHod && <option value="all">Whole Department</option>}
                  {(isHod || isRep) && <option value="level">Specific Academic Level</option>}
                  {(isHod || isLecturer) && <option value="module">Specific Module / Course</option>}
                </select>
              </div>

              {form.audience_type === 'level' && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Target Level</label>
                  <select
                    className="input-field"
                    disabled={isRep}
                    value={form.target_level}
                    onChange={e => setForm({ ...form, target_level: e.target.value })}
                  >
                    <option value="1">Year 1</option>
                    <option value="2">Year 2</option>
                    <option value="3">Year 3</option>
                    <option value="4">Year 4</option>
                  </select>
                </div>
              )}

              {form.audience_type === 'module' && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Course / Module</label>
                  <select
                    className="input-field"
                    required
                    value={form.target_course_id}
                    onChange={e => setForm({ ...form, target_course_id: e.target.value })}
                  >
                    <option value="">Select Module…</option>
                    {courses.map(c => {
                      const id = c.id || c.course_id;
                      const code = c.code || c.courses?.code;
                      const title = c.title || c.courses?.title;
                      return <option key={id} value={id}>{code} - {title}</option>;
                    })}
                  </select>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc', padding: 10, borderRadius: 8 }}>
              <input
                type="checkbox"
                id="is_important"
                checked={form.is_important}
                onChange={e => setForm({ ...form, is_important: e.target.checked })}
              />
              <label htmlFor="is_important" style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Flag as Important (Sends High-Priority Push Notification)
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Publish Announcement
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
