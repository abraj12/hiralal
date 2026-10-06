import { prisma } from '../db';
import { Profession } from '@prisma/client';
import { getIstYearAndMonth } from '../utils/timezone.utils';
import { calculateRewardAmount } from '../utils/money.utils';
import { RewardRuleService } from './reward-rule.service';

export class RewardService {
  /**
   * Deterministically calculates reward for an eligible amount at 2-decimal paise precision.
   * STRICT: Computed exclusively server-side.
   */
  static calculateReward(eligibleAmount: number, percentage: number): number {
    return calculateRewardAmount(eligibleAmount, percentage);
  }

  /**
   * Retrieves or atomically initializes current month's RewardPool record in PostgreSQL
   * strictly partitioned by profession (PLUMBER or TILE_INSTALLER) using business timezone Asia/Kolkata.
   */
  static async getCurrentMonthPool(profession: Profession = 'PLUMBER', tx: any = prisma) {
    const { year, month } = getIstYearAndMonth();

    const existing = await tx.rewardPool.findUnique({
      where: {
        pool_profession_year_month_unique: { profession, year, month },
      },
    });

    if (existing) return existing;

    // Resolve active rule to read configured monthly pool limit
    const activeRule = await RewardRuleService.getApplicableRule(profession, new Date(), tx);
    const poolCap = Number(activeRule.monthlyPoolLimit);

    return await tx.rewardPool.upsert({
      where: {
        pool_profession_year_month_unique: { profession, year, month },
      },
      update: {},
      create: {
        profession,
        year,
        month,
        totalPoolCap: poolCap,
        usedAmount: 0.0,
        isCapped: false,
      },
    });
  }

  /**
   * Atomically checks pool headroom against the configured monthly ceiling for a specific profession.
   */
  static async checkPoolAvailability(
    professionOrAmount: Profession | number = 'PLUMBER',
    rewardAmountArg?: number
  ): Promise<{ available: boolean; remaining: number }> {
    let profession: Profession = 'PLUMBER';
    let rewardAmount = 0;

    if (typeof professionOrAmount === 'number') {
      rewardAmount = professionOrAmount;
    } else {
      profession = professionOrAmount;
      rewardAmount = rewardAmountArg || 0;
    }

    const pool = await this.getCurrentMonthPool(profession);
    const used = Number(pool.usedAmount);
    const cap = Number(pool.totalPoolCap);
    const remaining = Math.max(0, cap - used);

    if (pool.isCapped || used + rewardAmount > cap) {
      return { available: false, remaining };
    }

    return { available: true, remaining };
  }

  /**
   * Atomically claims amount from a profession-specific monthly pool within a database transaction.
   * Uses atomic conditional SQL update to ensure strict concurrency protection.
   * Plumber approvals NEVER consume Tile Installer pool, and vice versa.
   */
  static async claimPoolAmount(tx: any, profession: Profession, rewardAmount: number) {
    const pool = await this.getCurrentMonthPool(profession, tx);
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
      const current = await tx.rewardPool.findUnique({ where: { id: pool.id } });
      const currentUsed = current ? Number(current.usedAmount) : cap;
      const remaining = Math.max(0, cap - currentUsed);

      throw new Error(
        `Monthly ${profession} reward pool ceiling of ₹${cap.toLocaleString('en-IN')} reached. Available headroom: ₹${remaining.toFixed(2)}. Approval rejected.`
      );
    }

    return result[0];
  }

  /**
   * Retrieves active reward rule for a given profession from database configuration.
   */
  static async getRewardRule(profession: Profession = 'PLUMBER', tx: any = prisma) {
    const rule = await RewardRuleService.getApplicableRule(profession, new Date(), tx);
    const pct = Number(rule.rewardPercentage);
    return {
      id: rule.id,
      profession: rule.profession,
      version: rule.version,
      rewardPercentage: pct,
      percentage: pct, // backward compatibility
      monthlyPoolLimit: Number(rule.monthlyPoolLimit),
      minRedemptionAmount: Number(rule.minRedemptionAmount),
      maxRedemptionAmount: Number(rule.maxRedemptionAmount),
      effectiveFrom: rule.effectiveFrom,
      effectiveUntil: rule.effectiveUntil,
    };
  }

  /**
   * Retrieves pool usage analytics for current month.
   * If profession is supplied, returns only that profession's metrics.
   */
  static async getPoolAnalytics(profession?: Profession) {
    if (profession) {
      const pool = await this.getCurrentMonthPool(profession);
      const totalCap = Number(pool.totalPoolCap);
      const used = Number(pool.usedAmount);
      const remaining = Math.max(0, totalCap - used);
      const percentageUsed = totalCap > 0 ? (used / totalCap) * 100 : 0;

      return {
        profession: pool.profession,
        year: pool.year,
        month: pool.month,
        totalPoolCap: totalCap,
        usedAmount: used,
        remainingAmount: remaining,
        percentageUsed: Math.round(percentageUsed * 100) / 100,
        isCapped: pool.isCapped,
      };
    }

    // Both professions
    const plumberPool = await this.getCurrentMonthPool('PLUMBER');
    const tilePool = await this.getCurrentMonthPool('TILE_INSTALLER');

    const pCap = Number(plumberPool.totalPoolCap);
    const pUsed = Number(plumberPool.usedAmount);
    const tCap = Number(tilePool.totalPoolCap);
    const tUsed = Number(tilePool.usedAmount);

    return {
      year: plumberPool.year,
      month: plumberPool.month,
      plumber: {
        profession: 'PLUMBER',
        totalPoolCap: pCap,
        usedAmount: pUsed,
        remainingAmount: Math.max(0, pCap - pUsed),
        percentageUsed: pCap > 0 ? Math.round((pUsed / pCap) * 10000) / 100 : 0,
        isCapped: plumberPool.isCapped,
      },
      tileInstaller: {
        profession: 'TILE_INSTALLER',
        totalPoolCap: tCap,
        usedAmount: tUsed,
        remainingAmount: Math.max(0, tCap - tUsed),
        percentageUsed: tCap > 0 ? Math.round((tUsed / tCap) * 10000) / 100 : 0,
        isCapped: tilePool.isCapped,
      },
      totalPoolCap: pCap + tCap,
      usedAmount: pUsed + tUsed,
      remainingAmount: Math.max(0, (pCap + tCap) - (pUsed + tUsed)),
      percentageUsed: (pCap + tCap) > 0 ? Math.round(((pUsed + tUsed) / (pCap + tCap)) * 10000) / 100 : 0,
      isCapped: plumberPool.isCapped && tilePool.isCapped,
    };
  }

  /**
   * Updates reward rules for a profession.
   */
  static async updateRewardRules(
    adminId: string,
    params: {
      percentage?: number;
      monthlyPoolLimit?: number;
      minRedemptionAmount?: number;
      maxRedemptionAmount?: number;
      profession?: Profession;
    }
  ) {
    const prof: Profession = params.profession || 'PLUMBER';
    const activeRule = await RewardRuleService.getApplicableRule(prof);

    return await RewardRuleService.createRule(adminId, {
      profession: prof,
      rewardPercentage: params.percentage !== undefined ? params.percentage : Number(activeRule.rewardPercentage),
      monthlyPoolLimit: params.monthlyPoolLimit !== undefined ? params.monthlyPoolLimit : Number(activeRule.monthlyPoolLimit),
      minRedemptionAmount: params.minRedemptionAmount !== undefined ? params.minRedemptionAmount : Number(activeRule.minRedemptionAmount),
      maxRedemptionAmount: params.maxRedemptionAmount !== undefined ? params.maxRedemptionAmount : Number(activeRule.maxRedemptionAmount),
    });
  }
}
