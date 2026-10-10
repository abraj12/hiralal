import { prisma } from '../db';
import { Profession, RewardRule } from '@prisma/client';
import { config } from '../config';

export class RewardRuleService {
  /**
   * Retrieves the authoritative active reward rule for a given profession at a specific business timestamp.
   * Throws if no rule exists or if overlapping rules are detected.
   */
  static async getApplicableRule(
    profession: Profession,
    effectiveAt: Date = new Date(),
    tx: any = prisma
  ): Promise<RewardRule> {
    const rules = await tx.rewardRule.findMany({
      where: {
        profession,
        isActive: true,
        effectiveFrom: { lte: effectiveAt },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gt: effectiveAt } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (rules.length === 0) {
      if (config.isProduction) {
        throw new Error(
          `[REWARD-RULE] No active reward rule found for profession ${profession} at effective date ${effectiveAt.toISOString()}. Operation halted (fail closed).`
        );
      }

      // In development or test environments, fallback to latest active rule
      const devRule = await tx.rewardRule.findFirst({
        where: { profession, isActive: true },
        orderBy: { version: 'desc' },
      });

      if (devRule) return devRule;

      return await tx.rewardRule.create({
        data: {
          profession,
          rewardPercentage: profession === 'PLUMBER' ? 0.50 : 0.75,
          monthlyPoolLimit: 50000.0,
          minRedemptionAmount: 500.0,
          maxRedemptionAmount: 10000.0,
          effectiveFrom: new Date('2020-01-01'),
          isActive: true,
          version: 1,
        },
      });
    }

    if (rules.length > 1) {
      throw new Error(
        `[OVERLAPPING_REWARD_RULES] Multiple overlapping active rules found for ${profession} at ${effectiveAt.toISOString()}. Operation halted (fail closed).`
      );
    }

    return rules[0];
  }

  /**
   * Creates a new versioned reward rule for a profession.
   * Automatically increments version number to ensure historical auditability.
   */
  static async createRule(
    adminId: string,
    params: {
      profession: Profession;
      rewardPercentage: number;
      monthlyPoolLimit?: number;
      minRedemptionAmount?: number;
      maxRedemptionAmount?: number;
      effectiveFrom?: Date;
      effectiveUntil?: Date | null;
      isActive?: boolean;
    },
    tx: any = prisma
  ): Promise<RewardRule> {
    const { profession, rewardPercentage } = params;

    if (rewardPercentage <= 0 || rewardPercentage > 50) {
      throw new Error('Reward percentage must be between 0.01% and 50.00%.');
    }

    const monthlyPoolLimit = params.monthlyPoolLimit !== undefined ? params.monthlyPoolLimit : 0.0;
    const minRedemption = params.minRedemptionAmount !== undefined ? params.minRedemptionAmount : 500;
    const maxRedemption = params.maxRedemptionAmount !== undefined ? params.maxRedemptionAmount : 0.0;

    if (minRedemption <= 0) {
      throw new Error('Minimum redemption amount must be greater than zero.');
    }

    if (maxRedemption > 0 && maxRedemption < minRedemption) {
      throw new Error('Maximum redemption amount must be greater than or equal to minimum redemption amount.');
    }

    const effectiveFrom = params.effectiveFrom || new Date();
    const effectiveUntil = params.effectiveUntil || null;

    if (effectiveUntil && effectiveUntil <= effectiveFrom) {
      throw new Error('Effective until timestamp must be after effective from timestamp.');
    }

    // Determine next version number for this profession
    const latestRule = await tx.rewardRule.findFirst({
      where: { profession },
      orderBy: { version: 'desc' },
    });
    const nextVersion = latestRule ? latestRule.version + 1 : 1;

    // Check for conflicting overlapping active rules
    if (params.isActive !== false) {
      const conflicting = await tx.rewardRule.findMany({
        where: {
          profession,
          isActive: true,
          AND: [
            { effectiveFrom: { lte: effectiveUntil || new Date(9999, 11, 31) } },
            {
              OR: [
                { effectiveUntil: null },
                { effectiveUntil: { gt: effectiveFrom } },
              ],
            },
          ],
        },
      });

      if (conflicting.length > 0) {
        // Deactivate previous active rule or truncate its effectiveUntil
        for (const prev of conflicting) {
          if (!prev.effectiveUntil || prev.effectiveUntil > effectiveFrom) {
            await tx.rewardRule.update({
              where: { id: prev.id },
              data: {
                effectiveUntil: effectiveFrom,
                updatedByAdminId: adminId,
              },
            });
          }
        }
      }
    }

    const newRule = await tx.rewardRule.create({
      data: {
        profession,
        rewardPercentage,
        monthlyPoolLimit,
        minRedemptionAmount: minRedemption,
        maxRedemptionAmount: maxRedemption,
        effectiveFrom,
        effectiveUntil,
        isActive: params.isActive !== undefined ? params.isActive : true,
        version: nextVersion,
        createdByAdminId: adminId,
        updatedByAdminId: adminId,
      },
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        adminId,
        action: 'REWARD_RULE_CREATED',
        entityType: 'RewardRule',
        entityId: newRule.id,
        newValue: JSON.stringify({
          profession: newRule.profession,
          rewardPercentage: Number(newRule.rewardPercentage),
          monthlyPoolLimit: Number(newRule.monthlyPoolLimit),
          version: newRule.version,
          effectiveFrom: newRule.effectiveFrom,
        }),
      },
    });

    return newRule;
  }

  /**
   * Updates an existing reward rule if not already referenced by approved bills.
   * If already used, callers should create a new version instead.
   */
  static async updateRule(
    adminId: string,
    ruleId: string,
    params: {
      rewardPercentage?: number;
      monthlyPoolLimit?: number;
      minRedemptionAmount?: number;
      maxRedemptionAmount?: number;
      effectiveUntil?: Date | null;
      isActive?: boolean;
    },
    tx: any = prisma
  ): Promise<RewardRule> {
    const existing = await tx.rewardRule.findUnique({
      where: { id: ruleId },
      include: { _count: { select: { bills: true } } },
    });

    if (!existing) {
      throw new Error('Reward rule not found.');
    }

    // Financial immutability invariant:
    // If approved bills have used this rule, do not mutate percentage or limits in-place!
    if (existing._count.bills > 0 && params.rewardPercentage !== undefined && Number(existing.rewardPercentage) !== params.rewardPercentage) {
      throw new Error(
        `Reward rule v${existing.version} is already bound to ${existing._count.bills} approved invoice(s). Create a new rule version to alter percentages without violating financial immutability.`
      );
    }

    const updated = await tx.rewardRule.update({
      where: { id: ruleId },
      data: {
        ...(params.rewardPercentage !== undefined && { rewardPercentage: params.rewardPercentage }),
        ...(params.monthlyPoolLimit !== undefined && { monthlyPoolLimit: params.monthlyPoolLimit }),
        ...(params.minRedemptionAmount !== undefined && { minRedemptionAmount: params.minRedemptionAmount }),
        ...(params.maxRedemptionAmount !== undefined && { maxRedemptionAmount: params.maxRedemptionAmount }),
        ...(params.effectiveUntil !== undefined && { effectiveUntil: params.effectiveUntil }),
        ...(params.isActive !== undefined && { isActive: params.isActive }),
        updatedByAdminId: adminId,
      },
    });

    await tx.auditLog.create({
      data: {
        adminId,
        action: 'REWARD_RULE_UPDATED',
        entityType: 'RewardRule',
        entityId: ruleId,
        oldValue: JSON.stringify(existing),
        newValue: JSON.stringify(updated),
      },
    });

    return updated;
  }

  /**
   * Lists all rules for a given profession or all professions.
   */
  static async listRules(profession?: Profession, tx: any = prisma) {
    return await tx.rewardRule.findMany({
      where: {
        ...(profession && { profession }),
      },
      orderBy: [{ profession: 'asc' }, { version: 'desc' }],
    });
  }
}
