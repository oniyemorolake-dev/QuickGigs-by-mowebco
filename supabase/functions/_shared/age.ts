export function qgCalendarParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

export function ageFromDateOfBirth(dateOfBirth: unknown, today = new Date()): number | null {
  const raw = String(dateOfBirth || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const current = qgCalendarParts(today);
  let age = current.year - year;
  if (
    current.month < month ||
    (current.month === month && current.day < day)
  ) age -= 1;
  return age >= 0 ? age : null;
}

export function isTeenDateOfBirth(dateOfBirth: unknown, today = new Date()): boolean {
  const age = ageFromDateOfBirth(dateOfBirth, today);
  return age != null && age >= 16 && age < 18;
}
