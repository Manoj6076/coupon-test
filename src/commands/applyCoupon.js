import pool from '../db.js';

/**
 * Create a new order for `cartTotal` and apply a single coupon to it:
 * validate the coupon, compute the discount, record the redemption
 * (counts against the coupon's usage_limit, and its usage_limit_per_user
 * if userId is given — bonus 2), and store the result on the order.
 * @param {number} cartTotal
 * @param {string} code
 * @param {string|null} [userId] - bonus 2: required if the coupon has a usage_limit_per_user
 * @returns {Promise<{orderId: string, discountAmount: number, finalTotal: number}>}
 * @throws {Error} if the coupon is invalid, expired, below min spend, or
 *   at its usage limit (global or per-user)
 */
export async function applyCoupon(cartTotal, code, userId = null) {
  if (!Number.isFinite(cartTotal) || cartTotal < 0) {
    throw new Error('Cart total must be 0 or greater');
  }

  if (!code || typeof code !== 'string') {
    throw new Error('Coupon code is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the coupon row so concurrent redemptions cannot
    // both pass the usage-limit check.
    const couponResult = await client.query(
      `SELECT
         code,
         discount_type,
         discount_value,
         min_spend,
         expires_at,
         usage_limit,
         times_used,
         max_discount_amount,
         usage_limit_per_user
       FROM coupons
       WHERE code = $1
       FOR UPDATE`,
      [code]
    );

    if (couponResult.rows.length === 0) {
      throw new Error(`Coupon '${code}' not found`);
    }

    const coupon = couponResult.rows[0];

    if (new Date(coupon.expires_at) <= new Date()) {
      throw new Error(`Coupon '${code}' has expired`);
    }

    if (cartTotal < Number(coupon.min_spend)) {
      throw new Error(
        `Minimum spend of ${Number(coupon.min_spend).toFixed(2)} required`
      );
    }

    if (coupon.times_used >= coupon.usage_limit) {
      throw new Error(`Coupon '${code}' has reached its usage limit`);
    }

    // Bonus 2: enforce the per-user redemption limit.
    if (coupon.usage_limit_per_user !== null) {
      if (!userId) {
        throw new Error(
          `User ID is required for coupon '${code}'`
        );
      }

      const userUsageResult = await client.query(
        `SELECT COUNT(*) AS count
         FROM orders
         WHERE coupon_code = $1
           AND user_id = $2
           AND status <> 'cancelled'`,
        [code, userId]
      );

      const userTimesUsed = Number(userUsageResult.rows[0].count);

      if (userTimesUsed >= coupon.usage_limit_per_user) {
        throw new Error(
          `Coupon '${code}' has reached its per-user usage limit`
        );
      }
    }

    // Use cents for currency calculations to avoid floating-point
    // precision problems.
    const cartCents = Math.round(cartTotal * 100);
    let discountCents;

    if (coupon.discount_type === 'percent') {
      discountCents = Math.round(
        cartCents * Number(coupon.discount_value) / 100
      );

      // Bonus 1: cap percentage discounts when configured.
      if (coupon.max_discount_amount !== null) {
        const maxDiscountCents = Math.round(
          Number(coupon.max_discount_amount) * 100
        );

        discountCents = Math.min(discountCents, maxDiscountCents);
      }
    } else {
      discountCents = Math.round(
        Number(coupon.discount_value) * 100
      );
    }

    // Never allow the discount to exceed the cart total.
    discountCents = Math.min(discountCents, cartCents);

    const finalCents = Math.max(0, cartCents - discountCents);

    const discountAmount = discountCents / 100;
    const finalTotal = finalCents / 100;

    // Create the order.
    const orderResult = await client.query(
      `INSERT INTO orders (
         cart_total,
         coupon_code,
         discount_amount,
         final_total,
         user_id
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        cartTotal.toFixed(2),
        code,
        discountAmount.toFixed(2),
        finalTotal.toFixed(2),
        userId
      ]
    );

    const orderId = orderResult.rows[0].id;

    // Record the redemption.
    await client.query(
      `INSERT INTO order_coupons (
         order_id,
         code,
         discount_amount
       )
       VALUES ($1, $2, $3)`,
      [orderId, code, discountAmount.toFixed(2)]
    );

    // Because the coupon row is locked inside this transaction,
    // this counter remains concurrency-safe.
    await client.query(
      `UPDATE coupons
       SET times_used = times_used + 1
       WHERE code = $1`,
      [code]
    );

    await client.query('COMMIT');

    return {
      orderId,
      discountAmount,
      finalTotal
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}