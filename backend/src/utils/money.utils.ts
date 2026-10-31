import { Decimal } from '@prisma/client/runtime/library';

/**
 * Converts a rupee amount to integer paise (1 Rupee = 100 Paise).
 */
export function toPaise(amount: number | string | Decimal): bigint {
  const dec = new Decimal(amount.toString());
  // Multiply by 100 and round to nearest integer paise
  const paise = dec.times(100).toFixed(0);
  return BigInt(paise);
}

/**
 * Converts integer paise back to formatted rupee number with 2 decimal places.
 */
export function fromPaise(paise: bigint): number {
  const dec = new Decimal(paise.toString()).dividedBy(100);
  return parseFloat(dec.toFixed(2));
}

/**
 * Deterministically computes reward for a bill amount.
 * Formula: floor(billAmount * percentage / 100) at paise precision.
 * Requires explicit, finite, positive ratePercentage (no default rate fallback).
 */
export function calculateRewardAmount(
  billAmount: number | string | Decimal,
  ratePercentage: number | string | Decimal
): number {
  if (ratePercentage === undefined || ratePercentage === null) {
    throw new Error('Reward rate percentage is required for calculation (no default rate).');
  }
  const billDec = new Decimal(billAmount.toString());
  const rateDec = new Decimal(ratePercentage.toString());

  if (!billDec.isFinite() || billDec.isNegative()) {
    throw new Error('Bill amount must be a finite non-negative number.');
  }

  if (!rateDec.isFinite() || rateDec.isNegative()) {
    throw new Error('Reward rate percentage must be a finite non-negative number.');
  }

  if (rateDec.isZero()) {
    return 0.0;
  }

  const rateFraction = rateDec.dividedBy(100);

  // Deterministic calculation: bill * (rate / 100), floor to 2 decimal places (paise)
  const rewardDec = billDec.times(rateFraction).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  return parseFloat(rewardDec.toFixed(2));
}

/**
 * Compares two money amounts safely using Decimal precision.
 */
export function compareMoney(a: number | string | Decimal, b: number | string | Decimal): number {
  const decA = new Decimal(a.toString());
  const decB = new Decimal(b.toString());
  return decA.comparedTo(decB);
}
