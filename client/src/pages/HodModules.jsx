import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, Plus, Check, X, Edit, Users, Trash2, ShieldCheck,
  GraduationCap, Code, FileText, Layers, Hash, Calendar, ChevronRight,
  ChevronDown, Sparkles
} from 'lucide-react';
import { apiFetch } from '../api';
import {
  PROGRAMME_TYPES, DEPT_COURSES, getLevelsForProgramme,
  PROGRAMMES, PROGRAMME_LABELS, LEVEL_LABELS, SEMESTERS, SEMESTER_LABELS
} from '../config';
import { Badge, Empty, ErrorText, Loading, Panel, Success, useAction } from '../ui';

export default function HodModules() {
  const [courses, setCourses] = useState([]);
  const [lecturers, setLecturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Form state strictly matching the user mockup
  const [form, setForm] = useState({
    programme: 'Degree',
    course: 'Computer Science',
    code: '',
    title: '',
    level: 1,
    credit_units: 3,
    semester: 1,
    is_active: true,
    lecturer_ids: []
  });

  const { busy, error, ok, run, setOk, setError } = useAction();

  const loadData = async () => {
    try {
      setLoading(true);
      const [coursesData, staffData] = await Promise.all([
        apiFetch('/hod/courses'),
        apiFetch('/staff?role=lecturer')
      ]);
      setCourses(coursesData || []);
      setLecturers(staffData || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLecturerToggle = lecturerId => {
    setForm(prev => {
      const exists = prev.lecturer_ids.includes(lecturerId);
      return {
        ...prev,
        lecturer_ids: exists
          ? prev.lecturer_ids.filter(id => id !== lecturerId)
          : [...prev.lecturer_ids, lecturerId]
      };
    });
  };

  const startEdit = c => {
    setEditingId(c.id);
    const assignedIds = (c.lecturer_courses || []).map(lc => lc.lecturer_id);
    const progs = c.programmes?.length
      ? c.programmes
      : c.programme
      ? c.programme.split(',').map(s => s.trim())
      : ['Computer Science'];

    const progType = progs.find(p => ['Degree', 'Diploma', 'HND'].includes(p)) || 'Degree';
    const courseDisc = progs.find(p => ['Computer Science', 'Business Information Systems', 'BIT', 'Software Engineering'].includes(p))
      || (c.programme && !['Degree', 'Diploma', 'HND'].includes(c.programme) ? c.programme : 'Computer Science');

    setForm({
      programme: progType,
      course: courseDisc === 'BIT' ? 'Business Information Systems' : courseDisc,
      code: c.code,
      title: c.title,
      level: c.level || 1,
      credit_units: c.credit_units || 3,
      semester: c.semester || 1,
      is_active: c.is_active ?? true,
      lecturer_ids: assignedIds
    });
    setShowCreate(true);
    setError('');
    setOk('');
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({
      programme: 'Degree',
      course: 'Computer Science',
      code: '',
      title: '',
      level: 1,
      credit_units: 3,
      semester: 1,
      is_active: true,
      lecturer_ids: []
    });
    setShowCreate(false);
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.code.trim() || !form.title.trim()) {
      return setError('Please enter both Module Code and Title.');
    }

    await run('save', async () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        title: form.title.trim(),
        programme: form.course,
        programmes: [form.course, form.programme],
        level: Number(form.level),
        semester: Number(form.semester),
        credit_units: Number(form.credit_units) || 3,
        is_active: Boolean(form.is_active),
        lecturer_ids: form.lecturer_ids || []
      };

      if (editingId) {
        await apiFetch(`/hod/courses/${editingId}`, {
          method: 'PATCH',
          body: payload
        });
        setOk(`Module ${payload.code} updated successfully.`);
      } else {
        await apiFetch('/hod/courses', {
          method: 'POST',
          body: payload
        });
        setOk(`Module ${payload.code} created and matching students notified.`);
      }
      resetForm();
      await loadData();
    });
  };

  const toggleActive = async (c, e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/hod/courses/${c.id}`, {
        method: 'PATCH',
        body: { is_active: !c.is_active }
      });
      loadData();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading && !courses.length) return <Loading text="Loading departmental modules…" />;

  // Group modules by Programme / Course
  const grouped = {};
  PROGRAMMES.forEach(prog => {
    grouped[prog] = { 1: [], 2: [], 3: [], 4: [] };
  });

  courses.forEach(c => {
    const progs = c.programmes?.length
      ? c.programmes
      : c.programme
      ? c.programme.split(',').map(s => s.trim())
      : ['Computer Science'];
    const lvl = c.level || 1;

    progs.forEach(p => {
      const matchKey = PROGRAMMES.find(prog => prog.toLowerCase() === p.toLowerCase());
      if (matchKey && grouped[matchKey] && grouped[matchKey][lvl]) {
        if (!grouped[matchKey][lvl].some(existing => existing.id === c.id)) {
          grouped[matchKey][lvl].push(c);
        }
      }
    });
  });

  const availableLevels = getLevelsForProgramme(form.programme);

  return (
    <div className="hod-modules-page" style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>

      <ErrorText>{error}</ErrorText>
      <Success>{ok}</Success>

      {/* ===================================================================
          ADD / EDIT MODULE FORM (Strict Match to Mockup media_1792661822508_fdd5e207.png)
          =================================================================== */}
      {showCreate ? (
        <div style={{ marginBottom: 32 }}>
          {/* Header Banner Card */}
          <div style={{
            background: 'linear-gradient(135deg, #f0f7ff 0%, #e0f2fe 100%)',
            border: '1px solid #bae6fd',
            borderRadius: 16,
            padding: '24px 28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'relative',
            overflow: 'hidden',
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(2, 132, 199, 0.08)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, zIndex: 2 }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: '#ffffff',
                border: '1px solid #bae6fd',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(2, 132, 199, 0.12)'
              }}>
                <BookOpen size={26} color="#0284c7" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 750, color: '#0f172a', letterSpacing: '-0.02em' }}>
                  {editingId ? `Edit Module: ${form.code}` : 'Add New Module'}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
                  Create and allocate a new module for the selected programme, course, level, semester and session.
                </p>
              </div>
            </div>

            {/* Decorative background badges */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              opacity: 0.85
            }}>
              <div style={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <GraduationCap size={40} color="#0284c7" />
              </div>
            </div>
          </div>

          {/* Form Card Container */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '28px 32px',
            boxShadow: '0 4px 16px -2px rgba(15, 23, 42, 0.04)'
          }}>
            <form onSubmit={handleSubmit}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '24px 28px'
              }}>
                {/* 1. Programme */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <GraduationCap size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Programme <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 6px 42px' }}>
                    Select the academic programme.
                  </p>
                  <select
                    value={form.programme}
                    onChange={e => {
                      const nextProg = e.target.value;
                      const validLevels = getLevelsForProgramme(nextProg);
                      setForm({
                        ...form,
                        programme: nextProg,
                        level: validLevels.includes(form.level) ? form.level : 1
                      });
                    }}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  >
                    {PROGRAMME_TYPES.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* 2. Course */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <BookOpen size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Course <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 6px 42px' }}>
                    Select the course under the chosen programme.
                  </p>
                  <select
                    value={form.course}
                    onChange={e => setForm({ ...form, course: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  >
                    {DEPT_COURSES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* 3. Module Code */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <Code size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Module Code <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={form.code}
                    onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. COMS 111"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  />
                  <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0' }}>
                    Enter the official module code (e.g. COMS 111, BSC 204).
                  </p>
                </div>

                {/* 4. Module Title */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <FileText size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Module Title <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Introduction to Computer Science"
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  />
                  <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0' }}>
                    Enter the full title of the module.
                  </p>
                </div>

                {/* 5. Level */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <Layers size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Level <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <select
                    value={form.level}
                    onChange={e => setForm({ ...form, level: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  >
                    {availableLevels.map(lvl => (
                      <option key={lvl} value={lvl}>
                        Year {lvl} ({LEVEL_LABELS[lvl] || `Level ${lvl}`})
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0' }}>
                    Choose the level (e.g. Year 1, Year 2, etc.).
                  </p>
                </div>

                {/* 6. Credit Units */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <Hash size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Credit Units <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <select
                    value={form.credit_units}
                    onChange={e => setForm({ ...form, credit_units: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  >
                    {[1, 2, 3, 4, 5, 6].map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0' }}>
                    Number of credit units for this module.
                  </p>
                </div>

                {/* 7. Semester */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#2563eb'
                    }}>
                      <Calendar size={18} />
                    </div>
                    <div>
                      <label style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                        Semester <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                    </div>
                  </div>
                  <select
                    value={form.semester}
                    onChange={e => setForm({ ...form, semester: Number(e.target.value) })}
                    style={{
                      width: '100%',
                      padding: '11px 14px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                      background: '#fff',
                      color: '#1e293b',
                      outline: 'none'
                    }}
                    required
                  >
                    {SEMESTERS.map(s => (
                      <option key={s} value={s}>{SEMESTER_LABELS[s] || `Semester ${s}`}</option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0' }}>
                    Select the semester this module will be offered.
                  </p>
                </div>

                {/* 8. Active Module Toggle Switch Card */}
                <div>
                  <div style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    background: '#f8fafc',
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    height: '100%',
                    minHeight: 72
                  }}>
                    {/* Toggle Switch */}
                    <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer', flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={e => setForm({ ...form, is_active: e.target.checked })}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute',
                        cursor: 'pointer',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: form.is_active ? '#2563eb' : '#cbd5e1',
                        transition: '0.2s',
                        borderRadius: 24
                      }}>
                        <span style={{
                          position: 'absolute',
                          content: '""',
                          height: 18,
                          width: 18,
                          left: form.is_active ? 22 : 3,
                          bottom: 3,
                          backgroundColor: 'white',
                          transition: '0.2s',
                          borderRadius: '50%',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                        }} />
                      </span>
                    </label>

                    <div>
                      <strong style={{ display: 'block', fontSize: 14, color: '#1e293b' }}>Active Module</strong>
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        Enable this module so students can register and attend it.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Assigned Lecturers (Optional) */}
              <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid #e2e8f0' }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 650, marginBottom: 8, color: '#334e68' }}>
                  Assign Lecturer(s) <span style={{ fontWeight: 400, color: '#64748b' }}>(Optional)</span>
                </label>
                {!lecturers.length ? (
                  <p className="muted small">No active lecturers registered yet.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                    {lecturers.map(l => {
                      const selected = form.lecturer_ids.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => handleLecturerToggle(l.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: selected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                            background: selected ? '#eff6ff' : '#ffffff',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: selected ? 650 : 400, color: selected ? '#1d4ed8' : '#1e293b' }}>
                            {l.full_name}
                          </span>
                          {selected && <Check size={16} color="#2563eb" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 28 }}>
                <button
                  type="submit"
                  disabled={busy === 'save'}
                  style={{
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '11px 22px',
                    fontSize: 14,
                    fontWeight: 650,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)'
                  }}
                >
                  <Plus size={16} />
                  {busy === 'save' ? 'Saving…' : editingId ? 'Update Module' : 'Create Module'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    padding: '11px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#475569',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer'
                  }}
                >
                  <X size={16} />
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* ===================================================================
          ACTIVE MODULES LIST VIEW
          =================================================================== */}
      {!showCreate && (
        <>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            background: '#ffffff',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid #e2e8f0'
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>
                Department Modules ({courses.length})
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                Computer Science Department · 2026/2027 Academic Year
              </p>
            </div>
            <button
              className="primary compact"
              onClick={() => { resetForm(); setShowCreate(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={16} /> Add New Module
            </button>
          </div>

          {/* Grouped Modules List */}
          {DEPT_COURSES.map(courseName => {
            const list = courses.filter(c => {
              const progs = c.programmes || (c.programme ? c.programme.split(',').map(s => s.trim()) : []);
              return progs.some(p => p.toLowerCase() === courseName.toLowerCase()) || c.programme?.toLowerCase() === courseName.toLowerCase();
            });

            return (
              <div key={courseName} style={{ marginBottom: 24 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '2px solid #e2e8f0',
                  marginBottom: 12
                }}>
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BookOpen size={18} color="#2563eb" />
                    {courseName}
                  </h4>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>
                    {list.length} {list.length === 1 ? 'module' : 'modules'}
                  </span>
                </div>

                {!list.length ? (
                  <div style={{ padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px dashed #cbd5e1', textAlign: 'center', fontSize: 13, color: '#64748b' }}>
                    No modules added for {courseName} yet.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                    {list.map(c => {
                      const assigned = (c.lecturer_courses || []).map(lc => lc.profiles?.full_name).filter(Boolean);
                      return (
                        <div
                          key={c.id}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: 12,
                            padding: '16px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{
                                background: '#eff6ff',
                                color: '#2563eb',
                                fontWeight: 750,
                                fontSize: 12,
                                padding: '3px 8px',
                                borderRadius: 6
                              }}>
                                {c.code}
                              </span>
                              <Badge status={c.is_active ? 'approved' : 'rejected'}>
                                {c.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </div>
                            <h5 style={{ margin: '8px 0 4px', fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                              {c.title}
                            </h5>
                            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                              Level {c.level} · {c.credit_units || 3} Credits · {SEMESTER_LABELS[c.semester] || `Semester ${c.semester}`}
                            </p>
                            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#475569' }}>
                              Lecturer: <strong>{assigned.length ? assigned.join(', ') : 'Not assigned'}</strong>
                            </p>
                          </div>

                          <div style={{ display: 'flex', gap: 6, marginTop: 14, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                            <button
                              type="button"
                              className="secondary compact"
                              onClick={() => startEdit(c)}
                              style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12 }}
                            >
                              <Edit size={13} /> Edit
                            </button>
                            <button
                              type="button"
                              className={c.is_active ? 'secondary compact' : 'primary compact'}
                              onClick={e => toggleActive(c, e)}
                              style={{ flex: 1, fontSize: 12 }}
                            >
                              {c.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
