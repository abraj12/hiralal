import fs from 'fs';
import path from 'path';
import {
  ProfessionEnum,
  BillStatusEnum,
  PayoutStatusEnum,
  IndianMobileSchema,
  PanSchema,
  UpiIdSchema,
  IfscSchema,
  BillUploadInputSchema,
  DeviceTokenInputSchema,
} from '../schemas/validation.schemas';

describe('Phase 3 Verification & Regression Suite (Operational Hygiene & Long-Term Reliability)', () => {
  const rootDir = path.resolve(__dirname, '../../../');

  describe('P3.1: Database Aggregation for Admin Dashboards (DOS-04)', () => {
    it('verifies admin.routes.ts uses prisma.bill.aggregate instead of findMany + reduce', () => {
      const routesPath = path.join(rootDir, 'backend/src/routes/admin.routes.ts');
      const content = fs.readFileSync(routesPath, 'utf8');

      expect(content).toContain('DOS-04: Use database aggregation instead of unbounded findMany + in-memory reduce');
      expect(content).toContain('prisma.bill.aggregate({');
      expect(content).toContain('_sum: { calculatedReward: true }');
      expect(content).not.toContain('monthBills.reduce((acc, b)');
    });
  });

  describe('P3.2: Worker Daemon Reliability & Task Queues (DOS-03)', () => {
    it('verifies backend/src/worker/index.ts starts all worker daemons with graceful shutdown', () => {
      const indexPath = path.join(rootDir, 'backend/src/worker/index.ts');
      const content = fs.readFileSync(indexPath, 'utf8');

      expect(content).toContain('PayoutWorker.startOutboxPolling');
      expect(content).toContain('ReconciliationWorker.startReconciliation');
      expect(content).toContain('AccountDeletionWorker.startAccountDeletionWorker');
      expect(content).toContain("process.on('SIGTERM', shutdown)");
      expect(content).toContain("process.on('SIGINT', shutdown)");
    });
  });

  describe('P3.3: Standardized Zod Input Validation (VULN-DEP-01)', () => {
    it('validates enums correctly and rejects invalid entries', () => {
      expect(ProfessionEnum.safeParse('PLUMBER').success).toBe(true);
      expect(ProfessionEnum.safeParse('TILE_INSTALLER').success).toBe(true);
      expect(ProfessionEnum.safeParse('ELECTRICIAN').success).toBe(false);

      expect(BillStatusEnum.safeParse('APPROVED').success).toBe(true);
      expect(BillStatusEnum.safeParse('COMPLETED').success).toBe(false);

      expect(PayoutStatusEnum.safeParse('SUCCESS').success).toBe(true);
      expect(PayoutStatusEnum.safeParse('PAID').success).toBe(false);
    });

    it('validates Indian mobile numbers, PAN, UPI IDs, and IFSC codes', () => {
      expect(IndianMobileSchema.safeParse('9876543210').success).toBe(true);
      expect(IndianMobileSchema.safeParse('12345').success).toBe(false);

      expect(PanSchema.safeParse('ABCDE1234F').success).toBe(true);
      expect(PanSchema.safeParse('ABCDE12345').success).toBe(false);

      expect(UpiIdSchema.safeParse('user@okhdfcbank').success).toBe(true);
      expect(UpiIdSchema.safeParse('not-an-upi-id').success).toBe(false);

      expect(IfscSchema.safeParse('SBIN0001234').success).toBe(true);
      expect(IfscSchema.safeParse('SBIN1234').success).toBe(false);
    });

    it('validates BillUpload and DeviceToken schemas', () => {
      const validBill = {
        invoiceNumber: 'INV-2026-001',
        invoiceDate: '2026-10-15',
        billAmount: 1500.5,
      };
      expect(BillUploadInputSchema.safeParse(validBill).success).toBe(true);

      const invalidBill = {
        invoiceNumber: '',
        invoiceDate: '15-10-2026',
        billAmount: -10,
      };
      expect(BillUploadInputSchema.safeParse(invalidBill).success).toBe(false);

      expect(DeviceTokenInputSchema.safeParse({ token: 'fcm_token_123', platform: 'ANDROID' }).success).toBe(true);
      expect(DeviceTokenInputSchema.safeParse({ token: '' }).success).toBe(false);
    });
  });

  describe('P3.4: Client Component Test Architecture (VULN-TEST-01)', () => {
    it('verifies admin and mobile test scripts exist and execute with node:test', () => {
      const adminPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'admin/package.json'), 'utf8'));
      const mobilePkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'mobile/package.json'), 'utf8'));

      expect(adminPkg.scripts.test).toContain('node --test');
      expect(mobilePkg.scripts.test).toContain('node --test');
    });
  });
});
