const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAdminPrefixes } = require('./validateAdminPrefixes');

test('validateAdminPrefixes - accepts valid distinct prefixes', () => {
  const result = validateAdminPrefixes({
    billAdmin: 'BADM',
    operationsAdmin: 'OADM',
  });
  assert.deepEqual(result, {
    billAdmin: 'BADM',
    operationsAdmin: 'OADM',
  });
});

test('validateAdminPrefixes - trims whitespace and normalizes to uppercase', () => {
  const result = validateAdminPrefixes({
    billAdmin: '  badm  ',
    operationsAdmin: ' oadm ',
  });
  assert.deepEqual(result, {
    billAdmin: 'BADM',
    operationsAdmin: 'OADM',
  });
});

test('validateAdminPrefixes - rejects identical prefixes', () => {
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: 'ADMIN', operationsAdmin: 'ADMIN' }),
    /prefixes must be distinct/i
  );
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: 'admin', operationsAdmin: 'ADMIN' }),
    /prefixes must be distinct/i
  );
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: ' BADM ', operationsAdmin: 'badm' }),
    /prefixes must be distinct/i
  );
});

test('validateAdminPrefixes - rejects missing or empty billAdmin', () => {
  assert.throws(
    () => validateAdminPrefixes({ operationsAdmin: 'OADM' }),
    /Bill Admin prefix must be a non-empty string/i
  );
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: '', operationsAdmin: 'OADM' }),
    /Bill Admin prefix must be a non-empty string/i
  );
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: '   ', operationsAdmin: 'OADM' }),
    /Bill Admin prefix must be a non-empty string/i
  );
});

test('validateAdminPrefixes - rejects missing or empty operationsAdmin', () => {
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: 'BADM' }),
    /Operations Admin prefix must be a non-empty string/i
  );
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: 'BADM', operationsAdmin: '' }),
    /Operations Admin prefix must be a non-empty string/i
  );
  assert.throws(
    () => validateAdminPrefixes({ billAdmin: 'BADM', operationsAdmin: '   ' }),
    /Operations Admin prefix must be a non-empty string/i
  );
});

test('validateAdminPrefixes - rejects non-object or nullish inputs', () => {
  assert.throws(
    () => validateAdminPrefixes(null),
    /must be an object/i
  );
  assert.throws(
    () => validateAdminPrefixes(undefined),
    /must be an object/i
  );
  assert.throws(
    () => validateAdminPrefixes('BADM'),
    /must be an object/i
  );
  assert.throws(
    () => validateAdminPrefixes([1, 2]),
    /must be an object/i
  );
});
