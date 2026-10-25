import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin, Plus, Navigation, CheckCircle, AlertCircle, Edit2, ShieldAlert,
  Calendar, ChevronDown, Landmark,
  ArrowRight, Award, CheckCircle2, BookOpen, BarChart2, Star,
  TrendingUp, Compass, ExternalLink, X, ShieldCheck, Camera, Upload, Trash2, Image as ImageIcon
} from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../auth';
import { Loading, Empty, Modal } from '../ui';



export const getVenueImage = (venue) => {
  if (venue?.image_url) return venue.image_url;
  // Generic classroom/building fallback
  return 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=800&q=80';
};

/** Client-side image crop/resize to max 1200x800 JPEG (sharp, responsive venue aspect ratio) */
function processVenueImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxW = 1200;
        const maxH = 800;
        let w = img.width;
        let h = img.height;
        if (w > maxW || h > maxH) {
          if (w / h > maxW / maxH) {
            h = Math.round((h * maxW) / w);
            w = maxW;
          } else {
            w = Math.round((w * maxH) / h);
            h = maxH;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('Failed to load image file.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export default function Venues() {
  const { profile } = useAuth();
  const [dbVenues, setDbVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);

  // Photo upload states
  const [uploadingId, setUploadingId] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [uploadError, setUploadError] = useState('');
  const cardFileInputRef = useRef(null);
  const targetVenueRef = useRef(null);
  const modalFileInputRef = useRef(null);

  const isHod = profile?.role === 'hod';
  const isRep = profile?.role === 'class_rep';

  const defaultForm = {
    name: '',
    campus_building: 'Main Campus - Department-wide',
    latitude: '',
    longitude: '',
    radius_m: 50,
    capacity: 40,
    seating: 40,
    level: isRep ? profile?.level : '',
    image_url: '',
    is_active: true
  };

  const [form, setForm] = useState(defaultForm);

  const handleUploadPhoto = async (venue, file) => {
    if (!file) return;
    try {
      setUploadingId(venue.id);
      setUploadError('');
      setUploadSuccess('');

      // Process and optimize image client-side to max 1200x800
      const base64Data = await processVenueImage(file);

      // Call API
      const res = await apiFetch(`/venues/${venue.id}/image`, {
        method: 'POST',
        body: { image: base64Data }
      });

      if (res?.image_url) {
        setUploadSuccess(`Venue photo updated for ${venue.name}!`);
        setTimeout(() => setUploadSuccess(''), 4500);
        setSelectedVenue(prev => (prev && prev.id === venue.id ? { ...prev, image_url: res.image_url } : prev));
        setForm(prev => ({ ...prev, image_url: res.image_url }));
        await load();
      }
    } catch (err) {
      setUploadError(err.message || 'Failed to upload photo');
      setTimeout(() => setUploadError(''), 5000);
    } finally {
      setUploadingId(null);
      if (cardFileInputRef.current) cardFileInputRef.current.value = '';
      if (modalFileInputRef.current) modalFileInputRef.current.value = '';
    }
  };

  const triggerCardUpload = (venue) => {
    targetVenueRef.current = venue;
    cardFileInputRef.current?.click();
  };

  const handleCardFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && targetVenueRef.current) {
      handleUploadPhoto(targetVenueRef.current, file);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch('/venues');
      setDbVenues(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Only use real DB venues — no predefined defaults
  const venuesList = useMemo(() => {
    return (dbVenues || []).map(v => ({
      ...v,
      subtitle: v.level ? `Level ${v.level} Venue` : 'Department Venue',
      campus_building: v.campus_building || 'Main Campus - Department-wide',
      capacity: v.capacity || 50,
      seating: v.seating || 50,
      icon: Landmark,
      iconColor: 'text-blue-600 bg-blue-50 border-blue-100',
      image_url: v.image_url || ''
    }));
  }, [dbVenues]);

  const openNew = () => {
    setEditing(null);
    setForm(defaultForm);
    setGpsAccuracy(null);
    setShowEditModal(true);
  };

  const openEdit = (v) => {
    setEditing(v);
    setForm({
      name: v.name,
      campus_building: v.campus_building || 'Main Campus - Department-wide',
      latitude: v.latitude,
      longitude: v.longitude,
      radius_m: v.radius_m || 50,
      capacity: v.capacity || 40,
      seating: v.seating || 40,
      level: v.level || '',
      image_url: v.image_url || '',
      is_active: v.is_active
    });
    setGpsAccuracy(null);
    setShowEditModal(true);
  };

  const captureGps = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser or device.');
      return;
    }
    setGpsLoading(true);
    setGpsAccuracy(null);

    const onSuccess = (pos) => {
      setGpsLoading(false);
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lng = Number(pos.coords.longitude.toFixed(6));
      const acc = Math.round(pos.coords.accuracy);
      setForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
      setGpsAccuracy(acc);
    };

    // High accuracy attempt with fast fallback
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        // Fallback to standard network position
        navigator.geolocation.getCurrentPosition(
          onSuccess,
          (fallbackErr) => {
            setGpsLoading(false);
            if (err.code === 1) {
              alert('Location permission was denied. Please allow location access in your browser or device settings.');
            } else if (err.code === 3) {
              alert('GPS signal timed out. Please ensure location/GPS is enabled on your device and try again.');
            } else {
              alert(`Could not capture device location: ${err.message || fallbackErr.message}`);
            }
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name.trim(),
        campus_building: form.campus_building.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radius_m: Number(form.radius_m),
        level: form.level ? Number(form.level) : null,
        is_active: form.is_active
      };

      if (editing && editing.id && !editing.id.startsWith('venue-')) {
        await apiFetch(`/venues/${editing.id}`, { method: 'PATCH', body: payload });
      } else {
        await apiFetch('/venues', { method: 'POST', body: payload });
      }
      setShowEditModal(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const academicYear = (profile?.academic_year || '2026/2027').replace(/\s*academic\s*year/i, '').trim();
  const semesterName = profile?.semester === 2 ? 'Second Semester' : 'First Semester';

  return (
    <div className="venues-page-wrapper max-w-7xl mx-auto px-2 sm:px-4 py-4 space-y-6">
      {/* Hidden file input for one-click venue photo upload */}
      <input
        type="file"
        ref={cardFileInputRef}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleCardFileChange}
      />

      {/* Upload Toast Alerts */}
      {uploadSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>{uploadSuccess}</span>
        </div>
      )}
      {uploadError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-semibold flex items-center gap-2 shadow-sm animate-fade-in">
          <AlertCircle size={16} className="text-red-600 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* 2. Page Header & Context Pills */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Lecture Halls & Venues</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            View your assigned lecture halls, venues and key location information.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50/70 border border-blue-100 rounded-full text-xs font-semibold text-slate-700">
            <Calendar size={13} className="text-primary" />
            <span>Academic Year: <strong>{academicYear}</strong></span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200/90 rounded-full text-xs font-semibold text-slate-700">
            <span>Semester: <strong className="text-primary">{semesterName}</strong></span>
            <ChevronDown size={13} className="text-slate-400" />
          </div>

          {(isHod || isRep) && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-primary text-white rounded-full text-xs font-semibold hover:bg-primary-dark transition shadow-sm"
            >
              <Plus size={14} /> Add Venue
            </button>
          )}
        </div>
      </div>

      {/* 3. "My Lecture Halls" Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-100/70 text-primary">
            <Landmark size={20} />
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">My Lecture Halls</h2>
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-white">
              {venuesList.length}
            </span>
          </div>
        </div>

        {/* Venues Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {venuesList.map((venue) => {
            const Icon = venue.icon || Landmark;
            return (
              <div
                key={venue.id}
                className="bg-white rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Dedicated Venue Photo Banner */}
                  <div className="relative h-44 w-full overflow-hidden bg-slate-100">
                    <img
                      src={getVenueImage(venue)}
                      alt={venue.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/35 to-transparent" />
                    <div className="absolute top-3 left-3">
                      <div className="p-2 rounded-xl backdrop-blur-md bg-white/90 shadow-sm border border-white/50 text-slate-800">
                        <Icon size={18} />
                      </div>
                    </div>
                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500 text-white shadow-sm backdrop-blur-sm">
                        Active
                      </span>
                    </div>

                    {/* HOD One-Click Upload Button on Venue Card */}
                    {isHod && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerCardUpload(venue);
                        }}
                        disabled={uploadingId === venue.id}
                        className="absolute bottom-3 right-3 z-10 px-2.5 py-1 rounded-lg backdrop-blur-md bg-white/90 hover:bg-white text-slate-800 text-[11px] font-bold shadow-md border border-white/70 flex items-center gap-1.5 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                        title="Upload new image for this venue"
                      >
                        <Camera size={13} className={uploadingId === venue.id ? 'animate-spin text-primary' : 'text-primary'} />
                        <span>{uploadingId === venue.id ? 'Uploading…' : 'Upload Image'}</span>
                      </button>
                    )}

                    <div className={`absolute bottom-3 left-3 text-white ${isHod ? 'right-36' : 'right-3'}`}>
                      <h3 className="font-bold text-base leading-snug drop-shadow-sm text-white truncate">
                        {venue.name}
                      </h3>
                      <p className="text-xs text-slate-200 font-medium drop-shadow-sm truncate">
                        {venue.subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="p-4">
                    {/* Location Tag */}
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-3 pl-0.5">
                      <MapPin size={13} className="text-slate-400 shrink-0" />
                      <span className="truncate">{venue.campus_building}</span>
                    </div>

                    {/* Coordinates & Capacity */}
                    <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100 mb-2">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Compass size={12} className="text-slate-400" /> Coordinates:
                        </span>
                        <span className="font-mono font-medium text-slate-800">
                          {Number(venue.latitude).toFixed(5)}, {Number(venue.longitude).toFixed(5)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 flex items-center gap-1">
                          <Users size={12} className="text-slate-400" /> Capacity / Seating:
                        </span>
                        <span className="font-medium text-slate-800">
                          {venue.capacity} / {venue.seating} Seats
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom View Details action */}
                <div className="p-4 pt-0 flex items-center justify-between">
                  {(isHod || isRep) ? (
                    <div className="flex items-center gap-2 w-full">
                      <button
                        type="button"
                        onClick={() => setSelectedVenue(venue)}
                        className="flex-1 text-center py-2 px-3 rounded-xl border border-blue-200 text-primary text-xs font-semibold hover:bg-blue-50 transition"
                      >
                        View Details →
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(venue)}
                        className="p-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                        title="Edit Venue"
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSelectedVenue(venue)}
                      className="w-full text-center py-2 px-4 rounded-xl border border-blue-200 text-primary text-xs font-semibold hover:bg-blue-50 transition flex items-center justify-center gap-1 group-hover:border-primary"
                    >
                      <span>View Details</span>
                      <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* 6th Card: Department Illustration Card */}
          <div className="bg-gradient-to-br from-slate-50 to-blue-50/60 rounded-2xl p-6 border border-slate-200/80 flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-20 h-20 mb-3 rounded-2xl bg-white shadow-sm border border-blue-100 flex items-center justify-center relative">
              <Landmark size={36} className="text-primary/70" />
              <div className="absolute -top-1.5 -right-1.5 p-1 bg-primary text-white rounded-full shadow-sm">
                <MapPin size={12} />
              </div>
            </div>
            <h4 className="font-bold text-slate-800 text-sm mb-1">
              Your assigned lecture halls and venues
            </h4>
            <p className="text-xs text-slate-500 max-w-[240px] leading-relaxed">
              All locations are managed by the Department of Computer Science.
            </p>
          </div>
        </div>
      </section>

      {/* 4. "My GPA" Section */}
      <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-100/70 text-primary">
            <Award size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 leading-tight">My GPA</h2>
            <p className="text-xs text-slate-500">Your current academic performance</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* Circular Donut Ring: 3.42 GPA */}
          <div className="lg:col-span-3 flex flex-col items-center justify-center p-3">
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                {/* Background Ring */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  className="stroke-slate-100"
                  strokeWidth="8"
                  fill="transparent"
                />
                {/* Progress Ring (3.42 / 4.0 = 85.5%) */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  className="stroke-primary"
                  strokeWidth="8"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 * (1 - 0.855)}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black text-slate-900 leading-none">3.42</span>
                <span className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wider">GPA</span>
                <span className="text-[9px] text-slate-400 font-medium">(Out of 4.0)</span>
              </div>
            </div>
          </div>

          {/* Stat Boxes Grid */}
          <div className="lg:col-span-4 grid grid-cols-2 gap-3">
            {/* Total Credits */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center text-center">
              <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 mb-1">
                <CheckCircle2 size={16} />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Total Credits</span>
              <strong className="text-lg font-bold text-slate-900 mt-0.5">14</strong>
            </div>

            {/* Completed */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center text-center">
              <div className="p-1.5 rounded-lg bg-blue-100 text-primary mb-1">
                <BookOpen size={16} />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Completed</span>
              <strong className="text-lg font-bold text-slate-900 mt-0.5">14</strong>
            </div>

            {/* Current GPA */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center text-center">
              <div className="p-1.5 rounded-lg bg-purple-100 text-purple-700 mb-1">
                <BarChart2 size={16} />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Current GPA</span>
              <strong className="text-lg font-bold text-purple-700 mt-0.5">3.42</strong>
            </div>

            {/* Class Rank */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center text-center">
              <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700 mb-1">
                <Star size={16} />
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Class Rank</span>
              <strong className="text-lg font-bold text-amber-600 mt-0.5">8 / 32</strong>
            </div>
          </div>

          {/* GPA Trend Line Chart */}
          <div className="lg:col-span-5 p-3 rounded-xl bg-slate-50/70 border border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-2">
              <TrendingUp size={14} className="text-primary" />
              <span>GPA Trend</span>
            </div>

            {/* Chart SVG */}
            <div className="w-full h-32 relative">
              <svg className="w-full h-full overflow-visible" viewBox="0 0 340 100" preserveAspectRatio="none">
                {/* Grid horizontal lines */}
                <line x1="0" y1="20" x2="340" y2="20" stroke="#e2e8f0" strokeDasharray="3 3" />
                <line x1="0" y1="45" x2="340" y2="45" stroke="#e2e8f0" strokeDasharray="3 3" />
                <line x1="0" y1="70" x2="340" y2="70" stroke="#e2e8f0" strokeDasharray="3 3" />

                {/* Trend Polyline: [35, 65], [115, 52], [195, 38], [275, 30] */}
                <polyline
                  fill="none"
                  stroke="#1769aa"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points="45,60 125,50 205,38 285,28"
                />

                {/* Dots & Labels */}
                {/* Point 1 */}
                <circle cx="45" cy="60" r="4" fill="#ffffff" stroke="#1769aa" strokeWidth="2.5" />
                <text x="45" y="48" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#1e293b">3.12</text>
                <text x="45" y="86" textAnchor="middle" fontSize="7.5" fill="#64748b">Sem 1 (Yr 1)</text>

                {/* Point 2 */}
                <circle cx="125" cy="50" r="4" fill="#ffffff" stroke="#1769aa" strokeWidth="2.5" />
                <text x="125" y="38" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#1e293b">3.25</text>
                <text x="125" y="86" textAnchor="middle" fontSize="7.5" fill="#64748b">Sem 2 (Yr 1)</text>

                {/* Point 3 */}
                <circle cx="205" cy="38" r="4" fill="#ffffff" stroke="#1769aa" strokeWidth="2.5" />
                <text x="205" y="26" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#1e293b">3.36</text>
                <text x="205" y="86" textAnchor="middle" fontSize="7.5" fill="#64748b">Sem 1 (Yr 2)</text>

                {/* Point 4 */}
                <circle cx="285" cy="28" r="4" fill="#ffffff" stroke="#1769aa" strokeWidth="2.5" />
                <text x="285" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#1769aa">3.42</text>
                <text x="285" y="86" textAnchor="middle" fontSize="7.5" fill="#64748b">Sem 2 (Yr 2)</text>
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Venue Details Modal */}
      {selectedVenue && (
        <Modal title={selectedVenue.name} onClose={() => setSelectedVenue(null)}>
          <div className="space-y-4 text-slate-700">
            {/* Modal Venue Photo Banner */}
            <div className="relative h-48 w-full rounded-2xl overflow-hidden bg-slate-100 shadow-sm border border-slate-100">
              <img
                src={getVenueImage(selectedVenue)}
                alt={selectedVenue.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-900/30 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3 text-white">
                <span className="font-bold text-base block drop-shadow-sm">{selectedVenue.name}</span>
                <span className="text-xs text-slate-200 block drop-shadow-sm">{selectedVenue.subtitle} • {selectedVenue.campus_building}</span>
              </div>
              {isHod && (
                <button
                  type="button"
                  onClick={() => triggerCardUpload(selectedVenue)}
                  disabled={uploadingId === selectedVenue.id}
                  className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-xl backdrop-blur-md bg-white/90 hover:bg-white text-slate-800 text-xs font-bold shadow-md border border-white/60 flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Upload Venue Image"
                >
                  <Camera size={14} className={uploadingId === selectedVenue.id ? 'animate-spin text-primary' : 'text-primary'} />
                  <span>{uploadingId === selectedVenue.id ? 'Uploading…' : 'Change Photo'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 p-3 bg-blue-50/70 border border-blue-100 rounded-xl">
              <div className={`p-2.5 rounded-xl ${selectedVenue.iconColor || 'bg-blue-100 text-primary'}`}>
                {selectedVenue.icon ? <selectedVenue.icon size={22} /> : <Landmark size={22} />}
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{selectedVenue.name}</h4>
                <p className="text-xs text-slate-500">{selectedVenue.subtitle} • {selectedVenue.campus_building}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5">GPS Latitude</span>
                <strong className="font-mono text-slate-800">{Number(selectedVenue.latitude).toFixed(6)}</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5">GPS Longitude</span>
                <strong className="font-mono text-slate-800">{Number(selectedVenue.longitude).toFixed(6)}</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5">Geofence Radius</span>
                <strong className="text-slate-800">{selectedVenue.radius_m || 50} metres</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-0.5">Seating Capacity</span>
                <strong className="text-slate-800">{selectedVenue.capacity} Seats</strong>
              </div>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
              <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
              <span>
                Verified Geofence: Attendance for this venue is accepted within a {selectedVenue.radius_m || 50}m radius using point-in-time GPS.
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${selectedVenue.latitude},${selectedVenue.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
              >
                <ExternalLink size={14} /> Open in Google Maps
              </a>
              <button
                type="button"
                onClick={() => setSelectedVenue(null)}
                className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary-dark transition"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 6. HOD/Rep Add or Edit Venue Modal */}
      {showEditModal && (
        <Modal title={editing ? `Edit ${editing.name}` : 'Add New Venue'} onClose={() => setShowEditModal(false)}>
          <form onSubmit={save} className="space-y-3.5 text-slate-700 text-xs">
            <div>
              <label className="font-semibold block mb-1">Venue Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Computer Lab 3"
                className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1">Campus / Location</label>
              <input
                type="text"
                value={form.campus_building}
                onChange={e => setForm({ ...form, campus_building: e.target.value })}
                placeholder="Main Campus - Department-wide"
                className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold block mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={form.latitude}
                  onChange={e => setForm({ ...form, latitude: e.target.value })}
                  placeholder="8.46570"
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={form.longitude}
                  onChange={e => setForm({ ...form, longitude: e.target.value })}
                  placeholder="-13.23170"
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={captureGps}
                disabled={gpsLoading}
                className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-primary font-semibold rounded-xl flex items-center justify-center gap-1.5 transition"
              >
                <Navigation size={14} className={gpsLoading ? 'animate-spin' : ''} />
                {gpsLoading ? 'Acquiring GPS Signal…' : 'Capture Current Coordinates from Device'}
              </button>
              {gpsAccuracy && (
                <span className="text-[10px] text-emerald-600 block mt-1 text-center font-medium">
                  ✓ GPS acquired with ±{gpsAccuracy}m precision
                </span>
              )}
            </div>

            <div>
              <label className="font-semibold block mb-1">Venue Photo</label>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="h-20 w-32 rounded-lg overflow-hidden border border-slate-200 bg-white shrink-0 relative shadow-sm">
                    <img
                      src={form.image_url || getVenueImage(editing || form)}
                      alt="Venue preview"
                      className="w-full h-full object-cover"
                      onError={e => e.target.style.display = 'none'}
                    />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="file"
                        ref={modalFileInputRef}
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (editing?.id && !editing.id.startsWith('venue-')) {
                              handleUploadPhoto(editing, file);
                            } else {
                              processVenueImage(file).then(b64 => {
                                setForm(prev => ({ ...prev, image_url: b64 }));
                              });
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => modalFileInputRef.current?.click()}
                        disabled={uploadingId === editing?.id}
                        className="px-3 py-1.5 bg-primary text-white hover:bg-primary-dark font-semibold rounded-lg text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                      >
                        <Upload size={13} />
                        <span>{uploadingId === editing?.id ? 'Uploading…' : 'Upload Image'}</span>
                      </button>
                      {form.image_url && (
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({ ...prev, image_url: '' }))}
                          className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-600 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                          title="Reset to default photo"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Upload from phone or computer (JPG, PNG, WEBP max 5 MB).
                    </p>
                  </div>
                </div>

                {/* Optional Photo URL */}
                <div>
                  <input
                    type="url"
                    value={form.image_url?.startsWith('data:') ? '' : form.image_url || ''}
                    onChange={e => setForm({ ...form, image_url: e.target.value })}
                    placeholder="Or enter direct image URL (e.g. https://...)"
                    className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold block mb-1">Geofence Radius (metres)</label>
                <input
                  type="number"
                  required
                  value={form.radius_m}
                  onChange={e => setForm({ ...form, radius_m: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Seating Capacity</label>
                <input
                  type="number"
                  value={form.capacity}
                  onChange={e => setForm({ ...form, capacity: e.target.value })}
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary-dark shadow-sm"
              >
                Save Venue
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
