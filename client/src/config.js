/**
 * Department and Degree programmes offered by the Computer Science Department:
 * Computer Science, BIT (Business Information Technology), Software Engineering
 */
export const DEPARTMENT = 'Computer Science';

export const PROGRAMME_TYPES = [
  'Degree',
  'Diploma',
  'HND'
];

export const DEPT_COURSES = [
  'Computer Science',
  'Business Information Systems',
  'Software Engineering',
  'Telecommunication'
];

export const PROGRAMMES = [
  'Degree',
  'Diploma',
  'HND',
  'Computer Science',
  'BIT',
  'Business Information Systems',
  'Software Engineering',
  'Telecommunication'
];

export const PROGRAMME_LABELS = {
  'Degree': 'Degree (Year 1 to 4)',
  'Diploma': 'Diploma (Year 1 to 2)',
  'HND': 'HND (Year 1 to 3)',
  'Computer Science': 'Computer Science',
  'BIT': 'Business Information Systems',
  'Business Information Systems': 'Business Information Systems',
  'Software Engineering': 'Software Engineering',
  'Telecommunication': 'Telecommunication'
};

export const PROGRAMME_DURATIONS = {
  'Degree': 4,
  'Diploma': 2,
  'HND': 3,
  'Computer Science': 4,
  'BIT': 4,
  'Business Information Systems': 4,
  'Software Engineering': 4,
  'Telecommunication': 4
};

export const getLevelsForProgramme = (programme) => {
  const maxYears = PROGRAMME_DURATIONS[programme] || 4;
  return Array.from({ length: maxYears }, (_, i) => i + 1);
};

export const LEVELS = [1, 2, 3, 4];
export const LEVEL_LABELS = {
  1: 'Year 1',
  2: 'Year 2',
  3: 'Year 3',
  4: 'Year 4'
};
export const SEMESTERS = [1, 2];
export const SEMESTER_LABELS = {
  1: 'First Semester',
  2: 'Second Semester'
};
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const STATUS_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  absent: 'Absent',
  correction_requested: 'Correction requested',
  excused: 'Excused',
  appealed: 'Appealed'
};

export const attendanceThresholdTone = (percentage, threshold = 75) => {
  if (percentage >= threshold) return 'good';
  if (percentage >= threshold - 5) return 'warn';
  return 'low';
};
export const hhmm = t => (t || '').slice(0, 5);
