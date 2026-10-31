const test = require('node:test');
const assert = require('node:assert');
const { resolveDocumentUrl, isAllowedDocumentUrl } = require('../plugins/documentUrlValidation');

test('FINDING-03: Mobile Admin Document URL Validation Suite', async (t) => {
  await t.test('accepts approved Cloudflare R2 storage URLs', () => {
    assert.strictEqual(
      resolveDocumentUrl('https://pub-1234.r2.dev/invoices/inv-001.pdf'),
      'https://pub-1234.r2.dev/invoices/inv-001.pdf'
    );
    assert.strictEqual(
      resolveDocumentUrl('https://account.r2.cloudflarestorage.com/bucket/doc.jpg'),
      'https://account.r2.cloudflarestorage.com/bucket/doc.jpg'
    );
    assert.strictEqual(isAllowedDocumentUrl('https://pub-1234.r2.dev/invoices/inv-001.pdf'), true);
  });

  await t.test('accepts approved AWS S3 storage URLs', () => {
    assert.strictEqual(
      resolveDocumentUrl('https://mybucket.s3.amazonaws.com/bills/bill-101.png'),
      'https://mybucket.s3.amazonaws.com/bills/bill-101.png'
    );
    assert.strictEqual(isAllowedDocumentUrl('https://mybucket.s3.amazonaws.com/bills/bill-101.png'), true);
  });

  await t.test('accepts approved canonical domain URLs', () => {
    assert.strictEqual(
      resolveDocumentUrl('https://hsspl.algions.in/uploads/doc.pdf'),
      'https://hsspl.algions.in/uploads/doc.pdf'
    );
    assert.strictEqual(isAllowedDocumentUrl('https://hsspl.algions.in/uploads/doc.pdf'), true);
  });

  await t.test('strictly rejects unapproved external HTTPS domains', () => {
    assert.strictEqual(resolveDocumentUrl('https://evil-attacker.com/malware.pdf'), null);
    assert.strictEqual(resolveDocumentUrl('https://google.com/search'), null);
    assert.strictEqual(isAllowedDocumentUrl('https://evil-attacker.com/malware.pdf'), false);
  });

  await t.test('strictly rejects subdomain prefix lookalike attacks', () => {
    assert.strictEqual(resolveDocumentUrl('https://s3.amazonaws.com.attacker.com/fake.pdf'), null);
    assert.strictEqual(resolveDocumentUrl('https://hsspl.algions.in.phishing.org/login'), null);
    assert.strictEqual(resolveDocumentUrl('https://attacker-r2.dev/fake.pdf'), null);
    assert.strictEqual(resolveDocumentUrl('https://evil-s3.amazonaws.com/fake.pdf'), null);
    assert.strictEqual(isAllowedDocumentUrl('https://s3.amazonaws.com.attacker.com/fake.pdf'), false);
    assert.strictEqual(isAllowedDocumentUrl('https://attacker-r2.dev/fake.pdf'), false);
    assert.strictEqual(isAllowedDocumentUrl('https://evil-s3.amazonaws.com/fake.pdf'), false);
  });

  await t.test('strictly rejects dangerous schemes like javascript:, file:, data:', () => {
    assert.strictEqual(resolveDocumentUrl('javascript:alert(1)'), null);
    assert.strictEqual(resolveDocumentUrl('file:///etc/passwd'), null);
    assert.strictEqual(resolveDocumentUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.strictEqual(isAllowedDocumentUrl('javascript:alert(1)'), false);
  });

  await t.test('returns null for null, undefined, or empty inputs', () => {
    assert.strictEqual(resolveDocumentUrl(null), null);
    assert.strictEqual(resolveDocumentUrl(undefined), null);
    assert.strictEqual(resolveDocumentUrl(''), null);
    assert.strictEqual(resolveDocumentUrl('   '), null);
    assert.strictEqual(isAllowedDocumentUrl(''), false);
  });
});
