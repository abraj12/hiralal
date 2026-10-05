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
 * Example: ₹1,00,000 * 0.5% = ₹500.00 exactly.
 */
export function calculateRewardAmount(billAmount: number | string | Decimal, ratePercentage = 0.50): number {
  const billDec = new Decimal(billAmount.toString());
  const rateDec = new Decimal(ratePercentage.toString()).dividedBy(100);
  
  // Deterministic calculation: bill * (rate / 100), floor to 2 decimal places (paise)
  const rewardDec = billDec.times(rateDec).toDecimalPlaces(2, Decimal.ROUND_DOWN);
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
