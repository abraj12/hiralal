/**
 * Authoritative Admin Role Verification Module for Hiralal Admin Mobile
 * Restricts access strictly to BILL_ADMIN and OPERATIONS_ADMIN (HIR-ROLE-01, HIR-I-01)
 */

export const ALLOWED_ADMIN_ROLES = ['BILL_ADMIN', 'OPERATIONS_ADMIN'] as const;
export type AdminRole = typeof ALLOWED_ADMIN_ROLES[number];

export function validateAdminRole(role: unknown): role is AdminRole {
  if (!role || typeof role !== 'string' || !ALLOWED_ADMIN_ROLES.includes(role as AdminRole)) {
    throw new Error(`Unauthorized role: ${role}. Access is restricted strictly to BILL_ADMIN and OPERATIONS_ADMIN.`);
  }
  return true;
}

export function isValidAdminRole(role: unknown): role is AdminRole {
  return typeof role === 'string' && (ALLOWED_ADMIN_ROLES as readonly string[]).includes(role);
}
