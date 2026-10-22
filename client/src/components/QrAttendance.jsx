import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  QrCode,
  Maximize2,
  Minimize2,
  RefreshCw,
  Users,
  X,
  Camera,
  Flashlight,
  FlashlightOff,
  AlertCircle,
  CheckCircle2,
  MapPin,
  KeyRound,
  ShieldAlert
} from 'lucide-react';
import { apiFetch } from '../api';
import { getPosition } from '../geo';
import { queueAttendance } from '../offline';

// ===================================================================
// LECTURER: HIGH-CONTRAST FULL-SCREEN QR CODE MODAL
// ===================================================================
export function LecturerQrModal({ sessionId, classCode, onClose, onSwitchToCode }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(30);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // Fetch token function
  const fetchToken = async () => {
    try {
      const res = await apiFetch(`/sessions/${sessionId}/qr-token`);
      setData(res);
      setCountdown(res.expires_in_seconds || 30);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not fetch QR code token.');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchToken();
  }, [sessionId]);

  // 1-second countdown tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchToken();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionId]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#091e42',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        overflowY: 'auto'
      }}
    >
      {/* Top Header Bar */}
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                background: '#2563eb',
                color: '#fff',
                fontWeight: 800,
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 4
              }}
            >
              LIVE QR ATTENDANCE
            </span>
            <span style={{ fontSize: 13, color: '#93c5fd' }}>
              {data?.venue ? `📍 ${data.venue}` : '📍 Lecture Hall'}
            </span>
          </div>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, color: '#ffffff', fontWeight: 800 }}>
            {data?.module_code} {data?.module_title ? `· ${data.module_title}` : ''}
          </h2>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600
            }}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              padding: '8px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600
            }}
          >
            <X size={16} /> Close
          </button>
        </div>
      </div>

      {/* Main High-Contrast QR Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: isFullscreen ? 32 : 24,
          boxShadow: '0 20px 45px rgba(0,0,0,0.4)',
          textAlign: 'center',
          maxWidth: isFullscreen ? 520 : 440,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        {loading ? (
          <div style={{ padding: 60, color: '#1e293b' }}>
            <RefreshCw className="spin" size={40} style={{ margin: '0 auto 12px', color: '#2563eb' }} />
            <p style={{ fontWeight: 600 }}>Generating secure signed QR token…</p>
          </div>
        ) : error ? (
          <div style={{ padding: 40, color: '#b91c1c' }}>
            <ShieldAlert size={44} style={{ margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 700 }}>{error}</p>
            <button
              className="primary compact"
              onClick={fetchToken}
              style={{ marginTop: 12 }}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                background: '#ffffff',
                padding: 12,
                borderRadius: 16,
                display: 'inline-block'
              }}
            >
              <QRCodeSVG
                value={data.token}
                size={isFullscreen ? 360 : 280}
                level="H"
                includeMargin={true}
              />
            </div>

            {/* 30s Countdown Bar */}
            <div style={{ width: '100%', marginTop: 16 }}>
              <div
                style={{
                  height: 6,
                  width: '100%',
                  background: '#e2e8f0',
                  borderRadius: 4,
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(countdown / 30) * 100}%`,
                    background: countdown > 5 ? '#2563eb' : '#dc2626',
                    transition: 'width 1s linear'
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#475569'
                }}
              >
                <span>Refreshes automatically</span>
                <span style={{ color: countdown <= 5 ? '#dc2626' : '#2563eb', fontWeight: 800 }}>
                  ⏱️ {countdown}s
                </span>
              </div>
            </div>

            {/* Attendance Counter */}
            <div
              style={{
                marginTop: 14,
                padding: '10px 16px',
                borderRadius: 12,
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#166534',
                fontWeight: 700,
                fontSize: 15,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <Users size={18} />
              <span>{data.submitted_count} student(s) submitted</span>
            </div>
          </>
        )}
      </div>

      {/* Footer Fallback Controls */}
      <div
        style={{
          marginTop: 20,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}
      >
        <button
          type="button"
          onClick={onSwitchToCode}
          style={{
            background: 'rgba(255,255,255,0.12)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            padding: '10px 18px',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <KeyRound size={16} /> Switch to Class Code ({classCode || 'Code'})
        </button>
      </div>
    </div>
  );
}

// ===================================================================
// STUDENT: CAMERA QR SCANNER MODAL (Built-in html5-qrcode)
// ===================================================================
export function StudentQrScannerModal({
  openClass,
  profile,
  onClose,
  onSwitchToCode,
  onSuccess
}) {
  const [scanState, setScanState] = useState('initializing'); // 'initializing' | 'scanning' | 'processing' | 'success' | 'error'
  const [statusMessage, setStatusMessage] = useState('Initializing camera…');
  const [errorMessage, setErrorMessage] = useState('');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const scannerRef = useRef(null);
  const isScannedRef = useRef(false);

  // Initialize camera scanner
  useEffect(() => {
    isScannedRef.current = false;
    let html5QrCode = null;

    const startScanner = async () => {
      try {
        setScanState('initializing');
        setStatusMessage('Requesting camera permission…');
        html5QrCode = new Html5Qrcode('qr-camera-stream');
        scannerRef.current = html5QrCode;

        const config = {
          fps: 12,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        };

        await html5QrCode.start(
          { facingMode: 'environment' },
          config,
          async (decodedText) => {
            if (isScannedRef.current) return;
            isScannedRef.current = true;
            await handleQrScanSuccess(decodedText, html5QrCode);
          },
          () => {} // frame ignored
        );

        setScanState('scanning');
        setStatusMessage('Point your camera at the QR code on the screen');

        // Check torch capabilities
        try {
          const track = html5QrCode.getRunningTrackCameraCapabilities?.();
          if (track && track.torchFeature?.().isSupported?.()) {
            setTorchAvailable(true);
          }
        } catch (_) {}
      } catch (err) {
        setScanState('error');
        const errStr = String(err?.message || err);
        if (errStr.includes('NotAllowedError') || errStr.includes('Permission')) {
          setErrorMessage('Camera permission was denied. Please enable camera access in your browser site permissions, or tap below to enter the class code.');
        } else if (errStr.includes('NotFoundError') || errStr.includes('DevicesNotFoundError')) {
          setErrorMessage('No camera was detected on this device. Please tap below to enter the class code instead.');
        } else {
          setErrorMessage('Could not open camera stream: ' + errStr);
        }
      }
    };

    startScanner();

    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(() => {}).then(() => {
          try { html5QrCode.clear(); } catch (_) {}
        });
      }
    };
  }, []);

  // Torch toggle
  const toggleTorch = async () => {
    if (!scannerRef.current || !torchAvailable) return;
    try {
      const nextTorch = !torchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch }]
      });
      setTorchOn(nextTorch);
    } catch (_) {}
  };

  // On successful QR scan
  const handleQrScanSuccess = async (token, scanner) => {
    try {
      // 1. Stop camera immediately
      if (scanner && scanner.isScanning) {
        await scanner.stop().catch(() => {});
        try { scanner.clear(); } catch (_) {}
      }

      setScanState('processing');
      setStatusMessage('QR Scanned! Reading GPS coordinates…');

      // 2. Read GPS coordinates and accuracy
      const pos = await getPosition();

      setStatusMessage('Submitting attendance…');

      const payload = {
        method: 'qr',
        token: token.trim(),
        latitude: pos.latitude,
        longitude: pos.longitude,
        gps_accuracy_m: pos.gps_accuracy_m,
        client_timestamp: new Date().toISOString()
      };

      // 3. Offline check
      if (!navigator.onLine) {
        await queueAttendance(profile.id, payload);
        setScanState('success');
        setStatusMessage('Saved on this phone, Pending sync');
        setTimeout(() => onSuccess('Saved on this phone, Pending sync. It will submit automatically when online.'), 1600);
        return;
      }

      // 4. Online API submission
      try {
        await apiFetch('/attendance', {
          method: 'POST',
          body: { ...payload, submitted_offline: false }
        });
        setScanState('success');
        setStatusMessage('Attendance recorded successfully! Waiting for lecturer approval.');
        setTimeout(() => onSuccess('Attendance submitted successfully!'), 1600);
      } catch (err) {
        if (err.network) {
          await queueAttendance(profile.id, payload);
          setScanState('success');
          setStatusMessage('Connection lost: Saved on this phone, Pending sync.');
          setTimeout(() => onSuccess('Saved offline, pending automatic sync.'), 1600);
          return;
        }

        // Friendly error messages based on server rejection code
        setScanState('error');
        if (err.code === 'QR_EXPIRED') {
          setErrorMessage('This QR code has expired. Ask your lecturer to show the new QR.');
        } else if (err.code === 'WRONG_MODULE') {
          setErrorMessage('This QR is not for one of your modules.');
        } else if (err.code === 'ALREADY') {
          setErrorMessage('You have already submitted attendance for this session.');
        } else if (err.code === 'OUTSIDE_AREA') {
          setErrorMessage(err.message || 'You are outside the class venue area. Move closer to the classroom.');
        } else if (err.code === 'WEAK_GPS') {
          setErrorMessage('Weak GPS accuracy. Move to an open area and try again.');
        } else if (err.code === 'NOT_OPEN' || err.code === 'SESSION_CLOSED') {
          setErrorMessage('The lecturer has not opened this session, or it has closed.');
        } else {
          setErrorMessage(err.message || 'Submission failed. Please try again.');
        }
      }
    } catch (e) {
      setScanState('error');
      setErrorMessage(e.message || 'Could not verify location.');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#0a0f1d',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 16px',
        touchAction: 'none'
      }}
    >
      {/* Top Header */}
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 10
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f8fafc' }}>
            Scan Attendance QR
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94a3b8' }}>
            {openClass?.courses?.code || 'Class Session'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {torchAvailable && (
            <button
              type="button"
              onClick={toggleTorch}
              style={{
                background: torchOn ? '#f59e0b' : 'rgba(255,255,255,0.15)',
                color: torchOn ? '#000' : '#fff',
                border: 'none',
                padding: '8px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                fontWeight: 600
              }}
            >
              {torchOn ? <FlashlightOff size={16} /> : <Flashlight size={16} />}
              {torchOn ? 'Torch On' : 'Torch'}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Center Camera Viewport */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 340,
          aspectRatio: '1',
          borderRadius: 20,
          overflow: 'hidden',
          background: '#000',
          boxShadow: '0 0 0 2px rgba(37,99,235,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* html5-qrcode video target container */}
        <div id="qr-camera-stream" style={{ width: '100%', height: '100%' }} />

        {/* Scan Frame Overlay */}
        {scanState === 'scanning' && (
          <div
            style={{
              position: 'absolute',
              inset: 20,
              border: '2px solid rgba(255,255,255,0.5)',
              borderRadius: 16,
              boxShadow: '0 0 0 4000px rgba(0,0,0,0.5)',
              pointerEvents: 'none'
            }}
          >
            {/* Animated Laser Line */}
            <div
              style={{
                width: '100%',
                height: 2,
                background: '#3b82f6',
                boxShadow: '0 0 10px #3b82f6',
                animation: 'scan-laser 2s infinite alternate ease-in-out'
              }}
            />
          </div>
        )}

        {/* Processing Spinner Overlay */}
        {scanState === 'processing' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15,23,42,0.92)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 20,
              textAlign: 'center'
            }}
          >
            <RefreshCw className="spin" size={44} color="#3b82f6" />
            <strong style={{ fontSize: 16, color: '#f8fafc' }}>{statusMessage}</strong>
          </div>
        )}

        {/* Success State Overlay */}
        {scanState === 'success' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(22,101,52,0.95)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 20,
              textAlign: 'center'
            }}
          >
            <CheckCircle2 size={54} color="#86efac" />
            <strong style={{ fontSize: 17, color: '#ffffff' }}>Recorded!</strong>
            <p style={{ margin: 0, fontSize: 13, color: '#dcfce7' }}>{statusMessage}</p>
          </div>
        )}

        {/* Error State Overlay */}
        {scanState === 'error' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(153,27,27,0.95)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: 20,
              textAlign: 'center'
            }}
          >
            <AlertCircle size={44} color="#fca5a5" />
            <strong style={{ fontSize: 15, color: '#ffffff' }}>Unable to Verify</strong>
            <p style={{ margin: 0, fontSize: 12, color: '#fee2e2', lineHeight: 1.4 }}>
              {errorMessage}
            </p>
          </div>
        )}
      </div>

      {/* Bottom Controls & Fallback */}
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          paddingTop: 14
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: '#94a3b8',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <Camera size={15} /> Point the camera directly at the QR code
        </p>

        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            type="button"
            onClick={onSwitchToCode}
            style={{
              flex: 1,
              background: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #334155',
              padding: '12px 16px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
          >
            <KeyRound size={16} /> Enter Code Instead
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              color: '#94a3b8',
              border: '1px solid #475569',
              padding: '12px 18px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
