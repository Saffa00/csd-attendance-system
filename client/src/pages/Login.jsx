import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, GraduationCap, ArrowRight, ShieldCheck, KeyRound, Sparkles, UserCheck } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { ErrorText, useAction, Modal, Field, Success } from '../ui';
import RecoveryCodeScreen from '../components/RecoveryCodeScreen';

export default function Login() {
  const { signIn, isConfigured } = useAuth();
  const nav = useNavigate();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, run } = useAction();

  // Forgot password modal state
  const [forgotModal, setForgotModal] = useState(false);
  const [forgotTab, setForgotTab] = useState('code'); // 'code' | 'rep'
  const [forgotIdentity, setForgotIdentity] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffOrStudent, setStaffOrStudent] = useState('staff'); // 'staff' | 'student'
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const [forgotError, setForgotError] = useState('');

  // New recovery code screen data after using a recovery code
  const [newRecoveryData, setNewRecoveryData] = useState(null);

  const handleSubmit = async e => {
    e.preventDefault();
    const profile = await run('login', () => signIn(identity.trim(), password));
    if (profile) nav('/', { replace: true });
  };

  // Option 1: Reset with recovery code (Students only)
  const handleRecoveryCodeSubmit = async e => {
    e.preventDefault();
    setForgotError('');
    setForgotMessage('');

    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return setForgotError('New password must contain both letters and numbers.');
    }
    if (newPassword.length < 8) {
      return setForgotError('New password must be at least 8 characters long.');
    }
    if (newPassword !== confirmPassword) {
      return setForgotError('Passwords do not match. Please re-enter.');
    }

    setForgotBusy(true);
    try {
      const res = await apiFetch('/auth/reset-with-recovery-code', {
        method: 'POST',
        body: {
          identity: forgotIdentity.trim(),
          recovery_code: recoveryCodeInput.trim(),
          new_password: newPassword
        }
      });

      if (res?.new_recovery_code) {
        setNewRecoveryData({
          code: res.new_recovery_code,
          studentName: res.student_name || 'Student',
          studentId: res.student_id || forgotIdentity.trim()
        });
        setForgotModal(false);
      } else {
        setForgotMessage('Password reset successfully! You can now sign in.');
      }
    } catch (err) {
      setForgotError(err.message || 'Could not reset password with recovery code.');
    } finally {
      setForgotBusy(false);
    }
  };

  // Option 2: Ask class rep or HOD (Staff or Student)
  const handleRepForgotSubmit = async e => {
    e.preventDefault();
    setForgotBusy(true);
    setForgotError('');
    setForgotMessage('');
    try {
      if (staffOrStudent === 'staff') {
        if (!forgotIdentity.trim()) return setForgotError('Please enter your staff username (e.g. LEC-0001, REP-0001)');
        if (!staffPhone.trim()) return setForgotError('Please enter your registered phone number');
        const res = await apiFetch('/auth/staff-forgot-password', {
          method: 'POST',
          body: {
            username: forgotIdentity.trim(),
            phone_number: staffPhone.trim()
          }
        });
        setForgotMessage(res.message || 'Password reset request submitted to HOD.');
      } else {
        const res = await apiFetch('/auth/forgot-password', {
          method: 'POST',
          body: { identity: forgotIdentity.trim() }
        });
        setForgotMessage(res.message || 'Password reset request processed.');
      }
    } catch (err) {
      setForgotError(err.message || 'Could not process password reset request.');
    } finally {
      setForgotBusy(false);
    }
  };

  if (newRecoveryData) {
    return (
      <RecoveryCodeScreen
        code={newRecoveryData.code}
        studentName={newRecoveryData.studentName}
        studentId={newRecoveryData.studentId}
        title="Save Your New Recovery Code"
        onContinue={() => {
          const prefill = newRecoveryData.studentId || newRecoveryData.studentName || '';
          setNewRecoveryData(null);
          setForgotModal(false);
          setIdentity(prefill);
          setPassword('');
          setForgotMessage('');
          setForgotError('');
        }}
      />
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Centered Milton Margai Technical University CS Logo */}
        <div className="auth-logo-wrap">
          <img
            src="/logo.png"
            alt="Milton Margai Technical University - Computer Science Department"
            className="auth-university-logo"
          />
          <span className="auth-portal-badge">STUDENT & STAFF PORTAL</span>
          <h1 className="auth-title">Milton Margai Technical University</h1>
          <p className="auth-subtitle">Computer Science Department Attendance System</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group">
            <label className="input-label" htmlFor="identity">Username, Student ID, Phone or Full Name</label>
            <div className="input-wrapper">
              <input
                id="identity"
                type="text"
                className="input-field"
                placeholder="e.g. LEC-0001, REP-0002, 8000, 23280..., or Full Name"
                value={identity}
                onChange={e => setIdentity(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            </div>
          </div>

          <div className="input-group">
            <div className="label-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="input-label" htmlFor="password">Password</label>
              <button
                type="button"
                className="auth-link"
                onClick={() => {
                  setForgotModal(true);
                  setForgotTab('code');
                  setForgotMessage('');
                  setForgotError('');
                }}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
              >
                Forgot password?
              </button>
            </div>
            <div className="input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <ErrorText>{error}</ErrorText>

          <button type="submit" className="auth-submit-btn" disabled={busy === 'login'}>
            {busy === 'login' ? (
              <span className="btn-spinner-wrap">
                <span className="spinner-mini" /> Signing in…
              </span>
            ) : (
              <>Sign In <ArrowRight size={17} /></>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p className="auth-footer-text">
            New student?{' '}
            <Link to="/register" className="auth-link">
              Create an account
            </Link>
          </p>
        </div>

        {/* Forgot Password Modal with Two Clear Options */}
        {forgotModal && (
          <Modal title="Password Assistance & Reset" onClose={() => setForgotModal(false)}>
            {/* Two Options Navigation Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16, background: '#f1f5f9', padding: 4, borderRadius: 12 }}>
              <button
                type="button"
                onClick={() => { setForgotTab('code'); setForgotError(''); setForgotMessage(''); }}
                style={{
                  padding: '9px 12px',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  background: forgotTab === 'code' ? '#ffffff' : 'transparent',
                  color: forgotTab === 'code' ? '#0f172a' : '#64748b',
                  boxShadow: forgotTab === 'code' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <KeyRound size={15} color={forgotTab === 'code' ? '#059669' : '#64748b'} />
                I have my recovery code
              </button>

              <button
                type="button"
                onClick={() => { setForgotTab('rep'); setForgotError(''); setForgotMessage(''); }}
                style={{
                  padding: '9px 12px',
                  borderRadius: 9,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  background: forgotTab === 'rep' ? '#ffffff' : 'transparent',
                  color: forgotTab === 'rep' ? '#0f172a' : '#64748b',
                  boxShadow: forgotTab === 'rep' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <UserCheck size={15} color={forgotTab === 'rep' ? '#2563eb' : '#64748b'} />
                Ask Rep or HOD
              </button>
            </div>

            {forgotTab === 'code' ? (
              /* Option 1: Self-Service with Recovery Code (Students only) */
              <form onSubmit={handleRecoveryCodeSubmit}>
                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: '#065f46', lineHeight: 1.5 }}>
                  <strong>Student Self-Service:</strong> If you forget your password, your recovery code lets you set a new one yourself. Recovery codes are for students only.
                </div>

                <Field label="Student ID, Phone or Full Name">
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. 8000, 23276000000, or Mohamed Kamara"
                    value={forgotIdentity}
                    onChange={e => setForgotIdentity(e.target.value)}
                    required
                    autoFocus
                  />
                </Field>

                <Field label="Your Recovery Code">
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. RC-4A7B-9E2D-3F8K"
                    value={recoveryCodeInput}
                    onChange={e => setRecoveryCodeInput(e.target.value)}
                    style={{ fontFamily: 'monospace', letterSpacing: '1px', fontWeight: 650 }}
                    required
                  />
                </Field>

                <Field label="New Password (min 8 chars, letters & numbers)">
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      className="input-field"
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      tabIndex={-1}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                    >
                      {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>

                <Field label="Confirm New Password">
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                  />
                </Field>

                {forgotError && <ErrorText>{forgotError}</ErrorText>}
                {forgotMessage && <Success>{forgotMessage}</Success>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button type="button" className="secondary" onClick={() => setForgotModal(false)}>Cancel</button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={forgotBusy || !forgotIdentity.trim() || !recoveryCodeInput.trim() || !newPassword}
                  >
                    {forgotBusy ? 'Resetting…' : 'Reset Password & Get New Code'}
                  </button>
                </div>
              </form>
            ) : (
              /* Option 2: Ask Class Rep or HOD (Staff: Lecturer/Class Rep vs Student) */
              <form onSubmit={handleRepForgotSubmit}>
                {/* Account Type Toggle */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button
                    type="button"
                    onClick={() => { setStaffOrStudent('staff'); setForgotError(''); setForgotMessage(''); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 650,
                      cursor: 'pointer',
                      border: staffOrStudent === 'staff' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      background: staffOrStudent === 'staff' ? '#eff6ff' : '#ffffff',
                      color: staffOrStudent === 'staff' ? '#1e40af' : '#475569'
                    }}
                  >
                    Staff (Lecturer / Class Rep)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStaffOrStudent('student'); setForgotError(''); setForgotMessage(''); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 650,
                      cursor: 'pointer',
                      border: staffOrStudent === 'student' ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      background: staffOrStudent === 'student' ? '#eff6ff' : '#ffffff',
                      color: staffOrStudent === 'student' ? '#1e40af' : '#475569'
                    }}
                  >
                    Student (Ask Rep / HOD)
                  </button>
                </div>

                {staffOrStudent === 'staff' ? (
                  <>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
                      <strong>Staff Reset:</strong> Lecturers and class representatives request a reset using their <strong>username</strong> and registered <strong>phone number</strong>. Only the HOD can approve this. Recovery codes are for students only.
                    </div>

                    <Field label="Staff Username">
                      <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. LEC-0001 or REP-0001"
                        value={forgotIdentity}
                        onChange={e => setForgotIdentity(e.target.value)}
                        autoFocus
                        required
                      />
                    </Field>

                    <Field label="Registered Phone Number" hint="Must match phone on file. If changed, visit HOD in person to update it first.">
                      <input
                        type="tel"
                        className="input-field"
                        placeholder="e.g. +232 76 123456"
                        value={staffPhone}
                        onChange={e => setStaffPhone(e.target.value)}
                        required
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <p className="muted small" style={{ marginBottom: 14 }}>
                      If you don't have your recovery code, enter your Student ID or Full Name. Your Class Representative or the HOD will issue you a temporary password.
                    </p>

                    <Field label="Student ID, Phone or Full Name">
                      <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. 8000, 23276..., or Mohamed Kamara"
                        value={forgotIdentity}
                        onChange={e => setForgotIdentity(e.target.value)}
                        autoFocus
                        required
                      />
                    </Field>
                  </>
                )}

                {forgotError && <ErrorText>{forgotError}</ErrorText>}
                {forgotMessage && <Success>{forgotMessage}</Success>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button type="button" className="secondary" onClick={() => setForgotModal(false)}>Close</button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={forgotBusy || !forgotIdentity.trim() || (staffOrStudent === 'staff' && !staffPhone.trim())}
                  >
                    {forgotBusy ? 'Submitting…' : staffOrStudent === 'staff' ? 'Submit to HOD' : 'Submit Request'}
                  </button>
                </div>
              </form>
            )}
          </Modal>
        )}
      </div>
    </div>
  );
}
