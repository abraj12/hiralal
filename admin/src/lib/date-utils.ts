/**
 * Date and time formatting and parsing helpers in Asia/Kolkata (IST).
 * Guarantees that browser client timezone does not shift business dates or redemption windows.
 */

export function getIndiaCalendarToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatIndiaDateOnly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatIndiaTimeOnly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function parseIndiaIsoDateTime(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) {
    throw new Error('Both date and time strings are required.');
  }
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr.trim();
  // Validate date: must be exact YYYY-MM-DD
  const dateMatch = cleanDate.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!dateMatch) {
    throw new Error(`Invalid date format: "${cleanDate}". Expected YYYY-MM-DD.`);
  }
  // Validate time: must be exact HH:mm with valid ranges
  const timeMatch = cleanTime.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch) {
    throw new Error(`Invalid time format: "${cleanTime}". Expected HH:mm (e.g. 09:30).`);
  }
  const h = parseInt(timeMatch[1], 10);
  const m = parseInt(timeMatch[2], 10);
  if (h > 23) {
    throw new Error(`Invalid hour ${h} in time "${cleanTime}". Hours must be 0–23.`);
  }
  if (m > 59) {
    throw new Error(`Invalid minute ${m} in time "${cleanTime}". Minutes must be 0–59.`);
  }
  const dateObj = new Date(`${cleanDate}T${cleanTime}:00+05:30`);
  if (isNaN(dateObj.getTime())) {
    throw new Error(`Invalid date/time combination: "${cleanDate} ${cleanTime}".`);
  }
  return dateObj.toISOString();
}

