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
