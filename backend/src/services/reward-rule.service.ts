import { prisma } from '../db';
import { Profession, RewardRule } from '@prisma/client';
import { config } from '../config';
import { parseIndiaBusinessDate, formatIstDate } from '../utils/timezone.utils';

export class RewardRuleService {
  /**
   * Retrieves the authoritative active reward rule for a given profession at a specific business timestamp.
   * Derives applicability from the chronological timeline without mutating historical records.
   * Throws if no rule exists, if only future-scheduled rules exist, or if overlapping rules are detected.
   */
  static async getApplicableRule(
    profession: Profession,
    effectiveAtInput: Date | string = new Date(),
    tx: any = prisma
  ): Promise<RewardRule> {
    const effectiveAt =
      effectiveAtInput instanceof Date && !isNaN(effectiveAtInput.getTime())
        ? effectiveAtInput
        : parseIndiaBusinessDate(effectiveAtInput);
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
      orderBy: [
        { effectiveFrom: 'desc' },
        { version: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    if (rules.length === 0) {
      if (!config.isProduction) {
        // Documented test fixture bootstrap: only when the database contains zero rule history for this profession
        const totalRules = await tx.rewardRule.count({
          where: { profession },
        });

        if (totalRules === 0) {
          return await tx.rewardRule.create({
            data: {
              profession,
              rewardPercentage: 0.50,
              effectiveFrom: new Date('2020-01-01T00:00:00+05:30'),
              isActive: true,
              version: 1,
            },
          });
        }
      }

      // Fail closed: past invoice must never receive a future-scheduled rate or fabricate missing rules
      throw new Error(
        `[REWARD-RULE] No active reward rule found for profession ${profession} at effective date ${effectiveAt.toISOString()}. Operation halted (fail closed).`
      );
    }

    // Deterministic tie-breaking and ambiguous collision detection
    if (rules.length > 1 && rules[0].effectiveFrom.getTime() === rules[1].effectiveFrom.getTime()) {
      throw new Error(
        `[OVERLAPPING_REWARD_RULES] Multiple conflicting active rules found for ${profession} with identical effective date ${rules[0].effectiveFrom.toISOString()}. Operation halted (fail closed).`
      );
    }

    return rules[0];
  }

  /**
   * Creates a new versioned reward rule for a profession atomically.
   * Append-only: historical rule rows are preserved completely immutable.
   * Enforces business percentage limits (0.01% - 10.00%), strict date validation,
   * safe advisory lock concurrency serialization, and atomic audit logging.
   */
  static async createRule(
    adminId: string,
    params: {
      profession: Profession;
      rewardPercentage: number;
      effectiveFrom?: Date | string;
      effectiveUntil?: Date | string | null;
      isActive?: boolean;
    },
    tx?: any
  ): Promise<RewardRule> {
    const { profession, rewardPercentage } = params;

    // 1. Validation: Profession
    if (!profession || !['PLUMBER', 'TILE_INSTALLER'].includes(profession)) {
      throw new Error('Valid worker profession (PLUMBER or TILE_INSTALLER) is required.');
    }

    // 2. Validation: Percentage (strict finite number between 0.01% and 10.00%)
    if (typeof rewardPercentage !== 'number' || !Number.isFinite(rewardPercentage) || Number.isNaN(rewardPercentage)) {
      throw new Error('Reward percentage must be a valid, finite number.');
    }

    if (rewardPercentage < 0.01 || rewardPercentage > 10.00) {
      throw new Error('Reward percentage must be between 0.01% and 10.00%.');
    }

    // 3. Validation: Effective Date (Asia/Kolkata Business Calendar)
    let effectiveFrom: Date;
    try {
      effectiveFrom = parseIndiaBusinessDate(params.effectiveFrom);
    } catch (err: any) {
      throw new Error(err.message || 'Effective from date must be a valid date.');
    }

    // 4. Validation: Effective Until / Bounded Interval
    let effectiveUntil: Date | null = null;
    if (params.effectiveUntil !== undefined && params.effectiveUntil !== null) {
      try {
        effectiveUntil = parseIndiaBusinessDate(params.effectiveUntil);
      } catch (err: any) {
        throw new Error(err.message || 'Effective until must be a valid date.');
      }
      if (effectiveUntil <= effectiveFrom) {
        throw new Error('Effective until timestamp must be after effective from timestamp.');
      }
      // Temporary bounded rules leaving open-ended gaps are rejected to ensure continuous invoice coverage
      throw new Error(
        'Temporary bounded reward rules with open future gaps are not supported. Continuous versioned rules must be used.'
      );
    }

    const runAtomic = async (trx: any) => {
      // Concurrency lock: acquire transaction-scoped PostgreSQL advisory lock per profession.
      // Any lock failure aborts immediately (fail closed).
      await trx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reward_rule_' + profession})::bigint)`;

      // Check for ambiguous duplicate: an active rule with the exact same effective date
      if (params.isActive !== false) {
        const exactCollision = await trx.rewardRule.findFirst({
          where: {
            profession,
            isActive: true,
            effectiveFrom: effectiveFrom,
          },
        });

        if (exactCollision) {
          throw new Error(
            `An active reward rule (v${exactCollision.version}) already exists for ${profession} with effective date ${formatIstDate(effectiveFrom, 'yyyy-MM-dd')}. Ambiguous duplicate configurations are rejected to preserve deterministic history.`
          );
        }
      }

      // Determine next version number for this profession
      const latestRule = await trx.rewardRule.findFirst({
        where: { profession },
        orderBy: { version: 'desc' },
      });
      const nextVersion = latestRule ? latestRule.version + 1 : 1;

      // Append-only rule creation: historical rows are NEVER modified in place
      const newRule = await trx.rewardRule.create({
        data: {
          profession,
          rewardPercentage,
          effectiveFrom,
          effectiveUntil: null,
          isActive: params.isActive !== undefined ? params.isActive : true,
          version: nextVersion,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
        },
      });

      // Write corresponding audit log
      await trx.auditLog.create({
        data: {
          adminId,
          action: 'REWARD_RULE_CREATED',
          entityType: 'RewardRule',
          entityId: newRule.id,
          newValue: JSON.stringify({
            adminId,
            profession: newRule.profession,
            rewardPercentage: Number(newRule.rewardPercentage),
            version: newRule.version,
            effectiveFrom: newRule.effectiveFrom,
            effectiveUntil: newRule.effectiveUntil,
            appendOnly: true,
          }),
        },
      });

      return newRule;
    };

    if (tx && tx !== prisma) {
      return await runAtomic(tx);
    } else {
      return await prisma.$transaction(async (trx) => {
        return await runAtomic(trx);
      });
    }
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
    // If approved bills have used this rule, do not mutate percentage in-place!
    if (existing._count.bills > 0 && params.rewardPercentage !== undefined && Number(existing.rewardPercentage) !== params.rewardPercentage) {
      throw new Error(
        `Reward rule v${existing.version} is already bound to ${existing._count.bills} approved invoice(s). Create a new rule version to alter percentages without violating financial immutability.`
      );
    }

    const updated = await tx.rewardRule.update({
      where: { id: ruleId },
      data: {
        ...(params.rewardPercentage !== undefined && { rewardPercentage: params.rewardPercentage }),
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
   * Derives effectiveUntil dynamically from the chronological timeline without mutating database records.
   */
  static async listRules(profession?: Profession, tx: any = prisma) {
    const rules = await tx.rewardRule.findMany({
      where: {
        ...(profession && { profession }),
      },
      orderBy: [{ profession: 'asc' }, { effectiveFrom: 'asc' }, { version: 'asc' }],
    });

    // Derive effectiveUntil for each rule based on chronological sequence
    const enriched = rules.map((r: any, idx: number, arr: any[]) => {
      const nextRule = arr.slice(idx + 1).find((other: any) => other.profession === r.profession && other.isActive);
      const derivedUntil = r.effectiveUntil || (nextRule ? nextRule.effectiveFrom : null);
      return {
        ...r,
        derivedEffectiveUntil: derivedUntil,
        effectiveUntil: r.effectiveUntil || derivedUntil,
      };
    });

    return enriched.sort((a: any, b: any) => {
      if (a.profession !== b.profession) return a.profession.localeCompare(b.profession);
      return b.version - a.version;
    });
  }
}
