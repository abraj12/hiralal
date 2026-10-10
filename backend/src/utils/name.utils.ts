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

/**
 * Normalizes a name string for reliable comparison against PAN tax records:
 * - Trims and converts to uppercase
 * - Strips common honorific titles (MR, MRS, MS, SHRI, SMT, DR)
 * - Replaces non-alphanumeric punctuation with single spaces
 * - Collapses consecutive spaces
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  let cleaned = name.trim().toUpperCase();

  // Replace punctuation like dots, dashes, commas with space
  cleaned = cleaned.replace(/[^A-Z0-9\s]/g, ' ');

  // Collapse multiple whitespaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Strip common prefixes
  const prefixes = ['SHRI ', 'SMT ', 'MR ', 'MRS ', 'MS ', 'DR ', 'MD '];
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.substring(prefix.length).trim();
      break;
    }
  }

  return cleaned;
}

/**
 * Compares an account name with a verified PAN holder name:
 * 1. Checks exact normalized string match.
 * 2. Checks token set equality (e.g. "RAJESH KUMAR SHARMA" matches "SHARMA RAJESH KUMAR").
 * 3. Handles initial expansion (e.g. "R K SHARMA" vs "RAJESH KUMAR SHARMA").
 */
export function compareNames(accountName: string, panVerifiedName: string): boolean {
  const normAccount = normalizeName(accountName);
  const normPan = normalizeName(panVerifiedName);

  if (!normAccount || !normPan) return false;

  // Exact normalized match
  if (normAccount === normPan) return true;

  const accountTokens = normAccount.split(' ').filter(Boolean);
  const panTokens = normPan.split(' ').filter(Boolean);

  // Set-based token comparison (order independence for Indian names)
  if (accountTokens.length === panTokens.length) {
    const sortedAccount = [...accountTokens].sort().join(' ');
    const sortedPan = [...panTokens].sort().join(' ');
    if (sortedAccount === sortedPan) return true;
  }

  // Token subset match for single initials (e.g., "R SHARMA" vs "RAJESH SHARMA")
  if (accountTokens.length === panTokens.length) {
    let allTokensMatch = true;
    for (let i = 0; i < accountTokens.length; i++) {
      const aTok = accountTokens[i];
      const pTok = panTokens[i];
      if (aTok === pTok) continue;
      // Single character initial match
      if ((aTok.length === 1 && pTok.startsWith(aTok)) || (pTok.length === 1 && aTok.startsWith(pTok))) {
        continue;
      }
      allTokensMatch = false;
      break;
    }
    if (allTokensMatch) return true;
  }

  // Shorter name tokens subset check (e.g., "Disbursement Craftsman" vs "Disbursement Safety Craftsman")
  const [shorter, longer] = accountTokens.length < panTokens.length 
    ? [accountTokens, panTokens] 
    : [panTokens, accountTokens];

  if (shorter.length >= 2) {
    const longerSet = new Set(longer);
    const allShorterInLonger = shorter.every(tok => longerSet.has(tok));
    if (allShorterInLonger) {
      return true;
    }
  }

  return false;
}
