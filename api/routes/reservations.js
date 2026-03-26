// src/routes/reservations.js — User reservation routes
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const { userAuth } = require('../middleware/auth');
const { reservationLimiter, apiLimiter, validate } = require('../middleware/security');
const resSvc = require('../services/reservationService');
const notify = require('../services/notificationService');
const { env } = require('../config/env');

// POST /api/reservations — Create booking
router.post('/', userAuth, reservationLimiter, validate('reservation'), async (req, res, next) => {
  try {
    const { restaurant_id, date, time, guests, comment, special_request, zone_id, pre_order } = req.body;

    const result = await resSvc.createReservation({
      userId: req.user.id,
      restaurantId: restaurant_id,
      date, time, guests, comment, specialRequest: special_request,
      zoneId: zone_id,
      preOrder: pre_order || []
    });

    const { booking, restaurantName, requiresDeposit } = result;

    // Get user + zone info for notifications
    const { rows: users } = await pool.query(
      'SELECT telegram_id, first_name FROM users WHERE id=$1', [req.user.id]
    );
    const user = users[0];

    let zoneName = '';
    if (zone_id) {
      const { rows: zones } = await pool.query('SELECT name FROM zones WHERE id=$1', [zone_id]);
      zoneName = zones[0]?.name || '';
    }

    // Send Telegram notifications (non-blocking)
    if (user?.telegram_id) {
      if (requiresDeposit) {
        notify.notifyDepositRequired(user.telegram_id, booking, restaurantName, env.DEPOSIT_AMOUNT).catch(() => {});
        notify.notifyDepositPaymentOptions(user.telegram_id, booking.id).catch(() => {});
      } else {
        notify.notifyBookingCreated(user.telegram_id, booking, restaurantName, zoneName).catch(() => {});
      }
    }

    // Emit socket event to owner dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`restaurant_${restaurant_id}`).emit('new_reservation', {
        id: booking.id,
        guest_name: user?.first_name || 'Mehmon',
        date, time, guests, comment, zone_name: zoneName,
        status: 'pending', created_at: booking.created_at
      });
    }

    res.status(201).json({
      ...booking,
      restaurant_name: restaurantName,
      requires_deposit: requiresDeposit,
      deposit_amount: requiresDeposit ? env.DEPOSIT_AMOUNT : 0,
      message: requiresDeposit
        ? `Depozit to'lash kerak: ${env.DEPOSIT_AMOUNT.toLocaleString()} so'm`
        : 'Bron qabul qilindi'
    });
  } catch (err) {
    if (err.alternatives) {
      return res.status(err.statusCode || 400).json({
        error: err.message,
        alternatives: err.alternatives,
        message: err.alternatives.length
          ? `Bo'sh vaqtlar: ${err.alternatives.join(', ')}`
          : "Bu kunda joy yo'q"
      });
    }
    next(err);
  }
});

// GET /api/reservations/my — User's reservations
router.get('/my', userAuth, apiLimiter, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const { rows } = await pool.query(
      `SELECT r.*, res.name AS restaurant_name, res.address, res.image_url,
              z.name AS zone_name
       FROM reservations r
       JOIN restaurants res ON r.restaurant_id = res.id
       LEFT JOIN zones z ON r.zone_id = z.id
       WHERE r.user_id = $1
       ORDER BY r.date DESC, r.time DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, parseInt(limit), parseInt(offset)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/reservations/check — Check availability
router.get('/check', apiLimiter, async (req, res, next) => {
  try {
    const { restaurant_id, date, time } = req.query;
    if (!restaurant_id || !date || !time) {
      return res.status(400).json({ error: 'restaurant_id, date, time kerak' });
    }

    const { rows: restos } = await pool.query(
      'SELECT capacity FROM restaurants WHERE id=$1', [restaurant_id]
    );
    const capacity = restos[0]?.capacity || 50;

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reservations
       WHERE restaurant_id=$1 AND date=$2 AND time=$3 AND status NOT IN ('cancelled')`,
      [restaurant_id, date, time]
    );

    if (rows[0].cnt >= capacity) {
      const alternatives = await resSvc.findAlternativeTimes(restaurant_id, date, time);
      return res.json({ available: false, alternatives });
    }
    res.json({ available: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reservations/:id — Cancel booking
router.delete('/:id', userAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const result = await resSvc.cancelReservation(id, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
