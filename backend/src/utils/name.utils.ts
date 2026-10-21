/**
 * Utility functions for structured Indian names, canonical display names,
 * and robust server-side normalization and matching for PAN verification.
 */

export interface StructuredNameValidation {
  isValid: boolean;
  error?: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  fullName: string;
}

/**
 * Validates structured name fields on backend.
 * First name is mandatory and non-empty. Middle and last names are optional.
 * Rejects control characters, excessive lengths, or pure symbols.
 */
export function validateStructuredName(
  firstNameRaw?: string | null,
  middleNameRaw?: string | null,
  lastNameRaw?: string | null,
  fallbackFullNameRaw?: string | null
): StructuredNameValidation {
  let firstName = (firstNameRaw || '').trim();
  let middleName = (middleNameRaw || '').trim() || undefined;
  let lastName = (lastNameRaw || '').trim() || undefined;

  // Backward compatibility: If firstName is empty but a single fullName was supplied
  if (!firstName && fallbackFullNameRaw && fallbackFullNameRaw.trim()) {
    const parts = fallbackFullNameRaw.trim().split(/\s+/);
    firstName = parts[0] || '';
    if (parts.length === 2) {
      lastName = parts[1];
    } else if (parts.length > 2) {
      middleName = parts.slice(1, -1).join(' ');
      lastName = parts[parts.length - 1];
    }
  }

  // First name is mandatory
  if (!firstName || firstName.length === 0) {
    return {
      isValid: false,
      error: 'First name is mandatory and cannot be empty.',
      firstName: '',
      fullName: '',
    };
  }

  // Check length bounds
  if (firstName.length < 1 || firstName.length > 60) {
    return {
      isValid: false,
      error: 'First name must be between 1 and 60 characters.',
      firstName,
      fullName: firstName,
    };
  }

  if (middleName && middleName.length > 60) {
    return {
      isValid: false,
      error: 'Middle name cannot exceed 60 characters.',
      firstName,
      fullName: firstName,
    };
  }

  if (lastName && lastName.length > 60) {
    return {
      isValid: false,
      error: 'Last name cannot exceed 60 characters.',
      firstName,
      fullName: firstName,
    };
  }

  // Reject unsafe control characters or HTML/script injection
  const unsafePattern = /[\x00-\x1F\x7F<>\"\'%;()&+]/;
  if (
    unsafePattern.test(firstName) ||
    (middleName && unsafePattern.test(middleName)) ||
    (lastName && unsafePattern.test(lastName))
  ) {
    return {
      isValid: false,
      error: 'Name contains invalid or disallowed characters.',
      firstName,
      fullName: firstName,
    };
  }

  const fullName = buildCanonicalFullName(firstName, middleName, lastName);

  return {
    isValid: true,
    firstName,
    middleName,
    lastName,
    fullName,
  };
}

/**
 * Builds canonical full display name from structured parts.
 */
export function buildCanonicalFullName(
  firstName: string,
  middleName?: string,
  lastName?: string
): string {
  return [firstName, middleName, lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim())
    .join(' ');
}

export const APPROVED_HONORIFIC_PREFIXES = [
  'SHREE',
  'SHRI',
  'SRI',
  'SMT',
  'KUMARI',
  'MRS',
  'MR',
  'MS',
  'DR',
  'M/S',
  'M S',
] as const;

/**
 * Normalizes a name string for reliable comparison against PAN and Banking records:
 * - Trims and converts to uppercase
 * - Strips only explicitly approved leading Indian honorific titles and business prefixes
 *   (MR, MRS, MS, DR, SHRI, SHREE, SRI, SMT, KUMARI, M/S)
 * - Removes prefixes from the beginning of the name only, preserving all remaining name components and their exact order
 * - Replaces non-alphanumeric punctuation with single spaces
 * - Collapses consecutive spaces
 * - Never deletes genuine name components (e.g. KUMAR, SINGH, middle names, surnames)
 */
export function normalizeName(name: string): string {
  if (!name || typeof name !== 'string') return '';

  let cleaned = name.trim().toUpperCase();
  if (!cleaned) return '';

  // Handle leading M/S, M.S., or M/S. variations cleanly
  cleaned = cleaned.replace(/^M\s*[\/\.]\s*S\.?\s+/i, '');

  // Replace punctuation like dots, dashes, slashes, commas with space
  cleaned = cleaned.replace(/[^A-Z0-9\s]/g, ' ');

  // Collapse multiple whitespaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Strip approved prefixes iteratively from the start only
  const prefixTokens = [
    'SHREE',
    'KUMARI',
    'SHRI',
    'SMT',
    'SRI',
    'MRS',
    'MR',
    'MS',
    'DR',
    'M S',
  ];

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of prefixTokens) {
      if (cleaned === prefix) {
        break;
      }
      if (cleaned.startsWith(prefix + ' ')) {
        cleaned = cleaned.substring(prefix.length + 1).trim();
        stripped = true;
        break;
      }
    }
  }

  return cleaned;
}

export interface NameComparisonOptions {
  strictTokenCount?: boolean;
  isMononymousApproved?: boolean;
}

/**
 * Authoritative comparison function between two legal names (e.g. PAN card name vs Bank Account / Beneficiary name).
 * Enforces the strict business mandate:
 * THE BANK ACCOUNT HOLDER NAME MUST MATCH THE NAME ON THE CUSTOMER'S PAN CARD EXACTLY AFTER REMOVING APPROVED PREFIXES/HONORIFICS.
 * No fuzzy matching, partial matching, subset matching, surname omission, middle-name omission, or token reordering is permitted.
 */
export function compareNames(
  accountName: string,
  panVerifiedName: string,
  options?: NameComparisonOptions
): boolean {
  return areNamesMatching(accountName, panVerifiedName, options);
}

/**
 * Checks whether a beneficiary name matches the verified PAN card name under the mandatory exact-matching policy:
 * 1. Removes approved leading prefixes (MR, MRS, MS, DR, SHRI, SHREE, SRI, SMT, KUMARI, M/S) from either name.
 * 2. Normalizes case, harmless punctuation, and whitespace.
 * 3. Enforces exact equality across all name components and their exact order.
 * 4. Rejects token omissions (e.g. omitted middle name or surname), token additions, token reorderings, and initials.
 */
export function areNamesMatching(
  beneficiaryName: string,
  panHolderName: string,
  options?: { isMononymousApproved?: boolean }
): boolean {
  if (!beneficiaryName || !panHolderName) return false;

  const normAccount = normalizeName(beneficiaryName);
  const normPan = normalizeName(panHolderName);

  if (!normAccount || !normPan) return false;

  // Exact normalized match is required
  if (normAccount === normPan) {
    return true;
  }

  // Handle mononymous applicant if and only if approved by administrative review
  if (options?.isMononymousApproved) {
    const aTokens = normAccount.split(' ').filter(Boolean);
    const pTokens = normPan.split(' ').filter(Boolean);

    // When PAN verified name is a single token
    if (pTokens.length === 1) {
      const singlePan = pTokens[0];
      if (aTokens.length === 1 && aTokens[0] === singlePan) {
        return true;
      }
      // Bank enters single name in both First Name and Last Name fields (e.g. "RAMESH RAMESH")
      if (aTokens.length === 2 && aTokens[0] === singlePan && aTokens[1] === singlePan) {
        return true;
      }
      // Bank enters single name with dot or single-character initial (e.g. "RAMESH ." or "RAMESH K")
      if (aTokens.length === 2) {
        if (aTokens[0] === singlePan && (aTokens[1].length === 1 || aTokens[1] === '.')) {
          return true;
        }
        if (aTokens[1] === singlePan && (aTokens[0].length === 1 || aTokens[0] === '.')) {
          return true;
        }
      }
    }

    // When Bank Account beneficiary name is a single token
    if (aTokens.length === 1) {
      const singleAccount = aTokens[0];
      if (pTokens.length === 2 && pTokens[0] === singleAccount && pTokens[1] === singleAccount) {
        return true;
      }
      if (pTokens.length === 2) {
        if (pTokens[0] === singleAccount && (pTokens[1].length === 1 || pTokens[1] === '.')) {
          return true;
        }
        if (pTokens[1] === singleAccount && (pTokens[0].length === 1 || pTokens[0] === '.')) {
          return true;
        }
      }
    }
  }

  return false;
}
