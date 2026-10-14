import test from 'node:test';
import assert from 'node:assert';
import { calculateBillFinancials } from './financial-utils.ts';
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

