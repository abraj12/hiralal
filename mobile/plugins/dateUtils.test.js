const test = require('node:test');
const assert = require('node:assert/strict');

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDaysInMonth(year, month) {
  if (month < 1 || month > 12) return 0;
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return 0;
}

function parseIndiaIsoDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) {
    throw new Error('Both date and time strings are required.');
  }
  const cleanDate = dateStr.trim();
  const cleanTime = timeStr.trim();
  const dateMatch = cleanDate.match(/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  if (!dateMatch) {
    throw new Error(`Invalid date format: "${cleanDate}". Expected YYYY-MM-DD.`);
  }

  const year = parseInt(dateMatch[1], 10);
  const month = parseInt(dateMatch[2], 10);
  const day = parseInt(dateMatch[3], 10);

  const maxDays = getDaysInMonth(year, month);
  if (day > maxDays) {
    throw new Error(
      `Invalid calendar date: "${cleanDate}". Month ${month} in year ${year} has only ${maxDays} days.`
    );
  }

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

test('dateUtils - parseIndiaIsoDateTime rejects impossible calendar date: 2026-02-31', () => {
  assert.throws(
    () => parseIndiaIsoDateTime('2026-02-31', '10:00'),
    /Invalid calendar date: "2026-02-31". Month 2 in year 2026 has only 28 days./
  );
});

test('dateUtils - parseIndiaIsoDateTime rejects leap day in non-leap year: 2025-02-29', () => {
  assert.throws(
    () => parseIndiaIsoDateTime('2025-02-29', '12:00'),
    /Invalid calendar date: "2025-02-29". Month 2 in year 2025 has only 28 days./
  );
});

test('dateUtils - parseIndiaIsoDateTime accepts valid leap day: 2024-02-29', () => {
  const result = parseIndiaIsoDateTime('2024-02-29', '12:00');
  assert.equal(typeof result, 'string');
});

test('dateUtils - parseIndiaIsoDateTime rejects invalid times', () => {
  assert.throws(() => parseIndiaIsoDateTime('2026-10-15', '25:00'), /Invalid hour 25/);
  assert.throws(() => parseIndiaIsoDateTime('2026-10-15', '10:60'), /Invalid minute 60/);
});
