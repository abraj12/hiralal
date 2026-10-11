import test from 'node:test';
import assert from 'node:assert';
import { parseIndiaIsoDateTime, isLeapYear, getDaysInMonth } from './date-utils.ts';

test('isLeapYear correctly determines leap years', () => {
  assert.strictEqual(isLeapYear(2024), true);
  assert.strictEqual(isLeapYear(2020), true);
  assert.strictEqual(isLeapYear(2000), true);
  assert.strictEqual(isLeapYear(2025), false);
  assert.strictEqual(isLeapYear(2026), false);
  assert.strictEqual(isLeapYear(1900), false);
  assert.strictEqual(isLeapYear(2100), false);
});

test('getDaysInMonth returns correct days for each month', () => {
  assert.strictEqual(getDaysInMonth(2026, 1), 31);
  assert.strictEqual(getDaysInMonth(2026, 2), 28);
  assert.strictEqual(getDaysInMonth(2024, 2), 29);
  assert.strictEqual(getDaysInMonth(2026, 3), 31);
  assert.strictEqual(getDaysInMonth(2026, 4), 30);
  assert.strictEqual(getDaysInMonth(2026, 5), 31);
  assert.strictEqual(getDaysInMonth(2026, 6), 30);
  assert.strictEqual(getDaysInMonth(2026, 7), 31);
  assert.strictEqual(getDaysInMonth(2026, 8), 31);
  assert.strictEqual(getDaysInMonth(2026, 9), 30);
  assert.strictEqual(getDaysInMonth(2026, 10), 31);
  assert.strictEqual(getDaysInMonth(2026, 11), 30);
  assert.strictEqual(getDaysInMonth(2026, 12), 31);
});

test('parseIndiaIsoDateTime rejects impossible calendar date: 2026-02-31', () => {
  assert.throws(
    () => parseIndiaIsoDateTime('2026-02-31', '10:00'),
    /Invalid calendar date: "2026-02-31"/
  );
});

test('parseIndiaIsoDateTime rejects leap day in non-leap year: 2025-02-29', () => {
  assert.throws(
    () => parseIndiaIsoDateTime('2025-02-29', '10:00'),
    /Month 2 in year 2025 has only 28 days/
  );
});

test('parseIndiaIsoDateTime accepts valid leap day in leap year: 2024-02-29', () => {
  const result = parseIndiaIsoDateTime('2024-02-29', '10:00');
  assert.strictEqual(result, new Date('2024-02-29T10:00:00+05:30').toISOString());
});

test('parseIndiaIsoDateTime rejects impossible 31st in 30-day month: 2026-04-31', () => {
  assert.throws(
    () => parseIndiaIsoDateTime('2026-04-31', '10:00'),
    /Month 4 in year 2026 has only 30 days/
  );
});

test('parseIndiaIsoDateTime accepts valid date and end-of-day time: 2026-10-15 23:59', () => {
  const result = parseIndiaIsoDateTime('2026-10-15', '23:59');
  assert.strictEqual(result, new Date('2026-10-15T23:59:00+05:30').toISOString());
});

test('parseIndiaIsoDateTime rejects invalid times: 25:00 and 10:60', () => {
  assert.throws(
    () => parseIndiaIsoDateTime('2026-10-15', '25:00'),
    /Invalid hour 25/
  );
  assert.throws(
    () => parseIndiaIsoDateTime('2026-10-15', '10:60'),
    /Invalid minute 60/
  );
});

test('invalid admin inputs cannot be normalized into a shifted valid date before API submission', () => {
  // If native JS Date parsing were used directly, 2026-02-31 would silently normalize to March 3.
  // Our helper MUST throw an error, preventing silent transformation.
  assert.throws(() => parseIndiaIsoDateTime('2026-02-31', '12:00'));
  assert.throws(() => parseIndiaIsoDateTime('2026-04-31', '12:00'));
  assert.throws(() => parseIndiaIsoDateTime('2026-06-31', '12:00'));
  assert.throws(() => parseIndiaIsoDateTime('2026-09-31', '12:00'));
  assert.throws(() => parseIndiaIsoDateTime('2026-11-31', '12:00'));
});
