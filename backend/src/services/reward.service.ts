import { config } from '../config';
import { prisma } from '../db';
import { Profession } from '@prisma/client';

export class RewardService {
  /**
   * Calculates reward for a given bill amount.
   * STRICT RULE: Computed exclusively server-side with decimal safety.
   */
  static calculateReward(billAmount: number, percentage?: number): number {
    const rate = percentage !== undefined ? percentage : config.rewards.defaultPercentage;
    const reward = (billAmount * rate) / 100;
    return Math.floor(reward * 100) / 100; // Integer paise floor
  }

  /**
   * Retrieves or atomically initializes current month's RewardPool record in PostgreSQL.
   */
  static async getCurrentMonthPool() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    return await prisma.rewardPool.upsert({
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
   */
  static async claimPoolAmount(tx: any, rewardAmount: number) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const pool = await tx.rewardPool.upsert({
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

    const used = Number(pool.usedAmount);
    const cap = Number(pool.totalPoolCap);

    if (used + rewardAmount > cap) {
      await tx.rewardPool.update({
        where: { id: pool.id },
        data: { isCapped: true },
      });
      throw new Error(
        `Monthly reward pool limit of ₹${cap.toLocaleString('en-IN')} reached. Remaining headroom: ₹${Math.max(
          0,
          cap - used
        ).toFixed(2)}.`
      );
    }

    const newUsed = Math.round((used + rewardAmount) * 100) / 100;
    const isCapped = newUsed >= cap;

    return await tx.rewardPool.update({
      where: { id: pool.id },
      data: {
        usedAmount: newUsed,
        isCapped,
      },
    });
  }

  /**
   * Returns current pool usage analytics for Admin Dashboard.
   */
  static async getPoolAnalytics() {
    const pool = await this.getCurrentMonthPool();
    const used = Number(pool.usedAmount);
    const cap = Number(pool.totalPoolCap);
    const remaining = Math.max(0, cap - used);
    const percentageUsed = cap > 0 ? (used / cap) * 100 : 0;

    return {
      year: pool.year,
      month: pool.month,
      totalPoolCap: cap,
      usedAmount: used,
      remainingAmount: Math.round(remaining * 100) / 100,
      percentageUsed: Math.round(percentageUsed * 10) / 10,
      isCapped: pool.isCapped,
    };
  }

  /**
   * Retrieves active reward rule for a given profession.
   */
  static async getRewardRule(profession?: Profession | null) {
    if (profession) {
      const rule = await prisma.rewardRule.findFirst({
        where: { profession, isActive: true },
      });
      if (rule) return rule;
    }

    const defaultRule = await prisma.rewardRule.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (defaultRule) return defaultRule;

    return {
      percentage: config.rewards.defaultPercentage,
      monthlyPoolLimit: config.rewards.monthlyPoolCap,
      minRedemptionAmount: config.rewards.minRedemptionAmount,
    };
  }

  /**
   * Admin updates reward rule configuration with audit logging.
   */
  static async updateRewardRules(
    adminId: string,
    updates: { percentage?: number; monthlyPoolLimit?: number; minRedemptionAmount?: number; profession?: Profession }
  ) {
    const existing = await prisma.rewardRule.findFirst({
      where: updates.profession ? { profession: updates.profession } : { isActive: true },
    });

    let updated;
    if (existing) {
      updated = await prisma.rewardRule.update({
        where: { id: existing.id },
        data: {
          ...(updates.percentage !== undefined && { percentage: updates.percentage }),
          ...(updates.monthlyPoolLimit !== undefined && { monthlyPoolLimit: updates.monthlyPoolLimit }),
          ...(updates.minRedemptionAmount !== undefined && { minRedemptionAmount: updates.minRedemptionAmount }),
          updatedByAdminId: adminId,
        },
      });
    } else {
      updated = await prisma.rewardRule.create({
        data: {
          profession: updates.profession || null,
          percentage: updates.percentage || config.rewards.defaultPercentage,
          monthlyPoolLimit: updates.monthlyPoolLimit || config.rewards.monthlyPoolCap,
          minRedemptionAmount: updates.minRedemptionAmount || config.rewards.minRedemptionAmount,
          isActive: true,
          updatedByAdminId: adminId,
        },
      });
    }

    // Sync monthly pool cap if updated
    if (updates.monthlyPoolLimit !== undefined) {
      const now = new Date();
      await prisma.rewardPool.updateMany({
        where: { year: now.getFullYear(), month: now.getMonth() + 1 },
        data: { totalPoolCap: updates.monthlyPoolLimit },
      });
    }

    return updated;
  }
}
