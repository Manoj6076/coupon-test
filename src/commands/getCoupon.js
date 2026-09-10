import pool from '../db.js';

/**
 * @param {string} code
 * @returns {Promise<{code: string, timesUsed: number, usageLimit: number, expiresAt: string}>}
 * @throws {Error} if the coupon doesn't exist
 */
export async function getCoupon(code) {
  if (!code || typeof code !== 'string') {
    throw new Error('Coupon code is required');
  }

  const result = await pool.query(
    `SELECT
       code,
       times_used,
       usage_limit,
       expires_at
     FROM coupons
     WHERE code = $1`,
    [code]
  );

  if (result.rows.length === 0) {
    throw new Error(`Coupon '${code}' not found`);
  }

  const coupon = result.rows[0];

  return {
    code: coupon.code,
    timesUsed: Number(coupon.times_used),
    usageLimit: Number(coupon.usage_limit),
    expiresAt: coupon.expires_at.toISOString()
  };
}