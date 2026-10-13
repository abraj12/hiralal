const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal node-compatible loader or direct assertion for validateProductionApiUrl logic
function validateProductionApiUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL targeting /api/v1.');
  }
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) {
    throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL.');
  }
  if (!trimmed.endsWith('/api/v1')) {
    throw new Error('Production mobile builds require an explicit HTTPS EXPO_PUBLIC_API_URL targeting /api/v1.');
  }
  return trimmed;
}

test('validateProductionApiUrl - accepts canonical HTTPS /api/v1 endpoint', () => {
  assert.equal(
    validateProductionApiUrl('https://hsspl.algions.in/api/v1'),
    'https://hsspl.algions.in/api/v1'
  );
});

test('validateProductionApiUrl - rejects insecure HTTP protocol', () => {
  assert.throws(
    () => validateProductionApiUrl('http://hsspl.algions.in/api/v1'),
    /HTTPS/
  );
});

test('validateProductionApiUrl - rejects non-v1 path', () => {
  assert.throws(
    () => validateProductionApiUrl('https://hsspl.algions.in/api'),
    /\/api\/v1/
  );
});

test('validateProductionApiUrl - rejects null or undefined or empty string', () => {
  assert.throws(() => validateProductionApiUrl(null));
  assert.throws(() => validateProductionApiUrl(undefined));
  assert.throws(() => validateProductionApiUrl(''));
});
