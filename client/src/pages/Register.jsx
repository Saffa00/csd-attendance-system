import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye, EyeOff, ArrowRight, CheckCircle2
} from 'lucide-react';
import { apiFetch } from '../api';
import { PROGRAMMES, PROGRAMME_LABELS, LEVEL_LABELS, SEMESTERS, SEMESTER_LABELS, getLevelsForProgramme, PROGRAMME_DURATIONS } from '../config';
import { ErrorText, useAction } from '../ui';
import RecoveryCodeScreen from '../components/RecoveryCodeScreen';

export default function Register() {
  const [formData, setFormData] = useState({
    full_name: '',
    student_id: '',
    phone_number: '',
    programme: 'Degree',
    level: 1,
    semester: 1,
    password: '',
    confirm: ''
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [registrationResult, setRegistrationResult] = useState(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const { busy, error, run, setError } = useAction();

  // Restriction: letter only on full name
  const handleNameChange = e => {
    const clean = e.target.value.replace(/[^a-zA-Z\s'-]/g, '');
    setFormData(prev => ({ ...prev, full_name: clean }));
  };

  // Restriction: numbers only on student ID
  const handleStudentIdChange = e => {
    const clean = e.target.value.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, student_id: clean }));
  };

  // Restriction: numbers only on phone number
  const handlePhoneChange = e => {
    const clean = e.target.value.replace(/\D/g, '');
    setFormData(prev => ({ ...prev, phone_number: clean }));
  };

  const handleProgrammeChange = e => {
    const prog = e.target.value;
    const allowed = getLevelsForProgramme(prog);
    const lvl = allowed.includes(Number(formData.level)) ? Number(formData.level) : allowed[0];
    setFormData(prev => ({ ...prev, programme: prog, level: lvl }));
  };

  const handleChange = e => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (formData.password.length < 8) {
      return setError('Password must be at least 8 characters long.');
    }
    // Password must contain both letters and numbers
    if (!/[a-zA-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
      return setError('Password must contain both letters and numbers (cannot be letters only or numbers only).');
    }
    if (formData.password !== formData.confirm) {
      return setError('Passwords do not match. Please re-enter.');
    }

    const { confirm, ...payload } = formData;
    const res = await run('register', () =>
      apiFetch('/auth/register', {
        method: 'POST',
        body: {
          ...payload,
          level: Number(formData.level),
          semester: Number(formData.semester)
        }
      })
    );
    if (res) setRegistrationResult(res);
  };

  if (registrationResult?.recovery_code && !recoveryAcknowledged) {
    return (
      <RecoveryCodeScreen
        code={registrationResult.recovery_code}
        studentName={registrationResult.student_name || formData.full_name}
        studentId={registrationResult.student_id || formData.student_id}
        title="Save Your Recovery Code"
        onContinue={() => setRecoveryAcknowledged(true)}
      />
    );
  }

  if (registrationResult) {
    const hasId = Boolean(formData.student_id?.trim());
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div className="auth-logo-wrap">
            <div className="auth-success-badge">
              <CheckCircle2 size={40} color="#16834b" />
            </div>
            <h1 className="auth-title">Registration Submitted</h1>
            <p className="auth-subtitle">Milton Margai Technical University — Computer Science</p>
          </div>

          <div className="credential" style={{ margin: '18px 0', textAlign: 'left', background: '#f8fafc' }}>
            <p style={{ margin: '0 0 8px', color: '#16834b', fontWeight: 650 }}>
              {registrationResult.message}
            </p>
            <div style={{ fontSize: 13, color: '#334e68', lineHeight: 1.6 }}>
              <div><strong>Name:</strong> {formData.full_name}</div>
              <div><strong>Programme:</strong> {formData.programme}</div>
              <div><strong>Academic Level:</strong> Year {formData.level}</div>
              <div><strong>Semester:</strong> {SEMESTER_LABELS[formData.semester] || `Semester ${formData.semester}`}</div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
                <strong>Login credentials:</strong>{' '}
                {hasId ? (
                  <>Student ID: <code>{formData.student_id}</code> + your password</>
                ) : (
                  <>Full name: <code>{formData.full_name}</code> + your password</>
                )}
              </div>
            </div>
          </div>

          <Link to="/login" className="auth-submit-btn" style={{ textDecoration: 'none' }}>
            Proceed to Sign In <ArrowRight size={17} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide">
        <div className="auth-logo-wrap">
          <img
            src="/logo.png"
            alt="Milton Margai Technical University - Computer Science Department"
            className="auth-university-logo"
          />
          <span className="auth-portal-badge">STUDENT ADMISSION</span>
          <h1 className="auth-title">Student Registration</h1>
          <p className="auth-subtitle">Milton Margai Technical University — Computer Science</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form register-form">
          {/* Full Name: Letters Only */}
          <div className="input-group">
            <label className="input-label" htmlFor="full_name">
              Full Name <span className="input-type-tag"></span>
            </label>
            <div className="input-wrapper">
              <input
                id="full_name"
                name="full_name"
                type="text"
                className="input-field"
                placeholder="e.g. Peter M J Saffa"
                value={formData.full_name}
                onChange={handleNameChange}
                required
                minLength={3}
                autoComplete="name"
              />
            </div>
          </div>

          {/* Student ID: Numbers Only (Optional) */}
          <div className="input-group">
            <label className="input-label" htmlFor="student_id">
              Student ID <span className="optional-tag">(Optional)</span>
            </label>
            <div className="input-wrapper">
              <input
                id="student_id"
                name="student_id"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="input-field"
                placeholder="e.g. 8000 (leave empty if no ID yet)"
                value={formData.student_id}
                onChange={handleStudentIdChange}
              />
            </div>
            <small className="input-hint">If you don't have an ID yet, you will log in using your Full Name.</small>
          </div>

          {/* Phone Number: Numbers Only */}
          <div className="input-group">
            <label className="input-label" htmlFor="phone_number">
              Phone Number <span className="input-type-tag"></span>
            </label>
            <div className="input-wrapper">
              <input
                id="phone_number"
                name="phone_number"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                className="input-field"
                placeholder="e.g. 23230231858"
                value={formData.phone_number}
                onChange={handlePhoneChange}
                required
              />
            </div>
          </div>

          {/* Programme Dropdown: Degree, Diploma, HND */}
          <div className="input-group">
            <label className="input-label" htmlFor="programme">
              Programme
            </label>
            <div className="input-wrapper">
              <select
                id="programme"
                name="programme"
                className="input-field select-field"
                value={formData.programme}
                onChange={handleProgrammeChange}
                required
              >
                <option value="Degree">Degree (Year 1 to 4)</option>
                <option value="Diploma">Diploma (Year 1 to 2)</option>
                <option value="HND">HND (Year 1 to 3)</option>
              </select>
            </div>
          </div>

          {/* Academic Year & Semester Side-by-Side Grid */}
          <div className="form-grid">
            <div className="input-group">
              <label className="input-label" htmlFor="level">Academic Year</label>
              <div className="input-wrapper">
                <select
                  id="level"
                  name="level"
                  className="input-field select-field"
                  value={formData.level}
                  onChange={handleChange}
                  required
                >
                  {getLevelsForProgramme(formData.programme).map(lvl => (
                    <option key={lvl} value={lvl}>
                      {LEVEL_LABELS[lvl] || `Year ${lvl}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="semester">Semester</label>
              <div className="input-wrapper">
                <select
                  id="semester"
                  name="semester"
                  className="input-field select-field"
                  value={formData.semester}
                  onChange={handleChange}
                  required
                >
                  {SEMESTERS.map(s => (
                    <option key={s} value={s}>
                      {SEMESTER_LABELS[s] || `Semester ${s}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Password: Must contain both letters and numbers */}
          <div className="input-group">
            <label className="input-label" htmlFor="password">
              Password <span className="input-type-tag">(Letters & numbers)</span>
            </label>
            <div className="input-wrapper">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                className="input-field"
                placeholder="Min 8 characters "
                value={formData.password}
                onChange={handleChange}
                minLength={8}
                autoComplete="new-password"
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
            <small className="input-hint">Must contain at least 8 characters with both letters and numbers.</small>
          </div>

          {/* Confirm Password */}
          <div className="input-group">
            <label className="input-label" htmlFor="confirm">Confirm Password</label>
            <div className="input-wrapper">
              <input
                id="confirm"
                name="confirm"
                type={showConfirm ? 'text' : 'password'}
                className="input-field"
                placeholder="Re-enter password"
                value={formData.confirm}
                onChange={handleChange}
                minLength={8}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirm(!showConfirm)}
                tabIndex={-1}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <ErrorText>{error}</ErrorText>

          <button type="submit" className="auth-submit-btn" disabled={busy === 'register'}>
            {busy === 'register' ? (
              <span className="btn-spinner-wrap">
                <span className="spinner-mini" /> Submitting registration…
              </span>
            ) : (
              <>Register Account <ArrowRight size={17} /></>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p className="auth-footer-text">
            Already registered?{' '}
            <Link to="/login" className="auth-link">
              Sign in to your account
            </Link>
          </p>
          <p className="auth-help-text">
            Note: HOD, Lecturers, and Class Representatives do not register here. Their accounts are created by the Head of Department.
          </p>
        </div>
      </div>
    </div>
  );
}
