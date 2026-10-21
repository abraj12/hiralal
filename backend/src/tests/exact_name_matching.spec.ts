import { areNamesMatching, normalizeName, compareNames, APPROVED_HONORIFIC_PREFIXES } from '../utils/name.utils';

describe('Mandatory Exact Bank Account Holder Name Matching Against PAN Policy', () => {
  describe('A. Positive Exact Matches with and without Approved Prefixes', () => {
    test('Exact identical names match', () => {
      expect(areNamesMatching('RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(areNamesMatching('ramesh kumar', 'RAMESH KUMAR')).toBe(true);
      expect(areNamesMatching('Sunita Devi', 'SUNITA DEVI')).toBe(true);
    });

    test('Case insensitivity and whitespace normalization', () => {
      expect(areNamesMatching('  rahul   kumar   singh  ', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(areNamesMatching('RAHUL KUMAR SINGH', 'rahul kumar singh')).toBe(true);
    });

    test('Approved prefix MR on beneficiary name', () => {
      expect(areNamesMatching('MR RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(areNamesMatching('MR. RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
    });

    test('Approved prefix SHRI on beneficiary name or PAN name', () => {
      expect(areNamesMatching('SHRI RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(areNamesMatching('RAHUL KUMAR SINGH', 'SHRI RAHUL KUMAR SINGH')).toBe(true);
      expect(areNamesMatching('SHRI. RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
    });

    test('All approved prefixes in allowlist strip properly', () => {
      const baseName = 'VIKRAM SHARMA';
      for (const prefix of APPROVED_HONORIFIC_PREFIXES) {
        expect(areNamesMatching(`${prefix} ${baseName}`, baseName)).toBe(true);
        expect(areNamesMatching(baseName, `${prefix} ${baseName}`)).toBe(true);
      }
    });

    test('Multiple approved prefixes combined (e.g. SHRI MR)', () => {
      expect(areNamesMatching('SHRI MR RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(areNamesMatching('SHREE SMT SUNITA DEVI', 'SUNITA DEVI')).toBe(true);
    });

    test('Business prefix M/S and M.S. on beneficiary name', () => {
      expect(areNamesMatching('M/S SHARMA ENTERPRISES', 'SHARMA ENTERPRISES')).toBe(true);
      expect(areNamesMatching('M/S. SHARMA ENTERPRISES', 'SHARMA ENTERPRISES')).toBe(true);
      expect(areNamesMatching('M.S. SHARMA ENTERPRISES', 'SHARMA ENTERPRISES')).toBe(true);
      expect(areNamesMatching('M S SHARMA ENTERPRISES', 'SHARMA ENTERPRISES')).toBe(true);
    });
  });

  describe('B. Mandatory Negative Rejection Cases (Fuzzy, Subset, Omission, Reordering)', () => {
    test('Rejects omitted middle name (Mandatory Regression)', () => {
      expect(areNamesMatching('RAHUL KUMAR SINGH', 'RAHUL SINGH')).toBe(false);
      expect(areNamesMatching('RAHUL SINGH', 'RAHUL KUMAR SINGH')).toBe(false);
      expect(areNamesMatching('RAMESH CHANDRA GUPTA', 'RAMESH GUPTA')).toBe(false);
      expect(areNamesMatching('RAMESH GUPTA', 'RAMESH CHANDRA GUPTA')).toBe(false);
    });

    test('Rejects omitted surname (Mandatory Regression)', () => {
      expect(areNamesMatching('AMIT KUMAR', 'AMIT KUMAR VERMA')).toBe(false);
      expect(areNamesMatching('AMIT KUMAR VERMA', 'AMIT KUMAR')).toBe(false);
    });

    test('Rejects omitted first / given name (Mandatory Regression)', () => {
      expect(areNamesMatching('KUMAR VERMA', 'SUNIL KUMAR VERMA')).toBe(false);
      expect(areNamesMatching('SUNIL KUMAR VERMA', 'KUMAR VERMA')).toBe(false);
    });

    test('Rejects patronymic / father-son collision (Mandatory Regression)', () => {
      expect(areNamesMatching('HITESH RAMESHBHAI PATEL', 'RAMESHBHAI PATEL')).toBe(false);
      expect(areNamesMatching('RAMESHBHAI PATEL', 'HITESH RAMESHBHAI PATEL')).toBe(false);
    });

    test('Rejects token reordering / swapped order (Mandatory Regression)', () => {
      expect(areNamesMatching('RAHUL KUMAR SINGH', 'SINGH RAHUL KUMAR')).toBe(false);
      expect(areNamesMatching('KUMAR RAMESH', 'RAMESH KUMAR')).toBe(false);
      expect(areNamesMatching('SHARMA RAJESH', 'RAJESH SHARMA')).toBe(false);
    });

    test('Rejects substituted surname / name parts (Mandatory Regression)', () => {
      expect(areNamesMatching('RAHUL KUMAR SINGH', 'RAHUL KUMAR SHARMA')).toBe(false);
      expect(areNamesMatching('RAMESH SHARMA', 'RAMESH VERMA')).toBe(false);
      expect(areNamesMatching('SURESH SHARMA', 'RAMESH SHARMA')).toBe(false);
    });

    test('Rejects initials expansion (R K Sharma vs Rajesh Kumar Sharma)', () => {
      expect(areNamesMatching('R K SHARMA', 'RAJESH KUMAR SHARMA')).toBe(false);
      expect(areNamesMatching('RAJESH KUMAR SHARMA', 'R K SHARMA')).toBe(false);
    });
  });

  describe('C. Genuine Name Components Containing Prefix-like Substrings', () => {
    test('Preserves names starting with prefix-like syllables without space', () => {
      expect(normalizeName('SRIDHAR SHARMA')).toBe('SRIDHAR SHARMA');
      expect(normalizeName('SHRINIWAS PATEL')).toBe('SHRINIWAS PATEL');
      expect(normalizeName('MRIDUL VERMA')).toBe('MRIDUL VERMA');
      expect(normalizeName('DRUV KUMAR')).toBe('DRUV KUMAR');
    });

    test('Preserves KUMARI when appearing as surname or given name without leading space', () => {
      expect(normalizeName('ANITA KUMARI')).toBe('ANITA KUMARI');
      expect(areNamesMatching('ANITA KUMARI', 'ANITA KUMARI')).toBe(true);
      expect(areNamesMatching('ANITA KUMARI', 'ANITA')).toBe(false);
    });

    test('Preserves KUMAR and does not delete it as a title', () => {
      expect(normalizeName('KUMAR SANU')).toBe('KUMAR SANU');
      expect(areNamesMatching('KUMAR SANU', 'SANU')).toBe(false);
    });
  });

  describe('D. Edge Cases: Empty, Null, Undefined, Mononymous', () => {
    test('Rejects empty or null values safely without crashing', () => {
      expect(areNamesMatching('', 'RAHUL KUMAR SINGH')).toBe(false);
      expect(areNamesMatching('RAHUL KUMAR SINGH', '')).toBe(false);
      expect(areNamesMatching(null as any, 'RAHUL KUMAR SINGH')).toBe(false);
      expect(areNamesMatching('RAHUL KUMAR SINGH', undefined as any)).toBe(false);
      expect(areNamesMatching('   ', '   ')).toBe(false);
    });

    test('Mononymous names match when approved and identical', () => {
      expect(areNamesMatching('SURESH', 'SURESH', { isMononymousApproved: true })).toBe(true);
      expect(areNamesMatching('MR SURESH', 'SURESH', { isMononymousApproved: true })).toBe(true);
    });

    test('Mononymous names NEVER force-match to a different full name', () => {
      expect(areNamesMatching('SURESH', 'SURESH KUMAR', { isMononymousApproved: true })).toBe(false);
      expect(areNamesMatching('SURESH KUMAR', 'SURESH', { isMononymousApproved: true })).toBe(false);
    });
  });

  describe('E. Parity with compareNames wrapper', () => {
    test('compareNames delegates strictly to areNamesMatching', () => {
      expect(compareNames('RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(compareNames('MR RAHUL KUMAR SINGH', 'RAHUL KUMAR SINGH')).toBe(true);
      expect(compareNames('RAHUL SINGH', 'RAHUL KUMAR SINGH')).toBe(false);
      expect(compareNames('SINGH RAHUL KUMAR', 'RAHUL KUMAR SINGH')).toBe(false);
    });
  });
});
