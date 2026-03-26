// src/routes/owner.js — Restaurant owner routes
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const { ownerAuth, createToken } = require('../middleware/auth');
const { authLimiter, apiLimiter, validate } = require('../middleware/security');
const resSvc = require('../services/reservationService');

// ── Auth ──────────────────────────────────────────────────────

// POST /api/owner/register
router.post('/register', authLimiter, validate('ownerRegister'), async (req, res, next) => {
  try {
    const { email, password, full_name, phone } = req.body;
    const { rows: existing } = await pool.query(
      'SELECT id FROM restaurant_owners WHERE email=$1', [email]
    );
    if (existing.length) return res.status(409).json({ error: "Bu email allaqachon ro'yxatdan o'tgan" });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash, full_name, phone, role)
       VALUES ($1,$2,$3,$4,'owner') RETURNING id, email, full_name, phone, role, restaurant_id`,
      [email, hash, full_name, phone || null]
    );
    const owner = rows[0];
    const token = createToken({ id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id });
    res.status(201).json({ token, owner });
  } catch (err) { next(err); }
});

// POST /api/owner/login
router.post('/login', authLimiter, validate('ownerLogin'), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query(
      'SELECT * FROM restaurant_owners WHERE email=$1', [email]
    );
    const owner = rows[0];
    // Consistent error to prevent email enumeration
    if (!owner || !(await bcrypt.compare(password, owner.password_hash))) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
    }
    const token = createToken({ id: owner.id, role: owner.role, restaurant_id: owner.restaurant_id });
    const { password_hash, ...safeOwner } = owner;
    res.json({ token, owner: safeOwner });
  } catch (err) { next(err); }
});

// ── Restaurant ────────────────────────────────────────────────

// GET /api/owner/restaurant
router.get('/restaurant', ownerAuth, async (req, res, next) => {
  try {
    if (!req.owner.restaurant_id) return res.json(null);
    const { rows } = await pool.query('SELECT * FROM restaurants WHERE id=$1', [req.owner.restaurant_id]);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

// POST /api/owner/restaurants — Create new restaurant
router.post('/restaurants', ownerAuth, validate('restaurant'), async (req, res, next) => {
  try {
    const { name, description, address, phone, cuisine, price_category, capacity, image_url, working_hours } = req.body;
    const cuisineArr = Array.isArray(cuisine) ? cuisine : (cuisine ? [cuisine] : []);

    const { rows } = await pool.query(
      `INSERT INTO restaurants (name,description,address,phone,cuisine,price_category,capacity,image_url,working_hours,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved') RETURNING *`,
      [name, description, address, phone, cuisineArr, price_category || '$$', capacity || 50, image_url, working_hours || '10:00 — 22:00']
    );
    const restaurant = rows[0];
    await pool.query('UPDATE restaurant_owners SET restaurant_id=$1 WHERE id=$2', [restaurant.id, req.owner.id]);
    res.status(201).json(restaurant);
  } catch (err) { next(err); }
});

// PUT /api/owner/restaurant — Update restaurant
router.put('/restaurant', ownerAuth, validate('restaurant'), async (req, res, next) => {
  try {
    if (!req.owner.restaurant_id) return res.status(400).json({ error: 'Avval restoran yarating' });
    const { name, description, address, phone, cuisine, price_category, capacity, image_url, working_hours } = req.body;
    const cuisineArr = Array.isArray(cuisine) ? cuisine : (cuisine ? [cuisine] : []);

    const { rows } = await pool.query(
      `UPDATE restaurants SET name=$1,description=$2,address=$3,phone=$4,cuisine=$5,
       price_category=$6,capacity=$7,image_url=$8,working_hours=$9 WHERE id=$10 RETURNING *`,
      [name, description, address, phone, cuisineArr, price_category, capacity, image_url, working_hours, req.owner.restaurant_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Restoran topilmadi' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/owner/restaurant/location
router.put('/restaurant/location', ownerAuth, async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({ error: "Koordinatalar noto'g'ri" });
    }
    await pool.query(
      'UPDATE restaurants SET latitude=$1, longitude=$2 WHERE id=$3',
      [parseFloat(latitude), parseFloat(longitude), req.owner.restaurant_id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Reservations ──────────────────────────────────────────────

// GET /api/owner/reservations
router.get('/reservations', ownerAuth, apiLimiter, async (req, res, next) => {
  try {
    const { date, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [req.owner.restaurant_id];
    let where = 'WHERE r.restaurant_id=$1';

    if (date) { params.push(date); where += ` AND r.date=$${params.length}`; }
    if (status) { params.push(status); where += ` AND r.status=$${params.length}`; }

    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, u.phone,
              z.name AS zone_name
       FROM reservations r
       JOIN users u ON r.user_id = u.id
       LEFT JOIN zones z ON r.zone_id = z.id
       ${where}
       ORDER BY r.date ASC, r.time ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// PUT /api/owner/reservations/:id — Update reservation status
router.put('/reservations/:id', ownerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const booking = await resSvc.updateReservationStatus(id, req.owner.restaurant_id, req.body.status);

    // Emit socket event
    const io = req.app.get('io');
    if (io) io.to(`restaurant_${req.owner.restaurant_id}`).emit('reservation_updated', { id, status: req.body.status });

    res.json(booking);
  } catch (err) { next(err); }
});

// ── Menu ──────────────────────────────────────────────────────

router.get('/menu', ownerAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM menu_items WHERE restaurant_id=$1 ORDER BY category, name',
      [req.owner.restaurant_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/menu', ownerAuth, validate('menuItem'), async (req, res, next) => {
  try {
    const { name, category, price, description, image_url } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO menu_items (restaurant_id,name,category,price,description,image_url,is_available)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *`,
      [req.owner.restaurant_id, name, category, price, description, image_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/menu/:id', ownerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { name, description, price, available, image_url } = req.body;
    const { rows } = await pool.query(
      `UPDATE menu_items SET name=$1,description=$2,price=$3,is_available=$4,image_url=$5
       WHERE id=$6 AND restaurant_id=$7 RETURNING *`,
      [name, description, price, available, image_url, id, req.owner.restaurant_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Taom topilmadi' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/menu/:id', ownerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    await pool.query('DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2', [id, req.owner.restaurant_id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Zones ─────────────────────────────────────────────────────

router.get('/zones', ownerAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM zones WHERE restaurant_id=$1 ORDER BY created_at',
      [req.owner.restaurant_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/zones', ownerAuth, validate('zone'), async (req, res, next) => {
  try {
    const { name, description, capacity, icon } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO zones (restaurant_id,name,description,capacity,icon,is_available)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [req.owner.restaurant_id, name, description, capacity || 10, icon || '🪑']
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/zones/:id', ownerAuth, async (req, res, next) => {
  try {
    const { is_available } = req.body;
    const { rows } = await pool.query(
      'UPDATE zones SET is_available=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING *',
      [is_available, req.params.id, req.owner.restaurant_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Zona topilmadi' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/zones/:id', ownerAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM zones WHERE id=$1 AND restaurant_id=$2', [req.params.id, req.owner.restaurant_id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Availability (block/unblock times) ───────────────────────

router.post('/availability/block', ownerAuth, async (req, res, next) => {
  try {
    const { date, time, reason } = req.body;
    if (!date || !time) return res.status(400).json({ error: 'date va time kerak' });
    await pool.query(
      `INSERT INTO availability (restaurant_id,date,time,is_blocked,reason)
       VALUES ($1,$2,$3,true,$4)
       ON CONFLICT (restaurant_id,date,time) DO UPDATE SET is_blocked=true, reason=$4`,
      [req.owner.restaurant_id, date, time, reason || null]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/availability/block', ownerAuth, async (req, res, next) => {
  try {
    const { date, time } = req.body;
    await pool.query(
      'UPDATE availability SET is_blocked=false WHERE restaurant_id=$1 AND date=$2 AND time=$3',
      [req.owner.restaurant_id, date, time]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Analytics ─────────────────────────────────────────────────

router.get('/analytics', ownerAuth, apiLimiter, async (req, res, next) => {
  try {
    const rid = req.owner.restaurant_id;
    if (!rid) return res.json({ today: 0, weekly: 0, revenue: 0, peakHours: [], noshowRate: 0, dailyStats: [] });

    const [today, weekly, revenue, peakHours, noshow, dailyStats, statusCounts] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as cnt FROM reservations WHERE restaurant_id=$1 AND date=CURRENT_DATE AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COUNT(*)::int as cnt FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'7 days' AND status!='cancelled'`, [rid]),
      pool.query(`SELECT COALESCE(SUM(amount),0)::int as total FROM payments WHERE restaurant_id=$1 AND status='paid' AND created_at>=DATE_TRUNC('month',CURRENT_DATE)`, [rid]),
      pool.query(`SELECT time::text, COUNT(*)::int as count FROM reservations WHERE restaurant_id=$1 AND status!='cancelled' GROUP BY time ORDER BY count DESC LIMIT 6`, [rid]),
      pool.query(`SELECT COUNT(*) FILTER(WHERE status='noshow')::int as noshow, COUNT(*)::int as total FROM reservations WHERE restaurant_id=$1`, [rid]),
      pool.query(`SELECT date::text, COUNT(*)::int as count FROM reservations WHERE restaurant_id=$1 AND date>=CURRENT_DATE-INTERVAL'7 days' GROUP BY date ORDER BY date ASC`, [rid]),
      pool.query(`SELECT status, COUNT(*)::int as count FROM reservations WHERE restaurant_id=$1 GROUP BY status`, [rid])
    ]);

    const noshowRow = noshow.rows[0];
    res.json({
      today: today.rows[0].cnt,
      weekly: weekly.rows[0].cnt,
      revenue: revenue.rows[0].total,
      peakHours: peakHours.rows.map(r => ({ time: r.time.slice(0,5), count: r.count })),
      noshowRate: noshowRow.total > 0 ? Math.round(noshowRow.noshow / noshowRow.total * 100) : 0,
      dailyStats: dailyStats.rows,
      statusCounts: statusCounts.rows
    });
  } catch (err) { next(err); }
});

// ── Premium ───────────────────────────────────────────────────

router.get('/premium', ownerAuth, async (req, res, next) => {
  try {
    const [sub, resto] = await Promise.all([
      pool.query(`SELECT * FROM premium_subscriptions WHERE restaurant_id=$1 ORDER BY created_at DESC LIMIT 1`, [req.owner.restaurant_id]),
      pool.query('SELECT is_premium FROM restaurants WHERE id=$1', [req.owner.restaurant_id])
    ]);
    res.json({ subscription: sub.rows[0] || null, is_premium: resto.rows[0]?.is_premium || false });
  } catch (err) { next(err); }
});

router.post('/premium/activate', ownerAuth, async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!['monthly', 'yearly'].includes(plan)) return res.status(400).json({ error: 'Plan: monthly yoki yearly' });
    const amount = plan === 'yearly' ? 1200000 : 150000;
    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + (plan === 'yearly' ? 12 : 1));
    await pool.query(
      `INSERT INTO premium_subscriptions (restaurant_id,plan,amount,status,expires_at) VALUES ($1,$2,$3,'active',$4)`,
      [req.owner.restaurant_id, plan, amount, expires_at]
    );
    await pool.query('UPDATE restaurants SET is_premium=true WHERE id=$1', [req.owner.restaurant_id]);
    res.json({ success: true, expires_at });
  } catch (err) { next(err); }
});

router.delete('/premium', ownerAuth, async (req, res, next) => {
  try {
    await pool.query(`UPDATE premium_subscriptions SET status='cancelled' WHERE restaurant_id=$1`, [req.owner.restaurant_id]);
    await pool.query('UPDATE restaurants SET is_premium=false WHERE id=$1', [req.owner.restaurant_id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
