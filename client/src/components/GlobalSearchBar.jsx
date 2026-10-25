import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, BookOpen, MapPin, Layout, Calendar, Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import { apiFetch } from '../api';

const DEFAULT_PAGES = {
  student: [
    { label: "Today's Timetable", sub: "Class schedule & timetable", to: "/timetable", category: "PAGE", icon: Calendar },
    { label: "Mark Attendance", sub: "Enter class code & mark present", to: "/attendance", category: "PAGE", icon: CheckCircle2 },
    { label: "Attendance History", sub: "View past records & appeal status", to: "/history", category: "PAGE", icon: Clock },
    { label: "Student Dashboard", sub: "Main student overview & ring", to: "/", category: "PAGE", icon: Layout },
    { label: "Account & Profile", sub: "Student ID and personal details", to: "/account", category: "PAGE", icon: Layout }
  ],
  lecturer: [
    { label: "Lecturer Dashboard", sub: "Active class status & overview", to: "/", category: "PAGE", icon: Layout },
    { label: "Class Sessions", sub: "Open 6-digit code for class attendance", to: "/sessions", category: "PAGE", icon: Clock },
    { label: "Attendance Approvals", sub: "Review & approve student submissions", to: "/approvals", category: "PAGE", icon: CheckCircle2 },
    { label: "Venues & GPS", sub: "Lecture halls and GPS geofence", to: "/venues", category: "PAGE", icon: MapPin }
  ],
  class_rep: [
    { label: "Class Rep Dashboard", sub: "Overview & class attendance", to: "/", category: "PAGE", icon: Layout },
    { label: "Mark Class Attendance", sub: "Submit attendance records", to: "/attendance", category: "PAGE", icon: CheckCircle2 },
    { label: "Class Timetable", sub: "Weekly schedule for your level", to: "/timetable", category: "PAGE", icon: Calendar },
    { label: "Class Students", sub: "Roster of students in your class", to: "/students", category: "PAGE", icon: Layout },
    { label: "Venues & Lecture Halls", sub: "Check venue locations", to: "/venues", category: "PAGE", icon: MapPin }
  ],
  hod: [
    { label: "HOD Dashboard", sub: "Department stats & attendance trends", to: "/", category: "PAGE", icon: Layout },
    { label: "Modules Management", sub: "Create & allocate course modules", to: "/modules", category: "PAGE", icon: BookOpen },
    { label: "Lecturers Directory", sub: "Register and manage lecturers", to: "/lecturers", category: "PAGE", icon: Layout },
    { label: "Class Representatives", sub: "Assign class reps by programme & level", to: "/reps", category: "PAGE", icon: Layout },
    { label: "Students Directory", sub: "Registered & pending students", to: "/students", category: "PAGE", icon: Layout },
    { label: "Lecture Halls & GPS", sub: "Department venues & geofencing", to: "/venues", category: "PAGE", icon: MapPin },
    { label: "Attendance Records", sub: "Department-wide attendance log", to: "/attendance", category: "PAGE", icon: Clock },
    { label: "Reports & Exports", sub: "Download attendance reports", to: "/reports", category: "PAGE", icon: Layout },
    { label: "Department Settings", sub: "Thresholds, rollover & academic setup", to: "/academic", category: "PAGE", icon: Layout }
  ]
};

const DEFAULT_MODULES = [
  { code: 'COMS 111', title: 'Introduction to Computer Science & Problem Solving', level: 1, to: '/modules' },
  { code: 'COMS 112', title: 'Structured Programming in C/C++', level: 1, to: '/modules' },
  { code: 'COMS 113', title: 'Discrete Mathematics & Computing Logic', level: 1, to: '/modules' },
  { code: 'COMS 114', title: 'Computer Hardware & Digital Electronics', level: 1, to: '/modules' },
  { code: 'COMS 211', title: 'Data Structures & Algorithms', level: 2, to: '/modules' },
  { code: 'COMS 212', title: 'Database Systems & SQL Design', level: 2, to: '/modules' },
  { code: 'COMS 213', title: 'Object-Oriented Software Engineering', level: 2, to: '/modules' },
  { code: 'COMS 214', title: 'Computer Networks & Data Communications', level: 2, to: '/modules' },
  { code: 'BIT 111', title: 'Business Information Systems Fundamentals', level: 1, to: '/modules' },
  { code: 'SE 111', title: 'Software Engineering Principles', level: 1, to: '/modules' },
  { code: 'TELE 111', title: 'Introduction to Telecommunication Systems', level: 1, to: '/modules' }
];



export default function GlobalSearchBar({ role = 'student' }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [liveModules, setLiveModules] = useState([]);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  // Load live modules dynamically
  useEffect(() => {
    let active = true;
    const fetchModules = async () => {
      try {
        const endpoint = role === 'hod' ? '/hod/courses' : (role === 'lecturer' ? '/lecturer/courses' : '/courses');
        const data = await apiFetch(endpoint);
        if (active && Array.isArray(data) && data.length) {
          setLiveModules(data);
        }
      } catch (_) {}
    };
    fetchModules();
    return () => { active = false; };
  }, [role]);

  // Combine pages and modules only (venues are managed by HOD — no hardcoded suggestions)
  const allItems = useMemo(() => {
    const pages = (DEFAULT_PAGES[role] || DEFAULT_PAGES.student).map(p => ({
      ...p,
      category: 'PAGE',
      badgeClass: 'bg-blue-100 text-blue-700'
    }));

    const moduleSource = liveModules.length ? liveModules : DEFAULT_MODULES;
    const moduleItems = moduleSource.map(m => ({
      label: `${m.code} - ${m.title}`,
      sub: `Level ${m.level || 1} Module · Computer Science Department`,
      to: role === 'hod' ? '/courses' : '/modules',
      category: 'MODULE',
      badgeClass: 'bg-emerald-100 text-emerald-700',
      icon: BookOpen
    }));

    return [...pages, ...moduleItems];
  }, [role, liveModules]);

  // Filter items matching query
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Suggest top 5 quick pages
      return (DEFAULT_PAGES[role] || DEFAULT_PAGES.student).slice(0, 5).map(p => ({
        ...p,
        category: 'QUICK LINK',
        badgeClass: 'bg-slate-100 text-slate-700'
      }));
    }

    return allItems.filter(item => {
      const matchLabel = item.label?.toLowerCase().includes(q);
      const matchSub = item.sub?.toLowerCase().includes(q);
      const matchCat = item.category?.toLowerCase().includes(q);
      return matchLabel || matchSub || matchCat;
    }).slice(0, 8);
  }, [query, allItems, role]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = to => {
    setIsOpen(false);
    setQuery('');
    navigate(to);
  };

  return (
    <div ref={containerRef} className="relative z-30 ml-2">
      {/* Search Input Box */}
      <div className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/90 rounded-full px-3.5 py-1.5 focus-within:bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all w-48 sm:w-64 lg:w-80 shadow-sm">
        <Search size={15} className="text-slate-400 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') setIsOpen(false);
          }}
          placeholder="Search modules, courses, venues..."
          className="bg-transparent border-none text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none w-full"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Floating Dropdown Results Panel */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 sm:w-88 lg:w-96 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden py-1.5 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>{query ? `Results for "${query}"` : 'Quick Navigation'}</span>
            <span>{filtered.length} found</span>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                No matching modules, courses, or venues found.
              </div>
            ) : (
              filtered.map((item, idx) => {
                const IconComponent = item.icon || Layout;
                return (
                  <button
                    key={`${item.to}-${item.label}-${idx}`}
                    type="button"
                    onClick={() => handleSelect(item.to)}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-blue-50/70 flex items-center justify-between group transition-colors border-b border-slate-50 last:border-none"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-blue-100 text-slate-500 group-hover:text-blue-600 flex items-center justify-center shrink-0 transition-colors">
                        <IconComponent size={14} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 group-hover:text-blue-700 truncate">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {item.sub}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${item.badgeClass || 'bg-slate-100 text-slate-600'}`}>
                        {item.category}
                      </span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-600 transition-colors" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
