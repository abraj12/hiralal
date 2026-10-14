/**
 * Role-Based Navigation Filtering Utilities for Admin Portal
 * Restricts visible interface tabs strictly to authorized roles (BILL_ADMIN, OPERATIONS_ADMIN).
 */
export function filterNavItemsByRole<T extends { roles: string[] }>(
  items: T[],
  role: string | null | undefined
): T[] {
  if (!role || (role !== 'BILL_ADMIN' && role !== 'OPERATIONS_ADMIN')) {
    return [];
  }
  return items.filter((item) => item.roles.includes(role));
}
