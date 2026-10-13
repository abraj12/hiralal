import { prisma } from '../db';
import { GstRule } from '@prisma/client';

const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error('Money value must be finite.');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const GST_RATE_STRING_PATTERN = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;

/**
 * Strictly parses and validates a GST rate percentage.
 * Enforces:
 * - Number or strict numeric string matching /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/
 * - Finite number in range [0.00, 100.00]
 * - Maximum 2 decimal places (matching Decimal(5, 2))
 * - Rejects "18foo", "", " ", null, undefined, NaN, Infinity, scientific notation, negative numbers, > 100
 */
export function parseStrictGstRate(value: unknown): number {
  let rate: number;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || isNaN(value)) {
      throw new Error('GST rate percentage must be between 0.00% and 100.00%.');
    }

    rate = value;

    // Detect excess fractional precision, including values
    // formatted by JavaScript using exponential notation (e.g. 1e-7).
    const roundedToTwoDecimals = Math.round(rate * 100) / 100;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(rate)) * 4;

    if (Math.abs(rate - roundedToTwoDecimals) > tolerance) {
      throw new Error('GST rate cannot have more than 2 decimal places.');
    }
  } else if (typeof value === 'string') {
    const normalized = value.trim();

    if (/^(?:0|[1-9]\d{0,2})\.\d+$/.test(normalized)) {
      const decimals = normalized.split('.')[1];
      if (decimals.length > 2) {
        throw new Error('GST rate cannot have more than 2 decimal places.');
      }
    }

    if (!GST_RATE_STRING_PATTERN.test(normalized)) {
      throw new Error('GST rate percentage must be between 0.00% and 100.00%.');
    }

    rate = Number(normalized);
  } else {
    throw new Error('GST rate percentage must be between 0.00% and 100.00%.');
  }

  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error('GST rate percentage must be between 0.00% and 100.00%.');
  }

  // Avoid returning JavaScript negative zero
  return Object.is(rate, -0) ? 0 : rate;
}

export class GstService {
  /**
   * Calculates reverse GST and tax-exclusive eligible reward amount deterministically.
   * Specification: Section 6
   * If gstIncluded is false, returns eligibleRewardAmount = grossBillAmount, gstRate = null, gstAmount = 0.
   * If gstIncluded is true, requires valid configuredGstRate >= 0 and <= 100, otherwise throws [NO_APPLICABLE_GST_RULE].
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
      configuredGstRate < 0 ||
      configuredGstRate > 100
    ) {
      throw new Error('[NO_APPLICABLE_GST_RULE]');
    }

    const gross = roundMoney(grossBillAmount);

    if (configuredGstRate === 0) {
      return {
        grossBillAmount: gross,
        gstIncluded: true,
        gstRate: 0,
        gstAmount: 0,
        eligibleRewardAmount: gross,
      };
    }

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
   * Compatible alias with calculateReverseGst returning canonical shape.
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
      return this.calculateReverseGst(grossBillAmount, false, null);
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
   * Creates a new dynamic GST rate in the database after strictly validating inputs.
   */
  static async createGstRule(
    adminId: string,
    params: {
      ratePercentage: unknown;
      description?: unknown;
      isDefault?: unknown;
      effectiveFrom?: Date;
      effectiveUntil?: Date | null;
    },
    tx: any = prisma
  ): Promise<GstRule> {
    const validatedRate = parseStrictGstRate(params.ratePercentage);

    if (params.isDefault !== undefined && typeof params.isDefault !== 'boolean') {
      throw new Error('isDefault must be a boolean.');
    }

    if (params.description !== undefined && typeof params.description !== 'string') {
      throw new Error('GST rule description must be a string.');
    }

    const isDefault = params.isDefault === true;
    const description = (params.description as string | undefined)?.trim();

    const executeInTx = async (db: any) => {
      if (isDefault) {
        // Serialize concurrent default-rule mutations using PostgreSQL advisory xact lock
        await db.$executeRaw`SELECT pg_advisory_xact_lock(7212026, 1)`;
        // Clear existing default flags atomically
        await db.gstRule.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      const rule = await db.gstRule.create({
        data: {
          ratePercentage: validatedRate,
          description: description || `${validatedRate}% GST`,
          isDefault,
          isActive: true,
          effectiveFrom: params.effectiveFrom || new Date(),
          effectiveUntil: params.effectiveUntil || null,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      });

      await db.auditLog.create({
        data: {
          adminId,
          action: 'GST_RULE_CREATED',
          entityType: 'GstRule',
          entityId: rule.id,
          newValue: JSON.stringify(rule),
        },
      });

      return rule;
    };

    if (tx === prisma) {
      return await prisma.$transaction(executeInTx);
    } else {
      return await executeInTx(tx);
    }
  }

  /**
   * Updates an existing GST rate atomically.
   */
  static async updateGstRule(
    adminId: string,
    id: string,
    params: {
      description?: unknown;
      isDefault?: unknown;
      isActive?: unknown;
    },
    tx: any = prisma
  ): Promise<GstRule> {
    if (params.isDefault !== undefined && typeof params.isDefault !== 'boolean') {
      throw new Error('isDefault must be a boolean.');
    }

    if (params.isActive !== undefined && typeof params.isActive !== 'boolean') {
      throw new Error('isActive must be a boolean.');
    }

    if (params.description !== undefined && typeof params.description !== 'string') {
      throw new Error('GST rule description must be a string.');
    }

    const isDefault = params.isDefault === true;
    const description = params.description !== undefined ? (params.description as string).trim() : undefined;

    const executeInTx = async (db: any) => {
      if (isDefault) {
        // Serialize concurrent default-rule mutations using PostgreSQL advisory xact lock
        await db.$executeRaw`SELECT pg_advisory_xact_lock(7212026, 1)`;
      }

      // 1. Fetch and validate target existence inside transaction before any modifications
      const target = await db.gstRule.findUnique({ where: { id } });
      if (!target) {
        throw new Error(`GST rule with ID "${id}" not found.`);
      }

      // 2. Clear old default flag only if this rule is being designated as default
      if (isDefault) {
        await db.gstRule.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      // 3. Update target rule
      const updated = await db.gstRule.update({
        where: { id },
        data: {
          ...(description !== undefined && { description }),
          ...(params.isDefault !== undefined && { isDefault: params.isDefault as boolean }),
          ...(params.isActive !== undefined && { isActive: params.isActive as boolean }),
          updatedByAdminId: adminId,
        },
      });

      // 4. Write audit record
      await db.auditLog.create({
        data: {
          adminId,
          action: 'GST_RULE_UPDATED',
          entityType: 'GstRule',
          entityId: id,
          newValue: JSON.stringify(updated),
        },
      });

      return updated;
    };

    if (tx === prisma) {
      return await prisma.$transaction(executeInTx);
    } else {
      return await executeInTx(tx);
    }
  }
}
