// src/services/reservationService.js — Core reservation logic
'use strict';

const { pool, withTransaction } = require('../config/db');
const { env } = require('../config/env');
const notify = require('./notificationService');
const logger = require('../config/logger');

// ── Helper: find alternative time slots ──────────────────────

async function findAlternativeTimes(restaurantId, date, time) {
  const { rows } = await pool.query(
    `SELECT DISTINCT time::text FROM reservations
     WHERE restaurant_id = $1 AND date = $2 AND status NOT IN ('cancelled')`,
    [restaurantId, date]
  );
  const busy = rows.map(r => r.time.slice(0, 5));

  const allSlots = [];
  for (let h = 10; h <= 21; h++) {
    allSlots.push(`${String(h).padStart(2, '0')}:00`);
    allSlots.push(`${String(h).padStart(2, '0')}:30`);
  }
  allSlots.push('22:00');

  const free = allSlots.filter(s => !busy.includes(s));
  const [hh, mm] = time.split(':').map(Number);
  const base = hh * 60 + mm;

  return free
    .map(s => { const [h, m] = s.split(':').map(Number); return { time: s, diff: Math.abs(h * 60 + m - base) }; })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map(s => s.time);
}

// ── Helper: check no-show history ────────────────────────────

async function userHasNoShow(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM reservations WHERE user_id = $1 AND status = 'noshow' LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

// ── Create reservation ────────────────────────────────────────

async function createReservation({ userId, restaurantId, date, time, guests, comment, specialRequest, zoneId, preOrder }) {
  return withTransaction(async (client) => {
    // Lock restaurant row to prevent race conditions
    const { rows: restos } = await client.query(
      `SELECT id, name, capacity FROM restaurants WHERE id = $1 AND status = 'approved' FOR UPDATE`,
      [restaurantId]
    );
    if (!restos.length) throw Object.assign(new Error('Restoran topilmadi'), { statusCode: 404 });

    const { name: restaurantName, capacity } = restos[0];

    // Check blocked time
    const { rows: blocked } = await client.query(
      `SELECT 1 FROM availability WHERE restaurant_id=$1 AND date=$2 AND time=$3 AND is_blocked=true`,
      [restaurantId, date, time]
    );
    if (blocked.length) {
      const alternatives = await findAlternativeTimes(restaurantId, date, time);
      const err = Object.assign(new Error('Bu vaqt bloklangan'), { statusCode: 400, alternatives });
      throw err;
    }

    // Check capacity
    const { rows: conflicts } = await client.query(
      `SELECT COUNT(*)::int as cnt FROM reservations
       WHERE restaurant_id=$1 AND date=$2 AND time=$3 AND status NOT IN ('cancelled')`,
      [restaurantId, date, time]
    );
    if (conflicts[0].cnt >= capacity) {
      const alternatives = await findAlternativeTimes(restaurantId, date, time);
      const err = Object.assign(new Error('Bu vaqtda joy mavjud emas'), { statusCode: 400, alternatives });
      throw err;
    }

    // Check no-show → require deposit
    const requiresDeposit = await userHasNoShow(userId);
    const paymentStatus = requiresDeposit ? 'unpaid' : 'not_required';
    const status = requiresDeposit ? 'waiting_payment' : 'pending';

    const preOrderJson = JSON.stringify(preOrder || []);
    const preOrderTotal = (preOrder || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);

    const { rows } = await client.query(
      `INSERT INTO reservations
         (user_id, restaurant_id, zone_id, date, time, guests, comment, special_request,
          pre_order, pre_order_total, status, requires_deposit, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [userId, restaurantId, zoneId || null, date, time, guests,
       comment || null, specialRequest || null, preOrderJson, preOrderTotal,
       status, requiresDeposit, paymentStatus]
    );

    return { booking: rows[0], restaurantName, requiresDeposit };
  });
}

// ── Cancel reservation ────────────────────────────────────────

async function cancelReservation(reservationId, userId) {
  const { rows } = await pool.query(
    `SELECT r.*, res.name AS restaurant_name FROM reservations r
     JOIN restaurants res ON r.restaurant_id = res.id
     WHERE r.id = $1 AND r.user_id = $2`,
    [reservationId, userId]
  );

  if (!rows.length) throw Object.assign(new Error('Bron topilmadi'), { statusCode: 404 });
  const booking = rows[0];

  if (booking.status === 'cancelled') {
    throw Object.assign(new Error('Bron allaqachon bekor qilingan'), { statusCode: 400 });
  }

  const bookingDateTime = new Date(`${String(booking.date).split('T')[0]}T${booking.time}`);
  if (bookingDateTime < new Date()) {
    throw Object.assign(new Error("O'tgan bronni bekor qilib bo'lmaydi"), { statusCode: 400 });
  }

  await pool.query(`UPDATE reservations SET status='cancelled' WHERE id=$1`, [reservationId]);

  // Notify user
  const { rows: users } = await pool.query('SELECT telegram_id FROM users WHERE id=$1', [userId]);
  if (users[0]?.telegram_id) {
    notify.notifyBookingCancelledByUser(users[0].telegram_id, booking, booking.restaurant_name).catch(() => {});
  }

  return { success: true };
}

// ── Owner update reservation status ──────────────────────────

async function updateReservationStatus(reservationId, restaurantId, status) {
  const validStatuses = ['confirmed', 'cancelled', 'completed', 'noshow'];
  if (!validStatuses.includes(status)) {
    throw Object.assign(new Error("Noto'g'ri status"), { statusCode: 400 });
  }

  const { rows } = await pool.query(
    `UPDATE reservations SET status=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
    [status, reservationId, restaurantId]
  );
  if (!rows.length) throw Object.assign(new Error('Bron topilmadi'), { statusCode: 404 });

  const booking = rows[0];

  // Get user telegram + restaurant name
  const { rows: userData } = await pool.query(
    `SELECT u.telegram_id, res.name AS restaurant_name
     FROM users u
     JOIN reservations r ON r.user_id = u.id
     JOIN restaurants res ON r.restaurant_id = res.id
     WHERE r.id = $1`,
    [reservationId]
  );

  if (userData[0]?.telegram_id) {
    const tid = userData[0].telegram_id;
    const name = userData[0].restaurant_name;
    if (status === 'confirmed') notify.notifyBookingConfirmed(tid, booking, name).catch(() => {});
    else if (status === 'cancelled') notify.notifyBookingCancelled(tid, booking, name).catch(() => {});
    else if (status === 'completed') notify.notifyBookingCompleted(tid, name).catch(() => {});
    else if (status === 'noshow') notify.notifyNoShow(tid, env.DEPOSIT_AMOUNT).catch(() => {});
  }

  return booking;
}

// ── Get busy time slots for a restaurant/date ─────────────────

async function getBusySlots(restaurantId, date) {
  const { rows } = await pool.query(
    `SELECT DISTINCT time::text FROM reservations
     WHERE restaurant_id=$1 AND date=$2 AND status NOT IN ('cancelled')`,
    [restaurantId, date]
  );
  return rows.map(r => r.time.slice(0, 5));
}

module.exports = {
  createReservation,
  cancelReservation,
  updateReservationStatus,
  getBusySlots,
  findAlternativeTimes,
  userHasNoShow
};
