const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// ── Admin auth middleware ─────────────────────────────────────
const adminAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.owner = jwt.verify(token, process.env.JWT_SECRET);
    if (req.owner.role !== 'admin') throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Admin huquqi yo\'q' });
  }
};

const PLATFORM_FEE = 5000; // har bir tasdiqlangan bron uchun 5,000 so'm

// ── Umumiy statistika ─────────────────────────────────────────
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const restaurants = await pool.query(`SELECT COUNT(*) FROM restaurants WHERE status = 'approved'`);
    const totalReservations = await pool.query(`SELECT COUNT(*) FROM reservations`);
    const confirmedReservations = await pool.query(`SELECT COUNT(*) FROM reservations WHERE status = 'confirmed'`);
    const pendingReservations = await pool.query(`SELECT COUNT(*) FROM reservations WHERE status = 'pending'`);
    const todayReservations = await pool.query(
      `SELECT COUNT(*) FROM reservations WHERE date = CURRENT_DATE AND status != 'cancelled'`
    );
    const premiumCount = await pool.query(`SELECT COUNT(*) FROM restaurants WHERE is_premium = true`);
    const totalUsers = await pool.query(`SELECT COUNT(*) FROM users`);

    const confirmed = parseInt(confirmedReservations.rows[0].count);
    const platformEarnings = confirmed * PLATFORM_FEE;

    // Oxirgi 7 kun statistikasi
    const weeklyStats = await pool.query(`
      SELECT date::text, COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
             COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled
      FROM reservations
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY date ORDER BY date ASC
    `);

    // Eng faol restoranlar (top 5)
    const topRestaurants = await pool.query(`
      SELECT res.id, res.name, res.address, res.is_premium,
             COUNT(r.id) as total_bookings,
             COUNT(r.id) FILTER (WHERE r.status = 'confirmed') as confirmed_bookings,
             COUNT(r.id) FILTER (WHERE r.status = 'confirmed') * ${PLATFORM_FEE} as platform_fee
      FROM restaurants res
      LEFT JOIN reservations r ON res.id = r.restaurant_id
      GROUP BY res.id, res.name, res.address, res.is_premium
      ORDER BY total_bookings DESC
      LIMIT 10
    `);

    res.json({
      restaurants: parseInt(restaurants.rows[0].count),
      totalReservations: parseInt(totalReservations.rows[0].count),
      confirmedReservations: confirmed,
      pendingReservations: parseInt(pendingReservations.rows[0].count),
      todayReservations: parseInt(todayReservations.rows[0].count),
      premiumRestaurants: parseInt(premiumCount.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count),
      platformEarnings,
      platformFee: PLATFORM_FEE,
      weeklyStats: weeklyStats.rows,
      topRestaurants: topRestaurants.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Barcha bronlar ────────────────────────────────────────────
router.get('/reservations', adminAuth, async (req, res) => {
  try {
    const { date, status, restaurant_id, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT r.*,
             u.first_name, u.last_name, u.telegram_id,
             res.name AS restaurant_name, res.address AS restaurant_address,
             CASE WHEN r.status = 'confirmed' THEN ${PLATFORM_FEE} ELSE 0 END AS platform_fee
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      JOIN restaurants res ON r.restaurant_id = res.id
      WHERE 1=1
    `;
    const params = [];

    if (date) { params.push(date); query += ` AND r.date = $${params.length}`; }
    if (status) { params.push(status); query += ` AND r.status = $${params.length}`; }
    if (restaurant_id) { params.push(restaurant_id); query += ` AND r.restaurant_id = $${params.length}`; }

    query += ` ORDER BY r.created_at DESC`;
    params.push(limit); query += ` LIMIT $${params.length}`;
    params.push(offset); query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Jami soni
    let countQuery = `SELECT COUNT(*) FROM reservations r WHERE 1=1`;
    const countParams = [];
    if (date) { countParams.push(date); countQuery += ` AND r.date = $${countParams.length}`; }
    if (status) { countParams.push(status); countQuery += ` AND r.status = $${countParams.length}`; }
    if (restaurant_id) { countParams.push(restaurant_id); countQuery += ` AND r.restaurant_id = $${countParams.length}`; }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      reservations: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Barcha restoranlar (xarita uchun ham) ─────────────────────
router.get('/restaurants', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT res.*,
             COUNT(r.id) as total_bookings,
             COUNT(r.id) FILTER (WHERE r.status = 'confirmed') as confirmed_bookings,
             COUNT(r.id) FILTER (WHERE r.status = 'confirmed') * ${PLATFORM_FEE} as platform_earnings,
             ro.email as owner_email
      FROM restaurants res
      LEFT JOIN reservations r ON res.id = r.restaurant_id
      LEFT JOIN restaurant_owners ro ON res.id = ro.restaurant_id
      GROUP BY res.id, ro.email
      ORDER BY total_bookings DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Daromad hisoboti ─────────────────────────────────────────
router.get('/earnings', adminAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    let dateFilter = '';
    const params = [];

    if (from) { params.push(from); dateFilter += ` AND r.date >= $${params.length}`; }
    if (to) { params.push(to); dateFilter += ` AND r.date <= $${params.length}`; }

    const result = await pool.query(`
      SELECT
        res.id, res.name, res.address, res.is_premium,
        COUNT(r.id) FILTER (WHERE r.status = 'confirmed') as confirmed_count,
        COUNT(r.id) FILTER (WHERE r.status = 'confirmed') * ${PLATFORM_FEE} as earnings,
        COUNT(r.id) FILTER (WHERE r.status = 'pending') as pending_count,
        COUNT(r.id) FILTER (WHERE r.status = 'cancelled') as cancelled_count
      FROM restaurants res
      LEFT JOIN reservations r ON res.id = r.restaurant_id ${dateFilter}
      GROUP BY res.id, res.name, res.address, res.is_premium
      ORDER BY earnings DESC
    `, params);

    const totalEarnings = result.rows.reduce((sum, r) => sum + parseInt(r.earnings || 0), 0);

    res.json({
      restaurants: result.rows,
      totalEarnings,
      platformFee: PLATFORM_FEE,
      period: { from, to }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Restoran statusini o'zgartirish ──────────────────────────
router.put('/restaurants/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE restaurants SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Restoran koordinatalarini yangilash ──────────────────────
router.put('/restaurants/:id/location', adminAuth, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const result = await pool.query(
      `UPDATE restaurants SET latitude = $1, longitude = $2 WHERE id = $3 RETURNING id, name, latitude, longitude`,
      [latitude, longitude, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin login (alohida endpoint) ──────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const bcrypt = require('bcryptjs');

    const result = await pool.query(
      `SELECT * FROM restaurant_owners WHERE email = $1 AND role = 'admin'`,
      [email]
    );
    const admin = result.rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin topilmadi' });

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: "Parol noto'g'ri" });

    const token = jwt.sign(
      { id: admin.id, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, admin: { id: admin.id, email: admin.email, role: 'admin' } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
