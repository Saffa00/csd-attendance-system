import { useState, useEffect } from 'react';
import { Calendar, RefreshCw, AlertTriangle, ShieldCheck, CheckCircle, Plus, Trash2, Sliders, ArrowRight, RotateCcw } from 'lucide-react';
import { apiFetch } from '../api';
import { Loading, Modal } from '../ui';

export default function HodRollover() {
  const [settings, setSettings] = useState({ min_attendance_threshold: 75 });
  const [holidays, setHolidays] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Holiday modal
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ name: '', holiday_date: '', is_teaching_day: false });

  // Rollover modal
  const [showRolloverModal, setShowRolloverModal] = useState(false);
  const [nextYearName, setNextYearName] = useState('');
  const [rolloverLoading, setRolloverLoading] = useState(false);
  const [rolloverSuccess, setRolloverSuccess] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [s, h, p] = await Promise.all([
        apiFetch('/hod/settings'),
        apiFetch('/hod/holidays'),
        apiFetch('/hod/rollover/preview')
      ]);
      setSettings(s || { min_attendance_threshold: 75 });
      setHolidays(h || []);
      setPreview(p || null);
    } catch (e) {
      console.error('Load failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveThreshold = async (e) => {
    e.preventDefault();
    try {
      setSavingSettings(true);
      setSettingsSuccess(false);
      await apiFetch('/hod/settings', {
        method: 'PATCH',
        body: { min_attendance_threshold: Number(settings.min_attendance_threshold) }
      });
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 4000);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const addHoliday = async (e) => {
    e.preventDefault();
    try {
      await apiFetch('/hod/holidays', { method: 'POST', body: holidayForm });
      setShowHolidayModal(false);
      setHolidayForm({ name: '', holiday_date: '', is_teaching_day: false });
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteHoliday = async (id) => {
    if (!confirm('Remove this holiday?')) return;
    try {
      await apiFetch(`/hod/holidays/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const executeRollover = async () => {
    if (!nextYearName.trim()) {
      alert('Please enter a name for the new academic year (e.g. 2026/2027).');
      return;
    }
    try {
      setRolloverLoading(true);
      const res = await apiFetch('/hod/rollover/execute', {
        method: 'POST',
        body: { next_academic_year_name: nextYearName.trim() }
      });
      setShowRolloverModal(false);
      setRolloverSuccess(`Rollover executed! ${res.promoted} students promoted, ${res.graduated} Year 4 students graduated. Safety rollback available for 24 hours.`);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setRolloverLoading(false);
    }
  };

  const executeRollback = async () => {
    if (!confirm('Are you sure you want to rollback the previous rollover? This will restore student levels to what they were before the rollover.')) return;
    try {
      setLoading(true);
      await apiFetch('/hod/rollover/rollback', { method: 'POST' });
      alert('Rollover successfully reverted.');
      load();
    } catch (err) {
      alert(err.message);
      setLoading(false);
    }
  };

  if (loading) return <Loading text="Loading academic setup & rollover…" />;

  return (
    <div className="page-container">
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Academic Setup & Rollover</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
          Configure minimum attendance thresholds, holidays, and academic year rollover
        </p>
      </div>

      {rolloverSuccess && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <CheckCircle size={18} color="#16a34a" />
          <span>{rolloverSuccess}</span>
        </div>
      )}

      {/* SECTION 1: Minimum Attendance Rule */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Sliders size={18} color="var(--primary)" />
          <h3 style={{ margin: 0, fontSize: 16 }}>Minimum Attendance Rule</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
          Set the departmental attendance benchmark required for students to sit exams. Students below this threshold will be flagged in Red, while those within 5% will show in Amber.
        </p>
        <form onSubmit={saveThreshold} style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 400 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min="10"
              max="100"
              className="input-field"
              value={settings.min_attendance_threshold}
              onChange={e => setSettings({ ...settings, min_attendance_threshold: e.target.value })}
              style={{ fontWeight: 700, fontSize: 15 }}
            />
            <span style={{ fontWeight: 700, fontSize: 16 }}>%</span>
          </div>
          <button type="submit" className="primary" disabled={savingSettings}>
            {savingSettings ? 'Saving…' : 'Save Rule'}
          </button>
        </form>
        {settingsSuccess && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle size={14} /> Minimum attendance threshold updated successfully.
          </div>
        )}
      </div>

      {/* SECTION 2: Academic Year Rollover */}
      <div className="card" style={{ marginBottom: 20, border: '1px solid #fed7aa', background: '#fffbeb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={18} color="#c2410c" />
              <h3 style={{ margin: 0, fontSize: 16, color: '#9a3412' }}>Academic Year Rollover</h3>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#7c2d12' }}>
              Current Academic Year: <strong>{preview?.current_academic_year || 'Not Set'}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            {preview?.can_rollback && (
              <button
                className="secondary"
                onClick={executeRollback}
                style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: '#fdba74', color: '#c2410c' }}
              >
                <RotateCcw size={14} /> 24h Safety Rollback
              </button>
            )}
            <button
              className="primary"
              onClick={() => {
                setNextYearName('');
                setShowRolloverModal(true);
              }}
              style={{ background: '#c2410c', borderColor: '#c2410c', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} /> Start New Academic Year
            </button>
          </div>
        </div>

        {preview && (
          <div style={{ marginTop: 16, background: '#ffffff', borderRadius: 8, padding: 14, border: '1px solid #fed7aa' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#9a3412', display: 'block', marginBottom: 10 }}>
              Live Student Progression Preview:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Year 1 → Year 2</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{preview.level1_to_level2}</div>
              </div>
              <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Year 2 → Year 3</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{preview.level2_to_level3}</div>
              </div>
              <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Year 3 → Year 4</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{preview.level3_to_level4}</div>
              </div>
              <div style={{ padding: 10, background: '#fee2e2', borderRadius: 6, border: '1px solid #fecaca' }}>
                <div style={{ fontSize: 11, color: '#991b1b' }}>Year 4 → Graduated</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#991b1b' }}>{preview.level4_graduating}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#7c2d12' }}>
              ✓ All historical attendance records and class sessions remain queryable in Reports by year and semester. Nothing is lost.
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3: Holidays & Non-teaching Days */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={18} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: 16 }}>Holidays & Non-Teaching Days</h3>
          </div>
          <button className="secondary compact" onClick={() => setShowHolidayModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> Add Holiday
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px' }}>
          No class sessions can be opened on declared non-teaching dates, and no absences are counted against students.
        </p>

        {holidays.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--bg-subtle, #f8fafc)', borderRadius: 8 }}>
            No holidays registered yet. Click 'Add Holiday' to define public holidays or university breaks.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)', fontSize: 11 }}>
                  <th style={{ padding: '8px 12px' }}>Holiday / Event</th>
                  <th style={{ padding: '8px 12px' }}>Date</th>
                  <th style={{ padding: '8px 12px' }}>Teaching Allowed</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map(h => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{h.name}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{h.holiday_date}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span className={`pill ${h.is_teaching_day ? 'neutral' : 'danger'}`} style={{ fontSize: 10 }}>
                        {h.is_teaching_day ? 'Yes (Teaching Day)' : 'No (Classes Prohibited)'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <button
                        className="icon-btn"
                        onClick={() => deleteHoliday(h.id)}
                        style={{ color: '#ef4444', padding: 4 }}
                        title="Delete Holiday"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rollover Modal */}
      {showRolloverModal && (
        <Modal title="Confirm Academic Year Rollover" onClose={() => setShowRolloverModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, color: '#991b1b', fontSize: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
                <AlertTriangle size={16} /> Important Rollover Notice
              </div>
              Starting a new academic year will promote undergraduate students (Years 1 to 3) up by one level, graduate Year 4 students, and archive current sessions. A 24-hour safety rollback option is provided.
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Next Academic Year Name
              </label>
              <input
                type="text"
                className="input-field"
                required
                placeholder="e.g. 2026/2027"
                value={nextYearName}
                onChange={e => setNextYearName(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="secondary" onClick={() => setShowRolloverModal(false)} disabled={rolloverLoading}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={executeRollover}
                disabled={rolloverLoading || !nextYearName.trim()}
                style={{ background: '#c2410c', borderColor: '#c2410c' }}
              >
                {rolloverLoading ? 'Processing Rollover…' : 'Confirm & Execute Rollover'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Holiday Modal */}
      {showHolidayModal && (
        <Modal title="Add Department Holiday" onClose={() => setShowHolidayModal(false)}>
          <form onSubmit={addHoliday} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Holiday / Event Name</label>
              <input
                type="text"
                className="input-field"
                required
                placeholder="e.g. Independence Day, Semester Break"
                value={holidayForm.name}
                onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Date</label>
              <input
                type="date"
                className="input-field"
                required
                value={holidayForm.holiday_date}
                onChange={e => setHolidayForm({ ...holidayForm, holiday_date: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="is_teaching_day"
                checked={holidayForm.is_teaching_day}
                onChange={e => setHolidayForm({ ...holidayForm, is_teaching_day: e.target.checked })}
              />
              <label htmlFor="is_teaching_day" style={{ fontSize: 12, cursor: 'pointer' }}>
                Allow teaching on this day (uncheck to strictly prohibit class sessions)
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button type="button" className="secondary" onClick={() => setShowHolidayModal(false)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save Holiday
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
