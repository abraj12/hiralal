function validateAdminPrefixes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Administrator prefixes configuration must be an object.');
  }

  const { billAdmin, operationsAdmin } = raw;

  if (!billAdmin || typeof billAdmin !== 'string' || !billAdmin.trim()) {
    throw new Error('Bill Admin prefix must be a non-empty string.');
  }

  if (!operationsAdmin || typeof operationsAdmin !== 'string' || !operationsAdmin.trim()) {
    throw new Error('Operations Admin prefix must be a non-empty string.');
  }

  const normalizedBill = billAdmin.trim().toUpperCase();
  const normalizedOps = operationsAdmin.trim().toUpperCase();

  if (normalizedBill === normalizedOps) {
    throw new Error('Bill Admin and Operations Admin prefixes must be distinct.');
  }

  return {
    billAdmin: normalizedBill,
    operationsAdmin: normalizedOps,
  };
}

module.exports = { validateAdminPrefixes };
