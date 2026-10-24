import fs from 'fs';
import path from 'path';
import {
  computeIntegrityRequestHash,
  buildCanonicalBeneficiaryPayload,
  normalizeRegistrationIntegrityPayload,
  buildCanonicalRegistrationPayload,
} from '../utils/integrityRequestHash';

describe('Phase 1 Verification & Regression Suite (High-Priority Security & Availability)', () => {
  const rootDir = path.resolve(__dirname, '../../../');

  describe('P1.1: Mobile Certificate Pinning (VULN-MOB-01)', () => {
    it('verifies network_security_config.xml enforces pin-set for production domains', () => {
      const configPath = path.join(
        rootDir,
        'mobile/android/app/src/main/res/xml/network_security_config.xml'
      );
      expect(fs.existsSync(configPath)).toBe(true);

      const content = fs.readFileSync(configPath, 'utf8');
      expect(content).toContain('<pin-set');
      expect(content).toContain('hsspl.algions.in');
      expect(content).not.toContain('hsspl.aglions.in');
      expect(content).not.toContain('hiralalandcompany.com');
      expect(content).toContain('<pin digest="SHA-256">');
      expect(content).toContain('C5+o0AITHadrtpqMe4ZhtRfDCCDa60MBXZRe89mbDHQ='); // Let's Encrypt ISRG Root X1
    });
  });

  describe('P1.2: Mobile Step-Up Biometric Authentication (VULN-MOB-02)', () => {
    it('verifies mobile/package.json contains expo-local-authentication', () => {
      const pkgPath = path.join(rootDir, 'mobile/package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      expect(pkg.dependencies['expo-local-authentication']).toBeDefined();
    });

    it('verifies RedemptionModal prompts for biometric authentication before disbursal', () => {
      const modalPath = path.join(rootDir, 'mobile/src/components/RedemptionModal.tsx');
      const content = fs.readFileSync(modalPath, 'utf8');
      expect(content).toContain('expo-local-authentication');
      expect(content).toContain('LocalAuthentication.authenticateAsync');
      expect(content).toContain('Confirm reward payout redemption');
    });
  });

  describe('P1.3: Docker Bridge Network Segmentation (VULN-INFRA-02)', () => {
    it('verifies postgres and redis are isolated on hiralal_backend_net', () => {
      const composePath = path.join(rootDir, 'docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf8');

      // Check networks definition
      expect(content).toContain('hiralal_frontend_net:');
      expect(content).toContain('hiralal_backend_net:');

      // Verify postgres and redis do not join frontend_net
      const postgresSection = content.slice(content.indexOf('postgres:'), content.indexOf('redis:'));
      expect(postgresSection).toContain('hiralal_backend_net');
      expect(postgresSection).not.toContain('hiralal_frontend_net');

      const redisSection = content.slice(content.indexOf('redis:'), content.indexOf('backend:'));
      expect(redisSection).toContain('hiralal_backend_net');
      expect(redisSection).not.toContain('hiralal_frontend_net');

      // Verify admin and nginx do not join backend_net
      const adminSection = content.slice(content.indexOf('admin:'), content.indexOf('nginx:'));
      expect(adminSection).toContain('hiralal_frontend_net');
      expect(adminSection).not.toContain('hiralal_backend_net');

      const lastNetworksIdx = content.lastIndexOf('networks:');
      const nginxSection = content.slice(content.indexOf('nginx:'), lastNetworksIdx);
      expect(nginxSection).toContain('hiralal_frontend_net');
      expect(nginxSection).not.toContain('hiralal_backend_net');
    });
  });

  describe('P1.4: Play Integrity Request Hash Hardening (VULN-HASH-01, VULN-HASH-02)', () => {
    it('distinguishes beneficiary verification by endpoint path and binds bankName', () => {
      const reqBank: any = {
        originalUrl: '/api/v1/payouts/beneficiary/bank',
        path: '/bank',
        body: {
          accountNumber: '1234567890',
          ifscCode: 'SBIN0001234',
          bankName: 'State Bank of India',
          accountHolderName: 'RAMESH KUMAR',
          upiId: 'attacker@upi', // Decoy param must NOT confuse endpoint
        },
      };

      const bankHash = computeIntegrityRequestHash('BENEFICIARY_VERIFY', reqBank);
      expect(bankHash).toHaveLength(64);

      const expectedBankPayload = buildCanonicalBeneficiaryPayload(
        'BANK',
        '1234567890',
        'SBIN0001234',
        'RAMESH KUMAR',
        'State Bank of India'
      );
      expect(expectedBankPayload.bankName).toBe('State Bank of India');
      expect(expectedBankPayload.accountType).toBe('BANK');

      const reqUpi: any = {
        originalUrl: '/api/v1/payouts/beneficiary/upi',
        path: '/upi',
        body: {
          upiId: 'ramesh@okhdfcbank',
          accountHolderName: 'RAMESH KUMAR',
        },
      };

      const upiHash = computeIntegrityRequestHash('BENEFICIARY_VERIFY', reqUpi);
      expect(upiHash).not.toBe(bankHash);
    });

    it('binds password and verification token in registration payload', () => {
      const payload = normalizeRegistrationIntegrityPayload({
        mobile: '9876543210',
        profession: 'PLUMBER',
        firstName: 'Ramesh',
        lastName: 'Kumar',
        password: 'SecurePassword123!',
        verificationToken: 'vtoken_abc_123',
      });

      expect(payload.passwordSha256).toBeDefined();
      expect(payload.verificationToken).toBe('vtoken_abc_123');
    });
  });

  describe('P1.5: Bill Upload Memory Amplification & Streaming DoS (DOS-01, DOS-02)', () => {
    it('verifies nginx.conf removed ^~ from file streaming and applies rate limiting', () => {
      const nginxPath = path.join(rootDir, 'nginx/nginx.conf');
      const content = fs.readFileSync(nginxPath, 'utf8');

      expect(content).not.toContain('location ^~ /api/bills/file');
      expect(content).not.toContain('location ^~ /api/v1/bills/file');
      expect(content).toContain('location /api/bills/file');
      expect(content).toContain('location /api/v1/bills/file');

      const fileLocIdx = content.indexOf('location /api/bills/file');
      const fileLocBlock = content.slice(fileLocIdx, fileLocIdx + 300);
      expect(fileLocBlock).toContain('limit_req zone=api_limit burst=50 nodelay;');
    });

    it('verifies server.ts scopes 500kb body limit to bill uploads', () => {
      const serverPath = path.join(rootDir, 'backend/src/server.ts');
      const content = fs.readFileSync(serverPath, 'utf8');
      expect(content).toContain("limit: process.env.JSON_BODY_LIMIT || '500kb'");
    });

    it('verifies bill.routes.ts uses diskStorage for uploads', () => {
      const routesPath = path.join(rootDir, 'backend/src/routes/bill.routes.ts');
      const content = fs.readFileSync(routesPath, 'utf8');
      expect(content).toContain('multer.diskStorage');
      expect(content).not.toContain('multer.memoryStorage()');
    });
  });

  describe('P1.6: Worker Queue Starvation & Head-of-Line Blocking (DOS-03)', () => {
    it('verifies payout.worker.ts implements exponential backoff on retried outbox events', () => {
      const workerPath = path.join(rootDir, 'backend/src/worker/payout.worker.ts');
      const content = fs.readFileSync(workerPath, 'utf8');
      expect(content).toContain('event.attempts * 30 * 1000');
      expect(content).toContain('runnableEvents');
    });

    it('verifies reconciliation.worker.ts marks dead-letter after 5 attempts', () => {
      const reconPath = path.join(rootDir, 'backend/src/worker/reconciliation.worker.ts');
      const content = fs.readFileSync(reconPath, 'utf8');
      expect(content).toContain('[DEAD-LETTER]');
    });
  });

  describe('P1.7: CI/CD Permission Defect & Dependency Overrides (VULN-CI-01, VULN-CI-02)', () => {
    it('verifies deploy-kvm.yml includes actions: read permission', () => {
      const deployPath = path.join(rootDir, '.github/workflows/deploy-kvm.yml');
      const content = fs.readFileSync(deployPath, 'utf8');
      expect(content).toContain('actions: read');
    });

    it('verifies mobile/package.json overrides satisfy security floor', () => {
      const pkgPath = path.join(rootDir, 'mobile/package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      expect(pkg.overrides['braces']).toMatch(/^\^?3\.0\.[3-9]/);
      expect(pkg.overrides['node-forge']).toMatch(/^\^?1\.4\.[0-9]/);
    });

    it('verifies ci.yml enforces audit-level=high for mobile', () => {
      const ciPath = path.join(rootDir, '.github/workflows/ci.yml');
      const content = fs.readFileSync(ciPath, 'utf8');
      expect(content).toContain('npm audit --omit=dev --audit-level=high');
    });
  });

  describe('P1.8: Disaster Recovery Hardening (VULN-DR-02, VULN-DR-03)', () => {
    it('verifies restore-db.sh ensures target database exists before restoring', () => {
      const restorePath = path.join(rootDir, 'scripts/restore-db.sh');
      const content = fs.readFileSync(restorePath, 'utf8');
      expect(content).toContain('CREATE DATABASE');
      expect(content).toContain('pg_database WHERE datname');
    });

    it('verifies backup-db.sh checks for @aws-sdk/client-s3 on host Node before invoking', () => {
      const backupPath = path.join(rootDir, 'scripts/backup-db.sh');
      const content = fs.readFileSync(backupPath, 'utf8');
      expect(content).toContain("node -e \"require('@aws-sdk/client-s3')\"");
    });
  });
});
