import fs from 'fs';
import path from 'path';
import { resolveUpiAddress } from '../worker/payout.worker';
import { encryptSensitive } from '../utils/crypto.utils';

describe('Phase 2 Verification & Regression Suite (Medium-Priority Hardening & Compliance)', () => {
  const rootDir = path.resolve(__dirname, '../../../');

  describe('P2.1: Encrypt UPI IDs at Rest (VULN-PII-01)', () => {
    it('verifies resolveUpiAddress decrypts upiIdEncrypted when raw upiId is null', () => {
      const realUpi = 'craftsman@okhdfcbank';
      const upiIdEncrypted = encryptSensitive(realUpi);

      const resolved = resolveUpiAddress({
        accountType: 'UPI',
        upiId: null,
        upiIdEncrypted,
      });

      expect(resolved).toBe(realUpi);
    });

    it('verifies schema.prisma includes upiIdEncrypted column on PaymentAccount', () => {
      const schemaPath = path.join(rootDir, 'backend/prisma/schema.prisma');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      expect(schema).toContain('upiIdEncrypted         String?');
    });
  });

  describe('P2.2: AuditLog Scrubbing for Deleted Accounts (VULN-DEL-01)', () => {
    it('verifies account-deletion.service.ts scrubs ipAddress and userAgent in AuditLog', () => {
      const servicePath = path.join(
        rootDir,
        'backend/src/services/account-deletion.service.ts'
      );
      const content = fs.readFileSync(servicePath, 'utf8');
      // Task 4.3 / VULN-DEL-01: AuditLog is append-only immutable; redaction is logged via compensating AUDIT_LOG_PII_REDACTED event
      expect(content).toContain('AUDIT_LOG_PII_REDACTED');
      expect(content).toContain("ipAddress: '0.0.0.0'");
      expect(content).toContain("userAgent: 'ANONYMIZED'");
    });
  });

  describe('P2.3: Secondary Approval Deadlock Resolution (DEADLOCK-01)', () => {
    it('verifies admin.routes.ts uses requireAdmin on /bills/:id/verify', () => {
      const routesPath = path.join(rootDir, 'backend/src/routes/admin.routes.ts');
      const content = fs.readFileSync(routesPath, 'utf8');
      expect(content).toContain("router.post('/bills/:id/verify', requireAdmin");
    });
  });

  describe('P2.4: Bcrypt Timing Oracle Elimination (VULN-CRYPTO-01)', () => {
    it('verifies DUMMY_HASH uses cost factor 12 ($2a$12$) in auth.service.ts', () => {
      const authPath = path.join(rootDir, 'backend/src/services/auth.service.ts');
      const content = fs.readFileSync(authPath, 'utf8');
      expect(content).not.toContain("DUMMY_HASH = '$2a$10$");
      expect(content).toContain("DUMMY_HASH = '$2a$12$");
    });
  });

  describe('P2.5: Backup PBKDF2 Iterations Hardening (VULN-CRYPTO-02)', () => {
    it('verifies crypto-backup.js enforces 600,000 PBKDF2 iterations', () => {
      const cryptoPath = path.join(rootDir, 'scripts/crypto-backup.js');
      const content = fs.readFileSync(cryptoPath, 'utf8');
      expect(content).toContain('PBKDF2_ITERATIONS = 600000');
    });
  });

  describe('P2.6: Field Re-Encryption Script (VULN-CRYPTO-03)', () => {
    it('verifies scripts/reencrypt-sensitive-fields.ts exists and exports reencryptSensitiveFields', () => {
      const scriptPath = path.join(rootDir, 'scripts/reencrypt-sensitive-fields.ts');
      expect(fs.existsSync(scriptPath)).toBe(true);
      const content = fs.readFileSync(scriptPath, 'utf8');
      expect(content).toContain('export async function reencryptSensitiveFields');
    });
  });

  describe('P2.7: Gitignore Secret Wildcard Protection (VULN-GIT-01)', () => {
    it('verifies .gitignore contains .env* wildcard', () => {
      const gitignorePath = path.join(rootDir, '.gitignore');
      const content = fs.readFileSync(gitignorePath, 'utf8');
      expect(content).toContain('.env*');
    });
  });

  describe('P2.8: Mobile-Admin Package-Lock & CI Symlink Cleanup (VULN-MOB-ADM-01)', () => {
    it('verifies mobile-admin/package-lock.json exists and defines hiralal-admin-mobile', () => {
      const lockPath = path.join(rootDir, 'mobile-admin/package-lock.json');
      expect(fs.existsSync(lockPath)).toBe(true);
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(lock.name).toBe('hiralal-admin-mobile');
    });

    it('verifies ci.yml installs mobile-admin dependencies without symlinks', () => {
      const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
      const content = fs.readFileSync(ciPath, 'utf8');
      expect(content).not.toContain('ln -sf ../mobile/node_modules mobile-admin/node_modules');
      expect(content).toContain('Install Mobile Admin Dependencies');
    });
  });

  describe('P2.9: Test Coverage Threshold Elevation (VULN-TEST-01)', () => {
    it('verifies backend/jest.config.js elevates branch threshold to 70%', () => {
      const jestPath = path.join(rootDir, 'backend/jest.config.js');
      const content = fs.readFileSync(jestPath, 'utf8');
      expect(content).toContain('branches: 70');
    });
  });

  describe('P2.10: Rate Limiting Device Token Registration (VULN-API-02)', () => {
    it('verifies notification.routes.ts applies pushTokenLimiter to POST /device-token', () => {
      const routesPath = path.join(rootDir, 'backend/src/routes/notification.routes.ts');
      const content = fs.readFileSync(routesPath, 'utf8');
      expect(content).toContain("router.post('/device-token', pushTokenLimiter");
    });
  });
});
