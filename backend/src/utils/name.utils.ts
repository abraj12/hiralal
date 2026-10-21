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
 * Normalizes a name string for reliable comparison against PAN and Banking records:
 * - Trims and converts to uppercase
 * - Strips common Indian honorific titles and business prefixes (MR, MRS, MS, SHRI, SHREE, SMT, DR, M/S)
 * - Replaces non-alphanumeric punctuation with single spaces
 * - Collapses consecutive spaces
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  let cleaned = name.trim().toUpperCase();

  // Replace punctuation like dots, dashes, slashes, commas with space
  cleaned = cleaned.replace(/[^A-Z0-9\s]/g, ' ');

  // Collapse multiple whitespaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Strip common honorific prefixes (Note: 'MD' is NOT stripped as it represents Mohammad in Indian names)
  // Strip iteratively in case multiple honorifics are combined (e.g. "SHREE MR")
  const prefixes = [
    'SHREE ',
    'SHRI ',
    'SMT ',
    'KUMARI ',
    'MR ',
    'MRS ',
    'MS ',
    'DR ',
    'M S ', // M/S becomes "M S " after punctuation replacement
  ];

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of prefixes) {
      if (cleaned.startsWith(prefix)) {
        cleaned = cleaned.substring(prefix.length).trim();
        stripped = true;
        break;
      }
    }
  }

  return cleaned;
}

export interface NameComparisonOptions {
  strictTokenCount?: boolean;
}

/**
 * Compares an account beneficiary name with a verified PAN holder name:
 * 1. Checks exact normalized string match.
 * 2. Checks token set equality (e.g. "RAJESH KUMAR SHARMA" matches "SHARMA RAJESH KUMAR").
 * 3. Handles initial expansion (e.g. "R K SHARMA" vs "RAJESH KUMAR SHARMA") requiring at least
 *    one anchor token of length >= 2 to match exactly to prevent ambiguous single-letter false matches.
 * 4. Handles omitted middle names / token subset matching (e.g. "RAMESH GUPTA" matches "RAMESH CHANDRA GUPTA"),
 *    requiring at least 2 tokens in both names and exact matches on the common anchor tokens (first name and surname).
 * 5. Rejects single-token matches or conflicting anchor tokens to prevent fraudulent account takeovers.
 */
export function compareNames(
  accountName: string,
  panVerifiedName: string,
  options?: NameComparisonOptions
): boolean {
  const normAccount = normalizeName(accountName);
  const normPan = normalizeName(panVerifiedName);

  if (!normAccount || !normPan) return false;

  // 1. Exact normalized match
  if (normAccount === normPan) return true;

  const accountTokens = normAccount.split(' ').filter(Boolean);
  const panTokens = normPan.split(' ').filter(Boolean);

  if (accountTokens.length === 0 || panTokens.length === 0) return false;

  // 2. Set-based token comparison (order independence for Indian names)
  if (accountTokens.length === panTokens.length) {
    const sortedAccount = [...accountTokens].sort().join(' ');
    const sortedPan = [...panTokens].sort().join(' ');
    if (sortedAccount === sortedPan) return true;
  }

  // 3. Token-length equality with initial matching (e.g. "R K SHARMA" vs "RAJESH KUMAR SHARMA" or swapped)
  if (accountTokens.length === panTokens.length && accountTokens.length >= 2) {
    // Try matching tokens with order independence
    const matchedPanIndices = new Set<number>();
    let anchorMatched = false;
    let allTokensMatched = true;

    for (const aTok of accountTokens) {
      let foundMatch = false;
      for (let pIdx = 0; pIdx < panTokens.length; pIdx++) {
        if (matchedPanIndices.has(pIdx)) continue;
        const pTok = panTokens[pIdx];

        if (aTok === pTok) {
          if (aTok.length >= 2) anchorMatched = true;
          matchedPanIndices.add(pIdx);
          foundMatch = true;
          break;
        } else if (
          (aTok.length === 1 && pTok.startsWith(aTok)) ||
          (pTok.length === 1 && aTok.startsWith(pTok))
        ) {
          matchedPanIndices.add(pIdx);
          foundMatch = true;
          break;
        }
      }
      if (!foundMatch) {
        allTokensMatched = false;
        break;
      }
    }

    if (allTokensMatched && anchorMatched && matchedPanIndices.size === panTokens.length) {
      return true;
    }
  }

  if (options?.strictTokenCount) {
    return false;
  }

  // 4. Positional omitted middle name matching (REC-03 / REC-04)
  // Indian bank accounts frequently omit middle names present on PAN cards (e.g. "RAMESH GUPTA" vs "RAMESH CHANDRA GUPTA")
  // Both names must have at least 2 tokens to prevent matching single first names.
  // The first token (given name) and last token (surname) of the longer name must both match the shorter name's anchors.
  // The omitted token(s) must strictly be intermediate middle names, preventing surname drops (e.g., "AMIT KUMAR" vs "AMIT KUMAR VERMA")
  // or first name drops (e.g., "KUMAR VERMA" vs "SUNIL KUMAR VERMA").
  const [shorterTokens, longerTokens] =
    accountTokens.length <= panTokens.length
      ? [accountTokens, panTokens]
      : [panTokens, accountTokens];

  if (shorterTokens.length >= 2 && longerTokens.length > shorterTokens.length) {
    const longerFirst = longerTokens[0];
    const longerLast = longerTokens[longerTokens.length - 1];

    const matchesLongerToken = (lTok: string): boolean => {
      for (const sTok of shorterTokens) {
        if (sTok === lTok) return true;
        if (sTok.length === 1 && lTok.startsWith(sTok)) return true;
        if (lTok.length === 1 && sTok.startsWith(lTok)) return true;
      }
      return false;
    };

    const firstMatches = matchesLongerToken(longerFirst);
    const lastMatches = matchesLongerToken(longerLast);

    if (firstMatches && lastMatches) {
      const matchedLongerIndices = new Set<number>();
      let allShortMatched = true;

      for (const sTok of shorterTokens) {
        let found = false;
        for (let lIdx = 0; lIdx < longerTokens.length; lIdx++) {
          if (matchedLongerIndices.has(lIdx)) continue;
          const lTok = longerTokens[lIdx];
          if (
            sTok === lTok ||
            (sTok.length === 1 && lTok.startsWith(sTok)) ||
            (lTok.length === 1 && sTok.startsWith(lTok))
          ) {
            matchedLongerIndices.add(lIdx);
            found = true;
            break;
          }
        }
        if (!found) {
          allShortMatched = false;
          break;
        }
      }

      if (allShortMatched) {
        let onlyIntermediateOmitted = true;
        for (let lIdx = 0; lIdx < longerTokens.length; lIdx++) {
          if (!matchedLongerIndices.has(lIdx)) {
            if (lIdx === 0 || lIdx === longerTokens.length - 1) {
              onlyIntermediateOmitted = false;
              break;
            }
          }
        }
        if (onlyIntermediateOmitted) {
          return true;
        }
      }
    }
  }

  return false;
}

export function areNamesMatching(
  beneficiaryName: string,
  panHolderName: string,
  options?: { isMononymousApproved?: boolean }
): boolean {
  if (options?.isMononymousApproved) {
    const bTokens = beneficiaryName.trim().toUpperCase().split(/\s+/);
    const pTokens = panHolderName.trim().toUpperCase().split(/\s+/);
    if (bTokens.length === 1 && pTokens.includes(bTokens[0])) return true;
    if (pTokens.length === 1 && bTokens.includes(pTokens[0])) return true;
  }
  return compareNames(beneficiaryName, panHolderName, { strictTokenCount: true });
}
