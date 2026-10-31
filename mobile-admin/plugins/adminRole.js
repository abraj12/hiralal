/**
 * Authoritative Admin Role Verification Module for Hiralal Admin Mobile
 * Restricts access strictly to BILL_ADMIN and OPERATIONS_ADMIN (HIR-ROLE-01, HIR-I-01)
 */

const ALLOWED_ADMIN_ROLES = ['BILL_ADMIN', 'OPERATIONS_ADMIN'];

function validateAdminRole(role) {
  if (!role || typeof role !== 'string' || !ALLOWED_ADMIN_ROLES.includes(role)) {
    throw new Error(`Unauthorized role: ${role}. Access is restricted strictly to BILL_ADMIN and OPERATIONS_ADMIN.`);
  }
  return true;
}

function isValidAdminRole(role) {
  return typeof role === 'string' && ALLOWED_ADMIN_ROLES.includes(role);
}

module.exports = {
  ALLOWED_ADMIN_ROLES,
  validateAdminRole,
  isValidAdminRole,
};
