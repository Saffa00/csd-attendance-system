import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, GraduationCap, ArrowRight, ArrowLeft, ShieldCheck, KeyRound, Sparkles, UserCheck } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { ErrorText, useAction, Field, Success } from '../ui';
import RecoveryCodeScreen from '../components/RecoveryCodeScreen';

export default function Login() {
  const { signIn, isConfigured } = useAuth();
  const nav = useNavigate();
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, run } = useAction();

  // Forgot password screen state
  const [showForgot, setShowForgot] = useState(false);
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
        setShowForgot(false);
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
          setShowForgot(false);
          setIdentity(prefill);
          setPassword('');
          setForgotMessage('');
          setForgotError('');
        }}
      />
    );
  }

  // FORGOT PASSWORD VIEW - Uses the exact same responsive container as Login
  if (showForgot) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          {/* Centered Milton Margai Technical University CS Logo */}
          <div className="auth-logo-wrap">
            <img
              src="/logo.png"
              alt="Milton Margai Technical University"
              className="auth-university-logo"
            />
            <span className="auth-portal-badge">Account Recovery</span>
            <h1 className="auth-title">Password Assistance</h1>
            <p className="auth-subtitle" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              Choose an option to regain access to your account
            </p>
          </div>

          {/* Two Options Navigation Tabs - Stacks vertically on screens under 480px */}
          <div className="recovery-options-grid">
            <button
              type="button"
              className={`recovery-option-btn ${forgotTab === 'code' ? 'active' : ''}`}
              onClick={() => { setForgotTab('code'); setForgotError(''); setForgotMessage(''); }}
            >
              <KeyRound size={16} />
              <span>I have my recovery code</span>
            </button>

            <button
              type="button"
              className={`recovery-option-btn ${forgotTab === 'rep' ? 'active' : ''}`}
              onClick={() => { setForgotTab('rep'); setForgotError(''); setForgotMessage(''); }}
            >
              <UserCheck size={16} />
              <span>Ask Rep or HOD</span>
            </button>
          </div>

          {forgotTab === 'code' ? (
            /* Option 1: Self-Service with Recovery Code (Students only) */
            <form onSubmit={handleRecoveryCodeSubmit} className="auth-form" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#065f46', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word', boxSizing: 'border-box' }}>
                <strong>Student Self-Service:</strong> If you forget your password, your recovery code lets you set a new one yourself. Recovery codes are for students only.
              </div>

              <div className="input-group">
                <label className="input-label">Student ID, Phone or Full Name</label>
                <input
                  type="text"
                  className="input-field"
                  style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
                  placeholder="e.g. 8000, 23276000000, or Mohamed Kamara"
                  value={forgotIdentity}
                  onChange={e => setForgotIdentity(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="input-group">
                <label className="input-label">Your Recovery Code</label>
                <input
                  type="text"
                  className="input-field recovery-code-input"
                  placeholder="e.g. RC-4A7B-9E2D-3F8K"
                  value={recoveryCodeInput}
                  onChange={e => setRecoveryCodeInput(e.target.value)}
                  required
                />
              </div>

              <div className="input-group">
                <label className="input-label">New Password (min 8 chars, letters & numbers)</label>
                <div className="input-wrapper">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    className="input-field"
                    style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
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
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Confirm New Password</label>
                <input
                  type="password"
                  className="input-field"
                  style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {forgotError && <ErrorText>{forgotError}</ErrorText>}
              {forgotMessage && <Success>{forgotMessage}</Success>}

              <div className="recovery-actions-row">
                <button
                  type="button"
                  className="secondary"
                  style={{ minHeight: '44px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                  onClick={() => { setShowForgot(false); setForgotError(''); setForgotMessage(''); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary auth-submit-btn"
                  style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                  disabled={forgotBusy || !forgotIdentity.trim() || !recoveryCodeInput.trim() || !newPassword}
                >
                  {forgotBusy ? 'Resetting…' : 'Reset Password & Get New Code'}
                </button>
              </div>
            </form>
          ) : (
            /* Option 2: Ask Class Rep or HOD (Staff: Lecturer/Class Rep vs Student) */
            <form onSubmit={handleRepForgotSubmit} className="auth-form" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
              <div className="recovery-subtabs-grid">
                <button
                  type="button"
                  className={`recovery-subtab-btn ${staffOrStudent === 'staff' ? 'active' : ''}`}
                  onClick={() => { setStaffOrStudent('staff'); setForgotError(''); setForgotMessage(''); }}
                >
                  Staff (Lecturer / Class Rep)
                </button>
                <button
                  type="button"
                  className={`recovery-subtab-btn ${staffOrStudent === 'student' ? 'active' : ''}`}
                  onClick={() => { setStaffOrStudent('student'); setForgotError(''); setForgotMessage(''); }}
                >
                  Student (Ask Rep / HOD)
                </button>
              </div>

              {staffOrStudent === 'staff' ? (
                <>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#334155', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word', boxSizing: 'border-box' }}>
                    <strong>Staff Reset:</strong> Lecturers and class representatives request a reset using their <strong>username</strong> and registered <strong>phone number</strong>. Only the HOD can approve this. Recovery codes are for students only.
                  </div>

                  <div className="input-group">
                    <label className="input-label">Staff Username</label>
                    <input
                      type="text"
                      className="input-field"
                      style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
                      placeholder="e.g. LEC-0001 or REP-0001"
                      value={forgotIdentity}
                      onChange={e => setForgotIdentity(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>

                  <div className="input-group">
                    <label className="input-label">Registered Phone Number</label>
                    <input
                      type="tel"
                      className="input-field recovery-phone-input"
                      placeholder="e.g. +232 76 123456"
                      value={staffPhone}
                      onChange={e => setStaffPhone(e.target.value)}
                      required
                    />
                    <small className="input-hint" style={{ overflowWrap: 'anywhere' }}>
                      Must match phone on file. If changed, visit HOD in person to update it first.
                    </small>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted small" style={{ margin: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    If you don't have your recovery code, enter your Student ID or Full Name. Your Class Representative or the HOD will issue you a temporary password.
                  </p>

                  <div className="input-group">
                    <label className="input-label">Student ID, Phone or Full Name</label>
                    <input
                      type="text"
                      className="input-field"
                      style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
                      placeholder="e.g. 8000, 23276..., or Mohamed Kamara"
                      value={forgotIdentity}
                      onChange={e => setForgotIdentity(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                </>
              )}

              {forgotError && <ErrorText>{forgotError}</ErrorText>}
              {forgotMessage && <Success>{forgotMessage}</Success>}

              <div className="recovery-actions-row">
                <button
                  type="button"
                  className="secondary"
                  style={{ minHeight: '44px', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                  onClick={() => { setShowForgot(false); setForgotError(''); setForgotMessage(''); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary auth-submit-btn"
                  style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}
                  disabled={forgotBusy || !forgotIdentity.trim() || (staffOrStudent === 'staff' && !staffPhone.trim())}
                >
                  {forgotBusy ? 'Submitting…' : staffOrStudent === 'staff' ? 'Submit to HOD' : 'Submit Request'}
                </button>
              </div>
            </form>
          )}

          <div className="auth-footer" style={{ marginTop: 20, textAlign: 'center' }}>
            <button
              type="button"
              className="auth-link"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => { setShowForgot(false); setForgotError(''); setForgotMessage(''); }}
            >
              <ArrowLeft size={15} /> Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // LOGIN VIEW - Standard responsive container
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

        <form onSubmit={handleSubmit} className="auth-form" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
          <div className="input-group">
            <label className="input-label" htmlFor="identity">Username, Student ID, Phone or Full Name</label>
            <div className="input-wrapper">
              <input
                id="identity"
                type="text"
                className="input-field"
                style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
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
                  setShowForgot(true);
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
                style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
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

          <button type="submit" className="auth-submit-btn" style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box' }} disabled={busy === 'login'}>
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
          <p className="auth-footer-text" style={{ overflowWrap: 'anywhere' }}>
            New student?{' '}
            <Link to="/register" className="auth-link">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
