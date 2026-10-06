import { prisma } from '../db';
import { GstRule } from '@prisma/client';

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
   *    gstAmount = round(grossBillAmount * (gstRate / (100 + gstRate)), 2)
   *    eligibleAmount = round(grossBillAmount - gstAmount, 2)
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
    const gross = Math.max(0, grossBillAmount);

    if (!gstIncluded || gstRatePercentage <= 0) {
      return {
        grossBillAmount: Math.round(gross * 100) / 100,
        gstIncluded: false,
        gstRate: 0.0,
        gstAmount: 0.0,
        eligibleRewardAmount: Math.round(gross * 100) / 100,
      };
    }

    // Exact GST-inclusive reverse tax component calculation:
    // e.g. for ₹10,000 at 18%: 10000 * 18 / 118 = 1525.4237... -> ₹1,525.42
    const rate = Math.max(0, gstRatePercentage);
    const rawGstAmount = (gross * rate) / (100 + rate);
    const gstAmount = Math.round(rawGstAmount * 100) / 100;
    const eligibleRewardAmount = Math.round((gross - gstAmount) * 100) / 100;

    return {
      grossBillAmount: Math.round(gross * 100) / 100,
      gstIncluded: true,
      gstRate: rate,
      gstAmount,
      eligibleRewardAmount,
    };
  }

  /**
   * Returns all active GST rules from PostgreSQL.
   */
  static async getActiveGstRules(tx: any = prisma): Promise<GstRule[]> {
    return await tx.gstRule.findMany({
      where: { isActive: true },
      orderBy: { ratePercentage: 'asc' },
    });
  }

  /**
   * Returns the default GST rule (or 18% standard fallback).
   */
  static async getDefaultGstRule(tx: any = prisma): Promise<GstRule | null> {
    const defaultRule = await tx.gstRule.findFirst({
      where: { isDefault: true, isActive: true },
    });

    if (defaultRule) return defaultRule;

    return await tx.gstRule.findFirst({
      where: { isActive: true },
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
