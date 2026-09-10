import pool from '../db.js';

/**
 * Create a new coupon.
 * @param {string} code
 * @param {'percent'|'flat'} discountType
 * @param {number} discountValue
 * @param {number} minSpend
 * @param {string} expiresAt - ISO date string
 * @param {number} usageLimit
 * @param {number|null} [maxDiscountAmount] - bonus 1: cap on computed discount for percent coupons
 * @param {number|null} [usageLimitPerUser] - bonus 2: per-user redemption cap
 * @returns {Promise<string>} a result message
 * @throws {Error} on invalid input or duplicate code
 */
export async function createCoupon(
  code,
  discountType,
  discountValue,
  minSpend,
  expiresAt,
  usageLimit,
  maxDiscountAmount = null,
  usageLimitPerUser = null
) {
  if (!code || typeof code !== 'string') {
    throw new Error('Coupon code is required');
  }

  if (!['percent', 'flat'].includes(discountType)) {
    throw new Error('Discount type must be percent or flat');
  }

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new Error('Discount value must be greater than 0');
  }

  if (!Number.isFinite(minSpend) || minSpend < 0) {
    throw new Error('Minimum spend must be 0 or greater');
  }

  const expiryDate = new Date(expiresAt);

  if (Number.isNaN(expiryDate.getTime())) {
    throw new Error('Invalid expiry date');
  }

  if (!Number.isInteger(usageLimit) || usageLimit <= 0) {
    throw new Error('Usage limit must be a positive integer');
  }

  if (
    maxDiscountAmount !== null &&
    (!Number.isFinite(maxDiscountAmount) || maxDiscountAmount <= 0)
  ) {
    throw new Error('Maximum discount amount must be greater than 0');
  }

  if (
    usageLimitPerUser !== null &&
    (!Number.isInteger(usageLimitPerUser) || usageLimitPerUser <= 0)
  ) {
    throw new Error('Per-user usage limit must be a positive integer');
  }

  try {
    await pool.query(
      `INSERT INTO coupons (
        code,
        discount_type,
        discount_value,
        min_spend,
        expires_at,
        usage_limit,
        max_discount_amount,
        usage_limit_per_user
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        code,
        discountType,
        discountValue,
        minSpend,
        expiryDate,
        usageLimit,
        maxDiscountAmount,
        usageLimitPerUser
      ]
    );
  } catch (error) {
    if (error.code === '23505') {
      throw new Error(`Coupon '${code}' already exists`);
    }

    throw error;
  }

  return `Coupon '${code}' created successfully`;
}