import { prisma } from '../db';
import { GstRule } from '@prisma/client';

const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error('Money value must be finite.');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

export class GstService {
  /**
   * Calculates GST amount and tax-exclusive eligible reward amount deterministically.
   *
   * Formulations:
   * 1. GST-excluded invoice (or Zero GST):
   *    gstAmount = 0.00
   *    eligibleAmount = grossBillAmount
   *
   * 2. GST-inclusive invoice:
   *    gstAmount = roundMoney(grossBillAmount * rate / (100 + rate))
   *    eligibleAmount = roundMoney(grossBillAmount - gstAmount)
   */
  static calculateGstAndEligibleAmount(
    grossBillAmount: number,
    gstIncluded: boolean,
    gstRatePercentage: number = 0
  ): {
    grossBillAmount: number;
    gstIncluded: boolean;
    gstRate: number;
    gstAmount: number;
    eligibleRewardAmount: number;
  } {
    if (!Number.isFinite(grossBillAmount) || grossBillAmount <= 0) {
      throw new Error('Gross bill amount must be a finite positive number.');
    }

    if (typeof gstIncluded !== 'boolean') {
      throw new Error('GST selection must be a boolean.');
    }

    const rate = gstIncluded ? gstRatePercentage : 0;

    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new Error('GST rate must be between 0% and 100%.');
    }

    const gross = roundMoney(grossBillAmount);
    const gstAmount = gstIncluded && rate > 0
      ? roundMoney((gross * rate) / (100 + rate))
      : 0;

    const eligibleRewardAmount = roundMoney(gross - gstAmount);

    return {
      grossBillAmount: gross,
      gstIncluded,
      gstRate: rate,
      gstAmount,
      eligibleRewardAmount,
    };
  }

  /**
   * Returns all active GST rules applicable at a specific effective business date.
   * Boundaries:
   *   isActive: true
   *   effectiveFrom <= effectiveAt
   *   effectiveUntil IS NULL OR effectiveUntil > effectiveAt (exclusive end-boundary)
   */
  static async getApplicableGstRules(
    effectiveAt: Date = new Date(),
    tx: any = prisma
  ): Promise<GstRule[]> {
    return await tx.gstRule.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: effectiveAt },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: effectiveAt } },
        ],
      },
      orderBy: { ratePercentage: 'asc' },
    });
  }

  /**
   * Returns all active GST rules from PostgreSQL regardless of date (for configuration views).
   */
  static async getActiveGstRules(tx: any = prisma): Promise<GstRule[]> {
    return await tx.gstRule.findMany({
      where: { isActive: true },
      orderBy: { ratePercentage: 'asc' },
    });
  }

  /**
   * Returns the default GST rule applicable at a specific effective business date.
   */
  static async getDefaultGstRule(
    effectiveAt: Date = new Date(),
    tx: any = prisma
  ): Promise<GstRule | null> {
    const applicableWhere = {
      isActive: true,
      effectiveFrom: { lte: effectiveAt },
      OR: [
        { effectiveUntil: null },
        { effectiveUntil: { gt: effectiveAt } },
      ],
    };

    const defaultRule = await tx.gstRule.findFirst({
      where: {
        ...applicableWhere,
        isDefault: true,
      },
    });

    if (defaultRule) return defaultRule;

    return await tx.gstRule.findFirst({
      where: applicableWhere,
      orderBy: { ratePercentage: 'desc' },
    });
  }

  /**
   * Looks up a specific GST rule by ID.
   */
  static async getGstRuleById(id: string, tx: any = prisma): Promise<GstRule | null> {
    return await tx.gstRule.findUnique({ where: { id } });
  }

  /**
   * Creates a new dynamic GST rate in the database.
   */
  static async createGstRule(
    adminId: string,
    params: {
      ratePercentage: number;
      description?: string;
      isDefault?: boolean;
      effectiveFrom?: Date;
      effectiveUntil?: Date | null;
    },
    tx: any = prisma
  ): Promise<GstRule> {
    const { ratePercentage, description, isDefault } = params;

    if (ratePercentage < 0 || ratePercentage > 100) {
      throw new Error('GST rate percentage must be between 0.00% and 100.00%.');
    }

    if (isDefault) {
      // Clear existing default flags
      await tx.gstRule.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const rule = await tx.gstRule.create({
      data: {
        ratePercentage,
        description: description || `${ratePercentage}% GST`,
        isDefault: Boolean(isDefault),
        isActive: true,
        effectiveFrom: params.effectiveFrom || new Date(),
        effectiveUntil: params.effectiveUntil || null,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'GST_RULE_CREATED',
        entityType: 'GstRule',
        entityId: rule.id,
        newValue: JSON.stringify(rule),
      },
    });

    return rule;
  }

  /**
   * Updates an existing GST rate.
   */
  static async updateGstRule(
    adminId: string,
    id: string,
    params: {
      description?: string;
      isDefault?: boolean;
      isActive?: boolean;
    },
    tx: any = prisma
  ): Promise<GstRule> {
    if (params.isDefault) {
      await tx.gstRule.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await tx.gstRule.update({
      where: { id },
      data: {
        ...(params.description !== undefined && { description: params.description }),
        ...(params.isDefault !== undefined && { isDefault: params.isDefault }),
        ...(params.isActive !== undefined && { isActive: params.isActive }),
        updatedByAdminId: adminId,
      },
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'GST_RULE_UPDATED',
        entityType: 'GstRule',
        entityId: id,
        newValue: JSON.stringify(updated),
      },
    });

    return updated;
  }
}
