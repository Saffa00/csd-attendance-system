import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User, BookOpen, Phone, Mail, GraduationCap, Building2,
  Calendar, Layers, ShieldCheck, Camera, Upload, Trash2,
  BellRing, KeyRound, LogOut, Edit2, CheckCircle2, ChevronRight,
  Sparkles, Shield, Info, X, Clock, ShieldAlert
} from 'lucide-react';
import { apiFetch } from '../api';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import { useInstallPrompt, ErrorText, Field, Panel, Success, useAction, Avatar, Modal } from '../ui';
import RecoveryCodeScreen from '../components/RecoveryCodeScreen';

/** Change password form. `forced` is shown full-screen on first login (temporary password). */
export function ChangePasswordForm({ forced = false, onDone }) {
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const { busy, error, ok, run, setError } = useAction();
  const set = e => setF({ ...f, [e.target.name]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    const newPw = f.new_password.trim();
    const confPw = f.confirm.trim();
    const curPw = f.current_password.trim();
    if (newPw.length < 8) return setError('New password must be at least 8 characters');
    if (newPw !== confPw) return setError('New passwords do not match');
    const r = await run('pw', () => apiFetch('/auth/change-password', {
      method: 'POST',
      body: { current_password: curPw, new_password: newPw }
    }), 'Password changed successfully!');
    if (r) {
      if (r.session) {
        await supabase.auth.setSession({
          access_token: r.session.access_token,
          refresh_token: r.session.refresh_token
        }).catch(() => {});
        localStorage.setItem('auth_access_token', r.session.access_token);
        if (r.session.refresh_token) localStorage.setItem('auth_refresh_token', r.session.refresh_token);
      }
      setF({ current_password: '', new_password: '', confirm: '' });
      onDone?.();
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={forced ? 'Temporary password' : 'Current password'}>
        <input name="current_password" type="password" value={f.current_password} onChange={set} autoComplete="current-password" required />
      </Field>
      <Field label="New password (min. 8 characters)">
        <input name="new_password" type="password" value={f.new_password} onChange={set} minLength={8} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password">
        <input name="confirm" type="password" value={f.confirm} onChange={set} autoComplete="new-password" required />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Success>{ok}</Success>
      <button className="primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

/** Full-screen gate: staff (and reset students) must replace a temporary password before using the app. */
export function ForcedPasswordChange() {
  const { reloadProfile, signOut } = useAuth();
  return (
    <div className="auth-page"><div className="auth-card">
      <div className="brand-mark">🔒</div>
      <h1>Choose a new password</h1>
      <p className="muted">You signed in with a temporary password. Set your own password to continue.</p>
      <ChangePasswordForm forced onDone={reloadProfile} />
      <button className="link-button" onClick={signOut}>Sign out</button>
    </div></div>
  );
}

/** Client-side image crop and resize to 400x400 JPEG */
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        const targetSize = Math.min(size, 400);
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, targetSize, targetSize);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export default function Account() {
  const { profile, setProfile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('personal'); // 'personal' | 'academic' | 'contact'
  const [pushMsg, setPushMsg] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [editingField, setEditingField] = useState(null); // 'phone' | 'email' | null
  const [editValue, setEditValue] = useState('');
  const fileInputRef = useRef(null);
  const { busy, error, ok, run, setOk } = useAction();

  // Recovery code regeneration state (students)
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [generatedRecoveryData, setGeneratedRecoveryData] = useState(null);

  const handleRegenerateRecoveryCode = async e => {
    e.preventDefault();
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      const res = await apiFetch('/auth/regenerate-recovery-code', {
        method: 'POST',
        body: { password: recoveryPassword }
      });
      if (res?.recovery_code) {
        setGeneratedRecoveryData({
          code: res.recovery_code,
          studentName: profile?.full_name || 'Student',
          studentId: profile?.student_id || profile?.phone_number || ''
        });
        setShowRecoveryModal(false);
        setRecoveryPassword('');
      }
    } catch (err) {
      setRecoveryError(err.message || 'Could not generate recovery code. Verify your password.');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleFileSelect = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPEG, PNG, WebP).');
      return;
    }
    await run('upload-photo', async () => {
      const dataUrl = await processImage(file);
      const res = await apiFetch('/profile/avatar', {
        method: 'POST',
        body: { image: dataUrl }
      });
      if (res?.avatar_url) {
        setProfile({ ...profile, avatar_url: res.avatar_url });
        setOk('Profile picture updated successfully!');
      }
    });
    e.target.value = '';
  };

  const handleRemovePhoto = () => {
    if (!window.confirm('Are you sure you want to remove your profile picture?')) return;
    run('remove-photo', async () => {
      await apiFetch('/profile/avatar', { method: 'DELETE' });
      setProfile({ ...profile, avatar_url: null });
      setOk('Profile picture removed.');
    });
  };

  const enablePush = () => {
    if (!import.meta.env.VITE_ONESIGNAL_APP_ID) {
      return setPushMsg('Push notifications are not configured for this deployment.');
    }
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async OneSignal => {
      try {
        await OneSignal.Notifications.requestPermission();
        setPushMsg('Push notifications enabled successfully!');
      } catch {
        setPushMsg('Could not enable notifications on this device.');
      }
    });
  };

  const isStudent = profile?.role === 'student';
  const roleLabel = isStudent
    ? (profile?.level ? `Level ${profile.level} Student` : 'Student')
    : profile?.role === 'hod' ? 'Head of Department'
    : profile?.role === 'lecturer' ? 'Lecturer'
    : 'Class Representative';

  const formattedStudentId = profile?.student_id
    ? (profile.student_id.startsWith('STU') ? profile.student_id : `STU-2025-${String(profile.student_id).padStart(4, '0')}`)
    : profile?.username || 'STU-2025-0147';

  const academicYear = (profile?.academic_year || '2026/2027').replace(/\s*academic\s*year/i, '').trim();
  const semesterName = profile?.semester === 2 ? 'Second Semester' : 'First Semester';
  const studentProgramme = profile?.programme || 'Degree';
  const studentLevel = profile?.level || 1;

  // Student email fallback
  const studentEmail = profile?.email && !profile.email.endsWith('@dept.app')
    ? profile.email
    : `${(profile?.full_name || 'student').toLowerCase().replace(/\s+/g, '.')}@mmu.sl`;

  if (generatedRecoveryData) {
    return (
      <RecoveryCodeScreen
        code={generatedRecoveryData.code}
        studentName={generatedRecoveryData.studentName}
        studentId={generatedRecoveryData.studentId}
        title="Your New Recovery Code"
        onContinue={() => setGeneratedRecoveryData(null)}
      />
    );
  }

  return (
    <div className="account-page-wrapper max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-6">
      {/* 1. Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
        <Link to="/" className="text-primary hover:underline">Home</Link>
        <span>›</span>
        <span className="text-slate-800 font-semibold">My Profile</span>
      </div>

      {/* 2. Page Header & Top Quote */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Profile</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            View and manage your personal and academic information.
          </p>
        </div>

        {/* Top-Right Inspirational Quote Pill */}
        <div className="flex items-center gap-2.5 px-4 py-2 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 border border-blue-100 rounded-2xl text-xs text-slate-700 shadow-sm self-start sm:self-center">
          <GraduationCap size={18} className="text-primary shrink-0" />
          <span className="font-medium italic text-slate-600">
            "Your information is important. Keep it up to date."
          </span>
        </div>
      </div>

      {/* Hidden file inputs for photo upload and camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* 3. Hero Profile Banner */}
      <div className="bg-gradient-to-r from-blue-50/90 via-sky-50/50 to-blue-50/80 rounded-2xl p-6 border border-blue-100/90 shadow-sm relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5 relative z-10">
          {/* Avatar with Camera Overlay */}
          <div className="relative group">
            <Avatar user={profile} size={88} className="ring-4 ring-white shadow-md rounded-full object-cover" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute bottom-0 right-0 p-2 bg-primary text-white rounded-full shadow-md hover:bg-primary-dark transition-transform hover:scale-110"
              title="Change photo"
            >
              <Camera size={14} />
            </button>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight">
                {profile?.full_name}
              </h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-primary border border-blue-200">
                {roleLabel}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Active
              </span>
            </div>

            <div className="space-y-0.5 text-xs text-slate-600">
              <p className="font-medium text-slate-700">
                Student ID: <strong className="font-mono text-slate-900">{formattedStudentId}</strong>
              </p>
              <p>
                Department: <strong className="text-slate-900">Computer Science</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Watermark Campus Illustration on Right */}
        <div className="hidden lg:flex flex-col items-end opacity-20 pr-4 select-none pointer-events-none">
          <span className="text-[11px] font-bold tracking-widest text-primary uppercase">
            Better Learning • Brighter Future
          </span>
          <Building2 size={88} className="text-primary mt-1" />
        </div>
      </div>

      {/* 4. Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Tabs & Details */}
        <div className="lg:col-span-8 space-y-5">
          {/* Tabs bar */}
          <div className="flex items-center gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200/80 w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('personal')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'personal'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User size={14} /> Personal Information
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('academic')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'academic'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen size={14} /> Academic Information
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('contact')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'contact'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Phone size={14} /> Contact Information
            </button>
          </div>

          {/* TAB 1: Personal Information */}
          {activeTab === 'personal' && (
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Personal Information</h3>
                <p className="text-xs text-slate-500 mt-0.5">Your basic information and identity details.</p>
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                {/* Full Name */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <User size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Full Name</span>
                  </div>
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <span>{profile?.full_name}</span>
                  </div>
                </div>

                {/* Role */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldCheck size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Role</span>
                  </div>
                  <span className="font-bold text-slate-900">
                    {profile?.role === 'student' ? 'Student' : roleLabel}
                  </span>
                </div>

                {/* Student ID */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <BookOpen size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Student ID</span>
                  </div>
                  <span className="font-mono font-bold text-slate-900">
                    {profile?.student_id || '8409'}
                  </span>
                </div>

                {/* Phone Number */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Phone size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Phone Number</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900">
                      {profile?.phone_number || '23273274723'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const val = prompt('Update Phone Number:', profile?.phone_number || '');
                        if (val) {
                          apiFetch('/profile', { method: 'PATCH', body: { phone_number: val } })
                            .then(() => setProfile({ ...profile, phone_number: val }))
                            .catch(e => alert(e.message));
                        }
                      }}
                      className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition"
                      title="Edit Phone"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Email Address */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Mail size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Email Address</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{studentEmail}</span>
                  </div>
                </div>

                {/* Programme */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <GraduationCap size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Programme</span>
                  </div>
                  <span className="font-bold text-slate-900">{studentProgramme}</span>
                </div>

                {/* Level */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Layers size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Level</span>
                  </div>
                  <span className="font-bold text-slate-900">{studentLevel}</span>
                </div>

                {/* Department */}
                <div className="py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 size={16} className="text-slate-400" />
                    <span className="font-semibold text-slate-600">Department</span>
                  </div>
                  <span className="font-bold text-slate-900">Computer Science</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Academic Information */}
          {activeTab === 'academic' && (
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-5">
              <div>
                <h3 className="text-base font-bold text-slate-900">Academic Information</h3>
                <p className="text-xs text-slate-500 mt-0.5">Enrolled degree programme, academic year, and curriculum progress.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1">Academic Year</span>
                  <strong className="text-sm text-slate-900">{academicYear}</strong>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1">Active Semester</span>
                  <strong className="text-sm text-primary">{semesterName}</strong>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1">Enrolled Programme</span>
                  <strong className="text-sm text-slate-900">{studentProgramme}</strong>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1">Current Year / Level</span>
                  <strong className="text-sm text-slate-900">Level {studentLevel}</strong>
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1">Registered Modules</span>
                  <strong className="text-sm text-slate-900">5 Modules Active</strong>
                </div>

                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                  <span className="text-emerald-700 block mb-1">Attendance Standing</span>
                  <strong className="text-sm text-emerald-800">Good Standing (&gt;75%)</strong>
                </div>
              </div>

              <div className="pt-2">
                <Link
                  to="/profile"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-dark transition shadow-sm"
                >
                  <BookOpen size={14} /> View My Registered Modules
                </Link>
              </div>
            </div>
          )}

          {/* TAB 3: Contact Information */}
          {activeTab === 'contact' && (
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4 text-xs">
              <div>
                <h3 className="text-base font-bold text-slate-900">Contact Information</h3>
                <p className="text-xs text-slate-500 mt-0.5">Campus directory and emergency communications.</p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1 font-semibold">Campus Location</span>
                  <span className="text-slate-800">Main Campus, Goderich, Freetown, Sierra Leone</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1 font-semibold">Department Office</span>
                  <span className="text-slate-800">Faculty of Engineering & Technology, CS Department Block</span>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 block mb-1 font-semibold">Department Hotline</span>
                  <span className="text-slate-800">+232 76 000000 / cs-dept@mmu.edu.sl</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (4 cols): Profile Photo, Quick Actions & Account Info */}
        <div className="lg:col-span-4 space-y-5">
          {/* Card 1: Profile Photo */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col items-center text-center">
            <h4 className="font-bold text-slate-900 text-sm mb-4 self-start">Profile Photo</h4>

            <div className="mb-4">
              <Avatar user={profile} size={96} className="ring-4 ring-slate-100 shadow-sm rounded-full object-cover" />
            </div>

            <div className="w-full space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={Boolean(busy)}
                className="w-full py-2.5 px-4 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-dark transition shadow-sm flex items-center justify-center gap-1.5"
              >
                <Upload size={14} /> Upload Photo
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={Boolean(busy)}
                className="w-full py-2.5 px-4 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition flex items-center justify-center gap-1.5"
              >
                <Camera size={14} /> Take Photo
              </button>

              {profile?.avatar_url && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="w-full py-1.5 text-red-600 hover:text-red-700 text-xs font-medium"
                >
                  Remove Photo
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-400 mt-3">
              Supported formats: JPG, PNG (Max 2MB)
            </p>
          </div>

          {/* Card 2: Quick Actions */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-2">
            <h4 className="font-bold text-slate-900 text-sm mb-3">Quick Actions</h4>

            {/* Enable Push Notifications */}
            <button
              type="button"
              onClick={enablePush}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-emerald-50/60 hover:bg-emerald-50 border border-emerald-100/80 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
                  <BellRing size={16} />
                </div>
                <div>
                  <h5 className="font-bold text-xs text-emerald-950">Enable Push Notifications</h5>
                  <span className="text-[10px] text-emerald-700">Get notified about important updates</span>
                </div>
              </div>
              <ChevronRight size={15} className="text-emerald-500 group-hover:translate-x-0.5 transition-transform" />
            </button>
            {pushMsg && <p className="text-[11px] text-emerald-600 pl-1">{pushMsg}</p>}

            {/* Change Password */}
            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-blue-50/60 hover:bg-blue-50 border border-blue-100/80 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 text-blue-700">
                  <KeyRound size={16} />
                </div>
                <div>
                  <h5 className="font-bold text-xs text-blue-950">Change Password</h5>
                  <span className="text-[10px] text-blue-700">Keep your account secure</span>
                </div>
              </div>
              <ChevronRight size={15} className="text-blue-500 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* New Recovery Code (Students only) */}
            {profile?.role === 'student' && (
              <button
                type="button"
                onClick={() => {
                  setShowRecoveryModal(true);
                  setRecoveryPassword('');
                  setRecoveryError('');
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-purple-50/60 hover:bg-purple-50 border border-purple-100/80 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 text-purple-700">
                    <ShieldAlert size={16} />
                  </div>
                  <div>
                    <h5 className="font-bold text-xs text-purple-950">New Recovery Code</h5>
                    <span className="text-[10px] text-purple-700">Invalidates old code & creates new one</span>
                  </div>
                </div>
                <ChevronRight size={15} className="text-purple-500 group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}

            {/* Sign Out */}
            <button
              type="button"
              onClick={() => setShowSignOutConfirm(true)}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-red-50/60 hover:bg-red-50 border border-red-100/80 transition-all text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-100 text-red-700">
                  <LogOut size={16} />
                </div>
                <div>
                  <h5 className="font-bold text-xs text-red-950">Sign Out</h5>
                  <span className="text-[10px] text-red-700">Disconnect from this device</span>
                </div>
              </div>
              <ChevronRight size={15} className="text-red-500 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Card 3: Account Information */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3 text-xs">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <Shield size={16} className="text-primary" />
              <h4 className="font-bold text-slate-900 text-sm">Account Information</h4>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500">Account Status</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Active
              </span>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500">Last Login</span>
              <span className="font-medium text-slate-800">
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, 09:42 AM
              </span>
            </div>

            <div className="flex items-center justify-between py-1">
              <span className="text-slate-500">Created On</span>
              <span className="font-medium text-slate-800">15 Aug 2025</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Sign Out */}
      {showSignOutConfirm && (
        <Modal title="Sign Out Confirmation" onClose={() => setShowSignOutConfirm(false)}>
          <div className="p-1 text-slate-700">
            <div className="flex items-center gap-3.5 mb-4 p-3 bg-red-50 rounded-xl text-red-800 border border-red-100">
              <div className="p-2 bg-red-100 text-red-600 rounded-lg shrink-0">
                <LogOut size={22} />
              </div>
              <div>
                <h4 className="font-bold text-sm text-red-900">Disconnect Session?</h4>
                <p className="text-xs text-red-700 mt-0.5">
                  Are you sure you want to sign out of the Milton Margai CS Attendance System?
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Your offline attendance drafts and queued synchronizations are securely cached locally, but you will need to sign in again to mark live attendance or review department records.
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                onClick={() => setShowSignOutConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors shadow-sm flex items-center gap-1.5"
                onClick={signOut}
              >
                <LogOut size={15} /> Yes, Sign Out
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <Modal title="Change Account Password" onClose={() => setShowPasswordModal(false)}>
          <div className="p-1">
            <p className="text-xs text-slate-500 mb-4">
              Enter your current password and choose a new, strong password with at least 8 characters.
            </p>
            <ChangePasswordForm onDone={() => setShowPasswordModal(false)} />
          </div>
        </Modal>
      )}

      {/* Generate New Recovery Code Modal (Students only) */}
      {showRecoveryModal && (
        <Modal title="Generate New Recovery Code" onClose={() => setShowRecoveryModal(false)}>
          <form onSubmit={handleRegenerateRecoveryCode}>
            <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: 12, color: '#854d0e', lineHeight: 1.5 }}>
              <strong>Notice:</strong> Generating a new recovery code will immediately invalidate your previous code. Enter your current password to proceed.
            </div>

            <Field label="Current Password">
              <input
                type="password"
                className="input-field"
                placeholder="Enter your current password"
                value={recoveryPassword}
                onChange={e => setRecoveryPassword(e.target.value)}
                required
                autoFocus
              />
            </Field>

            {recoveryError && <ErrorText>{recoveryError}</ErrorText>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="secondary" onClick={() => setShowRecoveryModal(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={recoveryBusy || !recoveryPassword}>
                {recoveryBusy ? 'Generating…' : 'Generate New Code'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
