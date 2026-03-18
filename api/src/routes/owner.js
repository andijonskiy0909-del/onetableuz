const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const ownerAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.owner = jwt.verify(token, process.env.JWT_SECRET);
    if (req.owner.role !== 'owner' && req.owner.role !== 'admin') throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Ro'yxatdan o'tish ────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email va parol kiritish shart' });
    }

    const existing = await pool.query(
      'SELECT id FROM restaurant_owners WHERE email = $1', [email]
    );
    if (existing.rows.length) {
      return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO restaurant_owners (email, password_hash)
       VALUES ($1, $2) RETURNING *`,
      [email, hash]
    );

    const owner = result.rows[0];
    const token = jwt.sign(
      { id: owner.id, role: 'owner', restaurant_id: owner.restaurant_id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, owner: { ...owner, role: 'owner' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM restaurant_owners WHERE email = $1', [email]
    );
    const owner = result.rows[0];
    if (!owner) return res.status(404).json({ error: 'Topilmadi' });

    const valid = await bcrypt.compare(password, owner.password_hash);
    if (!valid) return res.status(401).json({ error: "Parol noto'g'ri" });

    const token = jwt.sign(
      { id: owner.id, role: owner.role || 'owner', restaurant_id: owner.restaurant_id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, owner: { ...owner, role: owner.role || 'owner' } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Restoran ma'lumotlarini olish ────────────────────────────
router.get('/restaurant', ownerAuth, async (req, res) => {
  try {
    if (!req.owner.restaurant_id) return res.json(null);
    const result = await pool.query(
      'SELECT * FROM restaurants WHERE id = $1',
      [req.owner.restaurant_id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Restoran qo'shish ────────────────────────────────────────
router.post('/restaurants', ownerAuth, async (req, res) => {
  try {
    const { name, description, address, phone, cuisine, price_category, capacity, image_url } = req.body;

    if (!name || !address) {
      return res.status(400).json({ error: 'Nom va manzil kiritish shart' });
    }

    const result = await pool.query(
      `INSERT INTO restaurants
        (name, description, address, phone, cuisine, price_category, capacity, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved')
       RETURNING *`,
      [name, description, address, phone, cuisine, price_category, capacity || 50, image_url]
    );

    const restaurant = result.rows[0];

    await pool.query(
      'UPDATE restaurant_owners SET restaurant_id = $1 WHERE id = $2',
      [restaurant.id, req.owner.id]
    );

    res.json(restaurant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Restoran yangilash ────────────────────────────────────────
router.put('/restaurant', ownerAuth, async (req, res) => {
  try {
    const { name, description, address, phone, cuisine, price_category, capacity, image_url } = req.body;

    const result = await pool.query(
      `UPDATE restaurants
       SET name=$1, description=$2, address=$3, phone=$4,
           cuisine=$5, price_category=$6, capacity=$7, image_url=$8
       WHERE id=$9 RETURNING *`,
      [name, description, address, phone, cuisine, price_category, capacity, image_url, req.owner.restaurant_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bronlar ro'yxati ─────────────────────────────────────────
router.get('/reservations', ownerAuth, async (req, res) => {
  try {
    const { date, status } = req.query;
    let query = `
      SELECT r.*, u.first_name, u.last_name, u.phone
      FROM reservations r
      JOIN users u ON r.user_id = u.id
      WHERE r.restaurant_id = $1
    `;
    const params = [req.owner.restaurant_id];
    if (date) { params.push(date); query += ` AND r.date = $${params.length}`; }
    if (status) { params.push(status); query += ` AND r.status = $${params.length}`; }
    query += ' ORDER BY r.date ASC, r.time ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bronni tasdiqlash / rad etish ────────────────────────────
router.put('/reservations/:id', ownerAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE reservations SET status = $1
       WHERE id = $2 AND restaurant_id = $3 RETURNING *`,
      [status, req.params.id, req.owner.restaurant_id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Topilmadi' });

    const r = result.rows[0];
    const userRes = await pool.query(
      'SELECT telegram_id FROM users WHERE id = $1', [r.user_id]
    );
    const telegramId = userRes.rows[0]?.telegram_id;
    if (telegramId) {
      const text = status === 'confirmed'
        ? `✅ <b>Broningiz tasdiqlandi!</b>\n📅 ${r.date} — ⏰ ${r.time}\n👥 ${r.guests} kishi`
        : `❌ <b>Broningiz rad etildi.</b>\n📅 ${r.date} — ⏰ ${r.time}`;
      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML' })
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Analitika ────────────────────────────────────────────────
router.get('/analytics', ownerAuth, async (req, res) => {
  try {
    const rid = req.owner.restaurant_id;

    const today = await pool.query(
      `SELECT COUNT(*) FROM reservations
       WHERE restaurant_id = $1 AND date = CURRENT_DATE AND status != 'cancelled'`,
      [rid]
    );
    const weekly = await pool.query(
      `SELECT COUNT(*) FROM reservations
       WHERE restaurant_id = $1
         AND date >= CURRENT_DATE - INTERVAL '7 days'
         AND status != 'cancelled'`,
      [rid]
    );
    const revenue = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM payments
       WHERE restaurant_id = $1
         AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
         AND status = 'paid'`,
      [rid]
    );
    const peakHours = await pool.query(
      `SELECT time, COUNT(*) as count
       FROM reservations
       WHERE restaurant_id = $1 AND status != 'cancelled'
       GROUP BY time ORDER BY count DESC LIMIT 5`,
      [rid]
    );
    const noshow = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'noshow') as noshow,
              COUNT(*) as total
       FROM reservations WHERE restaurant_id = $1`,
      [rid]
    );
    const dailyStats = await pool.query(
      `SELECT date, COUNT(*) as count
       FROM reservations
       WHERE restaurant_id = $1
         AND date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY date ORDER BY date ASC`,
      [rid]
    );

    res.json({
      today: parseInt(today.rows[0].count),
      weekly: parseInt(weekly.rows[0].count),
      revenue: parseInt(revenue.rows[0].total),
      peakHours: peakHours.rows,
      noshowRate: noshow.rows[0].total > 0
        ? Math.round(noshow.rows[0].noshow / noshow.rows[0].total * 100) : 0,
      dailyStats: dailyStats.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Menyu boshqaruvi ─────────────────────────────────────────
router.get('/menu', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM menu_items WHERE restaurant_id = $1 ORDER BY category, name`,
      [req.owner.restaurant_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/menu', ownerAuth, async (req, res) => {
  try {
    const { name, category, price, description, image_url } = req.body;
    const result = await pool.query(
      `INSERT INTO menu_items (restaurant_id, name, category, price, description, image_url, is_available)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
      [req.owner.restaurant_id, name, category, price, description, image_url || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/menu/:id', ownerAuth, async (req, res) => {
  try {
    const { name, description, price, available, image_url } = req.body;
    const result = await pool.query(
      `UPDATE menu_items SET name=$1, description=$2, price=$3, is_available=$4, image_url=$5
       WHERE id=$6 AND restaurant_id=$7 RETURNING *`,
      [name, description, price, available, image_url || null, req.params.id, req.owner.restaurant_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/menu/:id', ownerAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM menu_items WHERE id = $1 AND restaurant_id = $2',
      [req.params.id, req.owner.restaurant_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Bo'sh vaqtlarni belgilash ────────────────────────────────
router.post('/availability/block', ownerAuth, async (req, res) => {
  try {
    const { date, time, reason } = req.body;
    await pool.query(
      `INSERT INTO availability (restaurant_id, date, time, is_blocked, reason)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (restaurant_id, date, time)
       DO UPDATE SET is_blocked = true, reason = $4`,
      [req.owner.restaurant_id, date, time, reason]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/availability/block', ownerAuth, async (req, res) => {
  try {
    const { date, time } = req.body;
    await pool.query(
      `UPDATE availability SET is_blocked = false
       WHERE restaurant_id = $1 AND date = $2 AND time = $3`,
      [req.owner.restaurant_id, date, time]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Premium boshqaruvi ────────────────────────────────────────
router.get('/premium', ownerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM premium_subscriptions
       WHERE restaurant_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [req.owner.restaurant_id]
    );
    const resto = await pool.query(
      'SELECT is_premium FROM restaurants WHERE id = $1',
      [req.owner.restaurant_id]
    );
    res.json({
      subscription: result.rows[0] || null,
      is_premium: resto.rows[0]?.is_premium || false
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/premium/activate', ownerAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    const amount = plan === 'yearly' ? 990 : 99;
    const months = plan === 'yearly' ? 12 : 1;

    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + months);

    await pool.query(
      `INSERT INTO premium_subscriptions
        (restaurant_id, plan, amount, status, expires_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [req.owner.restaurant_id, plan, amount, expires_at]
    );

    await pool.query(
      'UPDATE restaurants SET is_premium = true WHERE id = $1',
      [req.owner.restaurant_id]
    );

    res.json({ success: true, expires_at });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/premium', ownerAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE premium_subscriptions SET status = 'cancelled'
       WHERE restaurant_id = $1`,
      [req.owner.restaurant_id]
    );
    await pool.query(
      'UPDATE restaurants SET is_premium = false WHERE id = $1',
      [req.owner.restaurant_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
