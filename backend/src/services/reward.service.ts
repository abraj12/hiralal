import { config } from '../config';
import { prisma } from '../db';
import { Profession } from '@prisma/client';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { calculateRewardAmount } from '../utils/money.utils';

export class RewardService {
  /**
   * Deterministically calculates reward for a bill amount at 2-decimal paise precision.
   * STRICT: Computed exclusively server-side.
   */
  static calculateReward(billAmount: number, percentage?: number): number {
    const rate = percentage !== undefined ? percentage : config.rewards.defaultPercentage;
    return calculateRewardAmount(billAmount, rate);
  }

  /**
   * Retrieves or atomically initializes current month's RewardPool record in PostgreSQL
   * using business timezone Asia/Kolkata.
   */
  static async getCurrentMonthPool(tx: any = prisma) {
    const { year, month } = getIstYearAndMonth();

    return await tx.rewardPool.upsert({
      where: {
        pool_year_month_unique: { year, month },
      },
      update: {},
      create: {
        year,
        month,
        totalPoolCap: config.rewards.monthlyPoolCap,
        usedAmount: 0.0,
        isCapped: false,
      },
    });
  }

  /**
   * Atomically checks pool headroom against the configured monthly ceiling.
   */
  static async checkPoolAvailability(rewardAmount: number): Promise<{ available: boolean; remaining: number }> {
    const pool = await this.getCurrentMonthPool();
    const used = Number(pool.usedAmount);
    const cap = Number(pool.totalPoolCap);
    const remaining = Math.max(0, cap - used);

    if (pool.isCapped || used + rewardAmount > cap) {
      return { available: false, remaining };
    }

    return { available: true, remaining };
  }

  /**
   * Atomically claims amount from monthly pool within a database transaction.
   * Uses atomic conditional SQL update to ensure strict concurrency protection.
   */
  static async claimPoolAmount(tx: any, rewardAmount: number) {
    const pool = await this.getCurrentMonthPool(tx);
    const cap = Number(pool.totalPoolCap);

    // Atomic conditional SQL update: only succeeds if usedAmount + rewardAmount <= totalPoolCap
    const result: any[] = await tx.$queryRaw`
      UPDATE "RewardPool"
      SET "usedAmount" = "usedAmount" + ${rewardAmount}::decimal,
          "isCapped" = ("usedAmount" + ${rewardAmount}::decimal >= "totalPoolCap"),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${pool.id}
        AND ("usedAmount" + ${rewardAmount}::decimal) <= "totalPoolCap"
      RETURNING *;
    `;

    if (!result || result.length === 0) {
      // Re-read current usage for accurate remaining calculation
      const current = await tx.rewardPool.findUnique({ where: { id: pool.id } });
      const currentUsed = current ? Number(current.usedAmount) : cap;
      const remaining = Math.max(0, cap - currentUsed);

      throw new Error(
        `Monthly reward pool ceiling of ₹${cap.toLocaleString('en-IN')} reached. Available headroom: ₹${remaining.toFixed(2)}. Approval rejected.`
      );
    }

    return result[0];
  }

  /**
   * Retrieves active reward rule for a given profession.
   */
  static async getRewardRule(profession?: Profession | null) {
    if (profession) {
      const specificRule = await prisma.rewardRule.findFirst({
        where: { profession, isActive: true },
      });
      if (specificRule) return specificRule;
    }

    const defaultRule = await prisma.rewardRule.findFirst({
      where: { isActive: true },
    });

    if (defaultRule) return defaultRule;

    return {
      percentage: config.rewards.defaultPercentage,
      monthlyPoolLimit: config.rewards.monthlyPoolCap,
      minRedemptionAmount: config.rewards.minRedemptionAmount,
    };
  }

  /**
   * Retrieves pool usage analytics for current month.
   */
  static async getPoolAnalytics() {
    const pool = await this.getCurrentMonthPool();
    const totalCap = Number(pool.totalPoolCap);
    const used = Number(pool.usedAmount);
    const remaining = Math.max(0, totalCap - used);
    const percentageUsed = totalCap > 0 ? (used / totalCap) * 100 : 0;

    return {
      year: pool.year,
      month: pool.month,
      totalPoolCap: totalCap,
      usedAmount: used,
      remainingAmount: remaining,
      percentageUsed: Math.round(percentageUsed * 100) / 100,
      isCapped: pool.isCapped,
    };
  }

  /**
   * Updates reward rules for a profession or all professions.
   */
  static async updateRewardRules(
    adminId: string,
    params: {
      percentage?: number;
      monthlyPoolLimit?: number;
      minRedemptionAmount?: number;
      profession?: Profession;
    }
  ) {
    const where: any = { isActive: true };
    if (params.profession) {
      where.profession = params.profession;
    }

    let rule = await prisma.rewardRule.findFirst({ where });
    if (!rule) {
      rule = await prisma.rewardRule.create({
        data: {
          profession: params.profession || null,
          percentage: params.percentage !== undefined ? params.percentage : config.rewards.defaultPercentage,
          monthlyPoolLimit: params.monthlyPoolLimit !== undefined ? params.monthlyPoolLimit : config.rewards.monthlyPoolCap,
          minRedemptionAmount: params.minRedemptionAmount !== undefined ? params.minRedemptionAmount : config.rewards.minRedemptionAmount,
          isActive: true,
          updatedByAdminId: adminId,
        },
      });
      return rule;
    }

    const updated = await prisma.rewardRule.update({
      where: { id: rule.id },
      data: {
        ...(params.percentage !== undefined && { percentage: params.percentage }),
        ...(params.monthlyPoolLimit !== undefined && { monthlyPoolLimit: params.monthlyPoolLimit }),
        ...(params.minRedemptionAmount !== undefined && { minRedemptionAmount: params.minRedemptionAmount }),
        updatedByAdminId: adminId,
      },
    });

    if (params.monthlyPoolLimit !== undefined) {
      const { year, month } = getIstYearAndMonth();
      await prisma.rewardPool.updateMany({
        where: { year, month },
        data: { totalPoolCap: params.monthlyPoolLimit },
      });
    }

    return updated;
  }
}
