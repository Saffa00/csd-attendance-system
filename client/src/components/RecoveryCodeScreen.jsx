import { useState, useRef } from 'react';
import { Copy, Check, Download, ShieldCheck, AlertTriangle, KeyRound } from 'lucide-react';

/**
 * Full-screen "Save your recovery code" page / modal.
 * Required by MMTU CS Attendance System specifications:
 * - Code in large text
 * - Copy button
 * - "Download as image" button (renders canvas card)
 * - Checkbox: "I have saved this code" (must be ticked before continuing)
 * - Required one-line explanation: "If you forget your password, this code lets you set a new one yourself."
 * - Never shows the code again after being closed.
 */
export default function RecoveryCodeScreen({
  code,
  studentName = 'Student',
  studentId = '',
  title = 'Save Your Recovery Code',
  onContinue
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canvasRef = useRef(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadImage = () => {
    setDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 900, 540);
      bgGrad.addColorStop(0, '#0a192f');
      bgGrad.addColorStop(0.5, '#102a43');
      bgGrad.addColorStop(1, '#06101e');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 900, 540);

      // 2. Decorative Outer Border
      ctx.strokeStyle = '#204060';
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 16, 868, 508);

      // Gold Accent Header Line
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(24, 24, 852, 6);

      // 3. Header Text
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('MILTON MARGAI TECHNICAL UNIVERSITY', 450, 75);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('DEPARTMENT OF COMPUTER SCIENCE — CS ATTENDANCE PORTAL', 450, 105);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('OFFICIAL STUDENT ACCOUNT RECOVERY CREDENTIAL', 450, 130);

      // Divider line
      ctx.strokeStyle = '#334e68';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(60, 150);
      ctx.lineTo(840, 150);
      ctx.stroke();

      // 4. Student Details
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('STUDENT NAME:', 70, 185);
      ctx.fillText('STUDENT ID / USERNAME:', 520, 185);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(studentName.toUpperCase(), 70, 212);
      ctx.fillText(studentId ? studentId.toUpperCase() : 'REGISTERED STUDENT', 520, 212);

      // 5. Recovery Code Box
      const boxGrad = ctx.createLinearGradient(70, 240, 830, 360);
      boxGrad.addColorStop(0, '#061727');
      boxGrad.addColorStop(1, '#0d2238');
      ctx.fillStyle = boxGrad;
      ctx.beginPath();
      ctx.roundRect(70, 240, 760, 120, 14);
      ctx.fill();

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Code label
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PERSONAL RECOVERY CODE (SINGLE-USE)', 450, 268);

      // Large Recovery Code
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 42px "Courier New", Courier, monospace';
      ctx.letterSpacing = '4px';
      ctx.fillText(code, 450, 325);

      // 6. One-line Explanation (Required)
      ctx.fillStyle = '#fef08a';
      ctx.font = 'italic 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('"If you forget your password, this code lets you set a new one yourself."', 450, 400);

      // 7. Security Notice & Footer
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Notice: This code invalidates automatically upon use. Keep this image in a secure place.', 450, 435);

      const dateStr = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date());

      ctx.fillStyle = '#64748b';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`Generated on ${dateStr} • Computer Science Department Attendance System • Confidential`, 450, 490);

      // 8. Convert to download
      const link = document.createElement('a');
      link.download = `MMTU-CS-RecoveryCode-${(studentId || studentName).replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to generate recovery code image:', err);
      alert('Could not download image. Please copy and write down your code.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[99999] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-5 overflow-y-auto overflow-x-hidden w-full max-w-[100vw] box-border"
      style={{ touchAction: 'pan-y' }}
    >
      <div
        className="bg-white w-full max-w-[calc(100vw-16px)] sm:max-w-lg rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200/80 overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200 box-border"
        style={{ overflowX: 'hidden' }}
      >
        {/* Top University Branding Bar */}
        <div className="bg-gradient-to-r from-[#102a43] via-[#1b3a5b] to-[#102a43] p-4 sm:p-5 text-center text-white relative box-border">
          <div className="w-12 h-12 sm:w-14 sm:h-14 mx-auto mb-2 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shadow-inner">
            <KeyRound size={26} className="animate-pulse" />
          </div>
          <h2 className="text-lg sm:text-2xl font-black tracking-tight text-white m-0 break-words" style={{ overflowWrap: 'anywhere' }}>
            {title}
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-300 font-medium mt-1 break-words" style={{ overflowWrap: 'anywhere' }}>
            Milton Margai Technical University • Computer Science
          </p>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-7 space-y-3.5 sm:space-y-4 box-border w-full">
          {/* Required one-line explanation */}
          <div className="bg-emerald-50/80 border border-emerald-200/90 rounded-xl sm:rounded-2xl p-3 sm:p-3.5 text-center box-border w-full">
            <p className="text-xs sm:text-sm font-bold text-emerald-950 m-0 leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
              &ldquo;If you forget your password, this code lets you set a new one yourself.&rdquo;
            </p>
          </div>

          {/* Prominent Code Card */}
          <div className="bg-slate-900 rounded-xl sm:rounded-2xl p-3.5 sm:p-5 border-2 border-dashed border-emerald-500/60 shadow-inner text-center relative group w-full max-w-full box-border overflow-hidden">
            <div className="text-[10px] sm:text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5 sm:mb-2">
              Your Personal Single-Use Recovery Code
            </div>
            <div
              className="font-mono text-base sm:text-2xl font-black text-emerald-300 select-all py-1 break-all w-full box-border"
              style={{
                overflowWrap: 'anywhere',
                wordBreak: 'break-all',
                letterSpacing: 'clamp(0.5px, 0.8vw, 2px)'
              }}
            >
              {code}
            </div>
            <div className="text-[10px] sm:text-[11px] text-slate-400 mt-1.5 sm:mt-2 break-words" style={{ overflowWrap: 'anywhere' }}>
              Assigned to: <strong className="text-white">{studentName}</strong> {studentId ? `(${studentId})` : ''}
            </div>
          </div>

          {/* Action Buttons: Copy & Download Image */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5 w-full box-border">
            <button
              type="button"
              onClick={handleCopy}
              className={`flex items-center justify-center gap-2 py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer border w-full box-border ${
                copied
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300'
              }`}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied to Clipboard!' : 'Copy Code'}
            </button>

            <button
              type="button"
              onClick={handleDownloadImage}
              disabled={downloading}
              className="flex items-center justify-center gap-2 py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition shadow-xs cursor-pointer w-full box-border"
            >
              <Download size={16} />
              {downloading ? 'Preparing Image…' : 'Download as Image'}
            </button>
          </div>

          {/* Security Alert */}
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 sm:p-3 text-amber-900 text-[11px] sm:text-xs leading-normal box-border w-full">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <strong className="font-bold">Important Security Notice:</strong>
              <span className="block mt-0.5 text-amber-800 break-words" style={{ overflowWrap: 'anywhere' }}>
                This code will <strong>never be shown again</strong> once you leave this screen. Save the image or write it down now.
              </span>
            </div>
          </div>

          {/* Checkbox: I have saved this code */}
          <label className="flex items-start gap-2.5 p-2.5 sm:p-3.5 rounded-xl border border-slate-200 hover:border-slate-300 bg-slate-50/70 cursor-pointer transition select-none w-full box-border">
            <input
              type="checkbox"
              id="confirmSavedCode"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
            />
            <span className="text-[11px] sm:text-xs font-semibold text-slate-700 leading-snug break-words flex-1 min-w-0" style={{ overflowWrap: 'anywhere' }}>
              I have saved this code in a secure location and understand it cannot be displayed again.
            </span>
          </label>

          {/* Continue Button (Disabled until confirmed) */}
          <button
            type="button"
            onClick={onContinue}
            disabled={!confirmed}
            className={`w-full py-3 sm:py-3.5 px-4 sm:px-5 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-bold shadow-md transition flex items-center justify-center gap-2 cursor-pointer box-border ${
              confirmed
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-200'
            }`}
          >
            <ShieldCheck size={18} />
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
