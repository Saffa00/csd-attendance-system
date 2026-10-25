import { Link } from 'react-router-dom';
import {
  Shield, MapPin, Lock, FileText, Users, CheckCircle2,
  Info, ArrowRight, ShieldCheck, Clock, FileCheck, ExternalLink,
  Laptop
} from 'lucide-react';

export default function Privacy() {
  return (
    <div className="privacy-page-wrapper max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-6">

      {/* 2. Header Hero Card with Graphics */}
      <div className="bg-gradient-to-r from-blue-50/90 via-white to-blue-50/50 rounded-2xl p-6 border border-blue-100 shadow-sm relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-start gap-4 max-w-2xl relative z-10">
          <div className="p-3.5 rounded-2xl bg-blue-100/80 text-primary border border-blue-200/80 shrink-0 shadow-sm">
            <Shield size={32} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Privacy & Location Policy
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">
              Your privacy and location data are important to us. This policy explains how we collect, use,
              protect and handle your information while using the student portal.
            </p>
          </div>
        </div>

        {/* Hero Vector Illustration on Right */}
        <div className="hidden md:flex items-center gap-3 pr-4 opacity-90 relative z-10">
          <div className="relative flex items-center justify-center">
            {/* Soft decorative background glow */}
            <div className="w-28 h-20 bg-blue-200/40 rounded-2xl blur-md absolute"></div>
            {/* Laptop graphic */}
            <div className="w-16 h-12 bg-white rounded-lg border border-blue-200 shadow-sm flex items-center justify-center relative">
              <Laptop size={22} className="text-blue-500" />
            </div>
            {/* Shield with lock */}
            <div className="w-14 h-16 bg-blue-600 rounded-xl shadow-md flex items-center justify-center -ml-3 z-10 text-white">
              <Lock size={20} />
            </div>
            {/* Map pin */}
            <div className="w-10 h-10 bg-white rounded-full border border-blue-100 shadow-sm flex items-center justify-center -ml-2 text-primary">
              <MapPin size={18} />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Four Feature Cards Grid (2x2) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Card 1: Point-in-Time Geolocation Verification */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between hover:shadow-md transition group">
          <div>
            <div className="flex items-center gap-3 mb-3.5">
              <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
                <MapPin size={22} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center">
                  1
                </span>
                <h3 className="font-bold text-slate-900 text-base">
                  Point-in-Time Geolocation Verification
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-5">
              Your device's GPS coordinates and horizontal accuracy are queried <strong>exclusively at the exact millisecond you tap "Mark Present"</strong>. The system never tracks your location in the background, never logs your movement between classes, and cannot access your position when the app is idle or closed.
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center gap-2 text-xs font-semibold text-emerald-800">
            <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
            <span>Location access is only used when marking attendance.</span>
          </div>
        </div>

        {/* Card 2: Venue Geofence Validation */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between hover:shadow-md transition group">
          <div>
            <div className="flex items-center gap-3 mb-3.5">
              <div className="p-3 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                <Lock size={22} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center">
                  2
                </span>
                <h3 className="font-bold text-slate-900 text-base">
                  Venue Geofence Validation
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-5">
              When you submit attendance, the server calculates your spherical distance from the designated lecture hall using the Haversine algorithm. If you are within the venue's configured perimeter (typically 50 to 100 metres), your submission is validated. Coordinates are stored in secured audit logs accessible only to authorized departmental staff.
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100 flex items-center gap-2 text-xs font-semibold text-blue-800">
            <ShieldCheck size={15} className="text-blue-600 shrink-0" />
            <span>Your location data is securely validated and protected.</span>
          </div>
        </div>

        {/* Card 3: Data Retention & Archival Policy */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between hover:shadow-md transition group">
          <div>
            <div className="flex items-center gap-3 mb-3.5">
              <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100 shrink-0">
                <FileText size={22} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] font-bold flex items-center justify-center">
                  3
                </span>
                <h3 className="font-bold text-slate-900 text-base">
                  Data Retention & Archival Policy
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-5">
              Attendance records and audit logs are retained for the current academic year plus one (1) succeeding academic year to ensure complete verification for grade reviews, graduation clearances, and departmental accreditation. After this statutory period, detailed GPS metadata is purged or anonymized.
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-100 flex items-center gap-2 text-xs font-semibold text-amber-800">
            <Clock size={15} className="text-amber-600 shrink-0" />
            <span>Data is retained for 1 year + 1 year and then safely archived.</span>
          </div>
        </div>

        {/* Card 4: Student Rights, Excuses & Appeals */}
        <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between hover:shadow-md transition group">
          <div>
            <div className="flex items-center gap-3 mb-3.5">
              <div className="p-3 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100 shrink-0">
                <Users size={22} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-purple-600 text-white text-[11px] font-bold flex items-center justify-center">
                  4
                </span>
                <h3 className="font-bold text-slate-900 text-base">
                  Student Rights, Excuses & Appeals
                </h3>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-5">
              You have the full right to transparently view all your attendance submissions, present/absent tallies, and percentage rates per course. If you miss a class due to illness, official university duties, or family emergency, you can submit an <strong>Excused Absence Request</strong>. If a submission is rejected, you have <strong>48 hours</strong> to lodge an appeal with your lecturer.
            </p>
          </div>

          <div className="p-2.5 rounded-xl bg-purple-50 border border-purple-100 flex items-center gap-2 text-xs font-semibold text-purple-800">
            <FileCheck size={15} className="text-purple-600 shrink-0" />
            <span>You can request an excuse or lodge an appeal within 48 hours.</span>
          </div>
        </div>
      </div>

      {/* 4. Bottom Support Card */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-blue-50 text-primary shrink-0">
            <Info size={24} />
          </div>
          <div>
            <h4 className="font-bold text-slate-900 text-sm">Your Privacy Matters</h4>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              We are committed to protecting your personal data and ensuring that it is used only for academic and administrative purposes in accordance with the Milton Margai University data protection policy.
            </p>
          </div>
        </div>

        <a
          href="mailto:support@cs.mmu.edu.sl"
          className="px-4 py-2.5 rounded-xl border border-slate-200 hover:border-primary text-slate-700 hover:text-primary text-xs font-semibold transition shrink-0 inline-flex items-center gap-1.5 self-start sm:self-center"
        >
          <span>Contact Support</span>
          <ArrowRight size={14} />
        </a>
      </div>
    </div>
  );
}
