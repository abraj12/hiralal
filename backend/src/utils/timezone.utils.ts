import { toZonedTime, format } from 'date-fns-tz';

export const TIMEZONE_IST = 'Asia/Kolkata';

/**
 * Returns current date and time converted to Asia/Kolkata timezone.
 */
export function getIstDate(date: Date = new Date()): Date {
  return toZonedTime(date, TIMEZONE_IST);
}

/**
 * Extracts business year and month (1-indexed: 1 = Jan, 12 = Dec) in Asia/Kolkata.
 */
export function getIstYearAndMonth(date: Date = new Date()): { year: number; month: number } {
  const zoned = getIstDate(date);
  const yearStr = format(zoned, 'yyyy', { timeZone: TIMEZONE_IST });
  const monthStr = format(zoned, 'MM', { timeZone: TIMEZONE_IST });

  return {
    year: parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
  };
}

/**
 * Formats a Date into Asia/Kolkata readable string.
 */
export function formatIstDate(date: Date, fmt = 'yyyy-MM-dd HH:mm:ss'): string {
  return format(toZonedTime(date, TIMEZONE_IST), fmt, { timeZone: TIMEZONE_IST });
}

/**
 * Returns today's calendar date string (YYYY-MM-DD) in Asia/Kolkata.
 */
export function getIndiaCalendarToday(): string {
  return format(toZonedTime(new Date(), TIMEZONE_IST), 'yyyy-MM-dd', { timeZone: TIMEZONE_IST });
}

/**
 * Normalizes a date-only string or Date instance to the exact start of that business day (00:00:00.000) in Asia/Kolkata (IST).
 * When given a string like "2026-10-15", it returns the Date representing 2026-10-15 00:00:00.000 IST (UTC: 2026-10-14T18:30:00.000Z).
 * This eliminates accidental day-shift discrepancies caused by mixing UTC timestamps and local Indian business dates.
 */
export function parseIndiaBusinessDate(input?: string | Date | null): Date {
  if (!input) {
    const todayStr = getIndiaCalendarToday();
    return new Date(`${todayStr}T00:00:00+05:30`);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      return new Date(`${y}-${m}-${d}T00:00:00+05:30`);
    }
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid date string: ${input}`);
    }
    const dateStr = format(toZonedTime(parsed, TIMEZONE_IST), 'yyyy-MM-dd', { timeZone: TIMEZONE_IST });
    return new Date(`${dateStr}T00:00:00+05:30`);
  }

  if (input instanceof Date) {
    if (isNaN(input.getTime())) {
      throw new Error('Invalid Date instance');
    }
    const dateStr = format(toZonedTime(input, TIMEZONE_IST), 'yyyy-MM-dd', { timeZone: TIMEZONE_IST });
    return new Date(`${dateStr}T00:00:00+05:30`);
  }

  throw new Error('Invalid date input: must be string or Date');
}
