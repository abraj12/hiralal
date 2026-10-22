import test from 'node:test';
import assert from 'node:assert';
import { calculateBillFinancials, safeDocumentUrl } from './financial-utils.ts';
import { filterNavItemsByRole } from './nav-utils.ts';

test('calculateBillFinancials: correctly handles GST excluded invoices', () => {
  const result = calculateBillFinancials(1000.0, false, 18.0, 1.5);
  assert.strictEqual(result.gstAmount, 0.0);
  assert.strictEqual(result.eligibleRewardAmount, 1000.0);
  assert.strictEqual(result.calculatedReward, 15.0);
});

test('calculateBillFinancials: correctly reverses 18% GST on inclusive invoices', () => {
  // Gross: 1180, 18% GST => GST: 180, Eligible: 1000, 1% reward => 10
  const result = calculateBillFinancials(1180.0, true, 18.0, 1.0);
  assert.strictEqual(result.gstAmount, 180.0);
  assert.strictEqual(result.eligibleRewardAmount, 1000.0);
  assert.strictEqual(result.calculatedReward, 10.0);
});

test('calculateBillFinancials: correctly reverses 5% GST on inclusive invoices', () => {
  // Gross: 1050, 5% GST => GST: 50, Eligible: 1000, 2% reward => 20
  const result = calculateBillFinancials(1050.0, true, 5.0, 2.0);
  assert.strictEqual(result.gstAmount, 50.0);
  assert.strictEqual(result.eligibleRewardAmount, 1000.0);
  assert.strictEqual(result.calculatedReward, 20.0);
});

test('calculateBillFinancials: handles 0% GST rate with paise precision', () => {
  const result = calculateBillFinancials(5000.0, true, 0.0, 1.0);
  assert.strictEqual(result.gstAmount, 0.0);
  assert.strictEqual(result.eligibleRewardAmount, 5000.0);
  assert.strictEqual(result.calculatedReward, 50.0);
});

test('calculateBillFinancials: returns 0 reward when reward percentage is not configured', () => {
  const result = calculateBillFinancials(1180.0, true, 18.0, null);
  assert.strictEqual(result.gstAmount, 180.0);
  assert.strictEqual(result.eligibleRewardAmount, 1000.0);
  assert.strictEqual(result.calculatedReward, 0.0);
});

test('filterNavItemsByRole: BILL_ADMIN only accesses Dashboard and Bills Verification', () => {
  const sampleItems = [
    { label: 'Dashboard', href: '/', roles: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] },
    { label: 'Plumbers & Tiles', href: '/users', roles: ['OPERATIONS_ADMIN'] },
    { label: 'Bills Verification', href: '/bills', roles: ['BILL_ADMIN'] },
    { label: 'Payouts', href: '/payouts', roles: ['OPERATIONS_ADMIN'] },
    { label: 'Settings', href: '/settings', roles: ['OPERATIONS_ADMIN'] },
  ];

  const filtered = filterNavItemsByRole(sampleItems, 'BILL_ADMIN');
  const labels = filtered.map((i) => i.label);

  assert.deepStrictEqual(labels, ['Dashboard', 'Bills Verification']);
  assert.strictEqual(labels.includes('Payouts'), false);
  assert.strictEqual(labels.includes('Plumbers & Tiles'), false);
  assert.strictEqual(labels.includes('Settings'), false);
});

test('filterNavItemsByRole: OPERATIONS_ADMIN accesses admin management but NOT bills verification', () => {
  const sampleItems = [
    { label: 'Dashboard', href: '/', roles: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] },
    { label: 'Plumbers & Tiles', href: '/users', roles: ['OPERATIONS_ADMIN'] },
    { label: 'Bills Verification', href: '/bills', roles: ['BILL_ADMIN'] },
    { label: 'Payouts', href: '/payouts', roles: ['OPERATIONS_ADMIN'] },
    { label: 'Settings', href: '/settings', roles: ['OPERATIONS_ADMIN'] },
  ];

  const filtered = filterNavItemsByRole(sampleItems, 'OPERATIONS_ADMIN');
  const labels = filtered.map((i) => i.label);

  assert.deepStrictEqual(labels, ['Dashboard', 'Plumbers & Tiles', 'Payouts', 'Settings']);
  assert.strictEqual(labels.includes('Bills Verification'), false);
});

test('filterNavItemsByRole: rejects legacy ADMIN, USER, or missing role', () => {
  const sampleItems = [
    { label: 'Dashboard', href: '/', roles: ['BILL_ADMIN', 'OPERATIONS_ADMIN'] },
    { label: 'Bills Verification', href: '/bills', roles: ['BILL_ADMIN'] },
  ];

  assert.deepStrictEqual(filterNavItemsByRole(sampleItems, 'ADMIN'), []);
  assert.deepStrictEqual(filterNavItemsByRole(sampleItems, 'USER'), []);
  assert.deepStrictEqual(filterNavItemsByRole(sampleItems, null), []);
  assert.deepStrictEqual(filterNavItemsByRole(sampleItems, undefined), []);
});

test('calculateBillFinancials: handles float GST rates with paise precision', () => {
  // Gross: 1075, 7.5% GST => GST: 1075 * 7.5 / 107.5 = 75, Eligible: 1000, 1.25% reward => 12.5
  const result = calculateBillFinancials(1075.0, true, 7.5, 1.25);
  assert.strictEqual(result.gstAmount, 75.0);
  assert.strictEqual(result.eligibleRewardAmount, 1000.0);
  assert.strictEqual(result.calculatedReward, 12.5);
});

test('safeDocumentUrl: permits valid relative paths with query parameters and hash fragments (RED-01)', () => {
  // Query parameters on relative paths
  assert.strictEqual(safeDocumentUrl('/uploads/bill-1.pdf?token=xyz'), '/uploads/bill-1.pdf?token=xyz');
  assert.strictEqual(safeDocumentUrl('/uploads/bill-1.pdf?token=xyz&preview=true'), '/uploads/bill-1.pdf?token=xyz&preview=true');
  assert.strictEqual(safeDocumentUrl('/documents/invoice-2026.pdf?token=abc123&page=1#view'), '/documents/invoice-2026.pdf?token=abc123&page=1#view');

  // Query-only and hash-only relative URLs
  assert.strictEqual(safeDocumentUrl('?preview=true'), '?preview=true');
  assert.strictEqual(safeDocumentUrl('#preview-section'), '#preview-section');

  // Standard safe relative path
  assert.strictEqual(safeDocumentUrl('/uploads/bill-1.pdf'), '/uploads/bill-1.pdf');
});

test('safeDocumentUrl: rejects single, double, and multi-encoded directory traversal (RED-01)', () => {
  // Double-encoded traversal (%252e%252e -> %2e%2e -> ..)
  assert.strictEqual(safeDocumentUrl('/uploads/%252e%252e/secrets.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('%252e%252e'), '#');
  assert.strictEqual(safeDocumentUrl('/uploads/bill-1.pdf?file=%252e%252e/secret.env'), '#');

  // Triple-encoded traversal (%25252e%25252e)
  assert.strictEqual(safeDocumentUrl('/uploads/%25252e%25252e/secrets.pdf'), '#');

  // Single-encoded traversal (%2e%2e -> ..)
  assert.strictEqual(safeDocumentUrl('/uploads/%2e%2e/secrets.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('/uploads/bill-1.pdf?file=%2e%2e/secret.env'), '#');

  // Raw directory traversal sequences
  assert.strictEqual(safeDocumentUrl('/uploads/../secrets.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('../secrets.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('/..%2fadmin/passwords.txt'), '#');
});

test('safeDocumentUrl: rejects protocol-relative URLs and multi-encoded bypasses', () => {
  // Standard protocol-relative prefixes
  assert.strictEqual(safeDocumentUrl('//attacker.com/malicious.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('///attacker.com/malicious.pdf'), '#');

  // Encoded slash protocol-relative URLs
  assert.strictEqual(safeDocumentUrl('/%2Fattacker.com'), '#');
  assert.strictEqual(safeDocumentUrl('%2F%2Fattacker.com'), '#');
  assert.strictEqual(safeDocumentUrl('%252F%252Fattacker.com'), '#');

  // Backslash normalization bypasses
  assert.strictEqual(safeDocumentUrl('/\\attacker.com'), '#');
  assert.strictEqual(safeDocumentUrl('\\attacker.com'), '#');
  assert.strictEqual(safeDocumentUrl('/%255cattacker.com'), '#');
  assert.strictEqual(safeDocumentUrl('/%5cattacker.com'), '#');
});

test('safeDocumentUrl: validates external URLs strictly allowing https and localhost / 127.0.0.1', () => {
  // Safe external HTTPS URLs
  assert.strictEqual(safeDocumentUrl('https://s3.amazonaws.com/bills/invoice.pdf'), 'https://s3.amazonaws.com/bills/invoice.pdf');
  assert.strictEqual(safeDocumentUrl('https://s3.amazonaws.com/bills/invoice.pdf?token=xyz#page1'), 'https://s3.amazonaws.com/bills/invoice.pdf?token=xyz#page1');
  assert.strictEqual(safeDocumentUrl('https://my-bucket.r2.cloudflarestorage.com/bills/invoice.pdf'), 'https://my-bucket.r2.cloudflarestorage.com/bills/invoice.pdf');
  assert.strictEqual(safeDocumentUrl('https://hiralalandsonspvtltd.com/bills/invoice.pdf'), 'https://hiralalandsonspvtltd.com/bills/invoice.pdf');

  // Reject untrusted external HTTPS domains (F-21)
  assert.strictEqual(safeDocumentUrl('https://attacker.com/bills/invoice.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('https://phishing-site.org/malware.exe'), '#');

  // Local development HTTP URLs
  assert.strictEqual(safeDocumentUrl('http://localhost:3000/uploads/bill.pdf'), 'http://localhost:3000/uploads/bill.pdf');
  assert.strictEqual(safeDocumentUrl('http://127.0.0.1:8080/uploads/bill.pdf'), 'http://127.0.0.1:8080/uploads/bill.pdf');

  // Reject insecure HTTP on non-localhost domains
  assert.strictEqual(safeDocumentUrl('http://insecure-domain.com/bill.pdf'), '#');

  // Reject domain spoofing attempts targeting localhost/127.0.0.1
  assert.strictEqual(safeDocumentUrl('http://localhost.attacker.com/bill.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('http://127.0.0.1.attacker.com/bill.pdf'), '#');
  assert.strictEqual(safeDocumentUrl('http://localhost@attacker.com/bill.pdf'), '#');

  // Reject dangerous protocols and empty inputs
  assert.strictEqual(safeDocumentUrl('javascript:alert(1)'), '#');
  assert.strictEqual(safeDocumentUrl('data:text/html,<script>alert(1)</script>'), '#');
  assert.strictEqual(safeDocumentUrl(null), '#');
  assert.strictEqual(safeDocumentUrl(undefined), '#');
  assert.strictEqual(safeDocumentUrl(''), '#');
  assert.strictEqual(safeDocumentUrl('   '), '#');
});


