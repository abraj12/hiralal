import { toZonedTime, format, formatInTimeZone } from 'date-fns-tz';

export const TIMEZONE_IST = 'Asia/Kolkata';

/**
 * Formats a Date into Asia/Kolkata ISO 8601 string with explicit offset (e.g., 2026-10-22T02:19:23.094+05:30).
 */
export function formatIstIso(date: Date = new Date()): string {
  return formatInTimeZone(date, TIMEZONE_IST, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx");
}

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
 * Checks if a year is a leap year in the Gregorian calendar.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Returns the maximum number of days in a given month of a year.
 * month is 1-indexed (1 = Jan, 12 = Dec).
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return 0;
}

/**
 * Strictly validates and parses an exact "YYYY-MM-DD" date-only string in the India business calendar.
 * Rejects:
 * - Impossible calendar dates (e.g. 2026-02-31, 2025-02-29, 2026-04-31)
 * - Invalid months (00, 13)
 * - Trailing garbage or prefixes (e.g. "2026-02-31T00:00:00", "2026-10-15-extra")
 * - Malformed strings or non-strings
 * Returns a Date normalized to exact midnight 00:00:00.000 in Asia/Kolkata (IST).
 */
export function parseStrictIndiaDateOnly(dateStr: string): Date {
  if (typeof dateStr !== 'string') {
    throw new Error('Date-only value must be a string in YYYY-MM-DD format.');
  }
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!match) {
    throw new Error(`Invalid date format: "${dateStr}". Expected exact YYYY-MM-DD.`);
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const maxDays = getDaysInMonth(year, month);
  if (day > maxDays) {
    throw new Error(
      `Invalid calendar date: "${dateStr}". Month ${month} in year ${year} has only ${maxDays} days.`
    );
  }

  const yStr = String(year).padStart(4, '0');
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const normalized = new Date(`${yStr}-${mStr}-${dStr}T00:00:00+05:30`);
  if (isNaN(normalized.getTime())) {
    throw new Error(`Failed to parse normalized calendar date: "${dateStr}".`);
  }
  return normalized;
}

/**
 * Explicit parser for ISO timestamps (e.g. "2026-10-15T14:30:00.000Z" or "2026-10-15T14:30:00+05:30").
 * Validates:
 *   - Calendar date (delegated to parseStrictIndiaDateOnly)
 *   - Time components: hour 0–23, minute 0–59, second 0–59
 *   - Trailing garbage after the timezone offset is rejected
 * Preserves time and timezone information without silently stripping them.
 */
export function parseStrictIndiaTimestamp(isoStr: string): Date {
  if (typeof isoStr !== 'string' || !isoStr.trim()) {
    throw new Error('Timestamp must be a non-empty string.');
  }
  const trimmed = isoStr.trim();

  // Must match: YYYY-MM-DDTHH:MM[:SS[.fff]][Z|(+|-)HH:MM] with no trailing characters
  const tsMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/
  );
  if (!tsMatch) {
    throw new Error(
      `Invalid timestamp format: "${isoStr}". Expected ISO 8601 with explicit timezone (e.g. 2026-10-15T14:30:00+05:30 or 2026-10-15T14:30:00Z).`
    );
  }

  // Validate calendar date portion
  parseStrictIndiaDateOnly(`${tsMatch[1]}-${tsMatch[2]}-${tsMatch[3]}`);

  // Validate time components
  const hour = parseInt(tsMatch[4], 10);
  const minute = parseInt(tsMatch[5], 10);
  const second = tsMatch[6] !== undefined ? parseInt(tsMatch[6], 10) : 0;

  if (hour > 23) {
    throw new Error(`Invalid hour ${hour} in timestamp "${isoStr}". Hours must be 0–23.`);
  }
  if (minute > 59) {
    throw new Error(`Invalid minute ${minute} in timestamp "${isoStr}". Minutes must be 0–59.`);
  }
  if (second > 59) {
    throw new Error(`Invalid second ${second} in timestamp "${isoStr}". Seconds must be 0–59.`);
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp string: "${isoStr}".`);
  }
  return parsed;
}


/**
 * Universal business date parser for India business operations.
 * - If input is null/undefined: returns start of today in Asia/Kolkata.
 * - If input is exact YYYY-MM-DD: parses strictly via parseStrictIndiaDateOnly.
 * - If input is Date instance: validates and normalizes to start of that calendar day in Asia/Kolkata.
 * - If input is full ISO timestamp string: parses via parseStrictIndiaTimestamp and normalizes to start of that calendar day in Asia/Kolkata.
 * - Rejects impossible dates, trailing garbage, and malformed strings.
 */
export function parseIndiaBusinessDate(input?: string | Date | null): Date {
  if (input === undefined || input === null) {
    const todayStr = getIndiaCalendarToday();
    return parseStrictIndiaDateOnly(todayStr);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Date string cannot be empty.');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseStrictIndiaDateOnly(trimmed);
    }
    // If it includes 'T' or time component, validate as full timestamp
    if (trimmed.includes('T') || trimmed.includes(':')) {
      const ts = parseStrictIndiaTimestamp(trimmed);
      const calDateStr = format(toZonedTime(ts, TIMEZONE_IST), 'yyyy-MM-dd', { timeZone: TIMEZONE_IST });
      return parseStrictIndiaDateOnly(calDateStr);
    }
    throw new Error(`Invalid date format: "${input}". Expected YYYY-MM-DD or valid ISO timestamp.`);
  }

  if (input instanceof Date) {
    if (isNaN(input.getTime())) {
      throw new Error('Invalid Date instance');
    }
    const calDateStr = format(toZonedTime(input, TIMEZONE_IST), 'yyyy-MM-dd', { timeZone: TIMEZONE_IST });
    return parseStrictIndiaDateOnly(calDateStr);
  }

  throw new Error('Invalid date input: must be string or Date');
}

/**
 * Formats a Date or date string to HH:mm in Asia/Kolkata timezone.
 */
export function formatIndiaTimeOnly(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE_IST,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

/**
 * Combines date (YYYY-MM-DD) and time (HH:mm) strings in Asia/Kolkata into an ISO string with explicit +05:30 offset.
 * Strictly validates both inputs: the date must be a valid India business calendar date, and
 * the time must match HH:mm exactly with hour 0–23 and minute 0–59.
 */
export function parseIndiaIsoDateTime(dateStr: string, timeStr: string): string {
  if (!dateStr || !timeStr) {
    throw new Error('Both date and time strings are required.');
  }
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr.trim();
  // Strictly validate date part
  parseStrictIndiaDateOnly(cleanDate);
  // Strictly validate time part: must be HH:mm with valid ranges
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

/**
 * Strict parser for effective date and time in Asia/Kolkata timezone.
 * Unlike parseIndiaBusinessDate which truncates to midnight, this function
 * preserves the exact hour, minute, second, and millisecond.
 * - If input is null/undefined: returns current exact Date.
 * - If input is Date instance: validates it and returns it as-is without truncating time.
 * - If input is string:
 *   - If trimmed matches /^\d{4}-\d{2}-\d{2}$/ (date-only): normalizes to midnight 00:00:00+05:30 via parseStrictIndiaDateOnly.
 *   - If trimmed contains 'T' or ':': parses via parseStrictIndiaTimestamp, preserving exact time and validating India calendar date and time ranges.
 */
export function parseIndiaEffectiveDateTime(input?: string | Date | null): Date {
  if (input === undefined || input === null) {
    return new Date();
  }

  if (input instanceof Date) {
    if (isNaN(input.getTime())) {
      throw new Error('Invalid Date instance');
    }
    return input;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Effective date/time string cannot be empty.');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return parseStrictIndiaDateOnly(trimmed);
    }
    return parseStrictIndiaTimestamp(trimmed);
  }

  throw new Error('Invalid date input: must be string or Date');
}

