import { useState, useEffect } from 'react';
import { AlertTriangle, Bell, Filter, ShieldAlert, CheckCircle, Search } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { Loading, Empty, Modal } from '../ui';

export default function StudentsAtRisk() {
  const { profile } = useAuth();
  const [data, setData] = useState({ threshold: 75, students: [] });
  const [loading, setLoading] = useState(true);
  const [filterLevel, setFilterLevel] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(null);

  const isHod = profile.role === 'hod';

  const load = async () => {
    try {
      setLoading(true);
      const url = isHod ? `/hod/students-at-risk${filterLevel ? `?level=${filterLevel}` : ''}` : '/lecturer/students-at-risk';
      const res = await apiFetch(url);
      setData(res || { threshold: 75, students: [] });
      setSelectedIds([]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterLevel]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedIds.length === filteredStudents.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredStudents.map(s => s.profile_id));
    }
  };

  const sendWarnings = async () => {
    if (!selectedIds.length) {
      alert('Please select at least one student to notify.');
      return;
    }
    try {
      setSending(true);
      await apiFetch('/hod/notify-at-risk', {
        method: 'POST',
        body: { student_ids: selectedIds }
      });
      setSentSuccess(`Successfully sent OneSignal attendance warning to ${selectedIds.length} student(s).`);
      setSelectedIds([]);
      setTimeout(() => setSentSuccess(null), 5000);
    } catch (e) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  };

  const students = data.students || [];
  const filteredStudents = students.filter(s => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (s.full_name || '').toLowerCase().includes(term) || (s.student_id || '').toLowerCase().includes(term);
  });

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldAlert size={22} color="#dc2626" />
            Students at Risk of Failing Minimum Attendance
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
            Mandatory Department Attendance Threshold: <strong style={{ color: 'var(--text-color)' }}>{data.threshold}%</strong>
          </p>
        </div>

        {isHod && (
          <button
            className="primary"
            onClick={sendWarnings}
            disabled={sending || selectedIds.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Bell size={16} />
            {sending ? 'Sending Push Warnings…' : `Send Warning Push (${selectedIds.length})`}
          </button>
        )}
      </div>

      {sentSuccess && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <CheckCircle size={16} color="#16a34a" />
          <span>{sentSuccess}</span>
        </div>
      )}

      {/* Threshold Explanation Card */}
      <div className="card" style={{ background: 'var(--bg-subtle, #f8fafc)', marginBottom: 16, padding: '12px 14px' }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: '#dc2626' }} />
            <span><strong>Red (&lt; {data.threshold}%):</strong> Below threshold (At immediate risk)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: '#d97706' }} />
            <span><strong>Amber ({data.threshold}% - {data.threshold + 5}%):</strong> Warning (Within 5% of threshold)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: '#16a34a' }} />
            <span><strong>Green (&gt; {data.threshold + 5}%):</strong> In good standing</span>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Search by student name or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {isHod && (
          <select
            className="input-field"
            style={{ width: 'auto', minWidth: 140 }}
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value)}
          >
            <option value="">All Levels</option>
            <option value="1">Year 1</option>
            <option value="2">Year 2</option>
            <option value="3">Year 3</option>
            <option value="4">Year 4</option>
          </select>
        )}
      </div>

      {loading ? (
        <Loading text="Analyzing student attendance rates…" />
      ) : filteredStudents.length === 0 ? (
        <Empty title="No Students Currently At Risk" message="All students are meeting or exceeding the minimum departmental attendance requirement." />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: '#f1f5f9', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isHod && (
                <input
                  type="checkbox"
                  checked={selectedIds.length === filteredStudents.length && filteredStudents.length > 0}
                  onChange={selectAll}
                />
              )}
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                {filteredStudents.length} Student(s) Requiring Attention
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Select students to issue OneSignal warnings</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle, #f8fafc)', color: 'var(--muted)', fontSize: 11 }}>
                  {isHod && <th style={{ padding: '10px 14px', width: 36 }}></th>}
                  <th style={{ padding: '10px 14px' }}>Student</th>
                  <th style={{ padding: '10px 14px' }}>Level</th>
                  <th style={{ padding: '10px 14px' }}>Overall Rate</th>
                  <th style={{ padding: '10px 14px' }}>Attended / Total</th>
                  <th style={{ padding: '10px 14px' }}>Module Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(s => {
                  const isCrit = s.risk_status === 'critical';
                  const isAmber = s.risk_status === 'warning';
                  const color = isCrit ? '#dc2626' : '#d97706';
                  const bg = isCrit ? '#fef2f2' : '#fffbeb';
                  const border = isCrit ? '#fca5a5' : '#fde68a';

                  return (
                    <tr key={s.profile_id} style={{ borderBottom: '1px solid var(--border)' }}>
                      {isHod && (
                        <td style={{ padding: '12px 14px' }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(s.profile_id)}
                            onChange={() => toggleSelect(s.profile_id)}
                          />
                        </td>
                      )}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600 }}>{s.full_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.student_id || 'No ID'} {s.phone_number ? `• ${s.phone_number}` : ''}</div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>Year {s.level}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            color,
                            background: bg,
                            border: `1px solid ${border}`
                          }}
                        >
                          {s.rate}% ({isCrit ? 'Critical' : 'Warning'})
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {s.counts.approved} / {(s.counts.approved + s.counts.rejected + s.counts.absent + s.counts.correction_requested)} sessions
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {Object.entries(s.courses || {}).map(([code, c]) => {
                            const denom = c.approved + c.rejected + c.absent + c.correction_requested;
                            const modRate = denom ? Math.round((c.approved / denom) * 100) : 0;
                            const modCrit = modRate < data.threshold;
                            return (
                              <span
                                key={code}
                                style={{
                                  fontSize: 10,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: modCrit ? '#fee2e2' : '#f1f5f9',
                                  color: modCrit ? '#b91c1c' : '#475569',
                                  fontWeight: 600
                                }}
                              >
                                {code}: {modRate}%
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
