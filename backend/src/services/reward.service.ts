import { config } from '../config';
import { dbStore, RewardPoolRecord, RewardRuleRecord } from '../db/store';

export class RewardService {
  /**
   * Calculates reward for a given bill amount.
   * STRICT RULE: Must always be computed on the backend.
   * Formula: billAmount * (rewardPercentage / 100)
   */
  static calculateReward(billAmount: number, percentage?: number): number {
    const rate = percentage !== undefined ? percentage : config.rewards.defaultPercentage;
    const reward = (billAmount * rate) / 100;
    // Round to 2 decimal places
    return Math.round(reward * 100) / 100;
  }

  /**
   * Retrieves or initializes current month's RewardPool.
   */
  static getCurrentMonthPool(): RewardPoolRecord {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const poolId = `pool-${year}-${month}`;

    let pool = dbStore.rewardPools.get(poolId);
    if (!pool) {
      pool = {
        id: poolId,
        year,
        month,
        totalPoolCap: config.rewards.monthlyPoolCap,
        usedAmount: 0.0,
        isCapped: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dbStore.rewardPools.set(poolId, pool);
    }

    return pool;
  }

  /**
   * Atomically checks if the reward can be claimed without exceeding the monthly cap.
   * Throws an error or returns false if exceeding pool.
   */
  static checkPoolAvailability(rewardAmount: number): { available: boolean; remaining: number } {
    const pool = this.getCurrentMonthPool();
    const remaining = Math.max(0, pool.totalPoolCap - pool.usedAmount);

    if (pool.isCapped || pool.usedAmount + rewardAmount > pool.totalPoolCap) {
      return { available: false, remaining };
    }

    return { available: true, remaining };
  }

  /**
   * Atomically claims amount from monthly pool.
   */
  static claimPoolAmount(rewardAmount: number): RewardPoolRecord {
    const pool = this.getCurrentMonthPool();
    if (pool.usedAmount + rewardAmount > pool.totalPoolCap) {
      pool.isCapped = true;
      throw new Error(
        `Monthly reward pool limit of ₹${pool.totalPoolCap.toLocaleString('en-IN')} reached. Available remaining: ₹${Math.max(
          0,
          pool.totalPoolCap - pool.usedAmount
        ).toFixed(2)}.`
      );
    }

    pool.usedAmount = Math.round((pool.usedAmount + rewardAmount) * 100) / 100;
    if (pool.usedAmount >= pool.totalPoolCap) {
      pool.isCapped = true;
    }
    pool.updatedAt = new Date();
    dbStore.rewardPools.set(pool.id, pool);
    return pool;
  }

  /**
   * Returns current pool usage analytics for Admin Dashboard.
   * e.g. ₹37,850 / ₹50,000 (75.7% Used, Remaining: ₹12,150)
   */
  static getPoolAnalytics() {
    const pool = this.getCurrentMonthPool();
    const remaining = Math.max(0, pool.totalPoolCap - pool.usedAmount);
    const percentageUsed = pool.totalPoolCap > 0 ? (pool.usedAmount / pool.totalPoolCap) * 100 : 0;

    return {
      year: pool.year,
      month: pool.month,
      totalPoolCap: pool.totalPoolCap,
      usedAmount: pool.usedAmount,
      remainingAmount: Math.round(remaining * 100) / 100,
      percentageUsed: Math.round(percentageUsed * 10) / 10,
      isCapped: pool.isCapped,
    };
  }

  /**
   * Returns active reward rule settings.
   */
  static getRewardRules(): RewardRuleRecord {
    let rule = dbStore.rewardRules.get('rule-default');
    if (!rule) {
      const newRule: RewardRuleRecord = {
        id: 'rule-default',
        percentage: config.rewards.defaultPercentage,
        monthlyPoolLimit: config.rewards.monthlyPoolCap,
        minRedemptionAmount: config.rewards.minRedemptionAmount,
        isActive: true,
        updatedAt: new Date(),
      };
      dbStore.rewardRules.set(newRule.id, newRule);
      return newRule;
    }
    return rule;
  }

  /**
   * Admin updates reward rule configuration.
   */
  static updateRewardRules(
    adminId: string,
    updates: { percentage?: number; monthlyPoolLimit?: number; minRedemptionAmount?: number }
  ): RewardRuleRecord {
    const rule = this.getRewardRules();
    const pool = this.getCurrentMonthPool();

    if (updates.percentage !== undefined && updates.percentage > 0) {
      rule.percentage = updates.percentage;
    }
    if (updates.monthlyPoolLimit !== undefined && updates.monthlyPoolLimit > 0) {
      rule.monthlyPoolLimit = updates.monthlyPoolLimit;
      pool.totalPoolCap = updates.monthlyPoolLimit;
      pool.isCapped = pool.usedAmount >= pool.totalPoolCap;
      pool.updatedAt = new Date();
    }
    if (updates.minRedemptionAmount !== undefined && updates.minRedemptionAmount > 0) {
      rule.minRedemptionAmount = updates.minRedemptionAmount;
    }

    rule.updatedByAdminId = adminId;
    rule.updatedAt = new Date();
    dbStore.rewardRules.set(rule.id, rule);

    return rule;
  }
}
