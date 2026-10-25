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
  const [viewMode, setViewMode] = useState('a4'); // 'a4' (Exact A4 paper pages) or 'web' (Interactive web table)

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

      {/* 2. Report Data View: Exact A4 Paper Sheets & Interactive Web Table */}
      {reportData.loading ? (
        <Loading text="Compiling verified attendance data…" />
      ) : d ? (() => {
        const filteredRows = (d.rows || []).filter(row => {
          if (!tableSearch.trim()) return true;
          const q = tableSearch.toLowerCase();
          return Object.values(row).some(v => String(v || '').toLowerCase().includes(q));
        });

        // Compute unique audit document reference code
        const dateObj = new Date(d.meta?.generated_at || Date.now());
        const docRef = `MMTU-CS-ATT-${dateObj.getFullYear()}-${Math.abs((d.meta?.title || 'REP').split('').reduce((a, b) => (((a << 5) - a) + b.charCodeAt(0)) | 0, 0)).toString(36).toUpperCase().padStart(4, '0')}`;

        // Exact A4 Paper Pages partitioning:
        // - Page 1 has institution crest, ref bar, 4 summary cards, table header, and rows that fill page 1.
        // - If total records <= 14, Page 1 ALSO fits the official signature block (1 single complete A4 sheet).
        // - If total records > 14, Page 1 takes 18 rows, Page 2 takes up to 28 rows (or 20 if last page with signatures), etc.
        const PAGE_1_CAPACITY = 18;
        const PAGE_N_CAPACITY_NO_SIG = 28;
        const PAGE_N_CAPACITY_WITH_SIG = 20;

        const a4Pages = [];
        if (filteredRows.length <= 14) {
          a4Pages.push({
            pageNumber: 1,
            isFirstPage: true,
            isLastPage: true,
            rows: filteredRows,
            hasSignatures: true
          });
        } else {
          a4Pages.push({
            pageNumber: 1,
            isFirstPage: true,
            isLastPage: false,
            rows: filteredRows.slice(0, PAGE_1_CAPACITY),
            hasSignatures: false
          });

          let startIndex = PAGE_1_CAPACITY;
          let pageNum = 2;

          while (startIndex < filteredRows.length) {
            const remaining = filteredRows.length - startIndex;
            if (remaining <= PAGE_N_CAPACITY_WITH_SIG) {
              a4Pages.push({
                pageNumber: pageNum,
                isFirstPage: false,
                isLastPage: true,
                rows: filteredRows.slice(startIndex, startIndex + remaining),
                hasSignatures: true
              });
              startIndex += remaining;
            } else {
              a4Pages.push({
                pageNumber: pageNum,
                isFirstPage: false,
                isLastPage: false,
                rows: filteredRows.slice(startIndex, startIndex + PAGE_N_CAPACITY_NO_SIG),
                hasSignatures: false
              });
              startIndex += PAGE_N_CAPACITY_NO_SIG;
              pageNum++;
            }
          }
        }

        // Helper to render an exact physical A4 paper sheet
        const renderA4Sheet = (page, totalPages) => (
          <div key={page.pageNumber} className="a4-paper-sheet">
            {/* Top Section */}
            <div>
              {page.isFirstPage ? (
                /* Page 1: Official Crest, University Name, Ref Bar, Title, Summary Cards */
                <div style={{ marginBottom: 12 }}>
                  <div style={{ textAlign: 'center', marginBottom: 10 }}>
                    <img
                      src={d.settings?.logo_data || '/logo.png'}
                      alt="MMTU Crest"
                      style={{ height: 46, objectFit: 'contain', margin: '0 auto 6px auto', display: 'block' }}
                    />
                    <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f2744', letterSpacing: '0.04em' }}>
                      {(d.settings?.university_name || 'MILTON MARGAI TECHNICAL UNIVERSITY').toUpperCase()}
                    </h1>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', letterSpacing: '0.05em', marginTop: 3 }}>
                      FACULTY OF ENGINEERING & TECHNOLOGY · {(d.settings?.department_name || 'DEPARTMENT OF COMPUTER SCIENCE').toUpperCase()}
                    </div>
                  </div>

                  {/* Security & Audit Reference Bar */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: 10,
                    marginBottom: 10
                  }}>
                    <span style={{ fontWeight: 700, color: '#1e40af' }}>REF: {docRef}</span>
                    <span style={{ fontWeight: 800, color: '#059669', letterSpacing: '0.05em' }}>VERIFIED ACADEMIC AUDIT</span>
                    <span style={{ color: '#475569' }}>ISSUED: {fmtDate(d.meta?.generated_at)}</span>
                  </div>

                  {/* Title & Filter Summary */}
                  <div style={{ textAlign: 'center', marginBottom: 12 }}>
                    <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f2744' }}>
                      {d.meta?.title}
                    </h2>
                    <p style={{ margin: '3px 0 0', fontSize: 11, color: '#64748b' }}>
                      {d.meta?.filter_summary}
                    </p>
                  </div>

                  {/* 4 Summary Cards */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 8,
                    marginBottom: 12
                  }}>
                    <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                      <strong style={{ display: 'block', fontSize: 15, color: '#0f2744' }}>{d.summary?.total_students || d.rows?.length || 0}</strong>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Students</span>
                    </div>
                    <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                      <strong style={{ display: 'block', fontSize: 15, color: '#0f2744' }}>{d.summary?.sessions_held || 0}</strong>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Sessions Held</span>
                    </div>
                    <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                      <strong style={{ display: 'block', fontSize: 15, color: '#0f2744' }}>{d.summary?.average_attendance || 0}%</strong>
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Avg Attendance</span>
                    </div>
                    <div style={{
                      background: (d.summary?.below_minimum || 0) > 0 ? '#fef2f2' : '#f8fafc',
                      border: `1px solid ${(d.summary?.below_minimum || 0) > 0 ? '#fca5a5' : '#cbd5e1'}`,
                      borderRadius: 6,
                      padding: '6px 8px',
                      textAlign: 'center'
                    }}>
                      <strong style={{ display: 'block', fontSize: 15, color: (d.summary?.below_minimum || 0) > 0 ? '#dc2626' : '#0f2744' }}>
                        {d.summary?.below_minimum || 0}
                      </strong>
                      <span style={{ fontSize: 9, fontWeight: 700, color: (d.summary?.below_minimum || 0) > 0 ? '#dc2626' : '#64748b', textTransform: 'uppercase' }}>
                        Below Minimum
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Page 2+: Running Continuation Header */
                <div style={{ borderBottom: '1.5px solid #cbd5e1', paddingBottom: 6, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#0f2744' }}>
                    <span>{(d.settings?.university_name || 'MILTON MARGAI TECHNICAL UNIVERSITY').toUpperCase()}</span>
                    <span style={{ color: '#64748b', fontSize: 10 }}>Page {page.pageNumber} of {totalPages}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, color: '#64748b', marginTop: 2 }}>
                    <span>{d.settings?.department_name || 'Department of Computer Science'} · {d.meta?.title} (Continued)</span>
                    <span style={{ fontFamily: 'monospace' }}>Ref: {docRef}</span>
                  </div>
                </div>
              )}

              {/* Table of Records */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
                <thead>
                  <tr style={{ background: '#0f2744', color: '#ffffff' }}>
                    {d.columns?.map(col => (
                      <th
                        key={col.key}
                        style={{
                          padding: '6px 8px',
                          textAlign: col.align || 'left',
                          fontSize: 9.5,
                          fontWeight: 700,
                          letterSpacing: '0.03em',
                          borderRight: '1px solid #1e3a5f'
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!page.rows.length ? (
                    <tr>
                      <td colSpan={d.columns?.length || 4} style={{ padding: '24px 8px', textAlign: 'center', color: '#64748b' }}>
                        No records match the active criteria.
                      </td>
                    </tr>
                  ) : (
                    page.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        style={{
                          background: rIdx % 2 === 1 ? '#f8fafc' : '#ffffff',
                          borderBottom: '1px solid #e2e8f0'
                        }}
                      >
                        {d.columns?.map(col => {
                          const val = row[col.key];
                          const isRateCol = col.key === 'attendance';
                          return (
                            <td
                              key={col.key}
                              style={{
                                padding: '5px 8px',
                                textAlign: col.align || 'left',
                                color: row.is_below && isRateCol ? '#dc2626' : '#0f172a',
                                fontWeight: row.is_below && isRateCol ? 700 : 400
                              }}
                            >
                              {isRateCol ? (
                                <span>
                                  {val}
                                  {row.is_below && (
                                    <span style={{
                                      marginLeft: 6,
                                      padding: '1px 4px',
                                      borderRadius: 4,
                                      fontSize: 8.5,
                                      fontWeight: 800,
                                      background: '#fee2e2',
                                      color: '#dc2626'
                                    }}>
                                      Below min
                                    </span>
                                  )}
                                </span>
                              ) : (
                                String(val ?? '')
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* End-of-Report Official Signatures & Seal */}
              {page.hasSignatures && (
                <div style={{ marginTop: 14 }}>
                  <p style={{ margin: '0 0 14px', fontSize: 9.5, color: '#64748b', fontStyle: 'italic' }}>
                    Total verified records: {filteredRows.length}. Attendance verified according to official Department of Computer Science regulations. Minimum benchmark threshold: {d.settings?.min_attendance_threshold || 75}%.
                  </p>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 16,
                    alignItems: 'flex-end',
                    marginTop: 8
                  }}>
                    {/* 1. Lecturer In-Charge */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ borderTop: '1px solid #94a3b8', paddingTop: 6 }}>
                        <strong style={{ display: 'block', fontSize: 10.5, color: '#0f2744' }}>
                          {d.settings?.lecturer_signature_label || 'Course Lecturer / Instructor'}
                        </strong>
                        <span style={{ fontSize: 9, color: '#64748b' }}>Signature & Date</span>
                      </div>
                    </div>

                    {/* 2. Official Stamp & Seal */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{
                        border: '1.5px dashed #cbd5e1',
                        borderRadius: 6,
                        height: 58,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f8fafc'
                      }}>
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.05em' }}>
                          OFFICIAL STAMP & SEAL
                        </span>
                        <span style={{ fontSize: 8, color: '#cbd5e1', marginTop: 2 }}>
                          Department of Computer Science
                        </span>
                      </div>
                    </div>

                    {/* 3. Head of Department */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ borderTop: '1px solid #94a3b8', paddingTop: 6 }}>
                        <strong style={{ display: 'block', fontSize: 10.5, color: '#0f2744' }}>
                          {d.settings?.hod_signature_label || 'Head of Department'}
                        </strong>
                        <span style={{ fontSize: 9, color: '#64748b' }}>Approval Signature & Date</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Footer on Every A4 Sheet */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '1px solid #cbd5e1',
              paddingTop: 6,
              fontSize: 9,
              color: '#64748b',
              marginTop: 10
            }}>
              <span>Generated: {fmtDate(d.meta?.generated_at)} by {d.meta?.generated_by} ({d.meta?.generated_by_role}) · Ref: {docRef}</span>
              <strong style={{ color: '#0f2744', fontSize: 9.5 }}>Page {page.pageNumber} of {totalPages}</strong>
              <span>OFFICIAL UNIVERSITY DOCUMENT · CONFIDENTIAL</span>
            </div>
          </div>
        );

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* View Mode Switcher & Quick Search (Hidden during print) */}
            <div className="hide-on-print" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              background: '#ffffff',
              padding: '12px 18px',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
            }}>
              {/* Left: View Mode Pills */}
              <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: 4, borderRadius: 10 }}>
                <button
                  type="button"
                  onClick={() => setViewMode('a4')}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: viewMode === 'a4' ? '#ffffff' : 'transparent',
                    color: viewMode === 'a4' ? '#0f2744' : '#64748b',
                    boxShadow: viewMode === 'a4' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: '0.15s'
                  }}
                >
                  <FileText size={15} color={viewMode === 'a4' ? '#2563eb' : '#64748b'} /> Exact A4 Paper View ({a4Pages.length} {a4Pages.length === 1 ? 'Page' : 'Pages'})
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('web')}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: viewMode === 'web' ? '#ffffff' : 'transparent',
                    color: viewMode === 'web' ? '#0f2744' : '#64748b',
                    boxShadow: viewMode === 'web' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: '0.15s'
                  }}
                >
                  <Layers size={15} color={viewMode === 'web' ? '#2563eb' : '#64748b'} /> Interactive Web Table
                </button>
              </div>

              {/* Right: Search Filter & Total Count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', width: 220 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Search records…"
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    style={{ paddingLeft: 30, height: 34, fontSize: 12, borderRadius: 8 }}
                  />
                </div>
                <span className="badge" style={{ fontSize: 11, background: '#f1f5f9', color: '#475569' }}>
                  {filteredRows.length} Records
                </span>
              </div>
            </div>

            {/* View 1: Exact A4 Paper View (Active or Print) */}
            {viewMode === 'a4' ? (
              <div className="a4-workspace-bg">
                {a4Pages.map(page => renderA4Sheet(page, a4Pages.length))}
              </div>
            ) : (
              /* View 2: Interactive Web Table + KPI Cards */
              <div className="reports-web-view" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* 4 KPI Metric Cards */}
                <div className="hod-metrics-grid">
                  <div className="hod-metric-card">
                    <div className="hod-stat-icon blue"><Users size={24} /></div>
                    <div className="hod-stat-data">
                      <span className="hod-stat-label">Total Students / Entries</span>
                      <strong className="hod-stat-value">{d.summary?.total_students || d.rows?.length || 0}</strong>
                      <span className="hod-stat-trend">Filtered dataset</span>
                    </div>
                  </div>
                  <div className="hod-metric-card">
                    <div className="hod-stat-icon green"><Calendar size={24} /></div>
                    <div className="hod-stat-data">
                      <span className="hod-stat-label">Sessions Held</span>
                      <strong className="hod-stat-value">{d.summary?.sessions_held || 0}</strong>
                      <span className="hod-stat-trend up">Conducted lectures</span>
                    </div>
                  </div>
                  <div className="hod-metric-card">
                    <div className="hod-stat-icon purple"><CheckCircle2 size={24} /></div>
                    <div className="hod-stat-data">
                      <span className="hod-stat-label">Average Attendance</span>
                      <strong className="hod-stat-value">{d.summary?.average_attendance || 0}%</strong>
                      <span className="hod-stat-trend up">Benchmark: {d.settings?.min_attendance_threshold || 75}%</span>
                    </div>
                  </div>
                  <div className="hod-metric-card">
                    <div className={`hod-stat-icon ${(d.summary?.below_minimum || 0) > 0 ? 'red' : 'amber'}`}><AlertTriangle size={24} /></div>
                    <div className="hod-stat-data">
                      <span className="hod-stat-label">Below Minimum</span>
                      <strong className="hod-stat-value" style={{ color: (d.summary?.below_minimum || 0) > 0 ? '#dc2626' : undefined }}>
                        {d.summary?.below_minimum || 0}
                      </strong>
                      <span className="hod-stat-trend" style={{ color: (d.summary?.below_minimum || 0) > 0 ? '#dc2626' : undefined }}>
                        {(d.summary?.below_minimum || 0) > 0 ? 'Deficient attendance' : 'Good academic standing'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Web Table Panel */}
                <div className="panel" style={{ padding: '20px 24px', background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                          {d.columns?.map(col => (
                            <th key={col.key} style={{ padding: '10px 14px', textAlign: col.align || 'left', fontSize: 12, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {!filteredRows.length ? (
                          <tr>
                            <td colSpan={d.columns?.length || 4} style={{ padding: '36px 16px', textAlign: 'center', color: '#64748b' }}>
                              <p style={{ margin: '0 0 6px', fontWeight: 600 }}>No matching records found.</p>
                              <span className="small muted">Try adjusting your filters or search terms.</span>
                            </td>
                          </tr>
                        ) : (
                          filteredRows.map((row, idx) => (
                            <tr key={idx} style={{ background: idx % 2 === 1 ? '#f8fafc' : '#ffffff', borderBottom: '1px solid #f1f5f9' }}>
                              {d.columns?.map(col => {
                                const val = row[col.key];
                                const isRateCol = col.key === 'attendance';
                                return (
                                  <td key={col.key} style={{ padding: '10px 14px', textAlign: col.align || 'left', whiteSpace: 'nowrap', fontWeight: row.is_below ? 600 : 400 }}>
                                    {isRateCol ? (
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{
                                          padding: '2px 8px',
                                          borderRadius: 6,
                                          fontSize: 12,
                                          fontWeight: 700,
                                          color: row.is_below ? '#dc2626' : '#166534',
                                          background: row.is_below ? '#fef2f2' : '#f0fdf4',
                                          border: `1px solid ${row.is_below ? '#fecaca' : '#bbf7d0'}`
                                        }}>
                                          {val}
                                        </span>
                                        {row.is_below && (
                                          <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#b91c1c', background: '#fee2e2' }}>
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
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Print-only container for when in web mode */}
                <div className="show-on-print-only">
                  {a4Pages.map(page => renderA4Sheet(page, a4Pages.length))}
                </div>
              </div>
            )}
          </div>
        );
      })() : null}

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
