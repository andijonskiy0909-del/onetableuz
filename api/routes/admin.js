// src/routes/admin.js — Admin panel routes
'use strict';

const router = require('express').Router();
const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');
const { adminAuth, createToken } = require('../middleware/auth');
const { authLimiter, apiLimiter } = require('../middleware/security');
const { env } = require('../config/env');

// POST /api/admin/login
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email va parol kerak' });

    const { rows } = await pool.query(
      `SELECT * FROM restaurant_owners WHERE email=$1 AND role='admin'`, [email]
    );
    const admin = rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: "Email yoki parol noto'g'ri" });
    }

    const token = createToken({ id: admin.id, role: 'admin' }, '7d');
    res.json({ token, admin: { id: admin.id, email: admin.email, role: 'admin' } });
  } catch (err) { next(err); }
});

// GET /api/admin/stats
router.get('/stats', adminAuth, apiLimiter, async (req, res, next) => {
  try {
    const [
      restaurants, totalRes, confirmedRes, pendingRes,
      todayRes, premiumCount, totalUsers, weeklyStats, topRestaurants
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as cnt FROM restaurants WHERE status='approved'`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM reservations`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM reservations WHERE status='confirmed'`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM reservations WHERE status='pending'`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM reservations WHERE date=CURRENT_DATE AND status!='cancelled'`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM restaurants WHERE is_premium=true`),
      pool.query(`SELECT COUNT(*)::int as cnt FROM users`),
      pool.query(`
        SELECT date::text, COUNT(*)::int as total,
               COUNT(*) FILTER (WHERE status='confirmed')::int as confirmed,
               COUNT(*) FILTER (WHERE status='cancelled')::int as cancelled
        FROM reservations WHERE date>=CURRENT_DATE-INTERVAL'7 days'
        GROUP BY date ORDER BY date ASC`),
      pool.query(`
        SELECT res.id, res.name, res.address, res.is_premium,
               COUNT(r.id)::int as total_bookings,
               COUNT(r.id) FILTER (WHERE r.status='confirmed')::int as confirmed_bookings,
               COUNT(r.id) FILTER (WHERE r.status='confirmed')::int * ${env.PLATFORM_FEE} as platform_fee
        FROM restaurants res
        LEFT JOIN reservations r ON res.id=r.restaurant_id
        GROUP BY res.id ORDER BY total_bookings DESC LIMIT 10`)
    ]);

    const confirmed = confirmedRes.rows[0].cnt;
    res.json({
      restaurants: restaurants.rows[0].cnt,
      totalReservations: totalRes.rows[0].cnt,
      confirmedReservations: confirmed,
      pendingReservations: pendingRes.rows[0].cnt,
      todayReservations: todayRes.rows[0].cnt,
      premiumRestaurants: premiumCount.rows[0].cnt,
      totalUsers: totalUsers.rows[0].cnt,
      platformEarnings: confirmed * env.PLATFORM_FEE,
      platformFee: env.PLATFORM_FEE,
      weeklyStats: weeklyStats.rows,
      topRestaurants: topRestaurants.rows
    });
  } catch (err) { next(err); }
});

// GET /api/admin/reservations
router.get('/reservations', adminAuth, apiLimiter, async (req, res, next) => {
  try {
    const { date, status, restaurant_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE 1=1';

    if (date) { params.push(date); where += ` AND r.date=$${params.length}`; }
    if (status) { params.push(status); where += ` AND r.status=$${params.length}`; }
    if (restaurant_id) { params.push(restaurant_id); where += ` AND r.restaurant_id=$${params.length}`; }

    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, u.telegram_id,
              res.name AS restaurant_name, res.address AS restaurant_address,
              CASE WHEN r.status='confirmed' THEN ${env.PLATFORM_FEE} ELSE 0 END AS platform_fee
       FROM reservations r
       JOIN users u ON r.user_id=u.id
       JOIN restaurants res ON r.restaurant_id=res.id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: total } = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM reservations r ${where}`,
      params.slice(0, -2)
    );

    res.json({
      reservations: rows,
      total: total[0].cnt,
      page: parseInt(page),
      totalPages: Math.ceil(total[0].cnt / limit)
    });
  } catch (err) { next(err); }
});

// GET /api/admin/restaurants
router.get('/restaurants', adminAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT res.*,
             COUNT(r.id)::int as total_bookings,
             COUNT(r.id) FILTER (WHERE r.status='confirmed')::int as confirmed_bookings,
             COUNT(r.id) FILTER (WHERE r.status='confirmed')::int * ${env.PLATFORM_FEE} as platform_earnings,
             ro.email as owner_email, ro.full_name as owner_name
      FROM restaurants res
      LEFT JOIN reservations r ON res.id=r.restaurant_id
      LEFT JOIN restaurant_owners ro ON res.id=ro.restaurant_id AND ro.role='owner'
      GROUP BY res.id, ro.email, ro.full_name
      ORDER BY total_bookings DESC`);
    res.json(rows);
  } catch (err) { next(err); }
});

// PUT /api/admin/restaurants/:id/status
router.put('/restaurants/:id/status', adminAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['approved', 'pending', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const { rows } = await pool.query(
      'UPDATE restaurants SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Restoran topilmadi' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/admin/restaurants/:id/location
router.put('/restaurants/:id/location', adminAuth, async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    const { rows } = await pool.query(
      'UPDATE restaurants SET latitude=$1,longitude=$2 WHERE id=$3 RETURNING id,name,latitude,longitude',
      [latitude, longitude, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// GET /api/admin/earnings
router.get('/earnings', adminAuth, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` AND r.date>=$${params.length}`; }
    if (to) { params.push(to); dateFilter += ` AND r.date<=$${params.length}`; }

    const { rows } = await pool.query(`
      SELECT res.id, res.name, res.is_premium,
             COUNT(r.id) FILTER (WHERE r.status='confirmed')::int as confirmed_count,
             COUNT(r.id) FILTER (WHERE r.status='confirmed')::int * ${env.PLATFORM_FEE} as earnings,
             COUNT(r.id) FILTER (WHERE r.status='pending')::int as pending_count,
             COUNT(r.id) FILTER (WHERE r.status='cancelled')::int as cancelled_count
      FROM restaurants res
      LEFT JOIN reservations r ON res.id=r.restaurant_id ${dateFilter}
      GROUP BY res.id ORDER BY earnings DESC`, params);

    const totalEarnings = rows.reduce((s, r) => s + parseInt(r.earnings || 0), 0);
    res.json({ restaurants: rows, totalEarnings, platformFee: env.PLATFORM_FEE, period: { from, to } });
  } catch (err) { next(err); }
});

module.exports = router;
