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
  const dateObj = new Date(`${cleanDate}T${cleanTime}:00+05:30`);
  if (isNaN(dateObj.getTime())) {
    throw new Error(`Invalid date/time combination: "${cleanDate} ${cleanTime}".`);
  }
  return dateObj.toISOString();
}
