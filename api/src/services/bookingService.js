const db = require('../config/db')
const logger = require('../config/logger')

/**
 * Create a reservation.
 * - If user provided `table_id`, use it (after verifying it's free).
 * - If no table_id, auto-pick the first free table in the chosen zone (or any zone).
 * - If no table at all in this restaurant, still create the reservation with table_id = NULL.
 *
 * NOTE: Does not use transactions because the project's db.js only exposes query().
 * Race condition risk for simultaneous bookings is minimal given normal traffic.
 */
async function createReservation(userId, data, io) {
  const {
    restaurant_id,
    date,
    time,
    guests,
    comment,
    zone_id,
    table_id,
    pre_order,
    pre_order_total,
    deposit_status,
    deposit_amount,
    deposit_reference,
    deposit_screenshot
  } = data || {}

  if (!restaurant_id || !date || !time || !guests) {
    const e = new Error('Ma\'lumotlar to\'liq emas')
    e.status = 400
    throw e
  }

  // 1. Check restaurant exists and is active
  const rq = await db.query(
    'SELECT id, name, deposit_required, deposit_amount FROM restaurants WHERE id = $1 AND is_active = true',
    [restaurant_id]
  )
  if (!rq.rows.length) {
    const e = new Error('Restoran topilmadi')
    e.status = 404
    throw e
  }
  const restaurant = rq.rows[0]

  // 2. Check blocked times
  const blocked = await db.query(
    'SELECT 1 FROM availability WHERE restaurant_id = $1 AND date = $2 AND time = $3 AND is_blocked = true',
    [restaurant_id, date, time]
  )
  if (blocked.rows.length) {
    const e = new Error('Bu vaqt band qilingan')
    e.status = 409
    throw e
  }

  // 3. Pick table
  let finalTableId = null

  if (table_id) {
    // User chose a specific table → verify it belongs to this restaurant AND isn't double-booked
    const tcheck = await db.query(
      `SELECT t.id FROM tables t
       WHERE t.id = $1 AND t.restaurant_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.table_id = t.id
             AND r.date = $3 AND r.time = $4
             AND r.status NOT IN ('cancelled')
         )`,
      [table_id, restaurant_id, date, time]
    )
    if (tcheck.rows.length) {
      finalTableId = tcheck.rows[0].id
    } else {
      logger.warn(`Table ${table_id} taken or invalid for ${date} ${time}, falling back to auto-pick`)
    }
  }

  if (!finalTableId) {
    // Auto-pick first available table (preferring requested zone and minimum fitting capacity)
    const params = [restaurant_id, date, time, Number(guests)]
    let zoneFilter = ''
    if (zone_id) {
      params.push(zone_id)
      zoneFilter = ` AND t.zone_id = $${params.length}`
    }
    const tableResult = await db.query(
      `SELECT t.id FROM tables t
       WHERE t.restaurant_id = $1
         AND (t.is_available IS NULL OR t.is_available = true)
         AND (t.capacity IS NULL OR t.capacity >= $4)
         ${zoneFilter}
         AND NOT EXISTS (
           SELECT 1 FROM reservations r
           WHERE r.table_id = t.id
             AND r.date = $2 AND r.time = $3
             AND r.status NOT IN ('cancelled')
         )
       ORDER BY t.capacity ASC NULLS LAST, t.id ASC
       LIMIT 1`,
      params
    )
    finalTableId = tableResult.rows[0]?.id || null

    // If zone requested but no table found in that zone, try ANY zone
    if (!finalTableId && zone_id) {
      const fallback = await db.query(
        `SELECT t.id FROM tables t
         WHERE t.restaurant_id = $1
           AND (t.is_available IS NULL OR t.is_available = true)
           AND (t.capacity IS NULL OR t.capacity >= $4)
           AND NOT EXISTS (
             SELECT 1 FROM reservations r
             WHERE r.table_id = t.id
               AND r.date = $2 AND r.time = $3
               AND r.status NOT IN ('cancelled')
           )
         ORDER BY t.capacity ASC NULLS LAST, t.id ASC
         LIMIT 1`,
        [restaurant_id, date, time, Number(guests)]
      )
      finalTableId = fallback.rows[0]?.id || null
    }
  }

  // 4. Determine deposit status
  const needsDeposit = Boolean(restaurant.deposit_required)
  const finalDepositAmount = deposit_amount != null
    ? Number(deposit_amount)
    : (needsDeposit ? Number(restaurant.deposit_amount || 0) : 0)

  const finalDepositStatus = deposit_status ||
    (needsDeposit ? (deposit_reference || deposit_screenshot ? 'pending_review' : 'awaiting') : 'not_required')

  const initialStatus = (needsDeposit && finalDepositStatus === 'awaiting') ? 'pending_deposit' : 'pending'

  // 5. Insert reservation (works whether or not optional columns exist)
  let reservation
  try {
    const result = await db.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, zone_id, table_id,
        date, time, guests, comment, pre_order, pre_order_total,
        status, payment_status,
        deposit_required, deposit_amount, deposit_status,
        deposit_reference, deposit_screenshot
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15,
        $16, $17
      ) RETURNING *
    `, [
      userId,
      restaurant_id,
      zone_id || null,
      finalTableId,
      date,
      time,
      Number(guests),
      comment || null,
      JSON.stringify(pre_order || []),
      Number(pre_order_total) || 0,
      initialStatus,
      'unpaid',
      needsDeposit,
      finalDepositAmount,
      finalDepositStatus,
      deposit_reference || null,
      deposit_screenshot || null
    ])
    reservation = result.rows[0]
  } catch (err) {
    // Fallback: if some deposit columns don't exist, try a simpler insert
    logger.warn('Full insert failed, trying minimal insert:', err.message)
    const simple = await db.query(`
      INSERT INTO reservations (
        user_id, restaurant_id, zone_id, table_id,
        date, time, guests, comment, status, payment_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      userId, restaurant_id, zone_id || null, finalTableId,
      date, time, Number(guests), comment || null, initialStatus, 'unpaid'
    ])
    reservation = simple.rows[0]
  }

  // 6. Notify owner via socket.io (enriched payload so dashboard renders table_number immediately)
  if (io) {
    try {
      const enriched = await db.query(`
        SELECT res.*,
          u.first_name, u.last_name, u.username, u.phone AS user_phone, u.telegram_id AS user_telegram,
          z.name AS zone_name, t.table_number,
          COALESCE(NULLIF(TRIM(CONCAT(u.first_name,' ',COALESCE(u.last_name,''))), ''), u.username, 'Mijoz') AS user_name
        FROM reservations res
        LEFT JOIN users u ON u.id = res.user_id
        LEFT JOIN zones z ON z.id = res.zone_id
        LEFT JOIN tables t ON t.id = res.table_id
        WHERE res.id = $1
      `, [reservation.id])
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', enriched.rows[0] || reservation)
    } catch (e) {
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', reservation)
    }
  }

  // 7. Notify user via Telegram (best-effort, non-blocking)
  try {
    const telegramService = require('./telegramService')
    if (telegramService && telegramService.notifyUser) {
      telegramService.notifyUser(userId, 'new_reservation', {
        restaurant_name: restaurant.name,
        date, time, guests, comment
      }).catch(e => logger.warn('Telegram notify failed:', e.message))
    }
  } catch (e) {
    // telegramService might not exist — that's fine
  }

  return reservation
}

/**
 * Cron: expire old pending reservations, move confirmed past reservations to completed.
 */
async function expireReservations() {
  try {
    await db.query(`
      UPDATE reservations
      SET status = 'completed', completed_at = NOW()
      WHERE status = 'confirmed'
        AND (date < CURRENT_DATE OR (date = CURRENT_DATE AND time < CURRENT_TIME - INTERVAL '2 hours'))
    `)

    await db.query(`
      UPDATE reservations
      SET status = 'cancelled', cancelled_by = 'system', cancel_reason = 'Depozit to''lanmadi'
      WHERE status = 'pending_deposit'
        AND created_at < NOW() - INTERVAL '1 hour'
    `)

    await db.query(`
      UPDATE reservations
      SET status = 'cancelled', cancelled_by = 'system', cancel_reason = 'Muddati o''tdi'
      WHERE status = 'pending'
        AND date < CURRENT_DATE - INTERVAL '1 day'
    `)
  } catch (e) {
    logger.error('expireReservations:', e.message)
  }
}

module.exports = { createReservation, expireReservations }
