import { normalizeStrictIndianMobile } from '../services/auth.service';

describe('FINDING-02: Strict Indian Mobile Normalization & Symmetry Regression Suite', () => {
  describe('1. Valid Indian Mobile Formats with Canonical Normalization', () => {
    test('normalizes 10-digit mobile starting with 6, 7, 8, 9', () => {
      expect(normalizeStrictIndianMobile('9876543210')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('8123456789')).toBe('8123456789');
      expect(normalizeStrictIndianMobile('7012345678')).toBe('7012345678');
      expect(normalizeStrictIndianMobile('6987654321')).toBe('6987654321');
    });

    test('normalizes +91 country-code prefix', () => {
      expect(normalizeStrictIndianMobile('+919876543210')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('+917012345678')).toBe('7012345678');
    });

    test('normalizes 91 prefix without plus', () => {
      expect(normalizeStrictIndianMobile('919876543210')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('916987654321')).toBe('6987654321');
    });

    test('normalizes 0091 international dialing prefix', () => {
      expect(normalizeStrictIndianMobile('00919876543210')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('00918123456789')).toBe('8123456789');
    });

    test('normalizes 0 domestic leading-zero prefix', () => {
      expect(normalizeStrictIndianMobile('09876543210')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('07012345678')).toBe('7012345678');
    });

    test('trims leading and trailing whitespace before normalization', () => {
      expect(normalizeStrictIndianMobile('  9876543210  ')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('\t+919876543210\n')).toBe('9876543210');
      expect(normalizeStrictIndianMobile('  00919876543210  ')).toBe('9876543210');
    });
  });

  describe('2. Rejection of Foreign Country Codes and Malformed Inputs', () => {
    test('strictly rejects North American +1 numbers sharing same last 10 digits', () => {
      expect(normalizeStrictIndianMobile('+19876543210')).toBeNull();
      expect(normalizeStrictIndianMobile('19876543210')).toBeNull();
    });

    test('strictly rejects UK +44 numbers sharing same last 10 digits', () => {
      expect(normalizeStrictIndianMobile('+449876543210')).toBeNull();
      expect(normalizeStrictIndianMobile('449876543210')).toBeNull();
    });

    test('strictly rejects invalid starting digits (0-5) in 10-digit numbers', () => {
      expect(normalizeStrictIndianMobile('5876543210')).toBeNull();
      expect(normalizeStrictIndianMobile('4876543210')).toBeNull();
      expect(normalizeStrictIndianMobile('1876543210')).toBeNull();
      expect(normalizeStrictIndianMobile('0876543210')).toBeNull();
    });

    test('strictly rejects numbers that are too short or too long', () => {
      expect(normalizeStrictIndianMobile('987654321')).toBeNull(); // 9 digits
      expect(normalizeStrictIndianMobile('98765432100')).toBeNull(); // 11 digits
      expect(normalizeStrictIndianMobile('+91987654321')).toBeNull(); // 9 digits with +91
      expect(normalizeStrictIndianMobile('+9198765432100')).toBeNull(); // 11 digits with +91
    });

    test('strictly rejects embedded non-digit characters and symbols', () => {
      expect(normalizeStrictIndianMobile('98765-43210')).toBeNull();
      expect(normalizeStrictIndianMobile('98765 43210')).toBeNull();
      expect(normalizeStrictIndianMobile('987654321a')).toBeNull();
      expect(normalizeStrictIndianMobile('+91-9876543210')).toBeNull();
    });

    test('returns null for empty, null, undefined, or non-string inputs', () => {
      expect(normalizeStrictIndianMobile('')).toBeNull();
      expect(normalizeStrictIndianMobile('   ')).toBeNull();
      expect(normalizeStrictIndianMobile(null as any)).toBeNull();
      expect(normalizeStrictIndianMobile(undefined as any)).toBeNull();
      expect(normalizeStrictIndianMobile(9876543210 as any)).toBeNull();
    });
  });

  describe('3. Multi-Format Identity Equivalence & Deduplication Invariant', () => {
    test('all valid formats of the same mobile resolve to identical canonical identity', () => {
      const canonical = '9876543210';
      const inputs = [
        '9876543210',
        '+919876543210',
        '919876543210',
        '00919876543210',
        '09876543210',
        '  9876543210  ',
        ' +919876543210 ',
      ];

      for (const input of inputs) {
        expect(normalizeStrictIndianMobile(input)).toBe(canonical);
      }
    });
  });
});
