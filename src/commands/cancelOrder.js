import pool from '../db.js';

/**
 * Cancel an order. If a coupon was applied, its usage count should be
 * released back.
 * @param {string} orderId
 * @returns {Promise<string>} a result message
 * @throws {Error} if the order doesn't exist or is already cancelled
 */
export async function cancelOrder(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    throw new Error('Order ID is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the order so two cancellation requests cannot
    // release the same coupon usage twice.
    const orderResult = await client.query(
      `SELECT id, coupon_code, status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      throw new Error(`Order '${orderId}' not found`);
    }

    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      throw new Error(`Order '${orderId}' is already cancelled`);
    }

    // If this order used a coupon, lock that coupon and release
    // one usage from its counter.
    if (order.coupon_code) {
      const couponResult = await client.query(
        `SELECT code, times_used
         FROM coupons
         WHERE code = $1
         FOR UPDATE`,
        [order.coupon_code]
      );

      if (couponResult.rows.length === 0) {
        throw new Error(`Coupon '${order.coupon_code}' not found`);
      }

      const coupon = couponResult.rows[0];

      if (coupon.times_used <= 0) {
        throw new Error(
          `Coupon '${order.coupon_code}' has an invalid usage count`
        );
      }

      await client.query(
        `UPDATE coupons
         SET times_used = times_used - 1
         WHERE code = $1`,
        [order.coupon_code]
      );
    }

    await client.query(
      `UPDATE orders
       SET status = 'cancelled'
       WHERE id = $1`,
      [orderId]
    );

    await client.query('COMMIT');

    return `Order '${orderId}' cancelled successfully`;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}