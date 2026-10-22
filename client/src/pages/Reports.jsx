import { useState, useEffect, useRef } from 'react';
import {
  FileText, FileSpreadsheet, Printer, Settings, Filter, Download,
  RefreshCw, Users, Calendar, AlertTriangle, CheckCircle2, Search,
  Upload, Image as ImageIcon, X, SlidersHorizontal, BookOpen, Layers
} from 'lucide-react';
import { apiFetch, download, qs } from '../api';
import { useAuth } from '../auth';
import { PROGRAMMES, LEVELS, hhmm } from '../config';
import { Badge, Empty, ErrorText, Field, Loading, Panel, Stat, Success, fmtDate, pct, useAction, useApi } from '../ui';

export function ReportsPage({ isHod = false }) {
  const { profile } = useAuth();
  const [reportType, setReportType] = useState('module');
  const [academicYearId, setAcademicYearId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [level, setLevel] = useState('');
  const [programme, setProgramme] = useState('');
  const [courseId, setCourseId] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [datePreset, setDatePreset] = useState('semester');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Report Settings Modal State (HOD only)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    university_name: 'Milton Margai Technical University',
    department_name: 'Department of Computer Science',
    min_attendance_threshold: 75,
    lecturer_signature_label: 'Lecturer / Instructor',
    hod_signature_label: 'Head of Department',
    logo_data: ''
  });

  const { busy, error, ok, setOk, setError, run } = useAction();

  // Load options (academic years, semesters, courses, settings)
  const optionsApi = useApi('/reports/options');

  // Initialize settings form when loaded
  useEffect(() => {
    if (optionsApi?.data?.settings) {
      const d = optionsApi.data.settings;
      setSettingsForm({
        university_name: d.university_name || 'Milton Margai Technical University',
        department_name: d.department_name || 'Department of Computer Science',
        min_attendance_threshold: d.min_attendance_threshold ?? 75,
        lecturer_signature_label: d.lecturer_signature_label || 'Lecturer / Instructor',
        hod_signature_label: d.hod_signature_label || 'Head of Department',
        logo_data: d.logo_data || ''
      });
    }
  }, [optionsApi?.data?.settings]);

  // Available options
  const availableCourses = optionsApi.data?.courses || [];
  const academicYears = optionsApi.data?.academic_years || [];
  const semesters = optionsApi.data?.semesters || [];

  const [tableSearch, setTableSearch] = useState('');

  // Query parameters for report API
  const queryParams = {
    report_type: reportType,
    academic_year_id: academicYearId || undefined,
    semester_id: semesterId || undefined,
    level: level ? Number(level) : undefined,
    programme: programme || undefined,
    course_id: courseId || undefined,
    student: reportType === 'student' ? studentQuery || undefined : undefined,
    date_preset: datePreset,
    from: datePreset === 'custom' ? from || undefined : undefined,
    to: datePreset === 'custom' ? to || undefined : undefined
  };

  const reportData = useApi(`/reports/data${qs(queryParams)}`);

  // Handle Export Actions (PDF and Excel stream directly as downloads)
  const handleExport = ext => run(`export-${ext}`, async () => {
    const filename = `${reportData.data?.meta?.title || 'Attendance-Report'}.${ext}`
      .toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    await download(`/reports/export.${ext}${qs(queryParams)}`, filename);
  }, `${ext.toUpperCase()} report generated and downloaded.`);

  const handlePrint = () => {
    window.print();
  };

  const handleSaveSettings = e => {
    e.preventDefault();
    run('save-settings', async () => {
      await apiFetch('/hod/settings', {
        method: 'PATCH',
        body: {
          university_name: settingsForm.university_name.trim(),
          department_name: settingsForm.department_name.trim(),
          min_attendance_threshold: Number(settingsForm.min_attendance_threshold),
          lecturer_signature_label: settingsForm.lecturer_signature_label.trim(),
          hod_signature_label: settingsForm.hod_signature_label.trim(),
          logo_data: settingsForm.logo_data
        }
      });
      setShowSettingsModal(false);
      optionsApi?.reload();
      reportData.reload();
    }, 'Report settings updated successfully.');
  };

  const handleLogoUpload = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert('Logo file must be under 1.5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      setSettingsForm(prev => ({ ...prev, logo_data: ev.target?.result }));
    };
    reader.readAsDataURL(file);
  };

  const d = reportData.data;
  const isLandscape = (d?.columns?.length || 0) > 8;

  return (
    <>
      {/* 1. Header & Quick Controls (Hidden during print) */}
      <div className="report-controls-panel hide-on-print" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: '#102a43' }}>
              Academic Attendance Reports
            </h2>
            <p className="muted small" style={{ margin: 0 }}>
              Generate, preview and download verified A4 attendance reports for classes, levels and modules.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isHod && (
              <button
                type="button"
                className="secondary compact"
                onClick={() => setShowSettingsModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Settings size={15} /> Report Settings
              </button>
            )}

            <button
              type="button"
              className="secondary compact"
              onClick={handlePrint}
              disabled={reportData.loading || !d}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Printer size={15} /> Print (A4)
            </button>

            <button
              type="button"
              className="secondary compact"
              onClick={() => handleExport('xlsx')}
              disabled={busy === 'export-xlsx' || reportData.loading || !d}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <FileSpreadsheet size={15} />
              {busy === 'export-xlsx' ? 'Exporting…' : 'Export Excel'}
            </button>

            <button
              type="button"
              className="primary compact"
              onClick={() => handleExport('pdf')}
              disabled={busy === 'export-pdf' || reportData.loading || !d}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1d4ed8' }}
            >
              <FileText size={15} />
              {busy === 'export-pdf' ? 'Generating PDF…' : 'Download PDF'}
            </button>
          </div>
        </div>

        {/* Filters Grid */}
        <Panel title="Report Filters & Parameters">
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {/* Academic Year */}
            <Field label="Academic Year">
              <select value={academicYearId} onChange={e => setAcademicYearId(e.target.value)}>
                <option value="">Active Academic Year</option>
                {academicYears.map(y => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </select>
            </Field>

            {/* Semester */}
            <Field label="Semester">
              <select value={semesterId} onChange={e => setSemesterId(e.target.value)}>
                <option value="">Active Semester</option>
                {semesters.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>

            {/* Report Type Selector */}
            <Field label="Report Type">
              <select value={reportType} onChange={e => { setReportType(e.target.value); }}>
                <option value="module">Attendance by Module</option>
                <option value="student">Attendance by Student</option>
                <option value="level">Attendance by Level</option>
                <option value="programme">Attendance by Programme</option>
                {isHod && <option value="department">Department Summary</option>}
                <option value="at_risk">Students At Risk (Below Minimum)</option>
                <option value="excused_appeals">Excused Absences & Appeals</option>
              </select>
            </Field>

            {/* Academic Level */}
            <Field label="Level">
              <select value={level} onChange={e => setLevel(e.target.value)}>
                <option value="">All Levels</option>
                {LEVELS.map(l => <option key={l} value={l}>Level {l}</option>)}
              </select>
            </Field>

            {/* Programme */}
            <Field label="Programme">
              <select value={programme} onChange={e => setProgramme(e.target.value)}>
                <option value="">All Programmes</option>
                {PROGRAMMES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>

            {/* Module / Course */}
            {(reportType === 'module' || reportType === 'at_risk' || reportType === 'student') && (
              <Field label="Module / Course">
                <select value={courseId} onChange={e => setCourseId(e.target.value)}>
                  <option value="">All Available Modules</option>
                  {availableCourses.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.title} (Level {c.level})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {/* Student Search */}
            {reportType === 'student' && (
              <Field label="Search Student">
                <input
                  type="text"
                  placeholder="ID (e.g. 8101) or Name…"
                  value={studentQuery}
                  onChange={e => setStudentQuery(e.target.value)}
                />
              </Field>
            )}

            {/* Date Range Preset */}
            <Field label="Date Period">
              <select value={datePreset} onChange={e => setDatePreset(e.target.value)}>
                <option value="semester">Active Semester</option>
                <option value="month">Past 30 Days</option>
                <option value="week">Past 7 Days</option>
                <option value="day">Today Only</option>
                <option value="all">All Dates</option>
                <option value="custom">Custom Date Range…</option>
              </select>
            </Field>
          </div>

          {/* Custom Date Range Row */}
          {datePreset === 'custom' && (
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
              <Field label="Start Date">
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </Field>
              <Field label="End Date">
                <input type="date" value={to} onChange={e => setTo(e.target.value)} />
              </Field>
            </div>
          )}
        </Panel>
      </div>

      <ErrorText>{optionsApi.error || reportData.error || error}</ErrorText>
      <Success>{ok}</Success>

      {/* 2. Responsive Web Data View (No simulated A4 paper sheet) */}
      {reportData.loading ? (
        <Loading text="Compiling verified attendance data…" />
      ) : d ? (
        <div className="reports-analytics-view" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top 4 KPI Stat Cards */}
          <div className="hod-metrics-grid">
            <div className="hod-metric-card">
              <div className="hod-stat-icon blue">
                <Users size={24} />
              </div>
              <div className="hod-stat-data">
                <span className="hod-stat-label">Total Students / Entries</span>
                <strong className="hod-stat-value">{d.summary?.total_students || d.rows?.length || 0}</strong>
                <span className="hod-stat-trend">Filtered dataset</span>
              </div>
            </div>

            <div className="hod-metric-card">
              <div className="hod-stat-icon green">
                <Calendar size={24} />
              </div>
              <div className="hod-stat-data">
                <span className="hod-stat-label">Sessions Held</span>
                <strong className="hod-stat-value">{d.summary?.sessions_held || 0}</strong>
                <span className="hod-stat-trend up">Conducted lectures</span>
              </div>
            </div>

            <div className="hod-metric-card">
              <div className="hod-stat-icon purple">
                <CheckCircle2 size={24} />
              </div>
              <div className="hod-stat-data">
                <span className="hod-stat-label">Average Attendance</span>
                <strong className="hod-stat-value">{d.summary?.average_attendance || 0}%</strong>
                <span className="hod-stat-trend up">Department benchmark: {d.settings?.min_attendance_threshold || 75}%</span>
              </div>
            </div>

            <div className="hod-metric-card">
              <div className={`hod-stat-icon ${(d.summary?.below_minimum || 0) > 0 ? 'red' : 'amber'}`}>
                <AlertTriangle size={24} />
              </div>
              <div className="hod-stat-data">
                <span className="hod-stat-label">Below Minimum</span>
                <strong className="hod-stat-value" style={{ color: (d.summary?.below_minimum || 0) > 0 ? '#dc2626' : undefined }}>
                  {d.summary?.below_minimum || 0}
                </strong>
                <span className="hod-stat-trend" style={{ color: (d.summary?.below_minimum || 0) > 0 ? '#dc2626' : undefined }}>
                  {(d.summary?.below_minimum || 0) > 0 ? 'Requires academic attention' : 'All students in good standing'}
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Web Data Table Panel */}
          <div className="panel" style={{ padding: '20px 24px', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
                  {d.meta?.title}
                </h3>
                <p className="muted small" style={{ margin: 0, color: '#64748b' }}>
                  {d.meta?.filter_summary}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', width: 220 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Search table…"
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    style={{ paddingLeft: 30, height: 34, fontSize: 12, borderRadius: 8 }}
                  />
                </div>
                <span className="badge" style={{ fontSize: 11, background: '#f1f5f9', color: '#475569' }}>
                  {d.rows?.length || 0} Records
                </span>
              </div>
            </div>

            <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {d.columns?.map(col => (
                      <th
                        key={col.key}
                        style={{
                          padding: '10px 14px',
                          textAlign: col.align || 'left',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#475569',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filteredRows = (d.rows || []).filter(row => {
                      if (!tableSearch.trim()) return true;
                      const q = tableSearch.toLowerCase();
                      return Object.values(row).some(v => String(v || '').toLowerCase().includes(q));
                    });

                    if (!filteredRows.length) {
                      return (
                        <tr>
                          <td colSpan={d.columns?.length || 4} style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b' }}>
                            <p style={{ margin: '0 0 6px', fontWeight: 600 }}>No matching records found.</p>
                            <span className="small muted">Try adjusting your filters or search terms.</span>
                          </td>
                        </tr>
                      );
                    }

                    return filteredRows.map((row, idx) => (
                      <tr
                        key={idx}
                        style={{
                          background: idx % 2 === 1 ? '#f8fafc' : '#ffffff',
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        {d.columns?.map(col => {
                          const val = row[col.key];
                          const isRateCol = col.key === 'attendance';
                          return (
                            <td
                              key={col.key}
                              style={{
                                padding: '10px 14px',
                                textAlign: col.align || 'left',
                                whiteSpace: 'nowrap',
                                fontWeight: row.is_below ? 600 : 400
                              }}
                            >
                              {isRateCol ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: row.is_below ? '#dc2626' : '#166534',
                                      background: row.is_below ? '#fef2f2' : '#f0fdf4',
                                      border: `1px solid ${row.is_below ? '#fecaca' : '#bbf7d0'}`
                                    }}
                                  >
                                    {val}
                                  </span>
                                  {row.is_below && (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        padding: '1px 6px',
                                        borderRadius: 4,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        color: '#b91c1c',
                                        background: '#fee2e2'
                                      }}
                                    >
                                      Below min
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: '#1e293b' }}>{val}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 12, color: '#64748b' }}>
              <span>Generated on {fmtDate(d.meta?.generated_at)} by {d.meta?.generated_by} ({d.meta?.generated_by_role})</span>
              <span>Official Department of Computer Science Record</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 3. Report Settings Modal (HOD Only) */}
      {showSettingsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 120, display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="panel" style={{ maxWidth: 520, width: '100%', background: '#fff', borderRadius: 12, margin: 0, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Report Configuration & Branding</h3>
              <button
                type="button"
                className="secondary compact"
                onClick={() => setShowSettingsModal(false)}
                style={{ padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>
            <p className="muted small" style={{ margin: '0 0 16px' }}>
              These values appear on all generated A4 PDF and Excel reports across the department.
            </p>

            <form onSubmit={handleSaveSettings}>
              {/* Logo Preview & Upload */}
              <Field label="Department / University Logo (PNG)">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
                  <div style={{ width: 64, height: 64, border: '1px solid #e2e8f0', borderRadius: 8, display: 'grid', placeItems: 'center', background: '#f8fafc', overflow: 'hidden' }}>
                    {settingsForm.logo_data ? (
                      <img src={settingsForm.logo_data} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    )}
                  </div>
                  <div>
                    <input
                      type="file"
                      id="logo-upload-input"
                      accept="image/png,image/jpeg"
                      onChange={handleLogoUpload}
                      style={{ display: 'none' }}
                    />
                    <label htmlFor="logo-upload-input" className="secondary compact" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Upload size={14} /> Upload New Logo
                    </label>
                    {settingsForm.logo_data && (
                      <button
                        type="button"
                        className="link-button"
                        style={{ display: 'block', marginTop: 4, fontSize: 12, color: '#dc2626' }}
                        onClick={() => setSettingsForm(prev => ({ ...prev, logo_data: '' }))}
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>
                </div>
              </Field>

              <Field label="University Name">
                <input
                  type="text"
                  required
                  value={settingsForm.university_name}
                  onChange={e => setSettingsForm({ ...settingsForm, university_name: e.target.value })}
                />
              </Field>

              <Field label="Department Name">
                <input
                  type="text"
                  required
                  value={settingsForm.department_name}
                  onChange={e => setSettingsForm({ ...settingsForm, department_name: e.target.value })}
                />
              </Field>

              <Field label="Minimum Attendance Threshold (%)" hint="Students below this are tagged as [Below minimum].">
                <input
                  type="number"
                  min={10}
                  max={100}
                  required
                  value={settingsForm.min_attendance_threshold}
                  onChange={e => setSettingsForm({ ...settingsForm, min_attendance_threshold: Number(e.target.value) })}
                />
              </Field>

              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <Field label="Lecturer Signature Label">
                  <input
                    type="text"
                    required
                    value={settingsForm.lecturer_signature_label}
                    onChange={e => setSettingsForm({ ...settingsForm, lecturer_signature_label: e.target.value })}
                  />
                </Field>

                <Field label="HOD Signature Label">
                  <input
                    type="text"
                    required
                    value={settingsForm.hod_signature_label}
                    onChange={e => setSettingsForm({ ...settingsForm, hod_signature_label: e.target.value })}
                  />
                </Field>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowSettingsModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={busy === 'save-settings'}
                >
                  {busy === 'save-settings' ? 'Saving…' : 'Save Report Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
