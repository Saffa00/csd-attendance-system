import { useState, useEffect } from 'react';

export default function SplashScreen({ onFinish, minDuration = 2000 }) {
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Smooth progress bar increment
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 5;
      });
    }, minDuration / 22);

    // Fade out timer
    const timer = setTimeout(() => {
      setFading(true);
      const finishTimer = setTimeout(() => {
        if (onFinish) onFinish();
      }, 400); // 400ms fade transition
      return () => clearTimeout(finishTimer);
    }, minDuration);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [minDuration, onFinish]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '48px 24px 32px',
        background: '#ffffff',
        color: '#0f172a',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: fading ? 'none' : 'auto',
        userSelect: 'none'
      }}
    >
      {/* Top subtle spacer */}
      <div style={{ height: 20 }} />

      {/* Center Container: Logo, App Title, Subtitle, Animated Progress Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: 480,
          width: '100%'
        }}
      >
        {/* Logo Container with gentle glow and smooth fade/scale in */}
        <div
          style={{
            position: 'relative',
            width: 130,
            height: 130,
            marginBottom: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {/* Subtle Royal Blue Glow */}
          <div
            style={{
              position: 'absolute',
              inset: -14,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(37, 99, 235, 0.45) 0%, rgba(29, 78, 216, 0.1) 70%, transparent 100%)',
              filter: 'blur(16px)',
              animation: 'pulseGlow 2.5s infinite alternate'
            }}
          />

          <img
            src="/logo.png"
            alt="Milton Margai Technical University Computer Science Department Logo"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              position: 'relative',
              zIndex: 2,
              filter: 'drop-shadow(0 8px 20px rgba(0, 0, 0, 0.45))',
              animation: 'logoFadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards'
            }}
          />
        </div>

        {/* Application Name */}
        <h1
          style={{
            margin: '0 0 10px',
            fontSize: 'clamp(20px, 4.5vw, 26px)',
            fontWeight: 800,
            letterSpacing: '0.01em',
            color: '#0f172a',
            lineHeight: 1.25,
            animation: 'textSlideUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}
        >
          CSD Attendance Management System
        </h1>

        {/* Subtitle */}
        <p
          style={{
            margin: '0 0 28px',
            fontSize: 'clamp(12px, 2.5vw, 13.5px)',
            color: '#2563eb',
            fontWeight: 500,
            lineHeight: 1.5,
            maxWidth: 380,
            letterSpacing: '0.02em',
            animation: 'textSlideUp 1s cubic-bezier(0.16, 1, 0.3, 1) forwards'
          }}
        >
          Milton Margai Technical University – Department of Computer Science
        </p>

        {/* Animated Loading Bar */}
        <div
          style={{
            width: '100%',
            maxWidth: 240,
            height: 5,
            background: 'rgba(0, 0, 0, 0.08)',
            borderRadius: 10,
            overflow: 'hidden',
            position: 'relative',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
            marginTop: 6
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #38bdf8 100%)',
              borderRadius: 10,
              boxShadow: '0 0 12px rgba(56, 189, 248, 0.8)',
              transition: 'width 0.12s linear'
            }}
          />
        </div>

        {/* Loading status tip */}
        <span
          style={{
            display: 'block',
            marginTop: 10,
            fontSize: 11,
            color: '#2563eb',
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase'
          }}
        >
          Initializing Secure Portal…
        </span>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          textAlign: 'center'
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: '#94a3b8',
            fontWeight: 650,
            letterSpacing: '0.06em'
          }}
        >
          Version 1.0.0
        </span>
        <span
          style={{
            fontSize: 11,
            color: '#64748b',
            letterSpacing: '0.08em',
            textTransform: 'uppercase'
          }}
        >
          Code · Innovate · Impact
        </span>
      </div>

      {/* Keyframe Styles */}
      <style>{`
        @keyframes logoFadeIn {
          from {
            opacity: 0;
            transform: scale(0.88) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes textSlideUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulseGlow {
          from {
            opacity: 0.6;
            transform: scale(0.96);
          }
          to {
            opacity: 1;
            transform: scale(1.06);
          }
        }
      `}</style>
    </div>
  );
}
