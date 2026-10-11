import { prisma } from '../db';
import { Profession } from '@prisma/client';
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
      minRedemptionAmount: Number(rule.minRedemptionAmount),
      maxRedemptionAmount: Number(rule.maxRedemptionAmount),
      effectiveFrom: rule.effectiveFrom,
      effectiveUntil: rule.effectiveUntil,
    };
  }

  /**
   * Updates reward rules for a profession.
   */
  static async updateRewardRules(
    adminId: string,
    params: {
      percentage?: number;
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
      minRedemptionAmount: params.minRedemptionAmount !== undefined ? params.minRedemptionAmount : Number(activeRule.minRedemptionAmount),
      maxRedemptionAmount: params.maxRedemptionAmount !== undefined ? params.maxRedemptionAmount : Number(activeRule.maxRedemptionAmount),
    });
  }
}
