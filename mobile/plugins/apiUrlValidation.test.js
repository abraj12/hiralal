const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionApiUrl } = require('./validateApiUrl');

test('validateProductionApiUrl - accepts canonical HTTPS /api/v1 endpoint', () => {
  assert.equal(
    validateProductionApiUrl('https://hsspl.algions.in/api/v1'),
    'https://hsspl.algions.in/api/v1'
  );
  assert.equal(
    validateProductionApiUrl('https://hsspl.algions.in/api/v1/'),
    'https://hsspl.algions.in/api/v1'
  );
  assert.equal(
    validateProductionApiUrl('  https://hsspl.algions.in/api/v1  '),
    'https://hsspl.algions.in/api/v1'
  );
});

test('validateProductionApiUrl - rejects insecure HTTP protocol', () => {
  assert.throws(
    () => validateProductionApiUrl('http://hsspl.algions.in/api/v1'),
    /production API URL must use HTTPS/
  );
});

test('validateProductionApiUrl - rejects non-canonical or wrong hostname', () => {
  assert.throws(
    () => validateProductionApiUrl('https://api.hiralal.com/api/v1'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
  assert.throws(
    () => validateProductionApiUrl('https://localhost:5000/api/v1'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
});

test('validateProductionApiUrl - rejects non-v1 path', () => {
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/api'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/api/v2'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/api/v1/auth'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
});

test('validateProductionApiUrl - rejects query parameters or hash fragments', () => {
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/api/v1?test=1'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/api/v1#hash'),
    /target https:\/\/hsspl\.algions\.in\/api\/v1/
  );
});

test('validateProductionApiUrl - rejects missing, empty, or invalid type values', () => {
  assert.throws(
    () => validateProductionApiUrl(null),
    /targeting the canonical \/api\/v1 endpoint/
  );
  assert.throws(
    () => validateProductionApiUrl(undefined),
    /targeting the canonical \/api\/v1 endpoint/
  );
  assert.throws(
    () => validateProductionApiUrl(''),
    /targeting the canonical \/api\/v1 endpoint/
  );
  assert.throws(
    () => validateProductionApiUrl('   '),
    /targeting the canonical \/api\/v1 endpoint/
  );
  assert.throws(
    () => validateProductionApiUrl('not-a-valid-url'),
    /valid absolute URL/
  );
});
