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
   * Calculates reverse GST and tax-exclusive eligible reward amount deterministically.
   * Specification: Section 6
   * If gstIncluded is false, returns eligibleRewardAmount = grossBillAmount, gstRate = null, gstAmount = 0.
   * If gstIncluded is true, requires valid configuredGstRate > 0 and <= 100, otherwise throws [NO_APPLICABLE_GST_RULE].
   */
  static calculateReverseGst(
    grossBillAmount: number,
    gstIncluded: boolean,
    configuredGstRate: number | null
  ) {
    if (!Number.isFinite(grossBillAmount) || grossBillAmount <= 0) {
      throw new Error('Gross bill amount must be positive and finite.');
    }

    if (typeof gstIncluded !== 'boolean') {
      throw new Error('GST selection must be explicit.');
    }

    if (!gstIncluded) {
      return {
        grossBillAmount: roundMoney(grossBillAmount),
        gstIncluded: false,
        gstRate: null,
        gstAmount: 0,
        eligibleRewardAmount: roundMoney(grossBillAmount),
      };
    }

    if (
      configuredGstRate === null ||
      configuredGstRate === undefined ||
      !Number.isFinite(configuredGstRate) ||
      configuredGstRate <= 0 ||
      configuredGstRate > 100
    ) {
      throw new Error('[NO_APPLICABLE_GST_RULE]');
    }

    const gross = roundMoney(grossBillAmount);
    const gstAmount = roundMoney(
      (gross * configuredGstRate) / (100 + configuredGstRate)
    );

    return {
      grossBillAmount: gross,
      gstIncluded: true,
      gstRate: configuredGstRate,
      gstAmount,
      eligibleRewardAmount: roundMoney(gross - gstAmount),
    };
  }

  /**
   * Calculates GST amount and tax-exclusive eligible reward amount deterministically.
   * Compatible alias with calculateReverseGst.
   */
  static calculateGstAndEligibleAmount(
    grossBillAmount: number,
    gstIncluded: boolean,
    gstRatePercentage?: number | null
  ): {
    grossBillAmount: number;
    gstIncluded: boolean;
    gstRate: number | null;
    gstAmount: number;
    eligibleRewardAmount: number;
  } {
    if (typeof gstIncluded !== 'boolean') {
      throw new Error('GST selection must be a boolean.');
    }

    if (!gstIncluded) {
      const res = this.calculateReverseGst(grossBillAmount, false, null);
      return { ...res, gstRate: 0 };
    }

    if (
      gstRatePercentage === undefined ||
      gstRatePercentage === null ||
      !Number.isFinite(gstRatePercentage) ||
      gstRatePercentage < 0 ||
      gstRatePercentage > 100
    ) {
      throw new Error('GST rate must be between 0% and 100%.');
    }

    if (gstRatePercentage === 0) {
      const gross = roundMoney(grossBillAmount);
      return {
        grossBillAmount: gross,
        gstIncluded: true,
        gstRate: 0,
        gstAmount: 0,
        eligibleRewardAmount: gross,
      };
    }

    return this.calculateReverseGst(grossBillAmount, true, gstRatePercentage);
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
   * Returns the explicitly designated default GST rule applicable at a specific effective business date.
   * Fails closed by returning null if no explicit default rule is configured (no silent rate substitution).
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

    return defaultRule || null;
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
