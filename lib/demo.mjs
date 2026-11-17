// Pure demo logic. No messages, changes, or approvals leave the browser.
export const initialCandidates = [
  { id: 1, name: 'Maria Reyes', initials: 'MR', area: 'Youngsville', shifts: ['Nights', 'Weekends'], transport: true, languages: 'English, Spanish', referredBy: 'Ana Torres', tenure: '8 months', attendance: '97%', school: false, hospital: false, status: 'New' },
  { id: 2, name: 'Jordan Miles', initials: 'JM', area: 'Broussard', shifts: ['Days', 'Nights'], transport: true, languages: 'English', referredBy: 'Nobody', tenure: null, attendance: null, school: false, hospital: false, status: 'New' },
  { id: 3, name: 'Sofia Cruz', initials: 'SC', area: 'Lafayette', shifts: ['Nights'], transport: true, languages: 'English, Spanish', referredBy: 'Luis Rivera', tenure: '1 year', attendance: '95%', school: false, hospital: false, status: 'New' },
];

export const coverageCrew = [
  { name: 'Ana Torres', role: 'Backup A', school: false, hospital: true, rookie: true, health: true, available: true, hours: 22, shiftHours: 4, cap: 40 },
  { name: 'Marcus Reed', role: 'Backup B', school: true, hospital: false, rookie: true, health: false, available: true, hours: 20, shiftHours: 4, cap: 40 },
  { name: 'Luis Rivera', role: 'Floater', school: true, hospital: true, rookie: true, health: true, available: true, hours: 16, shiftHours: 4, cap: 40 },
];

export function eligible(worker, siteType, requireHealth = true) {
  if (!worker || !['school', 'hospital', 'office'].includes(siteType)) return false;
  if (worker.available !== true || worker.rookie !== true) return false;
  if (![worker.hours, worker.shiftHours, worker.cap].every(Number.isFinite) || worker.hours < 0 || worker.shiftHours <= 0 || worker.cap < 0 || worker.hours + worker.shiftHours > worker.cap) return false;
  if (siteType === 'school' && worker.school !== true) return false;
  if (siteType === 'hospital' && (worker.hospital !== true || (requireHealth && worker.health !== true))) return false;
  return true;
}

// Demo assumes the first eligible person accepts; it is not a real offer or reservation.
export function simulateCoverage(crew, siteType) {
  const log = [];
  for (const worker of crew) {
    if (!eligible(worker, siteType)) {
      log.push({ name: worker.name, role: worker.role, outcome: 'skipped' });
      continue;
    }
    log.push({ name: worker.name, role: worker.role, outcome: 'accepted' });
    return { log, filledBy: worker.name };
  }
  return { log, filledBy: null };
}
